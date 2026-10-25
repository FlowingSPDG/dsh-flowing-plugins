/**
 * Host half of the DeepSeek peak-status chip.
 *
 * The chip is pure presentation over the UTC wall clock, so this half has no
 * behaviour. The empty `apply` keeps the Loader row (and therefore the browser
 * half, which attaches to the package-name row) part of the composition.
 *
 * @module @local/deepseek-peak
 */

/** Host plugin body — the Client half owns the whole capability. */
export function apply() {}
