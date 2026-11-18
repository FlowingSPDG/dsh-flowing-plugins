window.__ModuleLoader__.load({
	id: `@local/opencode-go-quota`,
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
		// opencode-go-quota/src/client/format.ts
		/**
		* Number, money, token, and clock formatting for the OpenCode Go quota chip.
		*
		* Pure helpers with no React and no DOM beyond `Intl`/`Date`, so the browser
		* bundle stays thin and the behaviour is easy to reason about: every formatter
		* falls back to plain arithmetic when the platform lacks `Intl` support.
		*
		* @module @local/opencode-go-quota/client/format
		*/
		/** Coerce to a finite number, or 0. */
		function num(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/**
		* USD with enough precision for a single session: cents above one dollar, four
		* decimals for smaller amounts so a short chat does not read $0.00.
		*/
		function usdCost(value) {
			const amount = num(value);
			const digits = amount >= 1 ? 2 : 4;
			try {
				return new Intl.NumberFormat(void 0, {
					style: "currency",
					currency: "USD",
					minimumFractionDigits: digits,
					maximumFractionDigits: digits
				}).format(amount);
			} catch {
				return `$${amount.toFixed(digits)}`;
			}
		}
		/** Token count in compact notation, with a plain fallback. */
		function formatTokens(value) {
			const amount = num(value);
			try {
				return new Intl.NumberFormat(void 0, {
					notation: "compact",
					maximumFractionDigits: 1
				}).format(amount);
			} catch {
				if (amount < 1e3) return String(Math.round(amount));
				if (amount < 1e6) return `${(amount / 1e3).toFixed(amount < 1e4 ? 1 : 0)}K`;
				return `${(amount / 1e6).toFixed(1)}M`;
			}
		}
		/** Local clock time for an epoch millisecond reading. */
		function clockTime(at) {
			try {
				return new Date(at).toLocaleTimeString(void 0, {
					hour: "2-digit",
					minute: "2-digit"
				});
			} catch {
				return new Date(at).toISOString().slice(11, 16);
			}
		}
		/** Short local time for a documented ISO reset timestamp, or null when unparsable. */
		function resetTime(iso) {
			if (typeof iso !== "string") return null;
			const at = Date.parse(iso);
			if (!Number.isFinite(at)) return null;
			return stampTime(at);
		}
		/** Short local date and time for a watched-transition record. */
		function stampTime(at) {
			try {
				return new Date(at).toLocaleString(void 0, {
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit"
				});
			} catch {
				return new Date(at).toISOString().slice(0, 16).replace("T", " ");
			}
		}
		/** A published per-million-token list price, for example `$0.15`. */
		function listUsd(value) {
			const amount = num(value);
			try {
				return new Intl.NumberFormat(void 0, {
					style: "currency",
					currency: "USD",
					maximumFractionDigits: 2
				}).format(amount);
			} catch {
				return `$${amount.toFixed(2)}`;
			}
		}
		/** Message of an unknown thrown value. */
		function errorMessage(error) {
			if (error instanceof Error) return error.message;
			return String(error);
		}
		// opencode-go-quota/src/client/describe.ts
		/**
		* Wire snapshot → display content, without React.
		*
		* The three describe functions fold one Host answer into exactly what the chip
		* and the panel render: a headline, a compact label, rows, notes, and a tone.
		* Their return values are typed, so a `data-tone` attribute can only receive
		* one of the four states the stylesheet knows about.
		*
		* @module @local/opencode-go-quota/client/describe
		*/
		/**
		* Tone of one usage percentage: error at 100, warn from 80, muted when unknown.
		* @param percent - consumed percentage.
		* @returns the tone literal.
		*/
		function toneOf(percent) {
			if (!Number.isFinite(percent)) return "muted";
			if (percent >= 100) return "error";
			if (percent >= 80) return "warn";
			return "ok";
		}
		/**
		* Fold one wire usage snapshot into the chip's label, tone, and panel content.
		* @param snapshot - the Host half's usage answer.
		* @param t - namespace translate function.
		* @returns display parts: headline, chip label, windows, notes, tone.
		*/
		function describeUsage(snapshot, t) {
			if (snapshot === null) return {
				label: t("usage.loading"),
				headline: t("usage.title"),
				tone: "muted",
				windows: [],
				notes: []
			};
			const usage = snapshot.usage;
			const error = snapshot.error;
			const updated = typeof snapshot.fetchedAt === "number" ? clockTime(snapshot.fetchedAt) : "—";
			const failureNote = error !== null && typeof error.message === "string" ? error.message : null;
			if (snapshot.state === "unconfigured") return {
				label: t("usage.unconfigured"),
				headline: t("usage.titleUnconfigured"),
				tone: "muted",
				windows: [],
				notes: [[t("usage.envNote", { env: String(snapshot.apiKeyEnv) }), null]]
			};
			if (usage === null || usage.windows.length === 0) return {
				label: t("usage.error"),
				headline: t("usage.titleError"),
				tone: "error",
				windows: [],
				notes: failureNote === null ? [] : [[failureNote, null]]
			};
			const byKey = new Map(usage.windows.map((window) => [window.key, window]));
			const rolling = num(byKey.get("rolling")?.percent);
			const weekly = num(byKey.get("weekly")?.percent);
			const monthly = num(byKey.get("monthly")?.percent);
			const windows = usage.windows.map((window) => ({
				key: window.key,
				label: t(`usage.${window.key}`),
				percent: num(window.percent),
				resetsAt: resetTime(window.resetsAt)
			}));
			const worst = Math.max(...windows.map((window) => window.percent));
			const notes = [[t("usage.updated"), updated]];
			if (snapshot.stale && failureNote !== null) notes.push([failureNote, null]);
			return {
				label: t("usage.label", {
					rolling: String(Math.round(rolling)),
					weekly: String(Math.round(weekly)),
					monthly: String(Math.round(monthly))
				}),
				headline: t("usage.title"),
				tone: snapshot.stale ? "warn" : toneOf(worst),
				windows,
				notes
			};
		}
		/**
		* Fold the Host's attributed Session usage into panel rows.
		*
		* The direct figures cover this Session's own log, including records written
		* before a context compaction; the subtree figures add live subagent Sessions.
		* Other providers are listed separately and never folded into the Go estimate.
		* A model tagged `free` costs nothing against the allowance, and a model tagged
		* `peak` had a published time multiplier applied.
		*
		* @param snapshot - the Host half's session answer.
		* @param t - namespace translate function.
		* @returns state, rows, notes, and tone.
		*/
		function describeSession(snapshot, t) {
			if (snapshot === null) return {
				state: "loading",
				rows: [],
				notes: [t("session.loading")],
				tone: "muted"
			};
			if (snapshot.state === "missing") return {
				state: "missing",
				rows: [],
				notes: [t("session.missing")],
				tone: "muted"
			};
			const direct = snapshot.direct;
			if (snapshot.state !== "ok" || direct === void 0) return {
				state: "error",
				rows: [],
				notes: [t("session.error")],
				tone: "error"
			};
			const subtree = snapshot.subtree ?? direct;
			const used = num(direct.requests) + num(direct.compactionRequests);
			const otherCalls = num(subtree.otherRequests) + num(subtree.otherCompactionRequests);
			const titleCalls = num(subtree.titleRequests);
			if (used === 0 && otherCalls === 0 && titleCalls === 0) return {
				state: "empty",
				rows: [],
				notes: [t("session.empty")],
				tone: "muted"
			};
			const rows = [];
			const spend = used > 0 && typeof direct.estimatedUsd === "number" ? `~${usdCost(direct.estimatedUsd)}` : "—";
			rows.push([t("session.spend"), spend]);
			rows.push([t("session.requests"), num(direct.compactionRequests) > 0 ? t("session.requestsWithCompaction", {
				requests: String(num(direct.requests)),
				compaction: String(num(direct.compactionRequests))
			}) : String(num(direct.requests))]);
			rows.push([t("session.tokens"), t("session.tokenSplit", {
				input: formatTokens(direct.inputTokens),
				output: formatTokens(direct.outputTokens)
			})]);
			const cached = num(direct.cacheReadTokens) + num(direct.cacheWriteTokens);
			if (cached > 0) rows.push([t("session.cache"), formatTokens(cached)]);
			const models = direct.models.filter((model) => model.model !== "unknown");
			if (models.length > 0) {
				const shown = models.slice(0, 3).map((model) => {
					const tags = [];
					if (model.peak) tags.push(t("session.peak"));
					if (model.free) tags.push(t("session.free"));
					return tags.length > 0 ? `${model.model} (${tags.join("·")})` : model.model;
				});
				const suffix = models.length > shown.length ? ` +${String(models.length - shown.length)}` : "";
				rows.push([t("session.models"), `${shown.join(", ")}${suffix}`]);
			}
			if (num(subtree.subagentSessions) > 0) rows.push([t("session.subtree"), t("session.subtreeValue", {
				sessions: String(num(subtree.subagentSessions)),
				spend: typeof subtree.estimatedUsd === "number" ? `~${usdCost(subtree.estimatedUsd)}` : "—"
			})]);
			if (otherCalls > 0) rows.push([t("session.other"), t("session.otherValue", {
				requests: String(otherCalls),
				tokens: formatTokens(subtree.otherTokens)
			})]);
			if (Number.isFinite(snapshot.generatedAt)) rows.push([t("session.updated"), clockTime(snapshot.generatedAt)]);
			const notes = [t("session.note")];
			if (snapshot.stale === true) notes.unshift(t("session.stale", { time: clockTime(snapshot.generatedAt) }));
			if (snapshot.forked === true || num(snapshot.inheritedEventCount) > 0) notes.push(t("session.forkNote"));
			if (num(subtree.unpricedRequests) > 0) notes.push(t("session.unpriced"));
			if (titleCalls > 0) notes.push(t("session.titleNote", { count: String(titleCalls) }));
			if (num(subtree.missingSessions) > 0) notes.push(t("session.subagentMissing", { count: String(num(subtree.missingSessions)) }));
			return {
				state: "ok",
				rows,
				notes,
				tone: "ok"
			};
		}
		/**
		* Fold the Host's free-model watch into panel content.
		* @param snapshot - the Host half's free answer.
		* @param t - namespace translate function.
		* @returns state, models, watched statuses, change history, and notes.
		*/
		function describeFree(snapshot, t) {
			if (snapshot === null) return {
				state: "loading",
				models: [],
				watched: [],
				history: [],
				newIds: /* @__PURE__ */ new Set(),
				notes: [t("free.loading")],
				tone: "muted"
			};
			if (snapshot.state === "error") return {
				state: "error",
				models: snapshot.free,
				watched: snapshot.watched,
				history: snapshot.history,
				newIds: /* @__PURE__ */ new Set(),
				notes: [t("free.error"), snapshot.error !== null && typeof snapshot.error.message === "string" ? snapshot.error.message : null].filter((note) => note !== null),
				tone: "error"
			};
			const models = snapshot.free;
			const watched = snapshot.watched;
			const history = snapshot.history;
			const newIds = new Set(snapshot.newFree.map((model) => model.id));
			const notes = [];
			if (newIds.size > 0) notes.push(t("free.newNote"));
			notes.push(t("free.note"));
			if (history.length > 0) notes.push(t("free.historyNote"));
			if (typeof snapshot.fetchedAt === "number") notes.push(`${t("free.checked")}: ${clockTime(snapshot.fetchedAt)}`);
			return {
				state: models.length === 0 ? "empty" : "ok",
				models,
				watched,
				history,
				newIds,
				notes,
				tone: models.length === 0 ? "muted" : "ok"
			};
		}
		// opencode-go-quota/src/client/hooks.ts
		/**
		* React state for the OpenCode Go quota chip: the three polled reads, the
		* Session read gated on the panel being open, and the panel's placement.
		*
		* Every poll owns one `AbortController` for its whole lifetime, so unmounting
		* the chip cancels an in-flight request instead of waiting out the 15-second
		* client timeout. A timed-out read still surfaces as an error while the poll
		* continues: only unmount aborts the controller.
		*
		* @module @local/opencode-go-quota/client/hooks
		*/
		/** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
		const POLL_MS = 6e4;
		/** How often a mounted chip re-checks the free-model watcher. */
		const FREE_POLL_MS = 3e5;
		/** How often an open panel re-reads the Session while the agent is working. */
		const SESSION_POLL_MS = 1e4;
		/** A failed read as the panel renders it. */
		function failureOf(error) {
			return {
				code: "request-failed",
				message: errorMessage(error)
			};
		}
		/**
		* Poll one reader on a fixed cadence until unmount.
		* @param read - the reader, called with the poll's abort signal.
		* @param intervalMs - delay between the end of one poll and the next.
		* @param fallback - snapshot to show when a poll throws.
		* @returns the latest snapshot, or null before the first answer.
		*/
		function usePolled(read, intervalMs, fallback) {
			const [snapshot, setSnapshot] = react.useState(null);
			react.useEffect(() => {
				const controller = new AbortController();
				let timer = null;
				const poll = () => {
					Promise.resolve().then(() => read(controller.signal)).then((next) => {
						if (!controller.signal.aborted) setSnapshot(next);
					}).catch((error) => {
						if (controller.signal.aborted) return;
						setSnapshot(fallback(error));
					}).then(() => {
						if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
					});
				};
				poll();
				return () => {
					controller.abort();
					if (timer !== null) clearTimeout(timer);
				};
			}, [
				read,
				intervalMs,
				fallback
			]);
			return snapshot;
		}
		/**
		* Ask the Host half for the usage, retrying once per poll interval so a
		* transient failure heals without a page reload.
		* @param readUsage - injected reader.
		* @returns the current snapshot.
		*/
		function useUsage(readUsage) {
			const fallback = react.useCallback((error) => ({
				state: "error",
				apiKeyEnv: "OPENCODE_GO_API_KEY",
				fetchedAt: null,
				stale: false,
				usage: null,
				error: failureOf(error)
			}), []);
			return usePolled(react.useCallback((signal) => readUsage(false, signal), [readUsage]), POLL_MS, fallback);
		}
		/**
		* Ask the Host half for the free-model watch on its own, slower cadence.
		* @param readFree - injected reader.
		* @returns the current snapshot.
		*/
		function useFreeModels(readFree) {
			const fallback = react.useCallback((error) => ({
				state: "error",
				fetchedAt: null,
				stale: false,
				free: [],
				watched: [],
				history: [],
				newFree: [],
				error: failureOf(error)
			}), []);
			return usePolled(react.useCallback((signal) => readFree(false, false, signal), [readFree]), FREE_POLL_MS, fallback);
		}
		/**
		* Read the current Session's attributed usage while the panel is open.
		* Polling covers live turns, tool logs, model switches, and compaction without
		* making the panel depend on any one transcript event.
		* @param readSessionUsage - injected Host reader.
		* @param sessionId - the mounted Session identity.
		* @param active - whether the panel is open.
		* @returns the latest host snapshot, or null before the first read.
		*/
		function useSessionUsage(readSessionUsage, sessionId, active) {
			const [snapshot, setSnapshot] = react.useState(null);
			react.useEffect(() => {
				if (!active || sessionId === void 0 || sessionId === "") {
					setSnapshot(null);
					return;
				}
				const controller = new AbortController();
				let timer = null;
				const poll = () => {
					Promise.resolve().then(() => readSessionUsage(sessionId, controller.signal)).then((next) => {
						if (!controller.signal.aborted) setSnapshot(next);
					}).catch((error) => {
						if (controller.signal.aborted) return;
						setSnapshot((previous) => previous !== null && previous.state === "ok" ? {
							...previous,
							stale: true
						} : {
							state: "error",
							provider: "",
							generatedAt: Date.now(),
							error: failureOf(error)
						});
					}).then(() => {
						if (!controller.signal.aborted) timer = setTimeout(poll, SESSION_POLL_MS);
					});
				};
				poll();
				return () => {
					controller.abort();
					if (timer !== null) clearTimeout(timer);
				};
			}, [
				active,
				readSessionUsage,
				sessionId
			]);
			return snapshot;
		}
		/**
		* The chip's open state plus its placement. The panel anchors above the chip
		* and closes on Escape or an outside press. It deliberately does not close on
		* scroll: agent replies and tool logs scroll the transcript while the user is
		* reading the panel, and that must not dismiss it.
		* @returns the panel state.
		*/
		function usePanel() {
			const anchorRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const [open, setOpen] = react.useState(false);
			const [placement, setPlacement] = react.useState(null);
			/** Re-anchor the fixed panel above the chip after a layout change. */
			const measure = react.useCallback(() => {
				const rect = anchorRef.current?.getBoundingClientRect();
				if (rect === void 0) return;
				const width = Math.min(320, window.innerWidth - 24);
				const centered = rect.left + rect.width / 2 - width / 2;
				const left = Math.min(Math.max(12, centered), Math.max(12, window.innerWidth - width - 12));
				setPlacement({
					left,
					width,
					bottom: window.innerHeight - rect.top + 8,
					maxHeight: Math.max(160, rect.top - 20)
				});
			}, []);
			const toggle = react.useCallback(() => {
				setOpen((wasOpen) => !wasOpen);
			}, []);
			react.useEffect(() => {
				if (!open) return;
				measure();
				const onPointer = (event) => {
					const target = event.target;
					if (target instanceof Node) {
						if (panelRef.current?.contains(target) === true) return;
						if (anchorRef.current?.contains(target) === true) return;
					}
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					setOpen(false);
				};
				const onLayout = () => {
					measure();
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKey, true);
				window.addEventListener("resize", onLayout);
				window.visualViewport?.addEventListener("resize", onLayout);
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
				const anchor = anchorRef.current;
				if (observer !== null && anchor !== null) {
					const observed = /* @__PURE__ */ new Set([
						anchor,
						anchor.parentElement,
						anchor.closest("[data-composer-card]"),
						anchor.closest("[data-composer-dock]")
					]);
					for (const element of observed) if (element !== null) observer.observe(element);
				}
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKey, true);
					window.removeEventListener("resize", onLayout);
					window.visualViewport?.removeEventListener("resize", onLayout);
					observer?.disconnect();
				};
			}, [measure, open]);
			react.useEffect(() => {
				if (!open) setPlacement(null);
			}, [open]);
			return {
				open,
				placement,
				toggle,
				anchorRef,
				panelRef
			};
		}
		// opencode-go-quota/src/client/panel.tsx
		/** A gauge glyph, drawn from the current text color. */
		function GaugeIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: 8,
					cy: 8,
					r: 6.4,
					stroke: "currentColor",
					strokeWidth: 1.3
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 4.4 V8 L10.8 9.8",
					stroke: "currentColor",
					strokeWidth: 1.3,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		/** The panel's Session block: attributed spend, tokens, and scope notes. */
		function SessionSection({ view, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ogq-session",
				"data-opencode-session": view.state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ogq-session-head",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ogq-panel-title",
							children: t("session.title")
						})
					}),
					view.rows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
						className: "ogq-rows ogq-rows-plain",
						children: view.rows.flatMap((row, index) => [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: row[0] }, `session-label-${String(index)}`), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: row[1] }, `session-value-${String(index)}`)])
					}) : null,
					view.notes.map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ogq-note",
						children: note
					}, `session-note-${String(index)}`))
				]
			});
		}
		/** The panel's free-model block: watched statuses, the list, and the change history. */
		function FreeSection({ view, t }) {
			const history = view.history.slice(0, 6);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ogq-free",
				"data-opencode-free": view.state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ogq-free-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ogq-panel-title",
							children: t("free.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ogq-panel-value",
							children: t("free.count", { count: String(view.models.length) })
						})]
					}),
					view.watched.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
						className: "ogq-rows ogq-rows-plain ogq-watch-rows",
						children: view.watched.flatMap((model, index) => [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: model.name }, `watch-label-${String(index)}`), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
							"data-free": model.free ? "true" : "false",
							children: model.free ? t("free.nowFree") : typeof model.inputPrice === "number" ? t("free.nowPaid", { price: listUsd(model.inputPrice) }) : t("free.nowPaidUnknown")
						}, `watch-value-${String(index)}`)])
					}) : null,
					view.state === "empty" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ogq-note",
						children: t("free.empty")
					}) : null,
					view.models.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "ogq-free-list",
						children: view.models.map((model, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-free-id",
								children: model.name === "" ? model.id : model.name
							}),
							view.newIds.has(model.id) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-free-tag",
								"data-new": "true",
								children: t("free.new")
							}) : null,
							model.limitedRegions ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-free-tag",
								children: "geo"
							}) : null,
							model.training ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-free-tag",
								children: "training"
							}) : null
						] }, model.id === "" ? String(index) : model.id))
					}) : null,
					history.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ogq-history",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ogq-history-head",
							children: t("free.historyTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "ogq-free-list",
							children: history.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "ogq-history-row",
								"data-kind": entry.kind,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ogq-history-text",
									children: entry.kind === "added" ? t("free.added", { name: entry.name }) : t("free.removed", { name: entry.name })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ogq-history-at",
									children: stampTime(entry.at)
								})]
							}, `history-${String(index)}`))
						})]
					}) : null,
					view.notes.map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ogq-note",
						children: note
					}, `free-note-${String(index)}`))
				]
			});
		}
		/**
		* The anchored panel. It is portalled to the document body by the chip, because
		* the docked composer contains fixed overlays.
		* @param props - folded views, placement, and the anchor ref.
		* @returns the panel element.
		*/
		function QuotaPanel({ view, sessionView, freeView, placement, panelRef, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: panelRef,
				className: "ogq-panel",
				role: "dialog",
				"aria-label": view.headline,
				style: {
					left: `${String(placement.left)}px`,
					bottom: `${String(placement.bottom)}px`,
					width: `${String(placement.width)}px`,
					maxHeight: `${String(placement.maxHeight)}px`
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ogq-panel-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GaugeIcon, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-panel-title",
								children: view.headline
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ogq-panel-value",
								children: view.label
							})
						]
					}),
					view.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ogq-window",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ogq-window-head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: window.label }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ogq-window-reset",
									children: window.resetsAt !== null ? t("usage.resetAt", { time: window.resetsAt }) : null
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${String(Math.round(window.percent))}%` })
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ogq-bar",
							"data-tone": toneOf(window.percent),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ogq-bar-fill",
								style: { width: `${String(Math.round(Math.min(100, Math.max(0, window.percent))))}%` }
							})
						})]
					}, window.key)),
					view.windows.some((window) => window.percent >= 100) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ogq-note",
						children: t("usage.exhausted")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
						className: "ogq-rows",
						children: view.notes.flatMap((row, index) => row[1] === null ? [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
							style: { gridColumn: "1 / -1" },
							children: row[0]
						}, `label-${String(index)}`)] : [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: row[0] }, `label-${String(index)}`), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: row[1] }, `value-${String(index)}`)])
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionSection, {
						view: sessionView,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FreeSection, {
						view: freeView,
						t
					})
				]
			});
		}
		// opencode-go-quota/src/client/chip.tsx
		/**
		* The composer-dock chip: a gauge glyph, the compact usage label, and the
		* free-model badge. Clicking it opens the panel above it.
		*
		* @module @local/opencode-go-quota/client/chip
		*/
		/**
		* Go usage windows, ambient on the composer's stats row.
		* @param props - readers, translate function, and the mounted Session id.
		* @returns the chip and, while open, the portalled panel.
		*/
		function UsageChip({ t, readUsage, readSessionUsage, readFree, sessionId }) {
			const snapshot = useUsage(readUsage);
			const free = useFreeModels(readFree);
			const view = describeUsage(snapshot, t);
			const freeView = describeFree(free, t);
			const ackKey = free === null ? "" : free.newFree.map((model) => model.id).sort().join(",");
			const panel = usePanel();
			const session = useSessionUsage(readSessionUsage, sessionId, panel.open);
			const sessionView = sessionId !== void 0 && sessionId !== "" ? describeSession(session, t) : {
				state: "unavailable",
				rows: [],
				notes: [t("session.unavailable")],
				tone: "muted"
			};
			react.useEffect(() => {
				if (!panel.open) return;
				if (ackKey === "") return;
				Promise.resolve().then(() => readFree(true, true)).catch(() => {});
			}, [
				panel.open,
				ackKey,
				readFree
			]);
			const worstTone = view.tone;
			const watchedFree = freeView.watched.some((model) => model.free);
			const badgeText = watchedFree ? t("free.badge") : freeView.newIds.size > 0 ? `+${String(freeView.newIds.size)}` : freeView.models.length > 0 ? String(freeView.models.length) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				ref: panel.anchorRef,
				className: "ogq-chip",
				"data-tone": worstTone,
				"data-opencode-usage": worstTone,
				"data-opencode-free": watchedFree ? "true" : "false",
				"aria-haspopup": "dialog",
				"aria-expanded": panel.open,
				onClick: panel.toggle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GaugeIcon, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "ogq-label",
						children: view.label
					}),
					badgeText !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "ogq-free-badge",
						children: badgeText
					}) : null
				]
			}), panel.open && panel.placement !== null ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaPanel, {
				view,
				sessionView,
				freeView,
				placement: panel.placement,
				panelRef: panel.panelRef,
				t
			}), document.body) : null] });
		}
		// opencode-go-quota/src/client.tsx
		/** Locale namespace owned by this bundle. */
		const NS = "opencodeGoQuota";
		/**
		* Exact routes this bundle's Host half answers, posted relative to the page so
		* a mount prefix keeps working. The carrier authenticates them with the page's
		* own session; the responses are JSON.
		*/
		const USAGE_ROUTE = "api/opencode-go-quota/usage";
		const SESSION_ROUTE = "api/opencode-go-quota/session";
		const FREE_ROUTE = "api/opencode-go-quota/free";
		/** A stalled Host read must not freeze the panel's refresh loop. */
		const CLIENT_REQUEST_TIMEOUT_MS = 15e3;
		const ja = {
			"usage.loading": "OpenCode 読み込み中",
			"usage.unconfigured": "OpenCode 未設定",
			"usage.error": "OpenCode 取得失敗",
			"usage.stale": "OpenCode {label} (更新失敗)",
			"usage.label": "5h {rolling}% / 週 {weekly}% / 月 {monthly}%",
			"usage.title": "OpenCode Go 使用量",
			"usage.titleUnconfigured": "OpenCode Go の使用量は取得できません",
			"usage.titleError": "OpenCode Go の使用量を取得できませんでした",
			"usage.envNote": "GoのAPIキーを {env} （資格情報ストアまたは環境変数）に設定すると表示されます。",
			"usage.rolling": "5時間ウィンドウ",
			"usage.weekly": "週次",
			"usage.monthly": "月次",
			"usage.resetAt": "{time} にリセット",
			"usage.updated": "取得時刻",
			"usage.retryAfter": "{seconds} 秒後に再試行してください。",
			"usage.exhausted": "制限に達しました。フリーモデルを使うか Extra Usage を確認してください。",
			"free.title": "期間限定フリーモデル",
			"free.checked": "確認時刻",
			"free.count": "{count} 件が無料",
			"free.badge": "無料",
			"free.new": "新",
			"free.newNote": "前回確認以降に追加されたフリーモデルがあります。この一覧を開くと「新」は解除されます。",
			"free.empty": "現在フリーモデルは見つかりません。",
			"free.error": "フリーモデル一覧を取得できませんでした。",
			"free.note": "ホスト側で公開モデル一覧を定期監視しています。フリーモデルはGoの使用量を消費しません。",
			"free.nowFree": "現在無料",
			"free.nowPaid": "現在有料（入力 {price} /100万トークン）",
			"free.nowPaidUnknown": "現在有料（単価未掲載）",
			"free.historyTitle": "最近の変化",
			"free.added": "{name} が無料に",
			"free.removed": "{name} が無料でなくなりました",
			"free.historyNote": "フリーモデルの追加・終了はホストの監視で検知し、この履歴はホスト起動以降の分を記録します。",
			"free.loading": "フリーモデルを読み込み中…",
			"session.title": "このセッション",
			"session.loading": "セッション消費を読み込み中…",
			"session.missing": "このセッションの利用情報を取得できませんでした。",
			"session.unavailable": "セッションが選択されていないため利用情報を表示できません。",
			"session.error": "セッション消費を取得できませんでした。",
			"session.empty": "このセッションではまだ OpenCode Go を利用していません。",
			"session.spend": "許容量消費（推定）",
			"session.requests": "リクエスト",
			"session.requestsWithCompaction": "{requests} 回（圧縮 {compaction} 回）",
			"session.tokens": "トークン",
			"session.tokenSplit": "入力 {input} / 出力 {output}",
			"session.cache": "キャッシュ",
			"session.models": "モデル",
			"session.subtree": "合計（サブエージェント込み）",
			"session.subtreeValue": "{sessions} 件 · {spend}",
			"session.other": "他LLM利用",
			"session.otherValue": "{requests} 回 · {tokens}",
			"session.note": "OpenCode Goの公表単価による推定です。時間帯倍率（DeepSeek系・Gemini 4 Argon）はレコード時刻で反映し、他LLMとタイトル生成は含みません。",
			"session.peak": "倍率適用",
			"session.free": "無料",
			"session.unpriced": "単価が不明なモデルの利用は推定に含まれていません。",
			"session.titleNote": "タイトル生成 {count} 回はトークンがログに残らないため、推定に含まれません。",
			"session.subagentMissing": "未読込・終了済みのサブエージェント {count} 件は含まれていません。",
			"session.updated": "計測時刻",
			"session.stale": "更新に失敗しました（{time} 時点の値）",
			"session.forkNote": "フォーク元から引き継いだ利用は含みません。"
		};
		const en = {
			"usage.loading": "OpenCode loading",
			"usage.unconfigured": "OpenCode not set up",
			"usage.error": "OpenCode unavailable",
			"usage.stale": "OpenCode {label} (refresh failed)",
			"usage.label": "5h {rolling}% / wk {weekly}% / mo {monthly}%",
			"usage.title": "OpenCode Go usage",
			"usage.titleUnconfigured": "OpenCode Go usage is unavailable",
			"usage.titleError": "Could not read the OpenCode Go usage",
			"usage.envNote": "Set the Go API key as {env} in the credential store or the environment to show it here.",
			"usage.rolling": "5-hour window",
			"usage.weekly": "Weekly",
			"usage.monthly": "Monthly",
			"usage.resetAt": "resets {time}",
			"usage.updated": "Read at",
			"usage.retryAfter": "Try again in {seconds} seconds.",
			"usage.exhausted": "A limit is reached; use a free model or check Extra Usage.",
			"free.title": "Limited-time free models",
			"free.checked": "Checked at",
			"free.count": "{count} free",
			"free.badge": "FREE",
			"free.new": "NEW",
			"free.newNote": "Free models appeared since your last look; opening this list clears the markers.",
			"free.empty": "No free models right now.",
			"free.error": "Could not read the free-model list.",
			"free.note": "The Host half polls the public model list. Free models do not consume the Go allowance.",
			"free.nowFree": "Free right now",
			"free.nowPaid": "Paid ({price}/Mtok input)",
			"free.nowPaidUnknown": "Paid (no published price)",
			"free.historyTitle": "Recent changes",
			"free.added": "{name} became free",
			"free.removed": "{name} is no longer free",
			"free.historyNote": "The Host watch records free-model additions and removals; the history covers this host run.",
			"free.loading": "Loading free models…",
			"session.title": "This session",
			"session.loading": "Loading session spend…",
			"session.missing": "Could not read this session’s usage.",
			"session.unavailable": "Select a session to see its usage.",
			"session.error": "Could not read session spend.",
			"session.empty": "This session has not used OpenCode Go yet.",
			"session.spend": "Allowance used (est.)",
			"session.requests": "Requests",
			"session.requestsWithCompaction": "{requests} ({compaction} compaction)",
			"session.tokens": "Tokens",
			"session.tokenSplit": "in {input} / out {output}",
			"session.cache": "Cached",
			"session.models": "Models",
			"session.subtree": "Total (with subagents)",
			"session.subtreeValue": "{sessions} sessions · {spend}",
			"session.other": "Other LLM use",
			"session.otherValue": "{requests} calls · {tokens}",
			"session.note": "Estimated from OpenCode Go’s published list prices, including time multipliers (DeepSeek rows, Gemini 4 Argon) at each record’s timestamp. Other LLMs and title generation are excluded.",
			"session.peak": "multiplied",
			"session.free": "free",
			"session.unpriced": "Usage of models without a known list price is excluded from the estimate.",
			"session.titleNote": "{count} title-generation call(s) are excluded because their tokens are not logged.",
			"session.updated": "Measured at",
			"session.stale": "Refresh failed; showing the {time} reading.",
			"session.forkNote": "Usage inherited from the fork source is excluded.",
			"session.subagentMissing": "{count} subagent session(s) were not loaded or have ended and are excluded."
		};
		const CSS = `
.ogq-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  font-variant-numeric: tabular-nums;
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
  appearance: none;
  background: none;
  border: 0;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
}
.ogq-chip svg { width: 14px; height: 14px; flex: none; }
@media (hover: hover) {
  .ogq-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.ogq-chip:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.ogq-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.ogq-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.ogq-chip[data-tone='muted'] { color: var(--dsw-alias-label-secondary); opacity: 0.75; }
.ogq-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ogq-free-badge {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-bg, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-warn-primary));
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}
.ogq-panel {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.ogq-panel-head { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.ogq-panel-head svg { width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-tertiary); }
.ogq-panel-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogq-panel-value { margin-left: auto; font-variant-numeric: tabular-nums; }
.ogq-window { margin: 8px 0 0; }
.ogq-window-head { display: flex; align-items: baseline; gap: 6px; }
.ogq-window-head span:first-child { color: var(--dsw-alias-label-secondary); }
.ogq-window-reset { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ogq-bar { height: 4px; margin: 4px 0 0; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.ogq-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.ogq-bar[data-tone='warn'] .ogq-bar-fill { background: var(--dsw-alias-state-warn-primary); }
.ogq-bar[data-tone='error'] .ogq-bar-fill { background: var(--dsw-alias-state-error-primary); }
.ogq-rows {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 4px 16px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.ogq-rows dt, .ogq-rows dd { min-width: 0; margin: 0; }
.ogq-rows dd { color: var(--dsw-alias-label-secondary); text-align: right; font-variant-numeric: tabular-nums; }
.ogq-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); }
.ogq-session, .ogq-free { margin-top: 12px; padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.ogq-session-head, .ogq-free-head { display: flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.ogq-rows-plain { margin-top: 6px; padding-top: 0; border-top: 0; }
.ogq-free-list { margin: 6px 0 0; padding: 0; list-style: none; }
.ogq-free-list li { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; min-width: 0; }
.ogq-free-id { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogq-free-tag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.ogq-free-tag[data-new='true'] { color: var(--dsw-alias-state-warn-primary); }
.ogq-watch-rows dd[data-free='true'] { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-warn-primary)); }
.ogq-history { margin-top: 8px; }
.ogq-history-head { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ogq-history-row .ogq-history-at { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.ogq-history-row[data-kind='removed'] .ogq-history-text { color: var(--dsw-alias-label-tertiary); }
`;
		/**
		* Abort when either the caller's signal aborts (chip unmounted) or the client
		* timeout elapses, whichever comes first.
		* @param signal - the poll's controller signal, when the caller passed one.
		* @returns the combined signal handed to `fetch`.
		*/
		function withTimeout(signal) {
			const timeout = AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS);
			if (signal === void 0) return timeout;
			if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
			const controller = new AbortController();
			const abort = () => {
				controller.abort();
			};
			signal.addEventListener("abort", abort, { once: true });
			timeout.addEventListener("abort", abort, { once: true });
			return controller.signal;
		}
		/** Required services: slot registration and the dictionary registry. */
		const inject = ["slots", "locale"];
		/**
		* Browser plugin body.
		* @param ctx - client cordis context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset["dshPlugin"] = "@local/opencode-go-quota";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "opencode-go-quota: chip styles");
			ctx.effect(() => {
				const disposeJa = ctx.locale.register(NS, "ja", ja);
				const disposeEn = ctx.locale.register(NS, "en", en);
				return () => {
					disposeJa();
					disposeEn();
				};
			}, "opencode-go-quota: dictionaries");
			const t = ctx.locale.bind(NS);
			/**
			* Read this bundle's Host half. The routes sit below the page's
			* authenticated carrier, so the browser session cookie is the whole
			* credential and no secret reaches the browser.
			* @param force - bypass the Host cache.
			* @param signal - abort signal owned by the polling effect.
			* @returns the usage snapshot.
			*/
			const readUsage = async (force, signal) => {
				const response = await fetch(force ? `${USAGE_ROUTE}?force=1` : USAGE_ROUTE, {
					method: "GET",
					headers: { accept: "application/json" },
					credentials: "same-origin",
					cache: "no-store",
					signal: withTimeout(signal)
				});
				if (!response.ok) throw new Error(`usage route answered HTTP ${String(response.status)}`);
				const snapshot = await response.json();
				if (snapshot === null || typeof snapshot !== "object") throw new Error("usage route answered no snapshot");
				return snapshot;
			};
			/**
			* Read one Session's attributed usage from this bundle's Host half.
			* The route reads the durable log, so it also sees usage from before a
			* context compaction and from a model that is no longer selected.
			* @param sessionId - mounted Session identity.
			* @param signal - abort signal owned by the polling effect.
			* @returns the session usage snapshot.
			*/
			const readSessionUsage = async (sessionId, signal) => {
				const url = `${SESSION_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`;
				const response = await fetch(url, {
					method: "GET",
					headers: { accept: "application/json" },
					credentials: "same-origin",
					cache: "no-store",
					signal: withTimeout(signal)
				});
				if (!response.ok) throw new Error(`session route answered HTTP ${String(response.status)}`);
				const snapshot = await response.json();
				if (snapshot === null || typeof snapshot !== "object") throw new Error("session route answered no snapshot");
				return snapshot;
			};
			/**
			* Read the free-model watch. `ack` folds the currently reported new models
			* into the Host's baseline.
			* @param force - refetch even inside the Host TTL.
			* @param ack - also clear the pending new-model list.
			* @param signal - abort signal owned by the polling effect.
			* @returns the free-model snapshot.
			*/
			const readFree = async (force, ack, signal) => {
				const params = new URLSearchParams();
				if (force) params.set("force", "1");
				if (ack) params.set("ack", "1");
				const query = params.toString();
				const response = await fetch(query === "" ? FREE_ROUTE : `${FREE_ROUTE}?${query}`, {
					method: "GET",
					headers: { accept: "application/json" },
					credentials: "same-origin",
					cache: "no-store",
					signal: withTimeout(signal)
				});
				if (!response.ok) throw new Error(`free route answered HTTP ${String(response.status)}`);
				const snapshot = await response.json();
				if (snapshot === null || typeof snapshot !== "object") throw new Error("free route answered no snapshot");
				return snapshot;
			};
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "opencode-go-usage",
				order: 21,
				inject: () => ({
					readUsage,
					readSessionUsage,
					readFree,
					t
				})
			}, UsageChip));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map