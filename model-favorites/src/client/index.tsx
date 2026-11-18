/**
 * Browser half of Model favorites.
 *
 * A ★ chip sits right after the composer's model selector and opens a picker
 * over the same per-session model directory the shipped selector uses, so a
 * model chosen here is what the composer shows next:
 *
 *   - the catalog filtered to effective favorites (a starred model, or any
 *     model of a starred provider), or the whole catalog for starring;
 *   - one search field over model names and provider names;
 *   - a star per row and per provider header, plus a one-click star for the
 *     model the Session currently uses.
 *
 * The document is owned by the Host half and shared by every browser of this
 * profile: this half reads it on mount and posts the whole document back,
 * debounced and serialized, after each toggle. A read that never succeeded
 * suppresses every write, so a temporarily unreachable Host cannot replace the
 * saved favorites with the empty document this page started from.
 *
 * The panel is a portal onto `document.body`, so the composer's docked bar never
 * needs to expand: `onActiveChange` is intentionally not called.
 *
 * @module @local/model-favorites/client/index
 */

import * as React from 'react'
import { createPortal } from 'react-dom'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'

import type { FavoritesDocument } from '../host/document.ts'
import {
  ENDPOINT,
  NS,
  SAVE_DELAY_MS,
  clampPanelPlacement,
  emptyPending,
  favoriteCount,
  filterCatalog,
  isFavorite,
  mergedWith,
  modelKey,
  normalizeDocument,
  providerLabel,
  recordChange,
  toggled,
  type CatalogMode,
  type PanelPlacement,
  type PendingDocument,
} from './favorites.ts'

/** Japanese copy. The key set here is the namespace's type source. */
const ja = {
  'trigger.label': 'お気に入りモデル',
  'trigger.aria': 'お気に入りモデルを開く（{count}件）',
  'trigger.locked': 'このセッションではモデルを切り替えられません',
  'panel.title': 'お気に入りモデル',
  'search.placeholder': 'モデル名・プロバイダーで検索',
  'search.clear': '検索をクリア',
  'mode.favorites': '★ お気に入り',
  'mode.all': 'すべて',
  'quick.add': '現在のモデルを★：{model}',
  'fav.model': 'お気に入りに追加',
  'fav.modelOn': 'お気に入りから外す',
  'fav.provider': 'このプロバイダーを★',
  'fav.providerOn': 'このプロバイダーの★を外す',
  'fav.providerChild': 'プロバイダーが★のため、個別には外せません',
  'empty.favorites': 'お気に入りはまだありません。「すべて」で☆を押すと追加できます。',
  'empty.search': '一致するモデルがありません',
  'empty.models': '利用できるモデルがありません',
  'status.loading': 'モデル一覧を読み込み中…',
  'current': '選択中',
  'error.select': '選択できませんでした：{message}',
  'error.sessionInUse': 'このセッションは別の書き込みが進行中です',
  'error.catalog': 'モデル一覧を読み込めませんでした：{message}',
  'error.storage': 'お気に入りを保存できませんでした',
} as const

/** One dictionary key of this bundle's namespace. */
type FavoritesKey = keyof typeof ja

/** English copy, checked complete against the Japanese key set. */
const en: Record<FavoritesKey, string> = {
  'trigger.label': 'Favorite models',
  'trigger.aria': 'Open favorite models ({count})',
  'trigger.locked': 'Models cannot be switched in this session',
  'panel.title': 'Favorite models',
  'search.placeholder': 'Search model or provider',
  'search.clear': 'Clear search',
  'mode.favorites': '★ Favorites',
  'mode.all': 'All',
  'quick.add': 'Star the current model: {model}',
  'fav.model': 'Add to favorites',
  'fav.modelOn': 'Remove from favorites',
  'fav.provider': 'Star every model of this provider',
  'fav.providerOn': 'Unstar this provider',
  'fav.providerChild': 'The provider is starred, so this model cannot be unstarred alone',
  'empty.favorites': 'No favorites yet. Switch to All and press ☆ to add one.',
  'empty.search': 'No matching model',
  'empty.models': 'No model is available',
  'status.loading': 'Loading the model catalog…',
  'current': 'Selected',
  'error.select': 'Could not select: {message}',
  'error.sessionInUse': 'Another write is in progress in this session',
  'error.catalog': 'The model catalog could not be loaded: {message}',
  'error.storage': 'The favorites could not be saved',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The favorites chip and panel copy. */
    modelFavorites: FavoritesKey
  }
}

/** Chip, panel, and row styling: theme tokens only, radius from the theme. */
const CSS = `
.mf-root { display: inline-flex; align-items: center; }
.mf-trigger {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 28px; min-width: 28px; padding: 0 6px; border: none; cursor: pointer;
  border-radius: var(--dsw-radius-sm, 8px); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; font-weight: 400;
}
.mf-trigger:disabled { cursor: default; opacity: .55; }
.mf-trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mf-trigger[data-active] { color: var(--dsw-alias-brand-primary); }
@media (hover: hover) {
  .mf-trigger:hover:enabled { background: var(--dsw-alias-interactive-bg-hover); }
}
.mf-count { font-size: 11px; line-height: 16px; }
.mf-trigger[data-active] .mf-count { color: var(--dsw-alias-brand-primary); }

.mf-panel {
  position: fixed; z-index: 1100; box-sizing: border-box; display: flex; flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent));
  color: var(--dsw-alias-label-primary); overflow: hidden;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.mf-head { display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.mf-search-row { position: relative; display: flex; align-items: center; }
.mf-search {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 26px 0 9px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 18px; outline: none;
}
@media (pointer: coarse) { .mf-search { font-size: 16px; } }
.mf-search::placeholder { color: var(--dsw-alias-label-secondary); }
.mf-search:focus { border-color: var(--dsw-alias-border-l2); }
.mf-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
}
@media (hover: hover) { .mf-clear:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.mf-modes { display: flex; gap: 4px; }
.mf-mode {
  flex: 1 1 auto; height: 26px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit;
  font-size: 12px; line-height: 18px; cursor: pointer;
}
.mf-mode[data-active] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.mf-mode:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mf-quick {
  display: flex; align-items: center; gap: 6px; width: calc(100% - 12px); margin: 6px 6px 0;
  padding: 6px 8px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit;
  font-size: 12px; line-height: 17px; text-align: left; cursor: pointer;
}
.mf-quick:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mf-quick-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mf-groups { overflow-y: auto; padding: 4px 4px 6px; overscroll-behavior: contain; }
.mf-group { padding-top: 2px; }
.mf-group-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 2px 8px; }
.mf-provider { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.mf-star {
  flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: none; border-radius: var(--dsw-radius-sm, 8px);
  display: inline-flex; align-items: center; justify-content: center; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.mf-star[data-on] { color: var(--dsw-alias-brand-primary); }
.mf-star:disabled { cursor: default; opacity: .5; }
@media (hover: hover) { .mf-star:hover:enabled { background: var(--dsw-alias-interactive-bg-hover); } }
.mf-star:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mf-row { display: flex; align-items: center; gap: 2px; border-radius: var(--dsw-radius-sm, 8px); }
.mf-row[data-active] { background: var(--dsw-alias-interactive-bg-hover); }
.mf-row-main {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 4px 0 8px; border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit;
  font-size: 13px; line-height: 20px; text-align: left; cursor: pointer;
}
.mf-row-main[disabled] { cursor: default; opacity: .6; }
.mf-row-main:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mf-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mf-check { flex: 0 0 auto; font-size: 11px; line-height: 16px; color: var(--dsw-alias-brand-primary); }
.mf-empty { padding: 14px 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 17px; }
.mf-failure { margin: 2px 6px 4px; padding: 4px 8px; border-radius: var(--dsw-radius-sm, 8px); font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mf-error { margin: 0 6px 8px; padding: 6px 8px; border-radius: var(--dsw-radius-sm, 8px); font-size: 12px; line-height: 17px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
`

/** Directory snapshot for a session without a directory. */
const EMPTY_DIRECTORY: ModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  pending: null,
  error: null,
}

/** Human-readable failure text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Star glyph: filled for a favorite, outlined otherwise. */
function StarGlyph({ filled }: { readonly filled: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" focusable="false">
      <path
        d="M8 1.8l1.85 3.75 4.13.6-2.99 2.91.71 4.1L8 11.23l-3.7 1.93.71-4.1L2.02 6.15l4.13-.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.4}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** What the chip and panel render from the Host document. */
export interface FavoritesSnapshot {
  /** The effective document: the Host's, with this page's unconfirmed toggles replayed. */
  readonly document: FavoritesDocument
  /** Whether a read has succeeded; until it does, this page may not write. */
  readonly synced: boolean
  /** Whether the latest write failed. */
  readonly saveFailed: boolean
}

/** The page's one favorites document, shared by the chip and the panel. */
export interface FavoritesStore {
  /** uSES subscribe side. */
  subscribe(listener: () => void): () => void
  /** uSES snapshot side; the reference changes only when a rendered value does. */
  getSnapshot(): FavoritesSnapshot
  /** Read the Host document; `force` re-reads after a successful read. */
  load(options?: { readonly force?: boolean }): Promise<boolean>
  /** Replace the document locally, then post it after a short quiet period. */
  commit(next: FavoritesDocument): void
  /** Write any pending change before the page goes away. */
  flushNow(): void
  /** Release the timer and every subscriber. */
  dispose(): void
}

/** Store construction options. */
export interface FavoritesStoreOptions {
  /** Host route; defaults to {@link ENDPOINT}. */
  readonly endpoint?: string
  /** Quiet period before a toggle is posted; defaults to {@link SAVE_DELAY_MS}. */
  readonly saveDelayMs?: number
}

/**
 * Create the page's favorites document store.
 *
 * A read that lands while local toggles are unconfirmed replays them over the
 * stored document, so a star the user pressed — and a star the user removed —
 * both survive the arriving read. Writes are serialized and every write carries
 * the whole document: the last write to arrive wins, which is the API contract
 * this route has.
 *
 * @param options - endpoint override and debounce tuning.
 * @returns the store.
 */
export function createFavoritesStore(options: FavoritesStoreOptions = {}): FavoritesStore {
  const endpoint = options.endpoint ?? ENDPOINT
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS

  let currentDocument: FavoritesDocument = { providers: [], models: [] }
  let pending: PendingDocument = emptyPending()
  let synced = false
  let dirty = false
  let saveFailed = false
  let loadStarted: Promise<boolean> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let postChain: Promise<void> = Promise.resolve()
  let disposed = false
  const listeners = new Set<() => void>()
  let snapshot: FavoritesSnapshot = { document: currentDocument, synced, saveFailed }

  /** Publish the current values to every subscriber. */
  function publish(): void {
    snapshot = { document: currentDocument, synced, saveFailed }
    for (const listener of [...listeners]) listener()
  }

  /** Read the Host document once, sharing an in-flight read. */
  function load(loadOptions: { readonly force?: boolean } = {}): Promise<boolean> {
    if (loadStarted !== null) return loadStarted
    if (synced && loadOptions.force !== true) return Promise.resolve(true)
    loadStarted = (async () => {
      try {
        const response = await fetch(endpoint, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        const value: unknown = await response.json()
        const stored = normalizeDocument(value)
        currentDocument = dirty ? mergedWith(stored, pending) : stored
        synced = true
        publish()
        return true
      } catch {
        return false
      } finally {
        loadStarted = null
      }
    })()
    return loadStarted
  }

  /** Post the current document, one at a time and in order. */
  function flush(keepalive = false): Promise<void> {
    const payload = JSON.stringify(currentDocument)
    postChain = postChain
      .then(() => fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive,
      }))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        pending = emptyPending()
        dirty = false
        if (saveFailed) {
          saveFailed = false
          publish()
        }
      })
      .catch(() => {
        if (!saveFailed) {
          saveFailed = true
          publish()
        }
      })
    return postChain
  }

  /** Replace the document locally, then post it after a short quiet period. */
  function commit(next: FavoritesDocument): void {
    if (disposed) return
    pending = recordChange(pending, currentDocument, next)
    dirty = true
    currentDocument = next
    publish()
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void (async () => {
        if (!synced && !await load()) {
          if (!saveFailed) {
            saveFailed = true
            publish()
          }
          return
        }
        await flush()
      })()
    }, saveDelayMs)
  }

  /** Write any pending change before the page goes away. */
  function flushNow(): void {
    if (saveTimer === null) return
    clearTimeout(saveTimer)
    saveTimer = null
    if (!synced) return
    void flush(true)
  }

  /** Release the debounce timer and every subscriber. */
  function dispose(): void {
    disposed = true
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    listeners.clear()
  }

  /** Register one uSES listener; the disposer removes exactly it. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** The current snapshot, stable between renders that see no change. */
  function getSnapshot(): FavoritesSnapshot {
    return snapshot
  }

  return { subscribe, getSnapshot, load, commit, flushNow, dispose }
}

/**
 * The slice of the Client Session layer this chip reads. The concrete service
 * registered under `sessions` differs per composition (the API controller's
 * `ISessions` at runtime, the UI store in some builds), so only the one optional
 * method actually consulted is named here.
 */
export interface SessionsFace {
  subagentAddress?: (sessionId: string) => unknown
}

/** The Client services the chip reads. */
export interface FavoritesServices {
  /** The page's one favorites document. */
  readonly store: FavoritesStore
  /** The shared per-session model directories. */
  readonly models: ModelDirectoryResolver
  /** The Session object layer; absent in a composition without it. */
  readonly sessions: SessionsFace | undefined
}

/** Props the activity slot hands its occupant. */
type ActivityProps = PropsRuntime<'conversation.input.activity'> & PropsLocale<typeof NS>

/**
 * Build the composer chip over the shared model directory.
 * @param services - the Client services the chip reads.
 * @returns the slot component.
 */
export function createActivity(
  services: FavoritesServices,
): (props: ActivityProps) => React.JSX.Element | null {
  const { store, models, sessions } = services

  return function ModelFavorites(props: ActivityProps): React.JSX.Element | null {
    const { t, sessionId } = props
    const locked = props.locked
    const id = React.useId()
    const panelId = `mf-${id.replaceAll(':', '')}`

    // Resolved on every render: the directory exists once the Session has a
    // scope and a binding, which can happen after the first paint.
    let directory: ReturnType<ModelDirectoryResolver['directoryFor']> | null = null
    try {
      directory = models.directoryFor(sessionId)
    } catch {
      directory = null
    }

    // A subagent's Session cannot switch its own model, so the chip stays out
    // of its composer entirely.
    const available = directory !== null
      && (sessions === undefined
        || typeof sessions.subagentAddress !== 'function'
        || sessions.subagentAddress(sessionId) === undefined)

    const favorites = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
    const state = React.useSyncExternalStore(
      React.useCallback(
        (listener: () => void) => (directory === null ? () => {} : directory.store.subscribe(listener)),
        [directory],
      ),
      React.useCallback(
        () => (directory === null ? EMPTY_DIRECTORY : directory.store.getSnapshot()),
        [directory],
      ),
    )

    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [mode, setMode] = React.useState<CatalogMode>('favorites')
    const [highlight, setHighlight] = React.useState(0)
    const [selectError, setSelectError] = React.useState<string | null>(null)
    const [placement, setPlacement] = React.useState<PanelPlacement | null>(null)

    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const triggerRef = React.useRef<HTMLButtonElement | null>(null)
    const panelRef = React.useRef<HTMLDivElement | null>(null)
    const itemRefs = React.useRef<Array<HTMLDivElement | null>>([])

    const loadCatalog = React.useCallback((target: typeof directory): void => {
      if (target === null) return
      try {
        void target.load().catch(() => { /* the panel surfaces the failure */ })
      } catch {
        // A subagent session has no catalog to load.
      }
    }, [])

    React.useEffect(() => {
      void store.load()
      loadCatalog(directory)
    }, [directory, loadCatalog, store])

    React.useEffect(() => {
      const onPageHide = (): void => {
        store.flushNow()
      }
      window.addEventListener('pagehide', onPageHide)
      return () => {
        window.removeEventListener('pagehide', onPageHide)
      }
    }, [store])

    const close = React.useCallback((restoreFocus = false): void => {
      setOpen(false)
      setQuery('')
      setHighlight(0)
      setSelectError(null)
      if (restoreFocus) {
        queueMicrotask(() => {
          triggerRef.current?.focus()
        })
      }
    }, [])

    const openPanel = (): void => {
      setOpen(true)
      setQuery('')
      setHighlight(0)
      setSelectError(null)
      // A user with no favorites yet lands on the full catalog, the only pane
      // where a star can be added; everyone else lands on favorites.
      const starredYet = favorites.document.models.length > 0
        || favorites.document.providers.length > 0
        || state.groups.some((group) => group.models.some(
          (model) => isFavorite(favorites.document, group.id, model.id),
        ))
      setMode(starredYet ? 'favorites' : 'all')
      void store.load({ force: true })
      loadCatalog(directory)
    }

    // Anchor the panel above the chip, clamped into the visual viewport: the
    // composer docks at the bottom of the frame, and a soft keyboard shrinks the
    // viewport without changing innerHeight on iOS.
    React.useLayoutEffect(() => {
      if (!open) {
        setPlacement(null)
        return undefined
      }
      const viewport = window.visualViewport
      const update = (): void => {
        const trigger = triggerRef.current
        if (trigger === null) return
        const rect = trigger.getBoundingClientRect()
        setPlacement(clampPanelPlacement(
          { left: rect.left, top: rect.top },
          { width: window.innerWidth, height: window.innerHeight },
        ))
      }
      update()
      window.addEventListener('resize', update)
      window.addEventListener('scroll', update, true)
      viewport?.addEventListener('resize', update)
      viewport?.addEventListener('scroll', update)
      return () => {
        window.removeEventListener('resize', update)
        window.removeEventListener('scroll', update, true)
        viewport?.removeEventListener('resize', update)
        viewport?.removeEventListener('scroll', update)
      }
    }, [open])

    // The search field focuses itself when it mounts: the panel mounts a commit
    // after `open`, so an effect keyed on `open` would run before the field exists.
    const searchRef = React.useCallback((node: HTMLInputElement | null): void => {
      if (node === null) return
      if (window.matchMedia?.('(pointer: coarse)').matches === true) return
      node.focus()
    }, [])

    React.useEffect(() => {
      if (!open) return undefined
      const outside = (event: MouseEvent): void => {
        const target = event.target
        if (target instanceof Node) {
          if (rootRef.current?.contains(target) === true) return
          if (panelRef.current?.contains(target) === true) return
        }
        close()
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        close(true)
      }
      document.addEventListener('mousedown', outside)
      document.addEventListener('keydown', onKeyDown)
      return () => {
        document.removeEventListener('mousedown', outside)
        document.removeEventListener('keydown', onKeyDown)
      }
    }, [open, close])

    const groups = state.groups
    const current = state.current
    const currentGroup = current === null
      ? undefined
      : groups.find((group) => group.id === current.provider)
    const currentModel = currentGroup?.models.find((model) => model.id === current?.model)

    const view = filterCatalog(groups, favorites.document, mode, query)
    const count = favoriteCount(favorites.document, groups)
    const busy = state.pending !== null || state.status === 'selecting'
    const activeIndex = view.rows.length === 0
      ? -1
      : Math.min(highlight, view.rows.length - 1)

    const fail = (error: unknown): void => {
      setSelectError(t('error.select', { message: messageOf(error) }))
    }

    const toggleModel = (provider: string, model: string): void => {
      store.commit({
        ...favorites.document,
        models: toggled(favorites.document.models, modelKey(provider, model)),
      })
    }

    const toggleProvider = (provider: string): void => {
      store.commit({
        ...favorites.document,
        providers: toggled(favorites.document.providers, provider),
      })
    }

    const choose = (group: ModelProviderGroup, model: ModelCatalogModel): void => {
      if (busy || directory === null) return
      const sameSelection = current !== null
        && current.provider === group.id
        && current.model === model.id
      const effort = current !== null && sameSelection
        ? current.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      const selection: ModelSelection = {
        provider: group.id,
        model: model.id,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      setSelectError(null)
      let settled: Promise<Awaited<ReturnType<typeof directory.select>>>
      try {
        settled = directory.select(selection)
      } catch (error) {
        fail(error)
        return
      }
      void settled.then((result) => {
        if (result.ok) {
          close(true)
          return
        }
        setSelectError(result.error.code === 'session/writer-held'
          ? t('error.sessionInUse')
          : t('error.select', { message: `${result.error.code}: ${result.error.message}` }))
      }).catch(fail)
    }

    const moveHighlight = (offset: number): void => {
      if (view.rows.length === 0) return
      const next = (Math.max(0, activeIndex) + offset + view.rows.length) % view.rows.length
      setHighlight(next)
      itemRefs.current[next]?.scrollIntoView({ block: 'nearest' })
    }

    const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.nativeEvent.isComposing) return
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
      }
    }

    const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Enter') {
        const row = view.rows[activeIndex]
        if (row === undefined) return
        event.preventDefault()
        choose(row.group, row.model)
      }
    }

    if (!available) return null

    const emptyText = state.status === 'loading' && groups.length === 0
      ? t('status.loading')
      : groups.length === 0
        ? t('empty.models')
        : mode === 'favorites' && view.query === ''
          ? t('empty.favorites')
          : t('empty.search')

    const notice = selectError
      ?? (favorites.saveFailed ? t('error.storage') : null)
      ?? (state.error !== null && state.status === 'error'
        ? t('error.catalog', { message: state.error })
        : null)

    let rowIndex = 0

    return (
      <div className="mf-root" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className="mf-trigger"
          data-active={count > 0 ? '' : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('trigger.aria', { count: String(count) })}
          title={locked ? t('trigger.locked') : t('trigger.label')}
          disabled={locked}
          onClick={() => {
            if (open) close(true)
            else openPanel()
          }}
        >
          <StarGlyph filled={count > 0} />
          {count > 0 ? <span className="mf-count">{String(count)}</span> : null}
        </button>

        {open && placement !== null ? createPortal(
          <div
            ref={panelRef}
            className="mf-panel"
            role="dialog"
            aria-label={t('panel.title')}
            data-model-favorites=""
            style={{
              left: `${String(placement.left)}px`,
              bottom: `${String(placement.bottom)}px`,
              width: `${String(placement.width)}px`,
              maxHeight: `${String(placement.maxHeight)}px`,
            }}
            onKeyDown={onPanelKeyDown}
          >
            <div className="mf-head">
              <div className="mf-search-row">
                <input
                  ref={searchRef}
                  className="mf-search"
                  type="search"
                  value={query}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')}
                  aria-controls={`${panelId}-rows`}
                  aria-activedescendant={activeIndex < 0 ? undefined : `${panelId}-row-${String(activeIndex)}`}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setHighlight(0)
                  }}
                  onKeyDown={onSearchKeyDown}
                />
                {query === '' ? null : (
                  <button
                    type="button"
                    className="mf-clear"
                    aria-label={t('search.clear')}
                    onClick={() => {
                      setQuery('')
                      panelRef.current?.querySelector<HTMLInputElement>('.mf-search')?.focus()
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="mf-modes">
                <button
                  type="button"
                  className="mf-mode"
                  data-active={mode === 'favorites' ? '' : undefined}
                  aria-pressed={mode === 'favorites'}
                  onClick={() => {
                    setMode('favorites')
                    setHighlight(0)
                  }}
                >
                  {t('mode.favorites')}
                </button>
                <button
                  type="button"
                  className="mf-mode"
                  data-active={mode === 'all' ? '' : undefined}
                  aria-pressed={mode === 'all'}
                  onClick={() => {
                    setMode('all')
                    setHighlight(0)
                  }}
                >
                  {t('mode.all')}
                </button>
              </div>
            </div>

            {currentModel === undefined || current === null
              || isFavorite(favorites.document, current.provider, currentModel.id)
              ? null
              : (
                <button
                  type="button"
                  className="mf-quick"
                  disabled={busy}
                  onClick={() => {
                    toggleModel(current.provider, currentModel.id)
                  }}
                >
                  <StarGlyph filled={false} />
                  <span className="mf-quick-text">{t('quick.add', { model: currentModel.name })}</span>
                </button>
              )}

            {state.failures.map((failure) => (
              <div className="mf-failure" key={`failure-${failure.id}`} role="status">
                {t('error.catalog', { message: `${failure.name}: ${failure.message}` })}
              </div>
            ))}

            <div
              className="mf-groups"
              id={`${panelId}-rows`}
              role="menu"
              aria-busy={busy}
            >
              {view.groups.length === 0
                ? <div className="mf-empty" role="status">{emptyText}</div>
                : view.groups.map(({ group, providerFavorite, models: listed }) => (
                  <div className="mf-group" key={group.id}>
                    <div className="mf-group-head">
                      <span className="mf-provider" title={providerLabel(group)}>{providerLabel(group)}</span>
                      <button
                        type="button"
                        className="mf-star"
                        data-on={providerFavorite ? '' : undefined}
                        aria-pressed={providerFavorite}
                        aria-label={providerFavorite ? t('fav.providerOn') : t('fav.provider')}
                        title={providerFavorite ? t('fav.providerOn') : t('fav.provider')}
                        onClick={() => {
                          toggleProvider(group.id)
                        }}
                      >
                        <StarGlyph filled={providerFavorite} />
                      </button>
                    </div>
                    {listed.map((model) => {
                      const index = rowIndex
                      rowIndex += 1
                      const selected = current !== null
                        && current.provider === group.id
                        && current.model === model.id
                      const ownStar = favorites.document.models.includes(modelKey(group.id, model.id))
                      const starred = providerFavorite || ownStar
                      return (
                        <div
                          className="mf-row"
                          key={model.id}
                          id={`${panelId}-row-${String(index)}`}
                          data-active={index === activeIndex ? '' : undefined}
                          ref={(node) => {
                            itemRefs.current[index] = node
                          }}
                          onMouseMove={() => {
                            if (index !== activeIndex) setHighlight(index)
                          }}
                        >
                          <button
                            type="button"
                            className="mf-row-main"
                            role="menuitemradio"
                            aria-checked={selected}
                            disabled={busy}
                            title={model.name}
                            onClick={() => {
                              choose(group, model)
                            }}
                          >
                            <span className="mf-name">{model.name}</span>
                            {selected ? <span className="mf-check">{t('current')}</span> : null}
                          </button>
                          <button
                            type="button"
                            className="mf-star"
                            data-on={starred ? '' : undefined}
                            aria-pressed={starred}
                            disabled={providerFavorite}
                            aria-label={providerFavorite
                              ? t('fav.providerChild')
                              : starred ? t('fav.modelOn') : t('fav.model')}
                            title={providerFavorite
                              ? t('fav.providerChild')
                              : starred ? t('fav.modelOn') : t('fav.model')}
                            onClick={() => {
                              if (!providerFavorite) toggleModel(group.id, model.id)
                            }}
                          >
                            <StarGlyph filled={starred} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
            </div>

            {notice === null ? null : <div className="mf-error" role="alert">{notice}</div>}
          </div>,
          document.body,
        ) : null}
      </div>
    )
  }
}

/**
 * Runtime identity the single-slot option type omits, carried for diagnostics.
 *
 * The slot registry records `id`/`order` on every entry; the typed options for a
 * `single` slot expose only `priority`, so the pair rides in through a spread.
 */
const REGISTRATION_IDENTITY = { id: 'model-favorites', order: 10 } as const

/**
 * Install the chip: styles, dictionaries, the document store, and the single
 * activity slot contribution.
 *
 * @param ctx - the Client plugin context.
 */
export function mountFavorites(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset['dshPlugin'] = '@local/model-favorites'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'model-favorites: styles')

  ctx.effect(() => {
    const disposeJa = ctx.locale.register(NS, 'ja', ja)
    const disposeEn = ctx.locale.register(NS, 'en', en)
    return () => {
      disposeJa()
      disposeEn()
    }
  }, 'model-favorites: dictionaries')

  const store = createFavoritesStore()
  ctx.effect(() => () => {
    store.dispose()
  }, 'model-favorites: favorites document')

  ctx.inject(['modelDirectories'], (scope) => {
    const activity = createActivity({
      store,
      models: scope.modelDirectories,
      // The Client registers the API controller's Session face under this name;
      // its declared type depends on which Session packages a build merges, so
      // the chip narrows it to the one method it reads.
      sessions: scope.get('sessions') as unknown as SessionsFace | undefined,
    })
    // The composer declares an empty single slot right after the model
    // selector, meant for a compact action of exactly this shape; the chip owns
    // that seat and leaves every shipped control in place. The panel is a portal,
    // so `onActiveChange` is deliberately never called.
    scope.slots.inject('conversation.input.activity', () => scope.slots.register({
      name: 'conversation.input.activity',
      ...REGISTRATION_IDENTITY,
      locale: NS,
    }, activity))
  })
}
