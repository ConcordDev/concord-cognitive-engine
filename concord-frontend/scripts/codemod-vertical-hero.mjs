#!/usr/bin/env node
/**
 * codemod-vertical-hero.mjs — mount <LensVerticalHero lensId="X" />
 * at the top of each "light vertical" lens page so it visually
 * promotes to a "solid vertical" workspace.
 *
 * Phase 9: from the lens audit, 38 lenses had the floor + auto-
 * discovered actions but no bespoke workspace surface.  This codemod
 * adds one: hero card + 3 stat tiles + 6 featured-action buttons
 * with JSON input drilldown.  Additive — does NOT replace existing
 * page content.
 *
 * The target list is hard-coded from the audit output (sorted by
 * score then LOC).  Inject path: right after DepthBadge mount.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const REPORT_DIR = path.resolve(FRONTEND, "..", "audit", "codemod-reports");
const DRY = process.argv.includes("--dry");

// 38 light-vertical lenses from the audit + 3 borderline scaffolds
// (forge / personas / deities) that have a workspace but no hero +
// no actions yet — promote them too.  41 total.
const TARGETS = [
  "anon", "ar", "black-market", "byo-keys", "classroom", "code-quality",
  "cognition", "desert", "expert-mode", "foundry", "fractal", "gallery",
  "genesis", "lab", "lattice", "legacy", "maker", "markets", "observe",
  "offline", "ops", "philosophy", "projects", "quantum", "root",
  "sandbox", "schema", "self", "settings", "suffering", "supplychain",
  "tournaments", "transfer", "understanding", "urban-planning",
  "veterinary", "wellness", "worldmodel",
  // Phase 9b — borderline scaffolds that benefit from the hero too.
  "forge", "personas", "deities",
];

function ensureImport(src) {
  if (src.includes("LensVerticalHero")) return src;
  // Anchor after the DepthBadge import (every target has one).
  const anchor = src.match(/^import\s+\{\s*DepthBadge\s*\}\s+from\s+['"]@\/components\/lens\/DepthBadge['"];?\s*$/m);
  if (!anchor) return src;
  const at = anchor.index + anchor[0].length;
  return src.slice(0, at) + "\nimport { LensVerticalHero } from '@/components/lens/LensVerticalHero';" + src.slice(at);
}

function injectAfterDepthBadge(src, lensId) {
  if (/<LensVerticalHero\s/.test(src)) return null;
  // Inject right after the FIRST <DepthBadge ... /> mount.  Skip if
  // there's no DepthBadge JSX mount even though there's an import.
  const re = /<DepthBadge\s+lensId="([^"]+)"[\s\S]*?\/>/;
  const m = src.match(re);
  if (!m) return null;
  const at = m.index + m[0].length;
  const inject = `\n      <LensVerticalHero lensId="${lensId}" className="mx-6 mt-4" />`;
  return src.slice(0, at) + inject + src.slice(at);
}

async function processFile(lensId) {
  const file = path.join(FRONTEND, "app", "lenses", lensId, "page.tsx");
  let src;
  try { src = await readFile(file, "utf8"); }
  catch { return { lensId, status: "skip", reason: "file_missing" }; }

  if (/<LensVerticalHero\s/.test(src)) {
    return { file, lensId, status: "skip", reason: "already_mounted" };
  }
  const next1 = ensureImport(src);
  if (next1 === src) return { file, lensId, status: "skip", reason: "no_depth_badge_import" };
  const next2 = injectAfterDepthBadge(next1, lensId);
  if (!next2) return { file, lensId, status: "skip", reason: "no_depth_badge_mount" };
  if (!DRY) await writeFile(file, next2);
  return { file, lensId, status: DRY ? "dry-applied" : "applied" };
}

(async () => {
  await mkdir(REPORT_DIR, { recursive: true });
  const results = [];
  for (const lensId of TARGETS) {
    results.push(await processFile(lensId));
  }
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
    skippedLenses: skipped.map(r => `${r.lensId}: ${r.reason}`),
    appliedLenses: applied.map(r => r.lensId),
  };
  const out = path.join(REPORT_DIR, "vertical-hero-codemod.json");
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`${DRY ? "[DRY] " : ""}Applied: ${applied.length} / Skipped: ${skipped.length}`);
  if (skipped.length > 0) console.log(`Skip reasons: ${JSON.stringify(reasons)}`);
  console.log(`Report: ${out}`);
})();
