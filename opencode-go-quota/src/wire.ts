/**
 * Wire, price, projection, and upstream types for the OpenCode Go quota plugin.
 *
 * Types only: this module carries no runtime code, so both halves can import
 * it (`import type`) without adding anything to either bundle. The shapes
 * mirror the exact JSON the Host half answers today, which is what keeps the
 * three routes wire-compatible with the previous release.
 *
 * @module @local/opencode-go-quota/wire
 */

/** Stable machine-readable failure codes the Client half phrases. */
export type ErrorCode =
  | 'network'
  | 'invalid-json'
  | 'unexpected-shape'
  | 'request-failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'unavailable'
  | `http-${number}`

/** One upstream failure as it travels to the Client half. */
export interface WireError {
  /** Machine-readable code; see {@link ErrorCode}. */
  code: ErrorCode
  /** Human-readable message, never empty. */
  message: string
  /** Seconds the endpoint asked the caller to wait (`retry-after`), when sent. */
  retryAfterSeconds?: number
}

/** One usage window of the documented Go usage answer. */
export interface UsageWindow {
  /** Stable id: `rolling`, `weekly`, or `monthly`. */
  key: string
  /** Display label shipped with the window. */
  label: string
  /** Consumed percentage, or null when the endpoint omitted it. */
  percent: number | null
  /** ISO reset timestamp, or null when unknown. */
  resetsAt: string | null
  /** Endpoint-reported window status, when present. */
  status: string | null
}

/** The normalized usage payload. */
export interface UsageWindows {
  windows: UsageWindow[]
}

/** `GET /api/opencode-go-quota/usage` response. */
export interface UsageSnapshot {
  /** Outcome of the attempt that produced this answer. */
  state: 'ok' | 'error' | 'unconfigured'
  /** Credential reference the Host resolves, for the setup hint. */
  apiKeyEnv: string
  /** When the served reading was taken; null before the first success. */
  fetchedAt: number | null
  /** A failed attempt is being shown through the last good reading. */
  stale: boolean
  /** Last successfully read usage, kept across failures. */
  usage: UsageWindows | null
  /** The attempt's failure, when it failed. */
  error: WireError | null
}

/** One limited-time free model as the models list publishes it. */
export interface FreeModelRow {
  id: string
  name: string
  canonical: string | null
  description: string | null
  limitedRegions: boolean
  training: boolean
}

/** One free model plus the Host's first-seen timestamp. */
export interface FreeModelWire extends FreeModelRow {
  since: number | null
}

/** One watched model's current free status and published input price. */
export interface WatchedModel {
  id: string
  name: string
  canonical: string | null
  free: boolean
  inputPrice: number | null
  outputPrice: number | null
}

/** One remembered free-model transition. */
export interface FreeHistoryEntry {
  at: number
  kind: 'added' | 'removed'
  id: string
  name: string
}

/** `GET /api/opencode-go-quota/free` response. */
export interface FreeSnapshot {
  state: 'ok' | 'error'
  /** When the served list was read; null before the first success. */
  fetchedAt: number | null
  /** A failed attempt is being shown through the last good list. */
  stale: boolean
  free: FreeModelWire[]
  watched: WatchedModel[]
  history: FreeHistoryEntry[]
  /** Models that appeared since the previous successful read. */
  newFree: FreeModelRow[]
  error: WireError | null
}

/** One attributed route bucket in the Session summary. */
export interface UsageModel {
  provider: string
  model: string
  requests: number
  compactionRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  estimatedUsd: number
  priced: boolean
  unpricedRequests: number
  go: boolean
  peak: boolean
  free: boolean
}

/** One Session's attributed usage, as the Host finalizes it. */
export interface UsageSummary {
  requests: number
  compactionRequests: number
  titleRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  estimatedUsd: number | null
  pricedRequests: number
  unpricedRequests: number
  firstAt: number | null
  lastAt: number | null
  models: UsageModel[]
  otherModels: UsageModel[]
  otherRequests: number
  otherCompactionRequests: number
  otherTokens: number
  forked: boolean
  inheritedEventCount: number
}

/** The Session subtree aggregate: the root plus every live subagent Session. */
export interface SubtreeSummary extends UsageSummary {
  /** Live descendant Sessions folded into the aggregate. */
  subagentSessions: number
  /** Children named by the log that are not mounted. */
  missingSessions: number
}

/** How the Session estimate was priced. */
export interface PricingBasis {
  basis: 'published-list-price'
  source: string
  peakNote: string
}

/** `GET /api/opencode-go-quota/session?sessionId=…` response. */
export interface SessionSnapshot {
  state: 'ok' | 'error' | 'invalid' | 'missing'
  sessionId?: string
  provider: string
  asOfSeq?: number
  forked?: boolean
  inheritedEventCount?: number
  direct?: UsageSummary
  subtree?: SubtreeSummary
  pricing?: PricingBasis
  /** Set by the Client half when a refresh failed; the Host never sends it. */
  stale?: boolean
  /** Set by the Client half when a refresh threw; the Host never sends it. */
  error?: WireError
  generatedAt: number
}

/** One price row's per-million-token rates, USD. */
export interface PriceRates {
  input: number
  cached: number
  output: number
}

/** A long-context price override, selected on input + cache-read + cache-write tokens. */
export interface PriceTier extends PriceRates {
  overTokens: number
}

/** One published multiplier window: whole weekdays and a UTC minute range. */
export interface PeakWindow {
  days: readonly number[]
  startMinute: number
  endMinute: number
}

/** A published price row, including the documented tiers and multipliers. */
export interface PriceRow extends PriceRates {
  tiers?: readonly PriceTier[]
  peakHours?: readonly PeakWindow[]
  peakFrom?: string
}

/** A merged price table: built-in rows plus a profile's overrides (untrusted). */
export type PriceTable = Readonly<Record<string, unknown>>

/** The price selected for one record, and whether a multiplier applied. */
export interface ResolvedPrice {
  price: PriceRates
  peak: boolean
}

/** One attributed route's numeric bucket inside a projection state. */
export interface UsageBucket {
  provider: string
  model: string
  go: boolean
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
  peak: boolean
  free: boolean
}

/** Buckets keyed by `provider\0model`. */
export type UsageBuckets = Record<string, UsageBucket>

/** One signed-addable attributed record. */
export interface UsageRecord {
  turn: number
  step: number
  kind: 'assistant' | 'compaction'
  provider: string
  model: string
  go: boolean
  requests: number
  compactionRequests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost: number | null
  peak: boolean
  free: boolean
  at: number
}

/**
 * The durable per-Session projection state folded from the Session log.
 *
 * Plain JSON by the projection contract: every field survives a structured
 * clone, so a checkpoint can seed a later fold.
 */
export interface UsageState {
  /** Fork-inherited prefix length; events before it are skipped. */
  ownStart: number
  /** Routed provider, empty before the first request header. */
  routeProvider: string
  /** Routed model, empty before the first request header. */
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
  buckets: UsageBuckets
  /** The attempt most recently added, so a replacement can subtract it. */
  last: UsageRecord | null
}

/**
 * The structural slice of a committed Session event the fold reads.
 *
 * The fold is deliberately typed against this narrow shape instead of the
 * SessionEvent union: the events it cares about span several packages'
 * declarations (agent, compaction, title), and this keeps the unit testable
 * with plain objects while staying assignable from a real SessionEvent.
 */
export interface FoldEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** One exact Fetch route the Host half registers. */
export interface FetchRouteDefinition {
  path: string
  methods: readonly string[]
  requestBody: 'buffered'
  fetch(request: { url: string }): Promise<Response>
}

/** The Connection carrier's route registry face used here. */
export interface ConnectionFetch {
  fetch: {
    register(route: FetchRouteDefinition): () => void
  }
}
