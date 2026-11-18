/**
 * Host half of the Ollama Cloud quota chips.
 *
 * The browser half cannot read the balance itself: the balance endpoint needs
 * the account API key in an Authorization header, and that key lives only in
 * the Host credential store. This half resolves the key, calls the documented
 * `GET /api/balance` endpoint behind one shared cache, and answers the browser
 * half over an exact Connection Fetch route.
 *
 * The routes are registered with `ctx.connection.fetch.register`, so they live
 * below the authenticated `/api` carrier: the Host/Origin fence and the
 * browser-session check run before these handlers, and only an owner Peer
 * reaches them. Nothing here opens a new unauthenticated HTTP surface, and the
 * key never leaves the Host.
 *
 * A host-only Session projection folds the durable event log once per new
 * event ({@link ./usage.ts}); this module only owns the seam: registration,
 * the two routes, the balance cache, and the subtree walk over live children.
 *
 * @module @local/ollama-quota
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ZodType } from 'zod'

import { resolveConfig } from './config.ts'
import { requestBalance } from './upstream.ts'
import {
  applyUsageEvent,
  emptyUsageState,
  finalizeUsage,
  mergeUsageState,
  parseUsageState,
  type UsageState,
} from './usage.ts'
import type {
  Balance,
  BalanceError,
  BalanceSnapshot,
  BalanceState,
  SessionSnapshot,
  UsageSummary,
} from './wire.ts'

/** Exact Fetch route below the authenticated carrier channel. */
const ROUTE_PATH = '/api/ollama-quota/balance'

/** Exact Fetch route serving one Session's attributed usage. */
const SESSION_ROUTE_PATH = '/api/ollama-quota/session'

/**
 * Shortest interval between two forced balance reads. The endpoint allows 10
 * requests per minute per user, and the chips are cheap to mount and remount;
 * a forced read inside this window reuses the cached answer instead of
 * spending the budget.
 */
const FORCE_COOLDOWN_MS = 10_000

/** Hard dependency: the answers travel over the Connection carrier's route registry and read live Sessions. */
export const inject = ['connection', 'sessions', 'sessionProjections'] as const

/**
 * The projection seam takes a zod schema, but only ever calls `parse` on it.
 * This package validates its own plain-JSON checkpoint in `usage.ts`, and
 * adding zod as a runtime dependency for one method call is not worth it, so
 * the structural validator is cast once here.
 */
const USAGE_STATE_SCHEMA = { parse: parseUsageState } as unknown as ZodType<UsageState>

/**
 * Message of an unknown thrown value.
 * @param error - thrown value.
 * @returns the message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Trim to a non-empty string, or undefined.
 * @param value - candidate.
 * @returns the trimmed text, or undefined when empty or not a string.
 */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Host plugin body.
 * @param ctx - owning plugin context.
 * @param config - the row's config: credential reference, base URL, cache window,
 *   provider id, and optional price overrides.
 */
export async function apply(ctx: Context, config: unknown): Promise<void> {
  const options = resolveConfig(config)

  /**
   * Host-only Session projection. Keeping the fold in the projection seam makes
   * it replayable and checkpointed, and lets the route read the current value
   * instead of rescanning a durable log.
   */
  const usageProjection = await ctx.sessionProjections.register({
    key: 'ollamaQuotaUsage',
    stateVersion: 1,
    stateSchema: USAGE_STATE_SCHEMA,
    init: (_header, inheritedEventCount) => emptyUsageState(Number(inheritedEventCount) || 0),
    apply: (state, event) => applyUsageEvent(state, event, { provider: options.provider, prices: options.prices }),
  })

  /** Last successful balance, kept across failures so a chip can render it as stale. */
  let lastGood: Balance | null = null
  /** When `lastGood` was fetched, in epoch milliseconds. */
  let fetchedAt = 0
  /** One shared in-flight read, so concurrent chips cannot multiply requests. */
  let inflight: Promise<BalanceSnapshot> | null = null

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const force = new URL(request.url).searchParams.has('force')
      return Response.json(await readBalance(force), {
        headers: { 'cache-control': 'no-store' },
      })
    },
  }), 'ollama-quota: balance route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const sessionId = new URL(request.url).searchParams.get('sessionId')
      return Response.json(readSessionUsage(sessionId), {
        headers: { 'cache-control': 'no-store' },
      })
    },
  }), 'ollama-quota: session usage route')

  /**
   * Answer one Session's attributed usage from its host projection. The
   * projection owns the fold, so this route is O(new events) and reflects a
   * live child Session without waiting for the parent to append anything.
   *
   * A fold that throws must not take the route down with a 500: the chip has a
   * phrase for a failed read, and one malformed event should cost this Session's
   * figures rather than the whole panel.
   *
   * @param rawSessionId - query value naming the Session.
   * @returns the wire snapshot the Client half renders.
   */
  function readSessionUsage(rawSessionId: unknown): SessionSnapshot {
    const sessionId = nonEmpty(rawSessionId)
    if (sessionId === undefined) {
      return { state: 'invalid', provider: options.provider, generatedAt: Date.now() }
    }
    const session = ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) {
      return { state: 'missing', sessionId, provider: options.provider, generatedAt: Date.now() }
    }
    try {
      const direct = finalizeUsage(usageProjection.stateOf(session))
      const subtree = collectSubtree(session)
      return {
        state: 'ok',
        sessionId,
        provider: options.provider,
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
          source: 'https://ollama.com/pricing',
          peakWindow: 'Mon-Fri 12:00-18:00 UTC',
        },
        generatedAt: Date.now(),
      }
    } catch (error) {
      return {
        state: 'error',
        sessionId,
        provider: options.provider,
        generatedAt: Date.now(),
        error: { code: 'projection-failed', message: messageOf(error) },
      }
    }
  }

  /**
   * Aggregate the Session with every live descendant discovered through its
   * durable `subagent/catalog` projection records. Children that are not
   * mounted are counted as missing rather than silently folded into the total.
   * @param root - Session whose subtree is measured.
   * @returns the aggregate and the child/missing counts.
   */
  function collectSubtree(root: Session): { summary: UsageSummary; sessions: number; missing: number } {
    const aggregate = emptyUsageState(0)
    const visited = new Set<string>()
    const missingIds = new Set<string>()
    const queue: Session[] = [root]
    let sessions = 0
    while (queue.length > 0) {
      const session = queue.shift()
      if (session === undefined) continue
      const id = String(session.id)
      if (visited.has(id)) continue
      visited.add(id)
      if (session !== root) sessions += 1
      const state = usageProjection.stateOf(session)
      mergeUsageState(aggregate, state)
      for (const childId of state.childIds) {
        const child = ctx.sessions.get(childId as SessionId)
        if (child === undefined) {
          missingIds.add(childId)
          continue
        }
        queue.push(child)
      }
    }
    return { summary: finalizeUsage(aggregate), sessions, missing: missingIds.size }
  }

  /**
   * Answer the current balance, reusing one cached read inside its TTL.
   * @param force - ignore the cached reading for this call, unless a success
   *   landed inside {@link FORCE_COOLDOWN_MS}.
   * @returns the wire snapshot the Client half renders.
   */
  async function readBalance(force: boolean): Promise<BalanceSnapshot> {
    const now = Date.now()
    const cooling = lastGood !== null && now - fetchedAt < FORCE_COOLDOWN_MS
    const effectiveForce = force && !cooling
    if (!effectiveForce && lastGood !== null && now - fetchedAt < options.ttlMs) return snapshot('ok')
    if (inflight !== null) return inflight
    inflight = (async (): Promise<BalanceSnapshot> => {
      try {
        const key = await resolveApiKey()
        if (key === undefined) return snapshot('unconfigured')
        const answer = await requestBalance(options.baseUrl, key)
        if (answer.kind === 'ok') {
          lastGood = answer.balance
          fetchedAt = Date.now()
          return snapshot('ok')
        }
        return snapshot('error', answer.error)
      } catch (error) {
        return snapshot('error', {
          code: 'request-failed',
          message: messageOf(error),
        })
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  /**
   * Compose the wire value; `error` accompanies a failed attempt that may still carry `lastGood`.
   * @param state - the attempt's outcome.
   * @param error - the typed failure, when the attempt failed.
   * @returns the JSON snapshot.
   */
  function snapshot(state: BalanceState, error?: BalanceError): BalanceSnapshot {
    return {
      state,
      apiKeyEnv: options.apiKeyEnv,
      fetchedAt: fetchedAt === 0 ? null : fetchedAt,
      stale: state === 'error' && lastGood !== null,
      balance: lastGood,
      error: error ?? null,
    }
  }

  /**
   * Resolve the API key from the credential store, then from the ambient environment.
   * Resolution is per call, so a rotated key reaches the next poll without a restart.
   * @returns the key, or undefined while unconfigured.
   */
  async function resolveApiKey(): Promise<string | undefined> {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined && credentials !== null) {
      try {
        const resolved = await credentials.resolve(options.apiKeyEnv as CredentialRef)
        if (resolved !== undefined && nonEmpty(resolved.value) !== undefined) return resolved.value
      } catch {
        // A credential-store failure falls through to the ambient environment.
      }
    }
    return nonEmpty(process.env[options.apiKeyEnv])
  }
}
