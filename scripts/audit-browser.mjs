#!/usr/bin/env node
// scripts/audit-browser.mjs
//
// Live-server audit: opens each lens in a real Chromium via Playwright,
// runs axe-core (WCAG a11y), captures console errors, captures network
// failures, and checks for layout overflow at three viewport widths.
//
// Requires:
//   - Backend on http://127.0.0.1:5050 (CONCORD_NO_LISTEN=false)
//   - Frontend dev server on http://127.0.0.1:3000 (npm run dev)
//   - Chromium executable at /opt/pw-browsers/chromium-1194/chrome-linux/chrome
//
// Output: audit/browser-audit.json + audit/browser-audit.md

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const LENSES_DIR = path.join(ROOT, 'concord-frontend/app/lenses');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const lenses = fs.readdirSync(LENSES_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('['))
  .map(e => e.name).sort();

// CLI: --max=N limits the scan (for fast smoke). Default: all.
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX = maxArg ? parseInt(maxArg.split('=')[1], 10) : lenses.length;
const lensesToScan = lenses.slice(0, MAX);

console.error(`Launching Chromium…`);
const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const VIEWPORTS = [
  { name: 'mobile',  width: 375,  height: 667 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const results = [];

for (const lens of lensesToScan) {
  const lensStart = Date.now();
  const lensResult = { lens, ok: true, violations: [], consoleErrors: [], networkErrors: [], viewports: {} };
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[2] });
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', err => consoleErrors.push(`[uncaught] ${String(err.message || err).slice(0, 300)}`));
    page.on('requestfailed', req => {
      const failure = req.failure();
      networkErrors.push({ url: req.url().slice(0, 200), error: failure?.errorText || 'unknown' });
    });

    const url = `${FRONTEND_URL}/lenses/${lens}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // small settle delay for React hydration
      await page.waitForTimeout(1500);
    } catch (e) {
      lensResult.ok = false;
      lensResult.gotoError = String(e?.message || e).slice(0, 200);
      consoleErrors.push(`[goto] ${lensResult.gotoError}`);
    }

    // axe a11y scan (desktop viewport)
    if (lensResult.ok) {
      try {
        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        lensResult.violations = (axeResults.violations || []).map(v => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
        }));
      } catch (e) {
        lensResult.axeError = String(e?.message || e).slice(0, 200);
      }
    }

    // Responsive overflow check across viewports
    for (const vp of VIEWPORTS) {
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => {
          return {
            documentScrollWidth: document.documentElement.scrollWidth,
            documentClientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
          };
        });
        lensResult.viewports[vp.name] = {
          horizontalOverflow: overflow.documentScrollWidth > overflow.documentClientWidth + 2,
          overflowPx: Math.max(0, overflow.documentScrollWidth - overflow.documentClientWidth),
        };
      } catch (e) {
        lensResult.viewports[vp.name] = { error: String(e?.message || e).slice(0, 100) };
      }
    }

    lensResult.consoleErrors = consoleErrors.slice(0, 10);
    lensResult.networkErrors = networkErrors.slice(0, 10);
    lensResult.durationMs = Date.now() - lensStart;
    await context.close();
  } catch (e) {
    lensResult.ok = false;
    lensResult.fatalError = String(e?.message || e).slice(0, 300);
  }
  results.push(lensResult);
  process.stderr.write(`[${results.length}/${lensesToScan.length}] ${lens} — ${lensResult.violations.length} a11y, ${lensResult.consoleErrors.length} console, ${lensResult.networkErrors.length} network\n`);
}

await browser.close();

// Aggregate
const aggregate = {
  generatedAt: new Date().toISOString(),
  lensesScanned: results.length,
  lensesWithA11yViolations: results.filter(r => r.violations.length > 0).length,
  lensesWithConsoleErrors: results.filter(r => r.consoleErrors.length > 0).length,
  lensesWithNetworkErrors: results.filter(r => r.networkErrors.length > 0).length,
  lensesWithMobileOverflow: results.filter(r => r.viewports?.mobile?.horizontalOverflow).length,
  totalA11yViolations: results.reduce((s, r) => s + r.violations.length, 0),
  totalA11yNodes: results.reduce((s, r) => s + r.violations.reduce((sum, v) => sum + v.nodes, 0), 0),
  totalConsoleErrors: results.reduce((s, r) => s + r.consoleErrors.length, 0),
  // top violation IDs across all lenses
  topViolationIds: {},
  results,
};
for (const r of results) {
  for (const v of r.violations) {
    if (!aggregate.topViolationIds[v.id]) aggregate.topViolationIds[v.id] = { lensCount: 0, totalNodes: 0, impact: v.impact, help: v.help };
    aggregate.topViolationIds[v.id].lensCount++;
    aggregate.topViolationIds[v.id].totalNodes += v.nodes;
  }
}

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', 'browser-audit.json'), JSON.stringify(aggregate, null, 2));

// Markdown summary
const md = [];
md.push('# Browser Audit (axe-core + console + network + responsive)\n');
md.push(`Generated: ${aggregate.generatedAt}`);
md.push(`Lenses scanned: ${aggregate.lensesScanned}\n`);
md.push('## Summary\n');
md.push(`- Lenses with a11y violations: **${aggregate.lensesWithA11yViolations}** (${aggregate.totalA11yViolations} violations across ${aggregate.totalA11yNodes} nodes)`);
md.push(`- Lenses with console errors: **${aggregate.lensesWithConsoleErrors}** (${aggregate.totalConsoleErrors} errors total)`);
md.push(`- Lenses with network errors: **${aggregate.lensesWithNetworkErrors}**`);
md.push(`- Lenses with mobile horizontal overflow: **${aggregate.lensesWithMobileOverflow}**\n`);
md.push('## Top a11y violations (by lens prevalence)\n');
md.push('| Rule | Impact | Lenses | Total nodes | Help |');
md.push('|---|---|---:|---:|---|');
const sortedTop = Object.entries(aggregate.topViolationIds).sort((a, b) => b[1].lensCount - a[1].lensCount);
for (const [id, info] of sortedTop.slice(0, 20)) {
  md.push(`| \`${id}\` | ${info.impact} | ${info.lensCount} | ${info.totalNodes} | ${info.help} |`);
}
md.push('\n## Lenses with the most issues\n');
md.push('| Lens | A11y | Console | Network | Mobile overflow |');
md.push('|---|---:|---:|---:|---:|');
const ranked = results.slice().sort((a, b) =>
  (b.violations.length + b.consoleErrors.length + b.networkErrors.length) -
  (a.violations.length + a.consoleErrors.length + a.networkErrors.length)
);
for (const r of ranked.slice(0, 30)) {
  const ov = r.viewports?.mobile?.overflowPx || 0;
  md.push(`| \`${r.lens}\` | ${r.violations.length} | ${r.consoleErrors.length} | ${r.networkErrors.length} | ${ov ? ov + 'px' : '—'} |`);
}
fs.writeFileSync(path.join(ROOT, 'audit', 'browser-audit.md'), md.join('\n'));

console.error(`\nWrote audit/browser-audit.json + audit/browser-audit.md`);
console.error(`Lenses with a11y violations:    ${aggregate.lensesWithA11yViolations}/${aggregate.lensesScanned}`);
console.error(`Lenses with console errors:     ${aggregate.lensesWithConsoleErrors}/${aggregate.lensesScanned}`);
console.error(`Lenses with network errors:     ${aggregate.lensesWithNetworkErrors}/${aggregate.lensesScanned}`);
console.error(`Lenses with mobile overflow:    ${aggregate.lensesWithMobileOverflow}/${aggregate.lensesScanned}`);
