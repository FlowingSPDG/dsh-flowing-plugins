import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'

import type { FavoritesDocument } from '../host/document.ts'
import {
  clampPanelPlacement,
  emptyPending,
  favoriteCount,
  filterCatalog,
  isFavorite,
  mergedWith,
  modelKey,
  normalizeDocument,
  providerFavorite,
  providerLabel,
  recordChange,
  toggled,
} from './favorites.ts'

/** A provider group with bare catalog rows. */
function group(id: string, name: string, ...models: string[]): ModelProviderGroup {
  return { id, name, models: models.map((model) => ({ id: model, name: model })) }
}

/** No favorites. */
function empty(): FavoritesDocument {
  return { providers: [], models: [] }
}

test('modelKey and isFavorite treat a provider star as every model of it', () => {
  const document: FavoritesDocument = { providers: ['ollama-cloud'], models: ['opencode-go/kimi'] }
  assert.equal(modelKey('p', 'm'), 'p/m')
  assert.equal(modelKey('a/b', 'c'), 'a/b/c')
  assert.equal(providerFavorite(document, 'ollama-cloud'), true)
  assert.equal(providerFavorite(document, 'opencode-go'), false)
  assert.equal(isFavorite(document, 'ollama-cloud', 'any'), true)
  assert.equal(isFavorite(document, 'opencode-go', 'kimi'), true)
  assert.equal(isFavorite(document, 'opencode-go', 'gemini'), false)
})

test('toggled adds, removes, and keeps the remaining order', () => {
  assert.deepEqual(toggled([], 'a'), ['a'])
  assert.deepEqual(toggled(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggled(['b', 'a'], 'a'), ['b'])
  assert.deepEqual(toggled(['a'], 'c'), ['a', 'c'])
})

test('the client normalize mirrors the Host one for stored documents', () => {
  assert.deepEqual(normalizeDocument(undefined), empty())
  assert.deepEqual(normalizeDocument('nope'), empty())
  assert.deepEqual(
    normalizeDocument({ providers: [' p ', 'p', '', 4, null], models: ['p/m', 'p/m'] }),
    { providers: ['p'], models: ['p/m'] },
  )
})

test('a local star survives the read that lands after it', () => {
  const before = empty()
  const after: FavoritesDocument = { providers: [], models: ['p/m'] }
  const pending = recordChange(emptyPending(), before, after)
  assert.deepEqual(mergedWith(empty(), pending), after)
  // A stored document that already contains the key stays stable.
  assert.deepEqual(mergedWith(after, pending), after)
})

test('a local unstar survives the read that lands after it', () => {
  const before: FavoritesDocument = { providers: ['p'], models: ['p/m'] }
  const after = empty()
  const pending = recordChange(emptyPending(), before, after)
  assert.deepEqual(mergedWith(before, pending), empty())
  assert.equal(providerFavorite(mergedWith(before, pending), 'p'), false)
})

test('a star and unstar pressed before the Host answers cancel out', () => {
  const start = empty()
  const starred: FavoritesDocument = { providers: [], models: ['p/m'] }
  const addThenRemove = recordChange(recordChange(emptyPending(), start, starred), starred, start)
  // The add is cancelled; the removal remains, so a Host that already stored
  // the key still ends without it.
  assert.equal(addThenRemove.models.adds.size, 0)
  assert.deepEqual([...addThenRemove.models.removals], ['p/m'])
  assert.deepEqual(mergedWith(start, addThenRemove), start)
  assert.deepEqual(mergedWith(starred, addThenRemove), start)
})

test('an unstar then star pressed before the Host answers ends starred', () => {
  const start: FavoritesDocument = { providers: [], models: ['p/m'] }
  const cleared = empty()
  const removeThenAdd = recordChange(recordChange(emptyPending(), start, cleared), cleared, start)
  assert.equal(removeThenAdd.models.adds.size, 1)
  assert.equal(removeThenAdd.models.removals.size, 0)
  assert.deepEqual(mergedWith(start, removeThenAdd), start)
})

test('the chip counts models, and without a catalog counts the saved models only', () => {
  const groups = [group('ollama-cloud', 'Ollama Cloud', 'deepseek', 'glm')]
  assert.equal(favoriteCount({ providers: ['ollama-cloud'], models: ['p/m', 'q/n'] }, []), 2)
  assert.equal(favoriteCount({ providers: ['ollama-cloud'], models: [] }, groups), 2)
  assert.equal(favoriteCount({ providers: [], models: ['ollama-cloud/deepseek'] }, groups), 1)
  assert.equal(favoriteCount(empty(), groups), 0)
})

test('the provider label falls back to the identity', () => {
  assert.equal(providerLabel(group('p', 'Provider P', 'm')), 'Provider P')
})

test('filterCatalog lists the whole catalog with contiguous row indices', () => {
  const groups = [
    group('ollama-cloud', 'Ollama Cloud', 'deepseek', 'glm'),
    group('opencode-go', 'OpenCode Go', 'kimi', 'gemini'),
  ]
  const view = filterCatalog(groups, empty(), 'all', '  ')
  assert.equal(view.query, '')
  assert.equal(view.groups.length, 2)
  assert.deepEqual(view.rows.map((row) => row.model.id), ['deepseek', 'glm', 'kimi', 'gemini'])
  assert.deepEqual(view.rows.map((row) => row.index), [0, 1, 2, 3])
})

test('filterCatalog hides non-favorites in favorites mode and expands a provider star', () => {
  const groups = [
    group('ollama-cloud', 'Ollama Cloud', 'deepseek', 'glm'),
    group('opencode-go', 'OpenCode Go', 'kimi', 'gemini'),
  ]
  const view = filterCatalog(groups, { providers: ['ollama-cloud'], models: [] }, 'favorites', '')
  assert.deepEqual(view.groups.map((entry) => entry.group.id), ['ollama-cloud'])
  assert.deepEqual(view.rows.map((row) => row.model.id), ['deepseek', 'glm'])
  assert.equal(view.groups[0]?.providerFavorite, true)

  const single = filterCatalog(groups, { providers: [], models: ['opencode-go/gemini'] }, 'favorites', '')
  assert.deepEqual(single.rows.map((row) => row.model.id), ['gemini'])
})

test('filterCatalog matches model and provider names case-insensitively', () => {
  const groups = [
    group('ollama-cloud', 'Ollama Cloud', 'DeepSeek', 'GLM'),
    group('opencode-go', 'OpenCode Go', 'kimi', 'gemini'),
  ]
  assert.deepEqual(
    filterCatalog(groups, empty(), 'all', 'DEEP').rows.map((row) => row.model.id),
    ['DeepSeek'],
  )
  assert.deepEqual(
    filterCatalog(groups, empty(), 'all', 'opencode').rows.map((row) => row.model.id),
    ['kimi', 'gemini'],
  )
})

test('filterCatalog reports an empty result and keeps the folded query', () => {
  const groups = [group('p', 'Provider', 'm')]
  const view = filterCatalog(groups, empty(), 'all', '  NOPE  ')
  assert.deepEqual(view.groups, [])
  assert.deepEqual(view.rows, [])
  assert.equal(view.query, 'nope')
})

test('clampPanelPlacement keeps the panel in the window above the chip', () => {
  assert.deepEqual(
    clampPanelPlacement({ left: 100, top: 600 }, { width: 1200, height: 800 }),
    { left: 100, bottom: 208, width: 360, maxHeight: 440 },
  )
  // Near the right edge the panel slides left instead of overflowing.
  assert.deepEqual(
    clampPanelPlacement({ left: 1150, top: 600 }, { width: 1200, height: 800 }),
    { left: 832, bottom: 208, width: 360, maxHeight: 440 },
  )
  // A narrow window floors the width and pins the panel to the left margin.
  assert.deepEqual(
    clampPanelPlacement({ left: 0, top: 500 }, { width: 250, height: 800 }),
    { left: 8, bottom: 308, width: 260, maxHeight: 440 },
  )
  // A chip near the top leaves the panel the shortest allowed height.
  assert.deepEqual(
    clampPanelPlacement({ left: 40, top: 100 }, { width: 800, height: 800 }),
    { left: 40, bottom: 708, width: 360, maxHeight: 220 },
  )
})
