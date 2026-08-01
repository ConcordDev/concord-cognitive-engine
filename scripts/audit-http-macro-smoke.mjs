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
//
// The concurrent-fetch loop below needs a real live backend, which is not
// available in every environment this script is imported from (e.g. a unit-
// test sandbox with no server running). The pure classification/aggregation
// logic — which macros get skipped, how one HTTP response is turned into a
// result row, how results roll up into totals/status-breakdown/failures,
// and the markdown report — is factored into exported functions below so
// it's unit-testable directly (see server/tests/audit-http-macro-smoke-
// gate.test.js), and `testOne`/`runSmoke` accept an injectable `fetchImpl`
// so the real request-building + response-parsing + concurrency logic can
// be exercised end-to-end against a controlled fake server, not just
// asserted piecewise. Mirrors the isMainModule guard pattern already used
// by scripts/extract-macro-input-hints.mjs.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');

// Skip patterns mirroring the behavior-smoke harness (don't fire LLM
// or destructive calls against a live server).
export const LLM_RE = /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|score|evaluate|grade|review|writeReply|composeMessage|debate|persuade|argue)$|llm|brain/i;
export const SKIP_DOMAINS = new Set(['oracle', 'concordance']);

// User-Agent is critical — the backend's bot guard returns 403 for
// non-browsery agents on read-only paths. We send a real Chromium UA
// so the requests look like a browser. Auth: the smoke doesn't have
// a user session, so it'll hit the unauthenticated path. The bot
// guard + auth middleware are what we're TESTING, not bypassing.
export const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const CONCURRENCY = 8;

/** Whether a (domain, macro) pair should be skipped rather than fired at
 * the live server, and why. Returns `null` when it should be exercised.
 * Pure — no I/O. */
export function shouldSkip(domain, macro) {
  if (SKIP_DOMAINS.has(domain)) return 'domain-blacklist';
  if (LLM_RE.test(macro)) return 'llm-hint';
  return null;
}

/** Fires one HTTP smoke request for a (domain, macro) pair against
 * `backend`, using the injectable `fetchImpl` (defaults to the global
 * fetch). Returns the same result-row shape the original inline loop
 * produced. Skip handling lives here too so callers get one entry point. */
export async function testOne({ domain, macro }, { backend, fetchImpl = fetch } = {}) {
  const skip = shouldSkip(domain, macro);
  if (skip) return { domain, macro, skipped: skip };

  const body = JSON.stringify({
    domain,
    name: macro,
    input: { artifact: { id: `http-smoke-${domain}-${macro}`, data: {} } },
  });
  const start = Date.now();
  try {
    const r = await fetchImpl(`${backend}/api/lens/run`, {
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

/** Aggregate pass/fail/skip counters from a full results array. Pure. */
export function buildTotals(results) {
  return {
    total: results.length,
    skipped: results.filter((r) => r.skipped).length,
    exercised: results.filter((r) => !r.skipped).length,
    okEnvelope: results.filter((r) => r.okShape).length,
    okTrue: results.filter((r) => r.ok === true).length,
    okFalse: results.filter((r) => r.ok === false).length,
    badShape: results.filter((r) => !r.skipped && !r.okShape).length,
    networkError: results.filter((r) => r.networkError).length,
    http200: results.filter((r) => r.status === 200).length,
    http400: results.filter((r) => r.status >= 400 && r.status < 500).length,
    http500: results.filter((r) => r.status >= 500).length,
  };
}

/** The subset of results worth triage — network errors, bad envelope
 * shape, or a 5xx status — capped at 100 rows. Pure. */
export function buildFailures(results) {
  return results.filter((r) => !r.skipped && (r.networkError || !r.okShape || r.status >= 500)).slice(0, 100);
}

/** Per-HTTP-status-code counts across exercised (non-skipped) results with
 * a status. Pure. */
export function buildStatusBreakdown(results) {
  const statusBreakdown = {};
  for (const r of results) {
    if (!r.skipped && r.status) statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
  }
  return statusBreakdown;
}

/** Renders the human-readable markdown report from the full output shape
 * (`{ generatedAt, backend, totals, statusBreakdown, failures }`). Pure. */
export function buildMarkdownReport(out) {
  const { totals, statusBreakdown, failures } = out;
  const md = [];
  md.push('# HTTP Macro Smoke\n');
  md.push(`Generated: ${out.generatedAt}\nBackend: ${out.backend}\n`);
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
  return md.join('\n');
}

/** Runs the full smoke pass (bounded concurrency worker pool) over
 * `allMacros` against `backend`, returning the same `{ generatedAt,
 * backend, totals, statusBreakdown, failures }` shape main() writes to
 * disk. Exposed so tests can drive the REAL concurrency + aggregation path
 * end-to-end against an injected fake `fetchImpl`, not just assert the
 * pieces separately. */
export async function runSmoke(allMacros, { backend, fetchImpl = fetch, concurrency = CONCURRENCY, onProgress } = {}) {
  const queue = allMacros.slice();
  const results = [];
  let done = 0;

  async function worker() {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      const r = await testOne(job, { backend, fetchImpl });
      results.push(r);
      done++;
      if (onProgress) onProgress(done, allMacros.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return {
    generatedAt: new Date().toISOString(),
    backend,
    totals: buildTotals(results),
    statusBreakdown: buildStatusBreakdown(results),
    failures: buildFailures(results),
  };
}

async function main() {
  const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:5050';

  // Load the macro list from the depth grader's output (it's the
  // canonical inventory of every registered (domain, macro)).
  const depth = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'macro-depth.json'), 'utf8'));
  const allMacros = depth.macros.map((m) => ({ domain: m.domain, macro: m.macro }));

  console.error(`Smoke-testing ${allMacros.length} macros against ${BACKEND}…`);

  const out = await runSmoke(allMacros, {
    backend: BACKEND,
    onProgress: (done, total) => {
      if (done % 200 === 0) process.stderr.write(`  ${done}/${total}\n`);
    },
  });

  fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'audit', 'http-macro-smoke.json'), JSON.stringify(out, null, 2));

  const md = buildMarkdownReport(out);
  fs.writeFileSync(path.join(ROOT, 'audit', 'http-macro-smoke.md'), md);

  console.error(`\nWrote audit/http-macro-smoke.json + audit/http-macro-smoke.md`);
  const { totals } = out;
  console.error(`Exercised: ${totals.exercised} / Skipped: ${totals.skipped}`);
  console.error(`OK envelope: ${totals.okEnvelope} / Bad shape: ${totals.badShape} / Network errors: ${totals.networkError}`);
  console.error(`HTTP 200: ${totals.http200} / 4xx: ${totals.http400} / 5xx: ${totals.http500}`);
}

// Guard so the exported pure functions above can be imported by unit tests
// without hitting the network or reading audit/macro-depth.json as a side
// effect of the import.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exitCode = 1;
  });
}
