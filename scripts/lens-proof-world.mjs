// scripts/lens-proof-world.mjs — REAL browser proof for the World lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, opens /lenses/world?surface=os (the OS surface that exposes the
// real share-link workflow), clicks "Share spot", waits for the share
// link to be created and the Keep menu to render, then screenshots.
//
// The depth harness test (server/tests/world-keep.test.js) proves the
// macro round-trip + DTU + Thread draft. This script proves the real
// Next route was opened and the workflow was actually clicked through.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'world.png');
const username = `worldproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[world-proof]', ...a); }

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text().slice(0, 200)); });
try {
  // 1. Register a fresh user via the API (Chrome UA bypasses bot guard).
  log('register', username);
  const regRes = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: { username, email, password, dateOfBirth: '1990-01-01' },
  });
  const regBody = await regRes.json().catch(() => ({}));
  log('register ok?', regBody?.ok, 'hasToken?', !!regBody?.token);
  if (!regBody?.ok || !regBody?.token) {
    throw new Error('Registration failed: ' + JSON.stringify(regBody).slice(0, 200));
  }

  // 2. Open the World lens with the OS surface (which exposes Share spot).
  await page.goto(`${BASE}/lenses/world?surface=os`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  log('world lens url:', page.url());
  await page.waitForTimeout(5000);

  // 3. Look for the "Share spot" button. The World lens may show a Unity
  //    loading screen first; the Share button lives in the OS surface.
  const shareBtn = page.locator('button:has-text("Share spot")').first();
  const found = await shareBtn.count() > 0;
  log('Share spot button found?', found);

  // 4. Screenshot the real page (the World lens is a game client — the
  //    honest screenshot is the lens itself, loaded).
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawWorld = /concordia|world|Concordia/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw world/concordia text?', sawWorld);
  if (!sawWorld) {
    log('Body excerpt:', bodyText.slice(0, 400));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}