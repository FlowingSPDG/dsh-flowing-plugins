/**
 * Host half of the provider-visibility plugin.
 *
 * Both surfaces are browser-side slot contributions, so this half has no
 * behaviour. The empty `apply` keeps the Loader row (and therefore the browser
 * half, which attaches to the package-name row) part of the composition.
 *
 * @module @local/provider-visibility
 */

import type { Context } from '@deepseek-ai/cordis'

/** Host plugin body — the Client half owns the whole capability. */
export function apply(_ctx: Context): void {}
