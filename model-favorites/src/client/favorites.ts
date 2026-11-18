/**
 * Pure helpers behind the favorites chip and panel.
 *
 * They live outside the client entry so `node --test` can exercise them without
 * a browser: no React, no DOM, no locale service, no Host.
 *
 * @module @local/model-favorites/client/favorites
 */

import type {
  ModelCatalogModel,
  ModelProviderGroup,
} from '@deepseek-ai/dsh-api-session-controller/types'

import type { FavoritesDocument } from '../host/document.ts'

/** Locale namespace owned by this bundle. */
export const NS = 'modelFavorites'

/** Host route that owns the favorites document. */
export const ENDPOINT = '/model-favorites/state'

/** Coalesce a burst of toggles into one write. */
export const SAVE_DELAY_MS = 250

/** Which slice of the catalog the panel lists. */
export type CatalogMode = 'favorites' | 'all'

/** `provider/model`, the key an explicit model favorite carries. */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** The provider's display name, falling back to its identity. */
export function providerLabel(group: ModelProviderGroup): string {
  return group.name ?? group.id
}

/** Whether the whole provider is starred. */
export function providerFavorite(document: FavoritesDocument, provider: string): boolean {
  return document.providers.includes(provider)
}

/** A model is a favorite when it or its whole provider is starred. */
export function isFavorite(document: FavoritesDocument, provider: string, model: string): boolean {
  return providerFavorite(document, provider) || document.models.includes(modelKey(provider, model))
}

/** Add or remove one string, keeping the rest in order. */
export function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

/** Keep only well-formed, de-duplicated string lists. */
export function normalizeDocument(value: unknown): FavoritesDocument {
  const pick = (list: unknown): string[] => (Array.isArray(list)
    ? Array.from(new Set(list
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      .map((entry) => entry.trim())))
    : [])
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return { providers: pick(record['providers']), models: pick(record['models']) }
}

/** Local toggles one field carries until the Host confirms them. */
export interface PendingToggles {
  readonly adds: ReadonlySet<string>
  readonly removals: ReadonlySet<string>
}

/** Local toggles for both document fields. */
export interface PendingDocument {
  readonly providers: PendingToggles
  readonly models: PendingToggles
}

/** No pending toggle yet. */
export function emptyPending(): PendingDocument {
  const empty = (): PendingToggles => ({ adds: new Set<string>(), removals: new Set<string>() })
  return { providers: empty(), models: empty() }
}

/**
 * Record what one commit changed, against the document it replaced.
 *
 * A key added and then removed cancels out: the field's pending set holds the
 * user's latest intent, so a star pressed and released before the Host answers
 * is not replayed as an add.
 *
 * @param pending - toggles still unconfirmed.
 * @param previous - the document the commit replaced.
 * @param next - the document the commit installed.
 * @returns the updated toggles.
 */
export function recordChange(
  pending: PendingDocument,
  previous: FavoritesDocument,
  next: FavoritesDocument,
): PendingDocument {
  return {
    providers: changeFor(pending.providers, previous.providers, next.providers),
    models: changeFor(pending.models, previous.models, next.models),
  }
}

/** Replay one field's pending toggles; removals first, then additions. */
function changeFor(
  current: PendingToggles,
  before: readonly string[],
  after: readonly string[],
): PendingToggles {
  const beforeKeys = new Set(before)
  const afterKeys = new Set(after)
  const adds = new Set(current.adds)
  const removals = new Set(current.removals)
  for (const key of afterKeys) {
    if (beforeKeys.has(key)) continue
    adds.add(key)
    removals.delete(key)
  }
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) continue
    removals.add(key)
    adds.delete(key)
  }
  return { adds, removals }
}

/**
 * Replay the pending local toggles over a document read from the Host.
 * @param stored - the document the Host returned.
 * @param pending - toggles still unconfirmed.
 * @returns the effective document this page shows.
 */
export function mergedWith(stored: FavoritesDocument, pending: PendingDocument): FavoritesDocument {
  const merge = (keys: readonly string[], toggles: PendingToggles): string[] => {
    const set = new Set(keys)
    for (const key of toggles.removals) set.delete(key)
    for (const key of toggles.adds) set.add(key)
    return [...set]
  }
  return {
    providers: merge(stored.providers, pending.providers),
    models: merge(stored.models, pending.models),
  }
}

/**
 * How many models the chip counts.
 *
 * With a catalogue loaded this is the number of favorites on screen, a starred
 * provider contributing each of its models. Without one (still loading, or no
 * provider produced a group) no provider can be expanded, so the count falls
 * back to the explicitly starred models: the saved provider stars are not
 * counted as if each were a model.
 *
 * @param document - the effective favorites document.
 * @param groups - the provider groups the catalogue loaded.
 * @returns the chip's count.
 */
export function favoriteCount(
  document: FavoritesDocument,
  groups: readonly ModelProviderGroup[],
): number {
  if (groups.length === 0) return document.models.length
  let total = 0
  for (const group of groups) {
    const starred = providerFavorite(document, group.id)
    for (const model of group.models) {
      if (starred || document.models.includes(modelKey(group.id, model.id))) total += 1
    }
  }
  return total
}

/** One provider's rows inside the panel. */
export interface CatalogViewGroup {
  readonly group: ModelProviderGroup
  readonly providerFavorite: boolean
  readonly models: readonly ModelCatalogModel[]
}

/** One keyboard-addressable row of the panel. */
export interface CatalogRow {
  readonly group: ModelProviderGroup
  readonly model: ModelCatalogModel
  readonly providerFavorite: boolean
  /** Position across the whole view, the index the highlight and Enter address. */
  readonly index: number
}

/** The panel's rows for one mode and query. */
export interface CatalogView {
  /** The query after trimming and case folding. */
  readonly query: string
  readonly groups: readonly CatalogViewGroup[]
  readonly rows: readonly CatalogRow[]
}

/**
 * Filter the catalogue to the panel's rows.
 *
 * A row is listed when it is a favorite (or the panel shows everything) and its
 * model name or provider name contains the query, case-insensitively. Providers
 * without a listed model disappear, and the row indices are contiguous over
 * what remains.
 *
 * @param groups - the directory's provider groups.
 * @param document - the effective favorites document.
 * @param mode - favorites only, or the whole catalogue.
 * @param query - the search field's text.
 * @returns the visible groups and the flat row list.
 */
export function filterCatalog(
  groups: readonly ModelProviderGroup[],
  document: FavoritesDocument,
  mode: CatalogMode,
  query: string,
): CatalogView {
  const normalized = query.trim().toLowerCase()
  const visibleGroups: CatalogViewGroup[] = []
  const rows: CatalogRow[] = []
  for (const group of groups) {
    const starred = providerFavorite(document, group.id)
    const label = providerLabel(group).toLowerCase()
    const models = group.models.filter((model) => {
      if (mode === 'favorites' && !(starred || document.models.includes(modelKey(group.id, model.id)))) {
        return false
      }
      if (normalized === '') return true
      return model.name.toLowerCase().includes(normalized) || label.includes(normalized)
    })
    if (models.length === 0) continue
    visibleGroups.push({ group, providerFavorite: starred, models })
    for (const model of models) {
      rows.push({ group, model, providerFavorite: starred, index: rows.length })
    }
  }
  return { query: normalized, groups: visibleGroups, rows }
}

/** The chip's viewport rectangle, in CSS pixels. */
export interface PanelAnchor {
  readonly left: number
  readonly top: number
}

/** The window the panel must stay inside. */
export interface ViewportSize {
  readonly width: number
  readonly height: number
}

/** Where the portal'd panel sits. */
export interface PanelPlacement {
  readonly left: number
  readonly bottom: number
  readonly width: number
  readonly maxHeight: number
}

/** Narrowest panel, even in a cramped window. */
const PANEL_MIN_WIDTH = 260
/** Widest panel. */
const PANEL_MAX_WIDTH = 360
/** Shortest panel. */
const PANEL_MIN_HEIGHT = 220
/** Tallest panel. */
const PANEL_MAX_HEIGHT = 440
/** Gap kept from the window edges and from the chip. */
const PANEL_GAP = 8

/**
 * Anchor the panel above the chip, clamped into the visual viewport.
 *
 * The composer docks at the bottom of the frame, and a soft keyboard shrinks
 * the viewport without changing `innerHeight` on iOS, so the caller passes the
 * live viewport size rather than reading globals here.
 *
 * @param anchor - the trigger's viewport rectangle.
 * @param viewport - the window's inner size.
 * @returns the fixed-position placement.
 */
export function clampPanelPlacement(anchor: PanelAnchor, viewport: ViewportSize): PanelPlacement {
  const width = Math.min(
    PANEL_MAX_WIDTH,
    Math.max(PANEL_MIN_WIDTH, viewport.width - 2 * PANEL_GAP),
  )
  return {
    left: Math.max(PANEL_GAP, Math.min(anchor.left, viewport.width - width - PANEL_GAP)),
    bottom: Math.max(PANEL_GAP, viewport.height - anchor.top + PANEL_GAP),
    width,
    maxHeight: Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, anchor.top - 24)),
  }
}
