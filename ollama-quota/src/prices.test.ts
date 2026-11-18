import { test } from 'node:test'
import assert from 'node:assert/strict'

import { costOf, isPeakAt, mergePriceOverrides, MODEL_PRICES, priceFor, usablePrice } from './prices.ts'

// 2026-11-16 is a Monday and 2026-11-21 a Saturday, so these instants pin the
// weekday/weekend split as well as both ends of the published window.
const MONDAY_1159 = Date.UTC(2026, 10, 16, 11, 59)
const MONDAY_NOON = Date.UTC(2026, 10, 16, 12, 0)
const MONDAY_1759 = Date.UTC(2026, 10, 16, 17, 59)
const MONDAY_1800 = Date.UTC(2026, 10, 16, 18, 0)
const SATURDAY_1300 = Date.UTC(2026, 10, 21, 13, 0)

test('isPeakAt honours the weekday 12:00-18:00 UTC window', () => {
  assert.equal(isPeakAt(MONDAY_1159), false)
  assert.equal(isPeakAt(MONDAY_NOON), true)
  assert.equal(isPeakAt(MONDAY_1759), true)
  assert.equal(isPeakAt(MONDAY_1800), false)
  assert.equal(isPeakAt(SATURDAY_1300), false)
  assert.equal(isPeakAt(Date.UTC(2026, 9, 26, 13, 0)), true)
})

test('priceFor selects the peak and off-peak rows of a clock-priced model', () => {
  const peak = priceFor('deepseek-v4.1-flash', MONDAY_NOON, MODEL_PRICES)
  const offPeak = priceFor('deepseek-v4.1-flash', MONDAY_1159, MODEL_PRICES)
  const afterHours = priceFor('deepseek-v4.1-flash', MONDAY_1800, MODEL_PRICES)
  const weekend = priceFor('deepseek-v4.1-flash', SATURDAY_1300, MODEL_PRICES)
  assert.deepEqual(peak, { input: 0.30, cached: 0.006, output: 1.20 })
  assert.deepEqual(offPeak, { input: 0.15, cached: 0.003, output: 0.60 })
  assert.deepEqual(afterHours, offPeak)
  assert.deepEqual(weekend, offPeak)
})

test('priceFor trims and lower-cases the model id and ignores trailing tags', () => {
  assert.deepEqual(priceFor(' DeepSeek-V4.1-Flash ', MONDAY_NOON, MODEL_PRICES), {
    input: 0.30,
    cached: 0.006,
    output: 1.20,
  })
  assert.deepEqual(priceFor('deepseek-v4.1-flash:1017', MONDAY_NOON, MODEL_PRICES), {
    input: 0.30,
    cached: 0.006,
    output: 1.20,
  })
  // An id that itself contains a colon matches exactly before any tag split.
  assert.deepEqual(priceFor('gpt-oss:120b', MONDAY_NOON, MODEL_PRICES), {
    input: 0.15,
    cached: 0.014,
    output: 0.60,
  })
})

test('priceFor reports unpublished models and unusable rows', () => {
  assert.equal(priceFor('no-such-model', MONDAY_NOON, MODEL_PRICES), undefined)
  assert.equal(priceFor('   ', MONDAY_NOON, MODEL_PRICES), undefined)
  assert.equal(usablePrice({ input: 1, cached: 2 }), false)
  assert.equal(usablePrice({ input: 1, cached: 2, output: 3 }), true)
  assert.equal(usablePrice('nope'), false)
})

test('mergePriceOverrides trims and lower-cases keys and ignores empty ones', () => {
  const merged = mergePriceOverrides(MODEL_PRICES, {
    ' My-Model ': { input: 1, cached: 0.1, output: 2 },
    '': { input: 9, cached: 9, output: 9 },
  })
  assert.deepEqual(priceFor('my-model', MONDAY_NOON, merged), { input: 1, cached: 0.1, output: 2 })
  assert.equal(priceFor('', MONDAY_NOON, merged), undefined)
  // The built-in rows survive an override pass.
  assert.deepEqual(priceFor('deepseek-v4.1-flash', MONDAY_NOON, merged), {
    input: 0.30,
    cached: 0.006,
    output: 1.20,
  })
})

test('mergePriceOverrides keeps the base table for non-object overrides', () => {
  assert.equal(mergePriceOverrides(MODEL_PRICES, undefined), MODEL_PRICES)
  assert.equal(mergePriceOverrides(MODEL_PRICES, 'nope'), MODEL_PRICES)
  assert.equal(mergePriceOverrides(MODEL_PRICES, [1, 2]), MODEL_PRICES)
})

test('costOf prices input, cache-write, cache-read, and output at their published rates', () => {
  const peak = priceFor('deepseek-v4.1-flash', MONDAY_NOON, MODEL_PRICES)
  assert.ok(peak !== undefined)
  assert.ok(Math.abs(costOf(peak, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }) - 0.30) < 1e-12)
  assert.ok(Math.abs(costOf(peak, { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }) - 0.30) < 1e-12)
  assert.ok(Math.abs(costOf(peak, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }) - 0.006) < 1e-12)
  assert.ok(Math.abs(costOf(peak, { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }) - 1.20) < 1e-12)
})

test('costOf reports the off-peak rate for the same tokens', () => {
  const offPeak = priceFor('deepseek-v4.1-flash', MONDAY_1159, MODEL_PRICES)
  assert.ok(offPeak !== undefined)
  assert.ok(Math.abs(costOf(offPeak, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }) - 0.15) < 1e-12)
})
