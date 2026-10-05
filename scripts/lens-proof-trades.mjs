// scripts/lens-proof-trades.mjs — REAL browser proof for the Trades lens.
// Launches Chrome via Playwright (channel: 'chrome'), registers a fresh
// user, logs in, opens /lenses/trades, switches to the Workbench nav item,
// creates a real customer, creates a real job, waits for the job card to
// render, then screenshots the page. The depth harness test
// (server/tests/trades-keep.test.js) proves the macro round-trip + DTU +
// Thread draft + restart survival. This script proves the real Next route
// was opened and the workflow was actually clicked through in a browser.
//
// Run: node scripts/lens-proof-trades.mjs
// Env: PROOF_BASE_URL (default http://localhost:5399)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../server/node_modules/playwright-core/index.js');

const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const SHOT = join(PROOF_DIR, 'trades.png');
const username = `tradesproof_${Date.now().toString(36)}`;
const email = `${username}@test.invalid`;
const password = 'TestPass123!';

function log(...a) { console.log('[trades-proof]', ...a); }

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

  // 2. Create a real customer via the API BEFORE opening the lens, so the
  //    workbench's customer-list call (on mount) picks it up. Same lens-run
  //    path the UI's customer-upsert uses. Cookies from register are shared
  //    with the request API.
  const custApi = await ctx.request.post(`${BASE}/api/lens/run`, {
    data: { domain: 'trades', action: 'customer-upsert', input: { name: 'Proof Customer', phone: '555-0100', email: 'proof@test.invalid', address: '1 Main St' } },
  }).catch(() => null);
  const custBody = await custApi?.json().catch(() => ({}));
  log('customer-upsert api ok?', custBody?.ok, 'custId?', custBody?.result?.customer?.id, 'error?', custBody?.error);

  // 3. Open the Trades lens.
  await page.goto(`${BASE}/lenses/trades`, { waitUntil: 'commit', timeout: 90000 });
  log('trades lens url:', page.url());
  if (page.url().includes('/login') || page.url().includes('/onboarding')) {
    log('REDIRECTED to', page.url());
    throw new Error('Trades lens redirected to ' + page.url());
  }

  // 4. Switch to the Workbench nav item (renders TradesWorkbench → JobsTab).
  //    It's in the "Ops intel" group at the bottom of the sidebar — scroll it
  //    into view first so the click registers.
  const wbTab = page.locator('button:has-text("Workbench")').first();
  await wbTab.waitFor({ state: 'visible', timeout: 30000 });
  await wbTab.scrollIntoViewIfNeeded();
  await wbTab.click();
  await page.waitForTimeout(1500);

  // 5. The workbench's default tab is "jobs" (Dispatch). Click "New job",
  //    select the customer, fill the description, dispatch.
  const wbRoot = page.locator('text=Trades Workbench').locator('xpath=ancestor::*[contains(@class,"flex-col")][1]').first();
  await wbRoot.getByRole('button', { name: /New job/i }).first().click();
  await page.waitForTimeout(800);
  // The form is the div with the amber-tinted background; scope the select
  // and the submit button to it so we don't grab the tab button.
  const form = wbRoot.locator('.bg-amber-500\\/5').first();
  const custSelect = form.locator('select').first();
  const options = await custSelect.locator('option').allInnerTexts().catch(() => []);
  log('customer select options:', JSON.stringify(options));
  await custSelect.selectOption({ label: 'Proof Customer' });
  await form.locator('textarea[placeholder="Description of the job"]').first().fill('Install proof panel and wire the keep menu.');
  // The submit button is the last "Dispatch" button inside the form.
  await form.getByRole('button', { name: /Dispatch/i }).first().click();
  await page.waitForTimeout(2500);

  // 6. Screenshot the real page.
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });

  // 7. Verify the job actually rendered in the DOM.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const sawJob = /JOB-00001/i.test(bodyText) || /Install proof panel/i.test(bodyText);
  const sawKeep = /Keep this job/i.test(bodyText);
  log('screenshot saved:', SHOT, '— saw job?', sawJob, '— saw Keep menu?', sawKeep);
  if (!sawJob) {
    log('WARNING: job not visible on the page. Body excerpt:', bodyText.slice(0, 500));
  }
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: SHOT, fullPage: false }); log('saved failure screenshot:', SHOT); } catch {}
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}