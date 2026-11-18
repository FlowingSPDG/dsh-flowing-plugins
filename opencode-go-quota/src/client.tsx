/**
 * Browser half of the OpenCode Go quota chip.
 *
 * Renders one entry in the composer's dock, beside the context meter. It shows
 * the OpenCode Go usage windows (rolling 5-hour, weekly, monthly), read from
 * this package's Host half over its private Connection RPC channel (the API
 * key never reaches the browser). A click opens a card above the chip with the
 * three usage bars and their reset times, this Session's estimated Go spend,
 * and the limited-time free models the Host watcher currently sees — the
 * watched models' free windows are called out by name, new arrivals since the
 * last look are marked, and opening the panel acknowledges them.
 *
 * OpenCode Go's allowance carries no peak-time schedule, but the published
 * token prices of a few models (the DeepSeek rows and, from December 2026,
 * Gemini 4 Argon) carry time multipliers; the Session estimate applies them at
 * each record's timestamp. The only styles are this module's own stylesheet.
 *
 * @module @local/opencode-go-quota/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { UsageChip } from './client/chip.tsx'
import type { ReadFree, ReadSessionUsage, ReadUsage } from './client/hooks.ts'
import type { FreeSnapshot, SessionSnapshot, UsageSnapshot } from './wire.ts'

/** Locale namespace owned by this bundle. */
const NS = 'opencodeGoQuota'

/**
 * Exact routes this bundle's Host half answers, posted relative to the page so
 * a mount prefix keeps working. The carrier authenticates them with the page's
 * own session; the responses are JSON.
 */
const USAGE_ROUTE = 'api/opencode-go-quota/usage'
const SESSION_ROUTE = 'api/opencode-go-quota/session'
const FREE_ROUTE = 'api/opencode-go-quota/free'

/** A stalled Host read must not freeze the panel's refresh loop. */
const CLIENT_REQUEST_TIMEOUT_MS = 15_000

const ja = {
  'usage.loading': 'OpenCode 読み込み中',
  'usage.unconfigured': 'OpenCode 未設定',
  'usage.error': 'OpenCode 取得失敗',
  'usage.stale': 'OpenCode {label} (更新失敗)',
  'usage.label': '5h {rolling}% / 週 {weekly}% / 月 {monthly}%',
  'usage.title': 'OpenCode Go 使用量',
  'usage.titleUnconfigured': 'OpenCode Go の使用量は取得できません',
  'usage.titleError': 'OpenCode Go の使用量を取得できませんでした',
  'usage.envNote':
    'GoのAPIキーを {env} （資格情報ストアまたは環境変数）に設定すると表示されます。',
  'usage.rolling': '5時間ウィンドウ',
  'usage.weekly': '週次',
  'usage.monthly': '月次',
  'usage.resetAt': '{time} にリセット',
  'usage.updated': '取得時刻',
  'usage.retryAfter': '{seconds} 秒後に再試行してください。',
  'usage.exhausted':
    '制限に達しました。フリーモデルを使うか Extra Usage を確認してください。',
  'free.title': '期間限定フリーモデル',
  'free.checked': '確認時刻',
  'free.count': '{count} 件が無料',
  'free.badge': '無料',
  'free.new': '新',
  'free.newNote':
    '前回確認以降に追加されたフリーモデルがあります。この一覧を開くと「新」は解除されます。',
  'free.empty': '現在フリーモデルは見つかりません。',
  'free.error': 'フリーモデル一覧を取得できませんでした。',
  'free.note':
    'ホスト側で公開モデル一覧を定期監視しています。フリーモデルはGoの使用量を消費しません。',
  'free.nowFree': '現在無料',
  'free.nowPaid': '現在有料（入力 {price} /100万トークン）',
  'free.nowPaidUnknown': '現在有料（単価未掲載）',
  'free.historyTitle': '最近の変化',
  'free.added': '{name} が無料に',
  'free.removed': '{name} が無料でなくなりました',
  'free.historyNote':
    'フリーモデルの追加・終了はホストの監視で検知し、この履歴はホスト起動以降の分を記録します。',
  'free.loading': 'フリーモデルを読み込み中…',
  'session.title': 'このセッション',
  'session.loading': 'セッション消費を読み込み中…',
  'session.missing': 'このセッションの利用情報を取得できませんでした。',
  'session.unavailable': 'セッションが選択されていないため利用情報を表示できません。',
  'session.error': 'セッション消費を取得できませんでした。',
  'session.empty': 'このセッションではまだ OpenCode Go を利用していません。',
  'session.spend': '許容量消費（推定）',
  'session.requests': 'リクエスト',
  'session.requestsWithCompaction': '{requests} 回（圧縮 {compaction} 回）',
  'session.tokens': 'トークン',
  'session.tokenSplit': '入力 {input} / 出力 {output}',
  'session.cache': 'キャッシュ',
  'session.models': 'モデル',
  'session.subtree': '合計（サブエージェント込み）',
  'session.subtreeValue': '{sessions} 件 · {spend}',
  'session.other': '他LLM利用',
  'session.otherValue': '{requests} 回 · {tokens}',
  'session.note':
    'OpenCode Goの公表単価による推定です。時間帯倍率（DeepSeek系・Gemini 4 Argon）はレコード時刻で反映し、他LLMとタイトル生成は含みません。',
  'session.peak': '倍率適用',
  'session.free': '無料',
  'session.unpriced': '単価が不明なモデルの利用は推定に含まれていません。',
  'session.titleNote': 'タイトル生成 {count} 回はトークンがログに残らないため、推定に含まれません。',
  'session.subagentMissing': '未読込・終了済みのサブエージェント {count} 件は含まれていません。',
  'session.updated': '計測時刻',
  'session.stale': '更新に失敗しました（{time} 時点の値）',
  'session.forkNote': 'フォーク元から引き継いだ利用は含みません。',
}

const en = {
  'usage.loading': 'OpenCode loading',
  'usage.unconfigured': 'OpenCode not set up',
  'usage.error': 'OpenCode unavailable',
  'usage.stale': 'OpenCode {label} (refresh failed)',
  'usage.label': '5h {rolling}% / wk {weekly}% / mo {monthly}%',
  'usage.title': 'OpenCode Go usage',
  'usage.titleUnconfigured': 'OpenCode Go usage is unavailable',
  'usage.titleError': 'Could not read the OpenCode Go usage',
  'usage.envNote':
    'Set the Go API key as {env} in the credential store or the environment to show it here.',
  'usage.rolling': '5-hour window',
  'usage.weekly': 'Weekly',
  'usage.monthly': 'Monthly',
  'usage.resetAt': 'resets {time}',
  'usage.updated': 'Read at',
  'usage.retryAfter': 'Try again in {seconds} seconds.',
  'usage.exhausted': 'A limit is reached; use a free model or check Extra Usage.',
  'free.title': 'Limited-time free models',
  'free.checked': 'Checked at',
  'free.count': '{count} free',
  'free.badge': 'FREE',
  'free.new': 'NEW',
  'free.newNote':
    'Free models appeared since your last look; opening this list clears the markers.',
  'free.empty': 'No free models right now.',
  'free.error': 'Could not read the free-model list.',
  'free.note':
    'The Host half polls the public model list. Free models do not consume the Go allowance.',
  'free.nowFree': 'Free right now',
  'free.nowPaid': 'Paid ({price}/Mtok input)',
  'free.nowPaidUnknown': 'Paid (no published price)',
  'free.historyTitle': 'Recent changes',
  'free.added': '{name} became free',
  'free.removed': '{name} is no longer free',
  'free.historyNote':
    'The Host watch records free-model additions and removals; the history covers this host run.',
  'free.loading': 'Loading free models…',
  'session.title': 'This session',
  'session.loading': 'Loading session spend…',
  'session.missing': 'Could not read this session’s usage.',
  'session.unavailable': 'Select a session to see its usage.',
  'session.error': 'Could not read session spend.',
  'session.empty': 'This session has not used OpenCode Go yet.',
  'session.spend': 'Allowance used (est.)',
  'session.requests': 'Requests',
  'session.requestsWithCompaction': '{requests} ({compaction} compaction)',
  'session.tokens': 'Tokens',
  'session.tokenSplit': 'in {input} / out {output}',
  'session.cache': 'Cached',
  'session.models': 'Models',
  'session.subtree': 'Total (with subagents)',
  'session.subtreeValue': '{sessions} sessions · {spend}',
  'session.other': 'Other LLM use',
  'session.otherValue': '{requests} calls · {tokens}',
  'session.note':
    'Estimated from OpenCode Go’s published list prices, including time multipliers (DeepSeek rows, Gemini 4 Argon) at each record’s timestamp. Other LLMs and title generation are excluded.',
  'session.peak': 'multiplied',
  'session.free': 'free',
  'session.unpriced': 'Usage of models without a known list price is excluded from the estimate.',
  'session.titleNote':
    '{count} title-generation call(s) are excluded because their tokens are not logged.',
  'session.updated': 'Measured at',
  'session.stale': 'Refresh failed; showing the {time} reading.',
  'session.forkNote': 'Usage inherited from the fork source is excluded.',
  'session.subagentMissing':
    '{count} subagent session(s) were not loaded or have ended and are excluded.',
}

const CSS = `
.ogq-chip {
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
.ogq-chip svg { width: 14px; height: 14px; flex: none; }
@media (hover: hover) {
  .ogq-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.ogq-chip:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.ogq-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.ogq-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.ogq-chip[data-tone='muted'] { color: var(--dsw-alias-label-secondary); opacity: 0.75; }
.ogq-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ogq-free-badge {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-bg, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-warn-primary));
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}
.ogq-panel {
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
.ogq-panel-head { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.ogq-panel-head svg { width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-tertiary); }
.ogq-panel-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogq-panel-value { margin-left: auto; font-variant-numeric: tabular-nums; }
.ogq-window { margin: 8px 0 0; }
.ogq-window-head { display: flex; align-items: baseline; gap: 6px; }
.ogq-window-head span:first-child { color: var(--dsw-alias-label-secondary); }
.ogq-window-reset { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ogq-bar { height: 4px; margin: 4px 0 0; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.ogq-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.ogq-bar[data-tone='warn'] .ogq-bar-fill { background: var(--dsw-alias-state-warn-primary); }
.ogq-bar[data-tone='error'] .ogq-bar-fill { background: var(--dsw-alias-state-error-primary); }
.ogq-rows {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 4px 16px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.ogq-rows dt, .ogq-rows dd { min-width: 0; margin: 0; }
.ogq-rows dd { color: var(--dsw-alias-label-secondary); text-align: right; font-variant-numeric: tabular-nums; }
.ogq-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); }
.ogq-session, .ogq-free { margin-top: 12px; padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.ogq-session-head, .ogq-free-head { display: flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.ogq-rows-plain { margin-top: 6px; padding-top: 0; border-top: 0; }
.ogq-free-list { margin: 6px 0 0; padding: 0; list-style: none; }
.ogq-free-list li { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; min-width: 0; }
.ogq-free-id { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogq-free-tag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.ogq-free-tag[data-new='true'] { color: var(--dsw-alias-state-warn-primary); }
.ogq-watch-rows dd[data-free='true'] { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-warn-primary)); }
.ogq-history { margin-top: 8px; }
.ogq-history-head { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ogq-history-row .ogq-history-at { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.ogq-history-row[data-kind='removed'] .ogq-history-text { color: var(--dsw-alias-label-tertiary); }
`

/**
 * Abort when either the caller's signal aborts (chip unmounted) or the client
 * timeout elapses, whichever comes first.
 * @param signal - the poll's controller signal, when the caller passed one.
 * @returns the combined signal handed to `fetch`.
 */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS)
  if (signal === undefined) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  const controller = new AbortController()
  const abort = (): void => {
    controller.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  timeout.addEventListener('abort', abort, { once: true })
  return controller.signal
}

/** Required services: slot registration and the dictionary registry. */
export const inject = ['slots', 'locale'] as const

/**
 * Browser plugin body.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset['dshPlugin'] = '@local/opencode-go-quota'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'opencode-go-quota: chip styles')

  ctx.effect(() => {
    const disposeJa = ctx.locale.register(NS, 'ja', ja)
    const disposeEn = ctx.locale.register(NS, 'en', en)
    return () => {
      disposeJa()
      disposeEn()
    }
  }, 'opencode-go-quota: dictionaries')

  const t = ctx.locale.bind(NS)

  /**
   * Read this bundle's Host half. The routes sit below the page's
   * authenticated carrier, so the browser session cookie is the whole
   * credential and no secret reaches the browser.
   * @param force - bypass the Host cache.
   * @param signal - abort signal owned by the polling effect.
   * @returns the usage snapshot.
   */
  const readUsage: ReadUsage = async (force, signal) => {
    const url = force ? `${USAGE_ROUTE}?force=1` : USAGE_ROUTE
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: withTimeout(signal),
    })
    if (!response.ok) throw new Error(`usage route answered HTTP ${String(response.status)}`)
    const snapshot: unknown = await response.json()
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new Error('usage route answered no snapshot')
    }
    return snapshot as UsageSnapshot
  }

  /**
   * Read one Session's attributed usage from this bundle's Host half.
   * The route reads the durable log, so it also sees usage from before a
   * context compaction and from a model that is no longer selected.
   * @param sessionId - mounted Session identity.
   * @param signal - abort signal owned by the polling effect.
   * @returns the session usage snapshot.
   */
  const readSessionUsage: ReadSessionUsage = async (sessionId, signal) => {
    const url = `${SESSION_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: withTimeout(signal),
    })
    if (!response.ok) throw new Error(`session route answered HTTP ${String(response.status)}`)
    const snapshot: unknown = await response.json()
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new Error('session route answered no snapshot')
    }
    return snapshot as SessionSnapshot
  }

  /**
   * Read the free-model watch. `ack` folds the currently reported new models
   * into the Host's baseline.
   * @param force - refetch even inside the Host TTL.
   * @param ack - also clear the pending new-model list.
   * @param signal - abort signal owned by the polling effect.
   * @returns the free-model snapshot.
   */
  const readFree: ReadFree = async (force, ack, signal) => {
    const params = new URLSearchParams()
    if (force) params.set('force', '1')
    if (ack) params.set('ack', '1')
    const query = params.toString()
    const response = await fetch(query === '' ? FREE_ROUTE : `${FREE_ROUTE}?${query}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: withTimeout(signal),
    })
    if (!response.ok) throw new Error(`free route answered HTTP ${String(response.status)}`)
    const snapshot: unknown = await response.json()
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new Error('free route answered no snapshot')
    }
    return snapshot as FreeSnapshot
  }

  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'opencode-go-usage',
        order: 21,
        inject: () => ({ readUsage, readSessionUsage, readFree, t }),
      },
      UsageChip,
    ),
  )
}
