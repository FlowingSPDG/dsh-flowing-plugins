/**
 * Host half of the Ollama Cloud quota chips.
 *
 * The browser half cannot read the balance itself: the balance endpoint needs
 * the account API key in an Authorization header, and that key lives only in
 * the Host credential store. This half resolves the key, polls the documented
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
 * event: it attributes every provider-reported usage record to the route that
 * produced it, so an Ollama balance is never charged for another provider's
 * tokens and a mixed-model Session is still counted in full. The second route
 * serves that projection's current value plus live subagent Sessions. Compaction summaries carry their own
 * provider/model/usage and are included; title generation logs its route but
 * not its tokens, so it is reported separately instead of guessed.
 *
 * @module @local/ollama-quota
 */

/** Documented balance endpoint; the reference is `docs.ollama.com/api/balance`. */
const BALANCE_PATH = '/api/balance'

/** Exact Fetch route below the authenticated carrier channel. */
const ROUTE_PATH = '/api/ollama-quota/balance'

/** Exact Fetch route serving one Session's attributed usage. */
const SESSION_ROUTE_PATH = '/api/ollama-quota/session'

/** The balance endpoint allows 10 requests per minute per user, shared across keys. */
const MIN_REFRESH_SECONDS = 60

/** A hung balance read must not pin the rest of the polling loop. */
const REQUEST_TIMEOUT_MS = 15_000

const DEFAULTS = {
  apiKeyEnv: 'OLLAMA_CLOUD_API_KEY',
  baseUrl: 'https://ollama.com',
  refreshSeconds: 60,
  provider: 'ollama-cloud',
}

/**
 * Published Ollama Cloud list prices, USD per million tokens
 * (`https://ollama.com/pricing`). DeepSeek models publish a peak and an
 * off-peak row; the other rows are flat. A profile may override or extend this
 * table through the row's `prices` config.
 */
const MODEL_PRICES = Object.freeze({
  'beam': flatPrice(0.125, 0.015, 0.40),
  'deepseek-v4.1-flash': clockPrice(0.30, 0.006, 1.20, 0.15, 0.003, 0.60),
  'deepseek-v4-pro': clockPrice(1.32, 0.044, 3.96, 0.66, 0.022, 1.98),
  'gemma4': flatPrice(0.14, 0.05, 0.40),
  'glm-5.3': flatPrice(1.40, 0.26, 4.40),
  'glm-5.3-flash': flatPrice(0.15, 0.03, 0.50),
  'glm-5.2': flatPrice(1.40, 0.26, 4.40),
  'gpt-oss:120b': flatPrice(0.15, 0.014, 0.60),
  'gpt-oss:20b': flatPrice(0.07, 0.035, 0.30),
  'inkling-2-small': flatPrice(0.30, 0.03, 1.00),
  'kimi-k3.1-pro': flatPrice(2.00, 0.20, 10.00),
  'kimi-k3': flatPrice(3.00, 0.30, 15.00),
  'kimi-k2.7-code': flatPrice(0.95, 0.19, 4.00),
  'kimi-k2.6': flatPrice(0.95, 0.16, 4.00),
  'mimo-v2.6-flash': flatPrice(0.14, 0.0028, 0.28),
  'mimo-v2.6-pro': flatPrice(0.435, 0.0036, 0.87),
  'minimax-m3.1-flash': flatPrice(0.15, 0.015, 0.60),
  'minimax-m3': flatPrice(0.60, 0.12, 2.40),
  'mistral-large-4': flatPrice(0.70, 0.07, 2.10),
  'muse-spark-open': flatPrice(1.25, 0.15, 4.25),
  'nemotron-3-super': flatPrice(0.015, 0.015, 0.60),
  'nemotron-3-ultra': flatPrice(0.10, 0.10, 3.00),
})

/** Published peak window: weekdays 12:00 inclusive to 18:00 exclusive, UTC. */
const PEAK_START_HOUR = 12
const PEAK_END_HOUR = 18

/** Hard dependency: the answers travel over the Connection carrier's route registry and read live Sessions. */
export const inject = ['connection', 'sessions', 'sessionProjections']

/**
 * Host plugin body.
 * @param ctx - owning plugin context.
 * @param config - the row's config: credential reference, base URL, cache window,
 * provider id, and optional price overrides.
 */
export async function apply(ctx, config) {
  const options = config !== null && typeof config === 'object' ? config : {}
  const apiKeyEnv = nonEmpty(options.apiKeyEnv) ?? DEFAULTS.apiKeyEnv
  const baseUrl = (nonEmpty(options.baseUrl) ?? DEFAULTS.baseUrl).replace(/\/+$/, '')
  const refreshSeconds = Math.max(
    MIN_REFRESH_SECONDS,
    Number.isFinite(Number(options.refreshSeconds)) ? Number(options.refreshSeconds) : DEFAULTS.refreshSeconds,
  )
  const ttlMs = refreshSeconds * 1_000
  const provider = (nonEmpty(options.provider) ?? DEFAULTS.provider).toLowerCase()
  const prices = mergePriceOverrides(MODEL_PRICES, options.prices)
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
    apply: (state, event) => applyUsageEvent(state, event, { provider, prices }),
  })

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
   * @param rawSessionId - query value naming the Session.
   * @returns the wire snapshot the Client half renders.
   */
  function readSessionUsage(rawSessionId) {
    const sessionId = nonEmpty(rawSessionId)
    if (sessionId === undefined) {
      return { state: 'invalid', provider, generatedAt: Date.now() }
    }
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) {
      return { state: 'missing', sessionId, provider, generatedAt: Date.now() }
    }
    const direct = finalizeUsage(usageProjection.stateOf(session))
    const subtree = collectSubtree(session)
    return {
      state: 'ok',
      sessionId,
      provider,
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
  }

  /**
   * Aggregate the Session with every live descendant discovered through its
   * durable `subagent/catalog` projection records. Children that are not
   * mounted are counted as missing rather than silently folded into the total.
   * @param root - Session whose subtree is measured.
   * @returns the aggregate and the child/missing counts.
   */
  function collectSubtree(root) {
    const aggregate = emptyUsageState(0)
    const visited = new Set()
    const missingIds = new Set()
    const queue = [root]
    let sessions = 0
    while (queue.length > 0) {
      const session = queue.shift()
      const id = String(session.id)
      if (visited.has(id)) continue
      visited.add(id)
      if (session !== root) sessions += 1
      const state = usageProjection.stateOf(session)
      mergeUsageState(aggregate, state)
      for (const childId of state.childIds) {
        const child = ctx.sessions.get(childId)
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
 * A flat published price row, USD per million tokens.
 * @param input - uncached input price.
 * @param cached - cached input price.
 * @param output - output price.
 * @returns the price row.
 */
function flatPrice(input, cached, output) {
  return Object.freeze({ input, cached, output })
}

/**
 * A price row with separate peak and off-peak rates.
 * @param peakInput - peak uncached input price.
 * @param peakCached - peak cached input price.
 * @param peakOutput - peak output price.
 * @param offPeakInput - off-peak uncached input price.
 * @param offPeakCached - off-peak cached input price.
 * @param offPeakOutput - off-peak output price.
 * @returns the price row.
 */
function clockPrice(peakInput, peakCached, peakOutput, offPeakInput, offPeakCached, offPeakOutput) {
  return Object.freeze({
    peak: flatPrice(peakInput, peakCached, peakOutput),
    offPeak: flatPrice(offPeakInput, offPeakCached, offPeakOutput),
  })
}

/**
 * Resolve the published price for a model id at one instant. Tags such as
 * `:0813` are ignored, while ids that themselves contain a colon (for example
 * `gpt-oss:120b`) still match exactly first.
 * @param model - routed model id.
 * @param at - epoch milliseconds of the usage record.
 * @param prices - merged price table.
 * @returns the applicable price row, or undefined when unpublished.
 */
function priceFor(model, at, prices) {
  const key = model.trim().toLowerCase()
  if (key === '') return undefined
  const row = prices[key] ?? prices[key.split(':')[0]]
  if (row === undefined || row === null || typeof row !== 'object') return undefined
  if (row.peak !== undefined || row.offPeak !== undefined) {
    const selected = isPeakAt(at) ? row.peak : row.offPeak
    return usablePrice(selected) ? selected : undefined
  }
  return usablePrice(row) ? row : undefined
}

/**
 * Whether a price row carries every rate needed for a cost calculation.
 * @param row - candidate row.
 * @returns true for finite input/cached/output rates.
 */
function usablePrice(row) {
  return row !== null
    && typeof row === 'object'
    && Number.isFinite(row.input)
    && Number.isFinite(row.cached)
    && Number.isFinite(row.output)
}

/**
 * Whether one instant falls inside the published peak window.
 * @param at - epoch milliseconds.
 * @returns true for weekdays 12:00-18:00 UTC.
 */
function isPeakAt(at) {
  const date = new Date(at)
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  return day >= 1 && day <= 5 && hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR
}

/**
 * Merge a profile's price overrides over the published table.
 * @param base - built-in table.
 * @param overrides - optional `prices` config object.
 * @returns a new table with lower-case keys.
 */
function mergePriceOverrides(base, overrides) {
  if (overrides === null || typeof overrides !== 'object') return base
  const merged = { ...base }
  for (const [key, row] of Object.entries(overrides)) {
    const name = key.trim().toLowerCase()
    if (name === '') continue
    merged[name] = row
  }
  return merged
}

/** Numeric state fields the projection carries. */
const USAGE_STATE_NUMBERS = [
  'requests', 'compactionRequests', 'titleRequests', 'input', 'output',
  'cacheRead', 'cacheWrite', 'total', 'estimatedUsd', 'pricedRequests',
  'unpricedRequests', 'otherRequests', 'otherCompactionRequests', 'otherTokens',
]

/**
 * Create the initial immutable per-Session projection state.
 * @param ownStart - fork-inherited prefix length; events before it are skipped.
 * @param routeProvider - current routed provider, empty before the first header.
 * @param routeModel - current routed model, empty before the first header.
 * @returns a plain-JSON state.
 */
function emptyUsageState(ownStart, routeProvider = '', routeModel = '') {
  return {
    ownStart,
    routeProvider,
    routeModel,
    requests: 0,
    compactionRequests: 0,
    titleRequests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    estimatedUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    otherRequests: 0,
    otherCompactionRequests: 0,
    otherTokens: 0,
    firstAt: null,
    lastAt: null,
    childIds: [],
    buckets: {},
    last: null,
  }
}

/**
 * Validate and normalize a projection checkpoint. The seam only calls
 * `parse`, so this plain validator avoids adding a schema dependency to the
 * package while still rejecting a non-object checkpoint.
 * @param value - stored state.
 * @returns a normalized state.
 */
function parseUsageState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ollama quota usage state was not an object')
  }
  const state = emptyUsageState(Number(value.ownStart) || 0)
  for (const key of USAGE_STATE_NUMBERS) {
    if (Number.isFinite(value[key])) state[key] = value[key]
  }
  state.routeProvider = text(value.routeProvider)
  state.routeModel = text(value.routeModel)
  state.firstAt = Number.isFinite(value.firstAt) ? value.firstAt : null
  state.lastAt = Number.isFinite(value.lastAt) ? value.lastAt : null
  state.childIds = Array.isArray(value.childIds)
    ? value.childIds.filter(id => typeof id === 'string')
    : []
  state.buckets = value.buckets !== null && typeof value.buckets === 'object' && !Array.isArray(value.buckets)
    ? value.buckets
    : {}
  state.last = value.last !== null && typeof value.last === 'object' && !Array.isArray(value.last)
    ? value.last
    : null
  return state
}

/** Structural schema accepted by the projection seam (it only calls `parse`). */
const USAGE_STATE_SCHEMA = { parse: parseUsageState }

/**
 * Fold one committed Session event into the usage projection. Every update
 * returns a new state; ignored events return the same reference.
 * @param state - state covering all prior events.
 * @param event - next committed event.
 * @param config - configured provider id and merged price table.
 * @returns the next state.
 */
function applyUsageEvent(state, event, config) {
  if (event.type === 'request/header') {
    const headerConfig = event.data?.header?.config
    if (headerConfig === null || typeof headerConfig !== 'object') return state
    const routeProvider = text(headerConfig.provider)
    const routeModel = text(headerConfig.model)
    if (routeProvider === state.routeProvider && routeModel === state.routeModel) return state
    return { ...state, routeProvider, routeModel }
  }
  if (event.seq < state.ownStart) return state

  if (event.type === 'subagent/catalog') {
    const childId = nonEmpty(event.data?.childId)
    if (childId === undefined || state.childIds.includes(childId)) return state
    return { ...state, childIds: [...state.childIds, childId] }
  }

  if (event.type === 'llm/retry-started') {
    if (state.last === null) return state
    if (state.last.turn !== event.data?.turn || state.last.step !== event.data?.step) return state
    return { ...state, last: null }
  }

  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const sample = usageOf(event)
    if (sample === undefined) return state
    const turn = count(event.data?.turn)
    const step = count(event.data?.step)
    let next = state
    if (state.last !== null && state.last.turn === turn && state.last.step === step) {
      next = applyUsageRecord(next, state.last, -1)
    }
    const record = recordOf(
      event,
      state.routeProvider,
      state.routeModel,
      sample,
      'assistant',
      config.prices,
      config.provider,
    )
    next = applyUsageRecord(next, record, 1)
    return { ...next, last: record }
  }

  if (event.type === 'compaction/summary') {
    const sample = event.data?.usage
    if (sample === undefined || sample === null) return state
    const record = recordOf(
      event,
      text(event.data?.provider),
      text(event.data?.model),
      sample,
      'compaction',
      config.prices,
      config.provider,
    )
    return applyUsageRecord(state, record, 1)
  }

  if (event.type === 'session/title-llm-request') {
    if (!isOllamaProvider(text(event.data?.route?.provider), config.provider)) return state
    return { ...state, titleRequests: state.titleRequests + 1 }
  }

  return state
}

/**
 * Attribute one provider usage sample to the route that produced it.
 * @param event - durable event supplying time and identity.
 * @param providerId - routed provider.
 * @param modelId - routed model.
 * @param sample - provider-reported token usage.
 * @param kind - assistant call or compaction summary.
 * @param prices - merged price table.
 * @param configuredProvider - provider id that draws on the Ollama balance.
 * @returns one signed-addable record.
 */
function recordOf(event, providerId, modelId, sample, kind, prices, configuredProvider) {
  const input = count(sample.inputTokens)
  const output = count(sample.outputTokens)
  const cacheRead = count(sample.cacheReadTokens)
  const cacheWrite = count(sample.cacheWriteTokens)
  const at = Number.isFinite(event.time) ? event.time : Date.now()
  const provider = providerId === '' ? 'unknown' : providerId
  const model = modelId === '' ? 'unknown' : modelId
  const price = priceFor(model, at, prices)
  const cost = price === undefined
    ? null
    : ((input + cacheWrite) * price.input
      + cacheRead * price.cached
      + output * price.output) / 1_000_000
  return {
    turn: count(event.data?.turn),
    step: count(event.data?.step),
    kind,
    provider,
    model,
    ollama: isOllamaProvider(provider, configuredProvider),
    requests: kind === 'assistant' ? 1 : 0,
    compactionRequests: kind === 'compaction' ? 1 : 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    cost,
    at,
  }
}

/**
 * Whether a route id is the configured Ollama Cloud provider.
 * @param providerId - routed provider id.
 * @param configuredProvider - configured provider id.
 * @returns true when the ids match case-insensitively.
 */
function isOllamaProvider(providerId, configuredProvider) {
  return typeof providerId === 'string' && providerId.toLowerCase() === configuredProvider
}

/**
 * Add or subtract one record from a projection state. Substitution replaces the
 * earlier attempt's buckets in place, matching the shipped token-usage fold.
 * @param state - current projection state.
 * @param record - signed record.
 * @param sign - `1` to add, `-1` to replace away.
 * @returns the next state.
 */
function applyUsageRecord(state, record, sign) {
  const next = {
    ...state,
    buckets: { ...state.buckets },
  }
  if (record.ollama) {
    next.requests = state.requests + sign * record.requests
    next.compactionRequests = state.compactionRequests + sign * record.compactionRequests
    next.input = state.input + sign * record.input
    next.output = state.output + sign * record.output
    next.cacheRead = state.cacheRead + sign * record.cacheRead
    next.cacheWrite = state.cacheWrite + sign * record.cacheWrite
    next.total = state.total + sign * record.total
    next.estimatedUsd = state.estimatedUsd + sign * (record.cost ?? 0)
    next.pricedRequests = state.pricedRequests + sign * (record.cost === null ? 0 : 1)
    next.unpricedRequests = state.unpricedRequests + sign * (record.cost === null ? 1 : 0)
    if (sign > 0) {
      next.firstAt = state.firstAt === null || record.at < state.firstAt ? record.at : state.firstAt
      next.lastAt = state.lastAt === null || record.at > state.lastAt ? record.at : state.lastAt
    }
  } else {
    next.otherRequests = state.otherRequests + sign * record.requests
    next.otherCompactionRequests = state.otherCompactionRequests + sign * record.compactionRequests
    next.otherTokens = state.otherTokens + sign * record.total
  }

  const key = `${record.provider}\u0000${record.model}`
  const existing = state.buckets[key] ?? {
    provider: record.provider,
    model: record.model,
    ollama: record.ollama,
    requests: 0,
    compactionRequests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    estimatedUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
  }
  next.buckets[key] = {
    ...existing,
    requests: existing.requests + sign * record.requests,
    compactionRequests: existing.compactionRequests + sign * record.compactionRequests,
    input: existing.input + sign * record.input,
    output: existing.output + sign * record.output,
    cacheRead: existing.cacheRead + sign * record.cacheRead,
    cacheWrite: existing.cacheWrite + sign * record.cacheWrite,
    total: existing.total + sign * record.total,
    estimatedUsd: existing.estimatedUsd + sign * (record.cost ?? 0),
    pricedRequests: existing.pricedRequests + sign * (record.cost === null ? 0 : 1),
    unpricedRequests: existing.unpricedRequests + sign * (record.cost === null ? 1 : 0),
  }
  return next
}

/**
 * Fold a measured projection state into an accumulator (subtree aggregation).
 * @param target - mutable accumulator receiving the values.
 * @param source - projection state.
 */
function mergeUsageState(target, source) {
  target.requests += source.requests
  target.compactionRequests += source.compactionRequests
  target.titleRequests += source.titleRequests
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.total += source.total
  target.estimatedUsd += source.estimatedUsd
  target.pricedRequests += source.pricedRequests
  target.unpricedRequests += source.unpricedRequests
  target.otherRequests += source.otherRequests
  target.otherCompactionRequests += source.otherCompactionRequests
  target.otherTokens += source.otherTokens
  if (source.firstAt !== null && (target.firstAt === null || source.firstAt < target.firstAt)) {
    target.firstAt = source.firstAt
  }
  if (source.lastAt !== null && (target.lastAt === null || source.lastAt > target.lastAt)) {
    target.lastAt = source.lastAt
  }
  for (const childId of source.childIds) {
    if (!target.childIds.includes(childId)) target.childIds.push(childId)
  }
  for (const [key, bucket] of Object.entries(source.buckets)) {
    const existing = target.buckets[key]
    if (existing === undefined) {
      target.buckets[key] = { ...bucket }
      continue
    }
    existing.requests += bucket.requests
    existing.compactionRequests += bucket.compactionRequests
    existing.input += bucket.input
    existing.output += bucket.output
    existing.cacheRead += bucket.cacheRead
    existing.cacheWrite += bucket.cacheWrite
    existing.total += bucket.total
    existing.estimatedUsd += bucket.estimatedUsd
    existing.pricedRequests += bucket.pricedRequests
    existing.unpricedRequests += bucket.unpricedRequests
  }
}

/**
 * Freeze one projection state into the JSON shape the Client half reads. All
 * counts are clamped at zero, because a retry substitution can subtract an
 * attempt whose numbers were rounded on the wire.
 * @param usage - projection state or merged accumulator.
 * @returns the wire summary.
 */
function finalizeUsage(usage) {
  const models = Object.values(usage.buckets)
    .map(bucket => ({
      provider: bucket.provider,
      model: bucket.model,
      requests: count(bucket.requests),
      compactionRequests: count(bucket.compactionRequests),
      inputTokens: count(bucket.input),
      outputTokens: count(bucket.output),
      cacheReadTokens: count(bucket.cacheRead),
      cacheWriteTokens: count(bucket.cacheWrite),
      totalTokens: count(bucket.total),
      estimatedUsd: Math.max(0, roundUsd(Number.isFinite(bucket.estimatedUsd) ? bucket.estimatedUsd : 0)),
      priced: count(bucket.pricedRequests) > 0,
      unpricedRequests: count(bucket.unpricedRequests),
      ollama: bucket.ollama === true,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const ollamaModels = models.filter(model => model.ollama)
  const otherModels = models.filter(model => !model.ollama)
  const pricedRequests = count(usage.pricedRequests)
  const unpricedRequests = count(usage.unpricedRequests)
  const requests = count(usage.requests)
  const compactionRequests = count(usage.compactionRequests)
  return {
    requests,
    compactionRequests,
    titleRequests: count(usage.titleRequests),
    inputTokens: count(usage.input),
    outputTokens: count(usage.output),
    cacheReadTokens: count(usage.cacheRead),
    cacheWriteTokens: count(usage.cacheWrite),
    totalTokens: count(usage.total),
    estimatedUsd: pricedRequests === 0 && requests + compactionRequests > 0
      ? null
      : Math.max(0, roundUsd(Number.isFinite(usage.estimatedUsd) ? usage.estimatedUsd : 0)),
    pricedRequests,
    unpricedRequests,
    firstAt: Number.isFinite(usage.firstAt) ? usage.firstAt : null,
    lastAt: Number.isFinite(usage.lastAt) ? usage.lastAt : null,
    models: ollamaModels,
    otherModels,
    otherRequests: count(usage.otherRequests),
    otherCompactionRequests: count(usage.otherCompactionRequests),
    otherTokens: count(usage.otherTokens),
    forked: Number(usage.ownStart) > 0,
    inheritedEventCount: Number(usage.ownStart) || 0,
  }
}

/** Round a USD amount to six decimals so tiny sessions keep a nonzero figure. */
function roundUsd(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Read one settlement's usage: the durable field on a message, or the last raw
 * usage chunk on a message/attempt stream.
 * @param event - assistant event.
 * @returns provider usage, or undefined when the adapter reported none.
 */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage !== undefined && event.data.usage !== null) {
    return event.data.usage
  }
  const stream = event.data?.stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/** Coerce a token counter to a non-negative finite integer. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Coerce a value to a string without inventing content. */
function text(value) {
  return typeof value === 'string' ? value : ''
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
