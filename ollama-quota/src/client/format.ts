/**
 * Number and date formatting for the chip and its card.
 *
 * Every helper tolerates a missing or hostile value: the wire snapshot is
 * JSON from the Host, and a chip must render something rather than throw.
 *
 * @module @local/ollama-quota/client/format
 */

/**
 * Coerce to a finite number, or 0.
 * @param value - candidate.
 * @returns the number, or 0.
 */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * USD amount with two decimals, falling back where Intl currency is unavailable.
 * @param value - candidate amount.
 * @returns the formatted amount.
 */
export function usd(value: unknown): string {
  const amount = num(value)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

/**
 * Token count in compact notation, with a plain fallback.
 * @param value - candidate count.
 * @returns the formatted count.
 */
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

/**
 * USD with enough precision for a single session: cents above one dollar,
 * four decimals for smaller amounts so a short chat does not read $0.00.
 * @param value - candidate amount.
 * @returns the formatted amount.
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

/**
 * Short local date for a documented UTC timestamp, or the raw text when unparsable.
 * @param iso - timestamp from the wire.
 * @returns the short date, or the input.
 */
export function shortDate(iso: unknown): string {
  if (typeof iso !== 'string') return '—'
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return iso
  try {
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return new Date(at).toISOString().slice(0, 10)
  }
}

/**
 * Local clock time for an epoch millisecond reading.
 * @param at - epoch milliseconds.
 * @returns the local time.
 */
export function clockTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(at).toISOString().slice(11, 16)
  }
}
