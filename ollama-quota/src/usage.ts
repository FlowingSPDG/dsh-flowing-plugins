/**
 * The Session usage fold behind `GET api/ollama-quota/session`.
 *
 * A host-only Session projection folds the durable event log once per new
 * event and attributes every provider-reported usage record to the route that
 * produced it, so an Ollama balance is never charged for another provider's
 * tokens and a mixed-model Session is still counted in full. This module is
 * pure: it reads no clock, no Session store, and no service, which is what
 * makes the projection replayable and the fold testable.
 *
 * Substitution semantics match the shipped token-usage fold: an
 * `assistant/message` for the same turn and step replaces the usage its
 * `assistant/attempt` already contributed instead of adding to it.
 *
 * @module @local/ollama-quota/usage
 */

import { costOf, priceFor, type PriceTable } from './prices.ts'
import type { ModelUsage, UsageSummary } from './wire.ts'

/** Which call produced one signed usage record. */
export type UsageKind = 'assistant' | 'compaction'

/** One signed-addable usage record. */
export interface UsageRecord {
  turn: number
  step: number
  kind: UsageKind
  provider: string
  model: string
  ollama: boolean
  requests: number
  compactionRequests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  /** Estimated USD for this record, or null when the model publishes no price. */
  cost: number | null
  /** Epoch milliseconds of the record. */
  at: number
}

/** One `provider\0model` accumulation bucket. */
export interface UsageBucket {
  provider: string
  model: string
  ollama: boolean
  requests: number
  compactionRequests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  estimatedUsd: number
  pricedRequests: number
  unpricedRequests: number
}

/**
 * Projection state: plain JSON only, because the projection seam checkpoints
 * it and validates it with `parseUsageState` on restore.
 */
export interface UsageState {
  /** Fork-inherited prefix length; events before it belong to the source Session. */
  ownStart: number
  /** Current routed provider, empty before the first request header. */
  routeProvider: string
  /** Current routed model, empty before the first request header. */
  routeModel: string
  requests: number
  compactionRequests: number
  titleRequests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  estimatedUsd: number
  pricedRequests: number
  unpricedRequests: number
  otherRequests: number
  otherCompactionRequests: number
  otherTokens: number
  firstAt: number | null
  lastAt: number | null
  childIds: string[]
  buckets: Record<string, UsageBucket>
  /** The record waiting to be replaced by a later message for the same step. */
  last: UsageRecord | null
}

/**
 * The envelope fields this fold reads from one committed Session event. The
 * projection seam hands a `SessionEvent`; the plugin adapter widens it once
 * (see `src/index.ts`) so this module stays independent of the event union,
 * whose members are declared by packages outside this workspace.
 */
export interface UsageEventInput {
  type: string
  seq: number
  time: number
  data?: unknown
}

/** Configured provider id and merged price table the fold needs. */
export interface FoldConfig {
  provider: string
  prices: PriceTable
}

/** Numeric state fields a checkpoint may carry. */
const NUMERIC_FIELDS = [
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
] as const

/**
 * Narrow an untrusted value to a plain record.
 * @param value - candidate.
 * @returns the record, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** Coerce a value to a string without inventing content. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Coerce a token counter to a non-negative finite number. */
export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Trim to a non-empty string, or undefined. */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Coerce to a finite number, or null. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Round a USD amount to six decimals so tiny sessions keep a nonzero figure. */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Whether a route id is the configured Ollama Cloud provider.
 * @param providerId - routed provider id.
 * @param configuredProvider - configured provider id.
 * @returns true when the ids match case-insensitively.
 */
export function isOllamaProvider(providerId: string, configuredProvider: string): boolean {
  return typeof providerId === 'string' && providerId.toLowerCase() === configuredProvider
}

/**
 * Create the initial immutable per-Session projection state.
 * @param ownStart - fork-inherited prefix length; events before it are skipped.
 * @param routeProvider - current routed provider, empty before the first header.
 * @param routeModel - current routed model, empty before the first header.
 * @returns a plain-JSON state.
 */
export function emptyUsageState(ownStart: number, routeProvider = '', routeModel = ''): UsageState {
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
 * Normalize one persisted bucket.
 * @param value - stored bucket.
 * @returns the canonical bucket, or undefined for a non-object.
 */
function normalizeBucket(value: unknown): UsageBucket | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  return {
    provider: text(record['provider']),
    model: text(record['model']),
    ollama: record['ollama'] === true,
    requests: count(record['requests']),
    compactionRequests: count(record['compactionRequests']),
    input: count(record['input']),
    output: count(record['output']),
    cacheRead: count(record['cacheRead']),
    cacheWrite: count(record['cacheWrite']),
    total: count(record['total']),
    estimatedUsd: count(record['estimatedUsd']),
    pricedRequests: count(record['pricedRequests']),
    unpricedRequests: count(record['unpricedRequests']),
  }
}

/**
 * Normalize one persisted pending record.
 * @param value - stored record.
 * @returns the canonical record, or null.
 */
function normalizeRecord(value: unknown): UsageRecord | null {
  const record = asRecord(value)
  if (record === undefined) return null
  return {
    turn: count(record['turn']),
    step: count(record['step']),
    kind: record['kind'] === 'compaction' ? 'compaction' : 'assistant',
    provider: text(record['provider']),
    model: text(record['model']),
    ollama: record['ollama'] === true,
    requests: count(record['requests']),
    compactionRequests: count(record['compactionRequests']),
    input: count(record['input']),
    output: count(record['output']),
    cacheRead: count(record['cacheRead']),
    cacheWrite: count(record['cacheWrite']),
    total: count(record['total']),
    cost: finiteOrNull(record['cost']),
    at: count(record['at']),
  }
}

/**
 * Validate and normalize a projection checkpoint.
 *
 * The seam only calls `parse`, so this plain validator avoids adding a schema
 * dependency to the package while still rejecting a non-object checkpoint and
 * canonicalizing every field, so a hand-edited or truncated checkpoint cannot
 * poison later arithmetic.
 *
 * @param value - stored state.
 * @returns a normalized state.
 */
export function parseUsageState(value: unknown): UsageState {
  const source = asRecord(value)
  if (source === undefined) throw new Error('ollama quota usage state was not an object')
  const state = emptyUsageState(Number(source['ownStart']) || 0)
  for (const key of NUMERIC_FIELDS) {
    const stored = source[key]
    if (typeof stored === 'number' && Number.isFinite(stored)) state[key] = stored
  }
  state.routeProvider = text(source['routeProvider'])
  state.routeModel = text(source['routeModel'])
  state.firstAt = finiteOrNull(source['firstAt'])
  state.lastAt = finiteOrNull(source['lastAt'])
  const childIds = source['childIds']
  state.childIds = Array.isArray(childIds) ? childIds.filter((id): id is string => typeof id === 'string') : []
  const buckets = asRecord(source['buckets'])
  if (buckets !== undefined) {
    for (const [key, bucket] of Object.entries(buckets)) {
      const normalized = normalizeBucket(bucket)
      if (normalized !== undefined) state.buckets[key] = normalized
    }
  }
  state.last = normalizeRecord(source['last'])
  return state
}

/**
 * Read one settlement's usage: the durable field on a message, or the last raw
 * usage chunk on a message/attempt stream.
 * @param event - assistant event.
 * @returns provider usage, or undefined when the adapter reported none.
 */
function usageOf(event: UsageEventInput): unknown {
  const data = asRecord(event.data)
  if (event.type === 'assistant/message' && data?.['usage'] !== undefined && data['usage'] !== null) {
    return data['usage']
  }
  const stream = data?.['stream']
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = asRecord(stream[index])
    if (record === undefined) continue
    const chunk = asRecord(record['chunk'])
    if (record['type'] === 'chunk' && chunk?.['type'] === 'usage') return chunk['usage']
  }
  return undefined
}

/**
 * Attribute one provider usage sample to the route that produced it.
 *
 * `now` is an injected clock rather than a `Date.now()` read so the fold stays
 * deterministic: a checkpoint replay and a full replay must agree.
 *
 * @param event - durable event supplying time and identity.
 * @param route - routed provider and model ids.
 * @param sample - provider-reported token usage.
 * @param kind - assistant call or compaction summary.
 * @param prices - merged price table.
 * @param configuredProvider - provider id that draws on the Ollama balance.
 * @param now - clock used when the event carries no finite time.
 * @returns one signed-addable record.
 */
export function recordOf(
  event: UsageEventInput,
  route: { provider: string; model: string },
  sample: unknown,
  kind: UsageKind,
  prices: PriceTable,
  configuredProvider: string,
  now: number,
): UsageRecord {
  const usage = asRecord(sample)
  const input = count(usage?.['inputTokens'])
  const output = count(usage?.['outputTokens'])
  const cacheRead = count(usage?.['cacheReadTokens'])
  const cacheWrite = count(usage?.['cacheWriteTokens'])
  const at = Number.isFinite(event.time) ? event.time : now
  const provider = route.provider === '' ? 'unknown' : route.provider
  const model = route.model === '' ? 'unknown' : route.model
  const price = priceFor(model, at, prices)
  const cost = price === undefined ? null : costOf(price, { input, output, cacheRead, cacheWrite })
  const data = asRecord(event.data)
  return {
    turn: count(data?.['turn']),
    step: count(data?.['step']),
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
 * Add or subtract one record from a projection state. Substitution replaces the
 * earlier attempt's buckets in place, matching the shipped token-usage fold.
 * @param state - current projection state.
 * @param record - signed record.
 * @param sign - `1` to add, `-1` to replace away.
 * @returns the next state.
 */
export function applyUsageRecord(state: UsageState, record: UsageRecord, sign: 1 | -1): UsageState {
  const next: UsageState = {
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
 * Fold one committed Session event into the usage projection. Every update
 * returns a new state; ignored events return the same reference.
 * @param state - state covering all prior events.
 * @param event - next committed event.
 * @param config - configured provider id and merged price table.
 * @returns the next state.
 */
export function applyUsageEvent(state: UsageState, event: UsageEventInput, config: FoldConfig): UsageState {
  // The routed route is tracked before the own-prefix cut: a forked Session
  // inherits its source's request headers, and the *first* child-owned call
  // must still be attributed to the route the source left selected.
  if (event.type === 'request/header') {
    const header = asRecord(asRecord(event.data)?.['header'])
    const headerConfig = asRecord(header?.['config'])
    if (headerConfig === undefined) return state
    const routeProvider = text(headerConfig['provider'])
    const routeModel = text(headerConfig['model'])
    if (routeProvider === state.routeProvider && routeModel === state.routeModel) return state
    return { ...state, routeProvider, routeModel }
  }
  if (event.seq < state.ownStart) return state

  if (event.type === 'subagent/catalog') {
    const childId = nonEmpty(asRecord(event.data)?.['childId'])
    if (childId === undefined || state.childIds.includes(childId)) return state
    return { ...state, childIds: [...state.childIds, childId] }
  }

  if (event.type === 'llm/retry-started') {
    if (state.last === null) return state
    const data = asRecord(event.data)
    if (state.last.turn !== count(data?.['turn']) || state.last.step !== count(data?.['step'])) return state
    return { ...state, last: null }
  }

  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const sample = usageOf(event)
    if (sample === undefined) return state
    const data = asRecord(event.data)
    const turn = count(data?.['turn'])
    const step = count(data?.['step'])
    let next = state
    if (state.last !== null && state.last.turn === turn && state.last.step === step) {
      next = applyUsageRecord(next, state.last, -1)
    }
    const record = recordOf(
      event,
      { provider: state.routeProvider, model: state.routeModel },
      sample,
      'assistant',
      config.prices,
      config.provider,
      event.time,
    )
    next = applyUsageRecord(next, record, 1)
    return { ...next, last: record }
  }

  if (event.type === 'compaction/summary') {
    const data = asRecord(event.data)
    const sample = data?.['usage']
    if (sample === undefined || sample === null) return state
    const record = recordOf(
      event,
      { provider: text(data?.['provider']), model: text(data?.['model']) },
      sample,
      'compaction',
      config.prices,
      config.provider,
      event.time,
    )
    return applyUsageRecord(state, record, 1)
  }

  if (event.type === 'session/title-llm-request') {
    const route = asRecord(asRecord(event.data)?.['route'])
    if (!isOllamaProvider(text(route?.['provider']), config.provider)) return state
    return { ...state, titleRequests: state.titleRequests + 1 }
  }

  return state
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
  const models: ModelUsage[] = Object.values(usage.buckets)
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
      estimatedUsd: Math.max(0, roundUsd(Number.isFinite(bucket.estimatedUsd) ? bucket.estimatedUsd : 0)),
      priced: count(bucket.pricedRequests) > 0,
      unpricedRequests: count(bucket.unpricedRequests),
      ollama: bucket.ollama === true,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const ollamaModels = models.filter((model) => model.ollama)
  const otherModels = models.filter((model) => !model.ollama)
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
    firstAt: finiteOrNull(usage.firstAt),
    lastAt: finiteOrNull(usage.lastAt),
    models: ollamaModels,
    otherModels,
    otherRequests: count(usage.otherRequests),
    otherCompactionRequests: count(usage.otherCompactionRequests),
    otherTokens: count(usage.otherTokens),
    forked: Number(usage.ownStart) > 0,
    inheritedEventCount: Number(usage.ownStart) || 0,
  }
}
