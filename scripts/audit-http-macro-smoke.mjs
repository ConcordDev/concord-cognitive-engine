#!/usr/bin/env node
// scripts/audit-http-macro-smoke.mjs
//
// HTTP-layer smoke test: fires `POST /api/lens/run` for every
// (domain, macro) pair the live server has registered, with the
// same minimal-input shape the behavior-smoke harness uses. This is
// what `tests/behavior/lens-behavior-smoke.behavior.js` does in-
// process; doing it over HTTP catches a different bug class —
// auth middleware, rate limiting, serialization, route mounting,
// CSRF, bot-guard.
//
// Requires: backend on http://127.0.0.1:5050 with CONCORD_FORCE_LISTEN=true
//
// Output: audit/http-macro-smoke.json + audit/http-macro-smoke.md

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:5050';

// Load the macro list from the depth grader's output (it's the
// canonical inventory of every registered (domain, macro)).
const depth = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'macro-depth.json'), 'utf8'));
const allMacros = depth.macros.map(m => ({ domain: m.domain, macro: m.macro }));

console.error(`Smoke-testing ${allMacros.length} macros against ${BACKEND}…`);

// Skip patterns mirroring the behavior-smoke harness (don't fire LLM
// or destructive calls against a live server).
const LLM_RE = /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|score|evaluate|grade|review|writeReply|composeMessage|debate|persuade|argue)$|llm|brain/i;
const SKIP_DOMAINS = new Set(['oracle', 'concordance']);

// User-Agent is critical — the backend's bot guard returns 403 for
// non-browsery agents on read-only paths. We send a real Chromium UA
// so the requests look like a browser. Auth: the smoke doesn't have
// a user session, so it'll hit the unauthenticated path. The bot
// guard + auth middleware are what we're TESTING, not bypassing.
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const CONCURRENCY = 8;
const queue = allMacros.slice();
const results = [];
let done = 0;

async function worker() {
  while (queue.length) {
    const job = queue.shift();
    if (!job) break;
    const r = await testOne(job);
    results.push(r);
    done++;
    if (done % 200 === 0) process.stderr.write(`  ${done}/${allMacros.length}\n`);
  }
}

async function testOne({ domain, macro }) {
  // Skip patterns
  if (SKIP_DOMAINS.has(domain)) return { domain, macro, skipped: 'domain-blacklist' };
  if (LLM_RE.test(macro)) return { domain, macro, skipped: 'llm-hint' };

  const body = JSON.stringify({
    domain, name: macro,
    input: { artifact: { id: `http-smoke-${domain}-${macro}`, data: {} } },
  });
  const start = Date.now();
  try {
    const r = await fetch(`${BACKEND}/api/lens/run`, {
      method: 'POST',
      headers: HEADERS,
      body,
      // node-fetch follows redirects by default
    });
    const ms = Date.now() - start;
    const status = r.status;
    let envelope = null;
    let parseError = null;
    try {
      const text = await r.text();
      try { envelope = JSON.parse(text); }
      catch (e) { parseError = `json-parse: ${String(e?.message || e).slice(0, 100)}; body: ${text.slice(0, 80)}`; }
    } catch (e) { parseError = `body-read: ${String(e?.message || e).slice(0, 100)}`; }
    const okShape = envelope && typeof envelope === 'object' && 'ok' in envelope && typeof envelope.ok === 'boolean';
    return {
      domain, macro, status, ms, okShape,
      ok: envelope?.ok ?? null,
      error: envelope?.error ?? null,
      parseError,
    };
  } catch (e) {
    return { domain, macro, networkError: String(e?.message || e).slice(0, 200), ms: Date.now() - start };
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// Aggregate
const totals = {
  total: results.length,
  skipped: results.filter(r => r.skipped).length,
  exercised: results.filter(r => !r.skipped).length,
  okEnvelope: results.filter(r => r.okShape).length,
  okTrue: results.filter(r => r.ok === true).length,
  okFalse: results.filter(r => r.ok === false).length,
  badShape: results.filter(r => !r.skipped && !r.okShape).length,
  networkError: results.filter(r => r.networkError).length,
  http200: results.filter(r => r.status === 200).length,
  http400: results.filter(r => r.status >= 400 && r.status < 500).length,
  http500: results.filter(r => r.status >= 500).length,
};

// Group bad-shape + network errors for triage
const failures = results
  .filter(r => !r.skipped && (r.networkError || !r.okShape || r.status >= 500))
  .slice(0, 100);

// Status-code breakdown
const statusBreakdown = {};
for (const r of results) {
  if (!r.skipped && r.status) statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  backend: BACKEND,
  totals,
  statusBreakdown,
  failures,
};

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', 'http-macro-smoke.json'), JSON.stringify(out, null, 2));

const md = [];
md.push('# HTTP Macro Smoke\n');
md.push(`Generated: ${out.generatedAt}\nBackend: ${BACKEND}\n`);
md.push('## Totals\n');
for (const [k, v] of Object.entries(totals)) md.push(`- ${k}: **${v}**`);
md.push('\n## Status-code breakdown\n');
for (const [code, n] of Object.entries(statusBreakdown).sort((a, b) => b[1] - a[1])) {
  md.push(`- ${code}: ${n}`);
}
md.push('\n## Top failures\n');
md.push('| Domain | Macro | Status | Issue |');
md.push('|---|---|---:|---|');
for (const f of failures.slice(0, 50)) {
  const issue = f.networkError ? `network: ${f.networkError}`
              : !f.okShape ? `bad shape (status ${f.status}, parseError: ${f.parseError || 'none'})`
              : f.status >= 500 ? `500-class status`
              : 'unknown';
  md.push(`| \`${f.domain}\` | \`${f.macro}\` | ${f.status || '—'} | ${issue.slice(0, 120)} |`);
}
fs.writeFileSync(path.join(ROOT, 'audit', 'http-macro-smoke.md'), md.join('\n'));

console.error(`\nWrote audit/http-macro-smoke.json + audit/http-macro-smoke.md`);
console.error(`Exercised: ${totals.exercised} / Skipped: ${totals.skipped}`);
console.error(`OK envelope: ${totals.okEnvelope} / Bad shape: ${totals.badShape} / Network errors: ${totals.networkError}`);
console.error(`HTTP 200: ${totals.http200} / 4xx: ${totals.http400} / 5xx: ${totals.http500}`);
