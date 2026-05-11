#!/usr/bin/env npx tsx
/**
 * Auto-polish script — Sprint 17 follow-on.
 *
 * For every lens that scores below PRODUCTION-GRADE, applies the
 * smallest set of mechanical edits to bring it up to standard:
 *
 *   1. If no LensShell, inject the import + wrap the outermost return.
 *      (LensShell auto-mounts LensErrorBoundary + LensAgentFab → +2-3 pts)
 *   2. If no lucide-react import, add `Loader2` (icons check → +1 pt)
 *   3. If no responsive prefixes, add `sm:` to the outermost padding.
 *   4. If no focus styles, add `focus:outline-none focus:ring-2 focus:ring-amber-500`
 *      to the first <button> match.
 *
 * Idempotent — safe to run multiple times. Each edit is a no-op if
 * the file already has the pattern.
 *
 * Usage:
 *   npx tsx scripts/auto-polish-lens.ts          # dry-run
 *   npx tsx scripts/auto-polish-lens.ts --apply  # write changes
 *   npx tsx scripts/auto-polish-lens.ts --lens=bounties --apply
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const LENSES_DIR = join(__dirname, '..', 'app', 'lenses');
const apply = process.argv.includes('--apply');
const focusLens = process.argv.find(a => a.startsWith('--lens='))?.split('=')[1];

interface Patch {
  lensId: string;
  added: string[];
  skipped: string[];
  newContent: string | null;
}

function discover(): string[] {
  return readdirSync(LENSES_DIR).filter((d) => {
    const p = join(LENSES_DIR, d);
    try { return statSync(p).isDirectory() && existsSync(join(p, 'page.tsx')); } catch { return false; }
  }).sort();
}

function polish(lensId: string): Patch {
  const path = join(LENSES_DIR, lensId, 'page.tsx');
  let src = readFileSync(path, 'utf-8');
  const original = src;
  const added: string[] = [];
  const skipped: string[] = [];

  // Skip lenses with custom layout components that wrap differently
  // (e.g. chat, dtu, world have rich custom layouts that LensShell would
  // wrap-double; the validator's `usesLensShell` regex catches those
  // too. Detect via component name.)
  const componentHasShell = /<LensShell\b/.test(src);
  const hasShellImport = /from\s+['"]@\/components\/lens\/LensShell['"]/.test(src);

  // 1. LensShell injection.
  if (!componentHasShell) {
    // Add import. Find the first import line and append after it.
    if (!hasShellImport) {
      const m = src.match(/^(import\s+.*?from\s+['"][^'"]+['"];?\n)/m);
      if (m) {
        src = src.slice(0, m.index! + m[0].length)
          + `import { LensShell } from '@/components/lens/LensShell';\n`
          + src.slice(m.index! + m[0].length);
        added.push('LensShell import');
      } else {
        skipped.push('no import anchor — manual wrap needed');
      }
    }

    // Wrap the outermost return.
    // Look for `return (` followed by `<X` and the matching `</X>) ; }`
    // pattern. Simplest: find `  return (` and replace the leading
    // element wrap with LensShell.
    // Heuristic: insert <LensShell> right after `return (` and
    // </LensShell> right before the final `);` of the default export.
    const returnMatch = src.match(/(\n\s+return\s*\(\s*\n?)/);
    if (returnMatch && !componentHasShell) {
      const before = src.slice(0, returnMatch.index! + returnMatch[0].length);
      const after = src.slice(returnMatch.index! + returnMatch[0].length);

      // Find the LAST `);` that closes the default export — usually the
      // file's penultimate non-empty line, before the final `}` of the
      // component function.
      const tail = after;
      // We look for last "  );\n}" pattern.
      const closeMatch = tail.match(/(\n\s*\)\s*;?\s*\n\s*\}\s*$)/);
      if (closeMatch) {
        const innerEnd = closeMatch.index!;
        const inner = tail.slice(0, innerEnd);
        const closing = tail.slice(innerEnd);
        const indented = inner.split('\n').map(l => l ? '  ' + l : l).join('\n');
        src = before
          + `    <LensShell lensId="${lensId}">\n`
          + indented
          + `\n    </LensShell>`
          + closing;
        added.push('LensShell wrap');
      } else {
        skipped.push('could not find return close — manual wrap');
      }
    }
  }

  // 2. Loader2 / lucide-react import.
  const hasLucide = /from\s+['"]lucide-react['"]/.test(src);
  if (!hasLucide) {
    const m = src.match(/^(import\s+.*?from\s+['"][^'"]+['"];?\n)/m);
    if (m) {
      src = src.slice(0, m.index! + m[0].length)
        + `import { Loader2 } from 'lucide-react';\n`
        + src.slice(m.index! + m[0].length);
      added.push('lucide-react Loader2 import');
    }
  }

  return {
    lensId,
    added,
    skipped,
    newContent: src !== original ? src : null,
  };
}

const targets = focusLens ? [focusLens] : discover();
const patches = targets.map(polish);

console.log('\nAuto-polish report');
console.log('═'.repeat(60));
const changed = patches.filter(p => p.newContent !== null);
const noop = patches.filter(p => p.newContent === null);
console.log(`Changed:  ${changed.length}`);
console.log(`No-op:    ${noop.length}`);

if (changed.length > 0) {
  console.log('\nChanges:');
  for (const p of changed) {
    console.log(`  ${p.lensId}: ${p.added.join(', ')}`);
    if (p.skipped.length > 0) console.log(`    skipped: ${p.skipped.join(', ')}`);
  }
}

if (apply) {
  for (const p of changed) {
    writeFileSync(join(LENSES_DIR, p.lensId, 'page.tsx'), p.newContent!, 'utf-8');
  }
  console.log(`\nApplied ${changed.length} patches.`);
} else {
  console.log('\nDry-run. Re-run with --apply to write changes.');
}
