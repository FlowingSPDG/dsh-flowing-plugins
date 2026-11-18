# dsh-flowing-plugins

Five small [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web UI
plugins for the composer. Each is a self-contained bundle — a Host half, a
browser half, Plugin Manager metadata, an icon — written in TypeScript with its
built bundles committed, so installing one runs no build and pulls no runtime
dependency.

| Package | What it adds |
|---|---|
| [`provider-visibility/`](provider-visibility) | `Provider · Model` in the composer's model selector, and the provider/model that served each finished turn. |
| [`model-favorites/`](model-favorites) | A ★ chip beside the model selector: star models and providers, search, and pick from favorites. |
| [`ollama-quota/`](ollama-quota) | Ollama Cloud credit left, and this Session's estimated Ollama spend. |
| [`ollama-offpeak/`](ollama-offpeak) | Whether Ollama Cloud bills at the peak or off-peak rate right now, and the time left. |
| [`opencode-go-quota/`](opencode-go-quota) | OpenCode Go usage (5-hour / weekly / monthly), this Session's spend, and a free-model watch. |

The three quota chips sit in `conversation.composer.dock` and open a card above
themselves; `provider-visibility` labels shipped seats in place;
`model-favorites` takes `conversation.input.activity`, right after the model
selector. Copy is Japanese and English.

## Install

Install **one package directory** — the repository root is only the workspace
that builds them, so it declares no bundle of its own.

### Web UI, local checkout

**Plugins** → **Add plugin** (the arrow beside it) → **Install a third-party
plugin**, then paste an absolute package path:

```
D:\eiviz\dsh-flowing-plugins\ollama-quota
```

Press **Install**, **Enable now**, then reload the open page once.

### GitHub, UI or CLI

```sh
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-quota
```

or paste `github:FlowingSPDG/dsh-flowing-plugins/ollama-quota` into the same
dialog. The CLI only adds the dependency, so switch the bundle on under
**Plugins** afterwards; the dialog's **Enable now** does that for you. All five:

```sh
for p in provider-visibility model-favorites ollama-quota ollama-offpeak opencode-go-quota; do
  dsh plugin --profile web add "github:FlowingSPDG/dsh-flowing-plugins/$p"
done
```

Remove one with `dsh plugin --profile web remove @local/ollama-quota`. A local
directory installs as a `link:`, so rebuilding updates it without reinstalling.

## Build

```sh
pnpm install
pnpm build      # regenerate every package's dist/
pnpm typecheck  # tsc over every package
pnpm test       # node --test over the pure helpers
pnpm smoke      # load every built bundle the way the page does
```

Edit `src/`; `dist/` is committed to keep `dsh plugin add` build-free. A rebuilt
bundle reaches the open page through DSH's rebuild watch; a newly added package
still needs the one page reload.

## `provider-visibility`

`Provider · Model` in the model trigger, the menu's current value and each
option (provider quieter, truncating first), plus quiet `provider/model` chips
under each finished turn, read from its token-usage attribution. No controls, no
configuration.

## `model-favorites`

A ★ chip opens a panel of favorites (or the whole catalog under **All**) with
search, a star per row and per provider, keyboard navigation, and a one-click
star for the model in use. Picking a row switches the Session model through the
native `session.selectModel` path; the native menu itself is left alone.

Favorites live in `$DSH_HOME/storages/model-favorites/state.json` (or
`~/.dsh/...`), served over `GET`/`POST /model-favorites/state`, shared per
profile and not live-synced. Writes are serialized and atomic; a corrupt
document is moved aside and answered with 500 rather than replaced by an empty
one.

## `ollama-quota`

Remaining credit (`$50.29/$60.00`); the open card adds the credit bar, period,
reading time, and this Session's Ollama-only requests, tokens, models and
estimated USD. A failed refresh keeps the last reading and marks it stale; an
unconfigured key shows `Ollama 未設定` / `Ollama not set up`.

The key never reaches the browser: the Host resolves it per call and serves
`GET api/ollama-quota/balance` and `session?sessionId=…` below the authenticated
`/api` carrier, with a 60-second cache floor and a `?force` cooldown for the
10 requests/minute limit.

```yaml
- id: ollama-quota
  config:
    apiKeyEnv: OLLAMA_CLOUD_API_KEY   # credential reference
    provider: ollama-cloud
    # also: baseUrl, refreshSeconds (60+), prices (USD / million tokens)
```

The built-in table mirrors `https://ollama.com/pricing`, peak/off-peak rows
included; override a row in your profile. Set the key through the credential
store or `OLLAMA_CLOUD_API_KEY` in the launching environment.

## `ollama-offpeak`

The current side and the time left — `ピーク · 1時間23分` / `Peak · 1h23m` — with
the window, the next change and that change in local time in the card. Peak is
weekdays 12:00–18:00 UTC; everything else, weekends included, is off-peak. No
network, no configuration.

> If Ollama Cloud changes the schedule, update `PEAK_START_MINUTES` /
> `PEAK_END_MINUTES` in [`ollama-offpeak/src/peak.ts`](ollama-offpeak/src/peak.ts).

## `opencode-go-quota`

One chip for [OpenCode Go](https://opencode.ai/docs/console/go/):

- **Usage** — `5h 34% / 週 4% / 月 2%` from `GET …/zen/go/v1/usage`, one bar per
  window with its reset time in local clock.
- **Session spend** — this Session's Go-only requests, tokens, models and
  estimated USD, with the published time multipliers and long-context tiers;
  free models are tagged `無料` / `free`.
- **Free-model watch** — the public model list polled every 10 minutes counts
  limited-time free models, badges arrivals (`+N`), and tracks `watchModels`
  (default `glm-5.3-flash`) in a recent-changes list.

```yaml
- id: opencode-go-quota
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    provider: opencode-go
    watchModels: [glm-5.3-flash]
    # also: baseUrl, refreshSeconds (60+), freeRefreshSeconds (300+), prices
```

The key stays in the Host; three exact routes sit below `/api`: `usage`,
`session?sessionId=…`, `free?ack=1`. The allowance has no peak schedule — only
a few models' token prices carry time multipliers. The prepaid Zen balance has
no API-key endpoint, so this reports allowance consumption rather than guessing.

## Package layout

```text
<package>/
  package.json         exports, files, dsh.bundle, dsh.client
  cordis.patch.yml     the Loader row(s) the bundle inserts
  src/index.ts         Host half (apply(ctx, config))
  src/client.tsx       browser half (slots, locale, styles)
  src/*.test.ts        node --test cases over the pure helpers
  dist/index.js        built Host half, committed
  dist/client.js       built browser bundle in the __ModuleLoader__.load form, committed
  locale/{en,ja}.json  Plugin Manager metadata
  icon.svg             Plugin Manager artwork
```

The browser halves use the host's `--dsw-alias-*` theme tokens only and remove
every resource they add when the plugin unloads.

## License

MIT — see [LICENSE](LICENSE).
