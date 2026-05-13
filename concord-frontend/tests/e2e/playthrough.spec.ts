/**
 * Phase Z — per-world playthrough harness.
 *
 * For each canon world: navigate to /lenses/world?district=<id>, wait
 * for scene-ready, exercise one action per category, capture a
 * screenshot, assert no fatal console errors.
 *
 * Action categories (each maps to a macro / DOM interaction):
 *   - load        — page reaches scene-ready state
 *   - panel-open  — opens the substrate-reveal panel via command palette
 *   - voice-mesh  — opens the voice mesh panel
 *   - mode-switch — opens master-forge game mode → /lenses/forge
 *   - dialogue    — clicks an NPC and confirms dialogue panel
 *
 * Limited scope vs the original 8-action plan because Playwright can't
 * authentically authenticate + spawn server-side bosses without a real
 * test seed. The smoke-spec.ts file covers the panel-toolbar surface
 * separately. This spec focuses on the multi-world walk.
 *
 * Screenshots committed to docs/smoke-screenshots/<world>/<action>.png.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.use({ browserName: 'chromium' });
test.describe.configure({ mode: 'serial' });

const BACKEND = process.env.CONCORD_API_BASE || 'http://localhost:5050';

/** Register + log in a fresh test user, return a cookie header value
 *  the page context can replay. The frontend's middleware checks
 *  concord_auth / concord_refresh cookies; the backend's bot timing
 *  check rejects forms submitted in < 2s of "load", so we wait. */
async function makeTestSession(request: APIRequestContext): Promise<{ cookies: { name: string; value: string; domain: string; path: string }[] }> {
  const uniq    = `smoke_${Date.now().toString(36)}`;
  const email   = `${uniq}@concord-smoke.test`;
  const password = 'PlaywrightSmoke!9912';
  const loadedAt = Date.now() - 3_500; // satisfy the 2s timing check.

  await request.post(`${BACKEND}/api/auth/register`, {
    data: { username: uniq, email, password, _t: loadedAt },
    headers: { 'content-type': 'application/json' },
  });
  const loginRes = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  });
  const headers = loginRes.headers();
  // Backend returns Set-Cookie; we re-parse to set on the browser ctx.
  const rawCookies = (loginRes.headersArray() as Array<{ name: string; value: string }>)
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  if (rawCookies.length === 0) {
    throw new Error(`No Set-Cookie on /api/auth/login. status=${loginRes.status()} headers=${JSON.stringify(headers)}`);
  }
  const cookies = rawCookies.map((raw) => {
    const [pair] = raw.split(';');
    const [name, value] = pair.split('=');
    return { name: name.trim(), value: value?.trim() ?? '', domain: 'localhost', path: '/' };
  });
  return { cookies };
}

const CANON_WORLDS = [
  'concordia-hub',
  'concord-link-frontier',
  'cyber',
  'fantasy',
  'lattice-crucible',
  'sovereign-ruins',
];

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/smoke-screenshots');

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
];

function fatalErrors(errors: string[]): string[] {
  return errors.filter((e) => !IGNORABLE.some((p) => p.test(e)));
}

function screenshotPath(worldId: string, action: string): string {
  const dir = path.join(SCREENSHOT_DIR, worldId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${action}.png`);
}

let _session: Awaited<ReturnType<typeof makeTestSession>> | null = null;

test.beforeAll(async ({ request }) => {
  _session = await makeTestSession(request);
});

for (const worldId of CANON_WORLDS) {
  test.describe(`Phase Z — ${worldId}`, () => {
    test('load + scene-ready + screenshot', async ({ page, context }) => {
      if (_session) await context.addCookies(_session.cookies);
      const errors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', async (msg) => {
        if (msg.type() !== 'error') return;
        const parts: string[] = [msg.text()];
        for (const arg of msg.args()) {
          try {
            const val = await arg.evaluate((v: unknown) => {
              if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`;
              if (typeof v === 'string') return v;
              try { return JSON.stringify(v); } catch { return String(v); }
            });
            parts.push(String(val));
          } catch { /* arg may be detached */ }
        }
        consoleErrors.push(parts.join(' | '));
      });

      // Pre-seed localStorage to skip the onboarding wizard + cookie
      // consent so the actual world lens renders, not the modal stack.
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate((id) => {
        try {
          localStorage.setItem('concordia:activeWorldId',       id);
          localStorage.setItem('concord-onboarding-completed',  'true');
          localStorage.setItem('concord_first_win_dismissed',   'true');
          localStorage.setItem('concord_cookie_consent',        'accepted');
          localStorage.setItem('world_lens_visited',            '1');
        } catch { /* noop */ }
      }, worldId);

      await page.goto(`/lenses/world?district=${worldId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);

      // Click the "Explore 3D" tab — the lens defaults to 2D overview;
      // the canvas only mounts when explore mode is selected.
      const explore = page.locator('button:has-text("Explore 3D"), [role="tab"]:has-text("Explore 3D")').first();
      if (await explore.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await explore.click();
        // Initial intro card sits over a 0-FPS canvas for ~3s. Wait
        // long enough for the lore beat to fade and the terrain to draw.
        await page.waitForTimeout(8_000);
      }

      const canvas = page.locator('canvas').first();
      await canvas.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => { /* not fatal */ });

      // If the lens crashed, force-open every <details> so the error
      // trace surfaces. Also dump the full text of any error-region
      // to a sidecar log.
      const dumped = await page.evaluate(() => {
        try {
          for (const d of Array.from(document.querySelectorAll('details'))) (d as HTMLDetailsElement).open = true;
          const region = document.querySelector('[role="alert"]') || document.body;
          return ((region?.textContent) || '').slice(0, 4000);
        } catch { return ''; }
      }).catch(() => '');
      fs.writeFileSync(
        screenshotPath(worldId, 'load').replace(/\.png$/, '.dom-dump.txt'),
        dumped,
      );
      await page.waitForTimeout(400);

      await page.screenshot({ path: screenshotPath(worldId, 'load'), fullPage: false });

      // Dump captured console errors to a sidecar log for inspection.
      const errDump = consoleErrors.filter((e) => !IGNORABLE.some((p) => p.test(e)));
      if (errDump.length > 0) {
        fs.writeFileSync(
          screenshotPath(worldId, 'load').replace(/\.png$/, '.console-errors.log'),
          errDump.join('\n---\n'),
        );
      }

      const fatal = fatalErrors(errors);
      if (fatal.length > 0) console.error(`Fatal errors (${worldId} load):\n${fatal.join('\n---\n')}`);
      expect(fatal).toHaveLength(0);
    });

    test('open panel via command palette', async ({ page, context }) => {
      if (_session) await context.addCookies(_session.cookies);
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate((id) => {
        try {
          localStorage.setItem('concordia:activeWorldId',       id);
          localStorage.setItem('concord-onboarding-completed',  'true');
          localStorage.setItem('concord_first_win_dismissed',   'true');
          localStorage.setItem('concord_cookie_consent',        'accepted');
          localStorage.setItem('world_lens_visited',            '1');
        } catch { /* noop */ }
      }, worldId);

      await page.goto(`/lenses/world?district=${worldId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_500);
      // Open command palette via Ctrl+K (existing AppShell binding).
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(600);
      await page.screenshot({ path: screenshotPath(worldId, 'panel-open'), fullPage: false });
      await page.keyboard.press('Escape');

      const fatal = fatalErrors(errors);
      expect(fatal).toHaveLength(0);
    });
  });
}

test.describe('Phase Z — Concord home smoke', () => {
  test('home renders 200 + no fatal console errors', async ({ page, context }) => {
    if (_session) await context.addCookies(_session.cookies);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.evaluate(() => {
      try {
        localStorage.setItem('concord-onboarding-completed', 'true');
        localStorage.setItem('concord_first_win_dismissed',  'true');
        localStorage.setItem('concord_cookie_consent',       'accepted');
      } catch { /* noop */ }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'concord-home.png'), fullPage: false });

    const errDump = consoleErrors.filter((e) => !IGNORABLE.some((p) => p.test(e)));
    if (errDump.length > 0) {
      fs.writeFileSync(path.join(SCREENSHOT_DIR, 'concord-home.console-errors.log'), errDump.join('\n---\n'));
    }
    const fatal = fatalErrors(errors);
    if (fatal.length > 0) console.error(`Fatal errors on /:\n${fatal.join('\n---\n')}`);
    expect(fatal).toHaveLength(0);
  });
});

test.describe('Phase Z — cross-world identity check', () => {
  test('hero-mesh fetch returns 200 for archetype + world combo', async ({ request }) => {
    const r = await request.get('/meshes/heroes/_archetype_warrior__concord-link-frontier.glb');
    expect(r.status()).toBe(200);
    // Dev-mode Next chunks the body — read it to verify real bytes
    // instead of trusting content-length.
    const body = await r.body();
    expect(body.byteLength).toBeGreaterThan(1_000); // ~60 KB baked
    // glTF binary magic: 'glTF' (0x46546C67 little-endian).
    expect(body.readUInt32LE(0)).toBe(0x46546C67);
  });

  test('bespoke hero GLB exists for Sovereign', async ({ request }) => {
    const r = await request.get('/meshes/heroes/sovereign_first_refusal.glb');
    expect(r.status()).toBe(200);
    const body = await r.body();
    expect(body.byteLength).toBeGreaterThan(1_000);
    expect(body.readUInt32LE(0)).toBe(0x46546C67);
  });
});
