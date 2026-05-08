#!/usr/bin/env node
/**
 * codemod-lens-commands.mjs — auto-wire useLensCommand for every
 * tabbed lens that doesn't already have one.
 *
 * Strategy:
 *   1. Find the lens's tab setter (setActiveTab / setMode / setTab /
 *      setView / setActiveView / setSection / setActivePanel / setStep,
 *      etc.).
 *   2. Scrape every literal-string arg passed to that setter in the
 *      file. Those are the real tab values being switched between.
 *   3. Auto-assign single-letter keys (first letter of each value,
 *      deduped greedy).
 *   4. Insert useLensCommand block right after the setter's useState
 *      declaration. Add the import after useLensNav.
 *
 * Skips files that already mount useLensCommand. Idempotent.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-lens-commands.mjs --dry
 *   node scripts/codemod-lens-commands.mjs
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FRONTEND = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const LENSES = path.join(FRONTEND, 'app', 'lenses');

// Setter-name candidates, ordered by specificity. The first one whose
// call sites yield ≥2 distinct literal values wins for that file.
const SETTERS = [
  'setActiveTab', 'setActiveMode', 'setActiveView', 'setActivePanel',
  'setActiveSection', 'setActiveStep',
  'setMode', 'setTab', 'setView', 'setSection', 'setPanel', 'setStep',
  'setSelectedTab', 'setCurrentTab', 'setCurrentView',
];

function scrapeSetterValues(src, setterName) {
  // Match `setterName('foo')`, `setterName("foo")`, `setterName(\`foo\`)`.
  const re = new RegExp(
    `\\b${setterName}\\s*\\(\\s*['"\`]([^'"\`\\n]{1,40})['"\`]\\s*\\)`,
    'g'
  );
  const set = new Set();
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return [...set];
}

// Extract tab values from comparison-style branches:
//   activeTab === 'foo'  /  mode === 'bar'  /  view === 'baz'
// and from tab-config arrays:
//   const TABS = [{ id: 'foo', label: ... }, ...]
//   const tabs = [{ key: 'bar' }, ...]
// We use these as a complement when setter call sites only pass a
// variable like `setActiveTab(tab.id)`.
function scrapeFromComparisons(src, stateVar) {
  const re = new RegExp(
    `\\b${stateVar}\\s*===\\s*['"\`]([^'"\`\\n]{1,40})['"\`]`,
    'g'
  );
  const set = new Set();
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return [...set];
}

function scrapeFromTabConfig(src) {
  const set = new Set();
  // `id: 'foo'` or `id: "foo"` or `id: \`foo\``
  // anywhere in the file. We scope by looking for blocks containing
  // both `id:` AND `label:` AND a string-literal — that's the tab-
  // config shape used across the codebase.
  // Conservative pass: only inside arrays declared as `const TABS = [...]`
  // or `const tabs = [...]` to avoid false positives.
  const arrayBlocks = [];
  const arrayRe = /\b(?:TABS|tabs|MODE_TABS|TAB_CONFIG|MODES|VIEWS|SECTIONS)\s*[:=]\s*\[([\s\S]*?)\]\s*[;,)]/g;
  let m;
  while ((m = arrayRe.exec(src)) !== null) arrayBlocks.push(m[1]);
  const idRe = /\b(?:id|key|value)\s*:\s*['"\`]([a-z0-9_-]{1,40})['"\`]/gi;
  for (const block of arrayBlocks) {
    let mm;
    while ((mm = idRe.exec(block)) !== null) set.add(mm[1]);
  }
  return [...set];
}

// Map setter name → state variable name (chat: setActiveTab → activeTab).
function stateVarFor(setter) {
  return setter.replace(/^set/, '').replace(/^./, (c) => c.toLowerCase());
}

function pickSetter(src) {
  // Round 1 — strict: setter called with literal strings ≥2x.
  for (const name of SETTERS) {
    const values = scrapeSetterValues(src, name);
    if (values.length >= 2) {
      return { name, values: values.slice(0, 12), source: 'setter-literals' };
    }
  }
  // Round 2 — also accept setter-with-variable if matching `state ===`
  // comparisons exist, or a TABS/tabs config array exists. Setter must
  // appear in the file even once (so we know the state hook name).
  const tabConfigVals = scrapeFromTabConfig(src);
  for (const name of SETTERS) {
    const setterRe = new RegExp(`\\b${name}\\s*\\(`);
    if (!setterRe.test(src)) continue;
    const stateVar = stateVarFor(name);
    const cmpVals = scrapeFromComparisons(src, stateVar);
    const merged = new Set([...cmpVals, ...tabConfigVals]);
    if (merged.size >= 2) {
      // Cap at 12 — beyond that single-letter keys collide and the
      // command palette becomes noisy. Lenses with more tabs need
      // hand-tuned commands later.
      const capped = [...merged].slice(0, 12);
      return { name, values: capped, source: cmpVals.length ? 'comparisons' : 'tab-config' };
    }
  }
  return null;
}

function findUseStateLine(src, setterName) {
  // Find `const [..., setterName] = useState<...>(...);`
  const re = new RegExp(
    `^(\\s*)const\\s*\\[[^\\]]*,\\s*${setterName}\\s*\\][^;]*useState[^;]*;\\s*$`,
    'm'
  );
  const m = src.match(re);
  if (!m) return null;
  return { lineEnd: m.index + m[0].length, indent: m[1] };
}

// Greedy single-letter key assignment. First letter of each value;
// if taken, walk through subsequent letters, then digits as last resort.
function assignKeys(values) {
  const used = new Set();
  const out = [];
  for (const v of values) {
    const lc = v.toLowerCase();
    let key = null;
    for (const ch of lc) {
      if (/[a-z]/.test(ch) && !used.has(ch)) {
        key = ch;
        break;
      }
    }
    if (!key) {
      for (const ch of '0123456789') {
        if (!used.has(ch)) { key = ch; break; }
      }
    }
    if (!key) key = '?'; // unreachable for ≤36 tabs
    used.add(key);
    out.push({ value: v, key });
  }
  return out;
}

function describe(value) {
  // Cheap human label: kebab → spaces, first char upper.
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function buildBlock(lensId, setterName, valueKeyPairs, indent) {
  const entries = valueKeyPairs.map(({ value, key }) => {
    const safeId = `tab-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const desc = describe(value);
    // Use the original literal value (preserves case for type-safe tab unions)
    return `${indent}    { id: '${safeId}', keys: '${key}', description: '${desc}', category: 'navigation', action: () => ${setterName}('${value}') },`;
  }).join('\n');
  return [
    '',
    `${indent}// Lens-scoped keyboard commands (auto-wired by codemod).`,
    `${indent}useLensCommand(`,
    `${indent}  [`,
    entries,
    `${indent}  ],`,
    `${indent}  { lensId: '${lensId}' }`,
    `${indent});`,
  ].join('\n');
}

function ensureImport(src) {
  if (src.includes("from '@/hooks/useLensCommand'")) return src;
  // Insert right after the useLensNav import (most reliable anchor).
  const useLensNavRe = /^(import\s+\{\s*useLensNav\s*\}\s+from\s+'@\/hooks\/useLensNav';)\s*$/m;
  const m = src.match(useLensNavRe);
  if (m) {
    const insertAt = m.index + m[0].length;
    return (
      src.slice(0, insertAt) +
      "\nimport { useLensCommand } from '@/hooks/useLensCommand';" +
      src.slice(insertAt)
    );
  }
  // Fallback: after the first import.
  const firstImport = src.match(/^import .+;\s*$/m);
  if (firstImport) {
    const insertAt = firstImport.index + firstImport[0].length;
    return (
      src.slice(0, insertAt) +
      "\nimport { useLensCommand } from '@/hooks/useLensCommand';" +
      src.slice(insertAt)
    );
  }
  return src;
}

async function processFile(file, lensId) {
  const src = await readFile(file, 'utf8');
  if (src.includes('useLensCommand(')) return { skipped: 'already-wired' };
  const picked = pickSetter(src);
  if (!picked) return { skipped: 'no-multi-tab-setter' };
  const usLine = findUseStateLine(src, picked.name);
  if (!usLine) return { skipped: 'no-useState-line' };
  const valueKeyPairs = assignKeys(picked.values);
  const block = buildBlock(lensId, picked.name, valueKeyPairs, usLine.indent);
  let next = src.slice(0, usLine.lineEnd) + '\n' + block + src.slice(usLine.lineEnd);
  next = ensureImport(next);
  if (!DRY) await writeFile(file, next, 'utf8');
  return { applied: true, setter: picked.name, count: picked.values.length };
}

async function main() {
  const dirs = (await readdir(LENSES, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('.'))
    .map((d) => d.name);

  const results = { applied: [], skipped: {}, errors: [] };
  for (const id of dirs) {
    const file = path.join(LENSES, id, 'page.tsx');
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
    } catch { continue; }
    try {
      const r = await processFile(file, id);
      if (r.applied) results.applied.push({ id, setter: r.setter, count: r.count });
      else if (r.skipped) results.skipped[r.skipped] = (results.skipped[r.skipped] || 0) + 1;
    } catch (e) {
      results.errors.push({ id, reason: String(e?.message || e) });
    }
  }

  console.log(`\n${DRY ? 'DRY RUN — ' : ''}lens-commands codemod`);
  console.log(`  applied: ${results.applied.length}`);
  console.log(`  skipped:`, results.skipped);
  if (results.applied.length) {
    console.log(`  applied (first 20):`);
    for (const a of results.applied.slice(0, 20)) {
      console.log(`    ${a.id} → ${a.setter} (${a.count} tabs)`);
    }
  }
  if (results.errors.length) {
    console.log(`  errors (${results.errors.length}):`);
    for (const e of results.errors.slice(0, 10)) console.log(`    ${e.id}: ${e.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
