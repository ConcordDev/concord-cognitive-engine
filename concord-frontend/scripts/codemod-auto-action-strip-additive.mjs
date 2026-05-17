#!/usr/bin/env node
/**
 * codemod-auto-action-strip-additive.mjs — append <AutoActionStrip />
 * to lens pages that already mount a bespoke <XActionPanel /> so users
 * STILL get the full "every backend action" surface alongside the
 * curated panel.
 *
 * Phase 8b: additive companion to the first codemod. The bespoke
 * panels (Forestry, Mental-Health, Crypto, Finance, Cooking,
 * Accounting, etc.) ship richer forms + custom result UI for the
 * 3-5 most important computes per lens, but they leave the OTHER
 * 20-40 registered actions invisible.  AutoActionStrip below them
 * surfaces the long tail.
 *
 * Strategy:
 *   1. Only target files with a bespoke <XActionPanel /> mount AND
 *      no existing <AutoActionStrip /> mount.
 *   2. Inject import after RecentMineCard import.
 *   3. Inject the strip mount right after the RecentMineCard JSX so
 *      it sits below the recents card at the bottom of every lens.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-auto-action-strip-additive.mjs --dry
 *   node scripts/codemod-auto-action-strip-additive.mjs
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const LENSES = path.join(FRONTEND, "app", "lenses");
const REPORT_DIR = path.resolve(FRONTEND, "..", "audit", "codemod-reports");

const DRY = process.argv.includes("--dry");

function ensureImport(src) {
  if (src.includes("AutoActionStrip")) return src;
  const anchor = src.match(/^import\s+\{\s*RecentMineCard\s*\}\s+from\s+['"]@\/components\/lens\/RecentMineCard['"];?\s*$/m);
  if (!anchor) return src;
  const at = anchor.index + anchor[0].length;
  return src.slice(0, at) + "\nimport { AutoActionStrip } from '@/components/lens/AutoActionStrip';" + src.slice(at);
}

function injectAfterRecentMine(src, lensId) {
  if (/<AutoActionStrip\s/.test(src)) return null;
  const re = /<RecentMineCard\s+domain="([^"]+)"[\s\S]*?\/>/;
  const m = src.match(re);
  if (!m) return null;
  const insertAt = m.index + m[0].length;
  const inject = `\n          <AutoActionStrip domain="${lensId}" hideWhenEmpty className="mt-3" title="More actions" />`;
  return src.slice(0, insertAt) + inject + src.slice(insertAt);
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (/<AutoActionStrip\s/.test(src)) {
    return { file, lensId, status: "skip", reason: "already_mounted" };
  }
  if (!/<[A-Z][a-zA-Z]+ActionPanel\b/.test(src)) {
    return { file, lensId, status: "skip", reason: "no_bespoke_panel" };
  }
  if (!src.includes("RecentMineCard")) {
    return { file, lensId, status: "skip", reason: "no_recent_mine_card" };
  }
  const next1 = ensureImport(src);
  if (next1 === src) {
    return { file, lensId, status: "skip", reason: "import_anchor_missing" };
  }
  const next2 = injectAfterRecentMine(next1, lensId);
  if (!next2) return { file, lensId, status: "skip", reason: "no_mount_point" };
  if (!DRY) await writeFile(file, next2);
  return { file, lensId, status: DRY ? "dry-applied" : "applied" };
}

async function walk() {
  const entries = await readdir(LENSES, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(LENSES, e.name, "page.tsx");
    try { await readFile(file, "utf8"); } catch { continue; }
    results.push(await processFile(file, e.name));
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
  const out = path.join(REPORT_DIR, "auto-action-strip-additive-codemod.json");
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`${DRY ? "[DRY] " : ""}Applied: ${applied.length} / Skipped: ${skipped.length}`);
  console.log(`Skip reasons: ${JSON.stringify(reasons)}`);
})();
