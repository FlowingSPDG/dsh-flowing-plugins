/**
 * Row config → one resolved option set.
 *
 * The Loader hands the row's `config` through unchanged, so every field is
 * untrusted: strings are trimmed, the cache window is coerced and clamped to
 * the endpoint's documented budget, and the provider id is lower-cased because
 * it is compared against routed ids. Nothing here throws — a profile with a
 * broken value keeps the documented default instead of losing the chip.
 *
 * @module @local/ollama-quota/config
 */

import { mergePriceOverrides, MODEL_PRICES, type PriceTable } from './prices.ts'

/** The balance endpoint allows 10 requests per minute per user, shared across keys. */
export const MIN_REFRESH_SECONDS = 60

/** Documented defaults for every row key. */
export const DEFAULTS = Object.freeze({
  apiKeyEnv: 'OLLAMA_CLOUD_API_KEY',
  baseUrl: 'https://ollama.com',
  refreshSeconds: 60,
  provider: 'ollama-cloud',
})

/** One row's resolved options. */
export interface QuotaConfig {
  /** Credential reference (environment-variable name) holding the account key. */
  apiKeyEnv: string
  /** Balance endpoint base, without a trailing slash. */
  baseUrl: string
  /** Host cache window, floored at {@link MIN_REFRESH_SECONDS}. */
  refreshSeconds: number
  /** {@link refreshSeconds} in milliseconds. */
  ttlMs: number
  /** Provider id whose calls draw on this balance. */
  provider: string
  /** Built-in price table plus any profile overrides. */
  prices: PriceTable
}

/**
 * Narrow an untrusted value to a plain record.
 * @param value - candidate.
 * @returns the record, or undefined.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * Coerce one config value to a finite number the way `Number()` does, which is
 * what the previous plain-JavaScript config accepted (numeric strings included).
 * @param value - candidate.
 * @returns the number, or undefined for NaN/Infinity and symbols.
 */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'symbol') return undefined
  const converted = Number(value)
  return Number.isFinite(converted) ? converted : undefined
}

/**
 * Resolve one row's config.
 * @param raw - the Loader row's `config`, of unknown shape.
 * @returns the resolved options.
 */
export function resolveConfig(raw: unknown): QuotaConfig {
  const options = isRecord(raw) ? raw : {}
  const apiKeyEnv = nonEmpty(options['apiKeyEnv']) ?? DEFAULTS.apiKeyEnv
  const baseUrl = (nonEmpty(options['baseUrl']) ?? DEFAULTS.baseUrl).replace(/\/+$/, '')
  const refreshSeconds = Math.max(
    MIN_REFRESH_SECONDS,
    finiteNumber(options['refreshSeconds']) ?? DEFAULTS.refreshSeconds,
  )
  const provider = (nonEmpty(options['provider']) ?? DEFAULTS.provider).toLowerCase()
  return {
    apiKeyEnv,
    baseUrl,
    refreshSeconds,
    ttlMs: refreshSeconds * 1_000,
    provider,
    prices: mergePriceOverrides(MODEL_PRICES, options['prices']),
  }
}
