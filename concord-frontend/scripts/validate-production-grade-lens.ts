#!/usr/bin/env npx tsx
/**
 * Production-Grade Per-Lens Quality Gate — Sprint 17.
 *
 * Codifies what "production-grade per app" means as a hard CI invariant:
 *
 *   STRUCTURAL (already enforced by validate-lens-quality.ts):
 *     ✓ No MOCK_/SEED_ references
 *     ✓ Manifest declares artifacts + actions + macros
 *     ✓ Uses real persistence (useLensData / useArtifacts)
 *
 *   EXPERIENTIAL (NEW — Sprint 17 — what this gate checks):
 *     1. Wraps in <LensShell> (gets error boundary + agent FAB)
 *     2. Has a loading state — Skeleton / Spinner / Loader2 / "Loading"
 *     3. Has an empty state — EmptyState component or "no X yet" copy
 *     4. Has an error state — error message render branch
 *     5. Has interactive elements (button / form / input)
 *     6. Has at least one keyboard shortcut registered (useLensCommand)
 *        OR is a passive read-only lens (status: 'reference' / 'view')
 *     7. Uses Tailwind responsive prefixes (sm: / md: / lg:)
 *     8. Has focus styles on at least one interactive element (focus: classes)
 *     9. Imports from lucide-react or similar (icons present)
 *    10. Page file is ≥ 100 LOC (not a stub)
 *
 * Per CISQ + ISO/IEC 25010: a production-grade application has
 * Reliability + Efficiency + Maintainability + Usability + Adequacy.
 * The experiential gates above are the user-visible side of that spec.
 *
 * WHAT COUNTS AS "THE LENS" (Q35 fix, 2026-10-28): the original gate
 * regexed ONLY app/lenses/<id>/page.tsx. Most lens pages are thin
 * shells — a re-export (`export { StudioDawWorkspace as default }`)
 * or a dynamic import (`dynamic(() => import('./page-client'))`) —
 * whose real UI lives in components/. The page-only ruler scored
 * Studio 0/10 and reported 94 of 267 lenses as STUB, almost all of
 * them false: enforcement was impossible, so the gate ran soft in CI
 * forever. The gate now evaluates the lens's actual surface: page.tsx
 * plus every LOCAL file reachable from it through static imports,
 * re-exports and dynamic import() calls (@/ and relative specifiers;
 * test/story files excluded; walk capped at 60 files per lens, with
 * truncation reported). Measured with this ruler on 2026-10-28 the
 * fleet is 267/267 PRODUCTION-GRADE.
 *
 * Usage:
 *   npx tsx scripts/validate-production-grade-lens.ts
 *   npx tsx scripts/validate-production-grade-lens.ts --soft
 *   npx tsx scripts/validate-production-grade-lens.ts --json
 *   npx tsx scripts/validate-production-grade-lens.ts --lens=studio
 *   npx tsx scripts/validate-production-grade-lens.ts --lenses-dir=<dir>
 *
 * Outputs per-lens scorecard. Lenses passing 8+ of 10 are PRODUCTION-GRADE.
 * Lenses passing 5-7 are SHIPPABLE. Below 5 is STUB.
 *
 * STRICT BY DEFAULT (Q35): exits 1 when any lens is STUB. --soft keeps
 * the old report-only behaviour (exit 0) for local diagnostics;
 * --strict is accepted as an explicit no-op alias. --json always
 * exits 0 (machine-readable data mode).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(SCRIPT_DIR, '..');
const LENSES_DIR = process.argv.find(a => a.startsWith('--lenses-dir='))?.split('=')[1]
  || join(FRONTEND_DIR, 'app', 'lenses');
const soft = process.argv.includes('--soft');
const strict = !soft; // strict by default; --strict kept as an explicit alias
const jsonOutput = process.argv.includes('--json');
const focusLens = process.argv.find(a => a.startsWith('--lens='))?.split('=')[1];

const MAX_FILES_PER_LENS = 60;

interface LensCheck {
  lensId: string;
  loc: number;
  filesScanned: number;
  truncated: boolean;
  checks: {
    usesLensShell: boolean;
    hasLoadingState: boolean;
    hasEmptyState: boolean;
    hasErrorState: boolean;
    hasInteractivity: boolean;
    hasKeyboardShortcut: boolean;
    isResponsive: boolean;
    hasFocusStyles: boolean;
    hasIcons: boolean;
    nonStub: boolean;
  };
  score: number;
  tier: 'PRODUCTION-GRADE' | 'SHIPPABLE' | 'STUB';
}

function discoverLenses(): string[] {
  if (!existsSync(LENSES_DIR)) return [];
  return readdirSync(LENSES_DIR).filter((d) => {
    const p = join(LENSES_DIR, d);
    try {
      return statSync(p).isDirectory() && existsSync(join(p, 'page.tsx'));
    } catch {
      return false;
    }
  }).sort();
}

/** Resolve a local import specifier (@/… or ./…) to a file, or null. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = join(FRONTEND_DIR, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const cand of [base + '.tsx', base + '.ts', join(base, 'index.tsx'), join(base, 'index.ts'), base]) {
    try {
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    } catch { /* keep trying */ }
  }
  return null;
}

const IMPORT_RE = /(?:from\s+['"]([^'"]+)['"]|export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"])/g;

/**
 * The lens's real source surface: page.tsx plus every local file
 * reachable from it (static + dynamic imports), capped for speed.
 */
function gatherSources(pagePath: string): { sources: Map<string, string>; truncated: boolean } {
  const sources = new Map<string, string>();
  const queue = [pagePath];
  let truncated = false;
  while (queue.length > 0) {
    if (sources.size >= MAX_FILES_PER_LENS) { truncated = true; break; }
    const file = queue.shift() as string;
    if (sources.has(file)) continue;
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    sources.set(file, src);
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec || /\.test\.|\.stories\./.test(spec)) continue;
      const target = resolveImport(file, spec);
      if (target && !sources.has(target) && /\.(tsx|ts)$/.test(target) && !target.includes('node_modules')) {
        queue.push(target);
      }
    }
  }
  return { sources, truncated };
}

function checkLens(lensId: string): LensCheck {
  const { sources, truncated } = gatherSources(join(LENSES_DIR, lensId, 'page.tsx'));
  const src = [...sources.values()].join('\n');
  const loc = src.split('\n').length;

  const checks = {
    usesLensShell: /<LensShell\b|LensShell.*lensId/.test(src),
    hasLoadingState: /Skeleton|Loader2|Spinner|isLoading|Loading\.\.\.|"Loading"|'Loading'/.test(src),
    hasEmptyState: /EmptyState|EmptyStateCTA|"No \w+"|'No \w+'|emptyState|noData|"empty"/.test(src),
    hasErrorState: /ErrorState|"Error|'Error|catch \(|onError|isError|error\?\.message/.test(src),
    hasInteractivity: /onClick=|<button|<Button|<form|<input|<textarea|onSubmit/.test(src),
    hasKeyboardShortcut: /useLensCommand|keyboardShortcut|onKeyDown/.test(src),
    isResponsive: /\bsm:|\bmd:|\blg:|\bxl:/.test(src),
    hasFocusStyles: /focus:|focus-visible:|focus-within:/.test(src),
    hasIcons: /from\s+['"]lucide-react['"]|from\s+['"]@heroicons/.test(src),
    nonStub: loc >= 100,
  };
  const score = Object.values(checks).filter(Boolean).length;
  const tier = score >= 8 ? 'PRODUCTION-GRADE' : score >= 5 ? 'SHIPPABLE' : 'STUB';
  return { lensId, loc, filesScanned: sources.size, truncated, checks, score, tier };
}

// ── Run ──────────────────────────────────────────────────────────

const lenses = focusLens ? [focusLens] : discoverLenses();
const results = lenses.map(checkLens);

if (jsonOutput) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const tally = { 'PRODUCTION-GRADE': 0, SHIPPABLE: 0, STUB: 0 };
for (const r of results) tally[r.tier]++;

console.log('\nProduction-Grade Per-Lens Gate — Sprint 17');
console.log('═'.repeat(60));
console.log(`Discovered ${results.length} lenses\n`);

// Summary table.
console.log('Score | Tier              | Lens');
console.log('------|-------------------|----------------');
for (const r of results.sort((a, b) => b.score - a.score || a.lensId.localeCompare(b.lensId))) {
  const tierIcon = r.tier === 'PRODUCTION-GRADE' ? '✓' : r.tier === 'SHIPPABLE' ? '~' : '✗';
  console.log(`${r.score}/10  | ${tierIcon} ${r.tier.padEnd(16)} | ${r.lensId}`);
}

console.log('\n' + '═'.repeat(60));
console.log(`PRODUCTION-GRADE: ${tally['PRODUCTION-GRADE']}`);
console.log(`SHIPPABLE:        ${tally.SHIPPABLE}`);
console.log(`STUB:             ${tally.STUB}`);
console.log('═'.repeat(60));

const truncatedCount = results.filter(r => r.truncated).length;
if (truncatedCount > 0) {
  console.log(`\nNote: ${truncatedCount} lens walk(s) hit the ${MAX_FILES_PER_LENS}-file cap; their scores are computed from a partial (majority) surface.`);
}

// Detail for the lowest-scoring lenses (worst offenders to fix first).
const worst = results.filter(r => r.tier === 'STUB').sort((a, b) => a.score - b.score).slice(0, 10);
if (worst.length > 0) {
  console.log('\nTop 10 STUB lenses — fix these first to unblock the gate:');
  for (const r of worst) {
    const missing = Object.entries(r.checks).filter(([_, v]) => !v).map(([k]) => k);
    console.log(`\n  ${r.lensId} (${r.score}/10, ${r.loc} LOC across ${r.filesScanned} files):`);
    console.log(`    missing: ${missing.join(', ')}`);
  }
}

// Strict mode (the default): fail if any lens is below SHIPPABLE.
if (strict && tally.STUB > 0) {
  console.log(`\n✗ STRICT MODE: ${tally.STUB} lenses below SHIPPABLE threshold. Run with --soft for a report-only pass.`);
  process.exit(1);
}

console.log(strict
  ? `\n✓ All lenses at SHIPPABLE or above; gate passes.`
  : `\nSoft mode: ${tally.STUB} stub-lens(es) noted; exit 0. Run without --soft to enforce.`);
process.exit(0);
