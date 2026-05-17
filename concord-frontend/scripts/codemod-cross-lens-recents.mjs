#!/usr/bin/env node
/**
 * codemod-cross-lens-recents.mjs — mount <CrossLensRecentsPanel /> in
 * every lens page that already mounts RecentMineCard.
 *
 * Phase 7 of the UX completeness sprint. Pair with the
 * dtu_surface.surfaced_from macro to surface "DTUs from elsewhere"
 * inline next to the lens's own recents.
 *
 * Strategy:
 *   1. Skip files that already import CrossLensRecentsPanel.
 *   2. Skip files without RecentMineCard (Phase 3 didn't mount it →
 *      bespoke lens, skip).
 *   3. Add CrossLensRecentsPanel import next to RecentMineCard.
 *   4. Inject `<CrossLensRecentsPanel lensId="<lens>" sinceDays={7}
 *      limit={6} hideWhenEmpty className="mt-3" />` immediately AFTER
 *      the RecentMineCard mount, so they stack vertically at the
 *      bottom of every lens.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-cross-lens-recents.mjs --dry
 *   node scripts/codemod-cross-lens-recents.mjs
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const LENSES = path.join(FRONTEND, "app", "lenses");
const REPORT_DIR = path.resolve(FRONTEND, "..", "audit", "codemod-reports");

const DRY = process.argv.includes("--dry");

function ensureImport(src, importLine, identifier) {
  if (src.includes(identifier)) return src;
  const anchor = src.match(/^import\s+\{\s*RecentMineCard\s*\}\s+from\s+['"]@\/components\/lens\/RecentMineCard['"];?\s*$/m);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    return src.slice(0, at) + "\n" + importLine + src.slice(at);
  }
  return src; // No RecentMineCard import → not a candidate.
}

function injectAfterRecentMine(src, lensId) {
  // Find the RecentMineCard JSX mount and inject CrossLensRecentsPanel right after.
  const re = /<RecentMineCard\s+domain="([^"]+)"[\s\S]*?\/>/;
  const m = src.match(re);
  if (!m) return null;
  const insertAt = m.index + m[0].length;
  const inject = `\n          <CrossLensRecentsPanel lensId="${lensId}" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />`;
  return src.slice(0, insertAt) + inject + src.slice(insertAt);
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (src.includes("CrossLensRecentsPanel")) {
    return { file, lensId, status: "skip", reason: "already_mounted" };
  }
  if (!src.includes("RecentMineCard")) {
    return { file, lensId, status: "skip", reason: "no_recent_mine_card" };
  }
  let next = ensureImport(
    src,
    'import { CrossLensRecentsPanel } from \'@/components/lens/CrossLensRecentsPanel\';',
    "CrossLensRecentsPanel",
  );
  if (next === src) {
    return { file, lensId, status: "skip", reason: "import_anchor_missing" };
  }
  const injected = injectAfterRecentMine(next, lensId);
  if (!injected) {
    return { file, lensId, status: "skip", reason: "no_mount_point" };
  }
  if (!DRY) await writeFile(file, injected);
  return { file, lensId, status: DRY ? "dry-applied" : "applied" };
}

async function walk() {
  const entries = await readdir(LENSES, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(LENSES, e.name, "page.tsx");
    try {
      await readFile(file, "utf8");
    } catch { continue; }
    const r = await processFile(file, e.name);
    results.push(r);
  }
  return results;
}

(async () => {
  await mkdir(REPORT_DIR, { recursive: true });
  const results = await walk();
  const applied = results.filter(r => r.status === "applied" || r.status === "dry-applied");
  const skipped = results.filter(r => r.status === "skip");
  const reasons = {};
  for (const r of skipped) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const report = {
    mode: DRY ? "dry" : "applied",
    total: results.length,
    applied: applied.length,
    skipped: skipped.length,
    skipReasons: reasons,
    appliedFiles: applied.map(r => path.relative(FRONTEND, r.file)),
  };
  const out = path.join(REPORT_DIR, "cross-lens-recents-codemod.json");
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`${DRY ? "[DRY] " : ""}Applied: ${applied.length} / Skipped: ${skipped.length}`);
  console.log(`Skip reasons: ${JSON.stringify(reasons)}`);
  console.log(`Report: ${out}`);
})();
