import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * On-demand diagnostic config for the all-lenses-walk lens-health report.
 *
 * The walk (tests/e2e/all-lenses-walk.spec.ts) generates ~259 serial tests
 * (one per lens) whose assertion always passes — it's a diagnostic that
 * buckets each lens as green/noisy/crashed/timeout and writes
 * docs/all-lens-walk/results.json + per-lens screenshots. It is excluded
 * from the gating playwright.config.ts (it provides zero pass/fail signal
 * and ~25-35 min of wall-clock that blew the E2E Core job budget).
 *
 * Run it explicitly when you want the lens-health report:
 *   npm run test:e2e:walk
 *
 * Inherits everything from the base config but: re-includes the walk
 * (clears the base testIgnore), runs ONLY the walk, skips the route
 * pre-warm globalSetup (the walk navigates every lens itself), and gives
 * the serial walk a generous 40-min ceiling.
 */
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: ['**/all-lenses-walk.spec.ts'],
  globalSetup: undefined,
  globalTimeout: 40 * 60 * 1000,
});
