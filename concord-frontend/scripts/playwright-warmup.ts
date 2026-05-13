/**
 * Playwright globalSetup — warm every Next.js app route before tests
 * run.
 *
 * Why: CI runs against `next start` against a pre-built artifact.
 * Next still lazy-compiles each route on first visit (the per-route
 * RSC payload + page chunks are loaded on demand), so the first test
 * that hits any given route can wait 30-60 s for the compile to
 * finish. Across 270+ routes that compounds beyond the per-action
 * timeout.
 *
 * Solution: enumerate every `app/<segments>/page.tsx`, convert to a
 * URL (skipping route groups, replacing dynamic segments with a
 * placeholder), and fetch each one once with a generous timeout.
 * After this returns, every route has been compiled and the lazy-
 * compile latency for subsequent test visits drops to ~milliseconds.
 *
 * Runs once before any test. Failures are logged but non-fatal —
 * tests still get to attempt their navigation, and a route that
 * 404s here may legitimately 404 (e.g. requires query params).
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(FRONTEND_ROOT, "app");

const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", "build", "__tests__"]);
const SKIP_ROUTE_PREFIXES = ["/legal/dmca", "/legal/privacy", "/legal/terms"];

function collectRoutes(dir: string, urlSegments: string[] = []): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir) as string[]; } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      let nextSegment: string;
      if (entry.startsWith("(") && entry.endsWith(")")) {
        // Route group — URL-invisible
        nextSegment = "";
      } else if (entry.startsWith("[") && entry.endsWith("]")) {
        // Dynamic segment — use a placeholder. The compile is the
        // same regardless of the actual value, so any string works.
        nextSegment = "warmup";
      } else {
        nextSegment = entry;
      }
      const nextSegments = nextSegment ? [...urlSegments, nextSegment] : urlSegments;
      out.push(...collectRoutes(full, nextSegments));
    } else if (entry === "page.tsx" || entry === "page.ts" || entry === "page.jsx" || entry === "page.js") {
      out.push("/" + urlSegments.join("/"));
    }
  }
  return out;
}

async function warmRoute(baseUrl: string, route: string, timeoutMs: number): Promise<{ route: string; status: number | string; ms: number }> {
  const start = Date.now();
  try {
    const r = await fetch(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(timeoutMs),
      // Don't follow redirects — auth-protected routes will 302 to
      // /login; the redirect target is itself a route we'll warm.
      redirect: "manual",
    });
    return { route, status: r.status, ms: Date.now() - start };
  } catch (err) {
    return { route, status: err instanceof Error ? err.message : String(err), ms: Date.now() - start };
  }
}

export default async function globalSetup() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const onlyCI = process.env.CI === "true" || process.env.CI === "1";
  if (!onlyCI && !process.env.CONCORD_PLAYWRIGHT_WARMUP) {
    // Skip warmup in local dev unless explicitly opted in. Local
    // dev uses `next dev` which compiles fast enough.
    return;
  }

  const allRoutes = collectRoutes(APP_DIR);
  let routes = allRoutes.filter((r) => !SKIP_ROUTE_PREFIXES.some((p) => r.startsWith(p)));

  // Scope filter: CONCORD_PLAYWRIGHT_WARMUP_ROUTES=/a,/b,/c restricts
  // warmup to just those routes. Used by playwright-infra.config.ts,
  // where the 4 infra specs only visit 5 routes — warming all 270
  // wastes 6-8 minutes of the 20-minute globalTimeout budget.
  const scopeEnv = process.env.CONCORD_PLAYWRIGHT_WARMUP_ROUTES;
  if (scopeEnv) {
    const allow = new Set(scopeEnv.split(",").map((s) => s.trim()).filter(Boolean));
    routes = routes.filter((r) => allow.has(r));
  }
  console.log(`[playwright-warmup] warming ${routes.length} routes against ${baseUrl}${scopeEnv ? ` (scoped via env)` : ""}`);

  const t0 = Date.now();
  // Parallelism: 12 concurrent fetches + 15 s per-route timeout keeps
  // the worst-case wall-clock under ~6 minutes. Previous 6-way × 30 s
  // setting could hit ~22 minutes worst-case, which exceeded
  // playwright.config.ts globalTimeout (20 min) and caused the test
  // step to fail before any spec ran. The Next.js server compile pool
  // can absorb 12 concurrent first-visits without thrashing.
  // Hard cap for the entire warmup loop — if we hit this, abandon
  // remaining routes and let tests run; missing-warm routes will just
  // be slower on first visit, not broken.
  const HARD_CAP_MS = 8 * 60 * 1000; // 8 minutes
  const PER_ROUTE_MS = 15000;
  const concurrency = 12;
  const deadline = t0 + HARD_CAP_MS;
  const queue = [...routes];
  const inFlight: Promise<void>[] = [];
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  async function worker() {
    while (queue.length > 0) {
      if (Date.now() >= deadline) {
        skipped += queue.length;
        queue.length = 0;
        return;
      }
      const route = queue.shift();
      if (!route) return;
      const result = await warmRoute(baseUrl, route, PER_ROUTE_MS);
      if (typeof result.status === "number" && result.status < 500) ok++;
      else { failed++; console.log(`[playwright-warmup] route=${result.route} status=${result.status} ms=${result.ms}`); }
    }
  }

  for (let i = 0; i < concurrency; i++) inFlight.push(worker());
  await Promise.all(inFlight);

  console.log(`[playwright-warmup] done — ${ok} ok, ${failed} failed, ${skipped} skipped (deadline), total ${Date.now() - t0}ms`);
}
