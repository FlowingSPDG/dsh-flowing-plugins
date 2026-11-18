import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBalance, parseRetryAfter, statusCode } from './upstream.ts'

test('normalizeBalance reads the included/purchased USD shape', () => {
  const result = normalizeBalance({
    included: {
      balance_usd: 50.29,
      allowance_usd: 60,
      period: { from: '2026-11-01T00:00:00Z', until: '2026-12-01T00:00:00Z' },
    },
    purchased: { balance_usd: 1.5 },
  })
  assert.equal(result.kind, 'ok')
  assert.deepEqual(result.kind === 'ok' ? result.balance : null, {
    kind: 'usd',
    includedRemainingUsd: 50.29,
    includedAllowanceUsd: 60,
    purchasedUsd: 1.5,
    periodFrom: '2026-11-01T00:00:00Z',
    periodUntil: '2026-12-01T00:00:00Z',
  })
})

test('normalizeBalance defaults missing optional USD fields', () => {
  const result = normalizeBalance({ included: { balance_usd: 1, allowance_usd: 2 } })
  assert.equal(result.kind, 'ok')
  const balance = result.kind === 'ok' ? result.balance : null
  assert.equal(balance?.kind, 'usd')
  assert.equal(balance?.kind === 'usd' ? balance.purchasedUsd : null, 0)
  assert.equal(balance?.kind === 'usd' ? balance.periodFrom : 'x', null)
})

test('normalizeBalance reads the rolling percentage shape', () => {
  const result = normalizeBalance({
    included: {
      session: { remaining_percent: 74, resets_at: '2026-11-16T18:00:00Z' },
      weekly: { remaining_percent: 92, resets_at: '2026-11-20T00:00:00Z' },
    },
    purchased: { balance_usd: 3 },
  })
  assert.equal(result.kind, 'ok')
  assert.deepEqual(result.kind === 'ok' ? result.balance : null, {
    kind: 'percent',
    sessionRemainingPercent: 74,
    sessionResetsAt: '2026-11-16T18:00:00Z',
    weeklyRemainingPercent: 92,
    weeklyResetsAt: '2026-11-20T00:00:00Z',
    purchasedUsd: 3,
  })
})

test('normalizeBalance reports an unexpected shape instead of guessing', () => {
  for (const payload of [{}, { included: { balance_usd: 1 } }, 'nope', null, 42]) {
    const result = normalizeBalance(payload)
    assert.equal(result.kind, 'error')
    assert.equal(result.kind === 'error' ? result.error.code : null, 'unexpected-shape')
  }
})

test('parseRetryAfter accepts seconds and ignores the HTTP-date form', () => {
  assert.equal(parseRetryAfter('120'), 120)
  assert.equal(parseRetryAfter(' 1.5 '), 1.5)
  assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT'), undefined)
  assert.equal(parseRetryAfter('0'), undefined)
  assert.equal(parseRetryAfter('-5'), undefined)
  assert.equal(parseRetryAfter(''), undefined)
  assert.equal(parseRetryAfter(null), undefined)
})

test('statusCode maps the documented statuses and keeps the rest readable', () => {
  assert.equal(statusCode(401), 'unauthorized')
  assert.equal(statusCode(403), 'suspended')
  assert.equal(statusCode(429), 'rate-limited')
  assert.equal(statusCode(503), 'unavailable')
  assert.equal(statusCode(500), 'http-500')
  assert.equal(statusCode(418), 'http-418')
})
