/**
 * The quota panel: usage windows, this Session's estimate, and the free-model
 * watch, rendered into a card anchored above the chip.
 *
 * Presentational only — every figure arrives already folded by `describe.ts`,
 * so this module owns markup and class names and nothing else.
 *
 * @module @local/opencode-go-quota/client/panel
 */

import type * as React from 'react'

import { listUsd, stampTime } from './format.ts'
import type { FreeView, SessionView, TranslateFn, UsageView } from './describe.ts'
import { toneOf } from './describe.ts'
import type { PanelPlacement } from './hooks.ts'

/** A gauge glyph, drawn from the current text color. */
export function GaugeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <circle cx={8} cy={8} r={6.4} stroke="currentColor" strokeWidth={1.3} />
      <path
        d="M8 4.4 V8 L10.8 9.8"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The panel's Session block: attributed spend, tokens, and scope notes. */
function SessionSection({ view, t }: { view: SessionView; t: TranslateFn }): React.JSX.Element {
  return (
    <section className="ogq-session" data-opencode-session={view.state}>
      <div className="ogq-session-head">
        <span className="ogq-panel-title">{t('session.title')}</span>
      </div>
      {view.rows.length > 0 ? (
        <dl className="ogq-rows ogq-rows-plain">
          {view.rows.flatMap((row, index) => [
            <dt key={`session-label-${String(index)}`}>{row[0]}</dt>,
            <dd key={`session-value-${String(index)}`}>{row[1]}</dd>,
          ])}
        </dl>
      ) : null}
      {view.notes.map((note, index) => (
        <p key={`session-note-${String(index)}`} className="ogq-note">
          {note}
        </p>
      ))}
    </section>
  )
}

/** The panel's free-model block: watched statuses, the list, and the change history. */
function FreeSection({ view, t }: { view: FreeView; t: TranslateFn }): React.JSX.Element {
  const history = view.history.slice(0, 6)
  return (
    <section className="ogq-free" data-opencode-free={view.state}>
      <div className="ogq-free-head">
        <span className="ogq-panel-title">{t('free.title')}</span>
        <span className="ogq-panel-value">
          {t('free.count', { count: String(view.models.length) })}
        </span>
      </div>
      {view.watched.length > 0 ? (
        <dl className="ogq-rows ogq-rows-plain ogq-watch-rows">
          {view.watched.flatMap((model, index) => [
            <dt key={`watch-label-${String(index)}`}>{model.name}</dt>,
            <dd
              key={`watch-value-${String(index)}`}
              data-free={model.free ? 'true' : 'false'}
            >
              {model.free
                ? t('free.nowFree')
                : typeof model.inputPrice === 'number'
                  ? t('free.nowPaid', { price: listUsd(model.inputPrice) })
                  : t('free.nowPaidUnknown')}
            </dd>,
          ])}
        </dl>
      ) : null}
      {view.state === 'empty' ? <p className="ogq-note">{t('free.empty')}</p> : null}
      {view.models.length > 0 ? (
        <ul className="ogq-free-list">
          {view.models.map((model, index) => (
            <li key={model.id === '' ? String(index) : model.id}>
              <span className="ogq-free-id">{model.name === '' ? model.id : model.name}</span>
              {view.newIds.has(model.id) ? (
                <span className="ogq-free-tag" data-new="true">
                  {t('free.new')}
                </span>
              ) : null}
              {model.limitedRegions ? <span className="ogq-free-tag">geo</span> : null}
              {model.training ? <span className="ogq-free-tag">training</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {history.length > 0 ? (
        <div className="ogq-history">
          <div className="ogq-history-head">{t('free.historyTitle')}</div>
          <ul className="ogq-free-list">
            {history.map((entry, index) => (
              <li
                key={`history-${String(index)}`}
                className="ogq-history-row"
                data-kind={entry.kind}
              >
                <span className="ogq-history-text">
                  {entry.kind === 'added'
                    ? t('free.added', { name: entry.name })
                    : t('free.removed', { name: entry.name })}
                </span>
                <span className="ogq-history-at">{stampTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.notes.map((note, index) => (
        <p key={`free-note-${String(index)}`} className="ogq-note">
          {note}
        </p>
      ))}
    </section>
  )
}

/** Everything the panel needs, already folded. */
export interface QuotaPanelProps {
  view: UsageView
  sessionView: SessionView
  freeView: FreeView
  placement: PanelPlacement
  panelRef: React.RefObject<HTMLDivElement | null>
  t: TranslateFn
}

/**
 * The anchored panel. It is portalled to the document body by the chip, because
 * the docked composer contains fixed overlays.
 * @param props - folded views, placement, and the anchor ref.
 * @returns the panel element.
 */
export function QuotaPanel({
  view,
  sessionView,
  freeView,
  placement,
  panelRef,
  t,
}: QuotaPanelProps): React.JSX.Element {
  return (
    <div
      ref={panelRef}
      className="ogq-panel"
      role="dialog"
      aria-label={view.headline}
      style={{
        left: `${String(placement.left)}px`,
        bottom: `${String(placement.bottom)}px`,
        width: `${String(placement.width)}px`,
        maxHeight: `${String(placement.maxHeight)}px`,
      }}
    >
      <div className="ogq-panel-head">
        <GaugeIcon />
        <span className="ogq-panel-title">{view.headline}</span>
        <span className="ogq-panel-value">{view.label}</span>
      </div>
      {view.windows.map((window) => (
        <div key={window.key} className="ogq-window">
          <div className="ogq-window-head">
            <span>{window.label}</span>
            <span className="ogq-window-reset">
              {window.resetsAt !== null ? t('usage.resetAt', { time: window.resetsAt }) : null}
            </span>
            <span>{`${String(Math.round(window.percent))}%`}</span>
          </div>
          <div className="ogq-bar" data-tone={toneOf(window.percent)}>
            <div
              className="ogq-bar-fill"
              style={{
                width: `${String(Math.round(Math.min(100, Math.max(0, window.percent))))}%`,
              }}
            />
          </div>
        </div>
      ))}
      {view.windows.some((window) => window.percent >= 100) ? (
        <p className="ogq-note">{t('usage.exhausted')}</p>
      ) : null}
      <dl className="ogq-rows">
        {view.notes.flatMap((row, index) =>
          row[1] === null
            ? [
                <dt
                  key={`label-${String(index)}`}
                  style={{ gridColumn: '1 / -1' }}
                >
                  {row[0]}
                </dt>,
              ]
            : [
                <dt key={`label-${String(index)}`}>{row[0]}</dt>,
                <dd key={`value-${String(index)}`}>{row[1]}</dd>,
              ],
        )}
      </dl>
      <SessionSection view={sessionView} t={t} />
      <FreeSection view={freeView} t={t} />
    </div>
  )
}
