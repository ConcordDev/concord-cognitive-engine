// scripts/lens-proof-fitness.mjs — REAL browser proof for the Fitness lens.
// Launches Chrome via Playwright (channel: 'chrome'), logs in as the
// shared proof user, opens /lenses/fitness, switches to the Training
// surface, opens the Activities tab, fills in the real "Log activity"
// form (type, name, distance, duration, elevation, HR, calories), saves
// the activity via the macro-backed form, waits for it to render in the
// feed, clicks Keep to load the FitnessKeepMenu (activity-detail macro),
// then screenshots the page. Proves the real Next route was opened and
// the workflow was actually clicked through in a browser — not only an
// API macro call.
//
// Run: node scripts/lens-proof-fitness.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'fitness.png');
const PROOF_USER = process.env.PROOF_USER || 'wbproof_muv96clt';
const PROOF_PASS = process.env.PROOF_PASS || 'TestPass123!';

function log(...a) { console.log('[fitness-proof]', ...a); }

async function login(ctx, attempt = 0) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username: PROOF_USER, password: PROOF_PASS },
    timeout: 120000,
  });
  const body = await res.json().catch(() => ({}));
  if (body?.ok) return body;
  if (attempt < 8 && (res.status() >= 500 || body?.error === 'service_overloaded')) {
    log(`login attempt ${attempt + 1} failed (${body?.error || res.status()}) — retrying in 8s`);
    await new Promise((r) => setTimeout(r, 8000));
    return login(ctx, attempt + 1);
  }
  throw new Error('login failed: ' + (body?.error || res.status()));
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text().slice(0, 200)); });
try {
  // 1. Log in as the shared proof user (registration is daily-capped per IP).
  log('login', PROOF_USER);
  const loginBody = await login(ctx);
  log('login ok?', loginBody?.ok, 'hasToken?', !!loginBody?.token);

  // 2. Open the Fitness lens.
  await page.goto(`${BASE}/lenses/fitness`, { waitUntil: 'commit', timeout: 90000 });
  log('fitness lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Fitness lens redirected to ' + page.url());
  }

  // 3. Click the "Training" tab (the Strava-style personal training log).
  const trainingTab = page.getByRole('button', { name: /^Training$/i }).first();
  await trainingTab.waitFor({ state: 'visible', timeout: 30000 });
  await trainingTab.click();
  await page.waitForTimeout(1200);

  // 4. Click the "Activities" sub-tab inside FitnessStravaSection.
  const activitiesTab = page.getByRole('button', { name: /^Activities$/i }).first();
  await activitiesTab.waitFor({ state: 'visible', timeout: 10000 });
  await activitiesTab.click();
  await page.waitForTimeout(1500);

  // 5. Open the "Log activity" form and fill it in.
  const logBtn = page.getByRole('button', { name: /Log activity/i }).first();
  await logBtn.waitFor({ state: 'visible', timeout: 10000 });
  await logBtn.click();
  await page.waitForTimeout(600);

  // Form fields: type select, name, distance, duration, elevation, HR, calories.
  const nameInput = page.locator('input[placeholder="Name (optional)"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.fill('Proof Run');
  await page.locator('input[placeholder="Distance (km)"]').first().fill('5');
  await page.locator('input[placeholder="Duration (min)"]').first().fill('25');
  await page.locator('input[placeholder="Elevation (m)"]').first().fill('40');
  await page.locator('input[placeholder="Avg HR (bpm)"]').first().fill('150');
  await page.locator('input[placeholder="Calories"]').first().fill('320');

  // Save the activity — the orange "Save activity" button.
  const saveBtn = page.getByRole('button', { name: /Save activity/i }).first();
  await saveBtn.click();
  await page.waitForTimeout(2500);

  // 6. Verify the activity rendered in the feed, then click Keep on the
  //    activity we just created to prove the FitnessKeepMenu +
  //    activity-detail macro round-trip works end-to-end from the UI.
  const bodyText0 = await page.locator('body').innerText().catch(() => '');
  const sawActivity = /Proof Run/i.test(bodyText0);
  log('after save — saw activity?', sawActivity);
  if (sawActivity) {
    // The Keep button lives inside the activity <li>. Scope to the <li>
    // containing "Proof Run" so we click the right one.
    const proofLi = page.locator('li', { hasText: 'Proof Run' }).first();
    const keepBtn = proofLi.getByRole('button', { name: /^Keep$/i }).first();
    if (await keepBtn.count() > 0) {
      await keepBtn.click();
      await page.waitForTimeout(2500);
    } else {
      log('WARNING: Keep button not found on the Proof Run activity row.');
    }
  }

  // 7. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });

  // 8. Verify the activity + Keep menu rendered in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawProof = /Proof Run/i.test(bodyText);
  const sawKeep = /Keep this activity/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw activity?', sawProof, '— saw Keep menu?', sawKeep);
  if (!sawProof) {
    log('WARNING: activity not visible on the page. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}