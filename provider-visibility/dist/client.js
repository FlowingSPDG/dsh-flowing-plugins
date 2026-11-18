window.__ModuleLoader__.load({
	id: `@local/provider-visibility`,
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		// provider-visibility/src/routes.ts
		function isRouteLike(value) {
			if (typeof value !== "object" || value === null) return false;
			const record = value;
			return typeof record["provider"] === "string" && typeof record["model"] === "string" && record["provider"] !== "" && record["model"] !== "";
		}
		/**
		* Deduplicate a turn's attributed routes, keeping first-seen order.
		*
		* The key is a NUL-separated pair rather than `provider/model`, so provider
		* `a/b` with model `c` and provider `a` with model `b/c` stay distinct.
		*
		* @param routes - untrusted token-usage attribution.
		* @returns the non-empty, de-duplicated routes.
		*/
		function uniqueRoutes(routes) {
			if (!Array.isArray(routes)) return [];
			const seen = /* @__PURE__ */ new Set();
			const unique = [];
			for (const route of routes) {
				if (!isRouteLike(route)) continue;
				const key = `${route.provider}\u0000${route.model}`;
				if (seen.has(key)) continue;
				seen.add(key);
				unique.push({
					provider: route.provider,
					model: route.model
				});
			}
			return unique;
		}
		/**
		* Resolve one catalog badge's text, tolerating a missing badge or a resolver
		* failure: the label then renders without a badge rather than crashing.
		*
		* @param badge - the catalog model's optional badge.
		* @param resolveText - locale text resolver.
		* @returns the display text, or `''` when there is none.
		*/
		function badgeText(badge, resolveText) {
			const text = badge?.text;
			if (text === void 0 || text === null) return "";
			try {
				return resolveText(text);
			} catch {
				return "";
			}
		}
		/**
		* Normalize the slot's placement prop.
		*
		* @param placement - the owner's placement, possibly absent.
		* @returns the placement, defaulting to a menu row.
		*/
		function normalizePlacement(placement) {
			return placement === "trigger" || placement === "option" ? placement : "menu";
		}
		// provider-visibility/src/client.tsx
		const NS = "@local/provider-visibility";
		const CSS = `
.pv-route {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
}
.pv-route .pv-provider {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
}
.pv-route .pv-sep { color: var(--dsw-alias-label-tertiary); flex: none; }
.pv-route .pv-model {
  color: var(--dsw-alias-label-primary);
  flex: none;
}
.pv-route[data-placement='option'] .pv-provider { font-weight: 400; }
.pv-badge {
  flex: none;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 5px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
}
.pv-turn-routes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 2px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: 18px;
}
.pv-turn-route {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  padding: 1px 7px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-2);
  white-space: nowrap;
}
.pv-turn-route .pv-turn-provider {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.pv-turn-route .pv-turn-slash { color: var(--dsw-alias-label-tertiary); flex: none; }
.pv-turn-route .pv-turn-model { color: var(--dsw-alias-label-primary); flex: none; }
`;
		/**
		* `Provider · Model` for the composer trigger, the root-menu current value,
		* and each model option. The provider truncates first, so the model name
		* stays readable in the narrow trigger.
		*
		* @param props - the slot's owner props plus the badge resolver.
		* @returns inline content, or null without names.
		*/
		function RouteLabel(props) {
			const { provider, model, placement, resolveText } = props;
			const badge = model.badge;
			const name = badgeText(badge, resolveText);
			const badgeNode = name === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "pv-badge",
				children: name
			});
			const providerNode = provider.name === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "pv-provider",
				title: provider.name,
				children: provider.name
			});
			const separator = providerNode === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "pv-sep",
				"aria-hidden": true,
				children: "·"
			});
			const where = normalizePlacement(placement);
			if (where === "trigger") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "pv-route",
				"data-placement": "trigger",
				children: [
					badgeNode,
					providerNode,
					separator,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pv-model",
						children: model.name
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "pv-route",
				"data-placement": where,
				children: [
					providerNode,
					separator,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pv-model",
						children: model.name
					}),
					badgeNode
				]
			});
		}
		function RouteChip({ route }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "pv-turn-route",
				title: `${route.provider} / ${route.model}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pv-turn-provider",
						children: route.provider
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pv-turn-slash",
						"aria-hidden": true,
						children: "/"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pv-turn-model",
						children: route.model
					})
				]
			});
		}
		/**
		* The provider/model routes that served one completed turn, as quiet chips
		* under the answer. Turns without attribution render nothing, matching the
		* slot contract for empty entries.
		*
		* @param props - the slot's owner props.
		* @returns the chip row, or null.
		*/
		function TurnRoutes({ turn }) {
			const routes = uniqueRoutes(turn.data.get("turn-tail")?.tokenUsage?.routes);
			if (routes.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "pv-turn-routes",
				"data-provider-visibility": "turn-routes",
				children: routes.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteChip, { route }, `${route.provider}\u0000${route.model}`))
			});
		}
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset["dshPlugin"] = NS;
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "provider-visibility: styles");
			const resolveText = ctx.locale.resolveText;
			ctx.slots.inject("conversation.input.model.label", () => ctx.slots.register({ name: "conversation.input.model.label" }, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteLabel, {
				...props,
				resolveText
			})));
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: "provider-visibility",
				order: 5
			}, TurnRoutes));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map