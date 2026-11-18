import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  backoffDelayMs,
  normalizeUsage,
  readGate,
  statusCode,
  type ReadGateInput,
} from './upstream.ts'

const NOW = Date.UTC(2026, 10, 18, 12, 0)

test('normalizeUsage reads the live nested shape', () => {
  const answer = normalizeUsage(
    {
      usage: {
        rolling: { percent: 34, resetsAt: '2026-11-18T17:00:00.000Z', status: 'ok' },
        weekly: { percent: 4 },
        monthly: {},
      },
    },
    NOW,
  )
  assert.equal(answer.kind, 'ok')
  if (answer.kind !== 'ok') return
  assert.deepEqual(
    answer.usage.windows.map((window) => [window.key, window.label, window.percent]),
    [
      ['rolling', '5h', 34],
      ['weekly', 'week', 4],
    ],
  )
  assert.equal(answer.usage.windows[0]?.resetsAt, '2026-11-18T17:00:00.000Z')
  assert.equal(answer.usage.windows[1]?.resetsAt, null)
})

test('normalizeUsage reads the early flat shape and resolves resetInSec', () => {
  const answer = normalizeUsage({ rollingUsage: { usagePercent: 10, resetInSec: 90 } }, NOW)
  assert.equal(answer.kind, 'ok')
  if (answer.kind !== 'ok') return
  assert.deepEqual(answer.usage.windows, [
    {
      key: 'rolling',
      label: '5h',
      percent: 10,
      resetsAt: new Date(NOW + 90_000).toISOString(),
      status: null,
    },
  ])
})

test('normalizeUsage rejects a body with no known window', () => {
  assert.deepEqual(normalizeUsage({ something: 'else' }, NOW), {
    kind: 'error',
    error: { code: 'unexpected-shape', message: 'usage response carried no known window' },
  })
  assert.equal(normalizeUsage(null, NOW).kind, 'error')
})

test('statusCode maps the documented failures to stable codes', () => {
  assert.equal(statusCode(401), 'unauthorized')
  assert.equal(statusCode(403), 'forbidden')
  assert.equal(statusCode(404), 'not-found')
  assert.equal(statusCode(429), 'rate-limited')
  assert.equal(statusCode(503), 'unavailable')
  assert.equal(statusCode(418), 'http-418')
})

test('backoffDelayMs grows with failures, carries jitter, and honours retry-after', () => {
  const base = 60_000
  assert.equal(backoffDelayMs(1, undefined, base, () => 0.5), base)
  assert.equal(backoffDelayMs(3, undefined, base, () => 0.5), base * 4)
  assert.ok(backoffDelayMs(6, undefined, base, () => 0.5) <= 15 * 60_000)
  assert.equal(backoffDelayMs(1, 600, base, () => 0.5), 600_000)
  // Jitter never drops below the successful cache window.
  assert.equal(backoffDelayMs(1, undefined, base, () => 0), base)
  assert.equal(backoffDelayMs(1, undefined, base, () => 1), Math.round(base * 1.2))
})

test('readGate honours the success cache, the failure wait, and one shared flight', () => {
  const base: ReadGateInput = {
    force: false,
    hasGood: true,
    ageMs: 10_000,
    ttlMs: 60_000,
    retryAt: 0,
    now: NOW,
    inflight: false,
  }
  assert.equal(readGate(base), 'cached')
  assert.equal(readGate({ ...base, ageMs: 60_000, retryAt: NOW + 30_000 }), 'backoff')
  assert.equal(readGate({ ...base, ageMs: 60_000, retryAt: NOW + 30_000, force: true }), 'fetch')
  // `?force` while a read is running joins that read instead of starting one.
  assert.equal(readGate({ ...base, ageMs: 60_000, inflight: true }), 'inflight')
  assert.equal(readGate({ ...base, force: true, inflight: true }), 'inflight')
  assert.equal(readGate({ ...base, hasGood: false }), 'fetch')
})
