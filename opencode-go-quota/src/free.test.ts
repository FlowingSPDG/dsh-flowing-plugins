import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FREE_HISTORY_LIMIT,
  applyFreeReading,
  collectWatched,
  emptyFreeWatch,
  hasFreeSuffix,
  isFreeModel,
  type EnrichedModel,
  type FreeWatchState,
} from './free.ts'
import type { FreeModelRow } from './wire.ts'

function zeroCost(): unknown {
  return { text: { input: { price: 0 }, output: { price: 0 } } }
}

function pricedCost(input: number, output: number): unknown {
  return { text: { input: { price: input }, output: { price: output } } }
}

function row(id: string, cost: unknown, canonical: string | null = null): EnrichedModel {
  return { raw: { id, name: `${id} name`, cost }, id, name: `${id} name`, canonical }
}

function freeRow(id: string): FreeModelRow {
  return { id, name: `${id} name`, canonical: null, description: null, limitedRegions: false, training: false }
}

test('the -free suffix marks a model free regardless of its listed prices', () => {
  assert.equal(hasFreeSuffix('hy4-flash-free'), true)
  assert.equal(hasFreeSuffix('  HY4-FLASH-FREE '), true)
  assert.equal(hasFreeSuffix('free-model'), false)
  assert.equal(hasFreeSuffix(undefined), false)
})

test('zero published input and output prices mark a model free', () => {
  assert.equal(isFreeModel({ id: 'a', cost: zeroCost() }), true)
  assert.equal(isFreeModel({ id: 'a', cost: pricedCost(0, 1) }), false)
  assert.equal(isFreeModel({ id: 'a' }), false)
  assert.equal(isFreeModel({ id: 'a-free', cost: pricedCost(3, 9) }), true)
  assert.equal(isFreeModel(null), false)
  assert.equal(isFreeModel('a'), false)
})

test('collectWatched matches ids, canonical names, and stripped -free variants', () => {
  const rows = [
    row('glm-5.3-flash', pricedCost(0.15, 0.5)),
    row('hy4-flash-free', zeroCost(), 'tencent/hy4-flash'),
  ]
  const watched = collectWatched(rows, ['glm-5.3-flash', 'hy4-flash', 'unlisted'])
  assert.equal(watched.length, 2)
  assert.deepEqual(watched[0], {
    id: 'glm-5.3-flash',
    name: 'glm-5.3-flash name',
    canonical: null,
    free: false,
    inputPrice: 0.15,
    outputPrice: 0.5,
  })
  assert.deepEqual(watched[1], {
    id: 'hy4-flash-free',
    name: 'hy4-flash-free name',
    canonical: 'tencent/hy4-flash',
    free: true,
    inputPrice: 0,
    outputPrice: 0,
  })
})

test('the first read seeds the baseline instead of reporting every model as new', () => {
  const seeded = applyFreeReading(
    emptyFreeWatch(),
    { models: [freeRow('a'), freeRow('b')], watched: [] },
    1_000,
  )
  assert.deepEqual(seeded.newFree, [])
  assert.deepEqual(seeded.history, [])
  assert.deepEqual(seeded.last?.firstSeen, { a: 1_000, b: 1_000 })
  assert.deepEqual(seeded.seenIds, ['a', 'b'])
})

test('a later read reports arrivals and removals and keeps first-seen stamps', () => {
  const first = applyFreeReading(
    emptyFreeWatch(),
    { models: [freeRow('a'), freeRow('b')], watched: [] },
    1_000,
  )
  const next = applyFreeReading(
    first,
    { models: [freeRow('b'), freeRow('c')], watched: [] },
    2_000,
  )
  assert.deepEqual(
    next.newFree.map((model) => model.id),
    ['c'],
  )
  assert.deepEqual(next.history[0], { at: 2_000, kind: 'removed', id: 'a', name: 'a name' })
  assert.deepEqual(next.history[1], { at: 2_000, kind: 'added', id: 'c', name: 'c name' })
  assert.deepEqual(next.last?.firstSeen, { a: 1_000, b: 1_000, c: 2_000 })
})

test('the transition history is capped newest-first', () => {
  const models = Array.from({ length: FREE_HISTORY_LIMIT + 3 }, (_, index) => freeRow(`m${String(index)}`))
  const seeded: FreeWatchState = applyFreeReading(
    emptyFreeWatch(),
    { models: [freeRow('old')], watched: [] },
    1_000,
  )
  const flooded = applyFreeReading(seeded, { models, watched: [] }, 2_000)
  assert.equal(flooded.history.length, FREE_HISTORY_LIMIT)
  // Removals are folded last, so the disappeared model leads the list.
  assert.equal(flooded.history[0]?.kind, 'removed')
  assert.equal(flooded.history[0]?.id, 'old')
  assert.equal(flooded.history[1]?.id, `m${String(FREE_HISTORY_LIMIT + 2)}`)
})
