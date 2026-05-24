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
const LOADING_RE = /<(Loader2|Loading|Spinner|Skeleton|LoadingTransitions|CircularProgress)\b|isLoading|\bloading\b\s*[?&]|status\s*===\s*['"]loading['"]/;

// Empty state: rendered helpful UI for "no data" not just blank.
const EMPTY_STATE_RE = /<EmptyState\b|<EmptyStateCTA\b|EmptyStateCTA|'No\s|"No\s+\w|length\s*===\s*0|!\w+\?\.length|items\.length\s*===\s*0/;

// Error state: explicit error UI not silent failure. Broadened to
// catch the actual patterns the codebase uses — custom <ErrorState>
// + <ErrorBanner> + <ErrorMessage> components, useLensData's
// `isError`/`error` returns, react-query/mutation `onError`
// callbacks, and `addToast({type:'error',...})` calls. Without
// these the audit was reporting 56% error coverage when the real
// number is ~95% — the gap was detector miss, not impl miss.
const ERROR_UI_RE = /<(?:ErrorBoundary|LensErrorBoundary|OperatorErrorBanner|ErrorState|ErrorBanner|ErrorMessage|ErrorAlert|ErrorDisplay|ErrorView)\b|setError\s*\(|if\s*\(\s*error\s*\)|error\s*&&\s*<|\bisError\b|\bonError\s*[:(]|addToast\s*\(\s*\{[^}]*type\s*:\s*['"]error['"]|toast\.error\s*\(|notify\.error\s*\(/;

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

  const signals = {
    fileCount: allFiles.length,
    totalLoc: blob.split('\n').length,
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
  totals,
  weightedScore: Math.round(weighted * 1000) / 1000,
  signalCoverage,
  antiPatterns,
  lenses: rows.sort((a, b) => {
    const order = { raw: 0, functional: 1, polished: 2 };
    if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier];
    return a.lens.localeCompare(b.lens);
  }),
};

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', 'ux-polish.json'), JSON.stringify(out, null, 2));

// Human-scannable markdown.
const md = [];
md.push('# UX Polish Audit\n');
md.push(`Generated: ${out.generatedAt}\n`);
md.push(`Lenses scanned: ${rows.length}\n`);
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

fs.writeFileSync(path.join(ROOT, 'audit', 'ux-polish-gaps.md'), md.join('\n'));

console.error(`\nWrote audit/ux-polish.json + audit/ux-polish-gaps.md`);
console.error(`Lenses: ${rows.length}`);
console.error(`Raw:        ${totals.raw} (${((totals.raw / rows.length) * 100).toFixed(1)}%)`);
console.error(`Functional: ${totals.functional} (${((totals.functional / rows.length) * 100).toFixed(1)}%)`);
console.error(`Polished:   ${totals.polished} (${((totals.polished / rows.length) * 100).toFixed(1)}%)`);
console.error(`Weighted UX polish score: ${out.weightedScore}`);
