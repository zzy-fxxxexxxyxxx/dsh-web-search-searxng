# @zzy-fxxxexxxyxxx/dsh-web-search-searxng

[English](README.md) | 中文

## 概述

为 DeepSeek Harness 的 web 能力缝（`ctx.web`）提供一个基于
[SearXNG](https://searxng.org/) 的搜索 provider。

DeepSeek Harness 自带一个搜索后端 `@deepseek-ai/dsh-web-search-deepseek`，
它把搜索**放进一整个模型回合**里跑：一次搜索 = 一次 Messages 调用的延迟，且会消耗生成的 token。
本包把它换成对你自建 SearXNG 实例的一次普通 HTTP 请求 —— 不需要模型 API key、
每次搜索不花 token，通常 1~3 秒返回，而不是等一个模型回合。

## 什么时候该选它

适合以下场景：

- 你已经在跑 SearXNG（例如为同主机上的另一个 agent 服务），复用它边际成本为零。
- 相比 DeepSeek 后端能给出的「模型撰写的摘要」，你更在意单次搜索的延迟或 token 开销。
- 你希望对话模型的 API 不可用时，网页搜索仍然能用 —— 两者用的是不同凭据、不同端点。

官方 DeepSeek 后端与本包的取舍：本 provider 返回的是聚合后的引擎结果
（标题、URL、摘要片段），**不是**模型组织的答案。检索质量也取决于你 SearXNG 实例聚合了哪些引擎。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile <profile> add @zzy-fxxxexxxyxxx/dsh-web-search-searxng
```

### 从 GitHub 安装

```sh
dsh plugin --profile <profile> add github:zzy-fxxxexxxyxxx/dsh-web-search-searxng
```

两种方式都会同时安装本包**并应用**其自带的 `cordis.patch.yml` —— 该 patch 会注册 provider
并把它 pin 成当前生效的搜索后端。**无需手动改 patch。**

> 如果你的 `dsh` 版本不会自动应用 bundle patch，见下方
> [手动 patch（兜底）](#手动-patch兜底)。

随后重启服务生效。建议「装包 + pin」在同一次重启里做完：每次重启都会打断正在进行中的会话。

### 手动 patch（兜底）

若 bundle patch 未被应用 —— 例如 `dsh` 版本较旧，或依赖只落进了 `dependencies`
而没被加进 `dsh.profile.bundles` —— 把下面这段追加到
`$DSH_HOME/profiles/<profile>/cordis.patch.yml` 末尾：

```yaml
- insert:
    - id: web-search-searxng
      name: '@zzy-fxxxexxxyxxx/dsh-web-search-searxng'
      config:
        baseURL: http://127.0.0.1:8888
```

然后让 web 缝指向它。基础层已经 pin 了 `deepseek-official`，
所以不做这步覆盖的话，搜索仍会走 DeepSeek：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: searxng
    fetchProvider: http
```

patch 会替换目标行**整份** `config`，这就是上面必须重述 `fetchProvider` 的原因 ——
漏掉它会让 URL 抓取失去配置。

### 关于 provider 选择（重要）

搜索缝不会自己猜。若没有 pin `searchProvider` 且注册了**多于一个**可用搜索 provider，
每次搜索都会以 `WEB_PROVIDER_AMBIGUOUS` 失败，而不是静默挑一个。
请显式 pin `searxng`，或移除另一个 provider。

`baseURL` 默认是 `http://127.0.0.1:8888`，即 SearXNG 的默认监听地址。

### SearXNG 必须开启 JSON 格式

本 provider 调用 `GET {baseURL}/search?format=json`。除非 `settings.yml` 显式开启，
SearXNG **默认关闭** JSON 格式：

```yaml
search:
  formats:
    - html
    - json
```

返回体不是 JSON 时会**明确报错并给出说明**，而不是静默降级。

## 配置项

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | `http://127.0.0.1:8888` | SearXNG 基础地址；会自动追加 `/search`。 |
| `timeoutMs` | `15000` | 单次搜索请求超时（毫秒）。 |
| `language` | `""` | 非空时作为 SearXNG 的 `language` 参数传入。 |
| `categories` | `""` | 非空时作为 SearXNG 的 `categories` 参数传入。 |
| `safesearch` | `0` | SearXNG 安全搜索等级（0 关、1 中、2 严）。 |

请求里的 `maxResults` 会作为 `limit` 转发给 SearXNG（传输优化），**同时**由 provider 自身
强制执行，因此返回的来源列表绝不会超过该值。

## 结果字段映射

| SearXNG 字段 | 缝字段 | 说明 |
| --- | --- | --- |
| `url` | `url` | 必需；没有 URL 的条目会被丢弃。 |
| `title` | `title` | 为空时省略。 |
| `content` | `snippet` | 为空时省略。 |
| `pubdate` / `publishedDate` | `publishedAt` | 必要时归一化为 ISO-8601。 |

按缝的契约，来源的 `publishedAt` 必须是 ISO-8601 字符串。较新的 SearXNG 版本本身就输出
ISO-8601（如 `2026-04-25T14:58:18`，有时带时区偏移或小数秒），这类值会原样透传。
较旧版本或个别引擎给出的空格分隔格式（`"YYYY-MM-DD HH:MM:SS"`，无时区的本地时间）
会被解析并转换；无法解释的值会被**丢弃**，而不是凭空编造。

结果按 URL 去重，因为 SearXNG 会从多个引擎合并同一个页面。

## 已知限制

- **单实例、无故障转移。** SearXNG 挂了搜索就失败，没有备用后端。
- **不返回模型摘要。** 缝的可选 `content` 字段留空，只返回来源列表。
- **延迟取决于引擎。** 聚合多个上游引擎通常需要 1~3 秒，比单引擎查询慢。
- **不实现 fetch provider。** 本包只做搜索。URL 抓取仍需
  `@deepseek-ai/dsh-web-fetch-http` 之类的 fetch 后端。
- **上游引擎常被限流。** 自建实例常见大引擎返回 CAPTCHA 或 HTTP 429，结果质量受此制约。

## 测试

```sh
node test/provider.test.cjs
```

测试套件对 `fetch` 打了桩，因此不需要网络、也不需要跑着 SearXNG。覆盖范围包括
URL 构造、字段映射、去重、截断，以及各条错误路径（非 2xx、非 JSON 返回体、连接失败、调用方取消）。
`test/live.cjs` 可选地对 `127.0.0.1:8888` 上的真实实例做一次集成验证。

## 许可证

MIT
