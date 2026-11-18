import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULTS, MIN_REFRESH_SECONDS, resolveConfig } from './config.ts'
import { priceFor } from './prices.ts'

test('resolveConfig falls back to the documented defaults', () => {
  const resolved = resolveConfig(undefined)
  assert.equal(resolved.apiKeyEnv, DEFAULTS.apiKeyEnv)
  assert.equal(resolved.baseUrl, DEFAULTS.baseUrl)
  assert.equal(resolved.refreshSeconds, DEFAULTS.refreshSeconds)
  assert.equal(resolved.ttlMs, 60_000)
  assert.equal(resolved.provider, DEFAULTS.provider)
  assert.equal(resolveConfig(null).apiKeyEnv, DEFAULTS.apiKeyEnv)
  assert.equal(resolveConfig('nope').apiKeyEnv, DEFAULTS.apiKeyEnv)
})

test('resolveConfig floors the cache window at the endpoint budget', () => {
  assert.equal(resolveConfig({ refreshSeconds: 5 }).refreshSeconds, MIN_REFRESH_SECONDS)
  assert.equal(resolveConfig({ refreshSeconds: 0 }).refreshSeconds, MIN_REFRESH_SECONDS)
  assert.equal(resolveConfig({ refreshSeconds: 90 }).refreshSeconds, 90)
  assert.equal(resolveConfig({ refreshSeconds: '90' }).refreshSeconds, 90)
  assert.equal(resolveConfig({ refreshSeconds: Number.NaN }).refreshSeconds, DEFAULTS.refreshSeconds)
  assert.equal(resolveConfig({ refreshSeconds: 'nope' }).refreshSeconds, DEFAULTS.refreshSeconds)
})

test('resolveConfig trims strings and lower-cases the provider id', () => {
  const resolved = resolveConfig({
    apiKeyEnv: '  MY_KEY  ',
    baseUrl: 'https://example.test///',
    provider: 'Ollama-Cloud',
    prices: { ' My-Model ': { input: 1, cached: 0.1, output: 2 } },
  })
  assert.equal(resolved.apiKeyEnv, 'MY_KEY')
  assert.equal(resolved.baseUrl, 'https://example.test')
  assert.equal(resolved.provider, 'ollama-cloud')
  assert.deepEqual(priceFor('my-model', Date.UTC(2026, 10, 16, 13, 0), resolved.prices), {
    input: 1,
    cached: 0.1,
    output: 2,
  })
})

test('resolveConfig ignores empty strings rather than accepting them', () => {
  const resolved = resolveConfig({ apiKeyEnv: '   ', baseUrl: '', provider: '' })
  assert.equal(resolved.apiKeyEnv, DEFAULTS.apiKeyEnv)
  assert.equal(resolved.baseUrl, DEFAULTS.baseUrl)
  assert.equal(resolved.provider, DEFAULTS.provider)
})
