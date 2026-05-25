// scripts/explore-concord.mjs
//
// Drives concord like a real first-time visitor. Hits the landing,
// chat, world, code, music, marketplace, healthcare, atlas. Takes a
// screenshot of each and a short DOM digest so I can describe what
// I actually see rather than what the code claims.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'explore-shots');
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

// Capture console errors per page so I see what loads cleanly vs not.
const consoleLog = [];
page.on('console', m => { if (m.type() === 'error') consoleLog.push({ where: 'unknown', text: m.text().slice(0, 200) }); });

const stops = [
  { name: 'landing',     url: '/' },
  { name: 'chat',        url: '/lenses/chat' },
  { name: 'world',       url: '/lenses/world' },
  { name: 'code',        url: '/lenses/code' },
  { name: 'music',       url: '/lenses/music' },
  { name: 'marketplace', url: '/lenses/marketplace' },
  { name: 'healthcare',  url: '/lenses/healthcare' },
  { name: 'atlas',       url: '/lenses/atlas' },
  { name: 'global',      url: '/global' },
];

const report = [];

for (const stop of stops) {
  consoleLog.length = 0;
  const url = FRONTEND + stop.url;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SHOTS, `${stop.name}.png`), fullPage: false });

    // Cheap DOM digest: title, h1/h2 text, button labels, visible link text.
    const digest = await page.evaluate(() => {
      const txt = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      return {
        title: document.title,
        h1: Array.from(document.querySelectorAll('h1')).slice(0, 5).map(txt),
        h2: Array.from(document.querySelectorAll('h2')).slice(0, 8).map(txt),
        h3: Array.from(document.querySelectorAll('h3')).slice(0, 6).map(txt),
        buttons: Array.from(document.querySelectorAll('button')).slice(0, 12).map(txt).filter(x => x.length > 0 && x.length < 60),
        links: Array.from(document.querySelectorAll('a')).slice(0, 12).map(a => `${txt(a)} → ${a.getAttribute('href')}`).filter(s => s.length < 120),
        bodyTextSample: (document.body?.innerText || '').slice(0, 600).replace(/\n+/g, ' | '),
        url: location.href,
      };
    });

    report.push({
      ...stop,
      finalUrl: digest.url,
      title: digest.title,
      headings: { h1: digest.h1, h2: digest.h2, h3: digest.h3 },
      buttons: digest.buttons,
      links: digest.links,
      sample: digest.bodyTextSample,
      consoleErrors: consoleLog.length,
    });
    process.stderr.write(`[${stop.name}] title="${digest.title}" h1=${digest.h1.length} h2=${digest.h2.length} btns=${digest.buttons.length} errs=${consoleLog.length}\n`);
  } catch (e) {
    report.push({ ...stop, error: String(e?.message || e).slice(0, 200) });
    process.stderr.write(`[${stop.name}] ERROR ${e?.message || e}\n`);
  }
}

await browser.close();
fs.writeFileSync(path.join(ROOT, 'audit', 'explore-concord.json'), JSON.stringify(report, null, 2));
console.error(`Wrote audit/explore-concord.json + ${stops.length} screenshots to audit/explore-shots/`);
