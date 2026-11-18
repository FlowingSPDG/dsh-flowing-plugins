/**
 * Browser half of the OpenCode Go quota chip.
 *
 * Renders one entry in the composer's dock, beside the context meter. It shows
 * the OpenCode Go usage windows (rolling 5-hour, weekly, monthly), read from
 * this package's Host half over its private Connection RPC channel (the API
 * key never reaches the browser). A click opens a card above the chip with the
 * three usage bars and their reset times, this Session's estimated Go spend,
 * and the limited-time free models the Host watcher currently sees — new ones
 * since the last look are marked, and opening the panel acknowledges them.
 *
 * OpenCode Go's allowance carries no peak-time schedule, but the published
 * token prices of a few models (the DeepSeek rows and, from December 2026,
 * Gemini 4 Argon) carry time multipliers; the Session estimate applies them at
 * each record's timestamp. The only styles are this module's own stylesheet.
 *
 * @module @local/opencode-go-quota/client
 */

window.__ModuleLoader__.load({
  id: '@local/opencode-go-quota',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'opencodeGoQuota'

    /**
     * Exact routes this bundle's Host half answers, posted relative to the page
     * so a mount prefix keeps working. The carrier authenticates them with the
     * page's own session; the responses are JSON.
     */
    const USAGE_ROUTE = 'api/opencode-go-quota/usage'
    const SESSION_ROUTE = 'api/opencode-go-quota/session'
    const FREE_ROUTE = 'api/opencode-go-quota/free'

    /** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
    const POLL_MS = 60_000

    /** How often a mounted chip re-checks the free-model watcher. */
    const FREE_POLL_MS = 300_000

    /** How often an open panel re-reads the Session while the agent is working. */
    const SESSION_POLL_MS = 10_000

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
      'usage.envNote': 'GoのAPIキーを環境変数 {env} に設定すると表示されます。',
      'usage.rolling': '5時間ウィンドウ',
      'usage.weekly': '週次',
      'usage.monthly': '月次',
      'usage.resetAt': '{time} にリセット',
      'usage.updated': '取得時刻',
      'usage.retryAfter': '{seconds} 秒後に再試行してください。',
      'usage.exhausted': '制限に達しました。フリーモデルを使うか Extra Usage を確認してください。',
      'free.title': '期間限定フリーモデル',
      'free.checked': '確認時刻',
      'free.count': '{count} 件が無料',
      'free.new': '新',
      'free.newNote': '前回確認以降に追加されたフリーモデルがあります。この一覧を開くと「新」は解除されます。',
      'free.empty': '現在フリーモデルは見つかりません。',
      'free.error': 'フリーモデル一覧を取得できませんでした。',
      'free.note': 'ホスト側で公開モデル一覧を定期監視しています。フリーモデルはGoの使用量を消費しません。',
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
      'session.note': 'OpenCode Goの公表単価による推定です。時間帯倍率（DeepSeek系・Gemini 4 Argon）はレコード時刻で反映し、他LLMとタイトル生成は含みません。',
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
      'usage.envNote': 'Set the Go API key in the {env} environment variable to show it here.',
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
      'free.new': 'NEW',
      'free.newNote': 'Free models appeared since your last look; opening this list clears the markers.',
      'free.empty': 'No free models right now.',
      'free.error': 'Could not read the free-model list.',
      'free.note': 'The Host half polls the public model list. Free models do not consume the Go allowance.',
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
      'session.note': 'Estimated from OpenCode Go’s published list prices, including time multipliers (DeepSeek rows, Gemini 4 Argon) at each record’s timestamp. Other LLMs and title generation are excluded.',
      'session.peak': 'multiplied',
      'session.free': 'free',
      'session.unpriced': 'Usage of models without a known list price is excluded from the estimate.',
      'session.titleNote': '{count} title-generation call(s) are excluded because their tokens are not logged.',
      'session.updated': 'Measured at',
      'session.stale': 'Refresh failed; showing the {time} reading.',
      'session.forkNote': 'Usage inherited from the fork source is excluded.',
      'session.subagentMissing': '{count} subagent session(s) were not loaded or have ended and are excluded.',
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
`

    /** Coerce to a finite number, or 0. */
    function num(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /** USD with enough precision for a single session: cents above one dollar,
      * four decimals for smaller amounts so a short chat does not read $0.00. */
    function usdCost(value) {
      const amount = num(value)
      const digits = amount >= 1 ? 2 : 4
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(amount)
      } catch {
        return `$${amount.toFixed(digits)}`
      }
    }

    /** Token count in compact notation, with a plain fallback. */
    function formatTokens(value) {
      const amount = num(value)
      try {
        return new Intl.NumberFormat(undefined, {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(amount)
      } catch {
        if (amount < 1_000) return String(Math.round(amount))
        if (amount < 1_000_000) return `${(amount / 1_000).toFixed(amount < 10_000 ? 1 : 0)}K`
        return `${(amount / 1_000_000).toFixed(1)}M`
      }
    }

    /** Local clock time for an epoch millisecond reading. */
    function clockTime(at) {
      try {
        return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return new Date(at).toISOString().slice(11, 16)
      }
    }

    /** Short local time for a documented ISO reset timestamp, or the raw text. */
    function resetTime(iso) {
      if (typeof iso !== 'string') return null
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return null
      try {
        return new Date(at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      } catch {
        return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
      }
    }

    /** Fill a `{placeholder}` template from a plain object. */
    /** Tone of one usage percentage: error at 100, warn from 80. */
    function toneOf(percent) {
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
    function describeUsage(snapshot, t) {
      if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.state !== 'string') {
        return { label: t('usage.loading'), headline: t('usage.title'), tone: 'muted', windows: [], notes: [], bar: null }
      }
      const usage = snapshot.usage
      const error = snapshot.error
      const updated = typeof snapshot.fetchedAt === 'number' ? clockTime(snapshot.fetchedAt) : '—'
      const failureNote = error !== null && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : null

      if (snapshot.state === 'unconfigured') {
        return {
          label: t('usage.unconfigured'),
          headline: t('usage.titleUnconfigured'),
          tone: 'muted',
          windows: [],
          notes: [t('usage.envNote', { env: String(snapshot.apiKeyEnv ?? 'OPENCODE_API_KEY') })],
        }
      }

      if (usage === null || typeof usage !== 'object' || !Array.isArray(usage.windows) || usage.windows.length === 0) {
        return {
          label: t('usage.error'),
          headline: t('usage.titleError'),
          tone: 'error',
          windows: [],
          notes: [failureNote].filter(Boolean),
        }
      }

      const byKey = new Map(usage.windows.map(window => [window.key, window]))
      const rolling = num(byKey.get('rolling')?.percent)
      const weekly = num(byKey.get('weekly')?.percent)
      const monthly = num(byKey.get('monthly')?.percent)
      const windows = usage.windows.map(window => ({
        key: window.key,
        label: t(`usage.${window.key}`),
        percent: num(window.percent),
        resetsAt: resetTime(window.resetsAt),
      }))
      const worst = Math.max(...windows.map(window => window.percent))
      const notes = [[t('usage.updated'), updated]]
      if (snapshot.stale === true && failureNote !== null) notes.push([failureNote, null])
      return {
        label: t('usage.label', {
          rolling: String(Math.round(rolling)),
          weekly: String(Math.round(weekly)),
          monthly: String(Math.round(monthly)),
        }),
        headline: t('usage.title'),
        tone: snapshot.stale === true ? 'warn' : toneOf(worst),
        windows,
        notes,
        bar: Math.min(1, Math.max(0, worst / 100)),
      }
    }

    /**
     * Fold the Host's attributed Session usage into panel rows.
     *
     * The direct figures cover this Session's own log, including records written
     * before a context compaction; the subtree figures add live subagent
     * Sessions. Other providers are listed separately and never folded into the
     * Go estimate. A model tagged `free` costs nothing against the allowance,
     * and a model tagged `peak` had a published time multiplier applied.
     *
     * @param snapshot - the Host half's session answer.
     * @param t - namespace translate function.
     * @returns state, rows, and explanatory notes.
     */
    function describeSession(snapshot, t) {
      if (snapshot === null) {
        return { state: 'loading', rows: [], notes: [t('session.loading')] }
      }
      if (snapshot.state === 'missing') {
        return { state: 'missing', rows: [], notes: [t('session.missing')] }
      }
      if (snapshot.state !== 'ok' || snapshot.direct === null || typeof snapshot.direct !== 'object') {
        return { state: 'error', rows: [], notes: [t('session.error')] }
      }

      const direct = snapshot.direct
      const subtree = snapshot.subtree !== null && typeof snapshot.subtree === 'object'
        ? snapshot.subtree
        : direct
      const used = num(direct.requests) + num(direct.compactionRequests)
      const otherCalls = num(subtree.otherRequests) + num(subtree.otherCompactionRequests)
      const titleCalls = num(subtree.titleRequests)
      if (used === 0 && otherCalls === 0 && titleCalls === 0) {
        return { state: 'empty', rows: [], notes: [t('session.empty')] }
      }

      const rows = []
      const spend = used > 0 && typeof direct.estimatedUsd === 'number'
        ? `~${usdCost(direct.estimatedUsd)}`
        : '—'
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

      const models = Array.isArray(direct.models)
        ? direct.models.filter(model => model?.model !== undefined && model.model !== 'unknown')
        : []
      if (models.length > 0) {
        const shown = models.slice(0, 3).map(model => {
          const tags = []
          if (model.peak === true) tags.push(t('session.peak'))
          if (model.free === true) tags.push(t('session.free'))
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

      const notes = [t('session.note')]
      if (snapshot.stale === true) {
        const at = Number.isFinite(snapshot.generatedAt) ? clockTime(snapshot.generatedAt) : '—'
        notes.unshift(t('session.stale', { time: at }))
      }
      if (snapshot.forked === true || num(snapshot.inheritedEventCount) > 0) {
        notes.push(t('session.forkNote'))
      }
      if (num(subtree.unpricedRequests) > 0) notes.push(t('session.unpriced'))
      if (titleCalls > 0) notes.push(t('session.titleNote', { count: String(titleCalls) }))
      if (num(subtree.missingSessions) > 0) {
        notes.push(t('session.subagentMissing', { count: String(num(subtree.missingSessions)) }))
      }
      return { state: 'ok', rows, notes }
    }

    /**
     * Fold the Host's free-model watch into panel content.
     * @param snapshot - the Host half's free answer.
     * @param t - namespace translate function.
     * @returns state, models, and notes.
     */
    function describeFree(snapshot, t) {
      if (snapshot === null || typeof snapshot !== 'object') {
        return { state: 'loading', models: [], newIds: [], notes: [t('free.loading')] }
      }
      if (snapshot.state === 'error') {
        return {
          state: 'error',
          models: Array.isArray(snapshot.free) ? snapshot.free : [],
          newIds: [],
          notes: [
            t('free.error'),
            snapshot.error !== null && typeof snapshot.error === 'object' && typeof snapshot.error.message === 'string'
              ? snapshot.error.message
              : null,
          ].filter(Boolean),
        }
      }
      const models = Array.isArray(snapshot.free) ? snapshot.free : []
      const newIds = new Set(Array.isArray(snapshot.newFree) ? snapshot.newFree.map(model => model?.id) : [])
      const notes = []
      if (newIds.size > 0) notes.push(t('free.newNote'))
      notes.push(t('free.note'))
      if (typeof snapshot.fetchedAt === 'number') notes.push(`${t('free.checked')}: ${clockTime(snapshot.fetchedAt)}`)
      return { state: models.length === 0 ? 'empty' : 'ok', models, newIds, notes }
    }

    /** A gauge glyph, drawn from the current text color. */
    function GaugeIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: 'M8 4.4 V8 L10.8 9.8',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /**
     * Ask the Host half for the usage, retrying once per poll interval so a
     * transient failure heals without a page reload.
     * @param readUsage - injected reader.
     * @returns the current snapshot.
     */
    function useUsage(readUsage) {
      const [snapshot, setSnapshot] = React.useState(null)
      React.useEffect(() => {
        let cancelled = false
        let timer = null
        const poll = () => {
          Promise.resolve()
            .then(() => readUsage(false))
            .then((next) => { if (!cancelled) setSnapshot(next) })
            .catch((error) => {
              if (cancelled) return
              setSnapshot({
                state: 'error',
                usage: null,
                fetchedAt: null,
                error: { message: String(error && error.message ? error.message : error) },
              })
            })
            .then(() => {
              if (!cancelled) timer = setTimeout(poll, POLL_MS)
            })
        }
        poll()
        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
        }
      }, [readUsage])
      return snapshot
    }

    /**
     * Ask the Host half for the free-model watch on its own, slower cadence.
     * @param readFree - injected reader.
     * @returns the current snapshot.
     */
    function useFreeModels(readFree) {
      const [snapshot, setSnapshot] = React.useState(null)
      React.useEffect(() => {
        let cancelled = false
        let timer = null
        const poll = () => {
          Promise.resolve()
            .then(() => readFree(false))
            .then((next) => { if (!cancelled) setSnapshot(next) })
            .catch((error) => {
              if (cancelled) return
              setSnapshot({ state: 'error', free: [], newFree: [], error: { message: String(error && error.message ? error.message : error) } })
            })
            .then(() => {
              if (!cancelled) timer = setTimeout(poll, FREE_POLL_MS)
            })
        }
        poll()
        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
        }
      }, [readFree])
      return snapshot
    }

    /**
     * Read the current Session's attributed usage while the panel is open.
     * Polling covers live turns, tool logs, model switches, and compaction
     * without making the panel depend on any one transcript event.
     * @param readUsage - injected host reader.
     * @param sessionId - the mounted Session identity.
     * @param active - whether the panel is open.
     * @returns the latest host snapshot, or null before the first read.
     */
    function useSessionUsage(readUsage, sessionId, active) {
      const [snapshot, setSnapshot] = React.useState(null)
      React.useEffect(() => {
        if (!active || typeof readUsage !== 'function' || typeof sessionId !== 'string' || sessionId === '') {
          setSnapshot(null)
          return
        }
        let cancelled = false
        let timer = null
        const poll = () => {
          Promise.resolve()
            .then(() => readUsage(sessionId))
            .then((next) => { if (!cancelled) setSnapshot(next) })
            .catch((error) => {
              if (cancelled) return
              const message = String(error && error.message ? error.message : error)
              setSnapshot(previous => previous !== null && previous.state === 'ok'
                ? { ...previous, stale: true }
                : { state: 'error', direct: null, error: { message } })
            })
            .then(() => {
              if (!cancelled) timer = setTimeout(poll, SESSION_POLL_MS)
            })
        }
        poll()
        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
        }
      }, [active, readUsage, sessionId])
      return snapshot
    }

    /**
     * The chip's open state plus its placement. The panel anchors above the chip
     * and closes on Escape or an outside press. It deliberately does not close
     * on scroll: agent replies and tool logs scroll the transcript while the
     * user is reading the panel, and that must not dismiss it.
     */
    function usePanel() {
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const [open, setOpen] = React.useState(false)
      const [placement, setPlacement] = React.useState(null)

      /** Re-anchor the fixed panel above the chip after a layout change. */
      const measure = React.useCallback(() => {
        const rect = anchorRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        const width = Math.min(320, window.innerWidth - 24)
        const centered = rect.left + rect.width / 2 - width / 2
        const left = Math.min(Math.max(12, centered), Math.max(12, window.innerWidth - width - 12))
        setPlacement({
          left,
          width,
          bottom: window.innerHeight - rect.top + 8,
          maxHeight: Math.max(160, rect.top - 20),
        })
      }, [])

      const toggle = React.useCallback(() => {
        setOpen(wasOpen => !wasOpen)
      }, [])

      React.useEffect(() => {
        if (!open) return
        measure()
        const onPointer = (event) => {
          if (panelRef.current?.contains(event.target)) return
          if (anchorRef.current?.contains(event.target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          // Consume the key before DSH's shortcut dispatcher can arm Esc-Esc
          // "stop turn"; closing the panel is the whole intended action.
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        const onLayout = () => { measure() }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('resize', onLayout)
        window.visualViewport?.addEventListener('resize', onLayout)
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayout) : null
        const anchor = anchorRef.current
        if (observer !== null && anchor !== null) {
          const observed = new Set([
            anchor,
            anchor.parentElement,
            anchor.closest('[data-composer-card]'),
            anchor.closest('[data-composer-dock]'),
          ])
          for (const element of observed) {
            if (element !== null) observer.observe(element)
          }
        }
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('resize', onLayout)
          window.visualViewport?.removeEventListener('resize', onLayout)
          observer?.disconnect()
        }
      }, [measure, open])

      // Re-opening must never flash the previous anchor position.
      React.useEffect(() => {
        if (!open) setPlacement(null)
      }, [open])

      return { open, placement, toggle, anchorRef, panelRef }
    }

    /** The panel's session block: attributed spend, tokens, and scope notes. */
    function SessionSection({ view, t }) {
      return h('section', { className: 'ogq-session', 'data-opencode-session': view.state },
        h('div', { className: 'ogq-session-head' },
          h('span', { className: 'ogq-panel-title' }, t('session.title'))),
        view.rows.length > 0 ? h('dl', { className: 'ogq-rows ogq-rows-plain' },
          view.rows.flatMap((row, index) => [
            h('dt', { key: `session-label-${String(index)}` }, row[0]),
            h('dd', { key: `session-value-${String(index)}` }, row[1]),
          ])) : null,
        view.notes.map((note, index) => h('p', {
          key: `session-note-${String(index)}`,
          className: 'ogq-note',
        }, note)),
      )
    }

    /** The panel's free-model block: the watched list with NEW markers. */
    function FreeSection({ view, t }) {
      return h('section', { className: 'ogq-free', 'data-opencode-free': view.state },
        h('div', { className: 'ogq-free-head' },
          h('span', { className: 'ogq-panel-title' }, t('free.title')),
          h('span', { className: 'ogq-panel-value' },
            t('free.count', { count: String(view.models.length) }))),
        view.state === 'empty' ? h('p', { className: 'ogq-note' }, t('free.empty')) : null,
        view.models.length > 0 ? h('ul', { className: 'ogq-free-list' },
          view.models.map((model, index) => h('li', { key: model.id ?? String(index) },
            h('span', { className: 'ogq-free-id' }, model.name ?? model.id),
            view.newIds.has(model.id) ? h('span', { className: 'ogq-free-tag', 'data-new': 'true' }, t('free.new')) : null,
            model.limitedRegions === true ? h('span', { className: 'ogq-free-tag' }, 'geo') : null,
            model.training === true ? h('span', { className: 'ogq-free-tag' }, 'training') : null,
          ))) : null,
        view.notes.map((note, index) => h('p', {
          key: `free-note-${String(index)}`,
          className: 'ogq-note',
        }, note)),
      )
    }

    /** Go usage windows, ambient on the composer's stats row. */
    function UsageChip(props) {
      const { t, readUsage, readSessionUsage, readFree, sessionId } = props
      const snapshot = useUsage(readUsage)
      const free = useFreeModels(readFree)
      const view = describeUsage(snapshot, t)
      const freeView = describeFree(free, t)
      const ackKey = Array.isArray(free?.newFree)
        ? free.newFree.map(model => model?.id).filter(id => typeof id === 'string').sort().join(',')
        : ''
      const panel = usePanel()
      const session = useSessionUsage(readSessionUsage, sessionId, panel.open)
      const sessionView = typeof sessionId === 'string' && sessionId !== ''
        ? describeSession(session, t)
        : { state: 'unavailable', rows: [], notes: [t('session.unavailable')] }

      // Opening the panel acknowledges the currently reported new free models.
      React.useEffect(() => {
        if (!panel.open) return
        if (ackKey === '') return
        Promise.resolve()
          .then(() => readFree(true, true))
          .catch(() => {})
      }, [panel.open, ackKey, readFree])

      const worstTone = view.tone
      const showFreeBadge = freeView.newIds.size > 0
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          ref: panel.anchorRef,
          className: 'ogq-chip',
          'data-tone': worstTone,
          'data-opencode-usage': worstTone,
          'aria-haspopup': 'dialog',
          'aria-expanded': panel.open,
          onClick: panel.toggle,
        }, h(GaugeIcon), h('span', { className: 'ogq-label' }, view.label),
        showFreeBadge ? h('span', { className: 'ogq-free-badge' }, `+${String(freeView.newIds.size)}`) : null),
        panel.open && panel.placement !== null ? createPortal(
          h('div', {
            ref: panel.panelRef,
            className: 'ogq-panel',
            role: 'dialog',
            'aria-label': view.headline,
            style: {
              left: `${String(panel.placement.left)}px`,
              bottom: `${String(panel.placement.bottom)}px`,
              width: `${String(panel.placement.width)}px`,
              maxHeight: `${String(panel.placement.maxHeight)}px`,
            },
          },
            h('div', { className: 'ogq-panel-head' },
              h(GaugeIcon),
              h('span', { className: 'ogq-panel-title' }, view.headline),
              h('span', { className: 'ogq-panel-value' }, view.label)),
            view.windows.map((window) => h('div', { key: window.key, className: 'ogq-window' },
              h('div', { className: 'ogq-window-head' },
                h('span', null, window.label),
                h('span', { className: 'ogq-window-reset' },
                  window.resetsAt !== null ? t('usage.resetAt', { time: window.resetsAt }) : null),
                h('span', null, `${String(Math.round(window.percent))}%`)),
              h('div', { className: 'ogq-bar', 'data-tone': toneOf(window.percent) },
                h('div', { className: 'ogq-bar-fill', style: { width: `${String(Math.round(Math.min(100, Math.max(0, window.percent))))}%` } })),
            )),
            view.windows.some(window => window.percent >= 100)
              ? h('p', { className: 'ogq-note' }, t('usage.exhausted')) : null,
            h('dl', { className: 'ogq-rows' },
              view.notes.flatMap((row, index) => row[1] === null
                ? [h('dt', { key: `label-${String(index)}`, style: { gridColumn: '1 / -1' } }, row[0])]
                : [
                  h('dt', { key: `label-${String(index)}` }, row[0]),
                  h('dd', { key: `value-${String(index)}` }, row[1]),
                ])),
            h(SessionSection, { view: sessionView, t }),
            h(FreeSection, { view: freeView, t }),
          ),
          document.body,
        ) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = '@local/opencode-go-quota'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'opencode-go-quota: chip styles')

        ctx.effect(() => ctx.locale.register(NS, { ja, en }), 'opencode-go-quota: dictionaries')

        /**
         * Read this bundle's Host half. The routes sit below the page's
         * authenticated carrier, so the browser session cookie is the whole
         * credential and no secret reaches the browser.
         * @param force - bypass the Host cache.
         * @returns the usage snapshot.
         */
        const readUsage = async (force) => {
          const url = force === true ? `${USAGE_ROUTE}?force=1` : USAGE_ROUTE
          const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS),
          })
          if (!response.ok) throw new Error(`usage route answered HTTP ${String(response.status)}`)
          const snapshot = await response.json()
          if (snapshot === null || typeof snapshot !== 'object') throw new Error('usage route answered no snapshot')
          return snapshot
        }

        /**
         * Read one Session's attributed usage from this bundle's Host half.
         * The route reads the durable log, so it also sees usage from before a
         * context compaction and from a model that is no longer selected.
         * @param sessionId - mounted Session identity.
         * @returns the session usage snapshot.
         */
        const readSessionUsage = async (sessionId) => {
          const url = `${SESSION_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`
          const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS),
          })
          if (!response.ok) throw new Error(`session route answered HTTP ${String(response.status)}`)
          const snapshot = await response.json()
          if (snapshot === null || typeof snapshot !== 'object') throw new Error('session route answered no snapshot')
          return snapshot
        }

        /**
         * Read the free-model watch. `ack` folds the currently reported new
         * models into the Host's baseline.
         * @param force - refetch even inside the Host TTL.
         * @param ack - also clear the pending new-model list.
         * @returns the free-model snapshot.
         */
        const readFree = async (force = false, ack = false) => {
          const params = new URLSearchParams()
          if (force === true) params.set('force', '1')
          if (ack === true) params.set('ack', '1')
          const query = params.toString()
          const response = await fetch(query === '' ? FREE_ROUTE : `${FREE_ROUTE}?${query}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS),
          })
          if (!response.ok) throw new Error(`free route answered HTTP ${String(response.status)}`)
          const snapshot = await response.json()
          if (snapshot === null || typeof snapshot !== 'object') throw new Error('free route answered no snapshot')
          return snapshot
        }

        const injected = () => ({ readUsage, readSessionUsage, readFree })

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'opencode-go-usage',
          order: 21,
          locale: NS,
          inject: injected,
        }, UsageChip))
      },
    }
  },
})
