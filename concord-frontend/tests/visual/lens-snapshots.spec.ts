// concord-frontend/tests/visual/lens-snapshots.spec.ts
//
// Sprint 24 — visual regression gate.
//
// Playwright's built-in snapshot diffing renders each critical-path lens
// and compares against a stored baseline. Any unintended pixel-level
// regression (CSS bug, accidental layout shift, font drift, missing
// component) fails CI.
//
// Why Playwright not Percy/Chromatic: Percy + Chromatic are commercial
// per-month SaaS. Playwright snapshots are free, run on the same CI
// runner as the rest of the suite, and produce a diff image in the
// workflow artifact when a comparison fails.
//
// Tolerance: 0.5% pixel diff is the default to absorb font-rendering
// noise across Linux distros. For text-heavy lenses we go tighter
// (0.2%); for 3D/animated lenses we go looser (1.5%) since canvas
// frames are stochastic.
//
// To update baselines:
//   npx playwright test --update-snapshots tests/visual

import { test, expect, type Page } from "@playwright/test";

// Critical-path lenses that get visual-regression coverage. One screenshot
// per route at desktop width. We don't snapshot the world / concordia /
// studio lenses — they're 3D/animated and would flake every run.
const STATIC_LENSES: Array<{ route: string; threshold: number }> = [
  { route: "/", threshold: 0.005 },
  { route: "/lenses/hub", threshold: 0.005 },
  { route: "/lenses/chat", threshold: 0.005 },
  { route: "/lenses/code", threshold: 0.008 },
  { route: "/lenses/marketplace", threshold: 0.005 },
  { route: "/lenses/creator", threshold: 0.005 },
  { route: "/lenses/byo-keys", threshold: 0.002 },
  { route: "/lenses/expert-mode", threshold: 0.005 },
  { route: "/lenses/news", threshold: 0.008 },
  { route: "/lenses/legal", threshold: 0.002 },
  { route: "/lenses/healthcare", threshold: 0.002 },
  { route: "/lenses/finance", threshold: 0.002 },
  { route: "/lenses/forge", threshold: 0.005 },
  { route: "/lenses/wallet", threshold: 0.005 },
  { route: "/lenses/atlas", threshold: 0.01 },
  { route: "/lenses/music", threshold: 0.01 },
  { route: "/lenses/sync", threshold: 0.005 },
  { route: "/lenses/classroom", threshold: 0.005 },
];

const BASE_URL = process.env.CONCORD_FRONTEND_URL || "http://localhost:3000";

// Mask volatile regions before snapshotting — clocks, live counters,
// rotating greetings. The mask covers the region with a deterministic
// black box so the diff sees the same pixels every run.
const VOLATILE_SELECTORS = [
  '[data-volatile="true"]',     // explicit opt-in marker for components
  ".animate-pulse",              // tailwind pulse animations
  ".live-counter",               // anything ticking up live
  "[data-testid='live-clock']",  // clocks
];

async function prepareForSnapshot(page: Page) {
  // Freeze animations to a single frame so timing noise doesn't flake
  // the comparison. Also disables CSS transitions globally.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  // Wait for fonts to settle (FOUT/FOIT can cause 1-2% diff on first paint)
  await page.evaluate(() => document.fonts && document.fonts.ready);
}

test.describe("visual regression — critical-path lenses", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const { route, threshold } of STATIC_LENSES) {
    test(`${route} matches baseline (Δ ≤ ${threshold * 100}%)`, async ({ page }) => {
      const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 30_000 });
      // Don't snapshot a 5xx — fail loudly with the error body so the run
      // is debuggable rather than "snapshot diff exceeds threshold".
      if (response && response.status() >= 500) {
        throw new Error(`${route} returned HTTP ${response.status()} — visual snapshot skipped`);
      }
      await prepareForSnapshot(page);
      await expect(page).toHaveScreenshot(`${route.replace(/[^a-z0-9]+/gi, "_")}.png`, {
        fullPage: true,
        maxDiffPixelRatio: threshold,
        mask: VOLATILE_SELECTORS.map(sel => page.locator(sel)),
      });
    });
  }
});

test.describe("visual regression — responsive breakpoints", () => {
  // One responsive snapshot per critical screen-size break, on the
  // primary hub route. The full per-lens × per-breakpoint matrix would
  // be a 90-cell suite — overkill for what we'd actually find. The hub
  // is the canary: if it survives a breakpoint, the rest usually do.
  const HUB_ROUTE = "/lenses/hub";
  const BREAKPOINTS: Array<{ name: string; width: number; height: number }> = [
    { name: "mobile-portrait", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
    { name: "wide", width: 1920, height: 1080 },
  ];

  for (const bp of BREAKPOINTS) {
    test(`hub responsive @ ${bp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`${BASE_URL}${HUB_ROUTE}`, { waitUntil: "networkidle", timeout: 30_000 });
      await prepareForSnapshot(page);
      await expect(page).toHaveScreenshot(`hub_${bp.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.008,
      });
    });
  }
});
