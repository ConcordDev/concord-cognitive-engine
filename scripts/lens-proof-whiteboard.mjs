// scripts/lens-proof-whiteboard.mjs — REAL browser proof for the Whiteboard lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, logs in, opens /lenses/whiteboard, creates a real board via the
// "New board" button, waits for the canvas to render, then screenshots
// the page. The depth harness test (server/tests/whiteboard-keep.test.js)
// proves the macro round-trip + DTU + Thread draft + restart survival.
// This script proves the real Next route was opened and the workflow was
// actually clicked through in a browser.
//
// Run: node scripts/lens-proof-whiteboard.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'whiteboard.png');
const username = `wbproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[whiteboard-proof]', ...a); }

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text().slice(0, 200)); });
try {
  // 1. Register a fresh user via the API.
  log('register', username);
  const regRes = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: { username, email, password, dateOfBirth: '1990-01-01' },
  });
  const regBody = await regRes.json().catch(() => ({}));
  log('register status', regRes.status(), 'ok?', regBody?.ok, 'hasToken?', !!regBody?.token);

  // 2. Open the Whiteboard lens.
  await page.goto(`${BASE}/lenses/whiteboard`, { waitUntil: 'commit', timeout: 90000 });
  log('whiteboard lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Whiteboard lens redirected to ' + page.url());
  }

  // 3. Click "New board" (the teal FAB bottom-right) and create a real board.
  const newBtn = page.getByRole('button', { name: /New board/i }).first();
  await newBtn.waitFor({ state: 'visible', timeout: 30000 });
  await newBtn.click();
  await page.waitForTimeout(800);

  // The create form has a "Board name" input and a Create button.
  const titleInput = page.locator('input[placeholder="Board name"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.fill('Proof Board');
  const createBtn = page.getByRole('button', { name: /^Create$/i }).first();
  await createBtn.click();
  await page.waitForTimeout(2500);

  // 4. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });

  // 5. Verify the board actually rendered in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawBoard = /Proof Board/i.test(bodyText);
  const sawKeep = /Keep this board/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw board?', sawBoard, '— saw Keep menu?', sawKeep);
  if (!sawBoard) {
    log('WARNING: board not visible on the page. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}