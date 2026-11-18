window.__ModuleLoader__.load({
	id: `@local/ollama-offpeak`,
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		const MINUTE_MS = 6e4;
		/**
		* Read one instant against the published peak window.
		*
		* Peak billing is weekdays 12:00 (inclusive) to 18:00 (exclusive) UTC, so the
		* weekend is off-peak for its whole length.
		*
		* @param now - epoch milliseconds, normally `Date.now()`.
		* @returns whether it bills at peak, and when the next boundary is. A
		* non-finite instant has no UTC day or clock to read, so it reports off-peak
		* with nothing remaining instead of formatting `NaN` minutes.
		*/
		function peakState(now) {
			if (!Number.isFinite(now)) return {
				peak: false,
				nextAt: now,
				remainingMs: 0
			};
			const at = new Date(now);
			const day = at.getUTCDay();
			const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
			const peak = day >= 1 && day <= 5 && minutes >= 720 && minutes < 1080;
			if (peak) {
				const nextAt = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 18, 0, 0, 0);
				return {
					peak,
					nextAt,
					remainingMs: Math.max(0, nextAt - now)
				};
			}
			for (let add = 0; add < 8; add += 1) {
				const candidate = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + add, 12, 0, 0, 0);
				const candidateDay = new Date(candidate).getUTCDay();
				if (candidateDay === 0 || candidateDay === 6) continue;
				if (candidate <= now) continue;
				return {
					peak,
					nextAt: candidate,
					remainingMs: Math.max(0, candidate - now)
				};
			}
			return {
				peak,
				nextAt: now,
				remainingMs: 0
			};
		}
		/**
		* Format a remaining duration for the chip label and panel.
		*
		* Whole minutes are rounded up, then split into days/hours/minutes. A day
		* present drops the minutes (the chip reads `2日3時間`, not `2日3時間4分`).
		*
		* @param ms - remaining milliseconds; non-finite or negative input reads `0分`.
		* @param t - namespace translate function.
		* @returns a short duration: `45分`, `1時間23分`, `2日3時間`.
		*/
		function formatRemaining(ms, t) {
			const totalMinutes = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / MINUTE_MS));
			const days = Math.floor(totalMinutes / 1440);
			const hours = Math.floor(totalMinutes % 1440 / 60);
			const minutes = totalMinutes % 60;
			if (days > 0) return t("duration.days", {
				days: String(days),
				hours: String(hours)
			});
			if (hours > 0) return t("duration.hours", {
				hours: String(hours),
				minutes: String(minutes)
			});
			return t("duration.minutes", { minutes: String(minutes) });
		}
		// ollama-offpeak/src/client.tsx
		/**
		* Browser half of the Ollama Cloud off-peak chip.
		*
		* Ollama Cloud publishes an off-peak rate for its DeepSeek models: peak billing
		* is weekdays 12:00–18:00 UTC, and every other hour — including the whole UTC
		* weekend — bills at the off-peak rate. The chip reads the UTC wall clock and
		* names the current side of that boundary plus the time left on it, so a user
		* can tell at a glance whether a request right now bills at peak.
		*
		* The clock arithmetic lives in `peak.ts`; this module owns only the DOM.
		*
		* @module @local/ollama-offpeak/client
		*/
		/** Locale namespace owned by this bundle. */
		const NS = "ollamaOffpeak";
		/** A clock boundary is the only thing that changes this chip; half a minute is plenty. */
		const TICK_MS = 3e4;
		const ja = {
			"peak.label": "ピーク · {remaining}",
			"offPeak.label": "オフピーク · {remaining}",
			"peak.title": "Ollama Cloud オフピーク時間",
			"peak.now": "現在",
			"peak.state.peak": "ピークタイム",
			"peak.state.offPeak": "オフピークタイム",
			"peak.window": "ピーク時間",
			"peak.windowValue": "月〜金 12:00–18:00 UTC（UTC の週末は終日オフピーク）",
			"peak.next": "次の切替",
			"peak.nextToOffPeak": "18:00 UTC にオフピークへ",
			"peak.nextToPeak": "12:00 UTC にピークへ",
			"peak.remaining": "あと {remaining}",
			"peak.localClock": "現地時刻 {time}",
			"peak.localClockLabel": "現地時刻",
			"duration.minutes": "{minutes}分",
			"duration.hours": "{hours}時間{minutes}分",
			"duration.days": "{days}日{hours}時間"
		};
		/** English copy; the annotation makes a missing or extra key a compile error. */
		const en = {
			"peak.label": "Peak · {remaining}",
			"offPeak.label": "Off-peak · {remaining}",
			"peak.title": "Ollama Cloud off-peak hours",
			"peak.now": "Now",
			"peak.state.peak": "Peak time",
			"peak.state.offPeak": "Off-peak time",
			"peak.window": "Peak hours",
			"peak.windowValue": "Mon–Fri 12:00–18:00 UTC (the UTC weekend is off-peak all day)",
			"peak.next": "Next change",
			"peak.nextToOffPeak": "off-peak at 18:00 UTC",
			"peak.nextToPeak": "peak at 12:00 UTC",
			"peak.remaining": "in {remaining}",
			"peak.localClock": "local {time}",
			"peak.localClockLabel": "Local time",
			"duration.minutes": "{minutes}m",
			"duration.hours": "{hours}h{minutes}m",
			"duration.days": "{days}d {hours}h"
		};
		const CSS = `
.dp-chip {
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
.dp-chip svg { width: 14px; height: 14px; flex: none; }
@media (hover: hover) {
  .dp-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dp-chip:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dp-chip[data-tone='peak'] { color: var(--dsw-alias-state-warn-primary); }
.dp-chip[data-tone='offPeak'] { color: var(--dsw-alias-state-success-primary); }
.dp-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dp-panel {
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
.dp-panel-head { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dp-panel-head svg { width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-tertiary); }
.dp-panel-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-panel-value { margin-left: auto; font-variant-numeric: tabular-nums; }
.dp-rows {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 4px 16px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.dp-rows dt, .dp-rows dd { min-width: 0; margin: 0; }
.dp-rows dd { color: var(--dsw-alias-label-secondary); text-align: right; font-variant-numeric: tabular-nums; }
`;
		/** Local wall-clock time of a UTC instant, for the panel. */
		function localClock(at) {
			try {
				return new Date(at).toLocaleTimeString(void 0, {
					hour: "2-digit",
					minute: "2-digit"
				});
			} catch {
				return new Date(at).toISOString().slice(11, 16);
			}
		}
		/** Clock glyph: a dial with the current half filled. */
		function ClockIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: 8,
						cy: 8,
						r: 6.4,
						stroke: "currentColor",
						strokeWidth: 1.3
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 8 V4.4",
						stroke: "currentColor",
						strokeWidth: 1.3,
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 8 L10.7 9.7",
						stroke: "currentColor",
						strokeWidth: 1.3,
						strokeLinecap: "round"
					})
				]
			});
		}
		/**
		* The chip's open state plus the placement measured when it opens. The panel
		* anchors above the chip and closes on Escape, an outside press, or a scroll.
		*/
		function usePanel() {
			const anchorRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [placement, setPlacement] = (0, react.useState)(null);
			const toggle = (0, react.useCallback)(() => {
				setOpen((wasOpen) => {
					if (wasOpen) return false;
					const rect = anchorRef.current?.getBoundingClientRect();
					if (rect === void 0) return false;
					const width = Math.min(300, window.innerWidth - 24);
					const centered = rect.left + rect.width / 2 - width / 2;
					const left = Math.min(Math.max(12, centered), Math.max(12, window.innerWidth - width - 12));
					setPlacement({
						left,
						width,
						bottom: window.innerHeight - rect.top + 8,
						maxHeight: Math.max(160, rect.top - 20)
					});
					return true;
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointer = (event) => {
					const target = event.target;
					if (target instanceof Node && panelRef.current?.contains(target) === true) return;
					if (target instanceof Node && anchorRef.current?.contains(target) === true) return;
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onViewport = () => {
					setOpen(false);
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKey);
				window.addEventListener("resize", onViewport);
				window.addEventListener("scroll", onViewport, true);
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKey);
					window.removeEventListener("resize", onViewport);
					window.removeEventListener("scroll", onViewport, true);
				};
			}, [open]);
			return {
				open,
				placement,
				toggle,
				anchorRef,
				panelRef
			};
		}
		/** Peak or off-peak for Ollama Cloud, on the composer dock. */
		function PeakChip(props) {
			const { t } = props;
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = setInterval(() => {
					setNow(Date.now());
				}, TICK_MS);
				return () => {
					clearInterval(timer);
				};
			}, []);
			const state = peakState(now);
			const remaining = formatRemaining(state.remainingMs, t);
			const label = t(state.peak ? "peak.label" : "offPeak.label", { remaining });
			const headline = t("peak.title");
			const rows = [
				[t("peak.now"), t(state.peak ? "peak.state.peak" : "peak.state.offPeak")],
				[t("peak.window"), t("peak.windowValue")],
				[t("peak.next"), `${t(state.peak ? "peak.nextToOffPeak" : "peak.nextToPeak")} — ${t("peak.remaining", { remaining })}`],
				[t("peak.localClockLabel"), localClock(state.nextAt)]
			];
			const { open, placement, toggle, anchorRef, panelRef } = usePanel();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				ref: anchorRef,
				className: "dp-chip",
				"data-tone": state.peak ? "peak" : "offPeak",
				"data-ollama-offpeak": state.peak ? "peak" : "off-peak",
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				onClick: toggle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClockIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dp-label",
					children: label
				})]
			}), open && placement !== null ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: panelRef,
				className: "dp-panel",
				role: "dialog",
				"aria-label": headline,
				style: {
					left: `${String(placement.left)}px`,
					bottom: `${String(placement.bottom)}px`,
					width: `${String(placement.width)}px`,
					maxHeight: `${String(placement.maxHeight)}px`
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dp-panel-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClockIcon, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dp-panel-title",
							children: headline
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dp-panel-value",
							children: label
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
					className: "dp-rows",
					children: rows.flatMap((row, index) => [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: row[0] }, `label-${String(index)}`), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: row[1] }, `value-${String(index)}`)])
				})]
			}), document.body) : null] });
		}
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset["dshPlugin"] = "@local/ollama-offpeak";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "ollama-offpeak: chip styles");
			ctx.effect(() => {
				const disposers = [ctx.locale.register(NS, "ja", ja), ctx.locale.register(NS, "en", en)];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "ollama-offpeak: dictionaries");
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "ollama-offpeak",
				order: 40,
				locale: NS
			}, PeakChip));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map