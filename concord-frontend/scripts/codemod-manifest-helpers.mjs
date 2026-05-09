#!/usr/bin/env node
/**
 * codemod-manifest-helpers.mjs — bulk-mount <ManifestActionBar /> +
 * <EmptyStateCTA /> in every lens page that doesn't already have
 * bespoke chrome.
 *
 * Strategy:
 *   1. Skip files that already import ManifestActionBar (avoid double-mount).
 *   2. Skip lens pages that look "deep" (≥1500 LOC) — those have their
 *      own chrome and we don't want to overwrite it.
 *   3. Insert imports after the LensShell import.
 *   4. Inject `<ManifestActionBar />` immediately inside the LensShell
 *      open tag so it lands at the top of every lens.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-manifest-helpers.mjs --dry
 *   node scripts/codemod-manifest-helpers.mjs
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FRONTEND = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const LENSES = path.join(FRONTEND, 'app', 'lenses');
const DEEP_LENS_LOC_THRESHOLD = 1500;

function findLensShellOpen(src) {
  const re = /<LensShell\b[^>]*>/g;
  const m = re.exec(src);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function ensureImport(src, importLine, anchorRe) {
  if (src.includes(importLine.split(' from ')[0])) return src;
  const m = src.match(anchorRe);
  if (!m) {
    // Fallback: after first import.
    const first = src.match(/^import .+;\s*$/m);
    if (!first) return src;
    const at = first.index + first[0].length;
    return src.slice(0, at) + '\n' + importLine + src.slice(at);
  }
  const at = m.index + m[0].length;
  return src.slice(0, at) + '\n' + importLine + src.slice(at);
}

async function processFile(file, _lensId) {
  const src = await readFile(file, 'utf8');
  const loc = src.split('\n').length;
  if (loc >= DEEP_LENS_LOC_THRESHOLD) return { skipped: 'deep-lens-has-bespoke-chrome' };
  if (src.includes('ManifestActionBar')) return { skipped: 'already-mounted' };
  if (!src.includes('<LensShell')) return { skipped: 'no-lens-shell' };

  const open = findLensShellOpen(src);
  if (!open) return { skipped: 'no-shell-open-found' };

  let next = src;
  // Inject the ActionBar right after the shell-open tag.
  // We DON'T also inject EmptyStateCTA because most lenses have
  // their own empty branches — making it opt-in instead.
  const insertion = `\n      <ManifestActionBar />`;
  next = next.slice(0, open.end) + insertion + next.slice(open.end);

  // Add imports.
  next = ensureImport(
    next,
    "import { ManifestActionBar } from '@/components/lens/ManifestActionBar';",
    /^import\s+\{\s*LensShell\s*\}\s+from\s+'@\/components\/lens\/LensShell';\s*$/m
  );

  if (!DRY) await writeFile(file, next, 'utf8');
  return { applied: true, loc };
}

async function main() {
  const dirs = (await readdir(LENSES, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('.'))
    .map((d) => d.name);

  const results = { applied: [], skipped: {}, errors: [] };
  for (const id of dirs) {
    const file = path.join(LENSES, id, 'page.tsx');
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
    } catch { continue; }
    try {
      const r = await processFile(file, id);
      if (r.applied) results.applied.push({ id, loc: r.loc });
      else if (r.skipped) results.skipped[r.skipped] = (results.skipped[r.skipped] || 0) + 1;
    } catch (e) {
      results.errors.push({ id, reason: String(e?.message || e) });
    }
  }

  console.log(`\n${DRY ? 'DRY RUN — ' : ''}manifest-helpers codemod`);
  console.log(`  applied: ${results.applied.length}`);
  console.log(`  skipped:`, results.skipped);
  if (results.errors.length) {
    console.log(`  errors (${results.errors.length}):`);
    for (const e of results.errors.slice(0, 10)) console.log(`    ${e.id}: ${e.reason}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
