#!/usr/bin/env node
// Diff-coverage gate (issue #2 of the test-foundation plan).
//
// The forcing function: whole-tree coverage is ~10% and backfilling 2,779 files
// is a trap. Instead, require that every source file a PR *touches* is reasonably
// covered. This freezes the untested backlog (it can't grow) and makes coverage
// climb one PR at a time — no retroactive sweep needed.
//
// Reads vitest's istanbul-format coverage/coverage-final.json (produced by
// `npm run test:coverage`), diffs changed files against the base ref, and fails
// if any changed components/ lib/ hooks/ file is below the per-file threshold.
//
// Usage: node scripts/check-diff-coverage.mjs [baseRef]
//   baseRef defaults to origin/$GITHUB_BASE_REF (PRs) or origin/main.
//   DIFF_COVERAGE_MIN (default 60) — required per-file statement %.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIN = Number(process.env.DIFF_COVERAGE_MIN ?? 60);
const COVERAGE_JSON = path.join(ROOT, 'coverage', 'coverage-final.json');

// Mirror the smoke harness exclusions: 3D/world-lens/worker code can't be unit
// covered yet, so don't gate diffs that only touch it. Keep in sync intentionally.
const SKIP = [
  /\.test\.(ts|tsx)$/,
  /\.d\.ts$/,
  /\.stories\.(ts|tsx)$/,
  /(^|\/)__mocks__\//,
  /(^|\/)world-lens\//,
  /(^|\/)concordia\//,
  /(^|\/)world\/(concordia-hud|concord-link|mahjong)\//,
  /\.worker\.(ts|tsx)$/,
  // Genuinely 3D/canvas components (same rationale as world-lens above): a
  // requestAnimationFrame + three.js VFX bridge, and a three.js/<Canvas> garden
  // studio. Their render path is a WebGL loop that jsdom can't exercise, so unit
  // statement coverage isn't meaningful here. (2D-but-large components are NOT
  // excluded — those get real render tests.)
  /(^|\/)world\/CombatVFXBridge\.tsx$/,
  /(^|\/)landscaping\/GardenStudio\.tsx$/,
];

const baseRef = process.argv[2] || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');

function gitDiff(rangeArg) {
  // execFileSync (no shell) so baseRef — a CLI/env-supplied value — is passed as
  // a literal git argument and can't be interpreted as a command (CodeQL: no
  // indirect command injection via an unsanitized command-line argument).
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=d', rangeArg], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function changedFiles() {
  let out = '';
  try {
    out = gitDiff(`${baseRef}...HEAD`);
  } catch {
    // Fall back to comparing against the merge-base of the default branch.
    try {
      out = gitDiff(baseRef);
    } catch {
      console.error(`[diff-coverage] could not diff against ${baseRef}; skipping (no gate).`);
      process.exit(0);
    }
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // paths are repo-root relative; this script lives in concord-frontend/
    .filter((f) => f.startsWith('concord-frontend/'))
    .map((f) => f.replace(/^concord-frontend\//, ''))
    .filter((f) => /^(components|lib|hooks)\/.+\.(ts|tsx)$/.test(f))
    .filter((f) => !SKIP.some((re) => re.test(f)));
}

function statementPct(entry) {
  const s = entry?.s ?? {};
  const ids = Object.keys(s);
  if (ids.length === 0) return null; // no statements (type-only / re-export) — not gateable
  const covered = ids.filter((i) => s[i] > 0).length;
  return (covered / ids.length) * 100;
}

function main() {
  const changed = changedFiles();
  if (changed.length === 0) {
    console.log('[diff-coverage] no gateable source files changed — pass.');
    return;
  }
  if (!existsSync(COVERAGE_JSON)) {
    console.error(`[diff-coverage] ${COVERAGE_JSON} missing — run \`npm run test:coverage\` first.`);
    process.exit(1);
  }
  const cov = JSON.parse(readFileSync(COVERAGE_JSON, 'utf8'));
  // index coverage by repo-relative (components/...) path
  const byRel = new Map();
  for (const [abs, entry] of Object.entries(cov)) {
    const norm = abs.split(path.sep).join('/');
    const m = norm.match(/(components|lib|hooks)\/.+\.(ts|tsx)$/);
    if (m) byRel.set(m[0], entry);
  }

  const failures = [];
  const passes = [];
  for (const rel of changed) {
    const entry = byRel.get(rel);
    const pct = entry ? statementPct(entry) : 0; // not in coverage at all => never imported by a test => 0%
    if (pct === null) continue; // no statements to cover
    if (pct < MIN) failures.push({ rel, pct });
    else passes.push({ rel, pct });
  }

  for (const p of passes) console.log(`[diff-coverage] ok    ${p.pct.toFixed(1).padStart(5)}%  ${p.rel}`);
  if (failures.length) {
    console.error(`\n[diff-coverage] ${failures.length} changed file(s) below ${MIN}% statement coverage:`);
    for (const f of failures) console.error(`  ✗ ${f.pct.toFixed(1).padStart(5)}%  ${f.rel}`);
    console.error(
      `\nAdd/extend a test for each (a render or behavior test). This gate freezes the ` +
        `untested backlog: new and modified files must be covered, so coverage climbs per-PR.\n` +
        `(Genuinely 3D/browser-only files are already excluded; override the floor via DIFF_COVERAGE_MIN.)`,
    );
    process.exit(1);
  }
  console.log(`\n[diff-coverage] all ${passes.length} changed source file(s) ≥ ${MIN}% — pass.`);
}

main();
