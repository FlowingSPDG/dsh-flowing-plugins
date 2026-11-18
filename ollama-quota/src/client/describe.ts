/**
 * Wire answer → the copy the chip and card render.
 *
 * Both describers take `unknown`: the snapshots arrive as JSON over the
 * authenticated carrier, and a malformed or older answer must still render a
 * phrase instead of throwing inside a slot component.
 *
 * @module @local/ollama-quota/client/describe
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

import type {} from './locale.ts'
import { clockTime, formatTokens, num, shortDate, usd, usdCost } from './format.ts'

/** Translate function of this bundle's namespace. */
export type QuotaTranslate = TranslateNS<'ollamaQuota'>

/** One `label → value` row of the card. */
export type DescribeRow = readonly [label: string, value: string]

/** Tone the chip and its credit bar paint themselves with. */
export type BalanceTone = 'ok' | 'warn' | 'error' | 'muted'

/** Everything the balance chip and card need. */
export interface BalanceView {
  label: string
  headline: string
  tone: BalanceTone
  rows: DescribeRow[]
  note: string | null
  /** Fill ratio of the credit bar, or null when the reading has no total. */
  bar: number | null
}

/** Lifecycle of the card's session block. */
export type SessionViewState = 'loading' | 'missing' | 'unavailable' | 'error' | 'empty' | 'ok'

/** The card's session block. */
export interface SessionView {
  state: SessionViewState
  rows: DescribeRow[]
  notes: string[]
}

/**
 * Narrow an untrusted value to a plain record.
 * @param value - candidate.
 * @returns the record, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/**
 * Coerce to a finite number, or undefined.
 * @param value - candidate.
 * @returns the number, or undefined.
 */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Fold one wire snapshot into the chip's label, tone, and card content.
 * @param snapshot - the Host half's balance answer.
 * @param t - namespace translate function.
 * @returns display parts: headline, chip label, rows, note, and bar ratio.
 */
export function describeBalance(snapshot: unknown, t: QuotaTranslate): BalanceView {
  const wire = asRecord(snapshot)
  if (wire === undefined || typeof wire['state'] !== 'string') {
    return { label: t('balance.loading'), headline: t('balance.title'), tone: 'muted', rows: [], note: null, bar: null }
  }
  const balance = wire['balance']
  const error = wire['error']
  const fetchedAt = typeof wire['fetchedAt'] === 'number' ? wire['fetchedAt'] : undefined
  const updated = fetchedAt === undefined ? '—' : clockTime(fetchedAt)
  const failure = asRecord(error)
  const failureNote = failure !== undefined && typeof failure['message'] === 'string' ? failure['message'] : null

  if (wire['state'] === 'unconfigured') {
    return {
      label: t('balance.unconfigured'),
      headline: t('balance.titleUnconfigured'),
      tone: 'muted',
      rows: [],
      note: t('balance.envNote', { env: String(wire['apiKeyEnv'] ?? 'OLLAMA_CLOUD_API_KEY') }),
      bar: null,
    }
  }

  const reading = asRecord(balance)
  if (reading === undefined) {
    return {
      label: t('balance.error'),
      headline: t('balance.titleError'),
      tone: 'error',
      rows: [],
      note: failureNote,
      bar: null,
    }
  }

  const purchased = usd(reading['purchasedUsd'])
  if (reading['kind'] === 'usd') {
    const remaining = usd(reading['includedRemainingUsd'])
    const allowance = usd(reading['includedAllowanceUsd'])
    const total = usd(num(reading['includedRemainingUsd']) + num(reading['purchasedUsd']))
    const rows: DescribeRow[] = [
      [t('balance.included'), `${remaining} / ${allowance}`],
      [t('balance.purchased'), purchased],
      [t('balance.total'), total],
    ]
    if (typeof reading['periodFrom'] === 'string' && typeof reading['periodUntil'] === 'string') {
      rows.push([t('balance.period'), `${shortDate(reading['periodFrom'])} – ${shortDate(reading['periodUntil'])}`])
    }
    rows.push([t('balance.updated'), updated])
    const allowanceValue = num(reading['includedAllowanceUsd'])
    const remainingValue = num(reading['includedRemainingUsd']) + num(reading['purchasedUsd'])
    const low = allowanceValue > 0 && remainingValue <= 0
    return {
      label: t('balance.label', { remaining, allowance }),
      headline: t('balance.title'),
      tone: wire['stale'] === true ? 'warn' : low ? 'warn' : 'ok',
      rows,
      note: failureNote,
      bar: allowanceValue > 0 ? Math.min(1, Math.max(0, remainingValue / allowanceValue)) : null,
    }
  }

  const sessionPercent = Math.round(num(reading['sessionRemainingPercent']))
  const weeklyPercent = Math.round(num(reading['weeklyRemainingPercent']))
  return {
    label: t('balance.percent', { session: String(sessionPercent), weekly: String(weeklyPercent) }),
    headline: t('balance.title'),
    tone: wire['stale'] === true ? 'warn' : Math.min(sessionPercent, weeklyPercent) <= 10 ? 'warn' : 'ok',
    rows: [
      [t('balance.session'), `${String(sessionPercent)}%`],
      [t('balance.weekly'), `${String(weeklyPercent)}%`],
      [t('balance.purchased'), purchased],
      [t('balance.updated'), updated],
    ],
    note: failureNote,
    bar: Math.min(1, Math.max(0, sessionPercent / 100)),
  }
}

/**
 * Fold the Host's attributed Session usage into card rows.
 *
 * The direct figures cover this Session's own log, including records written
 * before a context compaction; the subtree figures add live subagent
 * Sessions. Other providers are listed separately and never folded into the
 * Ollama spend.
 *
 * @param snapshot - the Host half's session answer, or null before the first read.
 * @param t - namespace translate function.
 * @returns state, rows, and explanatory notes.
 */
export function describeSession(snapshot: unknown, t: QuotaTranslate): SessionView {
  const wire = asRecord(snapshot)
  if (wire === undefined) {
    return { state: 'loading', rows: [], notes: [t('session.loading')] }
  }
  if (wire['state'] === 'missing') {
    return { state: 'missing', rows: [], notes: [t('session.missing')] }
  }
  const direct = asRecord(wire['direct'])
  if (wire['state'] !== 'ok' || direct === undefined) {
    return { state: 'error', rows: [], notes: [t('session.error')] }
  }

  const subtree = asRecord(wire['subtree']) ?? direct
  const used = num(direct['requests']) + num(direct['compactionRequests'])
  const otherCalls = num(subtree['otherRequests']) + num(subtree['otherCompactionRequests'])
  const titleCalls = num(subtree['titleRequests'])
  if (used === 0 && otherCalls === 0 && titleCalls === 0) {
    return { state: 'empty', rows: [], notes: [t('session.empty')] }
  }

  const rows: DescribeRow[] = []
  const spend = used > 0 && typeof direct['estimatedUsd'] === 'number'
    ? `~${usdCost(direct['estimatedUsd'])}`
    : '—'
  rows.push([t('session.spend'), spend])
  rows.push([
    t('session.requests'),
    num(direct['compactionRequests']) > 0
      ? t('session.requestsWithCompaction', {
        requests: String(num(direct['requests'])),
        compaction: String(num(direct['compactionRequests'])),
      })
      : String(num(direct['requests'])),
  ])
  rows.push([
    t('session.tokens'),
    t('session.tokenSplit', {
      input: formatTokens(direct['inputTokens']),
      output: formatTokens(direct['outputTokens']),
    }),
  ])
  const cached = num(direct['cacheReadTokens']) + num(direct['cacheWriteTokens'])
  if (cached > 0) rows.push([t('session.cache'), formatTokens(cached)])

  const models = Array.isArray(direct['models'])
    ? [...new Set(direct['models'].flatMap((model) => {
      const entry = asRecord(model)
      const name = entry?.['model']
      return typeof name === 'string' && name !== 'unknown' ? [name] : []
    }))]
    : []
  if (models.length > 0) {
    const shown = models.slice(0, 3)
    const suffix = models.length > shown.length ? ` +${String(models.length - shown.length)}` : ''
    rows.push([t('session.models'), `${shown.join(', ')}${suffix}`])
  }

  if (num(subtree['subagentSessions']) > 0) {
    rows.push([
      t('session.subtree'),
      t('session.subtreeValue', {
        sessions: String(num(subtree['subagentSessions'])),
        spend: typeof subtree['estimatedUsd'] === 'number' ? `~${usdCost(subtree['estimatedUsd'])}` : '—',
      }),
    ])
  }
  if (otherCalls > 0) {
    rows.push([
      t('session.other'),
      t('session.otherValue', {
        requests: String(otherCalls),
        tokens: formatTokens(subtree['otherTokens']),
      }),
    ])
  }
  const generatedAt = finite(wire['generatedAt'])
  if (generatedAt !== undefined) {
    rows.push([t('session.updated'), clockTime(generatedAt)])
  }

  const notes = [t('session.note')]
  if (wire['stale'] === true) {
    const at = generatedAt === undefined ? '—' : clockTime(generatedAt)
    notes.unshift(t('session.stale', { time: at }))
  }
  if (wire['forked'] === true || num(wire['inheritedEventCount']) > 0) {
    notes.push(t('session.forkNote'))
  }
  if (num(subtree['unpricedRequests']) > 0) notes.push(t('session.unpriced'))
  if (titleCalls > 0) notes.push(t('session.titleNote', { count: String(titleCalls) }))
  if (num(subtree['missingSessions']) > 0) {
    notes.push(t('session.subagentMissing', { count: String(num(subtree['missingSessions'])) }))
  }
  return { state: 'ok', rows, notes }
}
