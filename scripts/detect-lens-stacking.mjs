#!/usr/bin/env node
// scripts/detect-lens-stacking.mjs
//
// "Stacked-UI" detector for the 266-lens frontend.
//
// grade-ux-polish.mjs already checks whether each lens has loading/empty/error
// states, micro-interactions, and a domain visual identity — and by that
// measure 264/266 score "polished". But it is BLIND to the problem this
// detector measures: a lens page that is really N half-built screens welded
// into one file via view-state switches, each screen added by a different
// session, none ever removed or reconciled. chat/page.tsx scores "polished"
// while being ~5k lines / 54 component imports / 4+ view-state machines.
//
// Signals per lens (page.tsx [+ page-client.tsx]):
//   loc                    total authored lines
//   componentImports       distinct `.../components/...` import paths
//   coLocatedImports       PascalCase imports from ./ or ../ (sibling parts)
//   useStateCount          hook sprawl
//   useEffectCount         lifecycle sprawl
//   viewStateMachines      string-union `useState<'a'|'b'|...>()` + active(Tab|
//                          View|Panel|Section|Mode|Screen|Step|Stage) vars
//   topLevelScreenBranches `{x && <Cap` / `? <Cap` / `: <Cap` — N screens/file
//   deadViewValues         union members with NO matching set<X>('member')
//                          call — a screen you cannot navigate to
//   dupActionPaths         same macro reached from >=2 distinct call sites
//   domainComponentCount   files in components/<lens>/ (pile of parts)
//
//   stackingScore          weighted composite; higher = more piled-on
//
// Output: audit/lens-stacking-report.md  (ranked worst -> best) + a JSON
// sidecar. READ-ONLY — never edits a lens.
//
// Run: node scripts/detect-lens-stacking.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LENSES_DIR = path.join(ROOT, 'concord-frontend', 'app', 'lenses');
const COMPONENTS_DIR = path.join(ROOT, 'concord-frontend', 'components');

// ---------------------------------------------------------------------------
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// Strip block + line comments (regex-literal-naive, but good enough for counts).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const VIEW_VAR_RE = /\b(?:active|current|selected)?(?:Tab|View|Panel|Section|Mode|Screen|Step|Stage)\b/;
const CAP = '[A-Z][A-Za-z0-9]+';

function analyzeLens(name) {
  const dir = path.join(LENSES_DIR, name);
  const files = ['page.tsx', 'page-client.tsx']
    .map((f) => path.join(dir, f))
    .filter((f) => fs.existsSync(f));
  if (!files.length) return null;

  const rawAll = files.map(read).join('\n');
  const src = stripComments(rawAll);
  const loc = rawAll.split('\n').length;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // component imports — split shared framework from feature screens.
  // components/{lens,common,shell,ui,panel-polish,panels,workspace,providers}
  // are the ONE coherent shell every lens imports; they are not "stacking".
  const SHARED_RE = /^(lens|common|shell|ui|panel-polish|panels|workspace|providers|layout|nav|design-system|kit)\b/;
  const shared = new Set();
  const feature = new Set();
  for (const m of src.matchAll(/from\s+['"][^'"]*\/components\/([^'"]+)['"]/g)) {
    (SHARED_RE.test(m[1]) ? shared : feature).add(m[1]);
  }
  const coLocated = new Set();
  for (const m of src.matchAll(/import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"](\.\.?\/[^'"./][^'"]*)['"]/g)) {
    if (!/\.(css|scss|json)['"]/.test(m[0]) && /import\s+(?:\{[^}]*[A-Z]|[A-Z])/.test(m[0])) coLocated.add(m[1]);
  }

  const useStateCount = (src.match(/\buseState\s*[<(]/g) || []).length;
  const useEffectCount = (src.match(/\buseEffect\s*\(/g) || []).length;

  // view-state machines: `const [x, setX] = useState<'a'|'b'|...>('a')`
  const unions = []; // { name, setter, members, initial }
  for (const m of src.matchAll(/const\s+\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState\s*<\s*((?:'[^']+'|"[^"]+")(?:\s*\|\s*(?:'[^']+'|"[^"]+")){1,})\s*>\s*\(\s*(['"][^'"]*['"])?/g)) {
    const members = [...m[3].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (members.length >= 2) unions.push({ name: m[1], setter: m[2], members, initial: (m[4] || '').replace(/['"]/g, '') });
  }
  const viewVars = new Set();
  for (const m of src.matchAll(/const\s+\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/g)) {
    if (VIEW_VAR_RE.test(m[1])) viewVars.add(m[1]);
  }
  // a view-state machine = a string-union whose var name reads like a
  // view/tab/mode selector, OR any 3+-member string union
  const machineUnions = unions.filter((u) => VIEW_VAR_RE.test(u.name) || u.members.length >= 3);
  const viewStateMachines = new Set([...machineUnions.map((u) => u.name), ...viewVars]).size;

  // dead view values: only trustworthy when the setter is called with STRING
  // LITERALS throughout (a data-driven `setActive(tab.id)` tab bar — the GOOD
  // pattern — would false-positive, so those unions are skipped).
  let deadViewValues = 0;
  const deadList = [];
  for (const u of machineUnions) {
    const literalSets = [...src.matchAll(new RegExp(`${u.setter}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g'))].map((x) => x[1]);
    const anyVarSet = new RegExp(`${u.setter}\\s*\\(\\s*(?!['"\\)])`).test(src);
    if (anyVarSet || literalSets.length === 0) continue; // data-driven — can't judge
    for (const val of u.members) {
      if (val === u.initial || literalSets.includes(val)) continue;
      deadViewValues++; deadList.push(`${u.name}:${val}`);
    }
  }

  // heterogeneous render strategies in ONE file — a strong "piled by different
  // sessions" tell: a tab/view union AND top-level `&&`-gated screens AND
  // separate boolean `show<X>`/`is<X>Open` modal toggles, all coexisting.
  const hasTabUnion = machineUnions.length > 0;
  const ampScreens = (src.match(new RegExp(`\\{\\s*\\w+\\s*&&\\s*(?:\\(\\s*)?<${CAP}`, 'g')) || []).length;
  const boolToggles = (src.match(/const\s+\[\s*(?:show|is)\w+|set(?:Show|Is)\w+\(/g) || []).length;
  const renderStrategies =
    (hasTabUnion ? 1 : 0) + (ampScreens >= 3 ? 1 : 0) + (boolToggles >= 4 ? 1 : 0);

  // top-level screen branches: `{cond && <Cap` / `? <Cap` / `: <Cap`.
  const screenBranches =
    (src.match(new RegExp(`[?&]\\s*(?:\\(\\s*)?<${CAP}`, 'g')) || []).length +
    (src.match(new RegExp(`:\\s*(?:\\(\\s*)?<${CAP}`, 'g')) || []).length;

  // duplicate action paths: same useLensData('x','Macro' or lensRun('x','y'
  const actionCalls = {};
  for (const m of src.matchAll(/(?:useLensData|lensRun|runDomain|runMacro)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
    const k = `${m[1]}.${m[2]}`;
    actionCalls[k] = (actionCalls[k] || 0) + 1;
  }
  const dupActionPaths = Object.values(actionCalls).filter((n) => n >= 2).length;

  // components/<name>/ pile
  let domainComponentCount = 0;
  const cdir = path.join(COMPONENTS_DIR, name);
  if (fs.existsSync(cdir)) {
    try {
      domainComponentCount = fs.readdirSync(cdir, { recursive: true })
        .filter((f) => typeof f === 'string' && /\.(tsx|jsx)$/.test(f)).length;
    } catch { /* older node: shallow */ domainComponentCount = fs.readdirSync(cdir).filter((f) => /\.(tsx|jsx)$/.test(f)).length; }
  }

  // Score — the "welded piles" signature, NOT raw size. A thin page that
  // delegates 17 tabs to 17 panel components (retail: 191 LOC) is the GOOD
  // pattern and should score low. The bad pattern is inline logic sprawl:
  // thousands of LOC, many independent state machines, heterogeneous render
  // strategies, high hook counts — all in one file.
  const inlineBloat = Math.max(0, loc - 400 - feature.size * 60); // LOC not explained by delegated panels
  const stackingScore =
    Math.min(inlineBloat / 900, 7) +
    Math.max(0, viewStateMachines - 1) * 2.5 +      // 1 tab machine is fine; 2+ independent ones are welded apps
    (renderStrategies >= 2 ? 3 : 0) +               // heterogeneous render = piled by different sessions
    Math.min(Math.max(0, useStateCount - 8) / 4, 4) +
    Math.min(Math.max(0, useEffectCount - 4) / 3, 3) +
    Math.min(screenBranches / 12, 3) +
    deadViewValues * 1.5 +
    dupActionPaths * 1.5;

  return {
    lens: name,
    loc,
    inlineBloat,
    featureImports: feature.size,
    sharedImports: shared.size,
    coLocatedImports: coLocated.size,
    useStateCount,
    useEffectCount,
    viewStateMachines,
    renderStrategies,
    screenBranches,
    deadViewValues,
    deadViewList: deadList,
    dupActionPaths,
    domainComponentCount,
    stackingScore: Math.round(stackingScore * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
const lensNames = fs.readdirSync(LENSES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort();

const rows = lensNames.map(analyzeLens).filter(Boolean).sort((a, b) => b.stackingScore - a.stackingScore);

const HEAVY = rows.filter((r) => r.stackingScore >= 12);
const MODERATE = rows.filter((r) => r.stackingScore >= 7 && r.stackingScore < 12);

const md = [];
md.push('# Lens stacked-UI report');
md.push('');
md.push(`Generated ${new Date().toISOString()} · \`node scripts/detect-lens-stacking.mjs\``);
md.push('');
md.push(`${rows.length} lenses scanned. **${HEAVY.length} heavy** (score ≥ 12) · **${MODERATE.length} moderate** (7–12) · ${rows.length - HEAVY.length - MODERATE.length} clean.`);
md.push('');
md.push('`stackingScore` weights the **welded-piles** signature, NOT raw size: `inlineBloat` (LOC not explained by delegated panels), **independent view-state machines beyond the first** (one tab machine is fine — 2+ separate ones gating different regions is welded apps), heterogeneous render strategies in one file (tab-union + `&&`-screens + boolean modal toggles all coexisting = piled by different sessions), hook sprawl (`useState`/`useEffect` over the norm), top-level screen branches, literal-only dead view values, and duplicate action paths. A thin page that delegates 17 tabs to 17 panel components (e.g. `retail`, 191 LOC) is the GOOD pattern and scores low. Read the columns, not just the score.');
md.push('');
md.push('| lens | score | LOC | inlineBloat | feat-cmp | view-SM | render-strat | useState | useEffect | screen-br | dead-view | dup-act |');
md.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
for (const r of rows) {
  md.push(`| \`${r.lens}\` | ${r.stackingScore} | ${r.loc} | ${r.inlineBloat} | ${r.featureImports} | ${r.viewStateMachines} | ${r.renderStrategies} | ${r.useStateCount} | ${r.useEffectCount} | ${r.screenBranches} | ${r.deadViewValues} | ${r.dupActionPaths} |`);
}
md.push('');
md.push('## Heavy — rebuild candidates (score ≥ 12)');
md.push('');
for (const r of HEAVY) {
  md.push(`### \`${r.lens}\` — ${r.stackingScore}`);
  md.push(`- ${r.loc} LOC (${r.inlineBloat} inline-bloat) · ${r.featureImports} feature component imports · ${r.domainComponentCount} files in \`components/${r.lens}/\``);
  md.push(`- **${r.viewStateMachines} view-state machine(s)** · ${r.renderStrategies}/3 render strategies coexisting · ${r.useStateCount} useState · ${r.useEffectCount} useEffect · ${r.screenBranches} top-level screen branches`);
  if (r.deadViewValues) md.push(`- **${r.deadViewValues} dead view value(s)** (declared in a literal-only union, never navigated to): ${r.deadViewList.map((x) => `\`${x}\``).join(', ')}`);
  if (r.dupActionPaths) md.push(`- **${r.dupActionPaths} macro(s) called from 2+ sites** — candidate duplicate flows for the same action`);
  md.push('');
}


md.push('## Moderate — next consolidations (score 7–12)');
md.push('');
if (MODERATE.length === 0) {
  md.push('_None right now._');
  md.push('');
} else {
  for (const r of MODERATE) {
    md.push(`- \`${r.lens}\` — score ${r.stackingScore}, ${r.loc} LOC, ${r.viewStateMachines} view-SM, ${r.inlineBloat} inline-bloat`);
  }
  md.push('');
}

md.push('## Honest gaps (leave listed)');
md.push('');
md.push('- Detector is static AST/heuristics — a thin page that re-implements a second app inside one panel file will look clean while still being welded.');
md.push('- `world` is a game client, not one app; do not treat its score as a routine consolidation ticket (see `docs/LENS_CONSOLIDATION_PLAYBOOK.md` §3).');
md.push('- Macro-preservation (`lensRun` / `useLensData` parity) is **not** automated here — Step 5 of the playbook still requires a grepped contract check per lens.');
md.push('- Chrome de-dup (RecentMineCard / AutoActionStrip stacked under LensFeedButton) can leave odd JSX whitespace; formatting cleanup is separate from score.');
md.push('- Heavy lenses (`chat`, `healthcare`, `trades`, `studio`, `education`, `fitness`, `crypto`, `council`, `game`, `music`, `code`) still need full extract-to-panels passes — chrome strips alone do not drop them below 12.');
md.push('- Baseline ratchet (`audit/lens-stacking-baseline.json`) is recommended but not wired into CI yet.');
md.push('');

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', 'lens-stacking-report.md'), md.join('\n'));
fs.writeFileSync(path.join(ROOT, 'audit', 'lens-stacking.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

console.log(`Scanned ${rows.length} lenses.`);
console.log(`Heavy (>=12):    ${HEAVY.length}`);
console.log(`Moderate (7-12): ${MODERATE.length}`);
console.log(`Clean (<7):      ${rows.length - HEAVY.length - MODERATE.length}`);
console.log('');
console.log('Top 15 by stackingScore:');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${String(r.stackingScore).padStart(6)}  ${r.lens.padEnd(22)} LOC ${String(r.loc).padStart(5)}  cmp ${String(r.featureImports).padStart(3)}  viewSM ${r.viewStateMachines}  dead ${r.deadViewValues}  dup ${r.dupActionPaths}`);
}
console.log('');
console.log('→ audit/lens-stacking-report.md  +  audit/lens-stacking.json');
