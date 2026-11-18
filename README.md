# dsh-flowing-plugins

Five small [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web UI
plugins for the composer. Each is a self-contained bundle: a Host half, a
browser half, a locale file for Plugin Manager, and an icon. They are written in
TypeScript and ship their built bundles in `dist/`, so installing one runs no
build and pulls no runtime dependency.

| Package | What it adds |
|---|---|
| [`provider-visibility/`](provider-visibility) | `Provider · Model` in the composer's model selector, and the provider/model that served each finished turn. |
| [`model-favorites/`](model-favorites) | A ★ chip beside the model selector: star models and providers, search, and pick a model from favorites. |
| [`ollama-quota/`](ollama-quota) | Ollama Cloud credit left, and this Session's estimated Ollama spend. |
| [`ollama-offpeak/`](ollama-offpeak) | Whether Ollama Cloud bills at the peak or off-peak rate right now, and the time left on it. |
| [`opencode-go-quota/`](opencode-go-quota) | OpenCode Go usage (5-hour / weekly / monthly), this Session's allowance spend, and a free-model watch. |

The three quota chips sit in `conversation.composer.dock`, below the composer
card, and open a card above themselves. `provider-visibility` labels shipped
seats in place; `model-favorites` occupies `conversation.input.activity`, right
after the model selector. Copy is Japanese and English, following the active
DSH language.

## Install

Install **one package directory** — the repository root is only the workspace
that builds them, so it declares no bundle of its own.

### Web UI, local checkout

**Plugins** → **Add plugin** (the arrow beside it) → **Install a third-party
plugin**, then paste an absolute package path:

```
D:\eiviz\dsh-flowing-plugins\ollama-quota
```

Press **Install**, then **Enable now**, then reload the open page once.

### GitHub, UI or CLI

```sh
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-quota
```

or paste `github:FlowingSPDG/dsh-flowing-plugins/ollama-quota` into the same
dialog. All five:

```sh
for p in provider-visibility model-favorites ollama-quota ollama-offpeak opencode-go-quota; do
  dsh plugin --profile web add "github:FlowingSPDG/dsh-flowing-plugins/$p"
done
```

Remove one with `dsh plugin --profile web remove @local/ollama-quota`. A local
directory installs as a `link:` dependency, so rebuilding the workspace updates
it without reinstalling.

## Build

```sh
pnpm install
pnpm build      # regenerate every package's dist/
pnpm typecheck  # tsc over every package
pnpm test       # node --test over the pure helpers
pnpm smoke      # load every built bundle the way the page does
```

Edit `src/`. `dist/` is committed on purpose: it keeps `dsh plugin add`
build-free. A rebuilt bundle reaches the open page through DSH's client module
rebuild watch; a newly added package still needs the one page reload.

## `provider-visibility`

The shipped model seat never names the channel. This fills that in without
owning any control: `Provider · Model` in the trigger, the menu's current value
and each option (provider in the quieter color, truncating first), and quiet
`provider/model` chips under each finished turn read from its token-usage
attribution. No configuration.

## `model-favorites`

A ★ chip opens a panel listing favorites (or the whole catalog under **All**),
with a search field, a star per row and per provider, and a one-click star for
the model in use. Picking a row switches the Session model through the same
`session.selectModel` path the native menu uses. `↑`/`↓`, `Enter` and `Esc`
work; the native menu itself is left alone.

Favorites live on the Host in `$DSH_HOME/storages/model-favorites/state.json`
(`~/.dsh/...` when `DSH_HOME` is unset), served over `GET`/`POST
/model-favorites/state` below the authenticated carrier, so every browser on the
profile shares them. Writes are serialized and land through a temporary file
plus rename; a corrupt document is moved aside and answered with 500 rather than
silently replaced by an empty one. Changes from another device appear on the
next panel open or page reload.

## `ollama-quota`

The chip shows the remaining included credit, for example `$50.29/$60.00`;
clicking it opens the credit bar, the current period, when the reading was
taken, and this Session's Ollama-only request count, tokens, models and
estimated USD spend. A failed refresh keeps the last reading and marks it
stale; an unconfigured key shows `Ollama 未設定` / `Ollama not set up`.

The balance endpoint needs an `Authorization` header, so the key stays in the
Host: it resolves per call from the DSH credential store (falling back to the
process environment) and serves `GET api/ollama-quota/balance` and
`GET api/ollama-quota/session?sessionId=…` below the authenticated `/api`
carrier. The cache floor is 60 seconds, and `?force` is cooled down to respect
the endpoint's 10 requests/minute.

```yaml
- id: ollama-quota
  config:
    apiKeyEnv: OLLAMA_CLOUD_API_KEY   # credential reference
    baseUrl: https://ollama.com
    refreshSeconds: 60                # Host cache window; minimum 60
    provider: ollama-cloud
    # prices:                         # optional, USD per million tokens
    #   my-model: { input: 0.30, cached: 0.006, output: 1.20 }
```

The built-in price table mirrors `https://ollama.com/pricing`, including the
peak/off-peak rows. Override a row in your profile instead of editing the
package. Set the key through the credential store or `OLLAMA_CLOUD_API_KEY` in
the environment that launches `dsh`.

## `ollama-offpeak`

The chip names the current side and the time left — `ピーク · 1時間23分` /
`Peak · 1h23m` — and opens the published window, the next change and that
change in local time. Peak billing is weekdays 12:00–18:00 UTC; every other
hour, the whole weekend included, is off-peak. It needs no network and no
configuration.

> This reports the clock, not live pricing. If Ollama Cloud changes the
> schedule, update `PEAK_START_MINUTES` / `PEAK_END_MINUTES` in
> [`ollama-offpeak/src/peak.ts`](ollama-offpeak/src/peak.ts).

## `opencode-go-quota`

One chip for [OpenCode Go](https://opencode.ai/docs/console/go/), with three
parts in the open card:

- **Usage** — `5h 34% / 週 4% / 月 2%`, the three Go windows read from
  `GET https://opencode.ai/zen/go/v1/usage`, one bar each with its reset time in
  local clock; at 100% the chip turns red.
- **Session spend** — this Session's Go-only requests, tokens, models and
  estimated USD, using the published prices with their time multipliers and
  long-context tiers; free models are tagged `無料` / `free`.
- **Free-model watch** — the public model list is polled every 10 minutes to
  count the limited-time free models, badge new arrivals (`+N`), and show the
  watched models (`watchModels`, default `glm-5.3-flash`) as 現在無料 / 現在有料
  with a recent-changes list.

The Go key stays in the Host, resolved from the credential store, the launch
environment chain, or the ambient environment. Three exact routes sit below the
authenticated `/api` carrier: `usage`, `session?sessionId=…`, and
`free?ack=1`.

```yaml
- id: opencode-go-quota
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    baseUrl: https://opencode.ai
    refreshSeconds: 60                # usage cache; minimum 60
    freeRefreshSeconds: 600           # free-model watch; minimum 300
    provider: opencode-go
    watchModels: [glm-5.3-flash]
    # prices:                         # optional, USD per million tokens
    #   my-model: { input: 0.30, cached: 0.006, output: 1.20 }
```

The built-in table mirrors `https://opencode.ai/inference/go/v1/models`. The Go
allowance itself has no peak schedule; only a few models' token prices carry
time multipliers, which the Session estimate applies. The prepaid Zen credit
balance has no API-key endpoint, so this package reports allowance consumption
instead of guessing it.

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

The browser halves draw with the host's `--dsw-alias-*` theme tokens only, and
remove every resource they add (stylesheet, timers, slot registrations) when the
plugin unloads.

## License

MIT — see [LICENSE](LICENSE).
