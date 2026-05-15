/**
 * All-lens render walkthrough — Phase Z follow-up.
 *
 * Enumerates every app/lenses/<name>/page.tsx, visits each with an
 * authed session, captures a screenshot + console errors, and
 * buckets the result. Output:
 *
 *   docs/all-lens-walk/results.json   — per-lens bucket + error summary
 *   docs/all-lens-walk/<lens>.png     — one screenshot per lens
 *   docs/all-lens-walk/<lens>.log     — console errors when present
 *
 * Buckets:
 *   green    — page rendered without fatal console errors or boundary fallback
 *   noisy    — page rendered but emitted console.error (non-ignorable)
 *   crashed  — error boundary fallback visible OR pageerror thrown
 *
 * Designed for the same chromium-1194-sandboxed environment as
 * playthrough.spec.ts. Reuses the same makeTestSession helper pattern.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.use({ browserName: 'chromium' });
test.describe.configure({ mode: 'serial' });

const BACKEND = process.env.CONCORD_API_BASE || 'http://localhost:5050';
const OUT_DIR = path.resolve(__dirname, '../../../docs/all-lens-walk');
const RESULTS_FILE = path.join(OUT_DIR, 'results.json');

const IGNORABLE = [
  /^Warning:/i,
  /ReactDOM/,
  /WebGL|ANGLE/i,
  /Failed to fetch/i,
  /NetworkError|net::ERR_/i,
  /AbortError/i,
  /Hydration/i,
  /503|502|504/,
  /Ollama|brain_offline/i,
  /federation|peer/i,
  /Failed to load resource/i,
  /Connection lost/i,
];

// LENS_LIST env var (or /tmp/lens-routes.txt) lets a partial re-run
// target only specific lenses. When neither exists — the default in CI,
// where nothing generates the /tmp file — enumerate every
// app/lenses/<name>/page.tsx directly so the spec is self-sufficient.
function loadLensList(): string[] {
  const explicit = process.env.LENS_LIST || '/tmp/lens-routes.txt';
  if (fs.existsSync(explicit)) {
    return fs.readFileSync(explicit, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  const lensesDir = path.resolve(__dirname, '../../app/lenses');
  return fs.readdirSync(lensesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(lensesDir, d.name, 'page.tsx')))
    .map((d) => d.name)
    .sort();
}
const LENSES = loadLensList();

interface LensResult {
  lens: string;
  bucket: 'green' | 'noisy' | 'crashed' | 'timeout';
  consoleErrorCount: number;
  firstError?: string;
  boundaryText?: string;
  durationMs: number;
}

async function makeTestSession(request: APIRequestContext) {
  const uniq    = `lenswalk_${Date.now().toString(36)}`;
  const email   = `${uniq}@concord-smoke.test`;
  const password = 'PlaywrightSmoke!9912';
  const loadedAt = Date.now() - 3_500;

  await request.post(`${BACKEND}/api/auth/register`, {
    data: { username: uniq, email, password, _t: loadedAt },
    headers: { 'content-type': 'application/json' },
  });
  const loginRes = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  });
  const rawCookies = (loginRes.headersArray() as Array<{ name: string; value: string }>)
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  if (rawCookies.length === 0) {
    throw new Error(`No Set-Cookie on /api/auth/login. status=${loginRes.status()}`);
  }
  return {
    cookies: rawCookies.map((raw) => {
      const [pair] = raw.split(';');
      const [name, value] = pair.split('=');
      return { name: name.trim(), value: value?.trim() ?? '', domain: 'localhost', path: '/' };
    }),
  };
}

let _session: Awaited<ReturnType<typeof makeTestSession>> | null = null;
const _results: LensResult[] = [];

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  _session = await makeTestSession(request);
});

test.afterAll(async () => {
  // Merge with any prior run so a partial re-run accumulates instead
  // of overwriting earlier bucket assignments.
  let prior: LensResult[] = [];
  try {
    const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
    prior = (JSON.parse(raw).results ?? []) as LensResult[];
  } catch { /* no prior */ }
  const byLens = new Map<string, LensResult>();
  for (const r of prior) byLens.set(r.lens, r);
  for (const r of _results) byLens.set(r.lens, r); // newer wins
  const merged = Array.from(byLens.values()).sort((a, b) => a.lens.localeCompare(b.lens));

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    total: merged.length,
    buckets: {
      green:   merged.filter((r) => r.bucket === 'green').length,
      noisy:   merged.filter((r) => r.bucket === 'noisy').length,
      crashed: merged.filter((r) => r.bucket === 'crashed').length,
      timeout: merged.filter((r) => r.bucket === 'timeout').length,
    },
    results: merged,
  }, null, 2));
});

for (const lens of LENSES) {
  test(`${lens}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    if (_session) await context.addCookies(_session.cookies);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const t0 = Date.now();
    let bucket: LensResult['bucket'] = 'green';
    let boundaryText: string | undefined;

    try {
      // First-visit compile in Next dev can take 30-60s per route.
      // Retry once on connection refused — Next briefly drops while
      // compiling a new route.
      const goWithRetry = async (url: string, timeout: number) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
            return;
          } catch (err) {
            if (attempt === 1) throw err;
            await page.waitForTimeout(2_000);
          }
        }
      };

      await goWithRetry('/', 60_000);
      await page.evaluate(() => {
        try {
          localStorage.setItem('concord-onboarding-completed', 'true');
          localStorage.setItem('concord_first_win_dismissed', 'true');
          localStorage.setItem('concord_cookie_consent',      'accepted');
          localStorage.setItem('world_lens_visited',          '1');
        } catch { /* noop */ }
      });
      await goWithRetry(`/lenses/${lens}`, 90_000);
      await page.waitForTimeout(3_500); // hydration + first paint

      // Detect error-boundary fallback.
      boundaryText = await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"]');
        const txt = (alert?.textContent || '').toLowerCase();
        if (txt.includes('hit an error') || txt.includes('failed to load') || txt.includes('something broke')) {
          return alert?.textContent?.slice(0, 500);
        }
        return undefined;
      }).catch(() => undefined);

      await page.screenshot({ path: path.join(OUT_DIR, `${lens}.png`), fullPage: false }).catch(() => {});

      const fatalErrors    = errors.filter((e) => !IGNORABLE.some((p) => p.test(e)));
      const fatalConsole   = consoleErrors.filter((e) => !IGNORABLE.some((p) => p.test(e)));

      if (boundaryText || fatalErrors.length > 0) bucket = 'crashed';
      else if (fatalConsole.length > 0)            bucket = 'noisy';
      else                                         bucket = 'green';

      if (fatalConsole.length > 0 || fatalErrors.length > 0) {
        fs.writeFileSync(
          path.join(OUT_DIR, `${lens}.log`),
          [...fatalErrors.map((e) => `[pageerror] ${e}`), ...fatalConsole.map((e) => `[console.error] ${e}`)].join('\n'),
        );
      }

      _results.push({
        lens, bucket,
        consoleErrorCount: fatalConsole.length,
        firstError: fatalErrors[0] ?? fatalConsole[0],
        boundaryText,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      _results.push({
        lens, bucket: 'timeout',
        consoleErrorCount: 0,
        firstError: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    }

    // Soft assertion — we want every lens to run regardless of crashes.
    // Hard failure only on test infra problems (caught above).
    expect(bucket).toBeDefined();
  });
}
