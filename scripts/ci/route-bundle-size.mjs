#!/usr/bin/env node
// scripts/ci/route-bundle-size.mjs
//
// Per-route JS bundle size gate, replacing size-limit's glob-based config.
//
// size-limit's `.size-limit.json` matched chunk files by predictable
// per-route names (`.next/static/chunks/app/lenses/chat/page-*.js`) - a
// webpack convention. Next.js 16 defaults to Turbopack, which emits
// content-hashed, flat chunk files with no per-route naming at all
// (`.next/static/chunks/2__a28g_dstsm.js`), so every one of those globs
// silently matched zero files ("Bundle size — size-limit" failing on every
// build after the Next 15->16 bump). There is no glob fix for this - the
// naming convention itself no longer exists.
//
// The real per-route chunk list still exists though: Next's app-router
// build emits `.next/server/app<route>/page_client-reference-manifest.js`,
// a `globalThis.__RSC_MANIFEST["<route>/page"] = {...}` assignment whose
// `clientModules` map lists every chunk each client module needs. This
// script reads that (plus the route's `page/build-manifest.json` for the
// shared root/polyfill chunks, unioned in for completeness), resolves the
// real static chunk files, and gzips them.
//
// MEASUREMENT NOTE (why "incremental" mode exists): every route pulls in a
// large shared framework/vendor baseline (~650-700KB gzip measured
// 2026-07-31, post Next-16/Turbopack) - the old size-limit budgets
// (100-800KB) were calibrated against a webpack build where that baseline
// was much smaller and/or measured differently, so comparing a route's
// TOTAL bytes against those old numbers isn't apples-to-apples anymore.
// What the old budgets actually meant to track was each lens's OWN
// incremental weight beyond the shared app shell - measured here as
// chunks(route) minus chunks(homepage). The homepage route itself is
// checked in "absolute" mode (it defines the baseline, so there's nothing
// to subtract). Route budgets below were set from real measured values
// (see route-bundle-budgets.json) plus headroom, not guessed.

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../../concord-frontend");
const NEXT_DIR = path.join(FRONTEND_DIR, ".next");
const BUDGETS_PATH = path.join(FRONTEND_DIR, "route-bundle-budgets.json");

function routeToServerAppDir(route) {
  // "/" -> ".next/server/app", "/lenses/chat" -> ".next/server/app/lenses/chat"
  const trimmed = route === "/" ? "" : route.replace(/^\/|\/$/g, "");
  return path.join(NEXT_DIR, "server", "app", trimmed);
}

function extractRscManifestChunks(manifestJsPath) {
  const src = readFileSync(manifestJsPath, "utf8");
  // globalThis.__RSC_MANIFEST["<key>"] = {...};  -- exactly one assignment per file.
  const match = src.match(/__RSC_MANIFEST\[[^\]]+\]\s*=\s*(\{[\s\S]*\});?\s*$/m);
  if (!match) throw new Error(`could not find __RSC_MANIFEST assignment in ${manifestJsPath}`);
  const manifest = JSON.parse(match[1]);
  const chunks = new Set();
  for (const mod of Object.values(manifest.clientModules || {})) {
    for (const c of mod.chunks || []) chunks.add(c);
  }
  return chunks;
}

function extractBuildManifestChunks(buildManifestPath) {
  if (!existsSync(buildManifestPath)) return new Set();
  const bm = JSON.parse(readFileSync(buildManifestPath, "utf8"));
  const chunks = new Set();
  for (const f of [...(bm.rootMainFiles || []), ...(bm.polyfillFiles || []), ...(bm.lowPriorityFiles || [])]) {
    chunks.add("/_next/" + f);
  }
  return chunks;
}

function chunksForRoute(route) {
  const appDir = routeToServerAppDir(route);
  const manifestJsPath = path.join(appDir, "page_client-reference-manifest.js");
  if (!existsSync(manifestJsPath)) return null;
  return new Set([
    ...extractRscManifestChunks(manifestJsPath),
    ...extractBuildManifestChunks(path.join(appDir, "page", "build-manifest.json")),
  ]);
}

function resolveChunkPath(chunkRef) {
  // chunkRef looks like "/_next/static/chunks/xyz.js" (RSC manifest) or a
  // bare "static/chunks/xyz.js" (build-manifest, normalised above to the
  // same "/_next/..." shape). Either way it's relative to the app's public
  // asset root, which on disk is `.next/<the part after /_next/>`.
  const rel = chunkRef.replace(/^\/_next\//, "");
  return path.join(NEXT_DIR, rel);
}

function gzipTotal(chunkRefs) {
  let total = 0;
  let missing = 0;
  for (const chunkRef of chunkRefs) {
    const filePath = resolveChunkPath(chunkRef);
    if (!existsSync(filePath)) { missing++; continue; }
    total += gzipSync(readFileSync(filePath), { level: 9 }).length;
  }
  return { totalBytes: total, missing };
}

function checkRoute(budget, baselineChunks) {
  const { name, route, mode, limitKb } = budget;
  const chunks = chunksForRoute(route);
  if (!chunks) {
    return { name, route, ok: false, error: `no page_client-reference-manifest.js for ${route} - does this route still exist / did the build succeed?` };
  }

  const measured = mode === "incremental"
    ? [...chunks].filter((c) => !baselineChunks.has(c))
    : [...chunks];
  const { totalBytes, missing } = gzipTotal(measured);
  const totalKb = totalBytes / 1024;
  return { name, route, mode, ok: totalKb <= limitKb, totalKb, limitKb, chunkCount: measured.length, missing };
}

function main() {
  if (!existsSync(NEXT_DIR)) {
    console.error(`::error::${NEXT_DIR} does not exist - run the build first`);
    process.exit(1);
  }
  const budgets = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
  const baselineBudget = budgets.find((b) => b.mode === "absolute");
  const baselineChunks = baselineBudget ? (chunksForRoute(baselineBudget.route) || new Set()) : new Set();

  let anyFail = false;
  console.log("\nRoute bundle size (real Turbopack output, gzip)\n");
  for (const budget of budgets) {
    const r = checkRoute(budget, baselineChunks);
    if (r.error) {
      console.log(`  ${r.name}\n    \x1b[31m${r.error}\x1b[39m`);
      anyFail = true;
      continue;
    }
    const status = r.ok ? "\x1b[32mPASS\x1b[39m" : "\x1b[31mFAIL\x1b[39m";
    const modeLabel = r.mode === "incremental" ? "incremental over homepage" : "absolute";
    console.log(`  ${r.name} (${r.route}, ${modeLabel})`);
    console.log(`    ${status}  ${r.totalKb.toFixed(1)} KB / ${r.limitKb} KB gzip  (${r.chunkCount} chunks${r.missing ? `, ${r.missing} missing on disk` : ""})`);
    if (!r.ok) anyFail = true;
  }
  console.log("");

  if (anyFail) {
    console.error("::error::one or more routes exceeded their bundle size budget (see above)");
    process.exit(1);
  }
}

main();
