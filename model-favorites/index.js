/**
 * Host half of Model favorites.
 *
 * Owns the one durable favorites document — which providers and which
 * provider/model pairs a user starred — and serves it to every browser over a
 * pair of exact routes on the Web server:
 *
 *   GET  /model-favorites/state   the saved document
 *   POST /model-favorites/state   replace it with the posted document
 *
 * The document lives beside the other Host state under
 * `$DSH_HOME/storages/model-favorites/state.json` so favorites follow the
 * profile across browsers, devices, and restarts. Writes are serialized and
 * land through a temporary file plus rename, so a crash mid-write leaves the
 * previous document intact rather than a truncated one.
 *
 * Neither route carries anything but the two string arrays the browser half
 * owns, and both refuse a request the connection layer does not admit.
 *
 * @module @local/model-favorites
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable Cordis plugin name. */
export const name = '@local/model-favorites'

/** Routes mount lazily; a headless profile never resolves the Web server. */
export const inject = []

/** Exact path both methods answer. */
const ROUTE = '/model-favorites/state'

/** Largest accepted request body: the document is two short string arrays. */
const MAX_BODY_BYTES = 200 * 1024

/** Most entries one list may hold; well above a realistic catalog. */
const MAX_ENTRIES = 500

/** Longest accepted provider or model key. */
const MAX_KEY_LENGTH = 200

/** An empty document, also the answer when no file exists yet. */
function emptyDocument() {
  return { providers: [], models: [] }
}

/** The one favorites file this Host owns. */
function statePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'storages', 'model-favorites', 'state.json')
}

/**
 * Keep only well-formed, bounded, de-duplicated string lists.
 * @param value - parsed request body or stored document.
 * @returns the normalized document.
 */
function normalizeDocument(value) {
  const document = emptyDocument()
  if (value === null || typeof value !== 'object') return document
  for (const field of ['providers', 'models']) {
    const list = value[field]
    if (!Array.isArray(list)) continue
    const seen = new Set()
    for (const entry of list) {
      if (typeof entry !== 'string') continue
      const key = entry.trim()
      if (key === '' || key.length > MAX_KEY_LENGTH) continue
      if (seen.has(key)) continue
      seen.add(key)
      document[field].push(key)
      if (document[field].length >= MAX_ENTRIES) break
    }
  }
  return document
}

/** Read the saved document; a missing or unreadable file reads as empty. */
async function readDocument() {
  try {
    return normalizeDocument(JSON.parse(await readFile(statePath(), 'utf8')))
  } catch {
    return emptyDocument()
  }
}

/** Serialized writes: the last accepted document wins, never a torn one. */
let writeQueue = Promise.resolve()

/**
 * Replace the saved document atomically.
 *
 * The returned promise carries this write's own failure so the route can answer
 * 500; the queue itself is repaired separately, because one failed write must
 * not poison every later one.
 *
 * @param document - normalized document to persist.
 */
function writeDocument(document) {
  const attempt = writeQueue.then(async () => {
    const target = statePath()
    await mkdir(join(target, '..'), { recursive: true })
    const temporary = `${target}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  })
  writeQueue = attempt.catch(() => { /* the next write starts from a clean queue */ })
  return attempt
}

/** Send one JSON response. */
function respond(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Collect at most `MAX_BODY_BYTES` from the request.
 *
 * An oversized body is drained rather than destroyed, so the caller can still
 * answer 413 instead of a reset connection.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('request body too large'))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/**
 * Mount the favorites routes.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    scope.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        const connection = ctx.get('connection')
        const rejection = typeof connection?.requestRejection === 'function'
          ? connection.requestRejection(req)
          : undefined
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('forbidden')
          return
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
          try {
            respond(res, 200, await readDocument())
          } catch (error) {
            respond(res, 500, { error: String(error?.message ?? error) })
          }
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'text/plain; charset=utf-8' })
          res.end('method not allowed')
          return
        }

        let body
        try {
          body = await readBody(req)
        } catch (error) {
          const oversized = String(error?.message ?? error).includes('too large')
          respond(res, oversized ? 413 : 400, { error: String(error?.message ?? error) })
          return
        }

        // An empty body would erase the document; a client that means to clear
        // it posts `{ "providers": [], "models": [] }` explicitly.
        let document
        try {
          if (body.trim() === '') throw new Error('an empty body is not a document')
          document = normalizeDocument(JSON.parse(body))
        } catch (error) {
          respond(res, 400, { error: String(error?.message ?? error) })
          return
        }

        try {
          await writeDocument(document)
          respond(res, 200, document)
        } catch (error) {
          respond(res, 500, { error: String(error?.message ?? error) })
        }
      },
    }), 'model-favorites: state route')
  })
}
