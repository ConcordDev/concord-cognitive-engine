#!/usr/bin/env node
/**
 * codemod-depth-badge.mjs — mount <DepthBadge /> in every lens page.
 *
 * Phase 4 of the 10-dimension UX completeness sprint (but landing
 * early because it's mechanical and broadly visible).
 *
 * Strategy:
 *   1. Skip files that already import DepthBadge (avoid double-mount).
 *   2. Skip files without <LensShell> (not a real lens page).
 *   3. Insert the DepthBadge import after the LensShell import.
 *   4. Inject <DepthBadge lensId="<lens>" size="sm" className="ml-2" />
 *      just AFTER the existing <ManifestActionBar /> mount when present.
 *      If ManifestActionBar isn't mounted, inject right after the
 *      LensShell open tag.
 *
 * The lens id we pass is derived from the directory name (lensId from
 * codemod-manifest-helpers.mjs uses the same convention).
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-depth-badge.mjs --dry
 *   node scripts/codemod-depth-badge.mjs
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
  // Fallback: after first import.
  const first = src.match(/^import .+;?\s*$/m);
  if (!first) return src;
  const at = first.index + first[0].length;
  return src.slice(0, at) + "\n" + importLine + src.slice(at);
}

function injectBadge(src, lensId) {
  const badge = `<DepthBadge lensId="${lensId}" size="sm" className="ml-2" />`;

  // Prefer to land right after <ManifestActionBar /> (self-closing
  // or open-close). Two regex variants.
  const mActionBarSelf = src.match(/<ManifestActionBar\s*\/>/);
  if (mActionBarSelf) {
    const at = mActionBarSelf.index + mActionBarSelf[0].length;
    return src.slice(0, at) + "\n      " + badge + src.slice(at);
  }
  const mActionBarOpenClose = src.match(/<ManifestActionBar[^>]*>[\s\S]*?<\/ManifestActionBar>/);
  if (mActionBarOpenClose) {
    const at = mActionBarOpenClose.index + mActionBarOpenClose[0].length;
    return src.slice(0, at) + "\n      " + badge + src.slice(at);
  }
  // Fallback: right after the LensShell open tag.
  const mShell = src.match(/<LensShell\b[^>]*>/);
  if (mShell) {
    const at = mShell.index + mShell[0].length;
    return src.slice(0, at) + "\n      " + badge + src.slice(at);
  }
  return null;
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (src.includes("DepthBadge")) return { skipped: "already-mounted" };
  if (!src.includes("<LensShell")) return { skipped: "no-lens-shell" };

  let next = ensureImport(
    src,
    `import { DepthBadge } from '@/components/lens/DepthBadge';`,
    "import { DepthBadge }",
  );

  const injected = injectBadge(next, lensId);
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
  console.log(`[${DRY ? "dry-run" : "done"}] DepthBadge: applied=${applied}`);
  for (const [reason, count] of Object.entries(skipped)) {
    console.log(`  skipped(${reason}) = ${count}`);
  }
  if (!DRY) {
    await mkdir(REPORT_DIR, { recursive: true });
    const out = path.resolve(REPORT_DIR, `depth-badge-${isoTs()}.json`);
    await writeFile(out, JSON.stringify({ ranAt: new Date().toISOString(), applied, skipped, ledger }, null, 2));
    console.log(`[done] ledger: ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
