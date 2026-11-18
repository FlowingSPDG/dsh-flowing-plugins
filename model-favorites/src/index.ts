/**
 * Host half of Model favorites.
 *
 * Owns the one durable favorites document — which providers and which
 * provider/model pairs a user starred — and serves it to every browser over a
 * pair of exact routes on the Web server. A headless profile never resolves the
 * Web server, so the routes mount lazily and the document store is disposed
 * with the fiber that created it.
 *
 * @module @local/model-favorites
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { createStore } from './host/document.ts'
import {
  ROUTE,
  createStateRoute,
  type RouteRequest,
  type RouteResponse,
} from './host/route.ts'

/** Stable Cordis plugin name. */
export const name = '@local/model-favorites'

/** Routes mount lazily; a headless profile never resolves the Web server. */
export const inject: string[] = []

/**
 * The connection layer's admission check.
 *
 * The Host connection service is not part of this package's compilation face
 * (the browser connection package is a different service), so only the one
 * method used here is named. The cast at the read site is the package's single
 * acknowledgement that the composed Host, not this package, owns that service.
 */
interface ConnectionFace {
  requestRejection(request: RouteRequest): number | undefined
}

/**
 * Resolve the admission check per request: the service may appear after this
 * plugin mounts, and a Host without one admits every request.
 *
 * @param ctx - the plugin context.
 * @returns the rejection status, or `undefined` when the request is admitted.
 */
function rejectionFor(ctx: Context): (req: RouteRequest) => number | undefined {
  return (req) => {
    const connection = ctx.get('connection') as ConnectionFace | undefined
    if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined
    return connection.requestRejection(req)
  }
}

/**
 * Mount the favorites routes.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  const store = createStore()
  ctx.effect(() => () => {
    store.dispose()
  }, 'model-favorites: favorites store')

  ctx.inject(['webServer'], (scope) => {
    const handle = createStateRoute({ store, reject: rejectionFor(ctx) })
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: ROUTE,
      // One cast, here: the Web server hands over the real node:http pair, and
      // the handler names only the members it touches.
      handler: (req, res) => handle(
        req as unknown as RouteRequest,
        res as unknown as RouteResponse,
      ),
    }), 'model-favorites: state route')
  })
}
