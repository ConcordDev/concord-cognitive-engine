#!/usr/bin/env node
// scripts/audit-browser-detail.mjs
//
// Targeted detail capture: re-runs axe on the lenses that the main audit
// flagged as failing and writes per-node html/target/failureSummary so we
// can pin down which element each color-contrast violation refers to.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const aggregate = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'browser-audit.json'), 'utf8'));
const failing = aggregate.results.filter(l => l.violations && l.violations.length > 0).map(l => l.lens);

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
    await page.waitForTimeout(1500);
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const detail = (axeResults.violations || []).map(v => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map(n => ({
        target: n.target,
        html: n.html,
        failureSummary: n.failureSummary,
      })),
    }));
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
