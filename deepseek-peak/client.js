/**
 * Browser half of the DeepSeek peak-status chip.
 *
 * DeepSeek-V4.1-Flash on Ollama Cloud publishes an off-peak rate: peak billing
 * is weekdays 12:00–18:00 UTC, and every other hour — including the whole UTC
 * weekend — bills at the off-peak rate. The chip reads the UTC wall clock and
 * names the current side of that boundary plus the time left on it, so a user
 * can tell at a glance whether a request right now bills at peak.
 *
 * @module @local/deepseek-peak/client
 */

window.__ModuleLoader__.load({
  id: '@local/deepseek-peak',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'deepseekPeak'

    /** The model whose published window this chip reports. */
    const MODEL = 'DeepSeek-V4.1-Flash'

    /** Published peak window (UTC minutes): weekdays 12:00 inclusive to 18:00 exclusive. */
    const PEAK_START_MINUTES = 12 * 60
    const PEAK_END_MINUTES = 18 * 60

    /** A clock boundary is the only thing that changes this chip; half a minute is plenty. */
    const TICK_MS = 30_000

    const ja = {
      'peak.label': 'ピーク · {remaining}',
      'offPeak.label': 'オフピーク · {remaining}',
      'peak.title': '{model} の料金時間',
      'peak.now': '現在',
      'peak.state.peak': 'ピークタイム',
      'peak.state.offPeak': 'オフピークタイム',
      'peak.window': 'ピーク時間',
      'peak.windowValue': '月〜金 12:00–18:00 UTC（土日は終日オフピーク）',
      'peak.next': '次の切替',
      'peak.nextToOffPeak': '18:00 UTC にオフピークへ',
      'peak.nextToPeak': '12:00 UTC にピークへ',
      'peak.remaining': 'あと {remaining}',
      'peak.localClock': '現地時刻 {time}',
      'duration.minutes': '{minutes}分',
      'duration.hours': '{hours}時間{minutes}分',
      'duration.days': '{days}日{hours}時間',
    }

    const en = {
      'peak.label': 'Peak · {remaining}',
      'offPeak.label': 'Off-peak · {remaining}',
      'peak.title': '{model} billing window',
      'peak.now': 'Now',
      'peak.state.peak': 'Peak time',
      'peak.state.offPeak': 'Off-peak time',
      'peak.window': 'Peak hours',
      'peak.windowValue': 'Mon–Fri 12:00–18:00 UTC (the UTC weekend is off-peak all day)',
      'peak.next': 'Next change',
      'peak.nextToOffPeak': 'off-peak at 18:00 UTC',
      'peak.nextToPeak': 'peak at 12:00 UTC',
      'peak.remaining': 'in {remaining}',
      'peak.localClock': 'local {time}',
      'duration.minutes': '{minutes}m',
      'duration.hours': '{hours}h{minutes}m',
      'duration.days': '{days}d {hours}h',
    }

    const CSS = `
.dp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 1px 8px 1px 6px;
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
}
.dp-chip svg { width: 13px; height: 13px; flex: none; }
.dp-chip[data-tone='peak'] { color: var(--dsw-alias-state-warn-primary); }
.dp-chip[data-tone='offPeak'] { color: var(--dsw-alias-state-success-primary); }
.dp-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
`

    /**
     * Read one instant against the published peak window.
     * @param now - epoch milliseconds.
     * @returns whether it bills at peak, and when the next boundary is.
     */
    function peakState(now) {
      const at = new Date(now)
      const day = at.getUTCDay()
      const minutes = at.getUTCHours() * 60 + at.getUTCMinutes()
      const weekday = day >= 1 && day <= 5
      const peak = weekday && minutes >= PEAK_START_MINUTES && minutes < PEAK_END_MINUTES

      if (peak) {
        const nextAt = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 18, 0, 0, 0)
        return { peak, nextAt, remainingMs: Math.max(0, nextAt - now) }
      }

      // Walk forward to the next weekday 12:00 UTC. At most three days away.
      for (let add = 0; add < 8; add += 1) {
        const candidate = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + add, 12, 0, 0, 0)
        const candidateDay = new Date(candidate).getUTCDay()
        if (candidateDay === 0 || candidateDay === 6) continue
        if (candidate <= now) continue
        return { peak, nextAt: candidate, remainingMs: candidate - now }
      }
      // Unreachable for a valid instant; keep the chip honest rather than blank.
      return { peak, nextAt: now, remainingMs: 0 }
    }

    /**
     * Format a positive duration for the chip label and tooltip.
     * @param ms - remaining milliseconds.
     * @param t - namespace translate function.
     * @returns a short duration: `45分`, `1時間23分`, `2日3時間`.
     */
    function formatRemaining(ms, t) {
      const totalMinutes = Math.max(0, Math.ceil(ms / 60_000))
      const days = Math.floor(totalMinutes / (60 * 24))
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
      const minutes = totalMinutes % 60
      if (days > 0) return t('duration.days', { days: String(days), hours: String(hours) })
      if (hours > 0) return t('duration.hours', { hours: String(hours), minutes: String(minutes) })
      return t('duration.minutes', { minutes: String(minutes) })
    }

    /** Local wall-clock time of a UTC instant, for the tooltip. */
    function localClock(at) {
      try {
        return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return new Date(at).toISOString().slice(11, 16)
      }
    }

    /** Clock glyph: a dial with the current half filled. */
    function ClockIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M8 8 V4.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('path', { d: 'M8 8 L10.7 9.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    /** Peak or off-peak for DeepSeek-V4.1-Flash on Ollama Cloud, on the stats row. */
    function PeakChip(props) {
      const { t } = props
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
        return () => { clearInterval(timer) }
      }, [])
      const state = peakState(now)
      const remaining = formatRemaining(state.remainingMs, t)
      const label = t(state.peak ? 'peak.label' : 'offPeak.label', { remaining })
      const title = [
        t('peak.title', { model: MODEL }),
        `${t('peak.now')}: ${t(state.peak ? 'peak.state.peak' : 'peak.state.offPeak')}`,
        `${t('peak.window')}: ${t('peak.windowValue')}`,
        `${t('peak.next')}: ${t(state.peak ? 'peak.nextToOffPeak' : 'peak.nextToPeak')} — ${t('peak.remaining', { remaining })}`
          + ` (${t('peak.localClock', { time: localClock(state.nextAt) })})`,
      ].join('\n')
      return h('span', {
        className: 'dp-chip',
        'data-tone': state.peak ? 'peak' : 'offPeak',
        'data-deepseek-peak': state.peak ? 'peak' : 'off-peak',
        title,
      }, h(ClockIcon), h('span', { className: 'dp-label' }, label))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = '@local/deepseek-peak'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'deepseek-peak: chip styles')

        ctx.effect(() => ctx.locale.register(NS, { ja, en }), 'deepseek-peak: dictionaries')

        ctx.slots.inject('conversation.composer.stats.lead', () => ctx.slots.register({
          name: 'conversation.composer.stats.lead',
          id: 'deepseek-peak',
          order: 40,
          locale: NS,
        }, PeakChip))
      },
    }
  },
})
