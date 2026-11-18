import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
// model-favorites/src/host/document.ts
/**
* The one durable favorites document and the store that owns its file.
*
* The document lives beside the other Host state under
* `$DSH_HOME/storages/model-favorites/state.json` (or `~/.dsh/...` when the
* variable is unset) so favorites follow the profile across browsers, devices,
* and restarts. Writes are serialized and land through a temporary file plus
* rename, so a crash mid-write leaves the previous document intact rather than a
* truncated one.
*
* A file that exists but does not parse is never reported as an empty document:
* that would let the next browser write replace the user's favorites with
* nothing. The unreadable file is moved aside to `state.corrupt-<stamp>.json`
* and the read fails, so the route answers 500 and the browser — which only
* writes after a successful read — leaves the document alone.
*
* @module @local/model-favorites/host/document
*/
/** The document's fields, in the order every walk visits them. */
const FIELDS = ["providers", "models"];
/** Directory path segments below the DSH home. */
const STATE_SEGMENTS = ["storages", "model-favorites"];
/** The document's file name. */
const STATE_FILE = "state.json";
/** The empty document, also the answer when no file exists yet. */
function emptyDocument() {
	return {
		providers: [],
		models: []
	};
}
/**
* The favorites file this Host owns.
* @param env - environment supplying `DSH_HOME`; defaults to the process one.
* @returns absolute path of `state.json`.
*/
function statePath(env = process.env) {
	const home = typeof env["DSH_HOME"] === "string" && env["DSH_HOME"] !== "" ? env["DSH_HOME"] : join(homedir(), ".dsh");
	return join(home, ...STATE_SEGMENTS, STATE_FILE);
}
/**
* Keep only well-formed, bounded, de-duplicated string lists.
*
* Non-object input, a non-array field, a non-string entry, a blank entry, an
* over-long key, and a repeat all drop out; the first {@link MAX_ENTRIES} keys
* of each field are kept.
*
* @param value - parsed request body or stored document.
* @returns the normalized document.
*/
function normalizeDocument(value) {
	const document = emptyDocument();
	if (typeof value !== "object" || value === null) return document;
	const record = value;
	for (const field of FIELDS) {
		const list = record[field];
		if (!Array.isArray(list)) continue;
		const seen = /* @__PURE__ */ new Set();
		const target = document[field];
		for (const entry of list) {
			if (typeof entry !== "string") continue;
			const key = entry.trim();
			if (key === "" || key.length > 200) continue;
			if (seen.has(key)) continue;
			seen.add(key);
			target.push(key);
			if (target.length >= 500) break;
		}
	}
	return document;
}
/** Rename attempts before the error surfaces (Windows EPERM/EBUSY are transient). */
const DEFAULT_RENAME_ATTEMPTS = 5;
/** First pause between rename attempts. */
const DEFAULT_RENAME_DELAY_MS = 20;
/** File-system error codes worth another rename attempt. */
const RETRYABLE_RENAME = /* @__PURE__ */ new Set([
	"EPERM",
	"EBUSY",
	"EACCES",
	"ENOTEMPTY"
]);
/** The real `node:fs/promises` members the store uses by default. */
const NODE_FS = {
	readFile: (path, encoding) => readFile(path, encoding),
	writeFile: (path, data, encoding) => writeFile(path, data, encoding),
	rename: (from, to) => rename(from, to),
	unlink: (path) => unlink(path),
	mkdir: (path, options) => mkdir(path, options)
};
/** Error code carried by a file-system failure. */
function errorCode(error) {
	if (typeof error !== "object" || error === null) return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/** Human-readable failure text. */
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Pause for one rename retry. */
function pause(milliseconds) {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
/**
* Quarantine name beside the document, for example
* `state.corrupt-2026-11-18T12-30-00-123Z.json`.
*/
function quarantineName(path, stamp, index) {
	const suffix = index === 1 ? "" : `-${String(index)}`;
	const iso = new Date(stamp).toISOString().replace(/[:.]/g, "-");
	const base = basename(path).endsWith(".json") ? basename(path).slice(0, -5) : basename(path);
	return join(dirname(path), `${base}.corrupt-${iso}${suffix}.json`);
}
/**
* Create the document store.
*
* The returned store serializes writes: one write runs at a time, in call
* order, and one failed write starts no queued chain of its own — the next
* write begins from a repaired queue instead of inheriting the failure.
*
* @param options - path, file-system substitutions, and retry tuning.
* @returns the store.
*/
function createStore(options = {}) {
	const path = options.path ?? statePath();
	const fs = {
		...NODE_FS,
		...options.fs
	};
	const renameAttempts = Math.max(1, options.renameAttempts ?? DEFAULT_RENAME_ATTEMPTS);
	const renameDelayMs = Math.max(0, options.renameDelayMs ?? DEFAULT_RENAME_DELAY_MS);
	const now = options.now ?? Date.now;
	let tail = Promise.resolve();
	let disposed = false;
	/** The first quarantine name beside the document that is not taken yet. */
	async function freeQuarantineName(stamp) {
		for (let index = 1; index <= 6; index += 1) {
			const candidate = quarantineName(path, stamp, index);
			try {
				await fs.readFile(candidate, "utf8");
			} catch (error) {
				if (errorCode(error) === "ENOENT") return candidate;
			}
		}
		return quarantineName(path, stamp, 7);
	}
	/**
	* Move an unreadable document aside; returns where it landed.
	*
	* The move keeps the original bytes exactly (rename), so a reader can still
	* recover the document; when the platform refuses the move, the bytes are
	* copied beside it and the unreadable original is dropped.
	*
	* @param text - the bytes just read from the document.
	*/
	async function quarantine(text) {
		const target = await freeQuarantineName(now());
		try {
			await fs.rename(path, target);
			return target;
		} catch {
			await fs.writeFile(target, text, "utf8");
			await fs.unlink(path).catch(() => {});
			return target;
		}
	}
	async function read() {
		let text;
		try {
			text = await fs.readFile(path, "utf8");
		} catch (error) {
			if (errorCode(error) === "ENOENT") return emptyDocument();
			throw error;
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			let moved;
			try {
				moved = await quarantine(text);
			} catch {
				moved = void 0;
			}
			throw new Error(`model-favorites: ${path} is not valid JSON (${messageOf$1(error)})` + (moved === void 0 ? "" : ` — moved aside to ${moved}`));
		}
		return normalizeDocument(parsed);
	}
	/** Rename, retrying the transient failures Windows raises under load. */
	async function renameWithRetry(from, to) {
		for (let attempt = 1; attempt <= renameAttempts; attempt += 1) try {
			await fs.rename(from, to);
			return;
		} catch (error) {
			const code = errorCode(error);
			if (!(code !== void 0 && RETRYABLE_RENAME.has(code)) || attempt === renameAttempts) throw error;
			if (renameDelayMs > 0) await pause(renameDelayMs * attempt);
		}
	}
	/** One atomic replace: write beside the target, then rename over it. */
	async function writeOnce(document) {
		await fs.mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${String(process.pid)}.${now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
		await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
		try {
			await renameWithRetry(temporary, path);
		} catch (error) {
			await fs.unlink(temporary).catch(() => {});
			throw error;
		}
	}
	function write(document) {
		if (disposed) return Promise.reject(/* @__PURE__ */ new Error("model-favorites: the favorites store is disposed"));
		const attempt = tail.then(() => writeOnce(document));
		tail = attempt.catch(() => {});
		return attempt;
	}
	function dispose() {
		disposed = true;
		tail = Promise.resolve();
	}
	return {
		path,
		read,
		write,
		dispose
	};
}
// model-favorites/src/host/route.ts
/**
* The HTTP face of the favorites document.
*
* Exactly one path answers, with the two methods the browser half uses:
*
*   GET  /model-favorites/state   the saved document
*   POST /model-favorites/state   replace it with the posted document
*
* A request the connection layer does not admit is refused before it reaches
* the document; every other method is 405, an oversized body is 413, and an
* empty body is 400 because clearing the document is spelled as an explicit
* empty document rather than as no request at all.
*
* The request and response types are narrowed to what this handler touches, so
* a `node:test` mock can stand in for an HTTP exchange. The Host wiring casts
* `IncomingMessage`/`ServerResponse` once, where the route is registered.
*
* @module @local/model-favorites/host/route
*/
/** Exact path both methods answer. */
const ROUTE = "/model-favorites/state";
/** Human-readable failure text. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Send one JSON response. */
function respondJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* Collect at most {@link MAX_BODY_BYTES} from the request.
*
* An oversized body is drained rather than destroyed, so the caller can still
* answer 413 instead of a reset connection.
*
* @param req - the request stream.
* @returns the collected text, the oversize marker, or the stream failure.
*/
function readBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let tooLarge = false;
		let settled = false;
		const settle = (outcome) => {
			if (settled) return;
			settled = true;
			resolve(outcome);
		};
		req.on("data", (chunk) => {
			if (settled || tooLarge) return;
			const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
			size += bytes;
			if (size > 204800) {
				tooLarge = true;
				chunks.length = 0;
				return;
			}
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
		});
		req.on("end", () => {
			settle(tooLarge ? { kind: "too-large" } : {
				kind: "text",
				text: Buffer.concat(chunks).toString("utf8")
			});
		});
		req.on("error", (error) => {
			settle({
				kind: "failed",
				error
			});
		});
	});
}
/**
* Build the favorites route handler.
* @param options - the store and the optional admission check.
* @returns a handler that owns its response.
*/
function createStateRoute(options) {
	return async (req, res) => {
		const rejection = options.reject?.(req);
		if (rejection !== void 0) {
			res.writeHead(rejection, { "content-type": "text/plain; charset=utf-8" });
			res.end("forbidden");
			return;
		}
		const method = (req.method ?? "GET").toUpperCase();
		if (method === "GET" || method === "HEAD") {
			try {
				respondJson(res, 200, await options.store.read());
			} catch (error) {
				respondJson(res, 500, { error: messageOf(error) });
			}
			return;
		}
		if (method !== "POST") {
			res.writeHead(405, {
				allow: "GET, HEAD, POST",
				"content-type": "text/plain; charset=utf-8"
			});
			res.end("method not allowed");
			return;
		}
		const body = await readBody(req);
		if (body.kind === "too-large") {
			respondJson(res, 413, { error: "request body too large" });
			return;
		}
		if (body.kind === "failed") {
			respondJson(res, 400, { error: messageOf(body.error) });
			return;
		}
		if (body.text.trim() === "") {
			respondJson(res, 400, { error: "an empty body is not a document" });
			return;
		}
		let document;
		try {
			document = normalizeDocument(JSON.parse(body.text));
		} catch (error) {
			respondJson(res, 400, { error: messageOf(error) });
			return;
		}
		try {
			await options.store.write(document);
			respondJson(res, 200, document);
		} catch (error) {
			respondJson(res, 500, { error: messageOf(error) });
		}
	};
}
// model-favorites/src/index.ts
/** Stable Cordis plugin name. */
const name = "@local/model-favorites";
/** Routes mount lazily; a headless profile never resolves the Web server. */
const inject = [];
/**
* Resolve the admission check per request: the service may appear after this
* plugin mounts, and a Host without one admits every request.
*
* @param ctx - the plugin context.
* @returns the rejection status, or `undefined` when the request is admitted.
*/
function rejectionFor(ctx) {
	return (req) => {
		const connection = ctx.get("connection");
		if (connection === void 0 || typeof connection.requestRejection !== "function") return void 0;
		return connection.requestRejection(req);
	};
}
/**
* Mount the favorites routes.
* @param ctx - the plugin context.
*/
function apply(ctx) {
	const store = createStore();
	ctx.effect(() => () => {
		store.dispose();
	}, "model-favorites: favorites store");
	ctx.inject(["webServer"], (scope) => {
		const handle = createStateRoute({
			store,
			reject: rejectionFor(ctx)
		});
		scope.effect(() => scope.webServer.register({
			kind: "exact",
			path: ROUTE,
			handler: (req, res) => handle(req, res)
		}), "model-favorites: state route");
	});
}
export { apply, inject, name };

//# sourceMappingURL=index.js.map