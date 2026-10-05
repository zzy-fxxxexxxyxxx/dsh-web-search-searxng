/**
 * Regression suite for the SearXNG search provider.
 *
 * Runs against the real module with a stubbed global `fetch`, so the wire mapping,
 * URL construction, truncation, and error paths are exercised without a network or
 * a live SearXNG instance.
 *
 * Run: node test/provider.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

function checkThrows(name, fn) {
  try {
    fn();
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}  (did not throw)`);
  } catch {
    passed += 1;
    console.log(`  PASS  ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Stub global fetch before importing the module under test.
// ---------------------------------------------------------------------------

let lastRequest = null;
let nextResponse = null;

globalThis.fetch = async (url, init) => {
  lastRequest = { url: String(url), init };
  if (typeof nextResponse === 'function') return nextResponse(url, init);
  return nextResponse;
};

const MODULE_PATH = path.join(__dirname, '..', 'lib', 'index.js');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}

/** Build a provider whose options resolve from a plain object. */
function makeProvider(overrides = {}) {
  const options = {
    baseURL: 'http://127.0.0.1:8888',
    timeoutMs: 15000,
    language: '',
    categories: '',
    safesearch: 0,
    ...overrides,
  };
  return new mod.SearxngSearchProvider(() => options);
}

const mod = require(MODULE_PATH);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

console.log('\n-- pure helpers --');

check('normalizeBaseURL strips trailing slashes',
  mod.normalizeBaseURL('http://127.0.0.1:8888///'), 'http://127.0.0.1:8888');
check('normalizeBaseURL leaves a clean URL alone',
  mod.normalizeBaseURL('http://127.0.0.1:8888'), 'http://127.0.0.1:8888');

// SearXNG emits "YYYY-MM-DD HH:MM:SS" with no zone; the seam documents ISO-8601.
const isoFromSpace = mod.toISODate('2026-10-05 02:08:00');
check('toISODate converts space-separated to ISO-8601',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(isoFromSpace), true);
check('toISODate passthrough for ISO input',
  mod.toISODate('2026-10-05T02:08:00.000Z'), '2026-10-05T02:08:00.000Z');
check('toISODate returns undefined for empty string', mod.toISODate(''), undefined);
check('toISODate returns undefined for null', mod.toISODate(null), undefined);
check('toISODate returns undefined for garbage', mod.toISODate('not a date'), undefined);
check('toISODate handles seconds-omitted form',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(mod.toISODate('2026-10-05 02:08')), true);

check('toSource maps url/title/content/pubdate', mod.toSource({
  url: 'https://example.com/a',
  title: 'Example',
  content: 'A snippet',
  pubdate: '2026-10-05 02:08:00',
}), {
  url: 'https://example.com/a',
  title: 'Example',
  snippet: 'A snippet',
  publishedAt: mod.toISODate('2026-10-05 02:08:00'),
});

check('toSource drops entries without a url', mod.toSource({ title: 'x' }), undefined);
check('toSource drops entries with a blank url', mod.toSource({ url: '   ' }), undefined);
check('toSource omits blank title/snippet',
  mod.toSource({ url: 'https://example.com/', title: '', content: '' }),
  { url: 'https://example.com/', title: undefined, snippet: undefined, publishedAt: undefined });
check('toSource reads publishedDate as a fallback',
  mod.toSource({ url: 'https://example.com/', publishedDate: '2026-01-02T03:04:05Z' }).publishedAt,
  '2026-01-02T03:04:05.000Z');

// ---------------------------------------------------------------------------
// available()
// ---------------------------------------------------------------------------

console.log('\n-- available() --');

check('available() true for a valid base URL', makeProvider().available(), true);
check('available() false for a malformed base URL',
  makeProvider({ baseURL: 'not a url' }).available(), false);
check('available() false for a non-positive timeout',
  makeProvider({ timeoutMs: 0 }).available(), false);
check('available() never hits the network', (() => {
  lastRequest = null;
  makeProvider().available();
  return lastRequest === null;
})(), true);

// ---------------------------------------------------------------------------
// search(): request construction
// ---------------------------------------------------------------------------

(async () => {
  console.log('\n-- search(): request --');

  nextResponse = jsonResponse({ results: [] });
  await makeProvider().search({ query: 'hello world' });
  check('requests {baseURL}/search',
    lastRequest.url.startsWith('http://127.0.0.1:8888/search'), true);
  check('sends format=json',
    new URL(lastRequest.url).searchParams.get('format'), 'json');
  check('sends q verbatim',
    new URL(lastRequest.url).searchParams.get('q'), 'hello world');
  check('omits language when unset',
    new URL(lastRequest.url).searchParams.has('language'), false);
  check('omits categories when unset',
    new URL(lastRequest.url).searchParams.has('categories'), false);
  check('omits limit when maxResults is absent',
    new URL(lastRequest.url).searchParams.has('limit'), false);

  nextResponse = jsonResponse({ results: [] });
  await makeProvider({ language: 'zh-CN', categories: 'news' }).search({ query: 'q' });
  check('sends language when configured',
    new URL(lastRequest.url).searchParams.get('language'), 'zh-CN');
  check('sends categories when configured',
    new URL(lastRequest.url).searchParams.get('categories'), 'news');

  nextResponse = jsonResponse({ results: [] });
  await makeProvider({ baseURL: 'http://127.0.0.1:8888/' }).search({ query: 'q' });
  check('no doubled slash with a trailing-slash base URL',
    lastRequest.url.startsWith('http://127.0.0.1:8888/search'), true);

  // -------------------------------------------------------------------------
  // search(): mapping and truncation
  // -------------------------------------------------------------------------

  console.log('\n-- search(): mapping --');

  nextResponse = jsonResponse({
    results: [
      { url: 'https://a.example/1', title: 'A', content: 'first', pubdate: '2026-10-05 02:08:00' },
      { url: 'https://b.example/2', title: 'B', content: 'second' },
      { title: 'no url — dropped' },
      { url: 'https://a.example/1', title: 'duplicate — dropped' },
    ],
  });
  const mapped = await makeProvider().search({ query: 'q' });
  check('maps sources and drops url-less entries', mapped.sources.length, 2);
  check('deduplicates repeated urls', mapped.sources.map((s) => s.url),
    ['https://a.example/1', 'https://b.example/2']);
  check('maps content to snippet', mapped.sources[0].snippet, 'first');
  check('reports truncated=false when nothing was dropped by the limit',
    mapped.truncated, false);
  check('no provider summary content', mapped.content, undefined);

  nextResponse = jsonResponse({
    results: Array.from({ length: 10 }, (_, i) => ({ url: `https://x.example/${i}`, title: `T${i}` })),
  });
  const bounded = await makeProvider().search({ query: 'q', maxResults: 3 });
  check('honors maxResults', bounded.sources.length, 3);
  check('sets truncated when the limit dropped sources', bounded.truncated, true);
  check('passes maxResults through to SearXNG as limit',
    new URL(lastRequest.url).searchParams.get('limit'), '3');

  nextResponse = jsonResponse({ results: [{ url: 'https://x.example/0' }] });
  const underLimit = await makeProvider().search({ query: 'q', maxResults: 5 });
  check('truncated=false when under the limit', underLimit.truncated, false);

  nextResponse = jsonResponse({});
  const noResults = await makeProvider().search({ query: 'q' });
  check('tolerates a payload without results[]', noResults.sources, []);

  nextResponse = jsonResponse({ results: 'not an array' });
  const badResults = await makeProvider().search({ query: 'q' });
  check('tolerates a non-array results field', badResults.sources, []);

  // -------------------------------------------------------------------------
  // search(): error paths
  // -------------------------------------------------------------------------

  console.log('\n-- search(): errors --');

  nextResponse = jsonResponse({ error: 'nope' }, 429);
  await checkThrowsAsync('throws WebError on a non-2xx response', async () => {
    await makeProvider().search({ query: 'q' });
  });

  nextResponse = {
    ok: true, status: 200, statusText: 'OK',
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  };
  await checkThrowsAsync('throws a clear error when the body is not JSON (format:json disabled)',
    async () => { await makeProvider().search({ query: 'q' }); });

  nextResponse = () => { throw new TypeError('fetch failed'); };
  await checkThrowsAsync('throws WebError when the connection fails',
    async () => { await makeProvider().search({ query: 'q' }); });

  // A caller-side abort must stay an abort, not be reclassified as provider failure.
  nextResponse = () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const controller = new AbortController();
  controller.abort();
  let abortName = null;
  try {
    await makeProvider().search({ query: 'q' }, controller.signal);
  } catch (error) {
    abortName = error.name;
  }
  check('rethrows caller cancellation as-is', abortName, 'AbortError');

  // -------------------------------------------------------------------------
  // module surface
  // -------------------------------------------------------------------------

  console.log('\n-- module surface --');

  check('exports a stable provider id', mod.SEARXNG_PROVIDER_ID, 'searxng');

  // The seam keys its registry by this id and registers a missing one as
  // `undefined`, which then collides on the second mount. Guarding it here
  // because the original suite read the exported constant instead of the
  // instance and missed the bug entirely.
  check('provider INSTANCE carries the id', makeProvider().id, 'searxng');
  check('provider id matches the exported constant', makeProvider().id, mod.SEARXNG_PROVIDER_ID);
  check('two instances register under the same id (no undefined collision)',
    [makeProvider().id, makeProvider().id], ['searxng', 'searxng']);
  check('injects the web seam', mod.inject, ['web']);
  const capture = () => {
    let registered = null;
    const ctx = { web: { registerSearchProvider: (p) => { registered = p; } } };
    mod.apply(ctx, mod.Config({}));
    return registered;
  };
  check('apply() registers a provider with ctx.web', capture() !== null, true);
  check('registered provider exposes available() and search()', (() => {
    const p = capture();
    return [typeof p?.available, typeof p?.search];
  })(), ['function', 'function']);
  check('registered provider is usable with default config',
    capture().available(), true);

  // -------------------------------------------------------------------------

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\nFailures: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
})();

async function checkThrowsAsync(name, fn) {
  try {
    await fn();
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}  (did not throw)`);
  } catch {
    passed += 1;
    console.log(`  PASS  ${name}`);
  }
}
