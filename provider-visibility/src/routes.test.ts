import { test } from 'node:test'
import assert from 'node:assert/strict'

import { badgeText, normalizePlacement, uniqueRoutes } from './routes.ts'

test('uniqueRoutes keeps order and drops invalid rows', () => {
  assert.deepEqual(uniqueRoutes(undefined), [])
  assert.deepEqual(uniqueRoutes([{ provider: 'ollama', model: 'm' }, { provider: 'ollama', model: 'm' }]), [
    { provider: 'ollama', model: 'm' },
  ])
  assert.deepEqual(
    uniqueRoutes([
      { provider: '', model: 'm' },
      { provider: 'ollama', model: '' },
      { provider: 1, model: 'm' },
      null,
      'x',
      { provider: 'b', model: 'n' },
    ]),
    [{ provider: 'b', model: 'n' }],
  )
})

test('uniqueRoutes does not confuse slashed names', () => {
  const routes = [
    { provider: 'a/b', model: 'c' },
    { provider: 'a', model: 'b/c' },
  ]
  assert.equal(uniqueRoutes(routes).length, 2)
})

test('badgeText tolerates missing badges and throwing resolvers', () => {
  const identity = (text: never) => String(text)
  assert.equal(badgeText(undefined, identity), '')
  assert.equal(badgeText({}, identity), '')
  assert.equal(badgeText({ text: 'New' }, identity), 'New')
  assert.equal(
    badgeText(
      { text: 'Ja' },
      () => {
        throw new Error('nope')
      },
    ),
    '',
  )
})

test('normalizePlacement defaults to a menu row', () => {
  assert.equal(normalizePlacement('trigger'), 'trigger')
  assert.equal(normalizePlacement('option'), 'option')
  assert.equal(normalizePlacement('menu'), 'menu')
  assert.equal(normalizePlacement(undefined), 'menu')
})
