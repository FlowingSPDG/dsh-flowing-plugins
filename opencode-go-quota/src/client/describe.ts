/**
 * Wire snapshot → display content, without React.
 *
 * The three describe functions fold one Host answer into exactly what the chip
 * and the panel render: a headline, a compact label, rows, notes, and a tone.
 * Their return values are typed, so a `data-tone` attribute can only receive
 * one of the four states the stylesheet knows about.
 *
 * @module @local/opencode-go-quota/client/describe
 */

import { clockTime, formatTokens, num, resetTime, usdCost } from './format.ts'
import type {
  FreeHistoryEntry,
  FreeModelWire,
  FreeSnapshot,
  SessionSnapshot,
  UsageSnapshot,
  UsageSummary,
  WatchedModel,
} from '../wire.ts'

/** The four states the chip's `data-tone` attribute distinguishes. */
export type Tone = 'ok' | 'warn' | 'error' | 'muted'

/** A translate function over this bundle's dictionary keys. */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string

/** One definition-list row: a label and its value, or a full-width note. */
export type NoteRow = readonly [text: string, value: string | null]

/** `describeUsage` output. */
export interface UsageView {
  /** Compact chip label. */
  label: string
  /** Panel title. */
  headline: string
  /** Chip tone; `error` at a spent window or a failed read, `warn` near a limit. */
  tone: Tone
  /** The three usage windows, in display order. */
  windows: WindowView[]
  /** Panel rows, in display order. */
  notes: NoteRow[]
}

/** One usage window rendered by the panel. */
export interface WindowView {
  key: string
  label: string
  percent: number
  /** Preformatted reset time, or null when unknown. */
  resetsAt: string | null
}

/** `describeSession` output. */
export interface SessionView {
  /** Rendered state; `unavailable` when no Session is selected. */
  state: string
  rows: NoteRow[]
  notes: string[]
  tone: Tone
}

/** `describeFree` output. */
export interface FreeView {
  /** Rendered state: `loading`, `error`, `empty`, or `ok`. */
  state: string
  models: FreeModelWire[]
  watched: WatchedModel[]
  history: FreeHistoryEntry[]
  /** Ids that arrived since the last acknowledged look. */
  newIds: ReadonlySet<string>
  notes: string[]
  tone: Tone
}

/**
 * Tone of one usage percentage: error at 100, warn from 80, muted when unknown.
 * @param percent - consumed percentage.
 * @returns the tone literal.
 */
export function toneOf(percent: number): Tone {
  if (!Number.isFinite(percent)) return 'muted'
  if (percent >= 100) return 'error'
  if (percent >= 80) return 'warn'
  return 'ok'
}

/**
 * Fold one wire usage snapshot into the chip's label, tone, and panel content.
 * @param snapshot - the Host half's usage answer.
 * @param t - namespace translate function.
 * @returns display parts: headline, chip label, windows, notes, tone.
 */
export function describeUsage(snapshot: UsageSnapshot | null, t: TranslateFn): UsageView {
  if (snapshot === null) {
    return {
      label: t('usage.loading'),
      headline: t('usage.title'),
      tone: 'muted',
      windows: [],
      notes: [],
    }
  }
  const usage = snapshot.usage
  const error = snapshot.error
  const updated = typeof snapshot.fetchedAt === 'number' ? clockTime(snapshot.fetchedAt) : '—'
  const failureNote =
    error !== null && typeof error.message === 'string' ? error.message : null

  if (snapshot.state === 'unconfigured') {
    return {
      label: t('usage.unconfigured'),
      headline: t('usage.titleUnconfigured'),
      tone: 'muted',
      windows: [],
      notes: [[t('usage.envNote', { env: String(snapshot.apiKeyEnv) }), null]],
    }
  }

  if (usage === null || usage.windows.length === 0) {
    return {
      label: t('usage.error'),
      headline: t('usage.titleError'),
      tone: 'error',
      windows: [],
      // A failure is one full-width note, not a label/value row.
      notes: failureNote === null ? [] : [[failureNote, null]],
    }
  }

  const byKey = new Map(usage.windows.map((window) => [window.key, window]))
  const rolling = num(byKey.get('rolling')?.percent)
  const weekly = num(byKey.get('weekly')?.percent)
  const monthly = num(byKey.get('monthly')?.percent)
  const windows: WindowView[] = usage.windows.map((window) => ({
    key: window.key,
    label: t(`usage.${window.key}`),
    percent: num(window.percent),
    resetsAt: resetTime(window.resetsAt),
  }))
  const worst = Math.max(...windows.map((window) => window.percent))
  const notes: NoteRow[] = [[t('usage.updated'), updated]]
  if (snapshot.stale && failureNote !== null) notes.push([failureNote, null])
  return {
    label: t('usage.label', {
      rolling: String(Math.round(rolling)),
      weekly: String(Math.round(weekly)),
      monthly: String(Math.round(monthly)),
    }),
    headline: t('usage.title'),
    tone: snapshot.stale ? 'warn' : toneOf(worst),
    windows,
    notes,
  }
}

/** The Session figures the panel reads; a subtree answer carries the extras. */
type SessionFigures = UsageSummary & {
  subagentSessions?: number
  missingSessions?: number
}

/**
 * Fold the Host's attributed Session usage into panel rows.
 *
 * The direct figures cover this Session's own log, including records written
 * before a context compaction; the subtree figures add live subagent Sessions.
 * Other providers are listed separately and never folded into the Go estimate.
 * A model tagged `free` costs nothing against the allowance, and a model tagged
 * `peak` had a published time multiplier applied.
 *
 * @param snapshot - the Host half's session answer.
 * @param t - namespace translate function.
 * @returns state, rows, notes, and tone.
 */
export function describeSession(snapshot: SessionSnapshot | null, t: TranslateFn): SessionView {
  if (snapshot === null) {
    return { state: 'loading', rows: [], notes: [t('session.loading')], tone: 'muted' }
  }
  if (snapshot.state === 'missing') {
    return { state: 'missing', rows: [], notes: [t('session.missing')], tone: 'muted' }
  }
  const direct = snapshot.direct
  if (snapshot.state !== 'ok' || direct === undefined) {
    return { state: 'error', rows: [], notes: [t('session.error')], tone: 'error' }
  }

  const subtree: SessionFigures = snapshot.subtree ?? direct
  const used = num(direct.requests) + num(direct.compactionRequests)
  const otherCalls = num(subtree.otherRequests) + num(subtree.otherCompactionRequests)
  const titleCalls = num(subtree.titleRequests)
  if (used === 0 && otherCalls === 0 && titleCalls === 0) {
    return { state: 'empty', rows: [], notes: [t('session.empty')], tone: 'muted' }
  }

  const rows: NoteRow[] = []
  const spend =
    used > 0 && typeof direct.estimatedUsd === 'number' ? `~${usdCost(direct.estimatedUsd)}` : '—'
  rows.push([t('session.spend'), spend])
  rows.push([
    t('session.requests'),
    num(direct.compactionRequests) > 0
      ? t('session.requestsWithCompaction', {
          requests: String(num(direct.requests)),
          compaction: String(num(direct.compactionRequests)),
        })
      : String(num(direct.requests)),
  ])
  rows.push([
    t('session.tokens'),
    t('session.tokenSplit', {
      input: formatTokens(direct.inputTokens),
      output: formatTokens(direct.outputTokens),
    }),
  ])
  const cached = num(direct.cacheReadTokens) + num(direct.cacheWriteTokens)
  if (cached > 0) rows.push([t('session.cache'), formatTokens(cached)])

  const models = direct.models.filter((model) => model.model !== 'unknown')
  if (models.length > 0) {
    const shown = models.slice(0, 3).map((model) => {
      const tags: string[] = []
      if (model.peak) tags.push(t('session.peak'))
      if (model.free) tags.push(t('session.free'))
      return tags.length > 0 ? `${model.model} (${tags.join('·')})` : model.model
    })
    const suffix = models.length > shown.length ? ` +${String(models.length - shown.length)}` : ''
    rows.push([t('session.models'), `${shown.join(', ')}${suffix}`])
  }

  if (num(subtree.subagentSessions) > 0) {
    rows.push([
      t('session.subtree'),
      t('session.subtreeValue', {
        sessions: String(num(subtree.subagentSessions)),
        spend: typeof subtree.estimatedUsd === 'number' ? `~${usdCost(subtree.estimatedUsd)}` : '—',
      }),
    ])
  }
  if (otherCalls > 0) {
    rows.push([
      t('session.other'),
      t('session.otherValue', {
        requests: String(otherCalls),
        tokens: formatTokens(subtree.otherTokens),
      }),
    ])
  }
  if (Number.isFinite(snapshot.generatedAt)) {
    rows.push([t('session.updated'), clockTime(snapshot.generatedAt)])
  }

  const notes: string[] = [t('session.note')]
  if (snapshot.stale === true) {
    notes.unshift(t('session.stale', { time: clockTime(snapshot.generatedAt) }))
  }
  if (snapshot.forked === true || num(snapshot.inheritedEventCount) > 0) {
    notes.push(t('session.forkNote'))
  }
  if (num(subtree.unpricedRequests) > 0) notes.push(t('session.unpriced'))
  if (titleCalls > 0) notes.push(t('session.titleNote', { count: String(titleCalls) }))
  if (num(subtree.missingSessions) > 0) {
    notes.push(t('session.subagentMissing', { count: String(num(subtree.missingSessions)) }))
  }
  return { state: 'ok', rows, notes, tone: 'ok' }
}

/**
 * Fold the Host's free-model watch into panel content.
 * @param snapshot - the Host half's free answer.
 * @param t - namespace translate function.
 * @returns state, models, watched statuses, change history, and notes.
 */
export function describeFree(snapshot: FreeSnapshot | null, t: TranslateFn): FreeView {
  if (snapshot === null) {
    return {
      state: 'loading',
      models: [],
      watched: [],
      history: [],
      newIds: new Set(),
      notes: [t('free.loading')],
      tone: 'muted',
    }
  }
  if (snapshot.state === 'error') {
    return {
      state: 'error',
      models: snapshot.free,
      watched: snapshot.watched,
      history: snapshot.history,
      newIds: new Set(),
      notes: [
        t('free.error'),
        snapshot.error !== null && typeof snapshot.error.message === 'string'
          ? snapshot.error.message
          : null,
      ].filter((note): note is string => note !== null),
      tone: 'error',
    }
  }
  const models = snapshot.free
  const watched = snapshot.watched
  const history = snapshot.history
  const newIds = new Set(snapshot.newFree.map((model) => model.id))
  const notes: string[] = []
  if (newIds.size > 0) notes.push(t('free.newNote'))
  notes.push(t('free.note'))
  if (history.length > 0) notes.push(t('free.historyNote'))
  if (typeof snapshot.fetchedAt === 'number') {
    notes.push(`${t('free.checked')}: ${clockTime(snapshot.fetchedAt)}`)
  }
  return {
    state: models.length === 0 ? 'empty' : 'ok',
    models,
    watched,
    history,
    newIds,
    notes,
    tone: models.length === 0 ? 'muted' : 'ok',
  }
}
