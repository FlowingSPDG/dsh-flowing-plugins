/**
 * Number, money, token, and clock formatting for the OpenCode Go quota chip.
 *
 * Pure helpers with no React and no DOM beyond `Intl`/`Date`, so the browser
 * bundle stays thin and the behaviour is easy to reason about: every formatter
 * falls back to plain arithmetic when the platform lacks `Intl` support.
 *
 * @module @local/opencode-go-quota/client/format
 */

/** Coerce to a finite number, or 0. */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * USD with enough precision for a single session: cents above one dollar, four
 * decimals for smaller amounts so a short chat does not read $0.00.
 */
export function usdCost(value: unknown): string {
  const amount = num(value)
  const digits = amount >= 1 ? 2 : 4
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(digits)}`
  }
}

/** Token count in compact notation, with a plain fallback. */
export function formatTokens(value: unknown): string {
  const amount = num(value)
  try {
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    if (amount < 1_000) return String(Math.round(amount))
    if (amount < 1_000_000) return `${(amount / 1_000).toFixed(amount < 10_000 ? 1 : 0)}K`
    return `${(amount / 1_000_000).toFixed(1)}M`
  }
}

/** Local clock time for an epoch millisecond reading. */
export function clockTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(at).toISOString().slice(11, 16)
  }
}

/** Short local time for a documented ISO reset timestamp, or null when unparsable. */
export function resetTime(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  return stampTime(at)
}

/** Short local date and time for a watched-transition record. */
export function stampTime(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** A published per-million-token list price, for example `$0.15`. */
export function listUsd(value: unknown): string {
  const amount = num(value)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

/** Message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
