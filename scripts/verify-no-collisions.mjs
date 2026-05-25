// scripts/verify-no-collisions.mjs
//
// Visual collision audit. Drives the dev server through five states
// where overlay components could obstruct each other, screenshots each,
// and dumps the bounding boxes of every fixed-position element so we
// can math-check for overlaps.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'collision-check');
const FRONTEND = 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Login via API to get JWT.
const r = await fetch('http://127.0.0.1:5050/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body: JSON.stringify({ username: 'world-explorer-mpldouwl', password: 'Concord-Explore-2026!' }),
});
const j = await r.json();
if (!j?.ok) { process.stderr.write(`login failed\n`); process.exit(1); }
await ctx.addCookies([{ name: 'concord_auth', value: j.token, url: FRONTEND, sameSite: 'Lax' }]);

const page = await ctx.newPage();

// Collect bounding rects of every fixed/sticky-position element with
// non-zero size. Used to assert no overlap.
async function snapWithRects(name, prep) {
  if (prep) await prep(page);
  await page.waitForTimeout(1500);
  const rects = await page.evaluate(() => {
    const out = [];
    const walk = (el, label) => {
      const cs = window.getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') &&
          (el.offsetWidth > 0 && el.offsetHeight > 0)) {
        const r = el.getBoundingClientRect();
        if (r.width > 8 && r.height > 8) {
          out.push({
            tag: el.tagName,
            role: el.getAttribute('role'),
            label: el.getAttribute('aria-label') || (el.textContent || '').slice(0, 40).replace(/\s+/g, ' '),
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
            z: cs.zIndex,
          });
        }
      }
      for (const c of el.children) walk(c);
    };
    walk(document.body);
    return out;
  });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  return rects;
}

function findOverlaps(rects) {
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const xOver = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const yOver = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const intersect = xOver * yOver;
      if (intersect <= 0) continue;
      // Trivial parent/child overlap: skip if one fully contains the other and label is the same or generic.
      const aContainsB = (a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h);
      const bContainsA = (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h);
      // Only flag NON-containment overlaps where both elements are independently positioned.
      if (!aContainsB && !bContainsA) {
        overlaps.push({
          area: intersect,
          a: `${a.tag}[${(a.label || '').slice(0, 30)}] @${a.x},${a.y} ${a.w}x${a.h} z=${a.z}`,
          b: `${b.tag}[${(b.label || '').slice(0, 30)}] @${b.x},${b.y} ${b.w}x${b.h} z=${b.z}`,
        });
      }
    }
  }
  return overlaps.sort((p, q) => q.area - p.area);
}

const findings = {};

// Warm up Next.js by hitting / once with a generous timeout. First
// build pass takes 15-25s on dev server.
await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
await page.waitForTimeout(2000);

// State 1: fresh visit (cleared localStorage). Should show onboarding modal.
findings.fresh = findOverlaps(await snapWithRects('01-fresh-onboarding', async (p) => {
  await p.goto(FRONTEND + '/lenses/chat', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
}));

// State 2: post-onboarding (wizard + cookie banner together).
findings.postOnboarding = findOverlaps(await snapWithRects('02-post-onboarding', async (p) => {
  await p.evaluate(() => {
    localStorage.setItem('concord-onboarding-completed', 'true');
    localStorage.setItem('concord_onboarding_complete', 'true');
  });
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
}));

// State 3: trigger a toast while wizard is showing.
findings.withToast = findOverlaps(await snapWithRects('03-with-toast', async (p) => {
  await p.evaluate(() => {
    // Use the same store the app uses
    // @ts-ignore
    window.__concordAddToast?.('error', 'Test rate-limit message') ||
    document.dispatchEvent(new CustomEvent('test:toast', { detail: { type: 'error', message: 'Test rate-limit message' } }));
  });
  // Even without an addToast hook we still snap the state.
}));

// State 4: cookie accepted + wizard dismissed (the steady state).
findings.steady = findOverlaps(await snapWithRects('04-steady', async (p) => {
  await p.evaluate(() => {
    localStorage.setItem('concord_cookie_consent', 'accepted');
    localStorage.setItem('concord_first_win_dismissed', 'true');
  });
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
}));

// State 5: expand the Guide panel + sub-lenses to maximum chrome.
findings.maxChrome = findOverlaps(await snapWithRects('05-max-chrome', async (p) => {
  await p.evaluate(() => {
    localStorage.setItem('concord:guide-panel:collapsed', '0');
    localStorage.setItem('concord:sidebar:sub-lenses', '1');
    localStorage.setItem('concord:sidebar:systems', '1');
  });
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
}));

await browser.close();
fs.writeFileSync(path.join(SHOTS, 'overlaps.json'), JSON.stringify(findings, null, 2));
for (const [state, overlaps] of Object.entries(findings)) {
  if (overlaps.length === 0) {
    process.stderr.write(`✓ ${state}: no collisions\n`);
  } else {
    process.stderr.write(`✗ ${state}: ${overlaps.length} collision(s)\n`);
    for (const o of overlaps.slice(0, 5)) {
      process.stderr.write(`    area=${o.area}px²\n      A: ${o.a}\n      B: ${o.b}\n`);
    }
  }
}
