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
 * @module @local/model-favorites/client
 */

window.__ModuleLoader__.load({
  id: '@local/model-favorites',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'modelFavorites'

    /** Host route that owns the favorites document. */
    const ENDPOINT = '/model-favorites/state'

    /** Coalesce a burst of toggles into one write. */
    const SAVE_DELAY_MS = 250

    /** Stable empty directory snapshot for a session without a directory. */
    const EMPTY_DIRECTORY = {
      current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null,
    }

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
    }

    const en = {
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
.mf-error { margin: 0 6px 8px; padding: 6px 8px; border-radius: var(--dsw-radius-sm, 8px); font-size: 12px; line-height: 17px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
`

    /** Star glyph: filled for a favorite, outlined otherwise. */
    function StarGlyph({ filled }) {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false',
      }, h('path', {
        d: 'M8 1.8l1.85 3.75 4.13.6-2.99 2.91.71 4.1L8 11.23l-3.7 1.93.71-4.1L2.02 6.15l4.13-.6z',
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: filled ? 0 : 1.4,
        strokeLinejoin: 'round',
      }))
    }

    // ---- favorites document -------------------------------------------------
    // One module-level copy: the chip, the panel, and the Host document are the
    // same state. `synced` records that a read succeeded; until it does, this
    // page holds no authority to replace what the Host stored.

    let favoritesDocument = { providers: [], models: [] }
    let loadStarted = null
    let synced = false
    let dirty = false
    let saveTimer = null
    let saveFailed = false
    let postChain = Promise.resolve()
    const listeners = new Set()

    // Local toggles not yet confirmed by the Host. A read that lands while they
    // are pending replays them over the stored document, so a star the user
    // pressed — and a star the user removed — both survive the arriving read.
    const pendingAdds = { providers: new Set(), models: new Set() }
    const pendingRemovals = { providers: new Set(), models: new Set() }

    function normalizeDocument(value) {
      const pick = (list) => Array.isArray(list)
        ? Array.from(new Set(list.filter(entry => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())))
        : []
      return { providers: pick(value?.providers), models: pick(value?.models) }
    }

    function emit() {
      for (const listener of Array.from(listeners)) listener()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    function snapshot() {
      return favoritesDocument
    }

    /** Record what one commit changed, against the document it replaced. */
    function recordChange(previous, next) {
      for (const field of ['providers', 'models']) {
        for (const key of next[field]) if (!previous[field].includes(key)) pendingAdds[field].add(key)
        for (const key of previous[field]) if (!next[field].includes(key)) pendingRemovals[field].add(key)
      }
    }

    /** Replay the pending local toggles over a document read from the Host. */
    function mergedWith(stored) {
      const join = (field) => {
        const set = new Set(stored[field])
        for (const key of pendingRemovals[field]) set.delete(key)
        for (const key of pendingAdds[field]) set.add(key)
        return [...set]
      }
      return { providers: join('providers'), models: join('models') }
    }

    /** The Host document now includes every pending toggle. */
    function clearPending() {
      for (const field of ['providers', 'models']) {
        pendingAdds[field].clear()
        pendingRemovals[field].clear()
      }
    }

    /**
     * Read the Host document.
     * @param options - `force` re-reads even after a successful read.
     * @returns whether the document is now known.
     */
    function load(options = {}) {
      if (loadStarted !== null) return loadStarted
      if (synced && options.force !== true) return Promise.resolve(true)
      loadStarted = (async () => {
        try {
          const response = await fetch(ENDPOINT, { credentials: 'same-origin', headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const value = await response.json()
          const stored = normalizeDocument(value)
          favoritesDocument = dirty ? mergedWith(stored) : stored
          emit()
          synced = true
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
    function flush(keepalive = false) {
      const payload = JSON.stringify(favoritesDocument)
      postChain = postChain.then(() => fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive,
      })).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        clearPending()
        dirty = false
        if (saveFailed) {
          saveFailed = false
          emit()
        }
      }).catch(() => {
        if (!saveFailed) {
          saveFailed = true
          emit()
        }
      })
      return postChain
    }

    /**
     * Replace the document locally, then post it after a short quiet period.
     * @param next - the new document.
     */
    function commit(next) {
      recordChange(favoritesDocument, next)
      dirty = true
      favoritesDocument = next
      emit()
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        void (async () => {
          if (!synced && !await load()) {
            if (!saveFailed) {
              saveFailed = true
              emit()
            }
            return
          }
          await flush()
        })()
      }, SAVE_DELAY_MS)
    }

    /** Write any pending change before the page goes away. */
    function flushNow() {
      if (saveTimer === null) return
      clearTimeout(saveTimer)
      saveTimer = null
      if (!synced) return
      void flush(true)
    }

    /** `provider/model`, the key an explicit model favorite carries. */
    function modelKey(provider, model) {
      return `${provider}/${model}`
    }

    /** A model is a favorite when it or its whole provider is starred. */
    function isFavorite(value, provider, model) {
      return value.providers.includes(provider) || value.models.includes(modelKey(provider, model))
    }

    /** Add or remove one string. */
    function toggled(list, value) {
      return list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]
    }

    /**
     * Build the composer chip over the shared model directory.
     * @param services - the Client services the chip reads.
     * @returns the slot component.
     */
    function makeModelFavorites(services) {
      const { models: modelDirectories, sessions } = services

      return function ModelFavorites(props) {
        const { t, sessionId } = props
        const locked = props.locked === true
        const id = React.useId()
        const panelId = `mf-${id.replaceAll(':', '')}`

        // Resolved on every render: the directory exists once the Session has
        // a scope and a binding, which can happen after the first paint.
        let directory = null
        try {
          directory = modelDirectories.directoryFor(sessionId)
        } catch {
          directory = null
        }

        const available = directory !== null
          && (typeof sessions?.subagentAddress !== 'function' || sessions.subagentAddress(sessionId) === undefined)

        const favorites = React.useSyncExternalStore(subscribe, snapshot)
        const state = React.useSyncExternalStore(
          React.useCallback(
            listener => (directory === null ? () => {} : directory.store.subscribe(listener)),
            [directory],
          ),
          React.useCallback(
            () => (directory === null ? EMPTY_DIRECTORY : directory.store.getSnapshot()),
            [directory],
          ),
        )

        const [open, setOpen] = React.useState(false)
        const [query, setQuery] = React.useState('')
        const [mode, setMode] = React.useState('favorites')
        const [highlight, setHighlight] = React.useState(0)
        const [selectError, setSelectError] = React.useState(null)
        const [placement, setPlacement] = React.useState(null)

        const rootRef = React.useRef(null)
        const triggerRef = React.useRef(null)
        const panelRef = React.useRef(null)
        const itemRefs = React.useRef([])

        React.useEffect(() => {
          void load()
          if (directory === null) return
          try {
            void directory.load().catch(() => { /* the panel surfaces the failure */ })
          } catch { /* a subagent session has no catalog to load */ }
        }, [directory])

        React.useEffect(() => {
          const onPageHide = () => { flushNow() }
          window.addEventListener('pagehide', onPageHide)
          return () => { window.removeEventListener('pagehide', onPageHide) }
        }, [])

        const close = React.useCallback((restoreFocus = false) => {
          setOpen(false)
          setQuery('')
          setHighlight(0)
          setSelectError(null)
          if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
        }, [])

        const openPanel = () => {
          setOpen(true)
          setQuery('')
          setHighlight(0)
          setSelectError(null)
          // A user with no favorites yet lands on the full catalog, the only
          // pane where a star can be added; everyone else lands on favorites.
          const starredYet = favorites.models.length > 0
            || favorites.providers.length > 0
            || state.groups.some(group => group.models.some(model => isFavorite(favorites, group.id, model.id)))
          setMode(starredYet ? 'favorites' : 'all')
          void load({ force: true })
          if (directory !== null) {
            try {
              void directory.load().catch(() => { /* the panel surfaces the failure */ })
            } catch { /* unavailable session */ }
          }
        }

        // Anchor the panel above the chip, clamped into the visual viewport:
        // the composer docks at the bottom of the frame, and a soft keyboard
        // shrinks the viewport without changing innerHeight on iOS.
        React.useLayoutEffect(() => {
          if (!open) {
            setPlacement(null)
            return undefined
          }
          const viewport = window.visualViewport
          const update = () => {
            const trigger = triggerRef.current
            if (trigger === null) return
            const rect = trigger.getBoundingClientRect()
            const width = Math.min(360, Math.max(260, window.innerWidth - 16))
            setPlacement({
              left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
              bottom: Math.max(8, window.innerHeight - rect.top + 8),
              width,
              maxHeight: Math.max(220, Math.min(440, rect.top - 24)),
            })
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

        // The search field focuses itself when it mounts: the panel mounts a
        // commit after `open`, so an effect keyed on `open` would run before the
        // field exists.
        const searchRef = React.useCallback((node) => {
          if (node === null) return
          if (window.matchMedia?.('(pointer: coarse)').matches === true) return
          node.focus()
        }, [])

        React.useEffect(() => {
          if (!open) return undefined
          const outside = (event) => {
            const target = event.target
            if (rootRef.current?.contains(target) === true) return
            if (panelRef.current?.contains(target) === true) return
            close()
          }
          const onKeyDown = (event) => {
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
        const providerName = (group) => group.name ?? group.id
        const current = state.current
        const currentGroup = current === null ? undefined : groups.find(group => group.id === current.provider)
        const currentModel = currentGroup?.models.find(model => model.id === current?.model)

        const favoriteCount = groups.length === 0
          ? favorites.models.length + favorites.providers.length
          : groups.reduce((total, group) => total + group.models.filter(model => isFavorite(favorites, group.id, model.id)).length, 0)

        const normalized = query.trim().toLowerCase()
        const visibleGroups = []
        const rows = []
        for (const group of groups) {
          const providerFavorite = favorites.providers.includes(group.id)
          const listed = group.models.filter((model) => {
            if (mode === 'favorites' && !(providerFavorite || favorites.models.includes(modelKey(group.id, model.id)))) return false
            if (normalized === '') return true
            return model.name.toLowerCase().includes(normalized) || providerName(group).toLowerCase().includes(normalized)
          })
          if (listed.length === 0) continue
          visibleGroups.push({ group, providerFavorite, models: listed })
          for (const model of listed) rows.push({ group, model, providerFavorite })
        }
        const activeIndex = rows.length === 0 ? -1 : Math.min(highlight, rows.length - 1)
        const busy = state.pending !== null || state.status === 'selecting'

        const toggleModel = (provider, model) => {
          commit({ ...favorites, models: toggled(favorites.models, modelKey(provider, model)) })
        }
        const toggleProvider = (provider) => {
          commit({ ...favorites, providers: toggled(favorites.providers, provider) })
        }

        const choose = (group, model) => {
          if (busy || directory === null) return
          const same = current !== null && current.provider === group.id && current.model === model.id
          const effort = same
            ? current.reasoningEffort ?? model.reasoning?.defaultEffort
            : model.reasoning?.defaultEffort
          const selection = {
            provider: group.id,
            model: model.id,
            ...effort === undefined ? {} : { reasoningEffort: effort },
          }
          setSelectError(null)
          let pendingPromise
          try {
            pendingPromise = directory.select(selection)
          } catch (error) {
            setSelectError(t('error.select', { message: String(error?.message ?? error) }))
            return
          }
          void pendingPromise.then((result) => {
            if (result.ok) {
              close(true)
              return
            }
            setSelectError(result.error.code === 'session/writer-held'
              ? t('error.sessionInUse')
              : t('error.select', { message: `${result.error.code}: ${result.error.message}` }))
          }).catch((error) => {
            setSelectError(t('error.select', { message: String(error?.message ?? error) }))
          })
        }

        const moveHighlight = (offset) => {
          if (rows.length === 0) return
          const next = (Math.max(0, activeIndex) + offset + rows.length) % rows.length
          setHighlight(next)
          itemRefs.current[next]?.scrollIntoView({ block: 'nearest' })
        }

        const onPanelKeyDown = (event) => {
          if (event.nativeEvent?.isComposing === true) return
          if (event.target instanceof HTMLInputElement) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
          }
        }

        const onSearchKeyDown = (event) => {
          if (event.nativeEvent?.isComposing === true) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key === 'Enter') {
            const row = rows[activeIndex]
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
            : mode === 'favorites' && normalized === ''
              ? t('empty.favorites')
              : t('empty.search')

        const notice = selectError
          ?? (saveFailed ? t('error.storage') : null)
          ?? (state.error !== null && state.status === 'error' ? t('error.catalog', { message: state.error }) : null)

        let rowIndex = 0

        return h('div', { className: 'mf-root', ref: rootRef },
          h('button', {
            ref: triggerRef,
            type: 'button',
            className: 'mf-trigger',
            'data-active': favoriteCount > 0 ? '' : undefined,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': t('trigger.aria', { count: String(favoriteCount) }),
            title: locked ? t('trigger.locked') : t('trigger.label'),
            disabled: locked,
            onClick: () => { if (open) close(true); else openPanel() },
          },
            h(StarGlyph, { filled: favoriteCount > 0 }),
            favoriteCount > 0 ? h('span', { className: 'mf-count' }, String(favoriteCount)) : null),

          open && placement !== null ? createPortal(
            h('div', {
              ref: panelRef,
              className: 'mf-panel',
              role: 'dialog',
              'aria-label': t('panel.title'),
              'data-model-favorites': '',
              style: {
                left: `${String(placement.left)}px`,
                bottom: `${String(placement.bottom)}px`,
                width: `${String(placement.width)}px`,
                maxHeight: `${String(placement.maxHeight)}px`,
              },
              onKeyDown: onPanelKeyDown,
            },
              h('div', { className: 'mf-head' },
                h('div', { className: 'mf-search-row' },
                  h('input', {
                    ref: searchRef,
                    className: 'mf-search',
                    type: 'search',
                    value: query,
                    placeholder: t('search.placeholder'),
                    'aria-label': t('search.placeholder'),
                    'aria-controls': `${panelId}-rows`,
                    'aria-activedescendant': activeIndex < 0 ? undefined : `${panelId}-row-${String(activeIndex)}`,
                    onChange: (event) => { setQuery(event.target.value); setHighlight(0) },
                    onKeyDown: onSearchKeyDown,
                  }),
                  query === '' ? null : h('button', {
                    type: 'button',
                    className: 'mf-clear',
                    'aria-label': t('search.clear'),
                    onClick: () => { setQuery(''); panelRef.current?.querySelector('.mf-search')?.focus() },
                  }, '×')),
                h('div', { className: 'mf-modes' },
                  h('button', {
                    type: 'button',
                    className: 'mf-mode',
                    'data-active': mode === 'favorites' ? '' : undefined,
                    'aria-pressed': mode === 'favorites',
                    onClick: () => { setMode('favorites'); setHighlight(0) },
                  }, t('mode.favorites')),
                  h('button', {
                    type: 'button',
                    className: 'mf-mode',
                    'data-active': mode === 'all' ? '' : undefined,
                    'aria-pressed': mode === 'all',
                    onClick: () => { setMode('all'); setHighlight(0) },
                  }, t('mode.all')))),

              currentModel === undefined || isFavorite(favorites, current.provider, currentModel.id)
                ? null
                : h('button', {
                  type: 'button',
                  className: 'mf-quick',
                  disabled: busy,
                  onClick: () => { toggleModel(current.provider, currentModel.id) },
                },
                  h(StarGlyph, { filled: false }),
                  h('span', { className: 'mf-quick-text' }, t('quick.add', { model: currentModel.name }))),

              h('div', {
                className: 'mf-groups',
                id: `${panelId}-rows`,
                role: 'menu',
                'aria-busy': busy,
              },
                visibleGroups.length === 0
                  ? h('div', { className: 'mf-empty', role: 'status' }, emptyText)
                  : visibleGroups.map(({ group, providerFavorite, models: listed }) => h('div', { className: 'mf-group', key: group.id },
                    h('div', { className: 'mf-group-head' },
                      h('span', { className: 'mf-provider', title: providerName(group) }, providerName(group)),
                      h('button', {
                        type: 'button',
                        className: 'mf-star',
                        'data-on': providerFavorite ? '' : undefined,
                        'aria-pressed': providerFavorite,
                        'aria-label': providerFavorite ? t('fav.providerOn') : t('fav.provider'),
                        title: providerFavorite ? t('fav.providerOn') : t('fav.provider'),
                        onClick: () => { toggleProvider(group.id) },
                      }, h(StarGlyph, { filled: providerFavorite }))),
                    listed.map((model) => {
                      const index = rowIndex++
                      const selected = current !== null && current.provider === group.id && current.model === model.id
                      const ownStar = favorites.models.includes(modelKey(group.id, model.id))
                      const starred = providerFavorite || ownStar
                      return h('div', {
                        className: 'mf-row',
                        key: model.id,
                        id: `${panelId}-row-${String(index)}`,
                        'data-active': index === activeIndex ? '' : undefined,
                        ref: (node) => { itemRefs.current[index] = node },
                        onMouseMove: () => { if (index !== activeIndex) setHighlight(index) },
                      },
                        h('button', {
                          type: 'button',
                          className: 'mf-row-main',
                          role: 'menuitemradio',
                          'aria-checked': selected,
                          disabled: busy,
                          title: model.name,
                          onClick: () => { choose(group, model) },
                        },
                          h('span', { className: 'mf-name' }, model.name),
                          selected ? h('span', { className: 'mf-check' }, t('current')) : null),
                        h('button', {
                          type: 'button',
                          className: 'mf-star',
                          'data-on': starred ? '' : undefined,
                          'aria-pressed': starred,
                          disabled: providerFavorite,
                          'aria-label': providerFavorite
                            ? t('fav.providerChild')
                            : starred ? t('fav.modelOn') : t('fav.model'),
                          title: providerFavorite
                            ? t('fav.providerChild')
                            : starred ? t('fav.modelOn') : t('fav.model'),
                          onClick: () => { if (!providerFavorite) toggleModel(group.id, model.id) },
                        }, h(StarGlyph, { filled: starred })))
                    }))),

              ),
              notice === null ? null : h('div', { className: 'mf-error', role: 'alert' }, notice),
            ),
            document.body,
          ) : null)
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = '@local/model-favorites'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'model-favorites: styles')

        ctx.effect(() => ctx.locale.register(NS, { ja, en }), 'model-favorites: dictionaries')

        ctx.inject(['modelDirectories'], (scope) => {
          const component = makeModelFavorites({
            models: scope.modelDirectories,
            sessions: scope.get('sessions'),
          })
          // The composer declares an empty single slot right after the model
          // selector, meant for a compact action of exactly this shape; the
          // chip owns that seat and leaves every shipped control in place.
          scope.slots.inject('conversation.input.activity', () => scope.slots.register({
            name: 'conversation.input.activity',
            id: 'model-favorites',
            order: 10,
            locale: NS,
          }, component))
        })
      },
    }
  },
})
