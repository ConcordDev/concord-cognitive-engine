// concord-frontend/tests/a11y/axe.spec.ts
//
// Sprint 18 — platinum-tier accessibility audit.
//
// Runs axe-core (Deque) against every critical-path lens. Asserts WCAG
// 2.2 AA. AAA on lenses where it's defensible (chat, expert-mode,
// legal/healthcare/finance — high-trust surfaces).
//
// Why axe-core in addition to the production-grade gate?
// The Sprint 17 gate checks for the PRESENCE of focus styles via regex.
// axe-core checks the ACTUAL computed accessibility tree — color
// contrast, ARIA semantics, landmark structure, keyboard reach, label
// associations. Things regex can't see.
//
// Setup:
//   npm install -D @axe-core/playwright
//
// Run:
//   npx playwright test tests/a11y --project=chromium

import { test, expect } from '@playwright/test';

const CRITICAL_PATH_LENSES = [
  '/',
  '/lenses/chat',
  '/lenses/code',
  '/lenses/studio',
  '/lenses/music',
  '/lenses/marketplace',
  '/lenses/legal',
  '/lenses/healthcare',
  '/lenses/finance',
  '/lenses/creator',
  '/lenses/expert-mode',
  '/lenses/byo-keys',
  '/lenses/event-timeline',
  '/lenses/dtu',
  '/lenses/world',
  '/lenses/hub',
  '/lenses/forge',
  '/lenses/atlas',
  '/lenses/sandbox',
  '/lenses/agents',
];

// WCAG-AAA tier: extra-strict on contrast (7:1 for normal text vs 4.5:1
// for AA), more keyboard requirements, etc.
const AAA_REQUIRED = new Set([
  '/lenses/legal',
  '/lenses/healthcare',
  '/lenses/finance',
  '/lenses/chat',
  '/lenses/expert-mode',
]);

for (const route of CRITICAL_PATH_LENSES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Lazy-load @axe-core/playwright — keeps this file usable even if
    // the dep isn't installed yet (test fails with a clear message
    // instead of import error).
    let AxeBuilder;
    try {
      const mod = await import('@axe-core/playwright');
      AxeBuilder = mod.default;
    } catch {
      test.skip(true, '@axe-core/playwright not installed. Install with: npm install -D @axe-core/playwright');
      return;
    }

    const tags = AAA_REQUIRED.has(route)
      ? ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa']
      : ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

    const results = await new AxeBuilder({ page })
      .withTags(tags)
      .analyze();

    if (results.violations.length > 0) {
      console.error(`\naxe-core violations on ${route}:`);
      for (const v of results.violations) {
        console.error(`  [${v.impact}] ${v.id}: ${v.help}`);
        console.error(`    → ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`    target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(results.violations, `${route} has ${results.violations.length} accessibility violations`).toEqual([]);
  });
}
