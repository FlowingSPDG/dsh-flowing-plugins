# dsh-flowing-plugins

Small [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web UI plugins for
the composer's dock. Each package is self-contained plain
JavaScript: no build step, no dependencies, no install scripts.

| Package | What it shows |
|---|---|
| [`ollama-quota/`](ollama-quota) | Remaining Ollama Cloud credit and this Session’s estimated Ollama spend. |
| [`ollama-offpeak/`](ollama-offpeak) | Whether Ollama Cloud currently bills at the peak or off-peak rate, and the time left on it. |
| [`opencode-go-quota/`](opencode-go-quota) | OpenCode Go usage (5-hour / weekly / monthly), this Session’s estimated allowance spend, and a limited-time free-model watch. |

Both render as ambient chips in the `conversation.composer.dock` slot, below
the composer card alongside the shipped stat pills and the live-speed chip.
Clicking a chip opens a card above it — a headed panel with the figures, a
credit bar where one applies, and the full breakdown — rather than an app-wide
alert or a flat tooltip. Copy is Japanese and English; the chip follows the
active DSH language.

## Install

Install one package from this repository into a DSH profile. Replace `web` with
the profile you use.

```sh
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-quota
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-offpeak
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/opencode-go-quota
```

Both packages ship plain JavaScript, so a git install needs no build allowance
and no `prepare` script. Afterwards, reload the open Harness page once: a page
that was already open keeps the module graph it booted with, so a newly
installed browser half appears only after a reload.

To remove one:

```sh
dsh plugin --profile web remove @local/ollama-quota
```

The same installs are available from the agent side through
`plugin_manager` (`install_bundle` with the package directory).

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
> `PEAK_END_MINUTES` in [`ollama-offpeak/client.js`](ollama-offpeak/client.js).

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
  per model; free models are tagged `無料` / `free` and cost zero.
- **Free-model watch** — the Host half polls the public
  `GET https://opencode.ai/inference/go/v1/models` list (no key needed) every
  10 minutes and tracks the limited-time free models, the ones whose published
  input and output token prices are both zero. When a new free model appears
  since your last look, the chip grows a green `+N` badge and the card's free
  list marks the arrivals `新` / `NEW`; opening the card acknowledges them.
  Each row also tags geo-restricted (`geo`) and training-consent (`training`)
  models.

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
    apiKeyEnv: OPENCODE_API_KEY        # credential reference (environment-variable name)
    baseUrl: https://opencode.ai       # usage + models endpoint base
    refreshSeconds: 60                 # Host cache window for usage; minimum 60
    freeRefreshSeconds: 600            # free-model watch cadence; minimum 300
    provider: opencode-go              # provider id whose calls count toward the allowance
    # prices:                          # optional overrides/additions, USD per million tokens
    #   my-new-model: { input: 0.30, cached: 0.006, output: 1.20 }
```

The built-in price table mirrors `https://opencode.ai/inference/go/v1/models`,
including the DeepSeek time windows, the Gemini 4 Argon date multiplier, and
the long-context tiers. If OpenCode changes a price or adds a model, override
that row in your profile rather than editing the package.

Set the key once, either through the DSH credential store (the Models settings
page writes provider keys there) or as `OPENCODE_API_KEY` in the environment
that launches `dsh`. The free-model watch needs no key and no configuration.

## Package layout

Each package declares `dsh.bundle.patch` (the Loader rows it inserts),
`dsh.client` (its browser half, served by DSH's client module system), a locale
file for Plugin Manager's title and description, and an icon:

```text
<package>/
  package.json       manifest: exports, files, dsh.bundle, dsh.client
  cordis.patch.yml   the Loader row(s) the bundle inserts
  index.js           Host half (apply(ctx, config))
  client.js          browser half (__ModuleLoader__.load factory)
  locale/{en,ja}.json  Plugin Manager metadata
  icon.svg           Plugin Manager artwork
```

The browser halves draw with the host's `--dsw-alias-*` theme tokens only, and
every resource they add (stylesheet, timers, slot registrations) is removed
with the plugin.

## License

MIT — see [LICENSE](LICENSE).
