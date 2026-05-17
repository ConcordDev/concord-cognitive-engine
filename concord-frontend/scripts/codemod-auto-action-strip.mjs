#!/usr/bin/env node
/**
 * codemod-auto-action-strip.mjs — mount <AutoActionStrip lensId="X" />
 * in every lens page that has registered compute actions on the
 * backend but doesn't yet have a dedicated <XActionPanel /> wired.
 *
 * Phase 8: closes the "registered but never wired into UI" depth gap
 * that left ~250 trades-vertical compute actions unreachable.
 *
 * Strategy:
 *   1. Skip lenses where a bespoke <XActionPanel /> is already
 *      mounted (those wrap the actions with custom result UI).
 *   2. Skip lenses where AutoActionStrip is already mounted.
 *   3. Inject import + mount right after RecentMineCard. The strip
 *      auto-discovers via /api/lens-actions/<domain> and is harmless
 *      on empty (hideWhenEmpty defaults true).
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-auto-action-strip.mjs --dry
 *   node scripts/codemod-auto-action-strip.mjs
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
  const inject = "\nimport { AutoActionStrip } from '@/components/lens/AutoActionStrip';";
  return src.slice(0, at) + inject + src.slice(at);
}

function injectAfterRecentMine(src, lensId) {
  // Don't re-inject the JSX mount if already present.
  if (/<AutoActionStrip\s/.test(src)) return null;
  const re = /<RecentMineCard\s+domain="([^"]+)"[\s\S]*?\/>/;
  const m = src.match(re);
  if (!m) return null;
  const insertAt = m.index + m[0].length;
  const inject = `\n          <AutoActionStrip domain="${lensId}" hideWhenEmpty className="mt-3" />`;
  return src.slice(0, insertAt) + inject + src.slice(insertAt);
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (src.includes("AutoActionStrip")) {
    return { file, lensId, status: "skip", reason: "already_mounted" };
  }
  if (!src.includes("RecentMineCard")) {
    return { file, lensId, status: "skip", reason: "no_recent_mine_card" };
  }
  // Skip lenses with bespoke ActionPanels mounted (they wrap actions richer).
  if (/<[A-Z][a-zA-Z]+ActionPanel(\s|\/)/.test(src)) {
    return { file, lensId, status: "skip", reason: "bespoke_action_panel" };
  }
  const next1 = ensureImport(src);
  if (next1 === src) {
    return { file, lensId, status: "skip", reason: "import_anchor_missing" };
  }
  const next2 = injectAfterRecentMine(next1, lensId);
  if (!next2) {
    return { file, lensId, status: "skip", reason: "no_mount_point" };
  }
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
  const out = path.join(REPORT_DIR, "auto-action-strip-codemod.json");
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`${DRY ? "[DRY] " : ""}Applied: ${applied.length} / Skipped: ${skipped.length}`);
  console.log(`Skip reasons: ${JSON.stringify(reasons)}`);
  console.log(`Report: ${out}`);
})();
