// scripts/snap-sidebar.mjs — capture the new sidebar default + expanded state.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'sidebar-shots');
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

// 1. Landing
await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(SHOTS, '01-landing-fixed.png'), fullPage: false });
process.stderr.write('landing snapped\n');

// 2. Authed chat lens (default sidebar state — collapsed Sub-Lenses + Systems)
//    We rely on the dev-server auto-auth behaviour observed earlier.
await page.goto(FRONTEND + '/register', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
await page.waitForTimeout(3000);

await page.goto(FRONTEND + '/lenses/chat', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(3000);

// Dismiss FirstWinWizard if it appears (X button in top-right of the wizard card)
try {
  const closeBtn = await page.$('[aria-label="Dismiss wizard"]');
  if (closeBtn) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    process.stderr.write('dismissed FirstWinWizard\n');
  }
} catch { /* ignore */ }

// Dismiss the onboarding overlay if it's modal
try {
  const closeOnboard = await page.$('button[aria-label="Close"]') ||
                        await page.$('button:has-text("Skip")') ||
                        await page.$('button:has-text("×")');
  if (closeOnboard) { await closeOnboard.click(); await page.waitForTimeout(500); }
} catch { /* ignore */ }

// Clear any localStorage from prior runs so we screenshot the DEFAULT state
await page.evaluate(() => {
  localStorage.removeItem('concord:sidebar:sub-lenses');
  localStorage.removeItem('concord:sidebar:systems');
});
await page.reload({ waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(SHOTS, '02-sidebar-collapsed-default.png'), fullPage: false });
process.stderr.write('default sidebar (collapsed) snapped\n');

// 3. Now click Sub-Lenses + Systems to expand, screenshot expanded state
try {
  const subBtn = await page.$('button[aria-expanded]:has-text("Sub-Lenses")');
  if (subBtn) { await subBtn.click(); await page.waitForTimeout(400); }
  const sysBtn = await page.$('button[aria-expanded]:has-text("Systems")');
  if (sysBtn) { await sysBtn.click(); await page.waitForTimeout(400); }
} catch (e) { process.stderr.write(`expand failed: ${e?.message}\n`); }
await page.screenshot({ path: path.join(SHOTS, '03-sidebar-expanded.png'), fullPage: false });
process.stderr.write('expanded sidebar snapped\n');

await browser.close();
process.stderr.write(`Wrote ${SHOTS}\n`);
