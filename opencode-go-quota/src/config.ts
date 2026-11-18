/**
 * Row configuration and the small coercions every Host module shares.
 *
 * The Loader hands the row's `config` through untouched, so everything here
 * starts from `unknown` and narrows structurally: a malformed or absent key
 * falls back to the documented default instead of throwing at activation.
 *
 * @module @local/opencode-go-quota/config
 */

import { MODEL_PRICES, mergePriceOverrides } from './prices.ts'
import type { PriceTable } from './wire.ts'

/** Documented Go usage endpoint; Bearer-authenticated by the Go API key. */
export const USAGE_PATH = '/zen/go/v1/usage'

/** Public models list for the free-model watcher; needs no key. */
export const MODELS_PATH = '/inference/go/v1/models'

/** Exact Fetch routes below the authenticated carrier channel. */
export const USAGE_ROUTE_PATH = '/api/opencode-go-quota/usage'
export const SESSION_ROUTE_PATH = '/api/opencode-go-quota/session'
export const FREE_ROUTE_PATH = '/api/opencode-go-quota/free'

/** The usage endpoint's own cadence is unknown; keep one read per minute. */
export const MIN_REFRESH_SECONDS = 60

/** The free-model watcher polls the public list at most this often. */
export const MIN_FREE_REFRESH_SECONDS = 300

/** A hung upstream read must not pin the rest of the polling loop. */
export const REQUEST_TIMEOUT_MS = 15_000

/** Documented defaults for every configurable row key. */
export const DEFAULTS = Object.freeze({
  apiKeyEnv: 'OPENCODE_GO_API_KEY',
  baseUrl: 'https://opencode.ai',
  refreshSeconds: 60,
  freeRefreshSeconds: 600,
  provider: 'opencode-go',
})

/** The row config after defaults, bounds, and the merged price table. */
export interface ResolvedConfig {
  /** Credential reference holding the Go API key. */
  apiKeyEnv: string
  /** Base URL of the usage and models endpoints, without a trailing slash. */
  baseUrl: string
  /** Host cache window for a successful usage reading, in seconds. */
  refreshSeconds: number
  /** Host cache window for a successful models-list reading, in seconds. */
  freeRefreshSeconds: number
  /** {@link refreshSeconds} in milliseconds. */
  ttlMs: number
  /** {@link freeRefreshSeconds} in milliseconds. */
  freeTtlMs: number
  /** Lower-case provider id whose calls draw on the Go allowance. */
  provider: string
  /** Published prices plus the row's overrides. */
  prices: PriceTable
  /** Lower-case, unique watched model names. */
  watchModels: string[]
}

/**
 * Resolve a row's config.
 * @param config - the raw Loader config (any JSON value).
 * @returns the resolved options.
 */
export function resolveConfig(config: unknown): ResolvedConfig {
  const options = asRecord(config) ?? {}
  const refreshSeconds = boundedNumber(
    options['refreshSeconds'],
    MIN_REFRESH_SECONDS,
    DEFAULTS.refreshSeconds,
  )
  const freeRefreshSeconds = boundedNumber(
    options['freeRefreshSeconds'],
    MIN_FREE_REFRESH_SECONDS,
    DEFAULTS.freeRefreshSeconds,
  )
  return {
    apiKeyEnv: nonEmpty(options['apiKeyEnv']) ?? DEFAULTS.apiKeyEnv,
    baseUrl: (nonEmpty(options['baseUrl']) ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
    refreshSeconds,
    freeRefreshSeconds,
    ttlMs: refreshSeconds * 1_000,
    freeTtlMs: freeRefreshSeconds * 1_000,
    provider: (nonEmpty(options['provider']) ?? DEFAULTS.provider).toLowerCase(),
    prices: mergePriceOverrides(MODEL_PRICES, options['prices']),
    watchModels: parseWatchModels(options['watchModels']),
  }
}

/** A plain object view of a JSON value, or undefined for anything else. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Parse the configured watched model names: lower-case, non-empty, unique.
 * @param value - the row's `watchModels` config.
 * @returns the names to report free status for.
 */
export function parseWatchModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    const name = typeof entry === 'string' ? entry.trim().toLowerCase() : ''
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** Read one field of an unknown value; undefined for a non-object. */
export function fieldOf(value: unknown, key: string): unknown {
  return asRecord(value)?.[key]
}

/** Trim to a non-empty string, or undefined. */
export function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Coerce to a string without inventing content. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Coerce to a finite number, or undefined. */
export function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Coerce a token counter to a non-negative finite number. */
export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Clamp a numeric config value between a floor and a default.
 * @param value - configured value.
 * @param min - smallest accepted value.
 * @param fallback - used when the value is not a finite number.
 * @returns the clamped number.
 */
export function boundedNumber(value: unknown, min: number, fallback: number): number {
  const parsed = Number(value)
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback)
}

/** Message of an unknown thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
