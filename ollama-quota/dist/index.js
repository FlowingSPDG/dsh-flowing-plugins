// ollama-quota/src/prices.ts
/** Published peak window: weekdays 12:00 inclusive to 18:00 exclusive, UTC. */
const PEAK_START_HOUR = 12;
const PEAK_END_HOUR = 18;
/**
* A flat published price row.
* @param input - uncached input price.
* @param cached - cached input price.
* @param output - output price.
* @returns the frozen price row.
*/
function flatPrice(input, cached, output) {
	return Object.freeze({
		input,
		cached,
		output
	});
}
/**
* A price row with separate peak and off-peak rates.
* @param peakInput - peak uncached input price.
* @param peakCached - peak cached input price.
* @param peakOutput - peak output price.
* @param offPeakInput - off-peak uncached input price.
* @param offPeakCached - off-peak cached input price.
* @param offPeakOutput - off-peak output price.
* @returns the frozen price row.
*/
function clockPrice(peakInput, peakCached, peakOutput, offPeakInput, offPeakCached, offPeakOutput) {
	return Object.freeze({
		peak: flatPrice(peakInput, peakCached, peakOutput),
		offPeak: flatPrice(offPeakInput, offPeakCached, offPeakOutput)
	});
}
/** Built-in table, USD per million tokens. */
const MODEL_PRICES = Object.freeze({
	"beam": flatPrice(.125, .015, .4),
	"deepseek-v4.1-flash": clockPrice(.3, .006, 1.2, .15, .003, .6),
	"deepseek-v4-pro": clockPrice(1.32, .044, 3.96, .66, .022, 1.98),
	"gemma4": flatPrice(.14, .05, .4),
	"glm-5.3": flatPrice(1.4, .26, 4.4),
	"glm-5.3-flash": flatPrice(.15, .03, .5),
	"glm-5.2": flatPrice(1.4, .26, 4.4),
	"gpt-oss:120b": flatPrice(.15, .014, .6),
	"gpt-oss:20b": flatPrice(.07, .035, .3),
	"inkling-2-small": flatPrice(.3, .03, 1),
	"kimi-k3.1-pro": flatPrice(2, .2, 10),
	"kimi-k3": flatPrice(3, .3, 15),
	"kimi-k2.7-code": flatPrice(.95, .19, 4),
	"kimi-k2.6": flatPrice(.95, .16, 4),
	"mimo-v2.6-flash": flatPrice(.14, .0028, .28),
	"mimo-v2.6-pro": flatPrice(.435, .0036, .87),
	"minimax-m3.1-flash": flatPrice(.15, .015, .6),
	"minimax-m3": flatPrice(.6, .12, 2.4),
	"mistral-large-4": flatPrice(.7, .07, 2.1),
	"muse-spark-open": flatPrice(1.25, .15, 4.25),
	"nemotron-3-super": flatPrice(.015, .015, .6),
	"nemotron-3-ultra": flatPrice(.1, .1, 3)
});
/**
* Narrow an untrusted value to a plain record.
* @param value - candidate.
* @returns the record, or undefined.
*/
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Whether a value carries every rate needed for a cost calculation.
* @param row - candidate row.
* @returns true for finite input/cached/output rates.
*/
function usablePrice(row) {
	if (!isRecord$2(row)) return false;
	return Number.isFinite(row["input"]) && Number.isFinite(row["cached"]) && Number.isFinite(row["output"]);
}
/**
* Whether one instant falls inside the published peak window.
* @param at - epoch milliseconds.
* @returns true for weekdays 12:00-18:00 UTC.
*/
function isPeakAt(at) {
	const date = new Date(at);
	const day = date.getUTCDay();
	const hour = date.getUTCHours();
	return day >= 1 && day <= 5 && hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR;
}
/**
* Resolve the published price for a model id at one instant. Tags such as
* `:0813` are ignored, while ids that themselves contain a colon (for example
* `gpt-oss:120b`) still match exactly first.
* @param model - routed model id.
* @param at - epoch milliseconds of the usage record.
* @param prices - merged price table.
* @returns the applicable price row, or undefined when unpublished.
*/
function priceFor(model, at, prices) {
	const key = model.trim().toLowerCase();
	if (key === "") return void 0;
	const row = prices[key] ?? prices[key.split(":")[0] ?? ""];
	if (!isRecord$2(row)) return void 0;
	const peak = row["peak"];
	const offPeak = row["offPeak"];
	if (peak !== void 0 || offPeak !== void 0) {
		const selected = isPeakAt(at) ? peak : offPeak;
		return usablePrice(selected) ? selected : void 0;
	}
	return usablePrice(row) ? row : void 0;
}
/**
* Merge a profile's price overrides over the published table.
* @param base - built-in table.
* @param overrides - optional `prices` config object.
* @returns a new table with trimmed, lower-cased keys; unusable entries stay in
*   place and simply resolve to "unpublished" at lookup time.
*/
function mergePriceOverrides(base, overrides) {
	if (!isRecord$2(overrides)) return base;
	const merged = { ...base };
	for (const [key, row] of Object.entries(overrides)) {
		const name = key.trim().toLowerCase();
		if (name === "") continue;
		merged[name] = row;
	}
	return merged;
}
/**
* Price one sample at one row.
* @param price - applicable published row.
* @param tokens - token buckets of one request.
* @returns USD, exact to the published rates.
*/
function costOf(price, tokens) {
	const input = tokens.input;
	const output = tokens.output;
	const cacheRead = tokens.cacheRead;
	return ((input + tokens.cacheWrite) * price.input + cacheRead * price.cached + output * price.output) / 1e6;
}
/** Documented defaults for every row key. */
const DEFAULTS = Object.freeze({
	apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
	baseUrl: "https://ollama.com",
	refreshSeconds: 60,
	provider: "ollama-cloud"
});
/**
* Narrow an untrusted value to a plain record.
* @param value - candidate.
* @returns the record, or undefined.
*/
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Trim to a non-empty string, or undefined.
* @param value - candidate.
* @returns the trimmed text, or undefined when empty or not a string.
*/
function nonEmpty$3(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Coerce one config value to a finite number the way `Number()` does, which is
* what the previous plain-JavaScript config accepted (numeric strings included).
* @param value - candidate.
* @returns the number, or undefined for NaN/Infinity and symbols.
*/
function finiteNumber(value) {
	if (typeof value === "symbol") return void 0;
	const converted = Number(value);
	return Number.isFinite(converted) ? converted : void 0;
}
/**
* Resolve one row's config.
* @param raw - the Loader row's `config`, of unknown shape.
* @returns the resolved options.
*/
function resolveConfig(raw) {
	const options = isRecord$1(raw) ? raw : {};
	const apiKeyEnv = nonEmpty$3(options["apiKeyEnv"]) ?? DEFAULTS.apiKeyEnv;
	const baseUrl = (nonEmpty$3(options["baseUrl"]) ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
	const refreshSeconds = Math.max(60, finiteNumber(options["refreshSeconds"]) ?? DEFAULTS.refreshSeconds);
	const provider = (nonEmpty$3(options["provider"]) ?? DEFAULTS.provider).toLowerCase();
	return {
		apiKeyEnv,
		baseUrl,
		refreshSeconds,
		ttlMs: refreshSeconds * 1e3,
		provider,
		prices: mergePriceOverrides(MODEL_PRICES, options["prices"])
	};
}
// ollama-quota/src/upstream.ts
/** Documented balance endpoint; the reference is `docs.ollama.com/api/balance`. */
const BALANCE_PATH = "/api/balance";
/** A hung balance read must not pin the rest of the polling loop. */
const REQUEST_TIMEOUT_MS = 15e3;
/**
* A `retry-after` value that names whole or fractional seconds. An HTTP-date
* form is deliberately not parsed: the chip reports a countdown, and guessing
* between "seconds from now" and an absolute moment is worse than reporting
* nothing.
*/
const RETRY_AFTER_SECONDS = /^\s*\d+(?:\.\d+)?\s*$/;
/**
* Narrow an untrusted value to a plain record.
* @param value - candidate.
* @returns the record, or undefined.
*/
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Coerce to a finite number, or undefined.
* @param value - candidate.
* @returns the number, or undefined.
*/
function finite(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* Trim to a non-empty string, or undefined.
* @param value - candidate.
* @returns the trimmed text, or undefined when empty or not a string.
*/
function nonEmpty$2(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Message of an unknown thrown value.
* @param error - thrown value.
* @returns the message.
*/
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Parse a `retry-after` header value.
*
* Only the seconds form is honoured (`120`, ` 1.5 `); the HTTP-date form
* (`Wed, 21 Oct 2015 07:28:00 GMT`) yields undefined, and so does any
* non-positive or malformed value.
*
* @param header - raw header value, or null when absent.
* @returns the delay in seconds, or undefined.
*/
function parseRetryAfter(header) {
	if (typeof header !== "string" || !RETRY_AFTER_SECONDS.test(header)) return void 0;
	const seconds = Number(header.trim());
	return Number.isFinite(seconds) && seconds > 0 ? seconds : void 0;
}
/**
* Map the documented failure statuses to stable codes the Client half can phrase.
* @param status - HTTP status.
* @returns a short machine-readable code.
*/
function statusCode(status) {
	switch (status) {
		case 401: return "unauthorized";
		case 403: return "suspended";
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
		const body = await response.json();
		const text = isRecord(body) ? nonEmpty$2(body["error"]) : void 0;
		if (text !== void 0) return text;
	} catch {}
	return `HTTP ${String(response.status)}`;
}
/**
* Normalize the documented balance shapes into one display model.
* @param data - decoded response body.
* @returns a normalized balance, or a typed failure for an unknown shape.
*/
function normalizeBalance(data) {
	const body = isRecord(data) ? data : {};
	const included = isRecord(body["included"]) ? body["included"] : {};
	const purchasedUsd = finite((isRecord(body["purchased"]) ? body["purchased"] : {})["balance_usd"]) ?? 0;
	const remainingUsd = finite(included["balance_usd"]);
	const allowanceUsd = finite(included["allowance_usd"]);
	if (remainingUsd !== void 0 && allowanceUsd !== void 0) {
		const period = isRecord(included["period"]) ? included["period"] : {};
		return {
			kind: "ok",
			balance: {
				kind: "usd",
				includedRemainingUsd: remainingUsd,
				includedAllowanceUsd: allowanceUsd,
				purchasedUsd,
				periodFrom: nonEmpty$2(period["from"]) ?? null,
				periodUntil: nonEmpty$2(period["until"]) ?? null
			}
		};
	}
	const session = isRecord(included["session"]) ? included["session"] : void 0;
	const weekly = isRecord(included["weekly"]) ? included["weekly"] : void 0;
	if (session !== void 0 && weekly !== void 0) {
		const sessionPercent = finite(session["remaining_percent"]);
		const weeklyPercent = finite(weekly["remaining_percent"]);
		if (sessionPercent !== void 0 && weeklyPercent !== void 0) return {
			kind: "ok",
			balance: {
				kind: "percent",
				sessionRemainingPercent: sessionPercent,
				sessionResetsAt: nonEmpty$2(session["resets_at"]) ?? null,
				weeklyRemainingPercent: weeklyPercent,
				weeklyResetsAt: nonEmpty$2(weekly["resets_at"]) ?? null,
				purchasedUsd
			}
		};
	}
	return {
		kind: "error",
		error: {
			code: "unexpected-shape",
			message: "balance response carried no known balance"
		}
	};
}
/**
* Perform one authenticated balance read and normalize the answer.
* @param baseUrl - balance endpoint base, without a trailing slash.
* @param apiKey - Ollama Cloud API key.
* @returns a normalized balance, or a typed failure.
*/
async function requestBalance(baseUrl, apiKey) {
	let response;
	try {
		response = await fetch(`${baseUrl}${BALANCE_PATH}`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json"
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		return {
			kind: "error",
			error: {
				code: "network",
				message: messageOf$1(error)
			}
		};
	}
	if (!response.ok) {
		const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
		return {
			kind: "error",
			error: {
				code: statusCode(response.status),
				message: await failureMessage(response),
				...retryAfterSeconds === void 0 ? {} : { retryAfterSeconds }
			}
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
				message: "balance response was not JSON"
			}
		};
	}
	return normalizeBalance(data);
}
// ollama-quota/src/usage.ts
/**
* The Session usage fold behind `GET api/ollama-quota/session`.
*
* A host-only Session projection folds the durable event log once per new
* event and attributes every provider-reported usage record to the route that
* produced it, so an Ollama balance is never charged for another provider's
* tokens and a mixed-model Session is still counted in full. This module is
* pure: it reads no clock, no Session store, and no service, which is what
* makes the projection replayable and the fold testable.
*
* Substitution semantics match the shipped token-usage fold: an
* `assistant/message` for the same turn and step replaces the usage its
* `assistant/attempt` already contributed instead of adding to it.
*
* @module @local/ollama-quota/usage
*/
/** Numeric state fields a checkpoint may carry. */
const NUMERIC_FIELDS = [
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
* Narrow an untrusted value to a plain record.
* @param value - candidate.
* @returns the record, or undefined.
*/
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Coerce a value to a string without inventing content. */
function text(value) {
	return typeof value === "string" ? value : "";
}
/** Coerce a token counter to a non-negative finite number. */
function count(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
/** Trim to a non-empty string, or undefined. */
function nonEmpty$1(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/** Coerce to a finite number, or null. */
function finiteOrNull(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** Round a USD amount to six decimals so tiny sessions keep a nonzero figure. */
function roundUsd(value) {
	return Math.round(value * 1e6) / 1e6;
}
/**
* Whether a route id is the configured Ollama Cloud provider.
* @param providerId - routed provider id.
* @param configuredProvider - configured provider id.
* @returns true when the ids match case-insensitively.
*/
function isOllamaProvider(providerId, configuredProvider) {
	return typeof providerId === "string" && providerId.toLowerCase() === configuredProvider;
}
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
* Normalize one persisted bucket.
* @param value - stored bucket.
* @returns the canonical bucket, or undefined for a non-object.
*/
function normalizeBucket(value) {
	const record = asRecord(value);
	if (record === void 0) return void 0;
	return {
		provider: text(record["provider"]),
		model: text(record["model"]),
		ollama: record["ollama"] === true,
		requests: count(record["requests"]),
		compactionRequests: count(record["compactionRequests"]),
		input: count(record["input"]),
		output: count(record["output"]),
		cacheRead: count(record["cacheRead"]),
		cacheWrite: count(record["cacheWrite"]),
		total: count(record["total"]),
		estimatedUsd: count(record["estimatedUsd"]),
		pricedRequests: count(record["pricedRequests"]),
		unpricedRequests: count(record["unpricedRequests"])
	};
}
/**
* Normalize one persisted pending record.
* @param value - stored record.
* @returns the canonical record, or null.
*/
function normalizeRecord(value) {
	const record = asRecord(value);
	if (record === void 0) return null;
	return {
		turn: count(record["turn"]),
		step: count(record["step"]),
		kind: record["kind"] === "compaction" ? "compaction" : "assistant",
		provider: text(record["provider"]),
		model: text(record["model"]),
		ollama: record["ollama"] === true,
		requests: count(record["requests"]),
		compactionRequests: count(record["compactionRequests"]),
		input: count(record["input"]),
		output: count(record["output"]),
		cacheRead: count(record["cacheRead"]),
		cacheWrite: count(record["cacheWrite"]),
		total: count(record["total"]),
		cost: finiteOrNull(record["cost"]),
		at: count(record["at"])
	};
}
/**
* Validate and normalize a projection checkpoint.
*
* The seam only calls `parse`, so this plain validator avoids adding a schema
* dependency to the package while still rejecting a non-object checkpoint and
* canonicalizing every field, so a hand-edited or truncated checkpoint cannot
* poison later arithmetic.
*
* @param value - stored state.
* @returns a normalized state.
*/
function parseUsageState(value) {
	const source = asRecord(value);
	if (source === void 0) throw new Error("ollama quota usage state was not an object");
	const state = emptyUsageState(Number(source["ownStart"]) || 0);
	for (const key of NUMERIC_FIELDS) {
		const stored = source[key];
		if (typeof stored === "number" && Number.isFinite(stored)) state[key] = stored;
	}
	state.routeProvider = text(source["routeProvider"]);
	state.routeModel = text(source["routeModel"]);
	state.firstAt = finiteOrNull(source["firstAt"]);
	state.lastAt = finiteOrNull(source["lastAt"]);
	const childIds = source["childIds"];
	state.childIds = Array.isArray(childIds) ? childIds.filter((id) => typeof id === "string") : [];
	const buckets = asRecord(source["buckets"]);
	if (buckets !== void 0) for (const [key, bucket] of Object.entries(buckets)) {
		const normalized = normalizeBucket(bucket);
		if (normalized !== void 0) state.buckets[key] = normalized;
	}
	state.last = normalizeRecord(source["last"]);
	return state;
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
		if (record === void 0) continue;
		const chunk = asRecord(record["chunk"]);
		if (record["type"] === "chunk" && chunk?.["type"] === "usage") return chunk["usage"];
	}
}
/**
* Attribute one provider usage sample to the route that produced it.
*
* `now` is an injected clock rather than a `Date.now()` read so the fold stays
* deterministic: a checkpoint replay and a full replay must agree.
*
* @param event - durable event supplying time and identity.
* @param route - routed provider and model ids.
* @param sample - provider-reported token usage.
* @param kind - assistant call or compaction summary.
* @param prices - merged price table.
* @param configuredProvider - provider id that draws on the Ollama balance.
* @param now - clock used when the event carries no finite time.
* @returns one signed-addable record.
*/
function recordOf(event, route, sample, kind, prices, configuredProvider, now) {
	const usage = asRecord(sample);
	const input = count(usage?.["inputTokens"]);
	const output = count(usage?.["outputTokens"]);
	const cacheRead = count(usage?.["cacheReadTokens"]);
	const cacheWrite = count(usage?.["cacheWriteTokens"]);
	const at = Number.isFinite(event.time) ? event.time : now;
	const provider = route.provider === "" ? "unknown" : route.provider;
	const model = route.model === "" ? "unknown" : route.model;
	const price = priceFor(model, at, prices);
	const cost = price === void 0 ? null : costOf(price, {
		input,
		output,
		cacheRead,
		cacheWrite
	});
	const data = asRecord(event.data);
	return {
		turn: count(data?.["turn"]),
		step: count(data?.["step"]),
		kind,
		provider,
		model,
		ollama: isOllamaProvider(provider, configuredProvider),
		requests: kind === "assistant" ? 1 : 0,
		compactionRequests: kind === "compaction" ? 1 : 0,
		input,
		output,
		cacheRead,
		cacheWrite,
		total: input + output + cacheRead + cacheWrite,
		cost,
		at
	};
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
	if (record.ollama) {
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
		ollama: record.ollama,
		requests: 0,
		compactionRequests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		estimatedUsd: 0,
		pricedRequests: 0,
		unpricedRequests: 0
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
		unpricedRequests: existing.unpricedRequests + sign * (record.cost === null ? 1 : 0)
	};
	return next;
}
/**
* Fold one committed Session event into the usage projection. Every update
* returns a new state; ignored events return the same reference.
* @param state - state covering all prior events.
* @param event - next committed event.
* @param config - configured provider id and merged price table.
* @returns the next state.
*/
function applyUsageEvent(state, event, config) {
	if (event.type === "request/header") {
		const headerConfig = asRecord(asRecord(asRecord(event.data)?.["header"])?.["config"]);
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
		const childId = nonEmpty$1(asRecord(event.data)?.["childId"]);
		if (childId === void 0 || state.childIds.includes(childId)) return state;
		return {
			...state,
			childIds: [...state.childIds, childId]
		};
	}
	if (event.type === "llm/retry-started") {
		if (state.last === null) return state;
		const data = asRecord(event.data);
		if (state.last.turn !== count(data?.["turn"]) || state.last.step !== count(data?.["step"])) return state;
		return {
			...state,
			last: null
		};
	}
	if (event.type === "assistant/message" || event.type === "assistant/attempt") {
		const sample = usageOf(event);
		if (sample === void 0) return state;
		const data = asRecord(event.data);
		const turn = count(data?.["turn"]);
		const step = count(data?.["step"]);
		let next = state;
		if (state.last !== null && state.last.turn === turn && state.last.step === step) next = applyUsageRecord(next, state.last, -1);
		const record = recordOf(event, {
			provider: state.routeProvider,
			model: state.routeModel
		}, sample, "assistant", config.prices, config.provider, event.time);
		next = applyUsageRecord(next, record, 1);
		return {
			...next,
			last: record
		};
	}
	if (event.type === "compaction/summary") {
		const data = asRecord(event.data);
		const sample = data?.["usage"];
		if (sample === void 0 || sample === null) return state;
		return applyUsageRecord(state, recordOf(event, {
			provider: text(data?.["provider"]),
			model: text(data?.["model"])
		}, sample, "compaction", config.prices, config.provider, event.time), 1);
	}
	if (event.type === "session/title-llm-request") {
		if (!isOllamaProvider(text(asRecord(asRecord(event.data)?.["route"])?.["provider"]), config.provider)) return state;
		return {
			...state,
			titleRequests: state.titleRequests + 1
		};
	}
	return state;
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
		ollama: bucket.ollama === true
	})).sort((left, right) => right.totalTokens - left.totalTokens);
	const ollamaModels = models.filter((model) => model.ollama);
	const otherModels = models.filter((model) => !model.ollama);
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
		firstAt: finiteOrNull(usage.firstAt),
		lastAt: finiteOrNull(usage.lastAt),
		models: ollamaModels,
		otherModels,
		otherRequests: count(usage.otherRequests),
		otherCompactionRequests: count(usage.otherCompactionRequests),
		otherTokens: count(usage.otherTokens),
		forked: Number(usage.ownStart) > 0,
		inheritedEventCount: Number(usage.ownStart) || 0
	};
}
// ollama-quota/src/index.ts
/** Exact Fetch route below the authenticated carrier channel. */
const ROUTE_PATH = "/api/ollama-quota/balance";
/** Exact Fetch route serving one Session's attributed usage. */
const SESSION_ROUTE_PATH = "/api/ollama-quota/session";
/**
* Shortest interval between two forced balance reads. The endpoint allows 10
* requests per minute per user, and the chips are cheap to mount and remount;
* a forced read inside this window reuses the cached answer instead of
* spending the budget.
*/
const FORCE_COOLDOWN_MS = 1e4;
/** Hard dependency: the answers travel over the Connection carrier's route registry and read live Sessions. */
const inject = [
	"connection",
	"sessions",
	"sessionProjections"
];
/**
* The projection seam takes a zod schema, but only ever calls `parse` on it.
* This package validates its own plain-JSON checkpoint in `usage.ts`, and
* adding zod as a runtime dependency for one method call is not worth it, so
* the structural validator is cast once here.
*/
const USAGE_STATE_SCHEMA = { parse: parseUsageState };
/**
* Message of an unknown thrown value.
* @param error - thrown value.
* @returns the message.
*/
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Trim to a non-empty string, or undefined.
* @param value - candidate.
* @returns the trimmed text, or undefined when empty or not a string.
*/
function nonEmpty(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Host plugin body.
* @param ctx - owning plugin context.
* @param config - the row's config: credential reference, base URL, cache window,
*   provider id, and optional price overrides.
*/
async function apply(ctx, config) {
	const options = resolveConfig(config);
	/**
	* Host-only Session projection. Keeping the fold in the projection seam makes
	* it replayable and checkpointed, and lets the route read the current value
	* instead of rescanning a durable log.
	*/
	const usageProjection = await ctx.sessionProjections.register({
		key: "ollamaQuotaUsage",
		stateVersion: 1,
		stateSchema: USAGE_STATE_SCHEMA,
		init: (_header, inheritedEventCount) => emptyUsageState(Number(inheritedEventCount) || 0),
		apply: (state, event) => applyUsageEvent(state, event, {
			provider: options.provider,
			prices: options.prices
		})
	});
	/** Last successful balance, kept across failures so a chip can render it as stale. */
	let lastGood = null;
	/** When `lastGood` was fetched, in epoch milliseconds. */
	let fetchedAt = 0;
	/** One shared in-flight read, so concurrent chips cannot multiply requests. */
	let inflight = null;
	ctx.effect(() => ctx.connection.fetch.register({
		path: ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch(request) {
			const force = new URL(request.url).searchParams.has("force");
			return Response.json(await readBalance(force), { headers: { "cache-control": "no-store" } });
		}
	}), "ollama-quota: balance route");
	ctx.effect(() => ctx.connection.fetch.register({
		path: SESSION_ROUTE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch(request) {
			const sessionId = new URL(request.url).searchParams.get("sessionId");
			return Response.json(readSessionUsage(sessionId), { headers: { "cache-control": "no-store" } });
		}
	}), "ollama-quota: session usage route");
	/**
	* Answer one Session's attributed usage from its host projection. The
	* projection owns the fold, so this route is O(new events) and reflects a
	* live child Session without waiting for the parent to append anything.
	*
	* A fold that throws must not take the route down with a 500: the chip has a
	* phrase for a failed read, and one malformed event should cost this Session's
	* figures rather than the whole panel.
	*
	* @param rawSessionId - query value naming the Session.
	* @returns the wire snapshot the Client half renders.
	*/
	function readSessionUsage(rawSessionId) {
		const sessionId = nonEmpty(rawSessionId);
		if (sessionId === void 0) return {
			state: "invalid",
			provider: options.provider,
			generatedAt: Date.now()
		};
		const session = ctx.sessions.get(sessionId);
		if (session === void 0) return {
			state: "missing",
			sessionId,
			provider: options.provider,
			generatedAt: Date.now()
		};
		try {
			const direct = finalizeUsage(usageProjection.stateOf(session));
			const subtree = collectSubtree(session);
			return {
				state: "ok",
				sessionId,
				provider: options.provider,
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
					source: "https://ollama.com/pricing",
					peakWindow: "Mon-Fri 12:00-18:00 UTC"
				},
				generatedAt: Date.now()
			};
		} catch (error) {
			return {
				state: "error",
				sessionId,
				provider: options.provider,
				generatedAt: Date.now(),
				error: {
					code: "projection-failed",
					message: messageOf(error)
				}
			};
		}
	}
	/**
	* Aggregate the Session with every live descendant discovered through its
	* durable `subagent/catalog` projection records. Children that are not
	* mounted are counted as missing rather than silently folded into the total.
	* @param root - Session whose subtree is measured.
	* @returns the aggregate and the child/missing counts.
	*/
	function collectSubtree(root) {
		const aggregate = emptyUsageState(0);
		const visited = /* @__PURE__ */ new Set();
		const missingIds = /* @__PURE__ */ new Set();
		const queue = [root];
		let sessions = 0;
		while (queue.length > 0) {
			const session = queue.shift();
			if (session === void 0) continue;
			const id = String(session.id);
			if (visited.has(id)) continue;
			visited.add(id);
			if (session !== root) sessions += 1;
			const state = usageProjection.stateOf(session);
			mergeUsageState(aggregate, state);
			for (const childId of state.childIds) {
				const child = ctx.sessions.get(childId);
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
	* Answer the current balance, reusing one cached read inside its TTL.
	* @param force - ignore the cached reading for this call, unless a success
	*   landed inside {@link FORCE_COOLDOWN_MS}.
	* @returns the wire snapshot the Client half renders.
	*/
	async function readBalance(force) {
		const now = Date.now();
		const cooling = lastGood !== null && now - fetchedAt < FORCE_COOLDOWN_MS;
		if (!(force && !cooling) && lastGood !== null && now - fetchedAt < options.ttlMs) return snapshot("ok");
		if (inflight !== null) return inflight;
		inflight = (async () => {
			try {
				const key = await resolveApiKey();
				if (key === void 0) return snapshot("unconfigured");
				const answer = await requestBalance(options.baseUrl, key);
				if (answer.kind === "ok") {
					lastGood = answer.balance;
					fetchedAt = Date.now();
					return snapshot("ok");
				}
				return snapshot("error", answer.error);
			} catch (error) {
				return snapshot("error", {
					code: "request-failed",
					message: messageOf(error)
				});
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	}
	/**
	* Compose the wire value; `error` accompanies a failed attempt that may still carry `lastGood`.
	* @param state - the attempt's outcome.
	* @param error - the typed failure, when the attempt failed.
	* @returns the JSON snapshot.
	*/
	function snapshot(state, error) {
		return {
			state,
			apiKeyEnv: options.apiKeyEnv,
			fetchedAt: fetchedAt === 0 ? null : fetchedAt,
			stale: state === "error" && lastGood !== null,
			balance: lastGood,
			error: error ?? null
		};
	}
	/**
	* Resolve the API key from the credential store, then from the ambient environment.
	* Resolution is per call, so a rotated key reaches the next poll without a restart.
	* @returns the key, or undefined while unconfigured.
	*/
	async function resolveApiKey() {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0 && credentials !== null) try {
			const resolved = await credentials.resolve(options.apiKeyEnv);
			if (resolved !== void 0 && nonEmpty(resolved.value) !== void 0) return resolved.value;
		} catch {}
		return nonEmpty(process.env[options.apiKeyEnv]);
	}
}
export { apply, inject };

//# sourceMappingURL=index.js.map