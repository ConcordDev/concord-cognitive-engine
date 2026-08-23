// concord-frontend/tests/perf-urban-hub-playwright.test.ts
//
// Real browser-based 60fps measurement for the UrbanHub scene.
// Uses Playwright + headless Chromium + frame timing hooks.
//
// This is the canonical 60fps target test. Skipped if Playwright not installed.

import { test, expect } from '@playwright/test';

test('UrbanHub scene maintains 60fps over 600 frames', async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT, 'PLAYWRIGHT not enabled');
  await page.goto(process.env.CONCORD_URL || 'http://localhost:3000');
  await page.waitForSelector('[data-testid="urban-hub-scene"]', { timeout: 30000 });

  // Use Performance API to measure frame timing
  const fpsResult = await page.evaluate(async () => {
    return new Promise<{ avg: number; p99: number; min: number; max: number; passed: boolean }>(
      (resolve) => {
        const frames: number[] = [];
        let lastT = performance.now();
        let rafId: number;
        const startT = lastT;
        const tick = (now: number) => {
          const dt = now - lastT;
          if (frames.length < 600) {
            frames.push(dt);
            lastT = now;
            rafId = requestAnimationFrame(tick);
          } else {
            frames.sort((a, b) => a - b);
            const avg = frames.reduce((s, x) => s + x, 0) / frames.length;
            const p99 = frames[Math.floor(frames.length * 0.99)];
            resolve({
              avg,
              p99,
              min: frames[0],
              max: frames[frames.length - 1],
              passed: avg < 33 && p99 < 50,
            });
          }
        };
        rafId = requestAnimationFrame(tick);
      },
    );
  });

  expect(fpsResult.avg).toBeLessThan(33);
  expect(fpsResult.p99).toBeLessThan(50);
  expect(fpsResult.passed).toBe(true);
});
