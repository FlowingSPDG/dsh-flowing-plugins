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

import { normalizeDocument, type FavoritesStore } from './document.ts'

/** Exact path both methods answer. */
export const ROUTE = '/model-favorites/state'

/** Largest accepted request body: the document is two short string arrays. */
export const MAX_BODY_BYTES = 200 * 1024

/** The request members this handler reads. */
export interface RouteRequest {
  readonly method?: string | undefined
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
}

/** The response members this handler writes. */
export interface RouteResponse {
  writeHead(status: number, headers?: Record<string, string | number>): unknown
  end(body?: string): unknown
}

/** One request handler owning the full response lifecycle. */
export type RouteHandler = (req: RouteRequest, res: RouteResponse) => Promise<void>

/** Route construction options. */
export interface StateRouteOptions {
  /** The profile's one favorites store. */
  readonly store: FavoritesStore
  /**
   * Connection-layer admission: a numeric status refuses the request before
   * the document is touched. Absent when this Host has no such layer.
   */
  readonly reject?: ((req: RouteRequest) => number | undefined) | undefined
}

/** One request body, either collected or rejected. */
type BodyOutcome =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'failed'; readonly error: unknown }

/** Human-readable failure text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Send one JSON response. */
function respondJson(res: RouteResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
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
function readBody(req: RouteRequest): Promise<BodyOutcome> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let tooLarge = false
    let settled = false
    const settle = (outcome: BodyOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    req.on('data', (chunk) => {
      if (settled || tooLarge) return
      const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
      size += bytes
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    })
    req.on('end', () => {
      settle(tooLarge ? { kind: 'too-large' } : { kind: 'text', text: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', (error) => {
      settle({ kind: 'failed', error })
    })
  })
}

/**
 * Build the favorites route handler.
 * @param options - the store and the optional admission check.
 * @returns a handler that owns its response.
 */
export function createStateRoute(options: StateRouteOptions): RouteHandler {
  return async (req, res) => {
    const rejection = options.reject?.(req)
    if (rejection !== undefined) {
      res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }

    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'GET' || method === 'HEAD') {
      try {
        respondJson(res, 200, await options.store.read())
      } catch (error) {
        // Unreadable state (corrupt JSON moved aside, or an I/O failure) is a
        // real failure: answering 200 with an empty document here would invite
        // the browser to overwrite the user's favorites with nothing.
        respondJson(res, 500, { error: messageOf(error) })
      }
      return
    }

    if (method !== 'POST') {
      res.writeHead(405, {
        allow: 'GET, HEAD, POST',
        'content-type': 'text/plain; charset=utf-8',
      })
      res.end('method not allowed')
      return
    }

    const body = await readBody(req)
    if (body.kind === 'too-large') {
      respondJson(res, 413, { error: 'request body too large' })
      return
    }
    if (body.kind === 'failed') {
      respondJson(res, 400, { error: messageOf(body.error) })
      return
    }
    if (body.text.trim() === '') {
      respondJson(res, 400, { error: 'an empty body is not a document' })
      return
    }

    let document
    try {
      document = normalizeDocument(JSON.parse(body.text) as unknown)
    } catch (error) {
      respondJson(res, 400, { error: messageOf(error) })
      return
    }

    try {
      await options.store.write(document)
      respondJson(res, 200, document)
    } catch (error) {
      respondJson(res, 500, { error: messageOf(error) })
    }
  }
}
