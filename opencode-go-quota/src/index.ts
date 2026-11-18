/**
 * Host half of the OpenCode Go quota chips.
 *
 * The browser half cannot read OpenCode itself: the Go usage endpoint needs the
 * account API key in an Authorization header, and that key lives only in the
 * Host credential store. This half resolves the key, polls the documented
 * `GET /zen/go/v1/usage` endpoint behind one shared cache, and answers the
 * browser half over exact Connection Fetch routes.
 *
 * Three routes are served below the authenticated carrier channel:
 *
 * - `GET /api/opencode-go-quota/usage` — the cached usage reading (`?force`
 *   bypasses both the success cache and the failure wait, but never duplicates
 *   a read that is already in flight: that call joins the running promise);
 * - `GET /api/opencode-go-quota/session?sessionId=…` — the Session projection's
 *   current value plus live subagent Sessions;
 * - `GET /api/opencode-go-quota/free` — the free-model watch (`?force`,
 *   `?ack`).
 *
 * A failed usage read is remembered for a while: the next unforced call is
 * answered from the failure instead of hammering the endpoint, and the wait
 * honours the endpoint's own `retry-after` before falling back to a jittered
 * exponential backoff.
 *
 * @module @local/opencode-go-quota
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ZodType } from 'zod'

import {
  FREE_ROUTE_PATH,
  SESSION_ROUTE_PATH,
  USAGE_ROUTE_PATH,
  nonEmpty,
  resolveConfig,
  messageOf,
} from './config.ts'
import { applyFreeReading, emptyFreeWatch, type FreeWatchState } from './free.ts'
import {
  applyUsageEvent,
  collectSubtree,
  emptyUsageState,
  finalizeUsage,
  parseUsageState,
} from './projection.ts'
import { backoffDelayMs, readGate, requestFreeModels, requestUsage } from './upstream.ts'
import type {
  ConnectionFetch,
  FreeSnapshot,
  FreeModelWire,
  SessionSnapshot,
  UsageSnapshot,
  UsageState,
  UsageWindows,
  WireError,
} from './wire.ts'

/**
 * Structural cast, one place: the projection seam only calls `parse`, so this
 * plain validator satisfies its schema contract without making zod a runtime
 * dependency of the package (`import type` is erased at build time).
 */
const USAGE_STATE_SCHEMA = {
  parse: parseUsageState,
} as unknown as ZodType<UsageState>

/** Hard dependencies: the route registry and the Session projection registry. */
export const inject = ['connection', 'sessions', 'sessionProjections'] as const

/**
 * Host plugin body.
 * @param ctx - owning plugin context.
 * @param config - the row's config: credential reference, base URLs, cache
 * windows, provider id, and optional price overrides.
 */
export async function apply(ctx: Context, config?: unknown): Promise<void> {
  const settings = resolveConfig(config)

  /**
   * Host-only Session projection. Keeping the fold in the projection seam makes
   * it replayable and checkpointed, and lets the route read the current value
   * instead of rescanning a durable log.
   */
  const usageProjection = await ctx.sessionProjections.register({
    key: 'opencodeGoQuotaUsage',
    stateVersion: 1,
    stateSchema: USAGE_STATE_SCHEMA,
    init: (_header, inheritedEventCount) => emptyUsageState(Number(inheritedEventCount) || 0),
    apply: (state, event) =>
      applyUsageEvent(state, event, { provider: settings.provider, prices: settings.prices }),
  })

  /** Last successful usage reading, kept across failures so a chip can render it as stale. */
  let lastGoodUsage: UsageWindows | null = null
  /** When that reading was taken; 0 before the first success. */
  let usageFetchedAt = 0
  /** The read currently in flight, shared by every caller. */
  let usageInflight: Promise<UsageSnapshot> | null = null
  /** Consecutive failed attempts, driving the backoff. */
  let usageFailures = 0
  /** Epoch milliseconds before which an unforced read is answered from the failure. */
  let usageRetryAt = 0
  /** The failure of the last attempt, so a suppressed retry can still report it. */
  let lastUsageError: WireError | null = null

  /** Free-model watcher state, kept across polls and failures. */
  let freeState: FreeWatchState = emptyFreeWatch()
  /** When the last successful free-model read was taken; 0 before the first. */
  let freeFetchedAt = 0
  /** The models-list read currently in flight, shared by every caller. */
  let freeInflight: Promise<FreeSnapshot> | null = null

  const connection = ctx.get('connection') as ConnectionFetch | undefined
  if (connection === undefined) {
    throw new Error('opencode-go-quota requires the Connection service')
  }

  ctx.effect(
    () =>
      connection.fetch.register({
        path: USAGE_ROUTE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const force = new URL(request.url).searchParams.has('force')
          return Response.json(await readUsage(force), {
            headers: { 'cache-control': 'no-store' },
          })
        },
      }),
    'opencode-go-quota: usage route',
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: SESSION_ROUTE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const sessionId = new URL(request.url).searchParams.get('sessionId')
          return Response.json(readSessionUsage(sessionId), {
            headers: { 'cache-control': 'no-store' },
          })
        },
      }),
    'opencode-go-quota: session usage route',
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: FREE_ROUTE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const params = new URL(request.url).searchParams
          const force = params.has('force')
          const ack = params.has('ack')
          return Response.json(await readFreeModels(force, ack), {
            headers: { 'cache-control': 'no-store' },
          })
        },
      }),
    'opencode-go-quota: free models route',
  )

  /**
   * Answer one Session's attributed usage from its host projection. The
   * projection owns the fold, so this route is O(new events) and reflects a
   * live child Session without waiting for the parent to append anything.
   * @param rawSessionId - query value naming the Session.
   * @returns the wire snapshot the Client half renders.
   */
  function readSessionUsage(rawSessionId: unknown): SessionSnapshot {
    const sessionId = nonEmpty(rawSessionId)
    if (sessionId === undefined) {
      return { state: 'invalid', provider: settings.provider, generatedAt: Date.now() }
    }
    const session = ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) {
      return { state: 'missing', sessionId, provider: settings.provider, generatedAt: Date.now() }
    }
    const direct = finalizeUsage(usageProjection.stateOf(session))
    const subtree = collectSubtree(session, {
      stateOf: (node) => usageProjection.stateOf(node),
      get: (id) => ctx.sessions.get(id as SessionId),
    })
    return {
      state: 'ok',
      sessionId,
      provider: settings.provider,
      asOfSeq: Number(session.seq) - 1,
      forked: direct.forked,
      inheritedEventCount: direct.inheritedEventCount,
      direct,
      subtree: {
        ...subtree.summary,
        subagentSessions: subtree.sessions,
        missingSessions: subtree.missing,
      },
      pricing: {
        basis: 'published-list-price',
        source: 'https://opencode.ai/inference/go/v1/models',
        peakNote:
          'deepseek: weekdays 01:00-04:00 & 06:00-10:00 UTC; gemini-4-argon: x2 from 2026-12-01',
      },
      generatedAt: Date.now(),
    }
  }

  /**
   * Answer the current Go usage, reusing one cached read inside its TTL and
   * one failure inside its wait.
   * @param force - ignore both caches for this call.
   * @returns the wire snapshot the Client half renders.
   */
  async function readUsage(force: boolean): Promise<UsageSnapshot> {
    const now = Date.now()
    const gate = readGate({
      force,
      hasGood: lastGoodUsage !== null,
      ageMs: now - usageFetchedAt,
      ttlMs: settings.ttlMs,
      retryAt: usageRetryAt,
      now,
      inflight: usageInflight !== null,
    })
    if (gate === 'cached') return usageSnapshot('ok')
    // `?force` never duplicates a read: the running promise is joined, and its
    // result — including a cached-at-start answer — is what the caller sees.
    if (gate === 'inflight') return usageInflight as Promise<UsageSnapshot>
    if (gate === 'backoff') return usageSnapshot('error', lastUsageError ?? undefined)

    const run = (async (): Promise<UsageSnapshot> => {
      try {
        const key = await resolveApiKey()
        if (key === undefined) return usageSnapshot('unconfigured')
        const answer = await requestUsage(settings.baseUrl, key)
        if (answer.kind === 'ok') {
          lastGoodUsage = answer.usage
          usageFetchedAt = Date.now()
          usageFailures = 0
          usageRetryAt = 0
          lastUsageError = null
          return usageSnapshot('ok')
        }
        recordUsageFailure(answer.error)
        return usageSnapshot('error', answer.error)
      } catch (error) {
        const failure: WireError = { code: 'request-failed', message: messageOf(error) }
        recordUsageFailure(failure)
        return usageSnapshot('error', failure)
      } finally {
        usageInflight = null
      }
    })()
    usageInflight = run
    return run
  }

  /**
   * Remember one failed usage read and how long it suppresses the next
   * unforced attempt.
   * @param failure - the attempt's typed failure.
   */
  function recordUsageFailure(failure: WireError): void {
    usageFailures += 1
    lastUsageError = failure
    usageRetryAt =
      Date.now() +
      backoffDelayMs(usageFailures, failure.retryAfterSeconds, settings.ttlMs)
  }

  /**
   * Compose the usage wire value; `error` accompanies a failed attempt that may
   * still carry `lastGood`.
   * @param state - the attempt's outcome.
   * @param error - the typed failure, when the attempt failed.
   * @returns the JSON snapshot.
   */
  function usageSnapshot(
    state: 'ok' | 'error' | 'unconfigured',
    error?: WireError,
  ): UsageSnapshot {
    return {
      state,
      apiKeyEnv: settings.apiKeyEnv,
      fetchedAt: usageFetchedAt === 0 ? null : usageFetchedAt,
      stale: state === 'error' && lastGoodUsage !== null,
      usage: lastGoodUsage,
      error: error ?? null,
    }
  }

  /**
   * Answer the free-model watch. A `?ack` query folds the currently reported
   * new models into the baseline, which the Client half does when the panel
   * with the free list becomes visible.
   * @param force - refetch even inside the TTL.
   * @param ack - also clear the pending new-model list.
   * @returns the JSON snapshot.
   */
  async function readFreeModels(force: boolean, ack: boolean): Promise<FreeSnapshot> {
    if (ack && freeState.newFree.length > 0) freeState = { ...freeState, newFree: [] }
    if (!force && freeState.last !== null && Date.now() - freeFetchedAt < settings.freeTtlMs) {
      return freeSnapshot('ok')
    }
    if (freeInflight !== null) return freeInflight
    const run = (async (): Promise<FreeSnapshot> => {
      try {
        const answer = await requestFreeModels(settings.baseUrl, settings.watchModels)
        if (answer.kind === 'ok') {
          const now = Date.now()
          freeState = applyFreeReading(
            freeState,
            { models: answer.models, watched: answer.watched },
            now,
          )
          freeFetchedAt = now
          return freeSnapshot('ok')
        }
        return freeSnapshot('error', answer.error)
      } catch (error) {
        return freeSnapshot('error', {
          code: 'request-failed',
          message: messageOf(error),
        })
      } finally {
        freeInflight = null
      }
    })()
    freeInflight = run
    return run
  }

  /**
   * Compose the free-model wire value. A failed attempt keeps the last good
   * list and stamps it `stale`, so the chip keeps naming what it knows.
   * @param state - the attempt's outcome.
   * @param error - the typed failure, when the attempt failed.
   * @returns the JSON snapshot.
   */
  function freeSnapshot(state: 'ok' | 'error', error?: WireError): FreeSnapshot {
    const last = freeState.last
    const free: FreeModelWire[] =
      last === null
        ? []
        : last.models.map((model) => ({
            ...model,
            since: last.firstSeen[model.id] ?? null,
          }))
    return {
      state,
      fetchedAt: last === null ? null : last.at,
      stale: state === 'error' && last !== null,
      free,
      watched: last?.watched ?? [],
      history: freeState.history,
      newFree: freeState.newFree,
      error: error ?? null,
    }
  }

  /**
   * Resolve the Go API key from the credential store, then from the launch
   * environment (process, project `.env`, user `.env` — the same chain the
   * OpenCode Go adapter uses), and finally from the ambient process
   * environment. Resolution is per call, so a rotated key reaches the next
   * poll without a restart.
   * @returns the key, or undefined while unconfigured.
   */
  async function resolveApiKey(): Promise<string | undefined> {
    const credentials = ctx.get('credentials') as
      | { resolve(name: string): Promise<{ value: string } | undefined> }
      | undefined
    if (credentials !== undefined && credentials !== null) {
      try {
        const resolved = await credentials.resolve(settings.apiKeyEnv)
        const value = nonEmpty(resolved?.value)
        if (value !== undefined) return value
      } catch {
        // A credential-store failure falls through to the environment layers.
      }
    }
    const launch = ctx.get('launchEnvironment') as
      | { get?(name: string): { value: string } | undefined }
      | undefined
    const hit = typeof launch?.get === 'function' ? launch.get(settings.apiKeyEnv) : undefined
    const launched = nonEmpty(hit?.value)
    if (launched !== undefined) return launched
    return nonEmpty(process.env[settings.apiKeyEnv])
  }
}
