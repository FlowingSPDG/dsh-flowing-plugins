/**
 * Upstream reads: the authenticated Go usage endpoint, the public models list,
 * the normalization of both answers, and the Host's read gate and backoff.
 *
 * Nothing here holds state: the Host half owns the caches and hands this module
 * a fetcher, so `node --test` can drive every branch with a stub.
 *
 * @module @local/opencode-go-quota/upstream
 */

import {
  asRecord,
  finite,
  messageOf,
  nonEmpty,
  text,
  MODELS_PATH,
  REQUEST_TIMEOUT_MS,
  USAGE_PATH,
} from './config.ts'
import { collectWatched, isFreeModel, type EnrichedModel } from './free.ts'
import type { ErrorCode, FreeModelRow, UsageWindow, UsageWindows, WatchedModel, WireError } from './wire.ts'

/** A successful usage read. */
export interface UsageOk {
  kind: 'ok'
  usage: UsageWindows
}

/** A failed read of either endpoint. */
export interface UpstreamError {
  kind: 'error'
  error: WireError
}

/** The usage read's outcome. */
export type UsageAnswer = UsageOk | UpstreamError

/** A successful models-list read. */
export interface FreeAnswerOk {
  kind: 'ok'
  models: FreeModelRow[]
  watched: WatchedModel[]
}

/** The models-list read's outcome. */
export type FreeAnswer = FreeAnswerOk | UpstreamError

/** Window keys the live shape carries, in display order. */
const WINDOW_LABELS: Readonly<Record<string, string>> = Object.freeze({
  rolling: '5h',
  weekly: 'week',
  monthly: 'month',
})

/** Early-spec window rows: nested key, wire key, label. */
const LEGACY_WINDOWS: readonly (readonly [key: string, rowKey: string, label: string])[] = Object.freeze([
  Object.freeze(['rolling', 'rollingUsage', '5h'] as const),
  Object.freeze(['weekly', 'weeklyUsage', 'week'] as const),
  Object.freeze(['monthly', 'monthlyUsage', 'month'] as const),
])

/** Upper bound on the exponential failure wait, before jitter. */
const BACKOFF_MAX_MS = 15 * 60_000

/**
 * Perform one authenticated Go usage read and normalize the answer.
 * @param baseUrl - endpoint base, without a trailing slash.
 * @param key - OpenCode Go API key.
 * @param fetchImpl - fetch implementation (tests pass a stub).
 * @returns a normalized usage, or a typed failure.
 */
export async function requestUsage(
  baseUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageAnswer> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${USAGE_PATH}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: 'error', error: { code: 'network', message: messageOf(error) } }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'))
    const failure: WireError = {
      code: statusCode(response.status),
      message: await failureMessage(response),
    }
    if (Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfterSeconds = retryAfter
    return { kind: 'error', error: failure }
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { kind: 'error', error: { code: 'invalid-json', message: 'usage response was not JSON' } }
  }
  return normalizeUsage(data)
}

/**
 * Read the public Go models list and extract the limited-time free models.
 * @param baseUrl - endpoint base, without a trailing slash.
 * @param watchModels - configured watch names to resolve free status for.
 * @param fetchImpl - fetch implementation (tests pass a stub).
 * @returns the free models with watched statuses, or a typed failure.
 */
export async function requestFreeModels(
  baseUrl: string,
  watchModels: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<FreeAnswer> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${MODELS_PATH}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: 'error', error: { code: 'network', message: messageOf(error) } }
  }
  if (!response.ok) {
    return {
      kind: 'error',
      error: { code: statusCode(response.status), message: await failureMessage(response) },
    }
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { kind: 'error', error: { code: 'invalid-json', message: 'models response was not JSON' } }
  }
  const rows = modelsRows(data)
  if (rows.length === 0) {
    return {
      kind: 'error',
      error: { code: 'unexpected-shape', message: 'models response carried no entries' },
    }
  }
  const enriched = rows.map(enrichModel).filter((model) => model.id !== '')
  const models = enriched
    .filter((model) => isFreeModel(model.raw))
    .map((model): FreeModelRow => {
      const go = asRecord(model.raw['go'])
      return {
        id: model.id,
        name: model.name,
        canonical: model.canonical,
        description: nonEmpty(model.raw['description']) ?? null,
        limitedRegions: go?.['limited_regions'] === true,
        training: go?.['training'] === true,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  return { kind: 'ok', models, watched: collectWatched(enriched, watchModels) }
}

/**
 * Normalize the documented Go usage shapes into one display model.
 *
 * The live shape nests the three windows under `usage` with an ISO `resetsAt`;
 * the early spec shape carried flat `rollingUsage`/`weeklyUsage`/`monthlyUsage`
 * rows with `usagePercent` and `resetInSec`. Both are accepted so one deploy
 * either side of the upstream change keeps working.
 *
 * @param data - decoded response body.
 * @param now - epoch milliseconds used to resolve `resetInSec`.
 * @returns a normalized usage, or a typed failure for an unknown shape.
 */
export function normalizeUsage(data: unknown, now: number = Date.now()): UsageAnswer {
  const body = asRecord(data) ?? {}
  const nested = asRecord(body['usage'])
  if (nested !== undefined) {
    const windows: UsageWindow[] = []
    for (const [key, label] of Object.entries(WINDOW_LABELS)) {
      const row = asRecord(nested[key])
      if (row === undefined) continue
      const percent = finite(row['percent'])
      const resetsAt = nonEmpty(row['resetsAt']) ?? null
      if (percent === undefined && resetsAt === null) continue
      windows.push({ key, label, percent: percent ?? null, resetsAt, status: nonEmpty(row['status']) ?? null })
    }
    if (windows.length > 0) return { kind: 'ok', usage: { windows } }
  }

  const legacy: UsageWindow[] = []
  for (const [key, rowKey, label] of LEGACY_WINDOWS) {
    const row = asRecord(body[rowKey])
    if (row === undefined) continue
    const percent = finite(row['usagePercent'])
    const resetInSec = finite(row['resetInSec'])
    if (percent === undefined) continue
    legacy.push({
      key,
      label,
      percent,
      resetsAt: resetInSec !== undefined ? new Date(now + resetInSec * 1_000).toISOString() : null,
      status: null,
    })
  }
  if (legacy.length > 0) return { kind: 'ok', usage: { windows: legacy } }

  return {
    kind: 'error',
    error: { code: 'unexpected-shape', message: 'usage response carried no known window' },
  }
}

/**
 * Map the documented failure statuses to stable codes the Client half phrases.
 * @param status - HTTP status.
 * @returns a short machine-readable code.
 */
export function statusCode(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 429:
      return 'rate-limited'
    case 503:
      return 'unavailable'
    default:
      return `http-${status}`
  }
}

/**
 * Read the endpoint's `{ error }` body when present.
 * @param response - failed response.
 * @returns the message to show, never empty.
 */
export async function failureMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const message = nonEmpty(asRecord(body)?.['error'])
    if (message !== undefined) return message
  } catch {
    // A non-JSON failure body keeps the status text.
  }
  return `HTTP ${String(response.status)}`
}

/** How one read may proceed, given the caches and any failure wait. */
export type ReadGate = 'cached' | 'inflight' | 'backoff' | 'fetch'

/** The cache facts one read decision is made from. */
export interface ReadGateInput {
  /** The caller asked to bypass both caches. */
  force: boolean
  /** A successful reading exists. */
  hasGood: boolean
  /** Milliseconds since that reading was taken. */
  ageMs: number
  /** Cache window for a successful reading. */
  ttlMs: number
  /** Epoch milliseconds before which a failed read is not retried; 0 when none. */
  retryAt: number
  /** Current epoch milliseconds. */
  now: number
  /** Another read is already in flight. */
  inflight: boolean
}

/**
 * Decide how one read proceeds.
 *
 * Order is load-bearing: a fresh success answers from the cache, and a read
 * already in flight is joined rather than duplicated — including under
 * `?force`, which therefore never queues a second request behind a running one.
 * Only an unforced read honours the failure wait, so an explicit `?force` is
 * always a real attempt.
 *
 * @param input - cache facts.
 * @returns the decision.
 */
export function readGate(input: ReadGateInput): ReadGate {
  if (!input.force && input.hasGood && input.ageMs < input.ttlMs) return 'cached'
  if (input.inflight) return 'inflight'
  if (!input.force && input.retryAt > input.now) return 'backoff'
  return 'fetch'
}

/**
 * How long a failed read suppresses the next unforced attempt.
 *
 * The wait grows exponentially from the cache window and carries ±20% jitter,
 * so several profile pages do not retry in lockstep; an endpoint `retry-after`
 * wins over the computed wait because it is the server's own answer. The
 * computed wait is capped; a server-provided one is not.
 *
 * @param failures - consecutive failed attempts, counting the one just made.
 * @param retryAfterSeconds - the endpoint's `retry-after`, when sent.
 * @param baseMs - the successful cache window.
 * @param random - uniform source for the jitter (tests pass a fixed value).
 * @returns the wait in milliseconds, never below the cache window.
 */
export function backoffDelayMs(
  failures: number,
  retryAfterSeconds: number | undefined,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(failures, 8) - 1)
  const grown = Math.min(BACKOFF_MAX_MS, baseMs * 2 ** exponent)
  const sample = Math.min(1, Math.max(0, random()))
  const jittered = Math.round(grown * (0.8 + 0.4 * sample))
  const retryMs =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1_000
      : 0
  return Math.max(baseMs, retryMs, jittered)
}

/** The models-list `data` array, when the body carries one. */
function modelsRows(data: unknown): unknown[] {
  const body = asRecord(data)
  const rows = body?.['data']
  return Array.isArray(rows) ? rows : []
}

/** Normalize one raw models-list row. */
function enrichModel(raw: unknown): EnrichedModel {
  const row = asRecord(raw) ?? {}
  const id = text(row['id'])
  return {
    raw: row,
    id,
    name: nonEmpty(row['name']) ?? id,
    canonical: nonEmpty(row['canonical_id']) ?? null,
  }
}
