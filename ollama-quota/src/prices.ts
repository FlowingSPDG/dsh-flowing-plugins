/**
 * Published Ollama Cloud list prices and the peak-window clock they ride on.
 *
 * All rates are USD per million tokens, mirroring `https://ollama.com/pricing`.
 * DeepSeek models publish a peak and an off-peak row; every other row is flat.
 * A profile may override or extend the table through the row's `prices`
 * config, which is why lookups take the merged table as an argument.
 *
 * @module @local/ollama-quota/prices
 */

/** One flat published price row, USD per million tokens. */
export interface PriceRow {
  /** Uncached input price. */
  readonly input: number
  /** Cached input (cache-read) price. */
  readonly cached: number
  /** Output price. */
  readonly output: number
}

/** One price row whose rates depend on the published peak window. */
export interface ClockPriceRow {
  readonly peak: PriceRow
  readonly offPeak: PriceRow
}

/**
 * A merged price table. Entries stay `unknown` because a profile-supplied
 * `prices` config is untrusted input; {@link priceFor} is the one place that
 * decides whether an entry is usable.
 */
export type PriceTable = Readonly<Record<string, unknown>>

/** Token buckets that carry a different published rate. */
export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Published peak window: weekdays 12:00 inclusive to 18:00 exclusive, UTC. */
const PEAK_START_HOUR = 12
const PEAK_END_HOUR = 18

/**
 * A flat published price row.
 * @param input - uncached input price.
 * @param cached - cached input price.
 * @param output - output price.
 * @returns the frozen price row.
 */
function flatPrice(input: number, cached: number, output: number): PriceRow {
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
 * @returns the frozen price row.
 */
function clockPrice(
  peakInput: number,
  peakCached: number,
  peakOutput: number,
  offPeakInput: number,
  offPeakCached: number,
  offPeakOutput: number,
): ClockPriceRow {
  return Object.freeze({
    peak: flatPrice(peakInput, peakCached, peakOutput),
    offPeak: flatPrice(offPeakInput, offPeakCached, offPeakOutput),
  })
}

/** Built-in table, USD per million tokens. */
export const MODEL_PRICES: Readonly<Record<string, PriceRow | ClockPriceRow>> = Object.freeze({
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

/**
 * Narrow an untrusted value to a plain record.
 * @param value - candidate.
 * @returns the record, or undefined.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value carries every rate needed for a cost calculation.
 * @param row - candidate row.
 * @returns true for finite input/cached/output rates.
 */
export function usablePrice(row: unknown): row is PriceRow {
  if (!isRecord(row)) return false
  return Number.isFinite(row['input']) && Number.isFinite(row['cached']) && Number.isFinite(row['output'])
}

/**
 * Whether one instant falls inside the published peak window.
 * @param at - epoch milliseconds.
 * @returns true for weekdays 12:00-18:00 UTC.
 */
export function isPeakAt(at: number): boolean {
  const date = new Date(at)
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  return day >= 1 && day <= 5 && hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR
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
export function priceFor(model: string, at: number, prices: PriceTable): PriceRow | undefined {
  const key = model.trim().toLowerCase()
  if (key === '') return undefined
  const row = prices[key] ?? prices[key.split(':')[0] ?? '']
  if (!isRecord(row)) return undefined
  const peak = row['peak']
  const offPeak = row['offPeak']
  if (peak !== undefined || offPeak !== undefined) {
    const selected = isPeakAt(at) ? peak : offPeak
    return usablePrice(selected) ? selected : undefined
  }
  return usablePrice(row) ? row : undefined
}

/**
 * Merge a profile's price overrides over the published table.
 * @param base - built-in table.
 * @param overrides - optional `prices` config object.
 * @returns a new table with trimmed, lower-cased keys; unusable entries stay in
 *   place and simply resolve to "unpublished" at lookup time.
 */
export function mergePriceOverrides(base: PriceTable, overrides: unknown): PriceTable {
  if (!isRecord(overrides)) return base
  const merged: Record<string, unknown> = { ...base }
  for (const [key, row] of Object.entries(overrides)) {
    const name = key.trim().toLowerCase()
    if (name === '') continue
    merged[name] = row
  }
  return merged
}

/**
 * Price one sample at one row.
 * @param price - applicable published row.
 * @param tokens - token buckets of one request.
 * @returns USD, exact to the published rates.
 */
export function costOf(price: PriceRow, tokens: UsageTokens): number {
  const input = tokens.input
  const output = tokens.output
  const cacheRead = tokens.cacheRead
  const cacheWrite = tokens.cacheWrite
  return ((input + cacheWrite) * price.input + cacheRead * price.cached + output * price.output) / 1_000_000
}
