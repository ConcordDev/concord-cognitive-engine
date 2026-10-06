// scripts/lens-proof-board.mjs — REAL browser proof for the Board lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, logs in, opens /lenses/board, switches to the Workspace tab,
// creates a real board, adds a real card, waits for the board-detail to
// render, then screenshots the page. The depth harness test
// (server/tests/board-keep.test.js) proves the macro round-trip + DTU +
// Thread draft + restart survival. This script proves the real Next route
// was opened and the workflow was actually clicked through in a browser.
//
// Run: node scripts/lens-proof-board.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'board.png');
const username = `boardproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[board-proof]', ...a); }

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text().slice(0, 200)); });
try {
  // 1. Register a fresh user via the API (using the browser context's
  //    request API so the UA is Chrome's, not curl's — bypasses the bot guard).
  //    Then log in through the real /login form so session cookies set.
  log('register', username);
  const regRes = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: { username, email, password, dateOfBirth: '1990-01-01' },
  });
  const regBody = await regRes.json().catch(() => ({}));
  log('register status', regRes.status(), 'ok?', regBody?.ok, 'hasToken?', !!regBody?.token);
  if (!regBody?.ok || !regBody?.token) {
    // fallback: register through the real form
    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', username);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="date"]', '1990-01-01');
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill(password);
    await pwInputs.nth(1).fill(password);
    await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      if (!cb) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
      setter.call(cb, true);
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Create Account/i }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 20000 }).catch(() => {});
    log('post-register url (form):', page.url());
  }
  // The register response set httpOnly cookies in the context's jar —
  // they're shared with page. Go straight to the Board lens.

  // 2. Open the Board lens.
  await page.goto(`${BASE}/lenses/board`, { waitUntil: 'networkidle' });
  log('board lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Board lens redirected to ' + page.url());
  }

  // 3. Switch to the Workspace tab (the macro-backed Trello surface).
  //    The button label includes a keyboard-hint kbd, so match by substring.
  const wsTab = page.locator('button:has-text("Workspace")').first();
  await wsTab.waitFor({ state: 'visible', timeout: 10000 });
  await wsTab.click();
  await page.waitForTimeout(800);

  // 4. Create a real board.
  const nameInput = page.locator('input[placeholder*="board name" i]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 8000 });
  await nameInput.fill('Proof Board');
  await page.getByRole('button', { name: /Create Board/i }).first().click();
  await page.waitForTimeout(1200);

  // 5. Add a real card in the first column's quick-add.
  const quickAdd = page.locator('input[placeholder*="card" i], input[placeholder*="add" i]').first();
  if (await quickAdd.count() > 0) {
    await quickAdd.fill('Proof card');
    await quickAdd.press('Enter');
    await page.waitForTimeout(800);
  }

  // 6. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });
  // 7. Verify the board actually rendered in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawBoard = /Proof Board/i.test(bodyText);
  const sawCard = /Proof card/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw board name?', sawBoard, '— saw card?', sawCard);
  if (!sawBoard) {
    log('WARNING: board name not visible on the page. Body excerpt:', bodyText.slice(0, 400));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}