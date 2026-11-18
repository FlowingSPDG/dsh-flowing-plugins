# モデルお気に入り

モデル選択のたびに長い一覧をたどる代わりに、よく使うモデルやプロバイダーへ★を付けて、お気に入りだけを検索・選択できます。

## 使い方

入力欄のモデル選択ボタンのすぐ右に★チップが並びます。押すとお気に入りパネルが開きます。

- **検索**: パネル上部の検索欄にモデル名またはプロバイダー名の一部を入力すると、その場で絞り込まれます。
- **★ お気に入り**: ★を付けたモデルと、★を付けたプロバイダーの全モデルだけを表示します。
- **すべて**: カタログ全体を表示します。各行の☆でお気に入りに追加、★で解除。プロバイダー名の右の☆は、そのプロバイダーの全モデルをまとめてお気に入りにします。
- **現在のモデルを★**: このセッションで使っているモデルがお気に入りでないとき、パネル上部に1行出ます。押すだけで追加されます。
- **選択**: 行をクリックすると、このセッションのモデルが切り替わります（ネイティブのモデル選択と同じ `session.selectModel` 経由）。

お気に入りが1件もないときは「すべて」モードで開きます（☆を押せる場所から始めるため）。

## キーボード操作

- 開いた直後は検索欄にフォーカスします（タッチ環境ではキーボードを勝手に出さないためフォーカスしません）。
- ↑/↓ で候補を移動、Enter で決定、Esc で閉じます。検索欄にフォーカスが残っていても操作できます。
- 行・☆/★ボタンは個別にフォーカスでき、Enter で実行できます。

## 保存と共有

お気に入りは**ホスト側**の `$DSH_HOME/storages/model-favorites/state.json`（`DSH_HOME` 未設定時は `~/.dsh/storages/model-favorites/state.json`）に保存されます。同じプロファイルを使うブラウザ・端末・セッションで共通です。ただし**ライブ同期はしません**。別の端末での変更はパネルを開いたとき、またはページを再読み込みしたときに反映されます。

書き込みは一時ファイル＋rename で行い、途中で落ちても直前の内容が残ります。読み込みに一度も成功していないページは保存を行いません（ホストに届かない状態で、空のお気に入りにより保存済みの内容を消さないため）。

ホストとのやり取りは Web サーバ上の次の2つの経路だけです。どちらも接続レイヤが拒否する要求には応答しません。

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/model-favorites/state` | 保存済みのお気に入り `{ providers: string[], models: string[] }` |
| POST | `/model-favorites/state` | お気に入り全体を置き換える（空ボディは 400、書き込み失敗は 500） |

モデルの識別子は `プロバイダーID/モデルID` です。

## 制約

- ネイティブのモデル選択メニュー自体は変更しません。ネイティブ一覧の行に★を出したり、その一覧を★だけで絞り込むにはコア UI の差し替えが必要なため、対象外としています。
- ★チップは `conversation.input.activity`（モデル選択の直後にある単一 Slot）を使います。この Slot は現在どのプラグインも使っていませんが、DSH の更新で同梱の占有者が増えた場合はその占有者が優先されます。
- お気に入りはモデルの識別子だけを持ちます。プロバイダーを削除しても★は残り、同じ ID のプロバイダーを戻すと再び有効になります。
- モデル一覧はセッションごとの共有ディレクトリ（`ctx.modelDirectories`）から読むため、カタログの読み込みに失敗したプロバイダーは表示されません。
- セッションが書き込みロック中（モデル選択が無効な状態）は★チップも無効になります。

## Model favorites (English summary)

A ★ chip sits right after the composer's model selector. It opens a panel that lists only your favorites (or the whole catalog under **All**), with a search field over model and provider names, a star per row and per provider, and a one-click star for the model the session currently uses. Picking a row switches the session model through the same `session.selectModel` call the native menu uses.

Favorites live on the Host in `$DSH_HOME/storages/model-favorites/state.json` and are shared by every browser and device that uses this profile; changes appear elsewhere on the next panel open or page reload. Writes go through a temporary file plus rename, and a page that never read the document successfully never writes it.
