#!/usr/bin/env node
/**
 * codemod-first-run-tour.mjs — mount <FirstRunTour /> in every lens page.
 *
 * Phase 5 of the 10-dimension UX completeness sprint. Each tour is
 * driven by manifest.firstRunGuide — degrades to no-op when the manifest
 * doesn't have a guide yet (so this codemod is safe to run before all
 * 232 × tour copies are authored).
 *
 * Strategy:
 *   1. Skip files that already import FirstRunTour.
 *   2. Skip files without <LensShell>.
 *   3. Insert FirstRunTour import after LensShell import.
 *   4. Inject <FirstRunTour lensId="<lens>" /> right after the
 *      <LensShell> open tag.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-first-run-tour.mjs --dry
 *   node scripts/codemod-first-run-tour.mjs
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
  const anchor = src.match(/^import\s+\{\s*LensShell\s*\}\s+from\s+['"]@\/components\/lens\/LensShell['"];?\s*$/m);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    return src.slice(0, at) + "\n" + importLine + src.slice(at);
  }
  const first = src.match(/^import .+;?\s*$/m);
  if (!first) return src;
  const at = first.index + first[0].length;
  return src.slice(0, at) + "\n" + importLine + src.slice(at);
}

function injectTour(src, lensId) {
  const tag = `<FirstRunTour lensId="${lensId}" />`;
  const mShell = src.match(/<LensShell\b[^>]*>/);
  if (!mShell) return null;
  const at = mShell.index + mShell[0].length;
  return src.slice(0, at) + "\n      " + tag + src.slice(at);
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (src.includes("FirstRunTour")) return { skipped: "already-mounted" };
  if (!src.includes("<LensShell")) return { skipped: "no-lens-shell" };
  let next = ensureImport(
    src,
    `import { FirstRunTour } from '@/components/lens/FirstRunTour';`,
    "import { FirstRunTour }",
  );
  const injected = injectTour(next, lensId);
  if (!injected) return { skipped: "no-mount-point" };
  next = injected;
  if (!DRY) await writeFile(file, next, "utf8");
  return { applied: true };
}

function isoTs() { return new Date().toISOString().replace(/[:.]/g, "-"); }

async function main() {
  const entries = (await readdir(LENSES, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("."));
  let applied = 0;
  const skipped = {};
  const ledger = [];
  for (const dir of entries) {
    const file = path.join(LENSES, dir.name, "page.tsx");
    let res;
    try { res = await processFile(file, dir.name); }
    catch (e) { res = { skipped: "io-error:" + (e?.code || "?") }; }
    if (res.applied) { applied += 1; ledger.push({ lens: dir.name, status: "applied" }); }
    else {
      skipped[res.skipped] = (skipped[res.skipped] || 0) + 1;
      ledger.push({ lens: dir.name, status: "skipped", reason: res.skipped });
    }
  }
  console.log(`[${DRY ? "dry-run" : "done"}] FirstRunTour: applied=${applied}`);
  for (const [reason, count] of Object.entries(skipped)) {
    console.log(`  skipped(${reason}) = ${count}`);
  }
  if (!DRY) {
    await mkdir(REPORT_DIR, { recursive: true });
    const out = path.resolve(REPORT_DIR, `first-run-tour-${isoTs()}.json`);
    await writeFile(out, JSON.stringify({ ranAt: new Date().toISOString(), applied, skipped, ledger }, null, 2));
    console.log(`[done] ledger: ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
