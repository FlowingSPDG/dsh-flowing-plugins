import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { formatRemaining, peakState, type DurationTranslator } from './peak.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Japanese duration templates, so assertions read like the chip. */
const t: DurationTranslator = (key, params) => {
  if (key === 'duration.days') return `${String(params['days'])}日${String(params['hours'])}時間`
  if (key === 'duration.hours') return `${String(params['hours'])}時間${String(params['minutes'])}分`
  return `${String(params['minutes'])}分`
}

/** One UTC instant, built without any local-time constructor. */
function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month, day, hour, minute, second, 0)
}

test('peakState reads the published weekday window at its edges', () => {
  // 2026-11-16 is a Monday.
  assert.deepEqual(peakState(at(2026, 10, 16, 12, 0)), {
    peak: true,
    nextAt: at(2026, 10, 16, 18, 0),
    remainingMs: 6 * HOUR,
  })
  assert.deepEqual(peakState(at(2026, 10, 16, 11, 59)), {
    peak: false,
    nextAt: at(2026, 10, 16, 12, 0),
    remainingMs: MINUTE,
  })
  assert.deepEqual(peakState(at(2026, 10, 16, 17, 59, 30)), {
    peak: true,
    nextAt: at(2026, 10, 16, 18, 0),
    remainingMs: 30_000,
  })
  assert.deepEqual(peakState(at(2026, 10, 16, 18, 0)), {
    peak: false,
    nextAt: at(2026, 10, 17, 12, 0),
    remainingMs: 18 * HOUR,
  })
})

test('peakState skips the UTC weekend', () => {
  // Friday 18:00 is off-peak until Monday 12:00.
  assert.deepEqual(peakState(at(2026, 10, 13, 18, 0)), {
    peak: false,
    nextAt: at(2026, 10, 16, 12, 0),
    remainingMs: 66 * HOUR,
  })
  // Saturday 03:00 is off-peak all weekend.
  assert.deepEqual(peakState(at(2026, 10, 14, 3, 0)), {
    peak: false,
    nextAt: at(2026, 10, 16, 12, 0),
    remainingMs: 57 * HOUR,
  })
  // Sunday 23:00 is 13 hours from Monday 12:00.
  assert.deepEqual(peakState(at(2026, 10, 15, 23, 0)), {
    peak: false,
    nextAt: at(2026, 10, 16, 12, 0),
    remainingMs: 13 * HOUR,
  })
})

test('peakState crosses the year boundary', () => {
  // Thursday 2026-12-31 19:00 waits for Friday 2027-01-01 12:00.
  assert.deepEqual(peakState(at(2026, 11, 31, 19, 0)), {
    peak: false,
    nextAt: at(2027, 0, 1, 12, 0),
    remainingMs: 17 * HOUR,
  })
})

test('peakState keeps a non-finite instant honest', () => {
  for (const instant of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const state = peakState(instant)
    assert.equal(state.peak, false)
    assert.equal(state.remainingMs, 0)
    assert.equal(state.nextAt, instant)
  }
})

test('formatRemaining rounds whole minutes up and drops minutes under a day', () => {
  assert.equal(formatRemaining(0, t), '0分')
  assert.equal(formatRemaining(59_999, t), '1分')
  assert.equal(formatRemaining(60_000, t), '1分')
  assert.equal(formatRemaining(90_000, t), '2分')
  assert.equal(formatRemaining(HOUR + 23 * MINUTE, t), '1時間23分')
  assert.equal(formatRemaining(HOUR + 23 * MINUTE + 45_000, t), '1時間24分')
  assert.equal(formatRemaining(24 * HOUR, t), '1日0時間')
  // A day present drops the minutes, matching the shipped chip.
  assert.equal(formatRemaining(51 * HOUR + 30 * MINUTE, t), '2日3時間')
})

test('formatRemaining clamps negative and non-finite durations to 0分', () => {
  assert.equal(formatRemaining(-1, t), '0分')
  assert.equal(formatRemaining(-24 * HOUR, t), '0分')
  assert.equal(formatRemaining(Number.NaN, t), '0分')
  assert.equal(formatRemaining(Number.POSITIVE_INFINITY, t), '0分')
})

test('peakState is time-zone independent, because it reads UTC accessors only', async () => {
  const source = await readFile(new URL('./peak.ts', import.meta.url), 'utf8')
  // No local wall-clock accessors: the published window is a UTC one.
  assert.doesNotMatch(source, /\.get(?:Date|Day|Hours|Minutes|Month|FullYear|Milliseconds)\(/)
  assert.doesNotMatch(source, /\.set(?:Date|Day|Hours|Minutes|Month|FullYear)\(/)
  assert.doesNotMatch(source, /toLocale/)
  // ...and the UTC reads it must have, so the assertion above cannot pass vacuously.
  assert.match(source, /\.getUTC(?:Date|Day|Hours|Minutes)\(/)

  // The same epoch gives the same answer, and the boundaries land exactly where
  // Date.UTC puts them; a local-time read would shift them by the host offset.
  const instant = at(2026, 10, 16, 17, 59, 30)
  for (const probe of [instant, instant + 1, instant - 1]) {
    const state = peakState(probe)
    assert.equal(state.nextAt, at(2026, 10, 16, 18, 0))
    assert.equal(state.remainingMs, 30_000 - (probe - instant))
  }
})
