/**
 * Browser entry of Model favorites.
 *
 * The bundle's single job is to install the chip; everything it does lives in
 * {@link module:@local/model-favorites/client/index}. The module loader owns the
 * `window.__ModuleLoader__.load` wrapper, so this file exports only `inject` and
 * `apply`.
 *
 * @module @local/model-favorites/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'

import { mountFavorites } from './client/index.tsx'

/** Services the contribution registers against. */
export const inject = ['slots', 'locale'] as const

/**
 * Client plugin body: mount the chip over the shared model directories.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  mountFavorites(ctx)
}
