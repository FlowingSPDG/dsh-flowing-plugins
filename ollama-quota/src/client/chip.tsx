/**
 * The composer chip: remaining Ollama Cloud credit, ambient on the dock.
 *
 * Clicking it opens {@link BalancePanel} above the chip; the panel carries the
 * credit bar, the full breakdown, and this Session's Ollama-only spend.
 *
 * @module @local/ollama-quota/client/chip
 */

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { describeBalance, describeSession, type SessionView } from './describe.ts'
import { useBalance, usePanel, useSessionUsage, type ReadBalance, type ReadSessionUsage } from './hooks.ts'
import { BalancePanel, CoinIcon } from './panel.tsx'

/** Props the plugin body injects into the chip beyond the slot's own shares. */
export interface ChipInjected {
  readBalance: ReadBalance
  readSessionUsage: ReadSessionUsage
}

/** Composed props of the dock entry. */
export type ChipProps = PropsRuntime<'conversation.composer.dock'> & ChipInjected & {
  t: TranslateNS<'ollamaQuota'>
}

/**
 * Remaining Ollama Cloud credit, ambient on the composer's dock.
 * @param props - slot shares, the two readers, and the translate function.
 * @returns the chip and, while open, the portalled card.
 */
export function BalanceChip({ t, readBalance, readSessionUsage, sessionId }: ChipProps): ReactNode {
  const snapshot = useBalance(readBalance)
  const view = describeBalance(snapshot, t)
  const panel = usePanel()
  const session = useSessionUsage(readSessionUsage, sessionId, panel.open)
  const sessionView: SessionView = sessionId === ''
    ? { state: 'unavailable', rows: [], notes: [t('session.unavailable')] }
    : describeSession(session, t)
  return (
    <>
      <button
        type="button"
        ref={panel.anchorRef}
        className="oq-chip"
        data-tone={view.tone}
        data-ollama-balance={view.tone}
        aria-haspopup="dialog"
        aria-expanded={panel.open}
        onClick={panel.toggle}
      >
        <CoinIcon />
        <span className="oq-label">{view.label}</span>
      </button>
      {panel.open && panel.placement !== null
        ? createPortal(
          <BalancePanel
            view={view}
            sessionView={sessionView}
            placement={panel.placement}
            panelRef={panel.panelRef}
            t={t}
          />,
          document.body,
        )
        : null}
    </>
  )
}
