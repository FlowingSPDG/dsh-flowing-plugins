# dsh-flowing-plugins

Small [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web UI plugins for
the composer's session-stats row. Each package is self-contained plain
JavaScript: no build step, no dependencies, no install scripts.

| Package | What it shows |
|---|---|
| [`ollama-quota/`](ollama-quota) | Remaining Ollama Cloud credit, plus the tokens this Session has used. |
| [`deepseek-peak/`](deepseek-peak) | Whether DeepSeek-V4.1-Flash currently bills at the peak or off-peak rate, and the time left on it. |

Both render as ambient chips in the `conversation.composer.stats.lead` slot,
below the composer card and next to the shipped branch chip. Copy is Japanese
and English; the chip follows the active DSH language.

## Install

Install one package from this repository into a DSH profile. Replace `web` with
the profile you use.

```sh
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/ollama-quota
dsh plugin --profile web add github:FlowingSPDG/dsh-flowing-plugins/deepseek-peak
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

Two chips:

- **Balance** — remaining included credit and allowance, for example
  `$50.29/$60.00`. The tooltip adds the purchased credit, the total, the current
  period, and when the reading was taken. A failed refresh keeps the last
  reading and marks the chip as stale; an unconfigured key shows
  `Ollama 未設定` / `Ollama not set up` instead of a guess.
- **Session tokens** — `↑input ↓output` over the whole Session, read from the
  durable `tokenUsage` projection the Host folds from the complete session log,
  so paging and compaction do not change it. The tooltip lists every billing
  bucket (uncached input, cache read, cache write, output) and the cache-hit
  share.

### The API key stays in the Host

The balance endpoint needs the account key in an `Authorization` header, so the
browser never holds it. The Host half resolves the key per call from the DSH
credential store (falling back to the process environment), calls
`GET https://ollama.com/api/balance`, caches one answer, and serves the result to
the page over an exact `GET api/ollama-quota/balance` route registered through
`ctx.connection.fetch.register`. That route lives below the authenticated `/api`
carrier, so the page's own browser-session cookie is the only credential the
browser presents.

The endpoint allows 10 requests per minute per user, so the Host cache floor is
60 seconds no matter what the configuration says.

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
```

Set the key once, either through the DSH credential store (the Models settings
page writes provider keys there) or as `OLLAMA_CLOUD_API_KEY` in the
environment that launches `dsh`.

## `deepseek-peak`

One chip naming the current billing side of DeepSeek-V4.1-Flash on Ollama
Cloud, with the time left before it changes:

- `ピーク · 1時間23分` / `Peak · 1h23m` — inside the peak window;
- `オフピーク · 2日3時間` / `Off-peak · 2d 3h` — outside it.

The window is the published Ollama Cloud off-peak schedule: peak billing is
weekdays 12:00–18:00 UTC, and every other hour — the whole UTC weekend included
— bills at the off-peak rate. That is the same window the shipped `llm-pi-ai`
Ollama Cloud route carries for its peak routing. The chip recomputes twice a
minute and needs no network and no configuration.

> This chip reports the clock, not your provider's live pricing. If Ollama
> Cloud changes its peak schedule, update `PEAK_START_MINUTES` /
> `PEAK_END_MINUTES` in [`deepseek-peak/client.js`](deepseek-peak/client.js).

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
