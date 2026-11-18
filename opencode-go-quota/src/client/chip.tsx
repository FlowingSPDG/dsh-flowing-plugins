/**
 * The composer-dock chip: a gauge glyph, the compact usage label, and the
 * free-model badge. Clicking it opens the panel above it.
 *
 * @module @local/opencode-go-quota/client/chip
 */

import * as React from 'react'
import { createPortal } from 'react-dom'

import { describeFree, describeSession, describeUsage, type TranslateFn } from './describe.ts'
import {
  useFreeModels,
  usePanel,
  useSessionUsage,
  useUsage,
  type ReadFree,
  type ReadSessionUsage,
  type ReadUsage,
} from './hooks.ts'
import { GaugeIcon, QuotaPanel } from './panel.tsx'

/** Props the registration's inject face supplies to the chip. */
export interface ChipProps {
  t: TranslateFn
  sessionId?: string | undefined
  readUsage: ReadUsage
  readSessionUsage: ReadSessionUsage
  readFree: ReadFree
}

/**
 * Go usage windows, ambient on the composer's stats row.
 * @param props - readers, translate function, and the mounted Session id.
 * @returns the chip and, while open, the portalled panel.
 */
export function UsageChip({
  t,
  readUsage,
  readSessionUsage,
  readFree,
  sessionId,
}: ChipProps): React.JSX.Element {
  const snapshot = useUsage(readUsage)
  const free = useFreeModels(readFree)
  const view = describeUsage(snapshot, t)
  const freeView = describeFree(free, t)
  const ackKey = free === null ? '' : free.newFree.map((model) => model.id).sort().join(',')
  const panel = usePanel()
  const session = useSessionUsage(readSessionUsage, sessionId, panel.open)
  const sessionView =
    sessionId !== undefined && sessionId !== ''
      ? describeSession(session, t)
      : {
          state: 'unavailable',
          rows: [],
          notes: [t('session.unavailable')],
          tone: 'muted' as const,
        }

  // Opening the panel acknowledges the currently reported new free models.
  React.useEffect(() => {
    if (!panel.open) return
    if (ackKey === '') return
    Promise.resolve()
      .then(() => readFree(true, true))
      .catch(() => {})
  }, [panel.open, ackKey, readFree])

  const worstTone = view.tone
  // Badge priority: a watched model is free right now > new free models >
  // the current free-model count, so the free windows stay visible without
  // opening the panel.
  const watchedFree = freeView.watched.some((model) => model.free)
  const badgeText = watchedFree
    ? t('free.badge')
    : freeView.newIds.size > 0
      ? `+${String(freeView.newIds.size)}`
      : freeView.models.length > 0
        ? String(freeView.models.length)
        : null

  return (
    <React.Fragment>
      <button
        type="button"
        ref={panel.anchorRef}
        className="ogq-chip"
        data-tone={worstTone}
        data-opencode-usage={worstTone}
        data-opencode-free={watchedFree ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-expanded={panel.open}
        onClick={panel.toggle}
      >
        <GaugeIcon />
        <span className="ogq-label">{view.label}</span>
        {badgeText !== null ? <span className="ogq-free-badge">{badgeText}</span> : null}
      </button>
      {panel.open && panel.placement !== null
        ? createPortal(
            <QuotaPanel
              view={view}
              sessionView={sessionView}
              freeView={freeView}
              placement={panel.placement}
              panelRef={panel.panelRef}
              t={t}
            />,
            document.body,
          )
        : null}
    </React.Fragment>
  )
}
