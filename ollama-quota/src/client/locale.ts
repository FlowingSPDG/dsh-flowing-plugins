/**
 * The chip's copy, and the one declaration of its locale namespace.
 *
 * `ja` owns the key set; `en` is typed against it, so a key added to one
 * dictionary without the other is a compile error. The namespace name stays
 * `ollamaQuota`, matching the registration in the browser entry and the
 * package's locale metadata.
 *
 * @module @local/ollama-quota/client/locale
 */

/** Dictionaries' shared key set, driven by the Japanese copy. */
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
} as const

/** Keys of this bundle's copy. */
export type QuotaTextKey = keyof typeof ja

/** English copy, complete against {@link QuotaTextKey}. */
export const en: Record<QuotaTextKey, string> = {
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

/** Locale namespace owned by this bundle. */
export const NS = 'ollamaQuota' as const

/** Japanese copy, exported for registration. */
export { ja }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy of the Ollama Cloud quota chip and its card. */
    ollamaQuota: QuotaTextKey
  }
}
