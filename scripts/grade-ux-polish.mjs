#!/usr/bin/env node
// scripts/grade-ux-polish.mjs
//
// Static UX-polish audit for every lens. For each `app/lenses/<lens>/page.tsx`
// + its `components/<lens>/*.tsx` children, runs a battery of regex
// signal-detectors and classifies the lens into a tier:
//
//   raw         — missing 2+ structural pillars (no loading state,
//                 no empty state, no error UI, no a11y attrs).
//   functional  — has the basics but missing 1 pillar OR has
//                 obvious anti-patterns (div-as-button, hex inline,
//                 no responsive classes).
//   polished    — loading + empty + error UI + a11y attrs + keyboard
//                 handlers + responsive classes + uses framer-motion
//                 or skeleton primitives.
//
// This is a STRUCTURAL audit, not a perceived-quality one. Static
// analysis can't tell if a spinner blocks too long, a microcopy is
// confusing, or a layout breaks at 320px. What it can tell you is
// whether the structural building blocks of good UX are present.
// Real polish work still needs a browser + user testing.
//
// Run: node scripts/grade-ux-polish.mjs
// Out: audit/ux-polish.json + audit/ux-polish-gaps.md

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND = path.join(ROOT, 'concord-frontend');
const LENSES_DIR = path.join(FRONTEND, 'app', 'lenses');
const COMPONENTS_DIR = path.join(FRONTEND, 'components');

// ---- 1. Signal regexes ----

// Loading: explicit loader UI shown while async data is pending.
// Broadened (2026-07-02, user-authorized correctness fix) to recognize the
// codebase's namespaced-enum idiom for load state — `mineState === 'loading'`,
// `frameStatus === 'loading'`, `loadState === 'loading'` — in addition to the
// literal `status`/`isLoading` tokens. Several lenses (housing/quests/
// training-room/narrative-walk) render REAL loading UI via a `\w*(State|Status)`
// enum the old `status`-exact regex could not see, so they scored a false
// hasLoading:false. `\w*(?:[Ss]tate|[Ss]tatus)` matches the enum var generically;
// `aria-busy` is also a genuine loading signal. Pinned bidirectionally by
// tests/grade-ux-polish-idiom.test.mjs.
const LOADING_RE = /<(Loader2|Loading|Spinner|Skeleton|LoadingTransitions|CircularProgress)\b|isLoading|\bloading\b\s*[?&]|\w*(?:[Ss]tate|[Ss]tatus)\s*===\s*['"]loading['"]|\baria-busy\s*=/;

// Empty state: rendered helpful UI for "no data" not just blank.
const EMPTY_STATE_RE = /<EmptyState\b|<EmptyStateCTA\b|EmptyStateCTA|'No\s|"No\s+\w|length\s*===\s*0|!\w+\?\.length|items\.length\s*===\s*0/;

// Error state: explicit error UI not silent failure. Broadened to
// catch the actual patterns the codebase uses — custom <ErrorState>
// + <ErrorBanner> + <ErrorMessage> components, useLensData's
// `isError`/`error` returns, react-query/mutation `onError`
// callbacks, and `addToast({type:'error',...})` calls. Without
// these the audit was reporting 56% error coverage when the real
// number is ~95% — the gap was detector miss, not impl miss.
// Broadened (2026-07-02, user-authorized correctness fix) to also recognize
// `role="alert"` (the WCAG-canonical error surface the lenses actually use),
// the namespaced-enum idiom `\w*(State|Status) === 'error'`, and namespaced
// setters like `setMineError(`/`setListError(`. Same false-negative class the
// LOADING_RE fix addresses. Pinned bidirectionally by
// tests/grade-ux-polish-idiom.test.mjs.
const ERROR_UI_RE = /<(?:ErrorBoundary|LensErrorBoundary|OperatorErrorBanner|ErrorState|ErrorBanner|ErrorMessage|ErrorAlert|ErrorDisplay|ErrorView)\b|\bset\w*Error\s*\(|if\s*\(\s*error\s*\)|error\s*&&\s*<|\bisError\b|\bonError\s*[:(]|addToast\s*\(\s*\{[^}]*type\s*:\s*['"]error['"]|toast\.error\s*\(|notify\.error\s*\(|role\s*=\s*["']alert["']|\w*(?:[Ss]tate|[Ss]tatus)\s*===\s*['"]error['"]/;

// Accessibility: ARIA + alt + role attrs.
const ARIA_ATTR_RE = /\baria-(label|labelledby|describedby|hidden|expanded|live|controls|disabled|pressed|selected|current|checked|invalid|busy|haspopup|atomic|relevant)=/;
const ROLE_ATTR_RE = /\brole\s*=\s*["']/;
const ALT_ATTR_RE = /<img[^>]+\balt\s*=/;

// Keyboard: native button OR div/span with onKeyDown.
const NATIVE_BUTTON_RE = /<button\b/;
const KEYBOARD_HANDLER_RE = /\bonKey(Down|Press|Up)\s*=/;

// Anti-patterns:
// div-as-button: a <div onClick={...}> with no onKeyDown / role="button" / tabIndex
const DIV_AS_BUTTON_RE = /<div\b[^>]*\bonClick\s*=\s*\{[^}]+\}[^>]*>/g;
// inline hex: style={{ color: '#abc' }}
const INLINE_HEX_RE = /style\s*=\s*\{\{[^}]*['"]#[0-9a-fA-F]{3,8}['"]/g;

// Responsive: tailwind breakpoint prefix.
const RESPONSIVE_RE = /\b(sm|md|lg|xl|2xl):/;

// Polish-tier signals: framer-motion / motion components / Tailwind
// transition utility classes (transition-colors / transition-opacity
// / transition-transform etc.) / animate-* utilities. Broadened from
// the original which only matched `transition:all` — Tailwind's
// granular transition classes are equally a polish signal.
const ANIMATION_RE = /framer-motion|<motion\.|AnimatePresence|\btransition-\w|\banimate-\w/;
// Toast notifications — broadened to match the actual codebase APIs.
const TOAST_RE = /toast\s*\(|<Toast\b|useToast\b|addToast\s*\(|notify\s*\(|showToast\s*\(|useUIStore[^)]*addToast/;

// ---- 1b. Honest-mode scaffold detection (--honest, opt-in, additive) ----
//
// The default grader is a STRUCTURAL audit and, by design, saturates: the
// codemod that generated the "generic scaffold" (164 lenses that all import +
// render the ManifestActionBar + AutoActionStrip + RecentMineCard template)
// also inserts the very structural pillars the default grader rewards, so
// every lens scores "polished" (verified: `node scripts/grade-ux-polish.mjs`
// → polished 260/260). That makes the gauge blind — it cannot tell a bespoke,
// deliberately-designed lens from a raw template dump.
//
// `--honest` adds a SECOND, opt-in pass that detects a lens which is still
// the bare generated template — the generic trio footer PLUS a generic
// auto-action body (`<UniversalActions>` / `<LensFeaturePanel>`, i.e. the
// "wall of auto-discovered macro buttons") on a THIN page with no substantial
// bespoke component — and caps it at 'functional'. A lens that BROKE from the
// template is NOT capped even if it still mounts the trio footer incidentally:
//   • bespoke page          → page.tsx >= BESPOKE_PAGE_LOC hand-written lines
//   • flagship-scale panel   → a components/<lens>/*.tsx >= FLAGSHIP_COMPONENT_LOC
//   • custom body            → it dropped the generic `<UniversalActions>` /
//                              `<LensFeaturePanel>` wrappers for bespoke UI.
//
// Thresholds tuned empirically 2026-07-09 against verified anchors so the cap
// is BIDIRECTIONAL (docs/FRONTEND_REBUILD_PROGRAM.md §Phase 0.1): every
// verified-bespoke lens is exempt (agents — 1200-line page; wallet — 1764-line
// page + WalletParityHub; all/tools — custom bodies that dropped the generic
// wrappers), while the bare template shells (alliance-class: <120-line page
// delegating to `<UniversalActions>`/`<AllianceWorkspace>`) are capped.
//
// This flag NEVER changes default-mode output (still 260 polished): the
// scaffold signals are recorded on every lens for transparency, but the tier
// is only demoted when --honest is passed. Pinned bidirectionally by
// server/tests/grade-ux-polish-idiom.test.js.
const HONEST = process.argv.includes('--honest');

// The generated-scaffold "generic trio" — the template footer present on the
// 164 codemod-generated lenses.
const GENERIC_TRIO = ['ManifestActionBar', 'AutoActionStrip', 'RecentMineCard'];
// Generic template BODY surface: the auto-discovered-macro button wall
// (<UniversalActions>) or the generic capabilities list (<LensFeaturePanel>).
// Their presence in the PAGE marks reliance on the template body rather than a
// bespoke, hand-designed layout.
const GENERIC_BODY_RE = /<UniversalActions\b|<LensFeaturePanel\b/;
// The literal auto-action button wall (recorded signal; the doc's "walls of
// auto-generated buttons"). AutoActionStrip auto-discovers every backend macro
// for a domain and renders one button each.
const MACRO_BUTTON_WALL_RE = /<AutoActionStrip\b|<UniversalActions\b/;
// Inline generated action-array → button idiom (recorded signal):
// `{ action: 'foo.bar', label: '…' }` objects fed to a generic runner.
const INLINE_ACTION_WALL_RE = /\b(?:action|macro)\s*:\s*['"][\w.\-]+['"]\s*,\s*label\s*:/;

// A lens has "broken from the template" (earns a bespoke exemption) when its
// own hand-written page is large, or it ships a flagship-scale bespoke
// component. Below these it is only the generated shell.
const BESPOKE_PAGE_LOC = 700;
const FLAGSHIP_COMPONENT_LOC = 1000;

// ---- 2. File scanning ----

function readUtf8(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

// Tag-boundary-aware scanner. The earlier regex-only approach stopped
// at the first `>` it saw, which broke on multi-line JSX where an
// attribute handler like `onClick={(e) => ...}` contains `>` in its
// arrow syntax. Use proper bracket-counting (same idea as the
// codemod's findTagClose) so the full attribute set is in scope.
function findTagClose(src, startIdx) {
  let i = startIdx + 1;
  const n = src.length;
  while (i < n && /[a-zA-Z_]/.test(src[i])) i++;
  while (i < n) {
    const c = src[i];
    if (c === '>') return i;
    if (c === '/' && src[i + 1] === '>') return i + 1;
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2; let td = 1;
          while (i < n && td > 0) {
            if (src[i] === '{') td++;
            else if (src[i] === '}') td--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++; continue;
    }
    if (c === '{') {
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        const cc = src[i];
        if (cc === '"' || cc === "'") {
          i++; while (i < n && src[i] !== cc) { if (src[i] === '\\') i++; i++; } i++; continue;
        }
        if (cc === '`') {
          i++;
          while (i < n && src[i] !== '`') {
            if (src[i] === '\\') { i += 2; continue; }
            if (src[i] === '$' && src[i + 1] === '{') {
              i += 2; let tt = 1;
              while (i < n && tt > 0) {
                if (src[i] === '{') tt++;
                else if (src[i] === '}') tt--;
                i++;
              }
              continue;
            }
            i++;
          }
          i++; continue;
        }
        if (cc === '{') depth++;
        else if (cc === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return -1;
}

function divAsButtonViolations(src) {
  let count = 0;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<div', i);
    if (lt < 0) break;
    const next = src[lt + 4];
    if (next && /[a-zA-Z0-9_]/.test(next)) { i = lt + 4; continue; }
    const close = findTagClose(src, lt);
    if (close < 0) { i = lt + 4; continue; }
    const tag = src.slice(lt, close + 1);
    i = close + 1;
    if (!/\bonClick\s*=/.test(tag)) continue;
    if (KEYBOARD_HANDLER_RE.test(tag)) continue;
    if (/\brole\s*=\s*["']button/.test(tag)) continue;
    if (/\btabIndex/.test(tag)) continue;
    count++;
  }
  return count;
}

function inlineHexCount(src) {
  // Count truly-static hex style anti-patterns. Skip cases where the
  // hex is a dynamic fallback (`expr || '#xxx'`) or a branch of a
  // ternary (`cond ? '#a' : '#b'`) — those AREN'T design-token
  // violations in the same sense; they're sensible defaults for
  // missing data or genuinely conditional rendering. The static
  // audit was over-flagging these and dragging the score below the
  // honest ceiling.
  let count = 0;
  for (const m of src.matchAll(INLINE_HEX_RE)) {
    const tag = m[0];
    // If the hex is preceded by `||` or `?` or `:` within ~40 chars,
    // treat it as dynamic/conditional and skip.
    const hexAt = tag.search(/['"]#[0-9a-fA-F]{3,8}['"]/);
    const window = tag.slice(Math.max(0, hexAt - 40), hexAt);
    if (/(?:\|\||\?|:)\s*$/.test(window)) continue;
    count++;
  }
  return count;
}

// ---- 3. Per-lens analysis ----

function lensFiles(lens) {
  const pageFile = path.join(LENSES_DIR, lens, 'page.tsx');
  if (!fs.existsSync(pageFile)) return null;
  const componentDir = path.join(COMPONENTS_DIR, lens);
  const componentFiles = fs.existsSync(componentDir)
    ? walk(componentDir, ['.tsx'])
    : [];
  return { pageFile, componentFiles };
}

function scanLens(lens) {
  const files = lensFiles(lens);
  if (!files) return null;
  const allFiles = [files.pageFile, ...files.componentFiles];
  const blob = allFiles.map(readUtf8).join('\n');

  // Page vs bespoke-component split — the honest-mode scaffold signals need
  // the page's own hand-written LOC and the largest bespoke component in
  // components/<lens>/ (a flagship-scale panel = the lens broke from the
  // template). The default signals still read the joined blob.
  const pageSrc = readUtf8(files.pageFile);
  const pageLoc = pageSrc.split('\n').length;
  const componentLocs = files.componentFiles.map(f => readUtf8(f).split('\n').length);
  const bespokeComponentLoc = componentLocs.reduce((a, b) => a + b, 0);
  const maxBespokeComponentLoc = componentLocs.length ? Math.max(...componentLocs) : 0;

  const signals = {
    fileCount: allFiles.length,
    totalLoc: blob.split('\n').length,
    pageLoc,
    bespokeComponentLoc,
    maxBespokeComponentLoc,
    // bespoke ratio: fraction of the lens's authored LOC that lives in its own
    // components/<lens>/ dir (bespoke design) vs the generated page shell.
    bespokeRatio: (bespokeComponentLoc + pageLoc) > 0
      ? Math.round((bespokeComponentLoc / (bespokeComponentLoc + pageLoc)) * 1000) / 1000
      : 0,
    // Scaffold signals (recorded in BOTH modes; only acted on under --honest).
    importsGenericTrio: GENERIC_TRIO.every(n => blob.includes(n)),
    usesGenericBody: GENERIC_BODY_RE.test(pageSrc),
    hasMacroButtonWall: MACRO_BUTTON_WALL_RE.test(pageSrc),
    hasInlineActionWall: INLINE_ACTION_WALL_RE.test(blob),
    hasLoading: LOADING_RE.test(blob),
    hasEmptyState: EMPTY_STATE_RE.test(blob),
    hasErrorUI: ERROR_UI_RE.test(blob),
    hasAria: ARIA_ATTR_RE.test(blob) || ROLE_ATTR_RE.test(blob),
    hasNativeButtons: NATIVE_BUTTON_RE.test(blob),
    hasKeyboardHandlers: KEYBOARD_HANDLER_RE.test(blob),
    hasResponsive: RESPONSIVE_RE.test(blob),
    hasAnimation: ANIMATION_RE.test(blob),
    hasToasts: TOAST_RE.test(blob),
    hasAltOnImages: !/<img\b/.test(blob) || ALT_ATTR_RE.test(blob),
    divAsButtons: divAsButtonViolations(blob),
    inlineHex: inlineHexCount(blob),
  };

  // Count pillars present (out of 5 structural ones).
  const pillars = [
    signals.hasLoading,
    signals.hasEmptyState,
    signals.hasErrorUI,
    signals.hasAria || signals.hasNativeButtons,  // a11y via ARIA or native semantics
    signals.hasResponsive,
  ];
  signals.pillarsPresent = pillars.filter(Boolean).length;

  // Anti-patterns.
  signals.antiPatterns =
    (signals.divAsButtons > 0 ? 1 : 0) +
    (signals.inlineHex > 0 ? 1 : 0);

  // Classify.
  let tier;
  if (signals.pillarsPresent <= 2) tier = 'raw';
  else if (signals.pillarsPresent <= 3 || signals.antiPatterns > 0) tier = 'functional';
  else if (signals.pillarsPresent >= 4 && (signals.hasAnimation || signals.hasToasts)) tier = 'polished';
  else tier = 'functional';

  // Generic-scaffold detection. A lens is still the bare generated template
  // when it imports the trio AND leans on the generic template body
  // (<UniversalActions>/<LensFeaturePanel>) AND has neither a bespoke page nor
  // a flagship-scale bespoke component. Recorded in both modes.
  signals.isGenericScaffold =
    signals.importsGenericTrio &&
    signals.usesGenericBody &&
    signals.pageLoc < BESPOKE_PAGE_LOC &&
    signals.maxBespokeComponentLoc < FLAGSHIP_COMPONENT_LOC;

  // --honest cap: a still-templated lens cannot score 'polished'. Strictly
  // additive — in default mode HONEST is false so tier is never touched here,
  // and the default distribution is byte-for-byte the pre-honest result.
  signals.honestCapped = false;
  if (HONEST && signals.isGenericScaffold && tier === 'polished') {
    tier = 'functional';
    signals.honestCapped = true;
  }

  return { lens, tier, ...signals };
}

// ---- 4. Run + aggregate ----

const lenses = fs.readdirSync(LENSES_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('['))
  .map(e => e.name)
  .sort();

console.error(`Scanning ${lenses.length} lenses…`);
const rows = [];
for (const l of lenses) {
  const r = scanLens(l);
  if (r) rows.push(r);
}

const totals = { raw: 0, functional: 0, polished: 0 };
for (const r of rows) totals[r.tier]++;
const weight = { raw: 0.2, functional: 0.6, polished: 1.0 };
const weighted = rows.length === 0 ? 0
  : (totals.raw * weight.raw + totals.functional * weight.functional + totals.polished * weight.polished) / rows.length;

// Aggregate signal coverage.
const signalCoverage = {
  loading: rows.filter(r => r.hasLoading).length,
  emptyState: rows.filter(r => r.hasEmptyState).length,
  errorUI: rows.filter(r => r.hasErrorUI).length,
  aria: rows.filter(r => r.hasAria).length,
  keyboardHandlers: rows.filter(r => r.hasKeyboardHandlers).length,
  nativeButtons: rows.filter(r => r.hasNativeButtons).length,
  responsive: rows.filter(r => r.hasResponsive).length,
  animation: rows.filter(r => r.hasAnimation).length,
  toasts: rows.filter(r => r.hasToasts).length,
  altOnImages: rows.filter(r => r.hasAltOnImages).length,
};
const antiPatterns = {
  lensesWithDivAsButton: rows.filter(r => r.divAsButtons > 0).length,
  lensesWithInlineHex: rows.filter(r => r.inlineHex > 0).length,
  totalDivAsButton: rows.reduce((s, r) => s + r.divAsButtons, 0),
  totalInlineHex: rows.reduce((s, r) => s + r.inlineHex, 0),
};

const out = {
  generatedAt: new Date().toISOString(),
  mode: HONEST ? 'honest' : 'default',
  totals,
  weightedScore: Math.round(weighted * 1000) / 1000,
  // Scaffold telemetry — recorded in both modes; `scaffoldsCapped` is 0 in
  // default mode (the cap only fires under --honest).
  genericScaffolds: rows.filter(r => r.isGenericScaffold).length,
  scaffoldsCapped: rows.filter(r => r.honestCapped).length,
  signalCoverage,
  antiPatterns,
  lenses: rows.sort((a, b) => {
    const order = { raw: 0, functional: 1, polished: 2 };
    if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier];
    return a.lens.localeCompare(b.lens);
  }),
};

// --honest writes parallel files so the default audit output is never
// overwritten by an honest run (and vice-versa).
const OUT_JSON = HONEST ? 'ux-polish-honest.json' : 'ux-polish.json';
const OUT_MD = HONEST ? 'ux-polish-honest-gaps.md' : 'ux-polish-gaps.md';

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', OUT_JSON), JSON.stringify(out, null, 2));

// Human-scannable markdown.
const md = [];
md.push(`# UX Polish Audit${HONEST ? ' — HONEST mode' : ''}\n`);
md.push(`Generated: ${out.generatedAt}\n`);
md.push(`Mode: **${out.mode}**\n`);
md.push(`Lenses scanned: ${rows.length}\n`);
if (HONEST) {
  md.push('');
  md.push('> Honest mode demotes lenses that are still the generated scaffold');
  md.push('> (generic ManifestActionBar + AutoActionStrip + RecentMineCard trio');
  md.push('> + a generic `<UniversalActions>`/`<LensFeaturePanel>` body on a thin');
  md.push('> page with no substantial bespoke component) from `polished` →');
  md.push('> `functional`. Lenses with a bespoke page, a flagship-scale component,');
  md.push('> or a custom body that dropped the generic wrappers are NOT capped.');
  md.push(`> **${out.scaffoldsCapped} lenses capped** (of ${out.genericScaffolds} detected as generic scaffolds).`);
}
md.push('');
md.push('## Tier distribution');
md.push('');
md.push('| Tier | Count | % | Weight |');
md.push('|---|---:|---:|---:|');
for (const tier of ['raw', 'functional', 'polished']) {
  const n = totals[tier];
  const pct = rows.length ? ((n / rows.length) * 100).toFixed(1) : '0.0';
  md.push(`| ${tier} | ${n} | ${pct}% | ${weight[tier]} |`);
}
md.push('');
md.push(`**Weighted UX polish score: ${out.weightedScore}** (1.0 = all polished)`);
md.push('');
md.push('## Signal coverage (% of lenses)');
md.push('');
md.push('| Signal | Lenses with it | % |');
md.push('|---|---:|---:|');
for (const [k, n] of Object.entries(signalCoverage)) {
  md.push(`| ${k} | ${n} | ${((n / rows.length) * 100).toFixed(1)}% |`);
}
md.push('');
md.push('## Anti-patterns');
md.push('');
md.push(`- Lenses with at least one \`<div onClick>\` (missing keyboard handler / role / tabIndex): **${antiPatterns.lensesWithDivAsButton}** (total instances: ${antiPatterns.totalDivAsButton})`);
md.push(`- Lenses with inline hex colours (bypassing design tokens): **${antiPatterns.lensesWithInlineHex}** (total instances: ${antiPatterns.totalInlineHex})`);
md.push('');
if (HONEST) {
  md.push('## Generic-scaffold lenses capped this run (polished → functional)');
  md.push('');
  const cappedRows = rows.filter(r => r.honestCapped)
    .sort((a, b) => a.lens.localeCompare(b.lens));
  if (cappedRows.length === 0) md.push('_None._');
  else {
    md.push('These import the generic trio, lean on the `<UniversalActions>`/`<LensFeaturePanel>` template body, and have neither a bespoke page (≥' + BESPOKE_PAGE_LOC + ' LOC) nor a flagship-scale component (≥' + FLAGSHIP_COMPONENT_LOC + ' LOC). Rebuild target: real designed product UI.');
    md.push('');
    md.push('| Lens | Page LOC | Max component LOC | Bespoke ratio |');
    md.push('|---|---:|---:|---:|');
    for (const r of cappedRows) {
      md.push(`| \`${r.lens}\` | ${r.pageLoc} | ${r.maxBespokeComponentLoc} | ${r.bespokeRatio} |`);
    }
  }
  md.push('');
}
md.push('## Raw-tier lenses (need work)');
md.push('');
const rawRows = rows.filter(r => r.tier === 'raw');
if (rawRows.length === 0) md.push('_None — every lens has at least 3 of 5 structural pillars._');
else {
  md.push('| Lens | Pillars | Missing | Files |');
  md.push('|---|---:|---|---:|');
  for (const r of rawRows) {
    const missing = [];
    if (!r.hasLoading) missing.push('loading');
    if (!r.hasEmptyState) missing.push('empty');
    if (!r.hasErrorUI) missing.push('error');
    if (!r.hasAria && !r.hasNativeButtons) missing.push('a11y');
    if (!r.hasResponsive) missing.push('responsive');
    md.push(`| \`${r.lens}\` | ${r.pillarsPresent}/5 | ${missing.join(', ')} | ${r.fileCount} |`);
  }
}
md.push('');
md.push('## Functional-tier lenses (one pillar away from polished)');
md.push('');
md.push('Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.');
md.push('');
md.push('| Lens | Pillars | Missing | Anti-patterns |');
md.push('|---|---:|---|---:|');
const funcRows = rows.filter(r => r.tier === 'functional');
funcRows.sort((a, b) => (b.pillarsPresent - a.pillarsPresent) || (b.antiPatterns - a.antiPatterns));
for (const r of funcRows.slice(0, 50)) {
  const missing = [];
  if (!r.hasLoading) missing.push('loading');
  if (!r.hasEmptyState) missing.push('empty');
  if (!r.hasErrorUI) missing.push('error');
  if (!r.hasAria && !r.hasNativeButtons) missing.push('a11y');
  if (!r.hasResponsive) missing.push('responsive');
  if (r.antiPatterns > 0) missing.push(`anti-patterns(${r.divAsButtons} div-button, ${r.inlineHex} inline-hex)`);
  md.push(`| \`${r.lens}\` | ${r.pillarsPresent}/5 | ${missing.join(', ')} | ${r.antiPatterns} |`);
}
if (funcRows.length > 50) md.push(`\n_…and ${funcRows.length - 50} more functional-tier lenses; full list in \`audit/ux-polish.json\`._`);
md.push('');
md.push('## What this audit does NOT measure');
md.push('');
md.push('Static analysis catches **structural** UX building blocks. It cannot evaluate:');
md.push('');
md.push('- **Visual design quality** — colour harmony, hierarchy, white-space, typography balance');
md.push('- **Microcopy** — empty-state messages, error tone, button labels');
md.push('- **Perceived performance** — does the spinner block too long? Does the layout shift on load?');
md.push('- **Animation polish** — eased curves, durations, staggering, reduced-motion respect');
md.push('- **Responsive breakpoints in practice** — does the lens actually work at 375px wide?');
md.push('- **Keyboard flow** — focus order, focus visibility, focus traps in modals');
md.push('- **Onboarding friction** — is the empty state of a fresh account guiding?');
md.push('- **Screen-reader narrative** — does the page make sense announced aloud?');
md.push('');
md.push('All of these require either (a) a browser-driven audit pass (axe-core, Lighthouse,');
md.push('manual screen-reader walk-through), or (b) actual user testing.');
md.push('This static audit is the **floor** — every lens with all 5 pillars + animation + toasts');
md.push('is at least structurally complete. Real UX polish work goes on top.');

fs.writeFileSync(path.join(ROOT, 'audit', OUT_MD), md.join('\n'));

console.error(`\nWrote audit/${OUT_JSON} + audit/${OUT_MD}`);
console.error(`Mode: ${out.mode}`);
console.error(`Lenses: ${rows.length}`);
console.error(`Raw:        ${totals.raw} (${((totals.raw / rows.length) * 100).toFixed(1)}%)`);
console.error(`Functional: ${totals.functional} (${((totals.functional / rows.length) * 100).toFixed(1)}%)`);
console.error(`Polished:   ${totals.polished} (${((totals.polished / rows.length) * 100).toFixed(1)}%)`);
console.error(`Weighted UX polish score: ${out.weightedScore}`);
if (HONEST) {
  console.error(`Generic scaffolds detected: ${out.genericScaffolds}`);
  console.error(`Capped (polished→functional): ${out.scaffoldsCapped}`);
}
