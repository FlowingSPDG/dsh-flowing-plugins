/**
 * Pure helpers behind the provider-visibility surfaces.
 *
 * They live outside the client entry so `node --test` can exercise them
 * without a browser: no React, no DOM, no locale service.
 *
 * @module @local/provider-visibility/routes
 */

/** One provider/model route that served a turn. */
export interface RouteRef {
  provider: string
  model: string
}

/** A catalog model's badge text, as handed to the locale resolver. */
export type BadgeResolver = (text: never) => string

interface RouteLike {
  provider: string
  model: string
}

function isRouteLike(value: unknown): value is RouteLike {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['provider'] === 'string' &&
    typeof record['model'] === 'string' &&
    record['provider'] !== '' &&
    record['model'] !== ''
  )
}

/**
 * Deduplicate a turn's attributed routes, keeping first-seen order.
 *
 * The key is a NUL-separated pair rather than `provider/model`, so provider
 * `a/b` with model `c` and provider `a` with model `b/c` stay distinct.
 *
 * @param routes - untrusted token-usage attribution.
 * @returns the non-empty, de-duplicated routes.
 */
export function uniqueRoutes(routes: unknown): RouteRef[] {
  if (!Array.isArray(routes)) return []
  const seen = new Set<string>()
  const unique: RouteRef[] = []
  for (const route of routes) {
    if (!isRouteLike(route)) continue
    const key = `${route.provider}\u0000${route.model}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ provider: route.provider, model: route.model })
  }
  return unique
}

/**
 * Resolve one catalog badge's text, tolerating a missing badge or a resolver
 * failure: the label then renders without a badge rather than crashing.
 *
 * @param badge - the catalog model's optional badge.
 * @param resolveText - locale text resolver.
 * @returns the display text, or `''` when there is none.
 */
export function badgeText(
  badge: { text?: unknown } | undefined | null,
  resolveText: BadgeResolver,
): string {
  const text = badge?.text
  if (text === undefined || text === null) return ''
  try {
    return resolveText(text as never)
  } catch {
    return ''
  }
}

/** Where one label render happens: the composer trigger or a menu row. */
export type LabelPlacement = 'trigger' | 'menu' | 'option'

/**
 * Normalize the slot's placement prop.
 *
 * @param placement - the owner's placement, possibly absent.
 * @returns the placement, defaulting to a menu row.
 */
export function normalizePlacement(placement: string | undefined): LabelPlacement {
  return placement === 'trigger' || placement === 'option' ? placement : 'menu'
}
