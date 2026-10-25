/**
 * Browser half of the Ollama Cloud quota chips.
 *
 * Renders two entries in the composer's session-stats lead seat:
 *
 * - the remaining Ollama Cloud credit, read from this package's Host half over
 *   its private Connection RPC channel (the API key never reaches the browser);
 * - the tokens this Session has used, read from the durable `tokenUsage`
 *   projection the Host computes over the complete session log.
 *
 * Both figures are ambient: no dialog, no DOM outside the slot, and the only
 * styles are this module's own inserted stylesheet.
 *
 * @module @local/ollama-quota/client
 */

window.__ModuleLoader__.load({
  id: '@local/ollama-quota',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'ollamaQuota'

    /**
     * Exact route this bundle's Host half answers, posted relative to the page
     * so a mount prefix keeps working. The carrier authenticates it with the
     * page's own session; the response is JSON.
     */
    const ROUTE = 'api/ollama-quota/balance'

    /** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
    const POLL_MS = 60_000

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
      'tokens.label': '↑{input} ↓{output}',
      'tokens.title': 'このセッションのトークン',
      'tokens.total': '合計',
      'tokens.input': '未キャッシュ入力',
      'tokens.cacheRead': 'キャッシュ読取',
      'tokens.cacheWrite': 'キャッシュ書込',
      'tokens.output': '出力',
      'tokens.hit': 'キャッシュヒット率',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
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
      'tokens.label': '↑{input} ↓{output}',
      'tokens.title': 'Tokens in this session',
      'tokens.total': 'Total',
      'tokens.input': 'Uncached input',
      'tokens.cacheRead': 'Cache read',
      'tokens.cacheWrite': 'Cache write',
      'tokens.output': 'Output',
      'tokens.hit': 'Cache hit',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
    }

    const CSS = `
.oq-chip {
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
.oq-chip svg { width: 13px; height: 13px; flex: none; }
.oq-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.oq-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.oq-chip[data-tone='muted'] { color: var(--dsw-alias-label-secondary); opacity: 0.75; }
.oq-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
`

    /** Coerce to a finite number, or 0. */
    function num(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /** One-decimal compact value: 12.2, 517, 1.2. */
    function scaled(value) {
      return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
    }

    /** Compact token count under the namespace's own K/M words. */
    function compactTokens(value, t) {
      const tokens = Math.max(0, num(value))
      if (tokens < 1_000) return String(Math.round(tokens))
      if (tokens < 1_000_000) return t('number.thousand', { value: scaled(tokens / 1_000) })
      return t('number.million', { value: scaled(tokens / 1_000_000) })
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

    /** One labelled row inside a native tooltip. */
    function line(label, value) {
      return `${label}: ${value}`
    }

    /**
     * Fold one wire snapshot into the chip's text, tone, and tooltip.
     * @param snapshot - the Host half's balance answer.
     * @param t - namespace translate function.
     * @returns display parts.
     */
    function describeBalance(snapshot, t) {
      if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.state !== 'string') {
        return { label: t('balance.loading'), title: t('balance.title'), tone: 'muted' }
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
          title: [
            t('balance.titleUnconfigured'),
            t('balance.envNote', { env: String(snapshot.apiKeyEnv ?? 'OLLAMA_CLOUD_API_KEY') }),
          ].join('\n'),
          tone: 'muted',
        }
      }

      if (balance === null || typeof balance !== 'object') {
        return {
          label: t('balance.error'),
          title: [t('balance.titleError'), failureNote].filter(part => typeof part === 'string' && part.length > 0).join('\n'),
          tone: 'error',
        }
      }

      const purchased = usd(balance.purchasedUsd)
      if (balance.kind === 'usd') {
        const remaining = usd(balance.includedRemainingUsd)
        const allowance = usd(balance.includedAllowanceUsd)
        const total = usd(num(balance.includedRemainingUsd) + num(balance.purchasedUsd))
        const rows = [
          t('balance.title'),
          line(t('balance.included'), `${remaining} / ${allowance}`),
          line(t('balance.purchased'), purchased),
          line(t('balance.total'), total),
        ]
        if (typeof balance.periodFrom === 'string' && typeof balance.periodUntil === 'string') {
          rows.push(line(t('balance.period'), `${shortDate(balance.periodFrom)} – ${shortDate(balance.periodUntil)}`))
        }
        rows.push(line(t('balance.updated'), updated))
        if (failureNote !== null) rows.push(failureNote)
        const low = num(balance.includedAllowanceUsd) > 0
          && num(balance.includedRemainingUsd) + num(balance.purchasedUsd) <= 0
        return {
          label: t('balance.label', { remaining, allowance }),
          title: rows.join('\n'),
          tone: snapshot.stale === true ? 'warn' : low ? 'warn' : 'ok',
        }
      }

      const sessionPercent = Math.round(num(balance.sessionRemainingPercent))
      const weeklyPercent = Math.round(num(balance.weeklyRemainingPercent))
      const rows = [
        t('balance.title'),
        line(t('balance.session'), `${String(sessionPercent)}%`),
        line(t('balance.weekly'), `${String(weeklyPercent)}%`),
        line(t('balance.purchased'), purchased),
        line(t('balance.updated'), updated),
      ]
      if (failureNote !== null) rows.push(failureNote)
      return {
        label: t('balance.percent', { session: String(sessionPercent), weekly: String(weeklyPercent) }),
        title: rows.join('\n'),
        tone: snapshot.stale === true ? 'warn' : Math.min(sessionPercent, weeklyPercent) <= 10 ? 'warn' : 'ok',
      }
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

    /** A token-count glyph: a stacked pair of blocks. */
    function TokenIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2.2, y: 3.1, width: 11.6, height: 3.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('rect', { x: 2.2, y: 9.5, width: 7.2, height: 3.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.3 }))
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

    /** Remaining Ollama Cloud credit, ambient on the composer's stats row. */
    function BalanceChip(props) {
      const { t, readBalance } = props
      const snapshot = useBalance(readBalance)
      const view = describeBalance(snapshot, t)
      return h('span', {
        className: 'oq-chip',
        'data-tone': view.tone,
        'data-ollama-balance': view.tone,
        title: view.title,
      }, h(CoinIcon), h('span', { className: 'oq-label' }, view.label))
    }

    /**
     * Whole-session tokens from the durable `tokenUsage` projection: input and
     * output at a glance, every billing bucket in the tooltip.
     */
    function SessionTokensChip(props) {
      const { t, useProjection } = props
      const usage = useProjection('tokenUsage')
      if (usage === null || typeof usage !== 'object') return null
      const input = num(usage.uncachedInputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens)
      const output = num(usage.outputTokens)
      const total = input + output
      if (total <= 0) return null
      const billed = input
      const cached = num(usage.cacheReadTokens)
      const rows = [
        t('tokens.title'),
        line(t('tokens.total'), String(total)),
        line(t('tokens.input'), String(num(usage.uncachedInputTokens))),
        line(t('tokens.cacheRead'), String(cached)),
      ]
      if (num(usage.cacheWriteTokens) > 0) rows.push(line(t('tokens.cacheWrite'), String(num(usage.cacheWriteTokens))))
      rows.push(line(t('tokens.output'), String(output)))
      if (billed > 0) rows.push(line(t('tokens.hit'), `${String(Math.min(100, Math.round((cached / billed) * 100)))}%`))
      return h('span', {
        className: 'oq-chip',
        'data-tone': 'ok',
        'data-session-tokens': String(total),
        title: rows.join('\n'),
      }, h(TokenIcon), h('span', { className: 'oq-label' }, t('tokens.label', {
        input: compactTokens(input, t),
        output: compactTokens(output, t),
      })))
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

        const injected = () => ({ readBalance })

        ctx.slots.inject('conversation.composer.stats.lead', () => ctx.slots.register({
          name: 'conversation.composer.stats.lead',
          id: 'ollama-balance',
          order: 20,
          locale: NS,
          inject: injected,
        }, BalanceChip))

        ctx.slots.inject('conversation.composer.stats.lead', () => ctx.slots.register({
          name: 'conversation.composer.stats.lead',
          id: 'session-tokens',
          order: 30,
          locale: NS,
          inject: injected,
        }, SessionTokensChip))
      },
    }
  },
})
