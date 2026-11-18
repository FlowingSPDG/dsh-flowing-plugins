import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MODEL_PRICES, isPeakAt, mergePriceOverrides, priceFor } from './prices.ts'
import type { PriceRow } from './wire.ts'

// 2026-11-16 is a Monday; 2026-11-21 is a Saturday.
const MONDAY_PEAK = Date.UTC(2026, 10, 16, 2, 0)
const MONDAY_GAP = Date.UTC(2026, 10, 16, 5, 0)
const SATURDAY_PEAK = Date.UTC(2026, 10, 21, 2, 0)
const NOVEMBER = Date.UTC(2026, 10, 30, 12, 0)
const DECEMBER = Date.UTC(2026, 11, 1, 0, 0)

test('DeepSeek peaks only inside the two published weekday windows', () => {
  const row = MODEL_PRICES['deepseek-v4.1-flash'] as PriceRow
  assert.equal(isPeakAt(MONDAY_PEAK, row), true)
  assert.equal(isPeakAt(MONDAY_GAP, row), false)
  assert.equal(isPeakAt(SATURDAY_PEAK, row), false)

  const base = priceFor('deepseek-v4.1-flash', MONDAY_GAP, 1_000, MODEL_PRICES)
  assert.deepEqual(base, { price: { input: 0.15, cached: 0.003, output: 0.6 }, peak: false })
  const peak = priceFor('deepseek-v4.1-flash', MONDAY_PEAK, 1_000, MODEL_PRICES)
  assert.deepEqual(peak, { price: { input: 0.3, cached: 0.006, output: 1.2 }, peak: true })
})

test('long-context tiers switch only above the published threshold', () => {
  const atThreshold = priceFor('minimax-m3', MONDAY_GAP, 512_000, MODEL_PRICES)
  const above = priceFor('minimax-m3', MONDAY_GAP, 600_000, MODEL_PRICES)
  assert.equal(atThreshold?.price.input, 0.3)
  assert.equal(atThreshold?.price.cached, 0.06)
  assert.equal(above?.price.input, 0.6)
  assert.equal(above?.price.cached, 0.12)
  assert.equal(above?.price.output, 2.4)
})

test('the dated multiplier starts on its published day', () => {
  const before = priceFor('gemini-4-argon', NOVEMBER, 1_000, MODEL_PRICES)
  const after = priceFor('gemini-4-argon', DECEMBER, 1_000, MODEL_PRICES)
  assert.deepEqual(before, { price: { input: 2, cached: 0.1, output: 10 }, peak: false })
  assert.deepEqual(after, { price: { input: 4, cached: 0.2, output: 20 }, peak: true })
})

test('a variant suffix falls back to the bare model id', () => {
  const variant = priceFor('glm-5.3-flash:1017', MONDAY_GAP, 1_000, MODEL_PRICES)
  assert.equal(variant?.price.input, 0.15)
  assert.equal(variant?.price.output, 0.5)
  assert.equal(priceFor('unpublished', MONDAY_GAP, 1_000, MODEL_PRICES), undefined)
  assert.equal(priceFor('   ', MONDAY_GAP, 1_000, MODEL_PRICES), undefined)
})

test('profile overrides replace and extend published rows', () => {
  const table = mergePriceOverrides(MODEL_PRICES, {
    'My-New-Model': { input: 0.3, cached: 0.006, output: 1.2 },
    'glm-5.3': { input: 9, cached: 9, output: 9 },
  })
  assert.deepEqual(priceFor('my-new-model', MONDAY_GAP, 1_000, table)?.price, {
    input: 0.3,
    cached: 0.006,
    output: 1.2,
  })
  assert.equal(priceFor('glm-5.3', MONDAY_GAP, 1_000, table)?.price.input, 9)
  assert.equal(priceFor('glm-5.3', MONDAY_GAP, 1_000, MODEL_PRICES)?.price.input, 1.4)
  assert.equal(priceFor('my-new-model', MONDAY_GAP, 1_000, MODEL_PRICES), undefined)
})
