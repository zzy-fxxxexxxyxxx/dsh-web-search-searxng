# @zzy-fxxxexxxyxxx/dsh-web-search-searxng

English | [中文](README.zh.md)

## Summary

A [SearXNG](https://searxng.org/)-backed search provider for DeepSeek Harness'
web capability seam (`ctx.web`).

DeepSeek Harness ships one search backend, `@deepseek-ai/dsh-web-search-deepseek`,
which runs the search *inside a full model turn*: one search costs one Messages
call's latency and generated tokens. This package replaces that with a plain HTTP
request to a SearXNG instance you run yourself — no model API key, no per-search
token cost, and typically one to three seconds instead of a model round trip.

## When to choose it

Choose this backend when:

- You already run SearXNG (for example for another agent on the same host), so the
  marginal cost of reusing it is zero.
- Per-search latency or token spend matters more than the model-written summary
  that the DeepSeek backend can return.
- You want web search to keep working when your conversation model's API is
  unavailable — the two use separate credentials and endpoints.

Official DeepSeek model types map to the following trade-off: this provider
returns aggregated engine results (title, URL, snippet), not a model-composed
answer. Searches are also only as good as the engines your SearXNG instance
aggregates.

## Install

### From npm (recommended)

```sh
dsh plugin --profile <profile> add @zzy-fxxxexxxyxxx/dsh-web-search-searxng
```

### From GitHub

```sh
dsh plugin --profile <profile> add github:zzy-fxxxexxxyxxx/dsh-web-search-searxng
```

Either form installs the package **and** applies the bundle's own
`cordis.patch.yml`, which registers the provider and pins it as the active search
backend. **No manual patch editing is required.**

> If your `dsh` version does not apply the bundle patch automatically, see
> [Manual patch](#manual-patch-fallback) below.

Then restart the service to apply. Installing and pinning in one restart is worth
doing: each restart interrupts any in-flight session.

### Manual patch (fallback)

If the bundle patch was not applied — for example on an older `dsh`, or when the
dependency landed in `dependencies` without being added to
`dsh.profile.bundles` — append this to
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: web-search-searxng
      name: '@zzy-fxxxexxxyxxx/dsh-web-search-searxng'
      config:
        baseURL: http://127.0.0.1:8888
```

Then point the web seam at it. The shipped base layer already pins
`deepseek-official`, so without this override search keeps using DeepSeek:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: searxng
    fetchProvider: http
```

A patch replaces the targeted row's **whole** `config`, which is why
`fetchProvider` is restated above — omitting it would leave URL fetching
unconfigured.

### Provider selection

The seam refuses to guess. With no `searchProvider` pinned and more than one
usable search provider registered, every search fails with
`WEB_PROVIDER_AMBIGUOUS` rather than picking one silently. Pin `searxng`
explicitly, or remove the other provider.

`baseURL` defaults to `http://127.0.0.1:8888`, SearXNG's default listener.

### SearXNG must expose JSON

The provider calls `GET {baseURL}/search?format=json`. SearXNG disables the JSON
format unless `settings.yml` opts in:

```yaml
search:
  formats:
    - html
    - json
```

A response that is not JSON fails loudly with an explanatory error rather than
degrading silently.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `baseURL` | `http://127.0.0.1:8888` | SearXNG base URL; `/search` is appended. |
| `timeoutMs` | `15000` | Per-search request timeout. |
| `language` | `""` | Passed as SearXNG's `language` parameter when non-empty. |
| `categories` | `""` | Passed as SearXNG's `categories` parameter when non-empty. |
| `safesearch` | `0` | SearXNG `safesearch` level (0 off, 1 moderate, 2 strict). |

`maxResults` on the incoming request is forwarded to SearXNG as `limit` (a
transfer optimisation) *and* enforced by the provider, so the returned source list
never exceeds it.

## How it maps results

| SearXNG field | Seam field | Notes |
| --- | --- | --- |
| `url` | `url` | Required; entries without one are dropped. |
| `title` | `title` | Omitted when blank. |
| `content` | `snippet` | Omitted when blank. |
| `pubdate` / `publishedDate` | `publishedAt` | Normalised to ISO-8601 when needed. |

A source's `publishedAt` must be an ISO-8601 string per the seam contract. Recent
SearXNG builds already emit ISO-8601 (`2026-04-25T14:58:18`, sometimes with an
offset or fractional seconds), which passes through unchanged. Older or
engine-specific values that arrive space-separated (`"YYYY-MM-DD HH:MM:SS"`, local
time with no zone) are parsed and converted; values that cannot be interpreted are
dropped rather than invented.

Results are de-duplicated by URL, because SearXNG merges the same page from
several engines.

## Known limitations

- **One instance, no failover.** A down SearXNG instance fails the search; there
  is no secondary backend.
- **No model-composed summary.** The seam's optional `content` field is left
  unset; only sources are returned.
- **Latency is engine-dependent.** Aggregating many upstream engines commonly
  takes one to three seconds, longer than a single-engine lookup.
- **No fetch provider.** This package implements search only. URL retrieval still
  needs a fetch backend such as `@deepseek-ai/dsh-web-fetch-http`.
- **Upstream engines get rate-limited.** A self-hosted instance commonly sees
  CAPTCHAs and HTTP 429 from large engines; result quality is bounded by that.

## Test

```sh
node test/provider.test.cjs
```

The suite stubs `fetch`, so it needs no network and no running SearXNG. It covers
URL construction, field mapping, de-duplication, truncation, and the error paths
(non-2xx, non-JSON body, connection failure, caller cancellation). `test/live.cjs`
optionally exercises a real instance on `127.0.0.1:8888`.

## License

MIT
