// scripts/snap-ux-polish.mjs — verify the cookie/onboarding/sidebar polish.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'ux-polish-shots');
const FRONTEND = 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Pass 1 — fresh visitor, no localStorage. Should see onboarding
// modal centered, NO cookie banner (it's deferred).
await page.goto(FRONTEND + '/register', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
await page.waitForTimeout(2500);
await page.evaluate(() => {
  localStorage.clear();
});
await page.goto(FRONTEND + '/lenses/chat', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(SHOTS, '01-fresh-no-cookie-banner.png') });
process.stderr.write('1. fresh visit (no cookie banner over modal)\n');

// Pass 2 — same page, after marking onboarding complete in localStorage.
// Should now show: bottom-LEFT cookie banner + bottom-RIGHT FirstWinWizard
// (no collision).
await page.evaluate(() => {
  localStorage.setItem('concord_onboarding_complete', 'true');
  localStorage.setItem('concord-onboarding-completed', 'true');
});
await page.reload({ waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(SHOTS, '02-post-onboarding-cookie-bottomleft.png') });
process.stderr.write('2. post-onboarding (cookie bottom-left, FirstWinWizard bottom-right)\n');

// Pass 3 — accept cookies, see clean state.
try {
  const accept = await page.$('button:has-text("Accept")');
  if (accept) { await accept.click(); await page.waitForTimeout(500); }
} catch { /* ignore */ }
await page.screenshot({ path: path.join(SHOTS, '03-cookies-accepted.png') });
process.stderr.write('3. cookies accepted\n');

await browser.close();
process.stderr.write(`Wrote ${SHOTS}\n`);
