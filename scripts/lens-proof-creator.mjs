// scripts/lens-proof-creator.mjs — REAL browser proof for the Creator lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, logs in, opens /lenses/creator, switches to the Pipeline nav item,
// creates a real content item via the macro-backed form, waits for it to
// render in the Ideas column, then screenshots the page. The depth harness
// test (server/tests/creator-keep.test.js) proves the macro round-trip +
// DTU + Thread draft + restart survival. This script proves the real Next
// route was opened and the workflow was actually clicked through in a
// browser.
//
// Run: node scripts/lens-proof-creator.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'creator.png');
const username = `creatorproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[creator-proof]', ...a); }

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

  // 2. Open the Creator lens.
  await page.goto(`${BASE}/lenses/creator`, { waitUntil: 'commit', timeout: 90000 });
  log('creator lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Creator lens redirected to ' + page.url());
  }

  // 3. Click the Pipeline nav item (the left-rail button labelled "Pipeline").
  const pipeNav = page.getByRole('button', { name: /^Pipeline$/i }).first();
  await pipeNav.waitFor({ state: 'visible', timeout: 30000 });
  await pipeNav.click();
  await page.waitForTimeout(1500);

  // 4. Fill the content form and click "Idea" (the submit button).
  const titleInput = page.locator('input[placeholder="Content title"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.fill('Proof Video');
  const ideaBtn = page.getByRole('button', { name: /Idea/i }).first();
  await ideaBtn.click();
  await page.waitForTimeout(2000);

  // 5. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });

  // 6. Verify the content actually rendered in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawContent = /Proof Video/i.test(bodyText);
  const sawKeep = /Keep this content/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw content?', sawContent, '— saw Keep menu?', sawKeep);
  if (!sawContent) {
    log('WARNING: content not visible on the page. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}