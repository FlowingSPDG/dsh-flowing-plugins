# dsh-flowing-plugins

Small [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web UI plugins for
the composer's dock. Each package is self-contained TypeScript compiled to
plain JavaScript: no runtime dependencies, no install scripts, and the built
bundles are committed, so installing one never runs a build.

| Package | What it shows |
|---|---|
| [`ollama-quota/`](ollama-quota) | Remaining Ollama Cloud credit and this Session’s estimated Ollama spend. |
| [`ollama-offpeak/`](ollama-offpeak) | Whether Ollama Cloud currently bills at the peak or off-peak rate, and the time left on it. |
| [`opencode-go-quota/`](opencode-go-quota) | OpenCode Go usage (5-hour / weekly / monthly), this Session’s estimated allowance spend, and a limited-time free-model watch. |
| [`provider-visibility/`](provider-visibility) | The active provider beside the model in the composer’s model selector, and the provider/model that served each completed chat turn. |
| [`model-favorites/`](model-favorites) | Star models and providers from a ★ chip beside the model selector, then search and pick only your favorites. |

The three quota chips render in the `conversation.composer.dock` slot, below
the composer card alongside the shipped stat pills and the live-speed chip.
Clicking one opens a card above it — a headed panel with the figures, a
credit bar where one applies, and the full breakdown — rather than an app-wide
alert or a flat tooltip. `provider-visibility` labels the model selector and
each completed turn in place, and `model-favorites` adds a ★ chip beside the
model selector. Copy is Japanese and English; every surface follows the active
DSH language.

## Install

Install one package from this repository into a DSH profile. Replace `web` with
the profile you use.

```sh
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-quota
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-offpeak
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/opencode-go-quota
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/provider-visibility
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/model-favorites
```

Every package ships its built Host and browser bundles in `dist/`, so a git
install needs no build allowance and no `prepare` script. Afterwards, reload
the open Harness page once: a page that was already open keeps the module graph
it booted with, so a newly installed browser half appears only after a reload.

To remove one:

```sh
dsh plugin --profile web remove @local/ollama-quota
```

The same installs are available from the agent side through
`plugin_manager` (`install_bundle` with the package directory).

## `provider-visibility`

The shipped composer model seat and the chat flow name the model but not the
channel it runs on. Two shipped-slot contributions fill that in:

- **Model selector** (`conversation.input.model.label`) — the trigger, the
  root menu's current value, and each option row render
  `Provider · Model`, with the provider in the quieter label color. The
  provider truncates first in the narrow trigger, so the model name stays
  readable. A catalog badge keeps its shipped position (before the name in the
  trigger, after it in menus) as a neutral pill.
- **Completed turns** (`conversation.chat.turnTail`) — each finished turn
  shows quiet chips of the provider/model routes that actually served it, read
  from the turn's token-usage attribution. A turn without attribution renders
  nothing.

Both contributions are non-interactive; selection controls stay owned by the
shipped seat. Install as above and reload the open Harness page once.

## `model-favorites`

A ★ chip sits immediately after the composer's model selector
(`conversation.input.activity`) and opens a panel over the transcript:

- **★ お気に入り / Favorites** — only the starred `provider/model` pairs, plus
  every model of a starred provider.
- **すべて / All** — the whole catalog. A row's ☆ adds it, ★ removes it, and the
  ☆ beside a provider name stars all of that provider's models at once. The
  panel opens in this mode when nothing is starred yet.
- **Search** — the field at the top filters models and providers by name as you
  type; ↑/↓ moves, Enter picks, Escape closes.
- **Picking a row** switches the session model through the same
  `session.selectModel` call the native menu uses. A one-row offer at the top
  stars the model the session is using when it is not starred yet.

The document — `{ providers: string[], models: string[] }`, with model keys as
`providerId/modelId` — lives on the Host in
`$DSH_HOME/storages/model-favorites/state.json` and is served over two exact
routes, `GET` and `POST /model-favorites/state`, below the authenticated `/api`
carrier. Writes are serialized and land through a temporary file plus rename; a
page that never read the document never writes it, so a Host that is unreachable
cannot clear saved favorites with an empty list. Favorites are shared by every
browser and device on the profile but are not live-synced: another device's
changes appear on the next panel open or page reload.

The native model menu is left alone — starring rows inside it, or filtering it
to favorites, would need a core UI replacement, which this package does not do.

## `ollama-quota`

One chip:

- **Balance** — remaining included credit and allowance, for example
  `$50.29/$60.00`. Clicking it opens the credit bar plus the purchased credit,
  the total, the current period, and when the reading was taken. A failed refresh keeps the last
  reading and marks the chip as stale; an unconfigured key shows
  `Ollama 未設定` / `Ollama not set up` instead of a guess.
- **Session spend** — the open panel also reports this Session's Ollama-only
  request count, token buckets, models, and an estimated USD spend. The
  estimate uses Ollama's published per-token list prices, including the
  peak/off-peak rows at each record's timestamp. It reads the
  durable Session log, so usage from before a context compaction is included,
  and model switches inside one Session are counted per model.

The panel stays open while the agent streams a reply or appends tool logs; it
closes on Escape or an outside press, not on transcript scrolling. While it is
open, Session usage refreshes every 10 seconds.

The shipped `usage` stat pill still owns the all-provider totals. This panel is
deliberately narrower: it answers "how much of my Ollama Cloud credit did this
Session consume?" rather than duplicating the whole-session token pill. Other
providers are shown separately and never folded into the Ollama spend. A
subagent's usage is added in a labelled subtree row when that child Session is
live; title-generation calls are counted as requests but cannot be priced
because their tokens are not logged.

### The API key stays in the Host

The balance endpoint needs the account key in an `Authorization` header, so the
browser never holds it. The Host half resolves the key per call from the DSH
credential store (falling back to the process environment), calls
`GET https://ollama.com/api/balance`, caches one answer, and serves the result to
the page over an exact `GET api/ollama-quota/balance` route registered through
`ctx.connection.fetch.register`. That route lives below the authenticated `/api`
carrier, so the page's own browser-session cookie is the only credential the
browser presents.

Session usage travels over a second exact route,
`GET api/ollama-quota/session?sessionId=…`. A host-only Session projection
folds the durable events (`request/header`, `assistant/message`,
`assistant/attempt`, `compaction/summary`, `subagent/catalog`) once per new
event and the route returns its attributed totals; the browser never folds
events itself. Fork-inherited history is not counted again:
only events owned by the Session contribute, so a fork cannot double-charge the
source conversation. The balance endpoint allows 10 requests per minute per
user, so the Host cache floor is 60 seconds no matter what the configuration
says.

### Configuration

The bundle's `cordis.patch.yml` inserts one row. Override any key in your
profile's `cordis.patch.yml` (a patch replaces the row's whole `config`, so
restate the keys you keep):

```yaml
- id: ollama-quota
  config:
    apiKeyEnv: OLLAMA_CLOUD_API_KEY   # credential reference (environment-variable name)
    baseUrl: https://ollama.com       # balance endpoint base
    refreshSeconds: 60                # Host cache window; minimum 60
    provider: ollama-cloud            # provider id whose calls count toward the balance
    # prices:                         # optional overrides/additions, USD per million tokens
    #   my-new-model: { input: 0.30, cached: 0.006, output: 1.20 }
```

The built-in price table mirrors `https://ollama.com/pricing` and includes a
peak/off-peak pair for `deepseek-v4.1-flash` and `deepseek-v4-pro`. If Ollama
changes a price or adds a model, override that row in your profile rather than
editing the package.

Set the key once, either through the DSH credential store (the Models settings
page writes provider keys there) or as `OLLAMA_CLOUD_API_KEY` in the
environment that launches `dsh`.

## `ollama-offpeak`

One chip naming whether Ollama Cloud bills at the peak or off-peak rate right
now, with the time left before it changes:

- `ピーク · 1時間23分` / `Peak · 1h23m` — inside the peak window;
- `オフピーク · 2日3時間` / `Off-peak · 2d 3h` — outside it.

Clicking it opens a card with the current side, the published window, the next
change, and that change in the reader's local time.

The window is the published Ollama Cloud off-peak schedule: peak billing is
weekdays 12:00–18:00 UTC, and every other hour — the whole UTC weekend included
— bills at the off-peak rate. That is the same window the shipped `llm-pi-ai`
Ollama Cloud route carries for its peak routing. The chip recomputes twice a
minute and needs no network and no configuration.

> This chip reports the clock, not your provider's live pricing. If Ollama
> Cloud changes its peak schedule, update `PEAK_START_MINUTES` /
> `PEAK_END_MINUTES` in [`ollama-offpeak/src/peak.ts`](ollama-offpeak/src/peak.ts).

## `opencode-go-quota`

One chip for [OpenCode Go](https://opencode.ai/docs/console/go/):

- **Usage** — `5h 34% / 週 4% / 月 2%`, the three documented Go windows read
  from `GET https://opencode.ai/zen/go/v1/usage` with the Go API key. The open
  card draws one bar per window with its reset time in the reader's local
  clock; a window at 100% turns the chip red and the card points at free
  models and Extra Usage. The endpoint's live nested shape
  (`usage.rolling.percent` + `resetsAt`) and the early flat shape
  (`rollingUsage.usagePercent` + `resetInSec`) are both accepted.
- **Session spend** — the open card also reports this Session's Go-only
  request count, token buckets, models, and an estimated USD spend against the
  allowance. The estimate uses the published Go token prices, including the
  documented time multipliers at each record's timestamp and the long-context
  tiers. It reads the durable Session log, so usage from before a context
  compaction is included, and model switches inside one Session are counted
  per model; free models are tagged `無料` / `free` and cost zero, and a model
  id ending in `-free` counts as free even when no list price is published.
- **Free-model watch** — the Host half polls the public
  `GET https://opencode.ai/inference/go/v1/models` list (no key needed) every
  10 minutes and tracks the limited-time free models: rows whose published
  input and output token prices are both zero, and rows whose id carries the
  `-free` naming suffix (so a future `-free` listing with non-zero prices
  still counts as free). The chip always shows how many
  models are free right now — `無料` / `FREE` when a watched model is free, a
  green `+N` badge when new ones arrived since your last look, otherwise the
  plain count. The card's free list marks the arrivals `新` / `NEW`; opening
  the card acknowledges them. Each row also tags geo-restricted (`geo`) and
  training-consent (`training`) models.
- **Watched free windows** — `watchModels` (the shipped configuration watches
  `glm-5.3-flash`) names the models whose free windows should be called out by
  name. A watch name matches the list row's id or the bare name of its
  canonical id, so a limited-time `-free` variant published over a paid
  sibling's canonical id (for example `hy4-flash-free` over
  `tencent/hy4-flash`) also flips that sibling to 無料. The card shows each
  watched model as 現在無料 or 現在有料 with its published input list price,
  and a 最近の変化 / recent-changes list records when the watcher saw a model
  become free or paid again (in-memory, so it covers the current host run).

### About peak time

The Go allowance itself has **no peak-time schedule**: the 5-hour, weekly, and
monthly windows are pure percentages and cost the same at 3 a.m. and 3 p.m.
However, the published *token prices* of a few Go models do carry time
multipliers — `deepseek-v4.1-flash` and `deepseek-v4-pro` double on weekdays
01:00–04:00 and 06:00–10:00 UTC, and `gemini-4-argon` doubles from
2026-12-01 — so the Session estimate applies them where documented and tags
such models `倍率適用` / `multiplied`. That is why the Session estimate can
move with the clock even though the quota windows do not.

### The credit balance is not readable by key

`GET /zen/go/v1/usage` reports only the three subscription windows; the
workspace's prepaid Zen credit balance is served by the web console's
authenticated session and has no API-key endpoint (tracked upstream in
[anomalyco/opencode#44189](https://github.com/anomalyco/opencode/issues/44189)).
This package therefore reports allowance consumption the way the API allows —
window percentages plus the Session's estimated dollars — and does not guess a
balance. When the upstream issue lands, the Host half is the single place to
add the read.

### The API key stays in the Host

The usage endpoint needs the Go API key in an `Authorization` header, so the
browser never holds it. The Host half resolves the key per call from the DSH
credential store (falling back to the process environment), calls the usage
endpoint, caches one answer for the configured window (minimum 60 seconds),
and serves the result to the page over an exact
`GET api/opencode-go-quota/usage` route registered through
`ctx.connection.fetch.register`. Session usage travels over a second exact
route, `GET api/opencode-go-quota/session?sessionId=…`, and the free-model
watch over a third, `GET api/opencode-go-quota/free` (with `?ack=1` marking
the currently reported arrivals as seen). All three live below the
authenticated `/api` carrier, so the page's own browser-session cookie is the
only credential the browser presents.

### Configuration

The bundle's `cordis.patch.yml` inserts one row. Override any key in your
profile's `cordis.patch.yml` (a patch replaces the row's whole `config`, so
restate the keys you keep):

```yaml
- id: opencode-go-quota
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY        # credential reference (environment-variable name)
    baseUrl: https://opencode.ai       # usage + models endpoint base
    refreshSeconds: 60                 # Host cache window for usage; minimum 60
    freeRefreshSeconds: 600            # free-model watch cadence; minimum 300
    provider: opencode-go              # provider id whose calls count toward the allowance
    watchModels: [glm-5.3-flash]       # models whose free windows the chip calls out
    # prices:                          # optional overrides/additions, USD per million tokens
    #   my-new-model: { input: 0.30, cached: 0.006, output: 1.20 }
```

The built-in price table mirrors `https://opencode.ai/inference/go/v1/models`,
including the DeepSeek time windows, the Gemini 4 Argon date multiplier, and
the long-context tiers. If OpenCode changes a price or adds a model, override
that row in your profile rather than editing the package.

Set the key once, either through the DSH credential store (the Models settings
page writes provider keys there), or in the launch environment — the same
process / project `.env` / user `.env` chain the OpenCode Go adapter resolves —
or as `OPENCODE_GO_API_KEY` in the ambient environment. The free-model watch
needs no key and no configuration.

## Package layout

Each package declares `dsh.bundle.patch` (the Loader rows it inserts),
`dsh.client` (its browser half, served by DSH's client module system), a locale
file for Plugin Manager's title and description, and an icon:

```text
<package>/
  package.json         manifest: exports, files, dsh.bundle, dsh.client
  cordis.patch.yml     the Loader row(s) the bundle inserts
  src/index.ts         Host half source (apply(ctx, config))
  src/client.tsx       browser half source (slots, locale, styles)
  src/*.test.ts        node --test cases over the pure helpers
  dist/index.js        built Host half, committed
  dist/client.js       built browser bundle in the __ModuleLoader__.load form, committed
  locale/{en,ja}.json  Plugin Manager metadata
  icon.svg             Plugin Manager artwork
```

Edit `src/`; `dist/` is generated. From a checkout of this repository:

```sh
pnpm install
pnpm build      # regenerate every package's dist/
pnpm typecheck  # tsc over every package
pnpm test       # node --test over the pure helpers
pnpm smoke      # load every built bundle the way the page does
```

The bundles stay committed on purpose: a `dsh plugin add github:…` install
resolves `dist/` directly and stays free of build scripts. A bundle rebuilt by
`pnpm build` reaches the open page through DSH's client module rebuild watch;
a package added or removed still needs the one page reload described above.

The browser halves draw with the host's `--dsw-alias-*` theme tokens only, and
every resource they add (stylesheet, timers, slot registrations) is removed
with the plugin.

## License

MIT — see [LICENSE](LICENSE).
