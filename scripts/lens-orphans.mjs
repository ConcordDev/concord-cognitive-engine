#!/usr/bin/env node
// scripts/lens-orphans.mjs
//
// Layer-1.5 of the lens-audit methodology (see docs/LENS_AUDIT_METHODOLOGY.md):
// a deterministic detector for the ORPHANED-BUT-WIRED PANEL facade class — a
// component that lives under components/<lens>/, is fully backend-wired (calls a
// real macro / REST route), but is never imported or referenced ANYWHERE in the
// frontend, so the user can't reach it. The deterministic feature-depth scorecard
// (`lens:audit`) explicitly can't see this — both backend and frontend exist, the
// gap is that the panel isn't mounted. This finds them mechanically, which is more
// reliable than the LLM deep-dive (which, in practice, over-claims orphans that are
// actually dynamically-imported or already mounted).
//
// A "hit" is a strong candidate for a surgical win (import + mount = a working
// feature goes from unreachable to live, e.g. travel/ParksPanel, finance/
// FredSeriesPanel, legal/{IntakeForms,Reports}Panel). It is NOT an automatic fix:
//
//   ⚠ VERIFY EACH BEFORE MOUNTING — the orphan may be a SUPERSEDED DUPLICATE of a
//     richer component that IS mounted (e.g. debate/DebateTree was replaced by the
//     mounted KialoArgumentMap; daily/DailyJournal by JournalStudio). Check for a
//     sibling component covering the same feature, and confirm the macro it calls
//     actually exists, before wiring it in. The scan finds candidates; you confirm.
//
// Detection: for each components/<lens>/*.tsx whose <lens> has an app/lenses/<lens>
// page, if the file (a) calls a backend (lensRun/runDomain/api.post|get/useLensData),
// (b) is >= MIN_LOC lines, and (c) its basename token appears NOWHERE else under
// app/ components/ lib/ (no static import, dynamic import, or JSX usage) — it's an
// orphan. Basename-token matching catches dynamic imports + JSX that a pure
// import-path regex misses (which is why the naive scan over-reports ~3x).
//
//   node scripts/lens-orphans.mjs            # ranked table
//   node scripts/lens-orphans.mjs --json     # machine-readable
//   node scripts/lens-orphans.mjs --min 100  # raise the LOC floor (default 60)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'concord-frontend');
const LENSES = path.join(FE, 'app/lenses');
const COMPS = path.join(FE, 'components');
const JSON_OUT = process.argv.includes('--json');
const MIN_LOC = (() => { const i = process.argv.indexOf('--min'); return i >= 0 ? Number(process.argv[i + 1]) : 60; })();

const rd = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const BACKEND_RE = /lensRun|runDomain|api\.(post|get)\(|useLensData/;

function walk(d, acc = []) {
  if (!existsSync(d)) return acc;
  let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    try {
      if (e.isDirectory()) walk(p, acc);
      else if (/\.tsx$/.test(e.name) && existsSync(p)) acc.push(p);
    } catch { /* broken symlink, skip */ }
  }
  return acc;
}

// referenced anywhere (other than its own file)? token grep across app/components/lib.
function referencedElsewhere(base, selfPath) {
  try {
    // execFileSync (no shell) — `base` is passed as a literal arg, not interpolated into
    // a shell command, so there is no shell-injection sink (and grep needs no shell here).
    const r = execFileSync('grep', ['-rlE', `\\b${base}\\b`, 'app', 'components', 'lib'], { cwd: FE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean);
    return r.some(f => path.resolve(FE, f) !== path.resolve(selfPath));
  } catch { return false; }
}

const lenses = readdirSync(LENSES, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('[')).map(e => e.name);

const orphans = [];
for (const lens of lenses) {
  const cdir = path.join(COMPS, lens);
  if (!existsSync(cdir)) continue;
  for (const c of walk(cdir)) {
    const src = rd(c);
    const loc = src.split('\n').length;
    if (!BACKEND_RE.test(src) || loc < MIN_LOC) continue;
    const base = path.basename(c).replace(/\.tsx$/, '');
    if (!referencedElsewhere(base, c)) orphans.push({ lens, comp: base, loc });
  }
}
orphans.sort((a, b) => b.loc - a.loc);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), minLoc: MIN_LOC, count: orphans.length, orphans }, null, 2) + '\n');
} else {
  console.log(`Orphaned-but-wired lens panels — ${orphans.length} candidate(s) (>=${MIN_LOC} LOC, backend-wired, never referenced)\n`);
  console.log(`${'LOC'.padStart(5)}  lens/component`);
  console.log('─'.repeat(48));
  for (const o of orphans) console.log(`${String(o.loc).padStart(5)}  ${o.lens}/${o.comp}`);
  console.log('\n⚠ Each is a CANDIDATE, not a confirmed fix. Verify it is not a superseded');
  console.log('  duplicate of a mounted sibling, and that its macro exists, before mounting.');
  console.log('  See docs/LENS_AUDIT_METHODOLOGY.md (Layer 1.5).');
}
