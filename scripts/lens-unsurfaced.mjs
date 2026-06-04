#!/usr/bin/env node
// scripts/lens-unsurfaced.mjs
//
// Layer-1.5 of the lens-audit methodology (see docs/LENS_AUDIT_METHODOLOGY.md):
// the deterministic detector for the BACKEND-BUILT / NO-UI gap class — registered
// macros whose action name appears NOWHERE in the frontend. Where `lens:orphans`
// finds a built panel that was never mounted, this finds a built *macro* that was
// never given a panel at all. Together with the `lens:audit` feature-depth
// scorecard, the three cover the gap classes the methodology names.
//
// Per lens (= backend domain) it lists the registered (domain, action) macros and
// greps each action token across concord-frontend/{app,components,lib}. A macro is
// "unsurfaced" if its token never appears. Clusters of unsurfaced macros sharing a
// feature prefix (e.g. message `labels-*`, crypto `recurring-buys-*`) are the real
// signal: a whole feature built on the backend with no UI.
//
// HONEST CAVEATS (so the output isn't misread):
//   • Unsurfaced ≠ defect. Many macros are legitimately frontend-invisible: LLM/agent
//     tools, heartbeat-only, internal helpers, or reached via a REST route rather than
//     a by-name `lensRun`. This is a TRIAGE signal — read the cluster, then judge.
//   • Most unsurfaced clusters are BACKLOG (need a new UI), not surgical facades. An
//     inverse-action single macro (`unsnooze` where `snooze` is surfaced) may be a
//     quick add; a whole cluster (`labels-*`) is a feature build.
//   • Token grep is permissive: a macro is counted "surfaced" if its name appears in
//     ANY string anywhere — so this under-reports rather than over-reports.
//
//   node scripts/lens-unsurfaced.mjs                 # every lens, unsurfaced counts
//   node scripts/lens-unsurfaced.mjs --lens message  # one lens, the macro list
//   node scripts/lens-unsurfaced.mjs --min-cluster 3 # only show clusters >= N (default 1)
//   node scripts/lens-unsurfaced.mjs --json

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'concord-frontend');
const DOMAINS = path.join(ROOT, 'server/domains');
const JSON_OUT = process.argv.includes('--json');
const lensFilter = (() => { const i = process.argv.indexOf('--lens'); return i >= 0 ? process.argv[i + 1] : null; })();
const minCluster = (() => { const i = process.argv.indexOf('--min-cluster'); return i >= 0 ? Number(process.argv[i + 1]) : 1; })();

const rd = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

// token referenced anywhere in the frontend?
function surfaced(token) {
  try {
    // execFileSync (no shell) — `token` is a literal arg, not interpolated into a shell
    // command, so there is no shell-injection sink.
    execFileSync('grep', ['-rqE', `['"]${token}['"]`, 'app', 'components', 'lib'], { cwd: FE, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// group an action list into feature clusters by leading prefix (before first - or _).
function clusters(actions) {
  const m = new Map();
  for (const a of actions) {
    const key = a.split(/[-_]/)[0];
    m.set(key, (m.get(key) || []).concat(a));
  }
  return [...m.entries()].filter(([, v]) => v.length >= minCluster).sort((a, b) => b[1].length - a[1].length);
}

let files = existsSync(DOMAINS) ? readdirSync(DOMAINS).filter(f => f.endsWith('.js')) : [];
if (lensFilter) files = files.filter(f => f === `${lensFilter}.js`);

const rows = [];
for (const file of files) {
  const lens = file.replace(/\.js$/, '');
  const src = rd(path.join(DOMAINS, file));
  const actions = new Set();
  const re = new RegExp(String.raw`\b(?:registerLensAction|register)\(\s*["'\`]${lens}["'\`]\s*,\s*["'\`]([a-zA-Z0-9_-]+)["'\`]`, 'g');
  let m; while ((m = re.exec(src))) actions.add(m[1]);
  if (actions.size === 0) continue;
  const unsurfaced = [...actions].filter(a => !surfaced(a)).sort();
  rows.push({ lens, total: actions.size, unsurfaced, clusters: clusters(unsurfaced) });
}
rows.sort((a, b) => b.unsurfaced.length - a.unsurfaced.length);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), lenses: rows }, null, 2) + '\n');
} else if (lensFilter) {
  const r = rows[0];
  if (!r) { console.log(`No registered macros found for lens "${lensFilter}".`); process.exit(0); }
  console.log(`${r.lens}: ${r.unsurfaced.length}/${r.total} macros never referenced in the frontend\n`);
  for (const [prefix, list] of r.clusters) {
    const tag = list.length >= 3 ? '  ← feature cluster (likely backlog: a whole feature with no UI)' : '';
    console.log(`  ${prefix}-* (${list.length})${tag}`);
    for (const a of list) console.log(`      ${a}`);
  }
  console.log(`\n⚠ Unsurfaced ≠ defect — LLM/agent/heartbeat/REST-routed macros are legitimately`);
  console.log(`  frontend-invisible. Read the cluster, then judge. See docs/LENS_AUDIT_METHODOLOGY.md.`);
} else {
  console.log('Unsurfaced backend macros per lens (registered, name never referenced in frontend)\n');
  console.log(`${'unsurf'.padStart(6)} ${'total'.padStart(5)}  top cluster        lens`);
  console.log('─'.repeat(70));
  for (const r of rows) {
    if (r.unsurfaced.length === 0) continue;
    const top = r.clusters[0] ? `${r.clusters[0][0]}-* (${r.clusters[0][1].length})` : '';
    console.log(`${String(r.unsurfaced.length).padStart(6)} ${String(r.total).padStart(5)}  ${top.padEnd(18)} ${r.lens}`);
  }
  console.log('\n⚠ Triage signal, not a defect list. Clusters of >=3 = a feature built backend-only.');
  console.log('  Drill in: node scripts/lens-unsurfaced.mjs --lens <name>');
}
