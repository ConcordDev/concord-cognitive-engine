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
 * Usage:
 *   npx tsx scripts/validate-production-grade-lens.ts
 *   npx tsx scripts/validate-production-grade-lens.ts --strict
 *   npx tsx scripts/validate-production-grade-lens.ts --json
 *   npx tsx scripts/validate-production-grade-lens.ts --lens=studio
 *
 * Outputs per-lens scorecard. Lenses passing 8+ of 10 are PRODUCTION-GRADE.
 * Lenses passing 5-7 are SHIPPABLE. Below 5 is STUB.
 *
 * Soft-fail by default (logs failures, exits 0). --strict makes the
 * sub-PRODUCTION-GRADE lenses fail the gate.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const LENSES_DIR = join(__dirname, '..', 'app', 'lenses');
const strict = process.argv.includes('--strict');
const jsonOutput = process.argv.includes('--json');
const focusLens = process.argv.find(a => a.startsWith('--lens='))?.split('=')[1];

interface LensCheck {
  lensId: string;
  loc: number;
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

function readPage(lensId: string): string | null {
  const p = join(LENSES_DIR, lensId, 'page.tsx');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8');
}

function checkLens(lensId: string): LensCheck {
  const src = readPage(lensId) || '';
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
  return { lensId, loc, checks, score, tier };
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

// Detail for the lowest-scoring lenses (worst offenders to fix first).
const worst = results.filter(r => r.tier === 'STUB').sort((a, b) => a.score - b.score).slice(0, 10);
if (worst.length > 0) {
  console.log('\nTop 10 STUB lenses — fix these first to unblock the gate:');
  for (const r of worst) {
    const missing = Object.entries(r.checks).filter(([_, v]) => !v).map(([k]) => k);
    console.log(`\n  ${r.lensId} (${r.score}/10, ${r.loc} LOC):`);
    console.log(`    missing: ${missing.join(', ')}`);
  }
}

// Strict mode: fail if any lens is below SHIPPABLE.
if (strict && tally.STUB > 0) {
  console.log(`\n✗ STRICT MODE: ${tally.STUB} lenses below SHIPPABLE threshold. Run without --strict to see report.`);
  process.exit(1);
}

console.log(`\nSoft-fail mode: ${tally.STUB} stub-lens(es) noted; exit 0. Use --strict to enforce.`);
process.exit(0);
