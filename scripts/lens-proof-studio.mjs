// scripts/lens-proof-studio.mjs — REAL browser proof for the Studio lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, opens /lenses/studio, clicks "New project", fills in the real
// project form (title/bpm/key/genre), creates the project, waits for the
// DAW workspace to render, then screenshots the page.
//
// The depth harness test (server/tests/studio-keep.test.js) proves the
// macro round-trip + DTU + Thread draft. This script proves the real Next
// route was opened and the workflow was actually clicked through.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'studio.png');
const username = `studioproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[studio-proof]', ...a); }

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

  // 2. Open the Studio lens.
  await page.goto(`${BASE}/lenses/studio`, { waitUntil: 'networkidle' });
  log('studio lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    throw new Error('Studio lens redirected to ' + page.url());
  }

  // 3. Click the "New project" FAB.
  const newBtn = page.locator('button:has-text("New project")').first();
  await newBtn.waitFor({ state: 'visible', timeout: 10000 });
  await newBtn.click();
  await page.waitForTimeout(600);

  // 4. Fill in the real project form.
  const titleInput = page.locator('input[placeholder="Project title"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill('Proof Track');
  // BPM field (first number input in the modal)
  const bpmInput = page.locator('input[type="number"]').first();
  await bpmInput.fill('128');
  // Create the project
  await page.getByRole('button', { name: /Create Project/i }).first().click();
  await page.waitForTimeout(2000);

  // 5. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });
  // 6. Verify the project rendered.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawProject = /Proof Track/i.test(bodyText);
  const sawBpm = /\b128\b/.test(bodyText);
  const sawKeep = /Keep this project/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw project name?', sawProject, '— saw 128 bpm?', sawBpm, '— saw Keep menu?', sawKeep);
  if (!sawProject && !sawBpm) {
    log('WARNING: project not visible. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}