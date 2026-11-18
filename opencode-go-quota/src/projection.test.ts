import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MODEL_PRICES } from './prices.ts'
import {
  applyUsageEvent,
  collectSubtree,
  emptyUsageState,
  finalizeUsage,
  parseUsageState,
  type FoldConfig,
  type SubtreeSource,
} from './projection.ts'
import type { FoldEvent, UsageRecord, UsageState } from './wire.ts'

const CONFIG: FoldConfig = { provider: 'opencode-go', prices: MODEL_PRICES }

function event(
  type: string,
  seq: number,
  data: unknown,
  time = 1_760_000_000_000,
): FoldEvent {
  return { type, seq, time, data }
}

function header(seq: number, provider: string, model: string): FoldEvent {
  return event('request/header', seq, { header: { config: { provider, model } } })
}

function usage(inputTokens: number, outputTokens: number): unknown {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function attempt(seq: number, turn: number, step: number, tokens: unknown): FoldEvent {
  return event('assistant/attempt', seq, {
    turn,
    step,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: tokens } }],
  })
}

function message(seq: number, turn: number, step: number, tokens: unknown): FoldEvent {
  return event('assistant/message', seq, { turn, step, usage: tokens })
}

function fold(events: readonly FoldEvent[], ownStart = 0): UsageState {
  let state = emptyUsageState(ownStart)
  for (const next of events) state = applyUsageEvent(state, next, CONFIG)
  return state
}

test('a settled attempt replaces the streamed attempt of the same step', () => {
  const state = fold([
    header(0, 'opencode-go', 'glm-5.3-flash'),
    attempt(1, 1, 1, usage(1_000, 100)),
    message(2, 1, 1, usage(1_200, 120)),
  ])
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 1)
  assert.equal(summary.inputTokens, 1_200)
  assert.equal(summary.outputTokens, 120)
  assert.equal(summary.models.length, 1)
})

test('a retry drops the failed attempt, so both real attempts count', () => {
  const state = fold([
    header(0, 'opencode-go', 'glm-5.3-flash'),
    attempt(1, 1, 1, usage(100, 10)),
    event('llm/retry-started', 2, { turn: 1, step: 1 }),
    attempt(3, 1, 1, usage(200, 20)),
  ])
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 2)
  assert.equal(summary.inputTokens, 300)
  assert.equal(summary.outputTokens, 30)
})

test('events inherited from a fork are discarded below ownStart', () => {
  const inherited = emptyUsageState(3)
  const routed = applyUsageEvent(
    inherited,
    header(0, 'opencode-go', 'glm-5.3-flash'),
    CONFIG,
  )
  // The route follows the inherited history even though its usage does not.
  assert.equal(routed.routeModel, 'glm-5.3-flash')
  const ignored = applyUsageEvent(routed, attempt(1, 1, 1, usage(500, 50)), CONFIG)
  assert.equal(ignored, routed)
  const counted = applyUsageEvent(ignored, attempt(4, 1, 1, usage(500, 50)), CONFIG)
  assert.equal(finalizeUsage(counted).requests, 1)
  assert.equal(finalizeUsage(counted).forked, true)
  assert.equal(finalizeUsage(counted).inheritedEventCount, 3)
})

test('only Go title-generation calls are counted', () => {
  const go = fold([
    event('session/title-llm-request', 0, { route: { provider: 'opencode-go', model: 'm' } }),
  ])
  assert.equal(finalizeUsage(go).titleRequests, 1)
  const other = fold([
    event('session/title-llm-request', 0, { route: { provider: 'ollama-cloud', model: 'm' } }),
  ])
  assert.equal(finalizeUsage(other).titleRequests, 0)
})

test('finalizeUsage nulls an unpriced estimate and clamps at zero', () => {
  const unpriced = fold([
    header(0, 'opencode-go', 'unpublished-model'),
    message(1, 1, 1, usage(10, 1)),
  ])
  assert.equal(finalizeUsage(unpriced).estimatedUsd, null)
  assert.equal(finalizeUsage(unpriced).unpricedRequests, 1)

  const clamped: UsageState = {
    ...emptyUsageState(0),
    requests: 1,
    pricedRequests: 1,
    estimatedUsd: -5,
  }
  assert.equal(finalizeUsage(clamped).estimatedUsd, 0)
})

test('finalizeUsage orders models by total tokens', () => {
  const small = fold([
    header(0, 'opencode-go', 'glm-5.3-flash'),
    message(1, 1, 1, usage(10, 0)),
  ])
  const large = { ...small }
  const bigger = fold([
    header(0, 'opencode-go', 'glm-5.3'),
    message(1, 1, 2, usage(9_000, 1_000)),
  ])
  const merged: UsageState = {
    ...large,
    buckets: { ...large.buckets, ...bigger.buckets },
  }
  const models = finalizeUsage(merged).models
  assert.deepEqual(
    models.map((model) => model.model),
    ['glm-5.3', 'glm-5.3-flash'],
  )
})

test('parseUsageState rejects a non-object checkpoint and clamps fields', () => {
  assert.throws(() => parseUsageState(null), /not an object/)
  const parsed = parseUsageState({
    ownStart: 2,
    requests: 3.5,
    estimatedUsd: -1,
    routeProvider: 'opencode-go',
    childIds: ['a', 7],
    buckets: {},
    last: null,
  })
  assert.equal(parsed.ownStart, 2)
  assert.equal(parsed.requests, 3.5)
  assert.deepEqual(parsed.childIds, ['a'])
  assert.equal(parsed.routeProvider, 'opencode-go')
})

test('collectSubtree folds live children and counts the missing ones', () => {
  const nodes = new Map<string, { id: string }>()
  const states = new Map<string, UsageState>()
  const define = (id: string, model: string, tokens: number, childIds: string[]): void => {
    nodes.set(id, { id })
    const state = fold([
      header(0, 'opencode-go', model),
      message(1, 1, 1, usage(tokens, 0)),
    ])
    states.set(id, { ...state, childIds })
  }
  define('root', 'glm-5.3-flash', 10, ['child-1', 'child-2', 'gone'])
  define('child-1', 'glm-5.3', 100, [])
  define('child-2', 'glm-5.3', 1_000, [])
  states.set('root', { ...(states.get('root') as UsageState), childIds: ['child-1', 'child-2', 'gone'] })

  const source: SubtreeSource<{ id: string }> = {
    stateOf: (node) => states.get(node.id) as UsageState,
    get: (id) => nodes.get(id),
  }
  const root = nodes.get('root') as { id: string }
  const result = collectSubtree(root, source)
  assert.equal(result.sessions, 2)
  assert.equal(result.missing, 1)
  assert.equal(result.summary.requests, 3)
  assert.equal(result.summary.inputTokens, 1_110)
})

test('a bucket records the model it was attributed to', () => {
  const state = fold([
    header(0, 'opencode-go', 'glm-5.3-flash'),
    message(1, 1, 1, usage(1_000, 0)),
  ])
  const bucket = Object.values(state.buckets)[0]
  assert.equal(bucket?.provider, 'opencode-go')
  assert.equal(bucket?.model, 'glm-5.3-flash')
  assert.equal(bucket?.total, 1_000)
  assert.equal(state.pricedRequests, 1)
})
