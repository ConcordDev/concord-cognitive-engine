#!/usr/bin/env node
// scripts/audit-browser-detail.mjs
//
// Targeted detail capture: re-runs axe on the lenses that the main audit
// flagged as failing and writes per-node html/target/failureSummary so we
// can pin down which element each color-contrast violation refers to.
//
// The Playwright-driving loop needs a real browser + `audit/browser-audit.
// json` from a prior scripts/audit-browser.mjs run, neither of which is
// available in every environment this script is imported from. The pure
// "which lenses need a re-scan" + "how to shape one axe result" logic is
// factored into exported functions below so it's unit-testable directly
// (see server/tests/audit-browser-detail-gate.test.js) without touching
// Playwright — mirroring the isMainModule guard pattern already used by
// scripts/extract-macro-input-hints.mjs.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Given a `browser-audit.json`-shaped aggregate, returns the ordered list
 * of lens names that carry at least one a11y violation — the set the
 * targeted re-scan should re-visit. Pure — no I/O, no browser. */
export function pickFailingLenses(aggregate) {
  return (aggregate.results || [])
    .filter((l) => l.violations && l.violations.length > 0)
    .map((l) => l.lens);
}

/** Shapes a raw axe-core `.violations` array (from `AxeBuilder#analyze()`)
 * into the compact per-node detail this script persists: id/impact plus
 * target/html/failureSummary per offending node. Pure — no I/O. */
export function summarizeAxeViolations(violations) {
  return (violations || []).map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: (v.nodes || []).map((n) => ({
      target: n.target,
      html: n.html,
      failureSummary: n.failureSummary,
    })),
  }));
}

async function main() {
  const { chromium } = await import('playwright');
  const { AxeBuilder } = await import('@axe-core/playwright');

  const aggregate = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'browser-audit.json'), 'utf8'));
  const failing = pickFailingLenses(aggregate);

  console.error(`Re-scanning ${failing.length} failing lenses for node detail…`);

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const out = [];

  for (const lens of failing) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${FRONTEND_URL}/lenses/${lens}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
      await page.waitForTimeout(2500);
      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const detail = summarizeAxeViolations(axeResults.violations);
      out.push({ lens, detail });
      process.stderr.write(`[${out.length}/${failing.length}] ${lens} — ${detail.reduce((s, v) => s + v.nodes.length, 0)} nodes\n`);
    } catch (e) {
      out.push({ lens, error: String(e?.message || e).slice(0, 200) });
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'audit', 'browser-audit-detail.json'), JSON.stringify(out, null, 2));
  console.error(`Wrote audit/browser-audit-detail.json`);
}

// Guard so the exported pure functions above can be imported by unit tests
// without launching a real browser (or reading audit/browser-audit.json)
// as a side effect of the import.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exitCode = 1;
  });
}
