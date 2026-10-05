// Live integration: the real provider against the real SearXNG on this host.
const path = require('node:path');
const mod = require(path.join(__dirname, '..', 'lib', 'index.js'));

(async () => {
  const provider = new mod.SearxngSearchProvider(() => ({
    baseURL: 'http://127.0.0.1:8888',
    timeoutMs: 20000,
    language: '', categories: '', safesearch: 0,
  }));

  console.log('available():', provider.available());
  if (!provider.available()) { console.log('SKIP — provider reports unavailable'); return; }

  const t0 = Date.now();
  const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 });
  const ms = Date.now() - t0;

  console.log(`latency: ${ms}ms`);
  console.log(`sources: ${result.sources.length}  truncated: ${result.truncated}`);
  console.log('---');
  for (const s of result.sources) {
    const iso = s.publishedAt ? ` [${s.publishedAt}]` : '';
    console.log(`  ${s.title ?? '(no title)'}${iso}`);
    console.log(`    ${s.url}`);
    console.log(`    ${(s.snippet ?? '').slice(0, 70)}...`);
  }
  console.log('---');

  // Contract checks against live data.
  const problems = [];
  if (result.sources.length === 0) problems.push('no sources returned');
  if (result.sources.length > 5) problems.push('maxResults not honored');
  for (const s of result.sources) {
    if (typeof s.url !== 'string' || !URL.canParse(s.url)) problems.push(`bad url: ${s.url}`);
    if (s.publishedAt !== undefined && !/^\d{4}-\d{2}-\d{2}T/.test(s.publishedAt)) {
      problems.push(`publishedAt not ISO-8601: ${s.publishedAt}`);
    }
  }
  console.log(problems.length === 0 ? 'CONTRACT OK' : 'CONTRACT PROBLEMS: ' + problems.join('; '));
})();
