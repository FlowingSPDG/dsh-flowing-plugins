/**
 * Host half of the Ollama Cloud off-peak chip.
 *
 * The chip is pure presentation over the UTC wall clock, so this half has no
 * behaviour. The empty `apply` keeps the Loader row (and therefore the browser
 * half, which attaches to the package-name row) part of the composition.
 *
 * @module @local/ollama-offpeak
 */

import type { Context } from '@deepseek-ai/cordis'

/** Host plugin body — the Client half owns the whole capability. */
export function apply(_ctx: Context): void {}
