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
//
// The Playwright-driving loop below needs a real browser + a real running
// frontend, neither of which is available in every environment this script
// is imported from (e.g. a unit-test sandbox with no Chromium binary). The
// pure aggregation/report-building logic is factored into exported
// functions below so it can be unit-tested directly (see
// server/tests/audit-browser-gate.test.js) without touching Playwright at
// all — mirroring the isMainModule guard pattern already used by
// scripts/extract-macro-input-hints.mjs.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const LENSES_DIR = path.join(ROOT, 'concord-frontend/app/lenses');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Reads a lenses directory and returns the sorted list of scannable lens
 * names — real subdirectories, excluding Next.js dynamic-route directories
 * (which start with `[`, e.g. `[id]`). Pure filesystem read, no network. */
export function listLenses(lensesDir) {
  return fs
    .readdirSync(lensesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('['))
    .map((e) => e.name)
    .sort();
}

/** Parses the `--max=N` CLI flag against a full lens list, returning the
 * slice to scan. No `--max=` flag (or an unparseable one) means "scan
 * everything". */
export function selectLensesToScan(lenses, argv) {
  const maxArg = argv.find((a) => a.startsWith('--max='));
  const max = maxArg ? parseInt(maxArg.split('=')[1], 10) : lenses.length;
  const bound = Number.isFinite(max) ? max : lenses.length;
  return lenses.slice(0, bound);
}

/** Builds the aggregate report object from a list of per-lens scan results
 * (the `lensResult` shape the Playwright loop produces). Pure — no I/O. */
export function buildAggregate(results) {
  const aggregate = {
    generatedAt: new Date().toISOString(),
    lensesScanned: results.length,
    lensesWithA11yViolations: results.filter((r) => r.violations.length > 0).length,
    lensesWithConsoleErrors: results.filter((r) => r.consoleErrors.length > 0).length,
    lensesWithNetworkErrors: results.filter((r) => r.networkErrors.length > 0).length,
    lensesWithMobileOverflow: results.filter((r) => r.viewports?.mobile?.horizontalOverflow).length,
    totalA11yViolations: results.reduce((s, r) => s + r.violations.length, 0),
    totalA11yNodes: results.reduce((s, r) => s + r.violations.reduce((sum, v) => sum + v.nodes, 0), 0),
    totalConsoleErrors: results.reduce((s, r) => s + r.consoleErrors.length, 0),
    // top violation IDs across all lenses
    topViolationIds: {},
    results,
  };
  for (const r of results) {
    for (const v of r.violations) {
      if (!aggregate.topViolationIds[v.id]) {
        aggregate.topViolationIds[v.id] = { lensCount: 0, totalNodes: 0, impact: v.impact, help: v.help };
      }
      aggregate.topViolationIds[v.id].lensCount++;
      aggregate.topViolationIds[v.id].totalNodes += v.nodes;
    }
  }
  return aggregate;
}

/** Renders the human-readable markdown summary from a built aggregate.
 * Pure string-building — no I/O. */
export function buildMarkdownReport(aggregate) {
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
  const ranked = aggregate.results
    .slice()
    .sort(
      (a, b) =>
        b.violations.length + b.consoleErrors.length + b.networkErrors.length -
        (a.violations.length + a.consoleErrors.length + a.networkErrors.length)
    );
  for (const r of ranked.slice(0, 30)) {
    const ov = r.viewports?.mobile?.overflowPx || 0;
    md.push(`| \`${r.lens}\` | ${r.violations.length} | ${r.consoleErrors.length} | ${r.networkErrors.length} | ${ov ? ov + 'px' : '—'} |`);
  }
  return md.join('\n');
}

/** Scans one lens in an already-launched browser. Isolated so main() stays
 * a thin orchestration loop; not unit-tested directly (requires a real
 * Playwright browser) but kept small so its shape is easy to eyeball. */
async function scanLens(browser, lens) {
  const lensStart = Date.now();
  const lensResult = { lens, ok: true, violations: [], consoleErrors: [], networkErrors: [], viewports: {} };
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[2] });
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => consoleErrors.push(`[uncaught] ${String(err?.message || err).slice(0, 300)}`));
    page.on('requestfailed', (req) => {
      const failure = req.failure();
      networkErrors.push({ url: req.url().slice(0, 200), error: failure?.errorText || 'unknown' });
    });

    const url = `${FRONTEND_URL}/lenses/${lens}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for network to quiesce so React has fully hydrated + any
      // initial fetches have resolved before axe inspects computed style.
      // Falls back to a fixed settle if networkidle times out (some
      // lenses keep a polling cadence open).
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch { /* ignore — fall through to fixed settle */ }
      await page.waitForTimeout(2500);
    } catch (e) {
      lensResult.ok = false;
      lensResult.gotoError = String(e?.message || e).slice(0, 200);
      consoleErrors.push(`[goto] ${lensResult.gotoError}`);
    }

    // axe a11y scan (desktop viewport)
    if (lensResult.ok) {
      try {
        const { AxeBuilder } = await import('@axe-core/playwright');
        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        lensResult.violations = (axeResults.violations || []).map((v) => ({
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
  return lensResult;
}

async function main() {
  const { chromium } = await import('playwright');

  const lenses = listLenses(LENSES_DIR);
  const lensesToScan = selectLensesToScan(lenses, process.argv);

  console.error(`Launching Chromium…`);
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  // Only pin a pre-baked browser if it actually exists. Otherwise let Playwright
  // resolve the chromium installed by `npx playwright install chromium` — its
  // revision tracks the installed playwright version, so a hardcoded revision path
  // (e.g. chromium-1194) goes stale on every playwright bump and fails to launch.
  if (fs.existsSync(CHROMIUM_PATH)) launchOpts.executablePath = CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);

  const results = [];
  for (const lens of lensesToScan) {
    const lensResult = await scanLens(browser, lens);
    results.push(lensResult);
    process.stderr.write(`[${results.length}/${lensesToScan.length}] ${lens} — ${lensResult.violations.length} a11y, ${lensResult.consoleErrors.length} console, ${lensResult.networkErrors.length} network\n`);
  }

  await browser.close();

  const aggregate = buildAggregate(results);

  fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'audit', 'browser-audit.json'), JSON.stringify(aggregate, null, 2));

  const md = buildMarkdownReport(aggregate);
  fs.writeFileSync(path.join(ROOT, 'audit', 'browser-audit.md'), md);

  console.error(`\nWrote audit/browser-audit.json + audit/browser-audit.md`);
  console.error(`Lenses with a11y violations:    ${aggregate.lensesWithA11yViolations}/${aggregate.lensesScanned}`);
  console.error(`Lenses with console errors:     ${aggregate.lensesWithConsoleErrors}/${aggregate.lensesScanned}`);
  console.error(`Lenses with network errors:     ${aggregate.lensesWithNetworkErrors}/${aggregate.lensesScanned}`);
  console.error(`Lenses with mobile overflow:    ${aggregate.lensesWithMobileOverflow}/${aggregate.lensesScanned}`);
}

// Guard so the exported pure functions above can be imported by unit tests
// (server/tests/audit-browser-gate.test.js) without launching a real
// browser as a side effect of the import.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exitCode = 1;
  });
}
