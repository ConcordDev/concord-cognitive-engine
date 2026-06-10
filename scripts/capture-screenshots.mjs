#!/usr/bin/env node
/**
 * capture-screenshots.mjs — point Playwright at a running Concord instance and
 * write README/marketing screenshots into docs/images/.
 *
 * Why this exists: real product screenshots need a running deployment with auth
 * + seeded data. The CI sandbox can't boot the full stack (no GPU brains, the
 * monolith's boot exceeds the harness timeout) and the public site is auth-gated,
 * so screenshots are captured by an operator running this against a live instance.
 *
 * Usage:
 *   cd concord-frontend && npx playwright install chromium   # one-time
 *   CONCORD_URL=https://your-instance \
 *   CONCORD_USER=you@example.com CONCORD_PASS=secret \
 *     node ../scripts/capture-screenshots.mjs
 *
 * Env:
 *   CONCORD_URL   base URL of a running instance        (default http://localhost:3000)
 *   CONCORD_USER  email/username for sign-in            (optional — skips auth if unset)
 *   CONCORD_PASS  password for sign-in                  (optional)
 *   SHOTS         comma list of lens paths to capture   (default below)
 *   OUT           output dir                            (default docs/images)
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const BASE = process.env.CONCORD_URL || "http://localhost:3000";
const USER = process.env.CONCORD_USER || "";
const PASS = process.env.CONCORD_PASS || "";
const OUT = path.resolve(ROOT, process.env.OUT || "docs/images");

// (filename, path) — the marquee surfaces worth showing.
const DEFAULT_SHOTS = [
  ["01-landing", "/"],
  ["02-hub", "/hub"],
  ["03-world", "/lenses/world"],
  ["04-chat", "/lenses/chat"],
  ["05-code", "/lenses/code"],
  ["06-finance", "/lenses/finance"],
  ["07-message-gmail", "/lenses/message"],
  ["08-calendar", "/lenses/calendar"],
  ["09-engineering", "/lenses/engineering"],
  ["10-music", "/lenses/music"],
];
const SHOTS = process.env.SHOTS
  ? process.env.SHOTS.split(",").map((p, i) => [`${String(i + 1).padStart(2, "0")}-${p.replace(/\W+/g, "-")}`, p.startsWith("/") ? p : `/lenses/${p}`])
  : DEFAULT_SHOTS;

async function signIn(page) {
  if (!USER || !PASS) return false;
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
    // Best-effort form fill — adjust selectors to the deployed login if needed.
    await page.fill('input[type="email"], input[name="email"], input[name="username"]', USER).catch(() => {});
    await page.fill('input[type="password"], input[name="password"]', PASS).catch(() => {});
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').catch(() => {}),
    ]);
    console.log("  ✓ signed in (or attempted)");
    return true;
  } catch (e) {
    console.warn(`  ! sign-in failed: ${e.message} — capturing public surfaces only`);
    return false;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Concord screenshot capture → ${OUT}`);
  console.log(`Target: ${BASE}${USER ? ` (as ${USER})` : " (anonymous)"}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await signIn(page);

  let ok = 0;
  for (const [name, route] of SHOTS) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1500); // let 3D / lazy panels settle
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`  ✓ ${name}  ←  ${route}`);
      ok++;
    } catch (e) {
      console.warn(`  ✗ ${name}  ←  ${route}  (${e.message})`);
    }
  }

  await browser.close();
  console.log(`\nDone: ${ok}/${SHOTS.length} captured into ${OUT}`);
  if (ok === 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
