/**
 * Published OpenCode Go token prices and the lookup that prices one record.
 *
 * The table mirrors `https://opencode.ai/inference/go/v1/models`; a profile may
 * override or extend it through the row's `prices` config. A row is either a
 * flat rate, a tiered rate (a long-context override), a peaked rate (published
 * weekday windows), or a dated rate that doubles from a published date.
 *
 * @module @local/opencode-go-quota/prices
 */

import type {
  PeakWindow,
  PriceRates,
  PriceRow,
  PriceTable,
  PriceTier,
  ResolvedPrice,
} from './wire.ts'

/**
 * The two published DeepSeek multiplier windows: weekdays 01:00–04:00 and
 * 06:00–10:00 UTC. Minutes are counted from UTC midnight.
 */
export const WEEKDAY_WINDOWS: readonly PeakWindow[] = Object.freeze([
  Object.freeze({ days: Object.freeze([1, 2, 3, 4, 5]), startMinute: 60, endMinute: 240 }),
  Object.freeze({ days: Object.freeze([1, 2, 3, 4, 5]), startMinute: 360, endMinute: 600 }),
])

/** A flat published price row, USD per million tokens. */
export function flatPrice(input: number, cached: number, output: number): PriceRow {
  return Object.freeze({ input, cached, output })
}

/** A price row with long-context overrides. */
export function tieredPrice(base: PriceRates, tiers: readonly PriceTier[]): PriceRow {
  return Object.freeze({
    ...base,
    tiers: Object.freeze(tiers.map((tier) => Object.freeze(tier))),
  })
}

/** A price row with an hourly multiplier on weekdays (DeepSeek models). */
export function peakedPrice(
  input: number,
  cached: number,
  output: number,
  windows: readonly PeakWindow[],
): PriceRow {
  return Object.freeze({
    ...flatPrice(input, cached, output),
    peakHours: Object.freeze(windows),
  })
}

/** A price row with a date-based multiplier (Gemini 4 Argon). */
export function datedPrice(input: number, cached: number, output: number, from: string): PriceRow {
  return Object.freeze({ ...flatPrice(input, cached, output), peakFrom: from })
}

/** The built-in published price table, keyed by lower-case model id. */
export const MODEL_PRICES: Readonly<Record<string, PriceRow>> = Object.freeze({
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
  hy3: flatPrice(0.14, 0.035, 0.58),
  hy4: flatPrice(0.834, 0.042, 2.501),
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
 * Resolve the published price for a model id at one instant, including the
 * documented long-context tier and the time multipliers.
 *
 * A routed id may carry a variant suffix (`model:thinking`), so the lookup
 * falls back to the id before the first colon, matching the shipped estimate.
 *
 * @param model - routed model id.
 * @param at - epoch milliseconds of the usage record.
 * @param contextTokens - input + cache-read + cache-write tokens of the record.
 * @param prices - merged price table.
 * @returns the selected rates and whether a multiplier applied, or undefined
 *   when the model has no usable published price.
 */
export function priceFor(
  model: string,
  at: number,
  contextTokens: number,
  prices: PriceTable,
): ResolvedPrice | undefined {
  const key = model.trim().toLowerCase()
  if (key === '') return undefined
  const base = key.split(':')[0]
  const row = prices[key] ?? (base === undefined ? undefined : prices[base])
  if (!usablePrice(row)) return undefined
  const priced = row as PriceRow

  let selected: PriceRates = {
    input: priced.input,
    cached: priced.cached,
    output: priced.output,
  }
  let peak = false
  const tiers = Array.isArray(priced.tiers) ? priced.tiers : []
  for (const tier of tiers) {
    if (
      Number.isFinite(tier.overTokens) &&
      Number.isFinite(contextTokens) &&
      contextTokens > tier.overTokens &&
      Number.isFinite(tier.input) &&
      Number.isFinite(tier.cached) &&
      Number.isFinite(tier.output)
    ) {
      selected = { input: tier.input, cached: tier.cached, output: tier.output }
      break
    }
  }
  if (isPeakAt(at, priced)) {
    peak = true
    selected = {
      input: selected.input * 2,
      cached: selected.cached * 2,
      output: selected.output * 2,
    }
  }
  return { price: selected, peak }
}

/**
 * Whether one instant falls inside a price row's published time multiplier.
 * @param at - epoch milliseconds.
 * @param row - price row.
 * @returns true inside a documented peak window or after the peak start date.
 */
export function isPeakAt(at: number, row: PriceRow): boolean {
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
 * Whether an untrusted row carries every rate a cost calculation needs.
 * @param row - candidate row.
 * @returns true for finite input/cached/output rates.
 */
export function usablePrice(row: unknown): row is PriceRates {
  if (row === null || typeof row !== 'object') return false
  const candidate = row as Record<string, unknown>
  return (
    Number.isFinite(candidate['input']) &&
    Number.isFinite(candidate['cached']) &&
    Number.isFinite(candidate['output'])
  )
}

/**
 * Merge a profile's price overrides over the published table. Overrides are
 * untrusted JSON rows and stay `unknown` until {@link usablePrice} accepts
 * them at lookup time.
 * @param base - built-in table.
 * @param overrides - optional `prices` config object.
 * @returns a new table with lower-case keys.
 */
export function mergePriceOverrides(
  base: Readonly<Record<string, unknown>>,
  overrides: unknown,
): PriceTable {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return base
  }
  const merged: Record<string, unknown> = { ...base }
  for (const [key, row] of Object.entries(overrides)) {
    const name = key.trim().toLowerCase()
    if (name === '') continue
    merged[name] = row
  }
  return merged
}
