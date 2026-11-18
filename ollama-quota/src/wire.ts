/**
 * Wire contract shared by the two halves of the Ollama Cloud quota chip.
 *
 * Both routes answer plain JSON below the authenticated `/api` carrier, so the
 * browser half only ever receives these shapes; the Host half is the single
 * place that turns a credential, an HTTP answer, and a Session projection into
 * them.
 *
 * This module also carries the one local declaration of the Host RPC face this
 * package depends on. `ctx.connection` is provided by
 * `@deepseek-ai/dsh-client-connection`, which is not a dependency of this
 * workspace; declaring the two members used here is cheaper than adding a
 * package for a type, and it stays honest because the shape below mirrors that
 * package's `register` signature.
 *
 * @module @local/ollama-quota/wire
 */

/** Machine-readable balance failure codes the browser half phrases. */
export type BalanceErrorCode =
  | 'unauthorized'
  | 'suspended'
  | 'rate-limited'
  | 'unavailable'
  | 'invalid-json'
  | 'network'
  | 'request-failed'
  | 'unexpected-shape'
  | `http-${number}`

/** One failed balance attempt, as served to the chip. */
export interface BalanceError {
  code: BalanceErrorCode
  message: string
  /** Seconds the endpoint asked the caller to wait; only a seconds `retry-after` is honoured. */
  retryAfterSeconds?: number
}

/** Included-credit and purchased-credit balance in US dollars. */
export interface UsdBalance {
  kind: 'usd'
  includedRemainingUsd: number
  includedAllowanceUsd: number
  purchasedUsd: number
  periodFrom: string | null
  periodUntil: string | null
}

/** Percentage balance used by accounts that publish rolling windows instead. */
export interface PercentBalance {
  kind: 'percent'
  sessionRemainingPercent: number
  sessionResetsAt: string | null
  weeklyRemainingPercent: number
  weeklyResetsAt: string | null
  purchasedUsd: number
}

/** One normalized balance reading. */
export type Balance = UsdBalance | PercentBalance

/** Outcome of one balance read. */
export type BalanceState = 'ok' | 'unconfigured' | 'error'

/** `GET api/ollama-quota/balance` answer. */
export interface BalanceSnapshot {
  state: BalanceState
  /** Credential reference the Host resolved, so the panel can name the variable. */
  apiKeyEnv: string
  /** Epoch milliseconds of the last successful read, or null before one. */
  fetchedAt: number | null
  /** True when a failed attempt still carries the previous reading. */
  stale: boolean
  balance: Balance | null
  error: BalanceError | null
}

/** One `provider\0model` bucket, folded from the Session log. */
export interface ModelUsage {
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
  ollama: boolean
}

/** Frozen attributed usage of one Session (or a merged subtree). */
export interface UsageSummary {
  requests: number
  compactionRequests: number
  titleRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  /** Estimated USD, or null when nothing could be priced. */
  estimatedUsd: number | null
  pricedRequests: number
  unpricedRequests: number
  firstAt: number | null
  lastAt: number | null
  models: ModelUsage[]
  otherModels: ModelUsage[]
  otherRequests: number
  otherCompactionRequests: number
  otherTokens: number
  forked: boolean
  inheritedEventCount: number
}

/** A merged subtree also reports how many children contributed. */
export interface SubtreeSummary extends UsageSummary {
  subagentSessions: number
  missingSessions: number
}

/** Basis note the panel prints under its figures. */
export interface PricingBasis {
  basis: 'published-list-price'
  source: string
  peakWindow: string
}

/** Successful `GET api/ollama-quota/session?sessionId=…` answer. */
export interface SessionUsageSnapshot {
  state: 'ok'
  sessionId: string
  provider: string
  asOfSeq: number
  forked: boolean
  inheritedEventCount: number
  direct: UsageSummary
  subtree: SubtreeSummary
  pricing: PricingBasis
  generatedAt: number
}

/** Non-`ok` session answers: no id, unknown id, or a fold that threw. */
export interface SessionUsageFailure {
  state: 'invalid' | 'missing' | 'error'
  sessionId?: string
  provider: string
  generatedAt: number
  error?: { code: 'projection-failed'; message: string }
}

/** `GET api/ollama-quota/session?sessionId=…` answer. */
export type SessionSnapshot = SessionUsageSnapshot | SessionUsageFailure

/** One exact Host route registered through the authenticated connection carrier. */
export interface FetchRoute {
  path: string
  methods: readonly string[]
  requestBody: 'buffered'
  fetch(request: Request): Response | Promise<Response>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host RPC carrier (`@deepseek-ai/dsh-client-connection`); only the route registry is used here. */
    connection: { fetch: { register(route: FetchRoute): () => void } }
  }
}
