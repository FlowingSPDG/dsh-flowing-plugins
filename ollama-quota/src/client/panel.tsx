/**
 * The card that opens above the chip: balance headline, credit bar, the full
 * breakdown, and this Session's Ollama-only usage.
 *
 * It renders through a portal into `document.body` because the docked
 * composer contains fixed overlays; its box is positioned by the chip's
 * placement hook.
 *
 * @module @local/ollama-quota/client/panel
 */

import type { ReactNode, RefObject } from 'react'

import type { BalanceView, DescribeRow, SessionView } from './describe.ts'
import type { QuotaTranslate } from './describe.ts'
import type { PanelPlacement } from './hooks.ts'

/** A coin glyph, drawn from the current text color. */
export function CoinIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <circle cx={8} cy={8} r={6.4} stroke="currentColor" strokeWidth={1.3} />
      <path
        d="M6 5.6 L8 8.4 L10 5.6 M8 8.4 V10.9 M6.2 9.4 H9.8"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One description list of `label → value` rows.
 * @param props - rows and the key prefix that keeps React pairs unique.
 * @returns the list, or null without rows.
 */
function RowList({ rows, prefix, className }: {
  rows: DescribeRow[]
  prefix: string
  className: string
}): ReactNode {
  if (rows.length === 0) return null
  return (
    <dl className={className}>
      {rows.flatMap((row, index) => [
        <dt key={`${prefix}-label-${String(index)}`}>{row[0]}</dt>,
        <dd key={`${prefix}-value-${String(index)}`}>{row[1]}</dd>,
      ])}
    </dl>
  )
}

/**
 * The card's session block: attributed spend, tokens, and scope notes.
 * @param props - the described session view and the translate function.
 * @returns the section.
 */
function SessionSection({ view, t }: { view: SessionView; t: QuotaTranslate }): ReactNode {
  return (
    <section className="oq-session" data-ollama-session={view.state}>
      <div className="oq-session-head">
        <span className="oq-panel-title">{t('session.title')}</span>
      </div>
      <RowList rows={view.rows} prefix="session" className="oq-rows oq-rows-plain" />
      {view.notes.map((note, index) => (
        <p key={`session-note-${String(index)}`} className="oq-note">
          {note}
        </p>
      ))}
    </section>
  )
}

/**
 * The opened card body. The chip portals it into `document.body`.
 * @param props - balance view, session view, placement, card ref, translate function.
 * @returns the card.
 */
export function BalancePanel({ view, sessionView, placement, panelRef, t }: {
  view: BalanceView
  sessionView: SessionView
  placement: PanelPlacement
  panelRef: RefObject<HTMLDivElement | null>
  t: QuotaTranslate
}): ReactNode {
  return (
    <div
      ref={panelRef}
      className="oq-panel"
      role="dialog"
      aria-label={view.headline}
      style={{
        left: `${String(placement.left)}px`,
        bottom: `${String(placement.bottom)}px`,
        width: `${String(placement.width)}px`,
        maxHeight: `${String(placement.maxHeight)}px`,
      }}
    >
      <div className="oq-panel-head">
        <CoinIcon />
        <span className="oq-panel-title">{view.headline}</span>
        <span className="oq-panel-value">{view.label}</span>
      </div>
      {view.bar !== null ? (
        <div className="oq-bar" data-tone={view.tone}>
          <div className="oq-bar-fill" style={{ width: `${String(Math.round(view.bar * 100))}%` }} />
        </div>
      ) : null}
      <RowList rows={view.rows} prefix="label" className="oq-rows" />
      {view.note !== null ? <p className="oq-note">{view.note}</p> : null}
      <SessionSection view={sessionView} t={t} />
    </div>
  )
}
