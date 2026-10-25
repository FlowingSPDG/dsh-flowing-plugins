/**
 * Host half of the Ollama Cloud quota chips.
 *
 * The browser half cannot read the balance itself: the balance endpoint needs
 * the account API key in an Authorization header, and that key lives only in
 * the Host credential store. This half resolves the key, polls the documented
 * `GET /api/balance` endpoint behind one shared cache, and answers the browser
 * half over an exact Connection Fetch route.
 *
 * The route is registered with `ctx.connection.fetch.register`, so it lives
 * below the authenticated `/api` carrier: the Host/Origin fence and the
 * browser-session check run before this handler, and only an owner Peer reaches
 * it. Nothing here opens a new unauthenticated HTTP surface, and the key never
 * leaves the Host.
 *
 * @module @local/ollama-quota
 */

/** Documented balance endpoint; the reference is `docs.ollama.com/api/balance`. */
const BALANCE_PATH = '/api/balance'

/** Exact Fetch route below the authenticated carrier channel. */
const ROUTE_PATH = '/api/ollama-quota/balance'

/** The balance endpoint allows 10 requests per minute per user, shared across keys. */
const MIN_REFRESH_SECONDS = 60

/** A hung balance read must not pin the rest of the polling loop. */
const REQUEST_TIMEOUT_MS = 15_000

const DEFAULTS = {
  apiKeyEnv: 'OLLAMA_CLOUD_API_KEY',
  baseUrl: 'https://ollama.com',
  refreshSeconds: 60,
}

/** Hard dependency: the answer travels over the Connection carrier's route registry. */
export const inject = ['connection']

/**
 * Host plugin body.
 * @param ctx - owning plugin context.
 * @param config - the row's config: credential reference, base URL, cache window.
 */
export function apply(ctx, config) {
  const options = config !== null && typeof config === 'object' ? config : {}
  const apiKeyEnv = nonEmpty(options.apiKeyEnv) ?? DEFAULTS.apiKeyEnv
  const baseUrl = (nonEmpty(options.baseUrl) ?? DEFAULTS.baseUrl).replace(/\/+$/, '')
  const refreshSeconds = Math.max(
    MIN_REFRESH_SECONDS,
    Number.isFinite(Number(options.refreshSeconds)) ? Number(options.refreshSeconds) : DEFAULTS.refreshSeconds,
  )
  const ttlMs = refreshSeconds * 1_000

  /** Last successful balance, kept across failures so a chip can render it as stale. */
  let lastGood = null
  /** When `lastGood` was fetched, in epoch milliseconds. */
  let fetchedAt = 0
  /** One shared in-flight read, so concurrent chips cannot multiply requests. */
  let inflight = null

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

  /**
   * Answer the current balance, reusing one cached read inside its TTL.
   * @param force - ignore the cached reading for this call.
   * @returns the wire snapshot the Client half renders.
   */
  async function readBalance(force) {
    if (!force && lastGood !== null && Date.now() - fetchedAt < ttlMs) return snapshot('ok')
    if (inflight !== null) return inflight
    inflight = (async () => {
      try {
        const key = await resolveApiKey()
        if (key === undefined) return snapshot('unconfigured')
        const answer = await requestBalance(key)
        if (answer.kind === 'ok') {
          lastGood = answer.balance
          fetchedAt = Date.now()
          return snapshot('ok')
        }
        return snapshot('error', answer.error)
      } catch (error) {
        return snapshot('error', {
          code: 'request-failed',
          message: error instanceof Error ? error.message : String(error),
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
  function snapshot(state, error) {
    return {
      state,
      apiKeyEnv,
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
  async function resolveApiKey() {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined && credentials !== null) {
      try {
        const resolved = await credentials.resolve(apiKeyEnv)
        if (resolved !== undefined && nonEmpty(resolved.value) !== undefined) return resolved.value
      } catch {
        // A credential-store failure falls through to the ambient environment.
      }
    }
    return nonEmpty(process.env[apiKeyEnv])
  }

  /**
   * Perform one authenticated balance read and normalize the answer.
   * @param key - Ollama Cloud API key.
   * @returns a normalized balance, or a typed failure.
   */
  async function requestBalance(key) {
    let response
    try {
      response = await fetch(`${baseUrl}${BALANCE_PATH}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      return { kind: 'error', error: { code: 'network', message: messageOf(error) } }
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'))
      return {
        kind: 'error',
        error: {
          code: statusCode(response.status),
          message: await failureMessage(response),
          ...Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {},
        },
      }
    }
    let data
    try {
      data = await response.json()
    } catch {
      return { kind: 'error', error: { code: 'invalid-json', message: 'balance response was not JSON' } }
    }
    return normalize(data)
  }
}

/**
 * Map the documented failure statuses to stable codes the Client half can phrase.
 * @param status - HTTP status.
 * @returns a short machine-readable code.
 */
function statusCode(status) {
  switch (status) {
    case 401: return 'unauthorized'
    case 403: return 'suspended'
    case 429: return 'rate-limited'
    case 503: return 'unavailable'
    default: return `http-${String(status)}`
  }
}

/**
 * Read the endpoint's `{ error }` body when present.
 * @param response - failed response.
 * @returns the message to show, never empty.
 */
async function failureMessage(response) {
  try {
    const body = await response.json()
    const text = body !== null && typeof body === 'object' ? nonEmpty(body.error) : undefined
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
function normalize(data) {
  const body = data !== null && typeof data === 'object' ? data : {}
  const included = body.included !== null && typeof body.included === 'object' ? body.included : {}
  const purchased = body.purchased !== null && typeof body.purchased === 'object' ? body.purchased : {}
  const purchasedUsd = finite(purchased.balance_usd) ?? 0

  if (finite(included.balance_usd) !== undefined && finite(included.allowance_usd) !== undefined) {
    const period = included.period !== null && typeof included.period === 'object' ? included.period : {}
    return {
      kind: 'ok',
      balance: {
        kind: 'usd',
        includedRemainingUsd: finite(included.balance_usd),
        includedAllowanceUsd: finite(included.allowance_usd),
        purchasedUsd,
        periodFrom: nonEmpty(period.from) ?? null,
        periodUntil: nonEmpty(period.until) ?? null,
      },
    }
  }

  const session = included.session !== null && typeof included.session === 'object' ? included.session : undefined
  const weekly = included.weekly !== null && typeof included.weekly === 'object' ? included.weekly : undefined
  if (session !== undefined && weekly !== undefined
    && finite(session.remaining_percent) !== undefined && finite(weekly.remaining_percent) !== undefined) {
    return {
      kind: 'ok',
      balance: {
        kind: 'percent',
        sessionRemainingPercent: finite(session.remaining_percent),
        sessionResetsAt: nonEmpty(session.resets_at) ?? null,
        weeklyRemainingPercent: finite(weekly.remaining_percent),
        weeklyResetsAt: nonEmpty(weekly.resets_at) ?? null,
        purchasedUsd,
      },
    }
  }

  return { kind: 'error', error: { code: 'unexpected-shape', message: 'balance response carried no known balance' } }
}

/** Coerce to a finite number, or undefined. */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Trim to a non-empty string, or undefined. */
function nonEmpty(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Message of an unknown thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
