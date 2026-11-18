/**
 * The Host-only Session projection: a pure fold over the durable event log that
 * attributes every provider-reported usage record to the route that produced
 * it, so an OpenCode Go allowance is never charged for another provider's
 * tokens and a mixed-model Session is still counted in full.
 *
 * Everything here is synchronous and returns plain JSON, per the projection
 * seam's unit contract; a state transition that does not care about an event
 * returns the same reference so the framework can skip downstream work.
 *
 * @module @local/opencode-go-quota/projection
 */

import { asRecord, count, finite, text } from './config.ts'
import { hasFreeSuffix } from './free.ts'
import { priceFor } from './prices.ts'
import type {
  FoldEvent,
  PriceTable,
  UsageBucket,
  UsageBuckets,
  UsageModel,
  UsageRecord,
  UsageState,
  UsageSummary,
} from './wire.ts'

/** Numeric state fields a checkpoint may carry. */
const USAGE_STATE_NUMBERS = [
  'requests',
  'compactionRequests',
  'titleRequests',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'total',
  'estimatedUsd',
  'pricedRequests',
  'unpricedRequests',
  'otherRequests',
  'otherCompactionRequests',
  'otherTokens',
] as const satisfies readonly (keyof UsageState)[]

/** What the fold needs from the row's config. */
export interface FoldConfig {
  /** Lower-case provider id whose calls draw on the Go allowance. */
  provider: string
  /** Merged price table. */
  prices: PriceTable
}

/**
 * Create the initial immutable per-Session projection state.
 * @param ownStart - fork-inherited prefix length; events before it are skipped.
 * @param routeProvider - current routed provider, empty before the first header.
 * @param routeModel - current routed model, empty before the first header.
 * @returns a plain-JSON state.
 */
export function emptyUsageState(
  ownStart: number,
  routeProvider = '',
  routeModel = '',
): UsageState {
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
 * Validate and normalize a projection checkpoint.
 *
 * The seam only calls `parse`, so this plain validator stands in for the Zod
 * schema without adding a schema dependency to the package; a non-object
 * checkpoint is rejected rather than folded into a wrong total.
 *
 * @param value - stored state.
 * @returns a normalized state.
 * @throws when the stored value is not an object.
 */
export function parseUsageState(value: unknown): UsageState {
  const raw = asRecord(value)
  if (raw === undefined) {
    throw new Error('opencode-go quota usage state was not an object')
  }
  const state = emptyUsageState(Number(raw['ownStart']) || 0)
  for (const key of USAGE_STATE_NUMBERS) {
    const stored = raw[key]
    if (Number.isFinite(stored)) state[key] = stored as number
  }
  state.routeProvider = text(raw['routeProvider'])
  state.routeModel = text(raw['routeModel'])
  const firstAt = finite(raw['firstAt'])
  const lastAt = finite(raw['lastAt'])
  state.firstAt = firstAt ?? null
  state.lastAt = lastAt ?? null
  state.childIds = Array.isArray(raw['childIds'])
    ? raw['childIds'].filter((id): id is string => typeof id === 'string')
    : []
  // Bucket and record fields are plain JSON by the unit contract; the fold
  // never trusts their numbers without the readers below, so the cast is a
  // narrowing of already-validated structure rather than a leap of faith.
  const buckets = asRecord(raw['buckets'])
  state.buckets = (buckets ?? {}) as UsageBuckets
  const last = asRecord(raw['last'])
  state.last = (last ?? null) as UsageRecord | null
  return state
}

/**
 * Fold one committed Session event into the usage projection.
 * @param state - state covering all prior events.
 * @param event - next committed event.
 * @param config - configured provider id and merged price table.
 * @returns the next state; the same reference for an uninteresting event.
 */
export function applyUsageEvent(state: UsageState, event: FoldEvent, config: FoldConfig): UsageState {
  const data = asRecord(event.data)

  if (event.type === 'request/header') {
    const headerConfig = asRecord(asRecord(data?.['header'])?.['config'])
    if (headerConfig === undefined) return state
    const routeProvider = text(headerConfig['provider'])
    const routeModel = text(headerConfig['model'])
    if (routeProvider === state.routeProvider && routeModel === state.routeModel) return state
    return { ...state, routeProvider, routeModel }
  }

  if (event.seq < state.ownStart) return state

  if (event.type === 'subagent/catalog') {
    const childId = data?.['childId']
    if (typeof childId !== 'string' || childId === '' || state.childIds.includes(childId)) {
      return state
    }
    return { ...state, childIds: [...state.childIds, childId] }
  }

  if (event.type === 'llm/retry-started') {
    if (state.last === null) return state
    if (state.last.turn !== finite(data?.['turn']) || state.last.step !== finite(data?.['step'])) {
      return state
    }
    return { ...state, last: null }
  }

  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const sample = usageOf(event)
    if (sample === undefined) return state
    const turn = count(data?.['turn'])
    const step = count(data?.['step'])
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
    const sample = data?.['usage']
    if (sample === undefined || sample === null) return state
    const record = recordOf(
      event,
      text(data?.['provider']),
      text(data?.['model']),
      sample,
      'compaction',
      config.prices,
      config.provider,
    )
    return applyUsageRecord(state, record, 1)
  }

  if (event.type === 'session/title-llm-request') {
    if (!isGoProvider(text(asRecord(data?.['route'])?.['provider']), config.provider)) return state
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
export function recordOf(
  event: FoldEvent,
  providerId: string,
  modelId: string,
  sample: unknown,
  kind: 'assistant' | 'compaction',
  prices: PriceTable,
  configuredProvider: string,
): UsageRecord {
  const input = count(asRecord(sample)?.['inputTokens'])
  const output = count(asRecord(sample)?.['outputTokens'])
  const cacheRead = count(asRecord(sample)?.['cacheReadTokens'])
  const cacheWrite = count(asRecord(sample)?.['cacheWriteTokens'])
  const at = Number.isFinite(event.time) ? event.time : Date.now()
  const provider = providerId === '' ? 'unknown' : providerId
  const model = modelId === '' ? 'unknown' : modelId
  const resolved = priceFor(model, at, input + cacheRead + cacheWrite, prices)
  // A `-free` id is the published limited-time free naming convention: it
  // costs nothing against the allowance even when no list price is known.
  const freeVariant = hasFreeSuffix(model)
  const cost = freeVariant
    ? 0
    : resolved === undefined
      ? null
      : ((input + cacheWrite) * resolved.price.input +
          cacheRead * resolved.price.cached +
          output * resolved.price.output) /
        1_000_000
  const data = asRecord(event.data)
  return {
    turn: count(data?.['turn']),
    step: count(data?.['step']),
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
    peak: !freeVariant && resolved?.peak === true,
    free:
      freeVariant ||
      (resolved !== undefined && resolved.price.input === 0 && resolved.price.output === 0),
    at,
  }
}

/**
 * Whether a route id is the configured OpenCode Go provider.
 * @param providerId - routed provider id.
 * @param configuredProvider - configured provider id.
 * @returns true when the ids match case-insensitively.
 */
export function isGoProvider(providerId: string, configuredProvider: string): boolean {
  return providerId.toLowerCase() === configuredProvider
}

/**
 * Add or subtract one record from a projection state. Substitution replaces the
 * earlier attempt's buckets in place, matching the shipped token-usage fold.
 * @param state - current projection state.
 * @param record - signed record.
 * @param sign - `1` to add, `-1` to replace away.
 * @returns the next state.
 */
export function applyUsageRecord(state: UsageState, record: UsageRecord, sign: 1 | -1): UsageState {
  const next: UsageState = { ...state, buckets: { ...state.buckets } }
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
  const existing: UsageBucket = state.buckets[key] ?? {
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
    peak: existing.peak || record.peak,
    free: existing.free || record.free,
  }
  return next
}

/**
 * Fold a measured projection state into an accumulator (subtree aggregation).
 * @param target - mutable accumulator receiving the values.
 * @param source - projection state.
 */
export function mergeUsageState(target: UsageState, source: UsageState): void {
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
    existing.peak = existing.peak || bucket.peak
    existing.free = existing.free || bucket.free
  }
}

/**
 * Freeze one projection state into the JSON shape the Client half reads. All
 * counts are clamped at zero, because a retry substitution can subtract an
 * attempt whose numbers were rounded on the wire.
 * @param usage - projection state or merged accumulator.
 * @returns the wire summary.
 */
export function finalizeUsage(usage: UsageState): UsageSummary {
  const models: UsageModel[] = Object.values(usage.buckets)
    .map((bucket) => ({
      provider: bucket.provider,
      model: bucket.model,
      requests: count(bucket.requests),
      compactionRequests: count(bucket.compactionRequests),
      inputTokens: count(bucket.input),
      outputTokens: count(bucket.output),
      cacheReadTokens: count(bucket.cacheRead),
      cacheWriteTokens: count(bucket.cacheWrite),
      totalTokens: count(bucket.total),
      estimatedUsd: Math.max(
        0,
        roundUsd(Number.isFinite(bucket.estimatedUsd) ? bucket.estimatedUsd : 0),
      ),
      priced: count(bucket.pricedRequests) > 0,
      unpricedRequests: count(bucket.unpricedRequests),
      go: bucket.go,
      peak: bucket.peak,
      free: bucket.free,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const goModels = models.filter((model) => model.go)
  const otherModels = models.filter((model) => !model.go)
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
    estimatedUsd:
      pricedRequests === 0 && requests + compactionRequests > 0
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
export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** Anything the subtree walk can identify as a Session. */
export interface SubtreeNode {
  readonly id: string
}

/** The readers the subtree walk needs from the Host. */
export interface SubtreeSource<N extends SubtreeNode> {
  /** One Session's projected state (folding it if necessary). */
  stateOf(node: N): UsageState
  /** Resolve a child id named by the log. */
  get(id: string): N | undefined
}

/** One subtree measurement. */
export interface SubtreeResult {
  /** The root plus every live descendant, finalized for the wire. */
  summary: UsageSummary
  /** Live descendant Sessions folded into the aggregate. */
  sessions: number
  /** Children named by the log that are not mounted. */
  missing: number
}

/**
 * Aggregate a Session with every live descendant discovered through its
 * durable `subagent/catalog` projection records. Children that are not mounted
 * are counted as missing rather than silently folded into the total.
 * @param root - Session whose subtree is measured.
 * @param source - projection reader and Session resolver.
 * @returns the aggregate and the child/missing counts.
 */
export function collectSubtree<N extends SubtreeNode>(
  root: N,
  source: SubtreeSource<N>,
): SubtreeResult {
  const aggregate = emptyUsageState(0)
  const visited = new Set<string>()
  const missingIds = new Set<string>()
  const queue: N[] = [root]
  let sessions = 0
  while (queue.length > 0) {
    const session = queue.shift()
    if (session === undefined) break
    const id = String(session.id)
    if (visited.has(id)) continue
    visited.add(id)
    if (session !== root) sessions += 1
    const state = source.stateOf(session)
    mergeUsageState(aggregate, state)
    for (const childId of state.childIds) {
      const child = source.get(childId)
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
 * Read one settlement's usage: the durable field on a message, or the last raw
 * usage chunk on a message/attempt stream.
 * @param event - assistant event.
 * @returns provider usage, or undefined when the adapter reported none.
 */
export function usageOf(event: FoldEvent): unknown {
  const data = asRecord(event.data)
  if (event.type === 'assistant/message' && data?.['usage'] !== undefined && data['usage'] !== null) {
    return data['usage']
  }
  const stream = data?.['stream']
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = asRecord(stream[index])
    const chunk = asRecord(record?.['chunk'])
    if (record?.['type'] === 'chunk' && chunk?.['type'] === 'usage') return chunk['usage']
  }
  return undefined
}
