/**
 * Host half of the OpenCode Go quota chips.
 *
 * The browser half cannot read OpenCode itself: the Go usage endpoint needs the
 * account API key in an Authorization header, and that key lives only in the
 * Host credential store. This half resolves the key, polls the documented
 * `GET /zen/go/v1/usage` endpoint behind one shared cache, and answers the
 * browser half over an exact Connection Fetch route.
 *
 * A second route watches the public Go models list for limited-time free
 * models. The list needs no key, but the Host half diffs it so the browser sees
 * a stable "which free models are new since last time" answer even across page
 * reloads, and the polling of one profile stays bounded regardless of how many
 * open pages ask.
 *
 * A host-only Session projection folds the durable event log once per new
 * event: it attributes every provider-reported usage record to the route that
 * produced it, so an OpenCode Go allowance is never charged for another
 * provider's tokens and a mixed-model Session is still counted in full. The
 * third route serves that projection's current value plus live subagent
 * Sessions. Compaction summaries carry their own provider/model/usage and are
 * included; title generation logs its route but not its tokens, so it is
 * reported separately instead of guessed.
 *
 * @module @local/opencode-go-quota
 */

/** Documented Go usage endpoint; Bearer-authenticated by the Go API key. */
const USAGE_PATH = '/zen/go/v1/usage'

/** Public models list for the free-model watcher; needs no key. */
const MODELS_PATH = '/inference/go/v1/models'

/** Exact Fetch routes below the authenticated carrier channel. */
const USAGE_ROUTE_PATH = '/api/opencode-go-quota/usage'
const SESSION_ROUTE_PATH = '/api/opencode-go-quota/session'
const FREE_ROUTE_PATH = '/api/opencode-go-quota/free'

/** The usage endpoint's own cadence is unknown; keep one read per minute. */
const MIN_REFRESH_SECONDS = 60

/** The free-model watcher polls the public list at most this often. */
const MIN_FREE_REFRESH_SECONDS = 300

/** A hung upstream read must not pin the rest of the polling loop. */
const REQUEST_TIMEOUT_MS = 15_000

const DEFAULTS = {
  apiKeyEnv: 'OPENCODE_API_KEY',
  baseUrl: 'https://opencode.ai',
  refreshSeconds: 60,
  freeRefreshSeconds: 600,
  provider: 'opencode-go',
}

/**
 * Published OpenCode Go token prices, USD per million tokens
 * (`https://opencode.ai/inference/go/v1/models`). A profile may override or
 * extend this table through the row's `prices` config. `tiers` hold the
 * documented long-context overrides, selected on
 * input + cache-read + cache-write tokens. `peakHours`/`peakFrom` hold the
 * published time multipliers, which only some models carry.
 */
const WEEKDAY_WINDOWS = Object.freeze([
  { days: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
  { days: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
])

const MODEL_PRICES = Object.freeze({
  'beam-free': flatPrice(0, 0, 0),
  'claude-haiku-5-5': tieredPrice(
    { input: 0.1, cached: 0.01, output: 0.5 },
    [{ overTokens: 100_000, input: 0.5, cached: 0.05, output: 2.5 }],
  ),
  'deepseek-v4.1-flash': peakedPrice(0.15, 0.003, 0.6, WEEKDAY_WINDOWS),
  'deepseek-v4-pro': peakedPrice(0.66, 0.022, 1.98, WEEKDAY_WINDOWS),
  'gemini-4-argon': datedPrice(2, 0.1, 10, '2026-12-01'),
  'glm-5.2': flatPrice(1.4, 0.26, 4.4),
  'glm-5.3': flatPrice(1.4, 0.26, 4.4),
  'glm-5.3-flash': flatPrice(0.15, 0.03, 0.5),
  'grok-4.7': tieredPrice(
    { input: 2, cached: 0.5, output: 6 },
    [{ overTokens: 200_000, input: 4, cached: 1, output: 12 }],
  ),
  'gpt-5.6-luna': tieredPrice(
    { input: 0.2, cached: 0.02, output: 1.2 },
    [{ overTokens: 272_000, input: 0.4, cached: 0.04, output: 1.8 }],
  ),
  'gpt-6-luna': tieredPrice(
    { input: 0.1, cached: 0.01, output: 0.5 },
    [{ overTokens: 272_000, input: 0.2, cached: 0.02, output: 0.75 }],
  ),
  'hy3': flatPrice(0.14, 0.035, 0.58),
  'hy4': flatPrice(0.834, 0.042, 2.501),
  'hy4-preview': flatPrice(0.834, 0.042, 2.501),
  'hy4-flash-free': flatPrice(0, 0, 0),
  'iceman-contributor-free': flatPrice(0, 0, 0),
  'kimi-k2.7-code': flatPrice(0.95, 0.19, 4),
  'kimi-k3': flatPrice(3, 0.3, 15),
  'kimi-k3.1-pro': flatPrice(2, 0.2, 10),
  'longcat-2.0': flatPrice(0.3, 0.006, 1.2),
  'longcat-2.5-free': flatPrice(0, 0, 0),
  'mimo-v2.6-flash': flatPrice(0.14, 0.0028, 0.28),
  'mimo-v2.6-pro': flatPrice(0.435, 0.0036, 0.87),
  'minimax-m3': tieredPrice(
    { input: 0.3, cached: 0.06, output: 1.2 },
    [{ overTokens: 512_000, input: 0.6, cached: 0.12, output: 2.4 }],
  ),
  'minimax-m3.1-flash': flatPrice(0.15, 0.015, 0.6),
  'muse-spark-1.2-contributor': flatPrice(0.1, 0.002, 0.2),
  'muse-spark-1.3-contributor': flatPrice(0.1, 0.002, 0.2),
  'qwen3.7-plus': tieredPrice(
    { input: 0.4, cached: 0.04, output: 1.6 },
    [{ overTokens: 256_000, input: 1.2, cached: 0.12, output: 4.8 }],
  ),
  'qwen3.8-flash': flatPrice(0.15, 0.016, 0.47),
  'qwen3.8-max': flatPrice(2, 0.25, 6),
  'qwen4-max': flatPrice(1.5, 0.075, 4.5),
  'step-5-preview': flatPrice(1, 0.1, 2.7),
})

/**
 * DeepSeek models double their token price on weekdays inside the two
 * published UTC windows, 01:00–04:00 and 06:00–10:00.
 */

/** Hard dependency: the answers travel over the Connection carrier's route registry and read live Sessions. */
export const inject = ['connection', 'sessions', 'sessionProjections']

/**
 * Host plugin body.
 * @param ctx - owning plugin context.
 * @param config - the row's config: credential reference, base URLs, cache
 * windows, provider id, and optional price overrides.
 */
export async function apply(ctx, config) {
  const options = config !== null && typeof config === 'object' ? config : {}
  const apiKeyEnv = nonEmpty(options.apiKeyEnv) ?? DEFAULTS.apiKeyEnv
  const baseUrl = (nonEmpty(options.baseUrl) ?? DEFAULTS.baseUrl).replace(/\/+$/, '')
  const refreshSeconds = boundedNumber(options.refreshSeconds, MIN_REFRESH_SECONDS, DEFAULTS.refreshSeconds)
  const freeRefreshSeconds = boundedNumber(options.freeRefreshSeconds, MIN_FREE_REFRESH_SECONDS, DEFAULTS.freeRefreshSeconds)
  const ttlMs = refreshSeconds * 1_000
  const freeTtlMs = freeRefreshSeconds * 1_000
  const provider = (nonEmpty(options.provider) ?? DEFAULTS.provider).toLowerCase()
  const prices = mergePriceOverrides(MODEL_PRICES, options.prices)

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
    apply: (state, event) => applyUsageEvent(state, event, { provider, prices }),
  })

  /** Last successful usage reading, kept across failures so a chip can render it as stale. */
  let lastGoodUsage = null
  let usageFetchedAt = 0
  let usageInflight = null

  /** Free-model watcher state: the ids seen at the last successful read. */
  let freeState = { free: [], newFree: [], checkedAt: 0, seenIds: [], fetchedOnce: false }
  let freeFetchedAt = 0
  let freeInflight = null

  ctx.effect(() => ctx.connection.fetch.register({
    path: USAGE_ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const force = new URL(request.url).searchParams.has('force')
      return Response.json(await readUsage(force), {
        headers: { 'cache-control': 'no-store' },
      })
    },
  }), 'opencode-go-quota: usage route')

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
  }), 'opencode-go-quota: session usage route')

  ctx.effect(() => ctx.connection.fetch.register({
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
  }), 'opencode-go-quota: free models route')

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
        source: 'https://opencode.ai/inference/go/v1/models',
        peakNote: 'deepseek: weekdays 01:00-04:00 & 06:00-10:00 UTC; gemini-4-argon: x2 from 2026-12-01',
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
   * Answer the current Go usage, reusing one cached read inside its TTL.
   * @param force - ignore the cached reading for this call.
   * @returns the wire snapshot the Client half renders.
   */
  async function readUsage(force) {
    if (!force && lastGoodUsage !== null && Date.now() - usageFetchedAt < ttlMs) return usageSnapshot('ok')
    if (usageInflight !== null) return usageInflight
    usageInflight = (async () => {
      try {
        const key = await resolveApiKey()
        if (key === undefined) return usageSnapshot('unconfigured')
        const answer = await requestUsage(key)
        if (answer.kind === 'ok') {
          lastGoodUsage = answer.usage
          usageFetchedAt = Date.now()
          return usageSnapshot('ok')
        }
        return usageSnapshot('error', answer.error)
      } catch (error) {
        return usageSnapshot('error', {
          code: 'request-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        usageInflight = null
      }
    })()
    return usageInflight
  }

  /**
   * Compose the usage wire value; `error` accompanies a failed attempt that may still carry `lastGood`.
   * @param state - the attempt's outcome.
   * @param error - the typed failure, when the attempt failed.
   * @returns the JSON snapshot.
   */
  function usageSnapshot(state, error) {
    return {
      state,
      apiKeyEnv,
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
  async function readFreeModels(force, ack) {
    if (ack) freeState = { ...freeState, newFree: [] }
    if (!force && freeState.fetchedOnce && Date.now() - freeFetchedAt < freeTtlMs) return freeSnapshot('ok')
    if (freeInflight !== null) return freeInflight
    freeInflight = (async () => {
      try {
        const answer = await requestFreeModels()
        if (answer.kind === 'ok') {
          const seen = new Set(freeState.seenIds)
          const fresh = freeState.fetchedOnce
            ? answer.free.filter(model => !seen.has(model.id))
            : []
          freeState = {
            free: answer.free,
            newFree: fresh,
            checkedAt: Date.now(),
            seenIds: answer.free.map(model => model.id),
            fetchedOnce: true,
          }
          freeFetchedAt = Date.now()
          return freeSnapshot('ok')
        }
        return freeSnapshot('error', answer.error)
      } catch (error) {
        return freeSnapshot('error', {
          code: 'request-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        freeInflight = null
      }
    })()
    return freeInflight
  }

  /**
   * Compose the free-model wire value; `error` accompanies a failed attempt that may still carry the last list.
   * @param state - the attempt's outcome.
   * @param error - the typed failure, when the attempt failed.
   * @returns the JSON snapshot.
   */
  function freeSnapshot(state, error) {
    return {
      state,
      fetchedAt: freeState.checkedAt === 0 ? null : freeState.checkedAt,
      stale: state === 'error' && freeState.fetchedOnce,
      free: freeState.free,
      newFree: freeState.newFree,
      error: error ?? null,
    }
  }

  /**
   * Resolve the Go API key from the credential store, then from the ambient environment.
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
   * Perform one authenticated Go usage read and normalize the answer.
   * @param key - OpenCode Go API key.
   * @returns a normalized usage, or a typed failure.
   */
  async function requestUsage(key) {
    let response
    try {
      response = await fetch(`${baseUrl}${USAGE_PATH}`, {
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
      return { kind: 'error', error: { code: 'invalid-json', message: 'usage response was not JSON' } }
    }
    return normalizeUsage(data)
  }

  /**
   * Read the public Go models list and extract the limited-time free models.
   * A model is free when its published input and output token prices are both
   * zero; that is exactly how the list marks the `* Free` models, and such
   * models also carry no Go monthly usage.
   * @returns the free models, or a typed failure.
   */
  async function requestFreeModels() {
    let response
    try {
      response = await fetch(`${baseUrl}${MODELS_PATH}`, {
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
    let data
    try {
      data = await response.json()
    } catch {
      return { kind: 'error', error: { code: 'invalid-json', message: 'models response was not JSON' } }
    }
    const rows = Array.isArray(data?.data) ? data.data : []
    if (rows.length === 0) {
      return { kind: 'error', error: { code: 'unexpected-shape', message: 'models response carried no entries' } }
    }
    const free = rows
      .filter(isFreeModel)
      .map(model => ({
        id: text(model.id),
        name: nonEmpty(model.name) ?? text(model.id),
        description: nonEmpty(model.description) ?? null,
        limitedRegions: model.go?.limited_regions === true,
        training: model.go?.training === true,
      }))
      .filter(model => model.id !== '')
      .sort((left, right) => left.id.localeCompare(right.id))
    return { kind: 'ok', free }
  }
}

/**
 * Whether one models-list row is a limited-time free model.
 * @param model - raw models-list entry.
 * @returns true for a published zero-price chat model.
 */
function isFreeModel(model) {
  if (model === null || typeof model !== 'object') return false
  const cost = model.cost
  if (cost === null || typeof cost !== 'object') return false
  const textCost = cost.text
  if (textCost === null || typeof textCost !== 'object') return false
  const input = textCost.input
  const output = textCost.output
  const inputPrice = input !== null && typeof input === 'object' ? input.price : undefined
  const outputPrice = output !== null && typeof output === 'object' ? output.price : undefined
  return inputPrice === 0 && outputPrice === 0
}

/** A flat published price row, USD per million tokens. */
function flatPrice(input, cached, output) {
  return Object.freeze({ input, cached, output })
}

/** A price row with long-context overrides. */
function tieredPrice(base, tiers) {
  return Object.freeze({ ...base, tiers: Object.freeze(tiers.map(tier => Object.freeze(tier))) })
}

/** A price row with an hourly multiplier on weekdays (DeepSeek models). */
function peakedPrice(input, cached, output, windows) {
  return Object.freeze({
    ...flatPrice(input, cached, output),
    peakHours: Object.freeze(windows),
  })
}

/** A price row with a date-based multiplier (Gemini 4 Argon). */
function datedPrice(input, cached, output, from) {
  return Object.freeze({ ...flatPrice(input, cached, output), peakFrom: from })
}

/**
 * Resolve the published price for a model id at one instant, including the
 * documented long-context tier and the time multipliers.
 * @param model - routed model id.
 * @param at - epoch milliseconds of the usage record.
 * @param contextTokens - input + cache-read + cache-write tokens of the record.
 * @param prices - merged price table.
 * @returns {price, peak} where `peak` marks a multiplier that applied, or undefined when unpublished.
 */
function priceFor(model, at, contextTokens, prices) {
  const key = model.trim().toLowerCase()
  if (key === '') return undefined
  const row = prices[key] ?? prices[key.split(':')[0]]
  if (row === undefined || row === null || typeof row !== 'object') return undefined
  if (!usablePrice(row)) return undefined

  let selected = row
  let peak = false
  const tiers = Array.isArray(row.tiers) ? row.tiers : []
  for (const tier of tiers) {
    if (Number.isFinite(tier.overTokens) && Number.isFinite(contextTokens) && contextTokens > tier.overTokens
      && Number.isFinite(tier.input) && Number.isFinite(tier.cached) && Number.isFinite(tier.output)) {
      selected = tier
      break
    }
  }
  if (isPeakAt(at, row)) {
    peak = true
    selected = { ...selected, input: selected.input * 2, cached: selected.cached * 2, output: selected.output * 2 }
  }
  return { price: selected, peak }
}

/**
 * Whether one instant falls inside a price row's published time multiplier.
 * @param at - epoch milliseconds.
 * @param row - price row.
 * @returns true for the documented peak windows or the peak start date.
 */
function isPeakAt(at, row) {
  if (row.peakHours !== undefined) {
    const date = new Date(at)
    const day = date.getUTCDay()
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
    for (const window of row.peakHours) {
      if (!Array.isArray(window.days) || !window.days.includes(day)) continue
      if (minute >= window.startMinute && minute < window.endMinute) return true
    }
    return false
  }
  if (typeof row.peakFrom === 'string') {
    const from = Date.parse(`${row.peakFrom}T00:00:00Z`)
    return Number.isFinite(from) && at >= from
  }
  return false
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
    throw new Error('opencode-go quota usage state was not an object')
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
    if (!isGoProvider(text(event.data?.route?.provider), config.provider)) return state
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
 * @param configuredProvider - provider id that draws on the Go allowance.
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
  const resolved = priceFor(model, at, input + cacheRead + cacheWrite, prices)
  const cost = resolved === undefined
    ? null
    : ((input + cacheWrite) * resolved.price.input
      + cacheRead * resolved.price.cached
      + output * resolved.price.output) / 1_000_000
  return {
    turn: count(event.data?.turn),
    step: count(event.data?.step),
    kind,
    provider,
    model,
    go: isGoProvider(provider, configuredProvider),
    requests: kind === 'assistant' ? 1 : 0,
    compactionRequests: kind === 'compaction' ? 1 : 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    cost,
    peak: resolved?.peak === true,
    free: resolved !== undefined && resolved.price.input === 0 && resolved.price.output === 0,
    at,
  }
}

/**
 * Whether a route id is the configured OpenCode Go provider.
 * @param providerId - routed provider id.
 * @param configuredProvider - configured provider id.
 * @returns true when the ids match case-insensitively.
 */
function isGoProvider(providerId, configuredProvider) {
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
  if (record.go) {
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
    go: record.go,
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
    peak: false,
    free: false,
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
    peak: existing.peak || record.peak === true,
    free: existing.free || record.free === true,
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
    existing.peak = existing.peak || bucket.peak === true
    existing.free = existing.free || bucket.free === true
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
      go: bucket.go === true,
      peak: bucket.peak === true,
      free: bucket.free === true,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const goModels = models.filter(model => model.go)
  const otherModels = models.filter(model => !model.go)
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
    models: goModels,
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
 * Clamp a numeric config value between a floor and a default.
 * @param value - configured value.
 * @param min - smallest accepted value.
 * @param fallback - used when the value is not a finite number.
 * @returns the clamped number.
 */
function boundedNumber(value, min, fallback) {
  const parsed = Number(value)
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback)
}

/**
 * Map the documented failure statuses to stable codes the Client half can phrase.
 * @param status - HTTP status.
 * @returns a short machine-readable code.
 */
function statusCode(status) {
  switch (status) {
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 404: return 'not-found'
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
 * Normalize the documented Go usage shapes into one display model.
 *
 * The live shape nests the three windows under `usage` with an ISO `resetsAt`;
 * the early spec shape carried flat `rollingUsage`/`weeklyUsage`/
 * `monthlyUsage` rows with `usagePercent` and `resetInSec`. Both are accepted
 * so one deploy either side of the upstream change keeps working.
 *
 * @param data - decoded response body.
 * @returns a normalized usage, or a typed failure for an unknown shape.
 */
function normalizeUsage(data) {
  const body = data !== null && typeof data === 'object' ? data : {}
  const nested = body.usage
  if (nested !== null && typeof nested === 'object') {
    const windows = []
    for (const [key, label] of Object.entries(WINDOW_LABELS)) {
      const row = nested[key]
      if (row === null || typeof row !== 'object') continue
      const percent = finite(row.percent)
      const resetsAt = nonEmpty(row.resetsAt) ?? null
      if (percent === undefined && resetsAt === null) continue
      windows.push({
        key,
        label,
        percent: percent ?? null,
        resetsAt,
        status: nonEmpty(row.status) ?? null,
      })
    }
    if (windows.length > 0) return { kind: 'ok', usage: { windows } }
  }

  const legacy = []
  for (const [key, rowKey, label] of LEGACY_WINDOWS) {
    const row = body[rowKey]
    if (row === null || typeof row !== 'object') continue
    const percent = finite(row.usagePercent)
    const resetInSec = finite(row.resetInSec)
    if (percent === undefined) continue
    legacy.push({
      key,
      label,
      percent,
      resetsAt: resetInSec !== undefined
        ? new Date(Date.now() + resetInSec * 1_000).toISOString()
        : null,
      status: null,
    })
  }
  if (legacy.length > 0) return { kind: 'ok', usage: { windows: legacy } }

  return { kind: 'error', error: { code: 'unexpected-shape', message: 'usage response carried no known window' } }
}

/** Window keys the live shape carries, in display order. */
const WINDOW_LABELS = Object.freeze({
  rolling: '5h',
  weekly: 'week',
  monthly: 'month',
})

/** Early-spec window rows: nested key → wire key → label. */
const LEGACY_WINDOWS = Object.freeze([
  ['rolling', 'rollingUsage', '5h'],
  ['weekly', 'weeklyUsage', 'week'],
  ['monthly', 'monthlyUsage', 'month'],
])

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
