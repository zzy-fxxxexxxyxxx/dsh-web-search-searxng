import { WebError } from "@deepseek-ai/dsh-web";

/**
 * SearXNG-backed search provider implementation.
 *
 * Kept apart from the plugin entry so the Loader's contract (apply / inject /
 * Config / name) stays in one file and the pure helpers remain testable.
 *
 * @module dsh-web-search-searxng/provider
 */

/** Stable id this provider registers under. */
const SEARXNG_PROVIDER_ID = "searxng";

/** Default SearXNG base URL on this host. */
const SEARXNG_DEFAULT_BASE_URL = "http://127.0.0.1:8888";

/** Default request timeout in milliseconds. */
const SEARXNG_DEFAULT_TIMEOUT_MS = 15000;

/**
 * Strip trailing slashes so `${baseURL}/search` never doubles up.
 * @param value - the raw configured base URL.
 * @returns the base URL without a trailing slash.
 */
function normalizeBaseURL(value) {
    return value.replace(/\/+$/, "");
}

/**
 * Project a SearXNG `pubdate` / `publishedDate` value into the ISO-8601 string the
 * seam expects, or `undefined` when it cannot be interpreted.
 *
 * SearXNG emits `"YYYY-MM-DD HH:MM:SS"` (space-separated, no zone). The seam
 * documents `publishedAt` as "a provider-supplied ISO-8601 string", so passing the
 * raw value through would violate the contract. The timestamp carries no offset, so
 * it is interpreted as local time.
 *
 * @param value - the provider-supplied date string, if any.
 * @returns an ISO-8601 string, or `undefined`.
 */
function toISODate(value) {
    if (typeof value !== "string" || value.trim() === "") return void 0;
    const raw = value.trim();
    // Already ISO-8601 (with or without zone) — accept as-is.
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
    }
    // SearXNG's "YYYY-MM-DD HH:MM:SS" — space-separated local time.
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    if (match === null) {
        // Date-only, e.g. "2026-10-05".
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
    }
    const [, y, mo, d, h, mi, s] = match;
    const parsed = new Date(
        Number(y), Number(mo) - 1, Number(d),
        Number(h), Number(mi), Number(s ?? "0"),
    );
    return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
}

/**
 * Map one SearXNG result onto the seam's source shape.
 *
 * `url` is the only required field; a result without one is not citeable and is
 * dropped by the caller. SearXNG's `content` is the snippet, and `title` is usually
 * present but not guaranteed.
 *
 * @param result - one entry from the SearXNG `results` array.
 * @returns a seam source, or `undefined` when the entry carries no URL.
 */
function toSource(result) {
    if (result === null || typeof result !== "object") return void 0;
    const url = typeof result.url === "string" ? result.url.trim() : "";
    if (url === "") return void 0;
    const title = typeof result.title === "string" && result.title.trim() !== ""
        ? result.title.trim()
        : void 0;
    const snippet = typeof result.content === "string" && result.content.trim() !== ""
        ? result.content.trim()
        : void 0;
    const publishedAt = toISODate(result.publishedDate ?? result.pubdate);
    return { url, title, snippet, publishedAt };
}

/** A search-capable backend over a SearXNG JSON endpoint. */
class SearxngSearchProvider {
    /**
     * Stable registry key. The seam rejects a duplicate id, and a missing one
     * registers as `undefined`, so this must be set on the instance itself.
     */
    id = SEARXNG_PROVIDER_ID;

    /**
     * @param resolveOptions - options for the next operation, snapshotted at entry.
     */
    constructor(resolveOptions) {
        this.resolveOptions = resolveOptions;
    }

    /**
     * Cheap local usability check; never makes a network call. A malformed base URL
     * or a non-positive timeout means searches cannot run at all.
     */
    available() {
        const options = this.resolveOptions();
        return URL.canParse(options.baseURL)
            && Number.isInteger(options.timeoutMs)
            && options.timeoutMs > 0;
    }

    /**
     * Run one search against `GET {baseURL}/search`.
     * @param request - the seam request; only `query` and `maxResults` are read.
     * @param signal - caller cancellation.
     * @returns normalized sources, truncated per the seam contract.
     */
    async search(request, signal) {
        const options = this.resolveOptions();
        const url = new URL(`${normalizeBaseURL(options.baseURL)}/search`);
        url.searchParams.set("q", request.query);
        url.searchParams.set("format", "json");
        if (options.language !== void 0 && options.language !== "") {
            url.searchParams.set("language", options.language);
        }
        if (options.categories !== void 0 && options.categories !== "") {
            url.searchParams.set("categories", options.categories);
        }
        if (options.safesearch !== void 0) {
            url.searchParams.set("safesearch", String(options.safesearch));
        }

        // The seam enforces maxResults too, but asking SearXNG for fewer results
        // avoids transferring pages of entries we would drop anyway.
        if (typeof request.maxResults === "number" && request.maxResults > 0) {
            url.searchParams.set("limit", String(request.maxResults));
        }

        const timeout = AbortSignal.timeout(options.timeoutMs);
        const combined = signal === void 0
            ? timeout
            : AbortSignal.any([signal, timeout]);

        let response;
        try {
            response = await fetch(url, {
                method: "GET",
                headers: { accept: "application/json" },
                signal: combined,
            });
        } catch (cause) {
            // Surface cancellation distinctly so the caller can tell "user stopped
            // this" from "SearXNG is broken".
            if (signal?.aborted === true) throw cause;
            throw new WebError("WEB_PROVIDER_FAILED", `SearXNG request failed: ${String(cause)}`, { cause });
        }

        if (!response.ok) {
            throw new WebError(
                "WEB_PROVIDER_FAILED",
                `SearXNG returned HTTP ${response.status} ${response.statusText}`,
            );
        }

        let payload;
        try {
            payload = await response.json();
        } catch (cause) {
            throw new WebError(
                "WEB_PROVIDER_FAILED",
                "SearXNG returned a body that is not JSON; check that `format: json` is enabled in settings.yml",
                { cause },
            );
        }

        const raw = Array.isArray(payload?.results) ? payload.results : [];
        const sources = [];
        const seen = new Set();
        for (const entry of raw) {
            const source = toSource(entry);
            if (source === void 0) continue;
            // SearXNG merges the same URL from several engines; keep the first.
            if (seen.has(source.url)) continue;
            seen.add(source.url);
            sources.push(source);
        }

        const limit = typeof request.maxResults === "number" && request.maxResults > 0
            ? request.maxResults
            : void 0;
        const truncated = limit !== void 0 && sources.length > limit;
        const bounded = limit === void 0 ? sources : sources.slice(0, limit);

        return { sources: bounded, truncated };
    }
}

/**
 * Test-only entry point. The Loader reads only the top-level exports
 * (`apply` / `inject` / `Config` / `name`); the pure helpers and the class are
 * re-exported from `./test-api.js` so the suite can exercise them without
 * widening the plugin's public surface.
 */


export {
    SearxngSearchProvider,
    SEARXNG_DEFAULT_BASE_URL,
    SEARXNG_DEFAULT_TIMEOUT_MS,
    SEARXNG_PROVIDER_ID,
    normalizeBaseURL,
    toISODate,
    toSource,
};
