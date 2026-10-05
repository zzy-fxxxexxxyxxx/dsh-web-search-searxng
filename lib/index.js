import z from "@deepseek-ai/schemastery";
import {
    SearxngSearchProvider,
    SEARXNG_DEFAULT_BASE_URL,
    SEARXNG_DEFAULT_TIMEOUT_MS,
} from "./provider.js";

/**
 * SearXNG-backed search provider for the DeepSeek Harness web capability seam
 * (`ctx.web`).
 *
 * SearXNG is a self-hosted metasearch engine that aggregates upstream engines and
 * exposes a JSON API. Unlike the DeepSeek provider — which pays a full model turn
 * per search — this is a plain HTTP call: fast, free, and independent of any model
 * API key. The trade-off is that the deployment must run SearXNG itself.
 *
 * The Loader reads only `apply` / `inject` / `Config` / `name` from this module.
 *
 * @module dsh-web-search-searxng
 */

/** Plugin name other rows reference. */
export const name = "dsh-web-search-searxng";

/** The web seam this provider registers into. */
export const inject = ["web"];

export const Config = z.object({
    baseURL: z.string().default(SEARXNG_DEFAULT_BASE_URL).volatile(),
    timeoutMs: z.number().step(1).min(1).default(SEARXNG_DEFAULT_TIMEOUT_MS).volatile(),
    language: z.string().default("").volatile(),
    categories: z.string().default("").volatile(),
    safesearch: z.number().step(1).min(0).max(2).default(0).volatile(),
});

/** Resolve the options one search runs with. */
function resolveOptions(config) {
    return {
        baseURL: config.baseURL.get(),
        timeoutMs: config.timeoutMs.get(),
        language: config.language.get(),
        categories: config.categories.get(),
        safesearch: config.safesearch.get(),
    };
}

/** Register the SearXNG search provider with `ctx.web`. */
export function apply(ctx, config) {
    ctx.web.registerSearchProvider(
        new SearxngSearchProvider(() => resolveOptions(config)),
    );
}

/**
 * Re-exported for the test suite only. The Loader ignores these; they let the
 * suite exercise the pure helpers against the very module the plugin loads.
 */
export {
    SearxngSearchProvider,
    SEARXNG_PROVIDER_ID,
    normalizeBaseURL,
    toISODate,
    toSource,
} from "./provider.js";
