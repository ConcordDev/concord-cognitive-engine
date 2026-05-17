#!/usr/bin/env node
/**
 * codemod-recent-mine-card.mjs — mount <RecentMineCard /> in every lens
 * page that has a <LensShell> wrapper.
 *
 * Phase 3 of the 10-dimension UX completeness sprint.
 *
 * Strategy:
 *   1. Skip files that already import RecentMineCard.
 *   2. Skip files without <LensShell>.
 *   3. Skip files >3500 LOC (hero lenses with their own bespoke
 *      recents UI — `chat`, `world`, `studio`, `marketplace`, `code`,
 *      `legal`, `healthcare`, `realestate`, `forge`).
 *   4. Insert RecentMineCard import after LensShell import.
 *   5. Inject `<RecentMineCard domain="<lens>" limit={10}
 *      hideWhenEmpty className="mt-4" />` just BEFORE the closing
 *      </LensShell>. Lands at the bottom of the main column on every
 *      lens — discoverable without disrupting bespoke layout above.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-recent-mine-card.mjs --dry
 *   node scripts/codemod-recent-mine-card.mjs
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const LENSES = path.join(FRONTEND, "app", "lenses");
const REPORT_DIR = path.resolve(FRONTEND, "..", "audit", "codemod-reports");

const HERO_LENS_LOC = 3500;
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

function injectBeforeShellClose(src, lensId) {
  const tag = `<RecentMineCard domain="${lensId}" limit={10} hideWhenEmpty className="mt-4" />`;
  // </LensShell> may appear on its own line. Inject the card before it.
  const closeRe = /<\/LensShell>/;
  const m = src.match(closeRe);
  if (!m) return null;
  return src.slice(0, m.index) + "      " + tag + "\n    " + src.slice(m.index);
}

async function processFile(file, lensId) {
  const src = await readFile(file, "utf8");
  if (src.includes("RecentMineCard")) return { skipped: "already-mounted" };
  if (!src.includes("<LensShell")) return { skipped: "no-lens-shell" };
  const loc = src.split("\n").length;
  if (loc >= HERO_LENS_LOC) return { skipped: "hero-lens-bespoke-recents" };

  let next = ensureImport(
    src,
    `import { RecentMineCard } from '@/components/lens/RecentMineCard';`,
    "import { RecentMineCard }",
  );
  const injected = injectBeforeShellClose(next, lensId);
  if (!injected) return { skipped: "no-shell-close" };
  next = injected;
  if (!DRY) await writeFile(file, next, "utf8");
  return { applied: true, loc };
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
    if (res.applied) { applied += 1; ledger.push({ lens: dir.name, status: "applied", loc: res.loc }); }
    else {
      skipped[res.skipped] = (skipped[res.skipped] || 0) + 1;
      ledger.push({ lens: dir.name, status: "skipped", reason: res.skipped });
    }
  }
  console.log(`[${DRY ? "dry-run" : "done"}] RecentMineCard: applied=${applied}`);
  for (const [reason, count] of Object.entries(skipped)) {
    console.log(`  skipped(${reason}) = ${count}`);
  }
  if (!DRY) {
    await mkdir(REPORT_DIR, { recursive: true });
    const out = path.resolve(REPORT_DIR, `recent-mine-card-${isoTs()}.json`);
    await writeFile(out, JSON.stringify({ ranAt: new Date().toISOString(), applied, skipped, ledger }, null, 2));
    console.log(`[done] ledger: ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
