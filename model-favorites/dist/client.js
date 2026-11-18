window.__ModuleLoader__.load({
	id: `@local/model-favorites`,
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		// model-favorites/src/client/favorites.ts
		/** Locale namespace owned by this bundle. */
		const NS = "modelFavorites";
		/** `provider/model`, the key an explicit model favorite carries. */
		function modelKey(provider, model) {
			return `${provider}/${model}`;
		}
		/** The provider's display name, falling back to its identity. */
		function providerLabel(group) {
			return group.name ?? group.id;
		}
		/** Whether the whole provider is starred. */
		function providerFavorite(document, provider) {
			return document.providers.includes(provider);
		}
		/** A model is a favorite when it or its whole provider is starred. */
		function isFavorite(document, provider, model) {
			return providerFavorite(document, provider) || document.models.includes(modelKey(provider, model));
		}
		/** Add or remove one string, keeping the rest in order. */
		function toggled(list, value) {
			return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
		}
		/** Keep only well-formed, de-duplicated string lists. */
		function normalizeDocument(value) {
			const pick = (list) => Array.isArray(list) ? Array.from(new Set(list.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()))) : [];
			const record = typeof value === "object" && value !== null ? value : {};
			return {
				providers: pick(record["providers"]),
				models: pick(record["models"])
			};
		}
		/** No pending toggle yet. */
		function emptyPending() {
			const empty = () => ({
				adds: /* @__PURE__ */ new Set(),
				removals: /* @__PURE__ */ new Set()
			});
			return {
				providers: empty(),
				models: empty()
			};
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
		function recordChange(pending, previous, next) {
			return {
				providers: changeFor(pending.providers, previous.providers, next.providers),
				models: changeFor(pending.models, previous.models, next.models)
			};
		}
		/** Replay one field's pending toggles; removals first, then additions. */
		function changeFor(current, before, after) {
			const beforeKeys = new Set(before);
			const afterKeys = new Set(after);
			const adds = new Set(current.adds);
			const removals = new Set(current.removals);
			for (const key of afterKeys) {
				if (beforeKeys.has(key)) continue;
				adds.add(key);
				removals.delete(key);
			}
			for (const key of beforeKeys) {
				if (afterKeys.has(key)) continue;
				removals.add(key);
				adds.delete(key);
			}
			return {
				adds,
				removals
			};
		}
		/**
		* Replay the pending local toggles over a document read from the Host.
		* @param stored - the document the Host returned.
		* @param pending - toggles still unconfirmed.
		* @returns the effective document this page shows.
		*/
		function mergedWith(stored, pending) {
			const merge = (keys, toggles) => {
				const set = new Set(keys);
				for (const key of toggles.removals) set.delete(key);
				for (const key of toggles.adds) set.add(key);
				return [...set];
			};
			return {
				providers: merge(stored.providers, pending.providers),
				models: merge(stored.models, pending.models)
			};
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
		function favoriteCount(document, groups) {
			if (groups.length === 0) return document.models.length;
			let total = 0;
			for (const group of groups) {
				const starred = providerFavorite(document, group.id);
				for (const model of group.models) if (starred || document.models.includes(modelKey(group.id, model.id))) total += 1;
			}
			return total;
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
		function filterCatalog(groups, document, mode, query) {
			const normalized = query.trim().toLowerCase();
			const visibleGroups = [];
			const rows = [];
			for (const group of groups) {
				const starred = providerFavorite(document, group.id);
				const label = providerLabel(group).toLowerCase();
				const models = group.models.filter((model) => {
					if (mode === "favorites" && !(starred || document.models.includes(modelKey(group.id, model.id)))) return false;
					if (normalized === "") return true;
					return model.name.toLowerCase().includes(normalized) || label.includes(normalized);
				});
				if (models.length === 0) continue;
				visibleGroups.push({
					group,
					providerFavorite: starred,
					models
				});
				for (const model of models) rows.push({
					group,
					model,
					providerFavorite: starred,
					index: rows.length
				});
			}
			return {
				query: normalized,
				groups: visibleGroups,
				rows
			};
		}
		/** Narrowest panel, even in a cramped window. */
		const PANEL_MIN_WIDTH = 260;
		/** Widest panel. */
		const PANEL_MAX_WIDTH = 360;
		/** Shortest panel. */
		const PANEL_MIN_HEIGHT = 220;
		/** Tallest panel. */
		const PANEL_MAX_HEIGHT = 440;
		/** Gap kept from the window edges and from the chip. */
		const PANEL_GAP = 8;
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
		function clampPanelPlacement(anchor, viewport) {
			const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, viewport.width - 16));
			return {
				left: Math.max(PANEL_GAP, Math.min(anchor.left, viewport.width - width - PANEL_GAP)),
				bottom: Math.max(PANEL_GAP, viewport.height - anchor.top + PANEL_GAP),
				width,
				maxHeight: Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, anchor.top - 24))
			};
		}
		// model-favorites/src/client/index.tsx
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
		/** Japanese copy. The key set here is the namespace's type source. */
		const ja = {
			"trigger.label": "お気に入りモデル",
			"trigger.aria": "お気に入りモデルを開く（{count}件）",
			"trigger.locked": "このセッションではモデルを切り替えられません",
			"panel.title": "お気に入りモデル",
			"search.placeholder": "モデル名・プロバイダーで検索",
			"search.clear": "検索をクリア",
			"mode.favorites": "★ お気に入り",
			"mode.all": "すべて",
			"quick.add": "現在のモデルを★：{model}",
			"fav.model": "お気に入りに追加",
			"fav.modelOn": "お気に入りから外す",
			"fav.provider": "このプロバイダーを★",
			"fav.providerOn": "このプロバイダーの★を外す",
			"fav.providerChild": "プロバイダーが★のため、個別には外せません",
			"empty.favorites": "お気に入りはまだありません。「すべて」で☆を押すと追加できます。",
			"empty.search": "一致するモデルがありません",
			"empty.models": "利用できるモデルがありません",
			"status.loading": "モデル一覧を読み込み中…",
			"current": "選択中",
			"error.select": "選択できませんでした：{message}",
			"error.sessionInUse": "このセッションは別の書き込みが進行中です",
			"error.catalog": "モデル一覧を読み込めませんでした：{message}",
			"error.storage": "お気に入りを保存できませんでした"
		};
		/** English copy, checked complete against the Japanese key set. */
		const en = {
			"trigger.label": "Favorite models",
			"trigger.aria": "Open favorite models ({count})",
			"trigger.locked": "Models cannot be switched in this session",
			"panel.title": "Favorite models",
			"search.placeholder": "Search model or provider",
			"search.clear": "Clear search",
			"mode.favorites": "★ Favorites",
			"mode.all": "All",
			"quick.add": "Star the current model: {model}",
			"fav.model": "Add to favorites",
			"fav.modelOn": "Remove from favorites",
			"fav.provider": "Star every model of this provider",
			"fav.providerOn": "Unstar this provider",
			"fav.providerChild": "The provider is starred, so this model cannot be unstarred alone",
			"empty.favorites": "No favorites yet. Switch to All and press ☆ to add one.",
			"empty.search": "No matching model",
			"empty.models": "No model is available",
			"status.loading": "Loading the model catalog…",
			"current": "Selected",
			"error.select": "Could not select: {message}",
			"error.sessionInUse": "Another write is in progress in this session",
			"error.catalog": "The model catalog could not be loaded: {message}",
			"error.storage": "The favorites could not be saved"
		};
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
`;
		/** Directory snapshot for a session without a directory. */
		const EMPTY_DIRECTORY = {
			current: null,
			routable: null,
			groups: [],
			failures: [],
			status: "idle",
			pending: null,
			error: null
		};
		/** Human-readable failure text. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** Star glyph: filled for a favorite, outlined otherwise. */
		function StarGlyph({ filled }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				width: 14,
				height: 14,
				"aria-hidden": "true",
				focusable: "false",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 1.8l1.85 3.75 4.13.6-2.99 2.91.71 4.1L8 11.23l-3.7 1.93.71-4.1L2.02 6.15l4.13-.6z",
					fill: filled ? "currentColor" : "none",
					stroke: "currentColor",
					strokeWidth: filled ? 0 : 1.4,
					strokeLinejoin: "round"
				})
			});
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
		function createFavoritesStore(options = {}) {
			const endpoint = options.endpoint ?? "/model-favorites/state";
			const saveDelayMs = options.saveDelayMs ?? 250;
			let currentDocument = {
				providers: [],
				models: []
			};
			let pending = emptyPending();
			let synced = false;
			let dirty = false;
			let saveFailed = false;
			let loadStarted = null;
			let saveTimer = null;
			let postChain = Promise.resolve();
			let disposed = false;
			const listeners = /* @__PURE__ */ new Set();
			let snapshot = {
				document: currentDocument,
				synced,
				saveFailed
			};
			/** Publish the current values to every subscriber. */
			function publish() {
				snapshot = {
					document: currentDocument,
					synced,
					saveFailed
				};
				for (const listener of [...listeners]) listener();
			}
			/** Read the Host document once, sharing an in-flight read. */
			function load(loadOptions = {}) {
				if (loadStarted !== null) return loadStarted;
				if (synced && loadOptions.force !== true) return Promise.resolve(true);
				loadStarted = (async () => {
					try {
						const response = await fetch(endpoint, {
							credentials: "same-origin",
							headers: { accept: "application/json" }
						});
						if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
						const stored = normalizeDocument(await response.json());
						currentDocument = dirty ? mergedWith(stored, pending) : stored;
						synced = true;
						publish();
						return true;
					} catch {
						return false;
					} finally {
						loadStarted = null;
					}
				})();
				return loadStarted;
			}
			/** Post the current document, one at a time and in order. */
			function flush(keepalive = false) {
				const payload = JSON.stringify(currentDocument);
				postChain = postChain.then(() => fetch(endpoint, {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: payload,
					keepalive
				})).then((response) => {
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					pending = emptyPending();
					dirty = false;
					if (saveFailed) {
						saveFailed = false;
						publish();
					}
				}).catch(() => {
					if (!saveFailed) {
						saveFailed = true;
						publish();
					}
				});
				return postChain;
			}
			/** Replace the document locally, then post it after a short quiet period. */
			function commit(next) {
				if (disposed) return;
				pending = recordChange(pending, currentDocument, next);
				dirty = true;
				currentDocument = next;
				publish();
				if (saveTimer !== null) clearTimeout(saveTimer);
				saveTimer = setTimeout(() => {
					saveTimer = null;
					(async () => {
						if (!synced && !await load()) {
							if (!saveFailed) {
								saveFailed = true;
								publish();
							}
							return;
						}
						await flush();
					})();
				}, saveDelayMs);
			}
			/** Write any pending change before the page goes away. */
			function flushNow() {
				if (saveTimer === null) return;
				clearTimeout(saveTimer);
				saveTimer = null;
				if (!synced) return;
				flush(true);
			}
			/** Release the debounce timer and every subscriber. */
			function dispose() {
				disposed = true;
				if (saveTimer !== null) {
					clearTimeout(saveTimer);
					saveTimer = null;
				}
				listeners.clear();
			}
			/** Register one uSES listener; the disposer removes exactly it. */
			function subscribe(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}
			/** The current snapshot, stable between renders that see no change. */
			function getSnapshot() {
				return snapshot;
			}
			return {
				subscribe,
				getSnapshot,
				load,
				commit,
				flushNow,
				dispose
			};
		}
		/**
		* Build the composer chip over the shared model directory.
		* @param services - the Client services the chip reads.
		* @returns the slot component.
		*/
		function createActivity(services) {
			const { store, models, sessions } = services;
			return function ModelFavorites(props) {
				const { t, sessionId } = props;
				const locked = props.locked;
				const panelId = `mf-${react.useId().replaceAll(":", "")}`;
				let directory = null;
				try {
					directory = models.directoryFor(sessionId);
				} catch {
					directory = null;
				}
				const available = directory !== null && (sessions === void 0 || typeof sessions.subagentAddress !== "function" || sessions.subagentAddress(sessionId) === void 0);
				const favorites = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
				const state = react.useSyncExternalStore(react.useCallback((listener) => directory === null ? () => {} : directory.store.subscribe(listener), [directory]), react.useCallback(() => directory === null ? EMPTY_DIRECTORY : directory.store.getSnapshot(), [directory]));
				const [open, setOpen] = react.useState(false);
				const [query, setQuery] = react.useState("");
				const [mode, setMode] = react.useState("favorites");
				const [highlight, setHighlight] = react.useState(0);
				const [selectError, setSelectError] = react.useState(null);
				const [placement, setPlacement] = react.useState(null);
				const rootRef = react.useRef(null);
				const triggerRef = react.useRef(null);
				const panelRef = react.useRef(null);
				const itemRefs = react.useRef([]);
				const loadCatalog = react.useCallback((target) => {
					if (target === null) return;
					try {
						target.load().catch(() => {});
					} catch {}
				}, []);
				react.useEffect(() => {
					store.load();
					loadCatalog(directory);
				}, [
					directory,
					loadCatalog,
					store
				]);
				react.useEffect(() => {
					const onPageHide = () => {
						store.flushNow();
					};
					window.addEventListener("pagehide", onPageHide);
					return () => {
						window.removeEventListener("pagehide", onPageHide);
					};
				}, [store]);
				const close = react.useCallback((restoreFocus = false) => {
					setOpen(false);
					setQuery("");
					setHighlight(0);
					setSelectError(null);
					if (restoreFocus) queueMicrotask(() => {
						triggerRef.current?.focus();
					});
				}, []);
				const openPanel = () => {
					setOpen(true);
					setQuery("");
					setHighlight(0);
					setSelectError(null);
					const starredYet = favorites.document.models.length > 0 || favorites.document.providers.length > 0 || state.groups.some((group) => group.models.some((model) => isFavorite(favorites.document, group.id, model.id)));
					setMode(starredYet ? "favorites" : "all");
					store.load({ force: true });
					loadCatalog(directory);
				};
				react.useLayoutEffect(() => {
					if (!open) {
						setPlacement(null);
						return;
					}
					const viewport = window.visualViewport;
					const update = () => {
						const trigger = triggerRef.current;
						if (trigger === null) return;
						const rect = trigger.getBoundingClientRect();
						setPlacement(clampPanelPlacement({
							left: rect.left,
							top: rect.top
						}, {
							width: window.innerWidth,
							height: window.innerHeight
						}));
					};
					update();
					window.addEventListener("resize", update);
					window.addEventListener("scroll", update, true);
					viewport?.addEventListener("resize", update);
					viewport?.addEventListener("scroll", update);
					return () => {
						window.removeEventListener("resize", update);
						window.removeEventListener("scroll", update, true);
						viewport?.removeEventListener("resize", update);
						viewport?.removeEventListener("scroll", update);
					};
				}, [open]);
				const searchRef = react.useCallback((node) => {
					if (node === null) return;
					if (window.matchMedia?.("(pointer: coarse)").matches === true) return;
					node.focus();
				}, []);
				react.useEffect(() => {
					if (!open) return void 0;
					const outside = (event) => {
						const target = event.target;
						if (target instanceof Node) {
							if (rootRef.current?.contains(target) === true) return;
							if (panelRef.current?.contains(target) === true) return;
						}
						close();
					};
					const onKeyDown = (event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						close(true);
					};
					document.addEventListener("mousedown", outside);
					document.addEventListener("keydown", onKeyDown);
					return () => {
						document.removeEventListener("mousedown", outside);
						document.removeEventListener("keydown", onKeyDown);
					};
				}, [open, close]);
				const groups = state.groups;
				const current = state.current;
				const currentModel = (current === null ? void 0 : groups.find((group) => group.id === current.provider))?.models.find((model) => model.id === current?.model);
				const view = filterCatalog(groups, favorites.document, mode, query);
				const count = favoriteCount(favorites.document, groups);
				const busy = state.pending !== null || state.status === "selecting";
				const activeIndex = view.rows.length === 0 ? -1 : Math.min(highlight, view.rows.length - 1);
				const fail = (error) => {
					setSelectError(t("error.select", { message: messageOf(error) }));
				};
				const toggleModel = (provider, model) => {
					store.commit({
						...favorites.document,
						models: toggled(favorites.document.models, modelKey(provider, model))
					});
				};
				const toggleProvider = (provider) => {
					store.commit({
						...favorites.document,
						providers: toggled(favorites.document.providers, provider)
					});
				};
				const choose = (group, model) => {
					if (busy || directory === null) return;
					const sameSelection = current !== null && current.provider === group.id && current.model === model.id;
					const effort = current !== null && sameSelection ? current.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort;
					const selection = {
						provider: group.id,
						model: model.id,
						...effort === void 0 ? {} : { reasoningEffort: effort }
					};
					setSelectError(null);
					let settled;
					try {
						settled = directory.select(selection);
					} catch (error) {
						fail(error);
						return;
					}
					settled.then((result) => {
						if (result.ok) {
							close(true);
							return;
						}
						setSelectError(result.error.code === "session/writer-held" ? t("error.sessionInUse") : t("error.select", { message: `${result.error.code}: ${result.error.message}` }));
					}).catch(fail);
				};
				const moveHighlight = (offset) => {
					if (view.rows.length === 0) return;
					const next = (Math.max(0, activeIndex) + offset + view.rows.length) % view.rows.length;
					setHighlight(next);
					itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
				};
				const onPanelKeyDown = (event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.target instanceof HTMLInputElement) return;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						moveHighlight(event.key === "ArrowDown" ? 1 : -1);
					}
				};
				const onSearchKeyDown = (event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						moveHighlight(event.key === "ArrowDown" ? 1 : -1);
						return;
					}
					if (event.key === "Enter") {
						const row = view.rows[activeIndex];
						if (row === void 0) return;
						event.preventDefault();
						choose(row.group, row.model);
					}
				};
				if (!available) return null;
				const emptyText = state.status === "loading" && groups.length === 0 ? t("status.loading") : groups.length === 0 ? t("empty.models") : mode === "favorites" && view.query === "" ? t("empty.favorites") : t("empty.search");
				const notice = selectError ?? (favorites.saveFailed ? t("error.storage") : null) ?? (state.error !== null && state.status === "error" ? t("error.catalog", { message: state.error }) : null);
				let rowIndex = 0;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mf-root",
					ref: rootRef,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: triggerRef,
						type: "button",
						className: "mf-trigger",
						"data-active": count > 0 ? "" : void 0,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": t("trigger.aria", { count: String(count) }),
						title: locked ? t("trigger.locked") : t("trigger.label"),
						disabled: locked,
						onClick: () => {
							if (open) close(true);
							else openPanel();
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarGlyph, { filled: count > 0 }), count > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "mf-count",
							children: String(count)
						}) : null]
					}), open && placement !== null ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: panelRef,
						className: "mf-panel",
						role: "dialog",
						"aria-label": t("panel.title"),
						"data-model-favorites": "",
						style: {
							left: `${String(placement.left)}px`,
							bottom: `${String(placement.bottom)}px`,
							width: `${String(placement.width)}px`,
							maxHeight: `${String(placement.maxHeight)}px`
						},
						onKeyDown: onPanelKeyDown,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mf-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "mf-search-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										ref: searchRef,
										className: "mf-search",
										type: "search",
										value: query,
										placeholder: t("search.placeholder"),
										"aria-label": t("search.placeholder"),
										"aria-controls": `${panelId}-rows`,
										"aria-activedescendant": activeIndex < 0 ? void 0 : `${panelId}-row-${String(activeIndex)}`,
										onChange: (event) => {
											setQuery(event.target.value);
											setHighlight(0);
										},
										onKeyDown: onSearchKeyDown
									}), query === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "mf-clear",
										"aria-label": t("search.clear"),
										onClick: () => {
											setQuery("");
											panelRef.current?.querySelector(".mf-search")?.focus();
										},
										children: "×"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "mf-modes",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "mf-mode",
										"data-active": mode === "favorites" ? "" : void 0,
										"aria-pressed": mode === "favorites",
										onClick: () => {
											setMode("favorites");
											setHighlight(0);
										},
										children: t("mode.favorites")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "mf-mode",
										"data-active": mode === "all" ? "" : void 0,
										"aria-pressed": mode === "all",
										onClick: () => {
											setMode("all");
											setHighlight(0);
										},
										children: t("mode.all")
									})]
								})]
							}),
							currentModel === void 0 || current === null || isFavorite(favorites.document, current.provider, currentModel.id) ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "mf-quick",
								disabled: busy,
								onClick: () => {
									toggleModel(current.provider, currentModel.id);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarGlyph, { filled: false }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "mf-quick-text",
									children: t("quick.add", { model: currentModel.name })
								})]
							}),
							state.failures.map((failure) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "mf-failure",
								role: "status",
								children: t("error.catalog", { message: `${failure.name}: ${failure.message}` })
							}, `failure-${failure.id}`)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "mf-groups",
								id: `${panelId}-rows`,
								role: "menu",
								"aria-busy": busy,
								children: view.groups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "mf-empty",
									role: "status",
									children: emptyText
								}) : view.groups.map(({ group, providerFavorite, models: listed }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "mf-group",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "mf-group-head",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "mf-provider",
											title: providerLabel(group),
											children: providerLabel(group)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "mf-star",
											"data-on": providerFavorite ? "" : void 0,
											"aria-pressed": providerFavorite,
											"aria-label": providerFavorite ? t("fav.providerOn") : t("fav.provider"),
											title: providerFavorite ? t("fav.providerOn") : t("fav.provider"),
											onClick: () => {
												toggleProvider(group.id);
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarGlyph, { filled: providerFavorite })
										})]
									}), listed.map((model) => {
										const index = rowIndex;
										rowIndex += 1;
										const selected = current !== null && current.provider === group.id && current.model === model.id;
										const ownStar = favorites.document.models.includes(modelKey(group.id, model.id));
										const starred = providerFavorite || ownStar;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "mf-row",
											id: `${panelId}-row-${String(index)}`,
											"data-active": index === activeIndex ? "" : void 0,
											ref: (node) => {
												itemRefs.current[index] = node;
											},
											onMouseMove: () => {
												if (index !== activeIndex) setHighlight(index);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "mf-row-main",
												role: "menuitemradio",
												"aria-checked": selected,
												disabled: busy,
												title: model.name,
												onClick: () => {
													choose(group, model);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "mf-name",
													children: model.name
												}), selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "mf-check",
													children: t("current")
												}) : null]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "mf-star",
												"data-on": starred ? "" : void 0,
												"aria-pressed": starred,
												disabled: providerFavorite,
												"aria-label": providerFavorite ? t("fav.providerChild") : starred ? t("fav.modelOn") : t("fav.model"),
												title: providerFavorite ? t("fav.providerChild") : starred ? t("fav.modelOn") : t("fav.model"),
												onClick: () => {
													if (!providerFavorite) toggleModel(group.id, model.id);
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarGlyph, { filled: starred })
											})]
										}, model.id);
									})]
								}, group.id))
							}),
							notice === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "mf-error",
								role: "alert",
								children: notice
							})
						]
					}), document.body) : null]
				});
			};
		}
		/**
		* Runtime identity the single-slot option type omits, carried for diagnostics.
		*
		* The slot registry records `id`/`order` on every entry; the typed options for a
		* `single` slot expose only `priority`, so the pair rides in through a spread.
		*/
		const REGISTRATION_IDENTITY = {
			id: "model-favorites",
			order: 10
		};
		/**
		* Install the chip: styles, dictionaries, the document store, and the single
		* activity slot contribution.
		*
		* @param ctx - the Client plugin context.
		*/
		function mountFavorites(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset["dshPlugin"] = "@local/model-favorites";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "model-favorites: styles");
			ctx.effect(() => {
				const disposeJa = ctx.locale.register(NS, "ja", ja);
				const disposeEn = ctx.locale.register(NS, "en", en);
				return () => {
					disposeJa();
					disposeEn();
				};
			}, "model-favorites: dictionaries");
			const store = createFavoritesStore();
			ctx.effect(() => () => {
				store.dispose();
			}, "model-favorites: favorites document");
			ctx.inject(["modelDirectories"], (scope) => {
				const activity = createActivity({
					store,
					models: scope.modelDirectories,
					sessions: scope.get("sessions")
				});
				scope.slots.inject("conversation.input.activity", () => scope.slots.register({
					name: "conversation.input.activity",
					...REGISTRATION_IDENTITY,
					locale: NS
				}, activity));
			});
		}
		// model-favorites/src/client.tsx
		/** Services the contribution registers against. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: mount the chip over the shared model directories.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			mountFavorites(ctx);
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map