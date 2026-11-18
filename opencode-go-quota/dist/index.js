// opencode-go-quota/src/prices.ts
/**
* The two published DeepSeek multiplier windows: weekdays 01:00–04:00 and
* 06:00–10:00 UTC. Minutes are counted from UTC midnight.
*/
const WEEKDAY_WINDOWS = Object.freeze([Object.freeze({
	days: Object.freeze([
		1,
		2,
		3,
		4,
		5
	]),
	startMinute: 60,
	endMinute: 240
}), Object.freeze({
	days: Object.freeze([
		1,
		2,
		3,
		4,
		5
	]),
	startMinute: 360,
	endMinute: 600
})]);
/** A flat published price row, USD per million tokens. */
function flatPrice(input, cached, output) {
	return Object.freeze({
		input,
		cached,
		output
	});
}
/** A price row with long-context overrides. */
function tieredPrice(base, tiers) {
	return Object.freeze({
		...base,
		tiers: Object.freeze(tiers.map((tier) => Object.freeze(tier)))
	});
}
/** A price row with an hourly multiplier on weekdays (DeepSeek models). */
function peakedPrice(input, cached, output, windows) {
	return Object.freeze({
		...flatPrice(input, cached, output),
		peakHours: Object.freeze(windows)
	});
}
/** A price row with a date-based multiplier (Gemini 4 Argon). */
function datedPrice(input, cached, output, from) {
	return Object.freeze({
		...flatPrice(input, cached, output),
		peakFrom: from
	});
}
/** The built-in published price table, keyed by lower-case model id. */
const MODEL_PRICES = Object.freeze({
	"beam-free": flatPrice(0, 0, 0),
	"claude-haiku-5-5": tieredPrice({
		input: .1,
		cached: .01,
		output: .5
	}, [{
		overTokens: 1e5,
		input: .5,
		cached: .05,
		output: 2.5
	}]),
	"deepseek-v4.1-flash": peakedPrice(.15, .003, .6, WEEKDAY_WINDOWS),
	"deepseek-v4-pro": peakedPrice(.66, .022, 1.98, WEEKDAY_WINDOWS),
	"gemini-4-argon": datedPrice(2, .1, 10, "2026-12-01"),
	"glm-5.2": flatPrice(1.4, .26, 4.4),
	"glm-5.3": flatPrice(1.4, .26, 4.4),
	"glm-5.3-flash": flatPrice(.15, .03, .5),
	"grok-4.7": tieredPrice({
		input: 2,
		cached: .5,
		output: 6
	}, [{
		overTokens: 2e5,
		input: 4,
		cached: 1,
		output: 12
	}]),
	"gpt-5.6-luna": tieredPrice({
		input: .2,
		cached: .02,
		output: 1.2
	}, [{
		overTokens: 272e3,
		input: .4,
		cached: .04,
		output: 1.8
	}]),
	"gpt-6-luna": tieredPrice({
		input: .1,
		cached: .01,
		output: .5
	}, [{
		overTokens: 272e3,
		input: .2,
		cached: .02,
		output: .75
	}]),
	hy3: flatPrice(.14, .035, .58),
	hy4: flatPrice(.834, .042, 2.501),
	"hy4-preview": flatPrice(.834, .042, 2.501),
	"hy4-flash-free": flatPrice(0, 0, 0),
	"iceman-contributor-free": flatPrice(0, 0, 0),
	"kimi-k2.7-code": flatPrice(.95, .19, 4),
	"kimi-k3": flatPrice(3, .3, 15),
	"kimi-k3.1-pro": flatPrice(2, .2, 10),
	"longcat-2.0": flatPrice(.3, .006, 1.2),
	"longcat-2.5-free": flatPrice(0, 0, 0),
	"mimo-v2.6-flash": flatPrice(.14, .0028, .28),
	"mimo-v2.6-pro": flatPrice(.435, .0036, .87),
	"minimax-m3": tieredPrice({
		input: .3,
		cached: .06,
		output: 1.2
	}, [{
		overTokens: 512e3,
		input: .6,
		cached: .12,
		output: 2.4
	}]),
	"minimax-m3.1-flash": flatPrice(.15, .015, .6),
	"muse-spark-1.2-contributor": flatPrice(.1, .002, .2),
	"muse-spark-1.3-contributor": flatPrice(.1, .002, .2),
	"qwen3.7-plus": tieredPrice({
		input: .4,
		cached: .04,
		output: 1.6
	}, [{
		overTokens: 256e3,
		input: 1.2,
		cached: .12,
		output: 4.8
	}]),
	"qwen3.8-flash": flatPrice(.15, .016, .47),
	"qwen3.8-max": flatPrice(2, .25, 6),
	"qwen4-max": flatPrice(1.5, .075, 4.5),
	"step-5-preview": flatPrice(1, .1, 2.7)
});
/**
* Resolve the published price for a model id at one instant, including the
* documented long-context tier and the time multipliers.
*
* A routed id may carry a variant suffix (`model:thinking`), so the lookup
* falls back to the id before the first colon, matching the shipped estimate.
*
* @param model - routed model id.
* @param at - epoch milliseconds of the usage record.
* @param contextTokens - input + cache-read + cache-write tokens of the record.
* @param prices - merged price table.
* @returns the selected rates and whether a multiplier applied, or undefined
*   when the model has no usable published price.
*/
function priceFor(model, at, contextTokens, prices) {
	const key = model.trim().toLowerCase();
	if (key === "") return void 0;
	const base = key.split(":")[0];
	const row = prices[key] ?? (base === void 0 ? void 0 : prices[base]);
	if (!usablePrice(row)) return void 0;
	const priced = row;
	let selected = {
		input: priced.input,
		cached: priced.cached,
		output: priced.output
	};
	let peak = false;
	const tiers = Array.isArray(priced.tiers) ? priced.tiers : [];
	for (const tier of tiers) if (Number.isFinite(tier.overTokens) && Number.isFinite(contextTokens) && contextTokens > tier.overTokens && Number.isFinite(tier.input) && Number.isFinite(tier.cached) && Number.isFinite(tier.output)) {
		selected = {
			input: tier.input,
			cached: tier.cached,
			output: tier.output
		};
		break;
	}
	if (isPeakAt(at, priced)) {
		peak = true;
		selected = {
			input: selected.input * 2,
			cached: selected.cached * 2,
			output: selected.output * 2
		};
	}
	return {
		price: selected,
		peak
	};
}
/**
* Whether one instant falls inside a price row's published time multiplier.
* @param at - epoch milliseconds.
* @param row - price row.
* @returns true inside a documented peak window or after the peak start date.
*/
function isPeakAt(at, row) {
	if (row.peakHours !== void 0) {
		const date = new Date(at);
		const day = date.getUTCDay();
		const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
		for (const window of row.peakHours) {
			if (!Array.isArray(window.days) || !window.days.includes(day)) continue;
			if (minute >= window.startMinute && minute < window.endMinute) return true;
		}
		return false;
	}
	if (typeof row.peakFrom === "string") {
		const from = Date.parse(`${row.peakFrom}T00:00:00Z`);
		return Number.isFinite(from) && at >= from;
	}
	return false;
}
/**
* Whether an untrusted row carries every rate a cost calculation needs.
* @param row - candidate row.
* @returns true for finite input/cached/output rates.
*/
function usablePrice(row) {
	if (row === null || typeof row !== "object") return false;
	const candidate = row;
	return Number.isFinite(candidate["input"]) && Number.isFinite(candidate["cached"]) && Number.isFinite(candidate["output"]);
}
/**
* Merge a profile's price overrides over the published table. Overrides are
* untrusted JSON rows and stay `unknown` until {@link usablePrice} accepts
* them at lookup time.
* @param base - built-in table.
* @param overrides - optional `prices` config object.
* @returns a new table with lower-case keys.
*/
function mergePriceOverrides(base, overrides) {
	if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) return base;
	const merged = { ...base };
	for (const [key, row] of Object.entries(overrides)) {
		const name = key.trim().toLowerCase();
		if (name === "") continue;
		merged[name] = row;
	}
	return merged;
}
// opencode-go-quota/src/config.ts
/**
* Row configuration and the small coercions every Host module shares.
*
* The Loader hands the row's `config` through untouched, so everything here
* starts from `unknown` and narrows structurally: a malformed or absent key
* falls back to the documented default instead of throwing at activation.
*
* @module @local/opencode-go-quota/config
*/
/** Documented Go usage endpoint; Bearer-authenticated by the Go API key. */
const USAGE_PATH = "/zen/go/v1/usage";
/** Public models list for the free-model watcher; needs no key. */
const MODELS_PATH = "/inference/go/v1/models";
/** Exact Fetch routes below the authenticated carrier channel. */
const USAGE_ROUTE_PATH = "/api/opencode-go-quota/usage";
const SESSION_ROUTE_PATH = "/api/opencode-go-quota/session";
const FREE_ROUTE_PATH = "/api/opencode-go-quota/free";
/** A hung upstream read must not pin the rest of the polling loop. */
const REQUEST_TIMEOUT_MS = 15e3;
/** Documented defaults for every configurable row key. */
const DEFAULTS = Object.freeze({
	apiKeyEnv: "OPENCODE_GO_API_KEY",
	baseUrl: "https://opencode.ai",
	refreshSeconds: 60,
	freeRefreshSeconds: 600,
	provider: "opencode-go"
});
/**
* Resolve a row's config.
* @param config - the raw Loader config (any JSON value).
* @returns the resolved options.
*/
function resolveConfig(config) {
	const options = asRecord(config) ?? {};
	const refreshSeconds = boundedNumber(options["refreshSeconds"], 60, DEFAULTS.refreshSeconds);
	const freeRefreshSeconds = boundedNumber(options["freeRefreshSeconds"], 300, DEFAULTS.freeRefreshSeconds);
	return {
		apiKeyEnv: nonEmpty(options["apiKeyEnv"]) ?? DEFAULTS.apiKeyEnv,
		baseUrl: (nonEmpty(options["baseUrl"]) ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
		refreshSeconds,
		freeRefreshSeconds,
		ttlMs: refreshSeconds * 1e3,
		freeTtlMs: freeRefreshSeconds * 1e3,
		provider: (nonEmpty(options["provider"]) ?? DEFAULTS.provider).toLowerCase(),
		prices: mergePriceOverrides(MODEL_PRICES, options["prices"]),
		watchModels: parseWatchModels(options["watchModels"])
	};
}
/** A plain object view of a JSON value, or undefined for anything else. */
function asRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	return value;
}
/**
* Parse the configured watched model names: lower-case, non-empty, unique.
* @param value - the row's `watchModels` config.
* @returns the names to report free status for.
*/
function parseWatchModels(value) {
	if (!Array.isArray(value)) return [];
	const names = [];
	for (const entry of value) {
		const name = typeof entry === "string" ? entry.trim().toLowerCase() : "";
		if (name !== "" && !names.includes(name)) names.push(name);
	}
	return names;
}
/** Read one field of an unknown value; undefined for a non-object. */
function fieldOf(value, key) {
	return asRecord(value)?.[key];
}
/** Trim to a non-empty string, or undefined. */
function nonEmpty(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/** Coerce to a string without inventing content. */
function text(value) {
	return typeof value === "string" ? value : "";
}
/** Coerce to a finite number, or undefined. */
function finite(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** Coerce a token counter to a non-negative finite number. */
function count(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
/**
* Clamp a numeric config value between a floor and a default.
* @param value - configured value.
* @param min - smallest accepted value.
* @param fallback - used when the value is not a finite number.
* @returns the clamped number.
*/
function boundedNumber(value, min, fallback) {
	const parsed = Number(value);
	return Math.max(min, Number.isFinite(parsed) ? parsed : fallback);
}
/** Message of an unknown thrown value. */
function messageOf(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/** A fresh watcher state, before any successful read. */
function emptyFreeWatch() {
	return {
		last: null,
		newFree: [],
		seenIds: [],
		history: []
	};
}
/**
* Whether a routed model id carries OpenCode's limited-time free suffix.
* @param modelId - routed model id.
* @returns true for ids ending in `-free`.
*/
function hasFreeSuffix(modelId) {
	return typeof modelId === "string" && modelId.trim().toLowerCase().endsWith("-free");
}
/**
* Whether one models-list row is a limited-time free model.
* @param model - raw models-list entry.
* @returns true for a published free chat model.
*/
function isFreeModel(model) {
	const row = asRecord(model);
	if (row === void 0) return false;
	if (hasFreeSuffix(row["id"])) return true;
	const textCost = asRecord(asRecord(row["cost"])?.["text"]);
	if (textCost === void 0) return false;
	const inputPrice = fieldOf(textCost["input"], "price");
	const outputPrice = fieldOf(textCost["output"], "price");
	return inputPrice === 0 && outputPrice === 0;
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
function collectWatched(rows, watchModels) {
	const watched = [];
	for (const watchName of watchModels) {
		const match = rows.find((row) => row.id === watchName || row.canonical !== null && row.canonical.split("/").pop() === watchName || hasFreeSuffix(row.id) && row.id.slice(0, -5) === watchName);
		if (match === void 0) continue;
		const free = isFreeModel(match.raw);
		const cost = asRecord(asRecord(match.raw["cost"])?.["text"]);
		const inputPrice = finite(asRecord(cost?.["input"])?.["price"]);
		const outputPrice = finite(asRecord(cost?.["output"])?.["price"]);
		watched.push({
			id: match.id,
			name: match.name,
			canonical: match.canonical,
			free,
			inputPrice: free ? 0 : inputPrice ?? null,
			outputPrice: free ? 0 : outputPrice ?? null
		});
	}
	return watched;
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
function applyFreeReading(state, reading, now) {
	const seeded = state.last !== null;
	const fresh = seeded ? reading.models.filter((model) => !state.seenIds.includes(model.id)) : [];
	const gone = seeded ? state.seenIds.filter((id) => !reading.models.some((model) => model.id === id)) : [];
	const names = state.last?.names ?? {};
	const history = [...state.history];
	for (const model of fresh) history.unshift({
		at: now,
		kind: "added",
		id: model.id,
		name: model.name
	});
	for (const id of gone) history.unshift({
		at: now,
		kind: "removed",
		id,
		name: names[id] ?? id
	});
	const firstSeen = { ...state.last?.firstSeen ?? {} };
	for (const model of reading.models) if (firstSeen[model.id] === void 0) firstSeen[model.id] = now;
	return {
		last: {
			models: reading.models,
			watched: reading.watched,
			at: now,
			names: Object.fromEntries(reading.models.map((model) => [model.id, model.name])),
			firstSeen
		},
		newFree: fresh,
		seenIds: reading.models.map((model) => model.id),
		history: history.slice(0, 24)
	};
}
// opencode-go-quota/src/projection.ts
/**
* The Host-only Session projection: a pure fold over the durable event log that
* attributes every provider-reported usage record to the route that produced
* it, so an OpenCode Go allowance is never charged for another provider's
* tokens and a mixed-model Session is still counted in full.
*
* Everything here is synchronous and returns plain JSON, per the projection
* seam's unit contract; a state transition that does not care about an event
* returns the same reference so the framework can skip downstream work.
*
* @module @local/opencode-go-quota/projection
*/
/** Numeric state fields a checkpoint may carry. */
const USAGE_STATE_NUMBERS = [
	"requests",
	"compactionRequests",
	"titleRequests",
	"input",
	"output",
	"cacheRead",
	"cacheWrite",
	"total",
	"estimatedUsd",
	"pricedRequests",
	"unpricedRequests",
	"otherRequests",
	"otherCompactionRequests",
	"otherTokens"
];
/**
* Create the initial immutable per-Session projection state.
* @param ownStart - fork-inherited prefix length; events before it are skipped.
* @param routeProvider - current routed provider, empty before the first header.
* @param routeModel - current routed model, empty before the first header.
* @returns a plain-JSON state.
*/
function emptyUsageState(ownStart, routeProvider = "", routeModel = "") {
	return {
		ownStart,
		routeProvider,
		routeModel,
		requests: 0,
		compactionRequests: 0,
		titleRequests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		estimatedUsd: 0,
		pricedRequests: 0,
		unpricedRequests: 0,
		otherRequests: 0,
		otherCompactionRequests: 0,
		otherTokens: 0,
		firstAt: null,
		lastAt: null,
		childIds: [],
		buckets: {},
		last: null
	};
}
/**
* Validate and normalize a projection checkpoint.
*
* The seam only calls `parse`, so this plain validator stands in for the Zod
* schema without adding a schema dependency to the package; a non-object
* checkpoint is rejected rather than folded into a wrong total.
*
* @param value - stored state.
* @returns a normalized state.
* @throws when the stored value is not an object.
*/
function parseUsageState(value) {
	const raw = asRecord(value);
	if (raw === void 0) throw new Error("opencode-go quota usage state was not an object");
	const state = emptyUsageState(Number(raw["ownStart"]) || 0);
	for (const key of USAGE_STATE_NUMBERS) {
		const stored = raw[key];
		if (Number.isFinite(stored)) state[key] = stored;
	}
	state.routeProvider = text(raw["routeProvider"]);
	state.routeModel = text(raw["routeModel"]);
	const firstAt = finite(raw["firstAt"]);
	const lastAt = finite(raw["lastAt"]);
	state.firstAt = firstAt ?? null;
	state.lastAt = lastAt ?? null;
	state.childIds = Array.isArray(raw["childIds"]) ? raw["childIds"].filter((id) => typeof id === "string") : [];
	state.buckets = asRecord(raw["buckets"]) ?? {};
	state.last = asRecord(raw["last"]) ?? null;
	return state;
}
/**
* Fold one committed Session event into the usage projection.
* @param state - state covering all prior events.
* @param event - next committed event.
* @param config - configured provider id and merged price table.
* @returns the next state; the same reference for an uninteresting event.
*/
function applyUsageEvent(state, event, config) {
	const data = asRecord(event.data);
	if (event.type === "request/header") {
		const headerConfig = asRecord(asRecord(data?.["header"])?.["config"]);
		if (headerConfig === void 0) return state;
		const routeProvider = text(headerConfig["provider"]);
		const routeModel = text(headerConfig["model"]);
		if (routeProvider === state.routeProvider && routeModel === state.routeModel) return state;
		return {
			...state,
			routeProvider,
			routeModel
		};
	}
	if (event.seq < state.ownStart) return state;
	if (event.type === "subagent/catalog") {
		const childId = data?.["childId"];
		if (typeof childId !== "string" || childId === "" || state.childIds.includes(childId)) return state;
		return {
			...state,
			childIds: [...state.childIds, childId]
		};
	}
	if (event.type === "llm/retry-started") {
		if (state.last === null) return state;
		if (state.last.turn !== finite(data?.["turn"]) || state.last.step !== finite(data?.["step"])) return state;
		return {
			...state,
			last: null
		};
	}
	if (event.type === "assistant/message" || event.type === "assistant/attempt") {
		const sample = usageOf(event);
		if (sample === void 0) return state;
		const turn = count(data?.["turn"]);
		const step = count(data?.["step"]);
		let next = state;
		if (state.last !== null && state.last.turn === turn && state.last.step === step) next = applyUsageRecord(next, state.last, -1);
		const record = recordOf(event, state.routeProvider, state.routeModel, sample, "assistant", config.prices, config.provider);
		next = applyUsageRecord(next, record, 1);
		return {
			...next,
			last: record
		};
	}
	if (event.type === "compaction/summary") {
		const sample = data?.["usage"];
		if (sample === void 0 || sample === null) return state;
		return applyUsageRecord(state, recordOf(event, text(data?.["provider"]), text(data?.["model"]), sample, "compaction", config.prices, config.provider), 1);
	}
	if (event.type === "session/title-llm-request") {
		if (!isGoProvider(text(asRecord(data?.["route"])?.["provider"]), config.provider)) return state;
		return {
			...state,
			titleRequests: state.titleRequests + 1
		};
	}
	return state;
}
/**
* Attribute one provider usage sample to the route that produced it.
* @param event - durable event supplying time and identity.
* @param providerId - routed provider.
* @param modelId - routed model.
* @param sample - provider-reported token usage.
* @param kind - assistant call or compaction summary.
* @param prices - merged price table.
* @param configuredProvider - provider id that draws on the Go allowance.
* @returns one signed-addable record.
*/
function recordOf(event, providerId, modelId, sample, kind, prices, configuredProvider) {
	const input = count(asRecord(sample)?.["inputTokens"]);
	const output = count(asRecord(sample)?.["outputTokens"]);
	const cacheRead = count(asRecord(sample)?.["cacheReadTokens"]);
	const cacheWrite = count(asRecord(sample)?.["cacheWriteTokens"]);
	const at = Number.isFinite(event.time) ? event.time : Date.now();
	const provider = providerId === "" ? "unknown" : providerId;
	const model = modelId === "" ? "unknown" : modelId;
	const resolved = priceFor(model, at, input + cacheRead + cacheWrite, prices);
	const freeVariant = hasFreeSuffix(model);
	const cost = freeVariant ? 0 : resolved === void 0 ? null : ((input + cacheWrite) * resolved.price.input + cacheRead * resolved.price.cached + output * resolved.price.output) / 1e6;
	const data = asRecord(event.data);
	return {
		turn: count(data?.["turn"]),
		step: count(data?.["step"]),
		kind,
		provider,
		model,
		go: isGoProvider(provider, configuredProvider),
		requests: kind === "assistant" ? 1 : 0,
		compactionRequests: kind === "compaction" ? 1 : 0,
		input,
		output,
		cacheRead,
		cacheWrite,
		total: input + output + cacheRead + cacheWrite,
		cost,
		peak: !freeVariant && resolved?.peak === true,
		free: freeVariant || resolved !== void 0 && resolved.price.input === 0 && resolved.price.output === 0,
		at
	};
}
/**
* Whether a route id is the configured OpenCode Go provider.
* @param providerId - routed provider id.
* @param configuredProvider - configured provider id.
* @returns true when the ids match case-insensitively.
*/
function isGoProvider(providerId, configuredProvider) {
	return providerId.toLowerCase() === configuredProvider;
}
/**
* Add or subtract one record from a projection state. Substitution replaces the
* earlier attempt's buckets in place, matching the shipped token-usage fold.
* @param state - current projection state.
* @param record - signed record.
* @param sign - `1` to add, `-1` to replace away.
* @returns the next state.
*/
function applyUsageRecord(state, record, sign) {
	const next = {
		...state,
		buckets: { ...state.buckets }
	};
	if (record.go) {
		next.requests = state.requests + sign * record.requests;
		next.compactionRequests = state.compactionRequests + sign * record.compactionRequests;
		next.input = state.input + sign * record.input;
		next.output = state.output + sign * record.output;
		next.cacheRead = state.cacheRead + sign * record.cacheRead;
		next.cacheWrite = state.cacheWrite + sign * record.cacheWrite;
		next.total = state.total + sign * record.total;
		next.estimatedUsd = state.estimatedUsd + sign * (record.cost ?? 0);
		next.pricedRequests = state.pricedRequests + sign * (record.cost === null ? 0 : 1);
		next.unpricedRequests = state.unpricedRequests + sign * (record.cost === null ? 1 : 0);
		if (sign > 0) {
			next.firstAt = state.firstAt === null || record.at < state.firstAt ? record.at : state.firstAt;
			next.lastAt = state.lastAt === null || record.at > state.lastAt ? record.at : state.lastAt;
		}
	} else {
		next.otherRequests = state.otherRequests + sign * record.requests;
		next.otherCompactionRequests = state.otherCompactionRequests + sign * record.compactionRequests;
		next.otherTokens = state.otherTokens + sign * record.total;
	}
	const key = `${record.provider}\u0000${record.model}`;
	const existing = state.buckets[key] ?? {
		provider: record.provider,
		model: record.model,
		go: record.go,
		requests: 0,
		compactionRequests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		estimatedUsd: 0,
		pricedRequests: 0,
		unpricedRequests: 0,
		peak: false,
		free: false
	};
	next.buckets[key] = {
		...existing,
		requests: existing.requests + sign * record.requests,
		compactionRequests: existing.compactionRequests + sign * record.compactionRequests,
		input: existing.input + sign * record.input,
		output: existing.output + sign * record.output,
		cacheRead: existing.cacheRead + sign * record.cacheRead,
		cacheWrite: existing.cacheWrite + sign * record.cacheWrite,
		total: existing.total + sign * record.total,
		estimatedUsd: existing.estimatedUsd + sign * (record.cost ?? 0),
		pricedRequests: existing.pricedRequests + sign * (record.cost === null ? 0 : 1),
		unpricedRequests: existing.unpricedRequests + sign * (record.cost === null ? 1 : 0),
		peak: existing.peak || record.peak,
		free: existing.free || record.free
	};
	return next;
}
/**
* Fold a measured projection state into an accumulator (subtree aggregation).
* @param target - mutable accumulator receiving the values.
* @param source - projection state.
*/
function mergeUsageState(target, source) {
	target.requests += source.requests;
	target.compactionRequests += source.compactionRequests;
	target.titleRequests += source.titleRequests;
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.total += source.total;
	target.estimatedUsd += source.estimatedUsd;
	target.pricedRequests += source.pricedRequests;
	target.unpricedRequests += source.unpricedRequests;
	target.otherRequests += source.otherRequests;
	target.otherCompactionRequests += source.otherCompactionRequests;
	target.otherTokens += source.otherTokens;
	if (source.firstAt !== null && (target.firstAt === null || source.firstAt < target.firstAt)) target.firstAt = source.firstAt;
	if (source.lastAt !== null && (target.lastAt === null || source.lastAt > target.lastAt)) target.lastAt = source.lastAt;
	for (const childId of source.childIds) if (!target.childIds.includes(childId)) target.childIds.push(childId);
	for (const [key, bucket] of Object.entries(source.buckets)) {
		const existing = target.buckets[key];
		if (existing === void 0) {
			target.buckets[key] = { ...bucket };
			continue;
		}
		existing.requests += bucket.requests;
		existing.compactionRequests += bucket.compactionRequests;
		existing.input += bucket.input;
		existing.output += bucket.output;
		existing.cacheRead += bucket.cacheRead;
		existing.cacheWrite += bucket.cacheWrite;
		existing.total += bucket.total;
		existing.estimatedUsd += bucket.estimatedUsd;
		existing.pricedRequests += bucket.pricedRequests;
		existing.unpricedRequests += bucket.unpricedRequests;
		existing.peak = existing.peak || bucket.peak;
		existing.free = existing.free || bucket.free;
	}
}
/**
* Freeze one projection state into the JSON shape the Client half reads. All
* counts are clamped at zero, because a retry substitution can subtract an
* attempt whose numbers were rounded on the wire.
* @param usage - projection state or merged accumulator.
* @returns the wire summary.
*/
function finalizeUsage(usage) {
	const models = Object.values(usage.buckets).map((bucket) => ({
		provider: bucket.provider,
		model: bucket.model,
		requests: count(bucket.requests),
		compactionRequests: count(bucket.compactionRequests),
		inputTokens: count(bucket.input),
		outputTokens: count(bucket.output),
		cacheReadTokens: count(bucket.cacheRead),
		cacheWriteTokens: count(bucket.cacheWrite),
		totalTokens: count(bucket.total),
		estimatedUsd: Math.max(0, roundUsd(Number.isFinite(bucket.estimatedUsd) ? bucket.estimatedUsd : 0)),
		priced: count(bucket.pricedRequests) > 0,
		unpricedRequests: count(bucket.unpricedRequests),
		go: bucket.go,
		peak: bucket.peak,
		free: bucket.free
	})).sort((left, right) => right.totalTokens - left.totalTokens);
	const goModels = models.filter((model) => model.go);
	const otherModels = models.filter((model) => !model.go);
	const pricedRequests = count(usage.pricedRequests);
	const unpricedRequests = count(usage.unpricedRequests);
	const requests = count(usage.requests);
	const compactionRequests = count(usage.compactionRequests);
	return {
		requests,
		compactionRequests,
		titleRequests: count(usage.titleRequests),
		inputTokens: count(usage.input),
		outputTokens: count(usage.output),
		cacheReadTokens: count(usage.cacheRead),
		cacheWriteTokens: count(usage.cacheWrite),
		totalTokens: count(usage.total),
		estimatedUsd: pricedRequests === 0 && requests + compactionRequests > 0 ? null : Math.max(0, roundUsd(Number.isFinite(usage.estimatedUsd) ? usage.estimatedUsd : 0)),
		pricedRequests,
		unpricedRequests,
		firstAt: Number.isFinite(usage.firstAt) ? usage.firstAt : null,
		lastAt: Number.isFinite(usage.lastAt) ? usage.lastAt : null,
		models: goModels,
		otherModels,
		otherRequests: count(usage.otherRequests),
		otherCompactionRequests: count(usage.otherCompactionRequests),
		otherTokens: count(usage.otherTokens),
		forked: Number(usage.ownStart) > 0,
		inheritedEventCount: Number(usage.ownStart) || 0
	};
}
/** Round a USD amount to six decimals so tiny sessions keep a nonzero figure. */
function roundUsd(value) {
	return Math.round(value * 1e6) / 1e6;
}
/**
* Aggregate a Session with every live descendant discovered through its
* durable `subagent/catalog` projection records. Children that are not mounted
* are counted as missing rather than silently folded into the total.
* @param root - Session whose subtree is measured.
* @param source - projection reader and Session resolver.
* @returns the aggregate and the child/missing counts.
*/
function collectSubtree(root, source) {
	const aggregate = emptyUsageState(0);
	const visited = /* @__PURE__ */ new Set();
	const missingIds = /* @__PURE__ */ new Set();
	const queue = [root];
	let sessions = 0;
	while (queue.length > 0) {
		const session = queue.shift();
		if (session === void 0) break;
		const id = String(session.id);
		if (visited.has(id)) continue;
		visited.add(id);
		if (session !== root) sessions += 1;
		const state = source.stateOf(session);
		mergeUsageState(aggregate, state);
		for (const childId of state.childIds) {
			const child = source.get(childId);
			if (child === void 0) {
				missingIds.add(childId);
				continue;
			}
			queue.push(child);
		}
	}
	return {
		summary: finalizeUsage(aggregate),
		sessions,
		missing: missingIds.size
	};
}
/**
* Read one settlement's usage: the durable field on a message, or the last raw
* usage chunk on a message/attempt stream.
* @param event - assistant event.
* @returns provider usage, or undefined when the adapter reported none.
*/
function usageOf(event) {
	const data = asRecord(event.data);
	if (event.type === "assistant/message" && data?.["usage"] !== void 0 && data["usage"] !== null) return data["usage"];
	const stream = data?.["stream"];
	if (!Array.isArray(stream)) return void 0;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const record = asRecord(stream[index]);
		const chunk = asRecord(record?.["chunk"]);
		if (record?.["type"] === "chunk" && chunk?.["type"] === "usage") return chunk["usage"];
	}
}
// opencode-go-quota/src/upstream.ts
/**
* Upstream reads: the authenticated Go usage endpoint, the public models list,
* the normalization of both answers, and the Host's read gate and backoff.
*
* Nothing here holds state: the Host half owns the caches and hands this module
* a fetcher, so `node --test` can drive every branch with a stub.
*
* @module @local/opencode-go-quota/upstream
*/
/** Window keys the live shape carries, in display order. */
const WINDOW_LABELS = Object.freeze({
	rolling: "5h",
	weekly: "week",
	monthly: "month"
});
/** Early-spec window rows: nested key, wire key, label. */
const LEGACY_WINDOWS = Object.freeze([
	Object.freeze([
		"rolling",
		"rollingUsage",
		"5h"
	]),
	Object.freeze([
		"weekly",
		"weeklyUsage",
		"week"
	]),
	Object.freeze([
		"monthly",
		"monthlyUsage",
		"month"
	])
]);
/** Upper bound on the exponential failure wait, before jitter. */
const BACKOFF_MAX_MS = 9e5;
/**
* Perform one authenticated Go usage read and normalize the answer.
* @param baseUrl - endpoint base, without a trailing slash.
* @param key - OpenCode Go API key.
* @param fetchImpl - fetch implementation (tests pass a stub).
* @returns a normalized usage, or a typed failure.
*/
async function requestUsage(baseUrl, key, fetchImpl = fetch) {
	let response;
	try {
		response = await fetchImpl(`${baseUrl}${USAGE_PATH}`, {
			headers: {
				Authorization: `Bearer ${key}`,
				Accept: "application/json"
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		return {
			kind: "error",
			error: {
				code: "network",
				message: messageOf(error)
			}
		};
	}
	if (!response.ok) {
		const retryAfter = Number(response.headers.get("retry-after"));
		const failure = {
			code: statusCode(response.status),
			message: await failureMessage(response)
		};
		if (Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfterSeconds = retryAfter;
		return {
			kind: "error",
			error: failure
		};
	}
	let data;
	try {
		data = await response.json();
	} catch {
		return {
			kind: "error",
			error: {
				code: "invalid-json",
				message: "usage response was not JSON"
			}
		};
	}
	return normalizeUsage(data);
}
/**
* Read the public Go models list and extract the limited-time free models.
* @param baseUrl - endpoint base, without a trailing slash.
* @param watchModels - configured watch names to resolve free status for.
* @param fetchImpl - fetch implementation (tests pass a stub).
* @returns the free models with watched statuses, or a typed failure.
*/
async function requestFreeModels(baseUrl, watchModels, fetchImpl = fetch) {
	let response;
	try {
		response = await fetchImpl(`${baseUrl}${MODELS_PATH}`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		return {
			kind: "error",
			error: {
				code: "network",
				message: messageOf(error)
			}
		};
	}
	if (!response.ok) return {
		kind: "error",
		error: {
			code: statusCode(response.status),
			message: await failureMessage(response)
		}
	};
	let data;
	try {
		data = await response.json();
	} catch {
		return {
			kind: "error",
			error: {
				code: "invalid-json",
				message: "models response was not JSON"
			}
		};
	}
	const rows = modelsRows(data);
	if (rows.length === 0) return {
		kind: "error",
		error: {
			code: "unexpected-shape",
			message: "models response carried no entries"
		}
	};
	const enriched = rows.map(enrichModel).filter((model) => model.id !== "");
	return {
		kind: "ok",
		models: enriched.filter((model) => isFreeModel(model.raw)).map((model) => {
			const go = asRecord(model.raw["go"]);
			return {
				id: model.id,
				name: model.name,
				canonical: model.canonical,
				description: nonEmpty(model.raw["description"]) ?? null,
				limitedRegions: go?.["limited_regions"] === true,
				training: go?.["training"] === true
			};
		}).sort((left, right) => left.id.localeCompare(right.id)),
		watched: collectWatched(enriched, watchModels)
	};
}
/**
* Normalize the documented Go usage shapes into one display model.
*
* The live shape nests the three windows under `usage` with an ISO `resetsAt`;
* the early spec shape carried flat `rollingUsage`/`weeklyUsage`/`monthlyUsage`
* rows with `usagePercent` and `resetInSec`. Both are accepted so one deploy
* either side of the upstream change keeps working.
*
* @param data - decoded response body.
* @param now - epoch milliseconds used to resolve `resetInSec`.
* @returns a normalized usage, or a typed failure for an unknown shape.
*/
function normalizeUsage(data, now = Date.now()) {
	const body = asRecord(data) ?? {};
	const nested = asRecord(body["usage"]);
	if (nested !== void 0) {
		const windows = [];
		for (const [key, label] of Object.entries(WINDOW_LABELS)) {
			const row = asRecord(nested[key]);
			if (row === void 0) continue;
			const percent = finite(row["percent"]);
			const resetsAt = nonEmpty(row["resetsAt"]) ?? null;
			if (percent === void 0 && resetsAt === null) continue;
			windows.push({
				key,
				label,
				percent: percent ?? null,
				resetsAt,
				status: nonEmpty(row["status"]) ?? null
			});
		}
		if (windows.length > 0) return {
			kind: "ok",
			usage: { windows }
		};
	}
	const legacy = [];
	for (const [key, rowKey, label] of LEGACY_WINDOWS) {
		const row = asRecord(body[rowKey]);
		if (row === void 0) continue;
		const percent = finite(row["usagePercent"]);
		const resetInSec = finite(row["resetInSec"]);
		if (percent === void 0) continue;
		legacy.push({
			key,
			label,
			percent,
			resetsAt: resetInSec !== void 0 ? new Date(now + resetInSec * 1e3).toISOString() : null,
			status: null
		});
	}
	if (legacy.length > 0) return {
		kind: "ok",
		usage: { windows: legacy }
	};
	return {
		kind: "error",
		error: {
			code: "unexpected-shape",
			message: "usage response carried no known window"
		}
	};
}
/**
* Map the documented failure statuses to stable codes the Client half phrases.
* @param status - HTTP status.
* @returns a short machine-readable code.
*/
function statusCode(status) {
	switch (status) {
		case 401: return "unauthorized";
		case 403: return "forbidden";
		case 404: return "not-found";
		case 429: return "rate-limited";
		case 503: return "unavailable";
		default: return `http-${status}`;
	}
}
/**
* Read the endpoint's `{ error }` body when present.
* @param response - failed response.
* @returns the message to show, never empty.
*/
async function failureMessage(response) {
	try {
		const message = nonEmpty(asRecord(await response.json())?.["error"]);
		if (message !== void 0) return message;
	} catch {}
	return `HTTP ${String(response.status)}`;
}
/**
* Decide how one read proceeds.
*
* Order is load-bearing: a fresh success answers from the cache, and a read
* already in flight is joined rather than duplicated — including under
* `?force`, which therefore never queues a second request behind a running one.
* Only an unforced read honours the failure wait, so an explicit `?force` is
* always a real attempt.
*
* @param input - cache facts.
* @returns the decision.
*/
function readGate(input) {
	if (!input.force && input.hasGood && input.ageMs < input.ttlMs) return "cached";
	if (input.inflight) return "inflight";
	if (!input.force && input.retryAt > input.now) return "backoff";
	return "fetch";
}
/**
* How long a failed read suppresses the next unforced attempt.
*
* The wait grows exponentially from the cache window and carries ±20% jitter,
* so several profile pages do not retry in lockstep; an endpoint `retry-after`
* wins over the computed wait because it is the server's own answer. The
* computed wait is capped; a server-provided one is not.
*
* @param failures - consecutive failed attempts, counting the one just made.
* @param retryAfterSeconds - the endpoint's `retry-after`, when sent.
* @param baseMs - the successful cache window.
* @param random - uniform source for the jitter (tests pass a fixed value).
* @returns the wait in milliseconds, never below the cache window.
*/
function backoffDelayMs(failures, retryAfterSeconds, baseMs, random = Math.random) {
	const exponent = Math.max(0, Math.min(failures, 8) - 1);
	const grown = Math.min(BACKOFF_MAX_MS, baseMs * 2 ** exponent);
	const sample = Math.min(1, Math.max(0, random()));
	const jittered = Math.round(grown * (.8 + .4 * sample));
	const retryMs = retryAfterSeconds !== void 0 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1e3 : 0;
	return Math.max(baseMs, retryMs, jittered);
}
/** The models-list `data` array, when the body carries one. */
function modelsRows(data) {
	const rows = asRecord(data)?.["data"];
	return Array.isArray(rows) ? rows : [];
}
/** Normalize one raw models-list row. */
function enrichModel(raw) {
	const row = asRecord(raw) ?? {};
	const id = text(row["id"]);
	return {
		raw: row,
		id,
		name: nonEmpty(row["name"]) ?? id,
		canonical: nonEmpty(row["canonical_id"]) ?? null
	};
}
// opencode-go-quota/src/index.ts
/**
* Structural cast, one place: the projection seam only calls `parse`, so this
* plain validator satisfies its schema contract without making zod a runtime
* dependency of the package (`import type` is erased at build time).
*/
const USAGE_STATE_SCHEMA = { parse: parseUsageState };
/** Hard dependencies: the route registry and the Session projection registry. */
const inject = [
	"connection",
	"sessions",
	"sessionProjections"
];
/**
* Host plugin body.
* @param ctx - owning plugin context.
* @param config - the row's config: credential reference, base URLs, cache
* windows, provider id, and optional price overrides.
*/
async function apply(ctx, config) {
	const settings = resolveConfig(config);
	/**
	* Host-only Session projection. Keeping the fold in the projection seam makes
	* it replayable and checkpointed, and lets the route read the current value
	* instead of rescanning a durable log.
	*/
	const usageProjection = await ctx.sessionProjections.register({
		key: "opencodeGoQuotaUsage",
		stateVersion: 1,
		stateSchema: USAGE_STATE_SCHEMA,
		init: (_header, inheritedEventCount) => emptyUsageState(Number(inheritedEventCount) || 0),
		apply: (state, event) => applyUsageEvent(state, event, {
			provider: settings.provider,
			prices: settings.prices
		})
	});
	/** Last successful usage reading, kept across failures so a chip can render it as stale. */
	let lastGoodUsage = null;
	/** When that reading was taken; 0 before the first success. */
	let usageFetchedAt = 0;
	/** The read currently in flight, shared by every caller. */
	let usageInflight = null;
	/** Consecutive failed attempts, driving the backoff. */
	let usageFailures = 0;
	/** Epoch milliseconds before which an unforced read is answered from the failure. */
	let usageRetryAt = 0;
	/** The failure of the last attempt, so a suppressed retry can still report it. */
	let lastUsageError = null;
	/** Free-model watcher state, kept across polls and failures. */
	let freeState = emptyFreeWatch();
	/** When the last successful free-model read was taken; 0 before the first. */
	let freeFetchedAt = 0;
	/** The models-list read currently in flight, shared by every caller. */
	let freeInflight = null;
	const connection = ctx.get("connection");
	if (connection === void 0) throw new Error("opencode-go-quota requires the Connection service");
	ctx.effect(() => connection.fetch.register({
		path: USAGE_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch(request) {
			const force = new URL(request.url).searchParams.has("force");
			return Response.json(await readUsage(force), { headers: { "cache-control": "no-store" } });
		}
	}), "opencode-go-quota: usage route");
	ctx.effect(() => connection.fetch.register({
		path: SESSION_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch(request) {
			const sessionId = new URL(request.url).searchParams.get("sessionId");
			return Response.json(readSessionUsage(sessionId), { headers: { "cache-control": "no-store" } });
		}
	}), "opencode-go-quota: session usage route");
	ctx.effect(() => connection.fetch.register({
		path: FREE_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch(request) {
			const params = new URL(request.url).searchParams;
			const force = params.has("force");
			const ack = params.has("ack");
			return Response.json(await readFreeModels(force, ack), { headers: { "cache-control": "no-store" } });
		}
	}), "opencode-go-quota: free models route");
	/**
	* Answer one Session's attributed usage from its host projection. The
	* projection owns the fold, so this route is O(new events) and reflects a
	* live child Session without waiting for the parent to append anything.
	* @param rawSessionId - query value naming the Session.
	* @returns the wire snapshot the Client half renders.
	*/
	function readSessionUsage(rawSessionId) {
		const sessionId = nonEmpty(rawSessionId);
		if (sessionId === void 0) return {
			state: "invalid",
			provider: settings.provider,
			generatedAt: Date.now()
		};
		const session = ctx.sessions.get(sessionId);
		if (session === void 0) return {
			state: "missing",
			sessionId,
			provider: settings.provider,
			generatedAt: Date.now()
		};
		const direct = finalizeUsage(usageProjection.stateOf(session));
		const subtree = collectSubtree(session, {
			stateOf: (node) => usageProjection.stateOf(node),
			get: (id) => ctx.sessions.get(id)
		});
		return {
			state: "ok",
			sessionId,
			provider: settings.provider,
			asOfSeq: Number(session.seq) - 1,
			forked: direct.forked,
			inheritedEventCount: direct.inheritedEventCount,
			direct,
			subtree: {
				...subtree.summary,
				subagentSessions: subtree.sessions,
				missingSessions: subtree.missing
			},
			pricing: {
				basis: "published-list-price",
				source: "https://opencode.ai/inference/go/v1/models",
				peakNote: "deepseek: weekdays 01:00-04:00 & 06:00-10:00 UTC; gemini-4-argon: x2 from 2026-12-01"
			},
			generatedAt: Date.now()
		};
	}
	/**
	* Answer the current Go usage, reusing one cached read inside its TTL and
	* one failure inside its wait.
	* @param force - ignore both caches for this call.
	* @returns the wire snapshot the Client half renders.
	*/
	async function readUsage(force) {
		const now = Date.now();
		const gate = readGate({
			force,
			hasGood: lastGoodUsage !== null,
			ageMs: now - usageFetchedAt,
			ttlMs: settings.ttlMs,
			retryAt: usageRetryAt,
			now,
			inflight: usageInflight !== null
		});
		if (gate === "cached") return usageSnapshot("ok");
		if (gate === "inflight") return usageInflight;
		if (gate === "backoff") return usageSnapshot("error", lastUsageError ?? void 0);
		const run = (async () => {
			try {
				const key = await resolveApiKey();
				if (key === void 0) return usageSnapshot("unconfigured");
				const answer = await requestUsage(settings.baseUrl, key);
				if (answer.kind === "ok") {
					lastGoodUsage = answer.usage;
					usageFetchedAt = Date.now();
					usageFailures = 0;
					usageRetryAt = 0;
					lastUsageError = null;
					return usageSnapshot("ok");
				}
				recordUsageFailure(answer.error);
				return usageSnapshot("error", answer.error);
			} catch (error) {
				const failure = {
					code: "request-failed",
					message: messageOf(error)
				};
				recordUsageFailure(failure);
				return usageSnapshot("error", failure);
			} finally {
				usageInflight = null;
			}
		})();
		usageInflight = run;
		return run;
	}
	/**
	* Remember one failed usage read and how long it suppresses the next
	* unforced attempt.
	* @param failure - the attempt's typed failure.
	*/
	function recordUsageFailure(failure) {
		usageFailures += 1;
		lastUsageError = failure;
		usageRetryAt = Date.now() + backoffDelayMs(usageFailures, failure.retryAfterSeconds, settings.ttlMs);
	}
	/**
	* Compose the usage wire value; `error` accompanies a failed attempt that may
	* still carry `lastGood`.
	* @param state - the attempt's outcome.
	* @param error - the typed failure, when the attempt failed.
	* @returns the JSON snapshot.
	*/
	function usageSnapshot(state, error) {
		return {
			state,
			apiKeyEnv: settings.apiKeyEnv,
			fetchedAt: usageFetchedAt === 0 ? null : usageFetchedAt,
			stale: state === "error" && lastGoodUsage !== null,
			usage: lastGoodUsage,
			error: error ?? null
		};
	}
	/**
	* Answer the free-model watch. A `?ack` query folds the currently reported
	* new models into the baseline, which the Client half does when the panel
	* with the free list becomes visible.
	* @param force - refetch even inside the TTL.
	* @param ack - also clear the pending new-model list.
	* @returns the JSON snapshot.
	*/
	async function readFreeModels(force, ack) {
		if (ack && freeState.newFree.length > 0) freeState = {
			...freeState,
			newFree: []
		};
		if (!force && freeState.last !== null && Date.now() - freeFetchedAt < settings.freeTtlMs) return freeSnapshot("ok");
		if (freeInflight !== null) return freeInflight;
		const run = (async () => {
			try {
				const answer = await requestFreeModels(settings.baseUrl, settings.watchModels);
				if (answer.kind === "ok") {
					const now = Date.now();
					freeState = applyFreeReading(freeState, {
						models: answer.models,
						watched: answer.watched
					}, now);
					freeFetchedAt = now;
					return freeSnapshot("ok");
				}
				return freeSnapshot("error", answer.error);
			} catch (error) {
				return freeSnapshot("error", {
					code: "request-failed",
					message: messageOf(error)
				});
			} finally {
				freeInflight = null;
			}
		})();
		freeInflight = run;
		return run;
	}
	/**
	* Compose the free-model wire value. A failed attempt keeps the last good
	* list and stamps it `stale`, so the chip keeps naming what it knows.
	* @param state - the attempt's outcome.
	* @param error - the typed failure, when the attempt failed.
	* @returns the JSON snapshot.
	*/
	function freeSnapshot(state, error) {
		const last = freeState.last;
		const free = last === null ? [] : last.models.map((model) => ({
			...model,
			since: last.firstSeen[model.id] ?? null
		}));
		return {
			state,
			fetchedAt: last === null ? null : last.at,
			stale: state === "error" && last !== null,
			free,
			watched: last?.watched ?? [],
			history: freeState.history,
			newFree: freeState.newFree,
			error: error ?? null
		};
	}
	/**
	* Resolve the Go API key from the credential store, then from the launch
	* environment (process, project `.env`, user `.env` — the same chain the
	* OpenCode Go adapter uses), and finally from the ambient process
	* environment. Resolution is per call, so a rotated key reaches the next
	* poll without a restart.
	* @returns the key, or undefined while unconfigured.
	*/
	async function resolveApiKey() {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0 && credentials !== null) try {
			const value = nonEmpty((await credentials.resolve(settings.apiKeyEnv))?.value);
			if (value !== void 0) return value;
		} catch {}
		const launch = ctx.get("launchEnvironment");
		const launched = nonEmpty((typeof launch?.get === "function" ? launch.get(settings.apiKeyEnv) : void 0)?.value);
		if (launched !== void 0) return launched;
		return nonEmpty(process.env[settings.apiKeyEnv]);
	}
}
export { apply, inject };

//# sourceMappingURL=index.js.map