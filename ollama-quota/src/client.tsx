/**
 * Browser half of the Ollama Cloud quota chip.
 *
 * This entry owns no rendering: it registers the chip's stylesheet, its
 * dictionaries, and the two Host readers, then contributes the chip to the
 * composer's dock. The chip and its card live in `./client/`.
 *
 * The Host readers post to this bundle's private routes, which sit below the
 * page's authenticated carrier: the browser session cookie is the whole
 * credential, and the API key never reaches the browser.
 *
 * @module @local/ollama-quota/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { BalanceChip } from './client/chip.tsx'
import type { ReadBalance, ReadSessionUsage } from './client/hooks.ts'
import { en, ja, NS } from './client/locale.ts'

/** Exact route this bundle's Host half answers, posted relative to the page. */
const ROUTE = 'api/ollama-quota/balance'

/** Exact route the Host half answers for one Session's attributed usage. */
const SESSION_ROUTE = 'api/ollama-quota/session'

/** A stalled Host read must not freeze the chip's or the card's refresh loop. */
const CLIENT_REQUEST_TIMEOUT_MS = 15_000

const CSS = `
.oq-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  font-variant-numeric: tabular-nums;
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
  appearance: none;
  background: none;
  border: 0;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
}
.oq-chip svg { width: 14px; height: 14px; flex: none; }
@media (hover: hover) {
  .oq-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.oq-chip:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.oq-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.oq-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.oq-chip[data-tone='muted'] { color: var(--dsw-alias-label-secondary); opacity: 0.75; }
.oq-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.oq-panel {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.oq-panel-head { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.oq-panel-head svg { width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-tertiary); }
.oq-panel-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oq-panel-value { margin-left: auto; font-variant-numeric: tabular-nums; }
.oq-bar { height: 4px; margin: 10px 0 2px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.oq-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.oq-bar[data-tone='warn'] .oq-bar-fill { background: var(--dsw-alias-state-warn-primary); }
.oq-bar[data-tone='error'] .oq-bar-fill { background: var(--dsw-alias-state-error-primary); }
.oq-rows {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 4px 16px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.oq-rows dt, .oq-rows dd { min-width: 0; margin: 0; }
.oq-rows dd { color: var(--dsw-alias-label-secondary); text-align: right; font-variant-numeric: tabular-nums; }
.oq-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); }
.oq-session { margin-top: 12px; padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.oq-session-head { display: flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.oq-rows-plain { margin-top: 6px; padding-top: 0; border-top: 0; }
`

/**
 * Read this bundle's Host half. The route sits below the page's authenticated
 * carrier, so the browser session cookie is the whole credential.
 * @param force - bypass the Host cache, subject to the Host's force cooldown.
 * @returns the balance snapshot, unvalidated.
 */
const readBalance: ReadBalance = async (force) => {
  const url = force ? `${ROUTE}?force=1` : ROUTE
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`balance route answered HTTP ${String(response.status)}`)
  const snapshot: unknown = await response.json()
  if (snapshot === null || typeof snapshot !== 'object') throw new Error('balance route answered no snapshot')
  return snapshot
}

/**
 * Read one Session's attributed usage from this bundle's Host half. The route
 * reads the durable log, so it also sees usage from before a context
 * compaction and from a model that is no longer selected.
 * @param sessionId - mounted Session identity.
 * @returns the session usage snapshot, unvalidated.
 */
const readSessionUsage: ReadSessionUsage = async (sessionId) => {
  const url = `${SESSION_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`session route answered HTTP ${String(response.status)}`)
  const snapshot: unknown = await response.json()
  if (snapshot === null || typeof snapshot !== 'object') throw new Error('session route answered no snapshot')
  return snapshot
}

/** Required services: the contribution registry and the locale face. */
export const inject = ['slots', 'locale'] as const

/**
 * Client plugin body: install the stylesheet and dictionaries, then register
 * the chip into the composer's dock.
 * @param ctx - owning client context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset['dshPlugin'] = '@local/ollama-quota'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'ollama-quota: chip styles')

  // Two single-locale registrations rather than the typed all-locales form:
  // this bundle ships Japanese and English only, and the typed form would
  // demand the Chinese baseline dictionary as well.
  ctx.effect(() => {
    const disposeJa = ctx.locale.register(NS, 'ja', ja)
    const disposeEn = ctx.locale.register(NS, 'en', en)
    return () => {
      disposeEn()
      disposeJa()
    }
  }, 'ollama-quota: dictionaries')

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'ollama-balance',
    order: 20,
    locale: NS,
    inject: () => ({ readBalance, readSessionUsage }),
  }, BalanceChip))
}
