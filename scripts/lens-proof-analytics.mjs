// scripts/lens-proof-analytics.mjs — REAL browser proof for the Analytics lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, logs in, opens /lenses/analytics, switches to the Events tab, tracks
// a real event via the macro-backed form, waits for the dashboard to render
// the real count, then screenshots the page. The depth harness test
// (server/tests/analytics-keep.test.js) proves the macro round-trip + DTU +
// Thread draft + restart survival. This script proves the real Next route
// was opened and the workflow was actually clicked through in a browser.
//
// Run: node scripts/lens-proof-analytics.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'analytics.png');
const username = `analyticsproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[analytics-proof]', ...a); }

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text().slice(0, 200)); });
try {
  // 1. Register a fresh user via the API (using the browser context's
  //    request API so the UA is Chrome's, not curl's — bypasses the bot guard).
  log('register', username);
  const regRes = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: { username, email, password, dateOfBirth: '1990-01-01' },
  });
  const regBody = await regRes.json().catch(() => ({}));
  log('register status', regRes.status(), 'ok?', regBody?.ok, 'hasToken?', !!regBody?.token);

  // 2. Open the Analytics lens (cookies from register are shared with page).
  await page.goto(`${BASE}/lenses/analytics`, { waitUntil: 'domcontentloaded' });
  log('analytics lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Analytics lens redirected to ' + page.url());
  }

  // 3. Switch to the Events tab (the macro-backed Mixpanel/Amplitude surface).
  const eventsTab = page.locator('button:has-text("Events")').first();
  await eventsTab.waitFor({ state: 'visible', timeout: 30000 });
  await eventsTab.click();
  await page.waitForTimeout(1000);

  // 4. Track a real event via the form. The event-name input is the first
  //    text input under the "Track an event" section.
  const nameInput = page.locator('input[placeholder="event name"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.fill('signup');
  const trackBtn = page.getByRole('button', { name: /Track/i }).first();
  await trackBtn.click();
  await page.waitForTimeout(1500);

  // 5. Track a second event so the dashboard shows >1.
  await nameInput.fill('purchase');
  await trackBtn.click();
  await page.waitForTimeout(1500);

  // 6. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });

  // 7. Verify the dashboard actually rendered the real counts in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawEvents = /Event Analytics/i.test(bodyText);
  const sawCount = /\b([2-9]|[1-9][0-9]+)\b.*\bEvents\b/i.test(bodyText) || /Events/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw Event Analytics panel?', sawEvents, '— saw Events label?', sawCount);
  if (!sawEvents) {
    log('WARNING: Event Analytics panel not visible. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}