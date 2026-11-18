/**
 * The one authenticated upstream read behind the chip: the documented
 * `GET /api/balance` call and the normalization of its two published shapes.
 *
 * The endpoint needs the account key in an `Authorization` header, so this
 * module never runs in the browser. It performs exactly one attempt — the Host
 * cache in the plugin body owns retry pacing — and reports every failure as a
 * typed value instead of throwing.
 *
 * @module @local/ollama-quota/upstream
 */

import type { Balance, BalanceError, BalanceErrorCode } from './wire.ts'

/** Documented balance endpoint; the reference is `docs.ollama.com/api/balance`. */
const BALANCE_PATH = '/api/balance'

/** A hung balance read must not pin the rest of the polling loop. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * A `retry-after` value that names whole or fractional seconds. An HTTP-date
 * form is deliberately not parsed: the chip reports a countdown, and guessing
 * between "seconds from now" and an absolute moment is worse than reporting
 * nothing.
 */
const RETRY_AFTER_SECONDS = /^\s*\d+(?:\.\d+)?\s*$/

/** Successful read. */
export interface BalanceReadOk {
  kind: 'ok'
  balance: Balance
}

/** Failed read, with the code the browser half phrases. */
export interface BalanceReadError {
  kind: 'error'
  error: BalanceError
}

/** Outcome of one upstream attempt. */
export type BalanceRead = BalanceReadOk | BalanceReadError

/**
 * Narrow an untrusted value to a plain record.
 * @param value - candidate.
 * @returns the record, or undefined.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Coerce to a finite number, or undefined.
 * @param value - candidate.
 * @returns the number, or undefined.
 */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
 * Message of an unknown thrown value.
 * @param error - thrown value.
 * @returns the message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Parse a `retry-after` header value.
 *
 * Only the seconds form is honoured (`120`, ` 1.5 `); the HTTP-date form
 * (`Wed, 21 Oct 2015 07:28:00 GMT`) yields undefined, and so does any
 * non-positive or malformed value.
 *
 * @param header - raw header value, or null when absent.
 * @returns the delay in seconds, or undefined.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (typeof header !== 'string' || !RETRY_AFTER_SECONDS.test(header)) return undefined
  const seconds = Number(header.trim())
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

/**
 * Map the documented failure statuses to stable codes the Client half can phrase.
 * @param status - HTTP status.
 * @returns a short machine-readable code.
 */
export function statusCode(status: number): BalanceErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 403:
      return 'suspended'
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
    const text = isRecord(body) ? nonEmpty(body['error']) : undefined
    if (text !== undefined) return text
  } catch {
    // A non-JSON failure body keeps the status text.
  }
  return `HTTP ${String(response.status)}`
}

/**
 * Normalize the documented balance shapes into one display model.
 * @param data - decoded response body.
 * @returns a normalized balance, or a typed failure for an unknown shape.
 */
export function normalizeBalance(data: unknown): BalanceRead {
  const body = isRecord(data) ? data : {}
  const included = isRecord(body['included']) ? body['included'] : {}
  const purchased = isRecord(body['purchased']) ? body['purchased'] : {}
  const purchasedUsd = finite(purchased['balance_usd']) ?? 0

  const remainingUsd = finite(included['balance_usd'])
  const allowanceUsd = finite(included['allowance_usd'])
  if (remainingUsd !== undefined && allowanceUsd !== undefined) {
    const period = isRecord(included['period']) ? included['period'] : {}
    return {
      kind: 'ok',
      balance: {
        kind: 'usd',
        includedRemainingUsd: remainingUsd,
        includedAllowanceUsd: allowanceUsd,
        purchasedUsd,
        periodFrom: nonEmpty(period['from']) ?? null,
        periodUntil: nonEmpty(period['until']) ?? null,
      },
    }
  }

  const session = isRecord(included['session']) ? included['session'] : undefined
  const weekly = isRecord(included['weekly']) ? included['weekly'] : undefined
  if (session !== undefined && weekly !== undefined) {
    const sessionPercent = finite(session['remaining_percent'])
    const weeklyPercent = finite(weekly['remaining_percent'])
    if (sessionPercent !== undefined && weeklyPercent !== undefined) {
      return {
        kind: 'ok',
        balance: {
          kind: 'percent',
          sessionRemainingPercent: sessionPercent,
          sessionResetsAt: nonEmpty(session['resets_at']) ?? null,
          weeklyRemainingPercent: weeklyPercent,
          weeklyResetsAt: nonEmpty(weekly['resets_at']) ?? null,
          purchasedUsd,
        },
      }
    }
  }

  return {
    kind: 'error',
    error: { code: 'unexpected-shape', message: 'balance response carried no known balance' },
  }
}

/**
 * Perform one authenticated balance read and normalize the answer.
 * @param baseUrl - balance endpoint base, without a trailing slash.
 * @param apiKey - Ollama Cloud API key.
 * @returns a normalized balance, or a typed failure.
 */
export async function requestBalance(baseUrl: string, apiKey: string): Promise<BalanceRead> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${BALANCE_PATH}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: 'error', error: { code: 'network', message: messageOf(error) } }
  }

  if (!response.ok) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
    return {
      kind: 'error',
      error: {
        code: statusCode(response.status),
        message: await failureMessage(response),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { kind: 'error', error: { code: 'invalid-json', message: 'balance response was not JSON' } }
  }
  return normalizeBalance(data)
}
