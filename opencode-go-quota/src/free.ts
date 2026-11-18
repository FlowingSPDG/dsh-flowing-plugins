/**
 * Free-model judgement, watch matching, and the limited-time change history.
 *
 * A model counts as free when its published input and output token prices are
 * both zero — the list's own marker for the `* Free` rows — or when its id
 * carries the `-free` naming suffix, so a future listing with non-zero prices
 * on such a row still counts. The watcher keeps its own state across successful
 * reads so the chip can name the watched models' free windows and report what
 * changed since the previous read.
 *
 * @module @local/opencode-go-quota/free
 */

import { asRecord, fieldOf, finite } from './config.ts'
import type { FreeHistoryEntry, FreeModelRow, WatchedModel } from './wire.ts'

/** Newest-first cap on the remembered free-model transitions. */
export const FREE_HISTORY_LIMIT = 24

/** One models-list row after the id/name/canonical pass. */
export interface EnrichedModel {
  /** Untrusted list row, kept for the price fields. */
  raw: Record<string, unknown>
  id: string
  name: string
  canonical: string | null
}

/** The last successful free-model read, kept across failures. */
export interface FreeReading {
  models: FreeModelRow[]
  watched: WatchedModel[]
}

/** The watcher's last successful read plus the diff it produced. */
export interface FreeGoodRead extends FreeReading {
  /** When this read was taken. */
  at: number
  /** Display names seen at this read, for a later removal record. */
  names: Record<string, string>
  /** First-seen timestamps, preserved across reads. */
  firstSeen: Record<string, number>
}

/** Everything the watcher remembers across polls. */
export interface FreeWatchState {
  /** The last successful read; null before the first success. */
  last: FreeGoodRead | null
  /** Models that appeared in the most recent successful read. */
  newFree: FreeModelRow[]
  /** Model ids seen at the last successful read. */
  seenIds: string[]
  /** Remembered transitions, newest first. */
  history: FreeHistoryEntry[]
}

/** A fresh watcher state, before any successful read. */
export function emptyFreeWatch(): FreeWatchState {
  return { last: null, newFree: [], seenIds: [], history: [] }
}

/**
 * Whether a routed model id carries OpenCode's limited-time free suffix.
 * @param modelId - routed model id.
 * @returns true for ids ending in `-free`.
 */
export function hasFreeSuffix(modelId: unknown): boolean {
  return typeof modelId === 'string' && modelId.trim().toLowerCase().endsWith('-free')
}

/**
 * Whether one models-list row is a limited-time free model.
 * @param model - raw models-list entry.
 * @returns true for a published free chat model.
 */
export function isFreeModel(model: unknown): boolean {
  const row = asRecord(model)
  if (row === undefined) return false
  if (hasFreeSuffix(row['id'])) return true
  const cost = asRecord(row['cost'])
  const textCost = asRecord(cost?.['text'])
  if (textCost === undefined) return false
  const inputPrice = fieldOf(textCost['input'], 'price')
  const outputPrice = fieldOf(textCost['output'], 'price')
  return inputPrice === 0 && outputPrice === 0
}

/**
 * Resolve the watched models' current free status from one models-list read.
 * A watch name matches the row's id, the bare name of its canonical id, or the
 * `-free` variant's stripped id, so a limited-time variant published over a
 * paid sibling's canonical id (for example `hy4-flash-free` over
 * `tencent/hy4-flash`) reports that sibling as free while the paid rows keep
 * their prices.
 * @param rows - enriched models-list entries.
 * @param watchModels - configured watch names.
 * @returns one wire row per matched watch name.
 */
export function collectWatched(
  rows: readonly EnrichedModel[],
  watchModels: readonly string[],
): WatchedModel[] {
  const watched: WatchedModel[] = []
  for (const watchName of watchModels) {
    const match = rows.find(
      (row) =>
        row.id === watchName ||
        (row.canonical !== null && row.canonical.split('/').pop() === watchName) ||
        (hasFreeSuffix(row.id) && row.id.slice(0, -'-free'.length) === watchName),
    )
    if (match === undefined) continue
    const free = isFreeModel(match.raw)
    const cost = asRecord(asRecord(match.raw['cost'])?.['text'])
    const inputPrice = finite(asRecord(cost?.['input'])?.['price'])
    const outputPrice = finite(asRecord(cost?.['output'])?.['price'])
    watched.push({
      id: match.id,
      name: match.name,
      canonical: match.canonical,
      free,
      inputPrice: free ? 0 : inputPrice ?? null,
      outputPrice: free ? 0 : outputPrice ?? null,
    })
  }
  return watched
}

/**
 * Fold one successful models-list read into the watcher: new arrivals, gone
 * models, the bounded transition history, and the first-seen stamps.
 *
 * The diff only exists after a first success: the initial read seeds the
 * baseline instead of reporting every free model as new.
 *
 * @param state - watcher state before this read.
 * @param reading - the read's free models and watched statuses.
 * @param now - epoch milliseconds of this read.
 * @returns the next watcher state.
 */
export function applyFreeReading(
  state: FreeWatchState,
  reading: FreeReading,
  now: number,
): FreeWatchState {
  const seeded = state.last !== null
  const fresh = seeded
    ? reading.models.filter((model) => !state.seenIds.includes(model.id))
    : []
  const gone = seeded
    ? state.seenIds.filter((id) => !reading.models.some((model) => model.id === id))
    : []

  const names = state.last?.names ?? {}
  const history = [...state.history]
  for (const model of fresh) {
    history.unshift({ at: now, kind: 'added', id: model.id, name: model.name })
  }
  for (const id of gone) {
    history.unshift({ at: now, kind: 'removed', id, name: names[id] ?? id })
  }

  const firstSeen = { ...(state.last?.firstSeen ?? {}) }
  for (const model of reading.models) {
    if (firstSeen[model.id] === undefined) firstSeen[model.id] = now
  }

  return {
    last: {
      models: reading.models,
      watched: reading.watched,
      at: now,
      names: Object.fromEntries(reading.models.map((model) => [model.id, model.name])),
      firstSeen,
    },
    newFree: fresh,
    seenIds: reading.models.map((model) => model.id),
    history: history.slice(0, FREE_HISTORY_LIMIT),
  }
}
