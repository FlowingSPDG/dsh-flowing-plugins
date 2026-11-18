import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MODEL_PRICES } from './prices.ts'
import {
  applyUsageEvent,
  emptyUsageState,
  finalizeUsage,
  parseUsageState,
  recordOf,
  type FoldConfig,
  type UsageEventInput,
} from './usage.ts'

// Monday 13:00 UTC: inside the published peak window.
const PEAK = Date.UTC(2026, 10, 16, 13, 0)

const config: FoldConfig = { provider: 'ollama-cloud', prices: MODEL_PRICES }

/**
 * Build one committed-event view.
 * @param type - event type.
 * @param seq - log position.
 * @param data - payload.
 * @returns the event view the fold reads.
 */
function event(type: string, seq: number, data: unknown): UsageEventInput {
  return { type, seq, time: PEAK, data }
}

/**
 * A routed request header.
 * @param provider - routed provider id.
 * @param model - routed model id.
 * @param seq - log position.
 * @returns the event.
 */
function header(provider: string, model: string, seq = 0): UsageEventInput {
  return event('request/header', seq, { header: { config: { provider, model } } })
}

/**
 * An assistant attempt carrying one raw usage chunk.
 * @param seq - log position.
 * @param turn - turn number.
 * @param step - step number.
 * @param usage - token usage.
 * @returns the event.
 */
function attempt(seq: number, turn: number, step: number, usage: unknown): UsageEventInput {
  return event('assistant/attempt', seq, {
    turn,
    step,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }],
  })
}

/**
 * A settled assistant message carrying its durable usage.
 * @param seq - log position.
 * @param turn - turn number.
 * @param step - step number.
 * @param usage - token usage.
 * @returns the event.
 */
function message(seq: number, turn: number, step: number, usage: unknown): UsageEventInput {
  return event('assistant/message', seq, { turn, step, usage })
}

test('a message replaces the attempt it settles instead of adding to it', () => {
  let state = emptyUsageState(0)
  state = applyUsageEvent(state, header('ollama-cloud', 'deepseek-v4.1-flash'), config)
  state = applyUsageEvent(state, attempt(1, 1, 1, { inputTokens: 100, outputTokens: 50 }), config)
  state = applyUsageEvent(
    state,
    message(2, 1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 }),
    config,
  )
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 1)
  assert.equal(summary.inputTokens, 100)
  assert.equal(summary.outputTokens, 50)
  assert.equal(summary.cacheReadTokens, 10)
  assert.equal(summary.totalTokens, 160)
  assert.equal(summary.models.length, 1)
  assert.equal(summary.models[0]?.totalTokens, 160)
})

test('a retry between attempt and message keeps both attempts', () => {
  let state = emptyUsageState(0)
  state = applyUsageEvent(state, header('ollama-cloud', 'deepseek-v4.1-flash'), config)
  state = applyUsageEvent(state, attempt(1, 1, 1, { inputTokens: 100, outputTokens: 50 }), config)
  state = applyUsageEvent(state, event('llm/retry-started', 2, { turn: 1, step: 1 }), config)
  state = applyUsageEvent(state, message(3, 1, 1, { inputTokens: 10, outputTokens: 5 }), config)
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 2)
  assert.equal(summary.inputTokens, 110)
  assert.equal(summary.outputTokens, 55)
})

test('events before the fork cut are dropped, but a request header still routes', () => {
  let state = emptyUsageState(5)
  state = applyUsageEvent(state, header('ollama-cloud', 'deepseek-v4.1-flash', 3), config)
  assert.equal(state.routeProvider, 'ollama-cloud')
  state = applyUsageEvent(state, message(4, 1, 1, { inputTokens: 999, outputTokens: 999 }), config)
  assert.equal(state.requests, 0)
  state = applyUsageEvent(state, message(5, 1, 1, { inputTokens: 7, outputTokens: 3 }), config)
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 1)
  assert.equal(summary.inputTokens, 7)
  assert.equal(summary.forked, true)
  assert.equal(summary.inheritedEventCount, 5)
})

test('title requests count only when they route through the configured provider', () => {
  let state = emptyUsageState(0)
  state = applyUsageEvent(state, event('session/title-llm-request', 1, { route: { provider: 'ollama-cloud' } }), config)
  state = applyUsageEvent(state, event('session/title-llm-request', 2, { route: { provider: 'other' } }), config)
  assert.equal(state.titleRequests, 1)
})

test('another provider is accounted separately and never charged to the balance', () => {
  let state = emptyUsageState(0)
  state = applyUsageEvent(state, header('other-provider', 'deepseek-v4.1-flash'), config)
  state = applyUsageEvent(state, message(1, 1, 1, { inputTokens: 40, outputTokens: 2 }), config)
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 0)
  assert.equal(summary.otherRequests, 1)
  assert.equal(summary.otherTokens, 42)
  assert.equal(summary.estimatedUsd, 0)
  assert.equal(summary.otherModels.length, 1)
  assert.equal(summary.otherModels[0]?.ollama, false)
})

test('compaction summaries are counted and priced from their own route', () => {
  let state = emptyUsageState(0)
  state = applyUsageEvent(state, event('compaction/summary', 1, {
    provider: 'ollama-cloud',
    model: 'deepseek-v4.1-flash',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  }), config)
  const summary = finalizeUsage(state)
  assert.equal(summary.compactionRequests, 1)
  assert.equal(summary.requests, 0)
  assert.ok(summary.estimatedUsd !== null)
  assert.ok(Math.abs(summary.estimatedUsd - 0.30) < 1e-12)
})

test('finalizeUsage clamps negative and non-finite accumulators', () => {
  const state = emptyUsageState(0)
  state.requests = -3
  state.input = Number.NaN
  state.estimatedUsd = -5
  state.pricedRequests = 1
  const summary = finalizeUsage(state)
  assert.equal(summary.requests, 0)
  assert.equal(summary.inputTokens, 0)
  assert.equal(summary.estimatedUsd, 0)
})

test('finalizeUsage reports null spend only when nothing could be priced', () => {
  const unpriced = emptyUsageState(0)
  unpriced.requests = 2
  unpriced.estimatedUsd = 0
  assert.equal(finalizeUsage(unpriced).estimatedUsd, null)
  const priced = emptyUsageState(0)
  priced.requests = 2
  priced.pricedRequests = 1
  priced.estimatedUsd = 0.5
  assert.equal(finalizeUsage(priced).estimatedUsd, 0.5)
})

test('finalizeUsage orders models by total tokens, descending', () => {
  const state = emptyUsageState(0)
  state.buckets['ollama-cloud\u0000small'] = {
    provider: 'ollama-cloud',
    model: 'small',
    ollama: true,
    requests: 1,
    compactionRequests: 0,
    input: 1,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 1,
    estimatedUsd: 0,
    pricedRequests: 1,
    unpricedRequests: 0,
  }
  state.buckets['ollama-cloud\u0000big'] = {
    provider: 'ollama-cloud',
    model: 'big',
    ollama: true,
    requests: 1,
    compactionRequests: 0,
    input: 10,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 10,
    estimatedUsd: 0,
    pricedRequests: 1,
    unpricedRequests: 0,
  }
  const summary = finalizeUsage(state)
  assert.deepEqual(summary.models.map((model) => model.model), ['big', 'small'])
})

test('recordOf takes its fallback clock as an argument instead of reading Date.now', () => {
  const now = Date.UTC(2026, 10, 16, 13, 0)
  const record = recordOf(
    { type: 'assistant/message', seq: 0, time: Number.NaN, data: { turn: 2, step: 3 } },
    { provider: 'ollama-cloud', model: 'deepseek-v4.1-flash' },
    { inputTokens: 1_000_000, outputTokens: 0 },
    'assistant',
    MODEL_PRICES,
    'ollama-cloud',
    now,
  )
  assert.equal(record.at, now)
  assert.equal(record.turn, 2)
  assert.equal(record.step, 3)
  assert.ok(record.cost !== null)
  assert.ok(Math.abs(record.cost - 0.30) < 1e-12)
})

test('recordOf attributes an unknown route and leaves unpublished models unpriced', () => {
  const record = recordOf(
    { type: 'assistant/message', seq: 0, time: PEAK, data: {} },
    { provider: '', model: '' },
    { inputTokens: 5 },
    'assistant',
    MODEL_PRICES,
    'ollama-cloud',
    0,
  )
  assert.equal(record.provider, 'unknown')
  assert.equal(record.model, 'unknown')
  assert.equal(record.cost, null)
  assert.equal(record.ollama, false)
})

test('parseUsageState rejects a non-object checkpoint and canonicalizes fields', () => {
  assert.throws(() => parseUsageState(null))
  assert.throws(() => parseUsageState('x'))
  const parsed = parseUsageState({
    ownStart: 2,
    routeProvider: 'ollama-cloud',
    routeModel: 'deepseek-v4.1-flash',
    requests: 3,
    input: 'nope',
    childIds: ['a', 4, 'a'],
    buckets: {
      'ollama-cloud\u0000m': { provider: 'ollama-cloud', model: 'm', ollama: true, requests: 1 },
      bad: 'x',
    },
    last: { turn: 1, step: 2, provider: 'ollama-cloud', model: 'm', cost: 0.1 },
  })
  assert.equal(parsed.ownStart, 2)
  assert.equal(parsed.requests, 3)
  assert.equal(parsed.input, 0)
  assert.deepEqual(parsed.childIds, ['a', 'a'])
  assert.equal(Object.keys(parsed.buckets).length, 1)
  assert.equal(parsed.buckets['ollama-cloud\u0000m']?.requests, 1)
  assert.equal(parsed.last?.turn, 1)
  assert.equal(parsed.last?.cost, 0.1)
})

test('parseUsageState drops a malformed pending record', () => {
  const parsed = parseUsageState({ last: 'nope' })
  assert.equal(parsed.last, null)
})
