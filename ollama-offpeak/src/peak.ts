/**
 * Pure clock helpers behind the Ollama Cloud off-peak chip.
 *
 * They live outside the client entry so `node --test` can exercise them
 * without a browser: no React, no DOM, no locale service. Every read goes
 * through the UTC accessors, so the answer is the same in every time zone —
 * the published window is a UTC one, not a local one.
 *
 * @module @local/ollama-offpeak/peak
 */

/** Published peak window start (UTC minutes): 12:00, inclusive. */
export const PEAK_START_MINUTES = 12 * 60

/** Published peak window end (UTC minutes): 18:00, exclusive. */
export const PEAK_END_MINUTES = 18 * 60

/** One instant read against the published peak window. */
export interface PeakState {
  /** Whether that instant bills at the peak rate. */
  peak: boolean
  /** Epoch milliseconds of the next boundary; the input itself when none is reachable. */
  nextAt: number
  /** Milliseconds until that boundary, never negative. */
  remainingMs: number
}

/** Duration keys {@link formatRemaining} resolves in the bundle's dictionary. */
export type DurationKey = 'duration.days' | 'duration.hours' | 'duration.minutes'

/**
 * The slice of the locale `t` seat this module needs: one of the three
 * duration templates plus its `{days}`/`{hours}`/`{minutes}` placeholders.
 */
export type DurationTranslator = (key: DurationKey, params: Record<string, string>) => string

const MINUTE_MS = 60_000

/**
 * Read one instant against the published peak window.
 *
 * Peak billing is weekdays 12:00 (inclusive) to 18:00 (exclusive) UTC, so the
 * weekend is off-peak for its whole length.
 *
 * @param now - epoch milliseconds, normally `Date.now()`.
 * @returns whether it bills at peak, and when the next boundary is. A
 * non-finite instant has no UTC day or clock to read, so it reports off-peak
 * with nothing remaining instead of formatting `NaN` minutes.
 */
export function peakState(now: number): PeakState {
  if (!Number.isFinite(now)) return { peak: false, nextAt: now, remainingMs: 0 }

  const at = new Date(now)
  const day = at.getUTCDay()
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes()
  const weekday = day >= 1 && day <= 5
  const peak = weekday && minutes >= PEAK_START_MINUTES && minutes < PEAK_END_MINUTES

  if (peak) {
    const nextAt = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 18, 0, 0, 0)
    return { peak, nextAt, remainingMs: Math.max(0, nextAt - now) }
  }

  // Walk forward to the next weekday 12:00 UTC. At most three days away.
  for (let add = 0; add < 8; add += 1) {
    const candidate = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + add, 12, 0, 0, 0)
    const candidateDay = new Date(candidate).getUTCDay()
    if (candidateDay === 0 || candidateDay === 6) continue
    if (candidate <= now) continue
    return { peak, nextAt: candidate, remainingMs: Math.max(0, candidate - now) }
  }

  // Unreachable for a valid instant; keep the chip honest rather than blank.
  return { peak, nextAt: now, remainingMs: 0 }
}

/**
 * Format a remaining duration for the chip label and panel.
 *
 * Whole minutes are rounded up, then split into days/hours/minutes. A day
 * present drops the minutes (the chip reads `2日3時間`, not `2日3時間4分`).
 *
 * @param ms - remaining milliseconds; non-finite or negative input reads `0分`.
 * @param t - namespace translate function.
 * @returns a short duration: `45分`, `1時間23分`, `2日3時間`.
 */
export function formatRemaining(ms: number, t: DurationTranslator): string {
  const safe = Number.isFinite(ms) ? ms : 0
  const totalMinutes = Math.max(0, Math.ceil(safe / MINUTE_MS))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return t('duration.days', { days: String(days), hours: String(hours) })
  if (hours > 0) return t('duration.hours', { hours: String(hours), minutes: String(minutes) })
  return t('duration.minutes', { minutes: String(minutes) })
}
