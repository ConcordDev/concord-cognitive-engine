#!/usr/bin/env node
// scripts/lens-rebuild-backlog.mjs
//
// Wave 3 triage for the Frontend Rebuild Program (docs/FRONTEND_REBUILD_PROGRAM.md).
// Wave 2 closed every lens the honest scaffold detector could name (260/260 now
// score `polished` / `isGenericScaffold: false` — see grade-ux-polish.mjs --honest).
// That detector's signature (ManifestActionBar+AutoActionStrip+RecentMineCard trio +
// a small page/component) is necessarily narrow; a lens can dodge it structurally
// (enough bespoke LOC, no literal <UniversalActions>/<LensFeaturePanel> tag) while
// still reaching most of its backend through generic action arrays, or while hiding
// a real macro cluster with zero UI. This script is the next, coarser signal for
// THOSE lenses — it does NOT re-detect scaffold; it ranks the ~205 lenses Wave 0/2
// never touched by how much backend depth might still be sitting unsurfaced, so a
// human/orchestrator can dispatch investigation units where it's worth looking,
// rather than blanket-rebuilding 205 lenses that mostly don't need it.
//
// Composite score = macro-depth proxy (unsurfaced macro count from
// lens-unsurfaced.mjs, the real "is there hidden depth" signal) × a destination
// traffic-proxy multiplier (lib/destinations.ts — a lens that's itself a promoted
// destination, or absorbed into one, is reached far more than a lens nobody
// navigates to directly; there is no real usage-telemetry source in this repo, so
// this is the traffic PROXY the program spec calls for, not fabricated telemetry).
//
// HONEST CAVEATS:
//   • This is a TRIAGE ranking, not a verdict. A high score means "worth an
//     investigation unit"; it does not mean the lens is broken. Low-unsurfaced
//     lenses may still have generic-action-array or fake-data issues this script
//     can't see — it inherits lens-unsurfaced.mjs's own caveat (unsurfaced ≠ defect,
//     read the cluster).
//   • Domain-file name ↔ lens-directory name mismatches (e.g. "urbanplanning" vs
//     "urban-planning", "exportdomain" vs "export") are resolved with a small alias
//     table below, built from cases already found this program; anything that
//     still doesn't match is reported under "unmatched domains" rather than silently
//     dropped, so the list stays honest about its own blind spots.
//   • Lenses already rebuilt by Wave 0/1/2 are excluded via the ALREADY_DONE set —
//     keep that list in sync (append-only) as more waves land, or this script will
//     start re-recommending lenses that are already real.
//
// Usage:
//   node scripts/lens-rebuild-backlog.mjs                 # ranked table
//   node scripts/lens-rebuild-backlog.mjs --json           # machine-readable
//   node scripts/lens-rebuild-backlog.mjs --top 20          # cap rows (default 40)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'concord-frontend');
const LENSES_DIR = path.join(FE, 'app', 'lenses');
const DESTINATIONS_FILE = path.join(FE, 'lib', 'destinations.ts');

const JSON_OUT = process.argv.includes('--json');
const topN = (() => { const i = process.argv.indexOf('--top'); return i >= 0 ? Number(process.argv[i + 1]) : 40; })();

const rd = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

// ── Lenses already rebuilt by Wave 0 / Wave 1 / Wave 2 (append-only) ────────
const ALREADY_DONE = new Set([
  // Flagships + Wave 0
  'finance', 'news', 'world', 'music', 'courtship', 'lfg', 'photos', 'quests',
  // Wave 1
  'announcements', 'achievements', 'detective', 'fishing', 'garage', 'lattice',
  // Wave 2 batch 1 — Marketplace/economy, Research/reference, Social/relationship
  'questmarket', 'supplychain', 'history', 'law', 'mentorship', 'alliance',
  // Wave 2 batch 1 — Creative/design-tool
  'artistry', 'fashion', 'animation',
  // Wave 2 batch 2 — Maps/navigation
  'ar', 'travel', 'atlas',
  // Wave 2 batch 3 — Health/life-sim, Reflection/knowledge-curation
  'pharmacy', 'parenting', 'philosophy', 'grounding', 'reflection', 'suffering', 'pets', 'veterinary',
  // Wave 2 batch 4 — Space/lab science
  'astronomy', 'space', 'chem', 'bio', 'lab', 'materials',
  // Wave 2 batch 5 — Earth/environmental & public-safety science
  'geology', 'ocean', 'forestry', 'energy', 'mining', 'desert', 'urban-planning', 'defense', 'emergency-services',
  // Wave 2 batch 6 — Dev-tool/sim-console
  'robotics', 'ml', 'offline', 'quantum', 'fractal', 'neuro', 'metalearning', 'anon', 'fork',
  // Wave 2 batch 7 — Docs/B2B SaaS
  'schema', 'audit', 'projects', 'queue', 'platform', 'transfer', 'export', 'legacy', 'custom', 'hr', 'marketing',
]);

// ── Domain-file name -> lens-directory id aliases (grows as found) ─────────
const DOMAIN_TO_LENS_ALIAS = {
  urbanplanning: 'urban-planning',
  emergencyservices: 'emergency-services',
  exportdomain: 'export',
  blackmarket: 'black-market',
  mentalhealth: 'mental-health',
  eventtimeline: 'event-timeline',
  civicbonds: 'civic-bonds',
};

// ── 1. Every lens directory with a page.tsx, minus what's already done ─────
const allLensIds = existsSync(LENSES_DIR)
  ? readdirSync(LENSES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(LENSES_DIR, d.name, 'page.tsx')))
      .map((d) => d.name)
  : [];
const pool = allLensIds.filter((id) => !ALREADY_DONE.has(id));

// ── 2. Macro-depth proxy — reuse lens-unsurfaced.mjs's own detection so the
//    two scripts never drift into disagreeing definitions of "unsurfaced". ──
function surfaced(token) {
  try {
    execFileSync('grep', ['-rqE', `['"]${token}['"]`, 'app', 'components', 'lib'], { cwd: FE, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function clusters(actions) {
  const m = new Map();
  for (const a of actions) {
    const key = a.split(/[-_]/)[0];
    m.set(key, (m.get(key) || []).concat(a));
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}
const DOMAINS_DIR = path.join(ROOT, 'server/domains');
const domainFiles = existsSync(DOMAINS_DIR) ? readdirSync(DOMAINS_DIR).filter((f) => f.endsWith('.js')) : [];
const unsurfacedByDomain = new Map(); // lensId -> { total, unsurfaced: [...], clusters }
const unmatchedDomains = [];
for (const file of domainFiles) {
  const domain = file.replace(/\.js$/, '');
  const lensId = DOMAIN_TO_LENS_ALIAS[domain] || domain;
  if (!allLensIds.includes(lensId)) { unmatchedDomains.push(domain); continue; }
  if (ALREADY_DONE.has(lensId)) continue;
  const src = rd(path.join(DOMAINS_DIR, file));
  const actions = new Set();
  const re = new RegExp(String.raw`\b(?:registerLensAction|register)\(\s*["'\`]${domain}["'\`]\s*,\s*["'\`]([a-zA-Z0-9_-]+)["'\`]`, 'g');
  let m; while ((m = re.exec(src))) actions.add(m[1]);
  if (actions.size === 0) continue;
  const unsurfacedList = [...actions].filter((a) => !surfaced(a)).sort();
  unsurfacedByDomain.set(lensId, { total: actions.size, unsurfaced: unsurfacedList, clusters: clusters(unsurfacedList) });
}

// ── 3. Destination traffic-proxy weight from lib/destinations.ts ───────────
// Text-scanned (not imported) because these are plain .mjs scripts and the
// file is TypeScript with JSX-free but typed literals — regexing the
// `absorbs: [...]` arrays is simpler and more robust than spinning up ts-node
// for one array.
const destSrc = rd(DESTINATIONS_FILE);
const destWeight = new Map(); // lensId -> weight
const destEntryRe = /\{\s*id:\s*'([a-z0-9-]+)'[^}]*?group:\s*'([a-z]+)'(?:[^}]*?absorbs:\s*\[([^\]]*)\])?[^}]*?\}/gs;
let dm;
while ((dm = destEntryRe.exec(destSrc))) {
  const [, id, , absorbsRaw] = dm;
  destWeight.set(id, Math.max(destWeight.get(id) || 0, 3)); // destination itself = highest traffic
  if (absorbsRaw) {
    for (const raw of absorbsRaw.split(',')) {
      const absorbed = raw.trim().replace(/^['"]|['"]$/g, '');
      if (!absorbed) continue;
      destWeight.set(absorbed, Math.max(destWeight.get(absorbed) || 0, 2)); // absorbed = medium traffic
    }
  }
}

// ── 4. Composite score + rank ────────────────────────────────────────────
const rows = pool.map((lensId) => {
  const macro = unsurfacedByDomain.get(lensId) || { total: 0, unsurfaced: [], clusters: [] };
  const trafficWeight = destWeight.get(lensId) || 1; // 1 = not a destination or absorbed anywhere
  const featureClusterCount = macro.clusters.filter(([, v]) => v.length >= 3).length;
  const score = macro.unsurfaced.length * trafficWeight;
  return {
    lens: lensId,
    unsurfacedCount: macro.unsurfaced.length,
    totalMacros: macro.total,
    featureClusters: featureClusterCount,
    topCluster: macro.clusters[0] ? `${macro.clusters[0][0]}-* (${macro.clusters[0][1].length})` : null,
    trafficWeight,
    score,
  };
}).filter((r) => r.score > 0)
  .sort((a, b) => b.score - a.score);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    poolSize: pool.length,
    scoredCount: rows.length,
    unmatchedDomains: [...new Set(unmatchedDomains)],
    backlog: rows.slice(0, topN),
  }, null, 2) + '\n');
} else {
  console.log(`Wave 3 risk-pool backlog — ${pool.length} lenses not yet touched by Wave 0-2, ${rows.length} score > 0\n`);
  console.log(`${'score'.padStart(6)} ${'unsurf'.padStart(6)} ${'/total'.padStart(6)} ${'traffic'.padStart(7)}  top cluster              lens`);
  console.log('─'.repeat(80));
  for (const r of rows.slice(0, topN)) {
    console.log(`${String(r.score).padStart(6)} ${String(r.unsurfacedCount).padStart(6)} ${String(r.totalMacros).padStart(6)} ${String(r.trafficWeight).padStart(7)}  ${(r.topCluster || '').padEnd(24)} ${r.lens}`);
  }
  console.log(`\n(showing top ${Math.min(topN, rows.length)} of ${rows.length} scored; ${pool.length - unsurfacedByDomain.size} lenses in the pool have 0 unsurfaced macros or no matched domain)`);
  if (unmatchedDomains.length) {
    console.log(`\nUnmatched domain files (no lens directory found — check DOMAIN_TO_LENS_ALIAS): ${[...new Set(unmatchedDomains)].join(', ')}`);
  }
  console.log('\n⚠ Triage ranking, not a verdict — dispatch investigation units at the top of');
  console.log('  this list, confirm a real gap before rebuilding. See lens-unsurfaced.mjs --lens');
  console.log('  <name> for the macro list, and this doc\'s Wave-3 section for the loop.');
}
