/**
 * Browser half of the Ollama Cloud quota chip.
 *
 * Renders one entry in the composer's dock, beside the context meter. It shows
 * the remaining Ollama Cloud credit, read from this package's Host half over
 * its private Connection RPC channel (the API key never reaches the browser).
 * A click opens a card above the chip with the credit bar, the full breakdown,
 * and this Session's Ollama-only usage. The open card deliberately survives
 * transcript scrolling while the agent streams replies and tool logs. The only
 * styles are this module's own inserted stylesheet.
 *
 * @module @local/ollama-quota/client
 */

window.__ModuleLoader__.load({
  id: '@local/ollama-quota',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'ollamaQuota'

    /**
     * Exact route this bundle's Host half answers, posted relative to the page
     * so a mount prefix keeps working. The carrier authenticates it with the
     * page's own session; the response is JSON.
     */
    const ROUTE = 'api/ollama-quota/balance'

    /** Exact route the Host half answers for one Session's attributed usage. */
    const SESSION_ROUTE = 'api/ollama-quota/session'

    /** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
    const POLL_MS = 60_000

    /** How often an open panel re-reads the Session while the agent is working. */
    const SESSION_POLL_MS = 10_000

    /** A stalled Host read must not freeze the panel's refresh loop. */
    const CLIENT_REQUEST_TIMEOUT_MS = 15_000

    const ja = {
      'balance.loading': 'Ollama 読み込み中',
      'balance.unconfigured': 'Ollama 未設定',
      'balance.error': 'Ollama 取得失敗',
      'balance.stale': 'Ollama {remaining} (更新失敗)',
      'balance.label': '{remaining}/{allowance}',
      'balance.percent': 'セッション {session}% / 週 {weekly}%',
      'balance.title': 'Ollama Cloud 残高',
      'balance.titleUnconfigured': 'Ollama Cloud の残高は取得できません',
      'balance.titleError': 'Ollama Cloud の残高を取得できませんでした',
      'balance.envNote': 'APIキーを環境変数 {env} に設定すると表示されます。',
      'balance.included': '含まれるクレジット',
      'balance.purchased': '購入クレジット',
      'balance.total': '合計',
      'balance.period': '対象期間',
      'balance.session': 'セッション残り',
      'balance.weekly': '週次残り',
      'balance.updated': '取得時刻',
      'balance.retryAfter': '{seconds} 秒後に再試行してください。',
      'session.title': 'このセッション',
      'session.loading': 'セッション消費を読み込み中…',
      'session.missing': 'このセッションの利用情報を取得できませんでした。',
      'session.unavailable': 'セッションが選択されていないため利用情報を表示できません。',
      'session.error': 'セッション消費を取得できませんでした。',
      'session.empty': 'このセッションではまだ Ollama Cloud を利用していません。',
      'session.spend': '推定消費',
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
      'session.note': 'Ollama の公表単価による概算です。コンテキスト圧縮前の利用を含み、他LLMとタイトル生成は推定消費に含みません。',
      'session.unpriced': '単価が不明なモデルの利用は推定に含まれていません。',
      'session.titleNote': 'タイトル生成 {count} 回はトークンがログに残らないため、推定に含まれません。',
      'session.subagentMissing': '未読込・終了済みのサブエージェント {count} 件は含まれていません。',
      'session.updated': '計測時刻',
      'session.stale': '更新に失敗しました（{time} 時点の値）',
      'session.forkNote': 'フォーク元から引き継いだ利用は含みません。',
    }

    const en = {
      'balance.loading': 'Ollama loading',
      'balance.unconfigured': 'Ollama not set up',
      'balance.error': 'Ollama unavailable',
      'balance.stale': 'Ollama {remaining} (refresh failed)',
      'balance.label': '{remaining}/{allowance}',
      'balance.percent': 'session {session}% / week {weekly}%',
      'balance.title': 'Ollama Cloud balance',
      'balance.titleUnconfigured': 'Ollama Cloud balance is unavailable',
      'balance.titleError': 'Could not read the Ollama Cloud balance',
      'balance.envNote': 'Set the API key in the {env} environment variable to show it here.',
      'balance.included': 'Included credit',
      'balance.purchased': 'Purchased credit',
      'balance.total': 'Total',
      'balance.period': 'Period',
      'balance.session': 'Session left',
      'balance.weekly': 'Week left',
      'balance.updated': 'Read at',
      'balance.retryAfter': 'Try again in {seconds} seconds.',
      'session.title': 'This session',
      'session.loading': 'Loading session spend…',
      'session.missing': 'Could not read this session’s usage.',
      'session.unavailable': 'Select a session to see its usage.',
      'session.error': 'Could not read session spend.',
      'session.empty': 'This session has not used Ollama Cloud yet.',
      'session.spend': 'Estimated spend',
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
      'session.note': 'Estimated from Ollama’s published list prices. Includes pre-compaction usage; other LLMs and title generation are excluded.',
      'session.unpriced': 'Usage of models without a known list price is excluded from the estimate.',
      'session.titleNote': '{count} title-generation call(s) are excluded because their tokens are not logged.',
      'session.updated': 'Measured at',
      'session.stale': 'Refresh failed; showing the {time} reading.',
      'session.forkNote': 'Usage inherited from the fork source is excluded.',
      'session.subagentMissing': '{count} subagent session(s) were not loaded or have ended and are excluded.',
    }

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

    /** Coerce to a finite number, or 0. */
    function num(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /** USD amount with two decimals, falling back where Intl currency is unavailable. */
    function usd(value) {
      const amount = num(value)
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount)
      } catch {
        return `$${amount.toFixed(2)}`
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

    /**
     * USD with enough precision for a single session: cents above one dollar,
     * four decimals for smaller amounts so a short chat does not read $0.00.
     */
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

    /** Short local date for a documented UTC timestamp, or the raw text when unparsable. */
    function shortDate(iso) {
      if (typeof iso !== 'string') return '—'
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return iso
      try {
        return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      } catch {
        return new Date(at).toISOString().slice(0, 10)
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

    /**
     * Fold one wire snapshot into the chip's label, tone, and panel content.
     * @param snapshot - the Host half's balance answer.
     * @param t - namespace translate function.
     * @returns display parts: headline, chip label, rows, note, and bar ratio.
     */
    function describeBalance(snapshot, t) {
      if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.state !== 'string') {
        return { label: t('balance.loading'), headline: t('balance.title'), tone: 'muted', rows: [], note: null, bar: null }
      }
      const balance = snapshot.balance
      const error = snapshot.error
      const updated = typeof snapshot.fetchedAt === 'number' ? clockTime(snapshot.fetchedAt) : '—'
      const failureNote = error !== null && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : null

      if (snapshot.state === 'unconfigured') {
        return {
          label: t('balance.unconfigured'),
          headline: t('balance.titleUnconfigured'),
          tone: 'muted',
          rows: [],
          note: t('balance.envNote', { env: String(snapshot.apiKeyEnv ?? 'OLLAMA_CLOUD_API_KEY') }),
          bar: null,
        }
      }

      if (balance === null || typeof balance !== 'object') {
        return {
          label: t('balance.error'),
          headline: t('balance.titleError'),
          tone: 'error',
          rows: [],
          note: failureNote,
          bar: null,
        }
      }

      const purchased = usd(balance.purchasedUsd)
      if (balance.kind === 'usd') {
        const remaining = usd(balance.includedRemainingUsd)
        const allowance = usd(balance.includedAllowanceUsd)
        const total = usd(num(balance.includedRemainingUsd) + num(balance.purchasedUsd))
        const rows = [
          [t('balance.included'), `${remaining} / ${allowance}`],
          [t('balance.purchased'), purchased],
          [t('balance.total'), total],
        ]
        if (typeof balance.periodFrom === 'string' && typeof balance.periodUntil === 'string') {
          rows.push([t('balance.period'), `${shortDate(balance.periodFrom)} – ${shortDate(balance.periodUntil)}`])
        }
        rows.push([t('balance.updated'), updated])
        const allowanceValue = num(balance.includedAllowanceUsd)
        const remainingValue = num(balance.includedRemainingUsd) + num(balance.purchasedUsd)
        const low = allowanceValue > 0 && remainingValue <= 0
        return {
          label: t('balance.label', { remaining, allowance }),
          headline: t('balance.title'),
          tone: snapshot.stale === true ? 'warn' : low ? 'warn' : 'ok',
          rows,
          note: failureNote,
          bar: allowanceValue > 0 ? Math.min(1, Math.max(0, remainingValue / allowanceValue)) : null,
        }
      }

      const sessionPercent = Math.round(num(balance.sessionRemainingPercent))
      const weeklyPercent = Math.round(num(balance.weeklyRemainingPercent))
      return {
        label: t('balance.percent', { session: String(sessionPercent), weekly: String(weeklyPercent) }),
        headline: t('balance.title'),
        tone: snapshot.stale === true ? 'warn' : Math.min(sessionPercent, weeklyPercent) <= 10 ? 'warn' : 'ok',
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
     * Fold the Host's attributed Session usage into panel rows.
     *
     * The direct figures cover this Session's own log, including records written
     * before a context compaction; the subtree figures add live subagent
     * Sessions. Other providers are listed separately and never folded into the
     * Ollama spend.
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
        ? [...new Set(direct.models.map(model => model?.model).filter(model => typeof model === 'string' && model !== 'unknown'))]
        : []
      if (models.length > 0) {
        const shown = models.slice(0, 3)
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

    /** A coin glyph, drawn from the current text color. */
    function CoinIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: 'M6 5.6 L8 8.4 L10 5.6 M8 8.4 V10.9 M6.2 9.4 H9.8',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /**
     * Ask the Host half for the balance, retrying once per poll interval so a
     * transient failure heals without a page reload.
     * @param readBalance - injected reader.
     * @returns the current snapshot.
     */
    function useBalance(readBalance) {
      const [snapshot, setSnapshot] = React.useState(null)
      React.useEffect(() => {
        let cancelled = false
        let timer = null
        const poll = () => {
          Promise.resolve()
            .then(() => readBalance(false))
            .then((next) => { if (!cancelled) setSnapshot(next) })
            .catch((error) => {
              if (cancelled) return
              setSnapshot({ state: 'error', balance: null, fetchedAt: null, error: { message: String(error && error.message ? error.message : error) } })
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
      }, [readBalance])
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
        const width = Math.min(300, window.innerWidth - 24)
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
      return h('section', { className: 'oq-session', 'data-ollama-session': view.state },
        h('div', { className: 'oq-session-head' },
          h('span', { className: 'oq-panel-title' }, t('session.title'))),
        view.rows.length > 0 ? h('dl', { className: 'oq-rows oq-rows-plain' },
          view.rows.flatMap((row, index) => [
            h('dt', { key: `session-label-${String(index)}` }, row[0]),
            h('dd', { key: `session-value-${String(index)}` }, row[1]),
          ])) : null,
        view.notes.map((note, index) => h('p', {
          key: `session-note-${String(index)}`,
          className: 'oq-note',
        }, note)),
      )
    }

    /** Remaining Ollama Cloud credit, ambient on the composer's stats row. */
    function BalanceChip(props) {
      const { t, readBalance, readSessionUsage, sessionId } = props
      const snapshot = useBalance(readBalance)
      const view = describeBalance(snapshot, t)
      const panel = usePanel()
      const session = useSessionUsage(readSessionUsage, sessionId, panel.open)
      const sessionView = typeof sessionId === 'string' && sessionId !== ''
        ? describeSession(session, t)
        : { state: 'unavailable', rows: [], notes: [t('session.unavailable')] }
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          ref: panel.anchorRef,
          className: 'oq-chip',
          'data-tone': view.tone,
          'data-ollama-balance': view.tone,
          'aria-haspopup': 'dialog',
          'aria-expanded': panel.open,
          onClick: panel.toggle,
        }, h(CoinIcon), h('span', { className: 'oq-label' }, view.label)),
        panel.open && panel.placement !== null ? createPortal(
          h('div', {
            ref: panel.panelRef,
            className: 'oq-panel',
            role: 'dialog',
            'aria-label': view.headline,
            style: {
              left: `${String(panel.placement.left)}px`,
              bottom: `${String(panel.placement.bottom)}px`,
              width: `${String(panel.placement.width)}px`,
              maxHeight: `${String(panel.placement.maxHeight)}px`,
            },
          },
            h('div', { className: 'oq-panel-head' },
              h(CoinIcon),
              h('span', { className: 'oq-panel-title' }, view.headline),
              h('span', { className: 'oq-panel-value' }, view.label)),
            view.bar !== null ? h('div', { className: 'oq-bar', 'data-tone': view.tone },
              h('div', { className: 'oq-bar-fill', style: { width: `${String(Math.round(view.bar * 100))}%` } })) : null,
            view.rows.length > 0 ? h('dl', { className: 'oq-rows' },
              view.rows.flatMap((row, index) => [
                h('dt', { key: `label-${String(index)}` }, row[0]),
                h('dd', { key: `value-${String(index)}` }, row[1]),
              ])) : null,
            view.note !== null ? h('p', { className: 'oq-note' }, view.note) : null,
            h(SessionSection, { view: sessionView, t }),
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
          style.dataset.dshPlugin = '@local/ollama-quota'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'ollama-quota: chip styles')

        ctx.effect(() => ctx.locale.register(NS, { ja, en }), 'ollama-quota: dictionaries')

        /**
         * Read this bundle's Host half. The route sits below the page's
         * authenticated carrier, so the browser session cookie is the whole
         * credential and no secret reaches the browser.
         * @param force - bypass the Host cache.
         * @returns the balance snapshot.
         */
        const readBalance = async (force) => {
          const url = force === true ? `${ROUTE}?force=1` : ROUTE
          const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`balance route answered HTTP ${String(response.status)}`)
          const snapshot = await response.json()
          if (snapshot === null || typeof snapshot !== 'object') throw new Error('balance route answered no snapshot')
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

        const injected = () => ({ readBalance, readSessionUsage })

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'ollama-balance',
          order: 20,
          locale: NS,
          inject: injected,
        }, BalanceChip))
      },
    }
  },
})
