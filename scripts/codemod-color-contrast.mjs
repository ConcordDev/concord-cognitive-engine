#!/usr/bin/env node
// scripts/codemod-color-contrast.mjs
//
// Fix WCAG AA color-contrast violations from axe-core. The dominant
// violation is `text-{zinc,gray,slate}-500` (= #6b7280) on dark
// backgrounds (#0a0a0a, #12121a, #18181b) producing ~3.85:1 contrast,
// which fails AA's 4.5:1 threshold for normal text.
//
// Fix: bump foreground from 500 → 400 (#a1a1aa) which clears 6.5:1
// against #12121a. The visual difference is small — both read as
// "muted helper text" but 400 is genuinely accessible.
//
// Scope: only patterns where the muted-color class is paired with a
// small-text class (text-xs, text-[10px], text-[11px], text-[9px],
// text-[8px]). Large text has a more lenient 3:1 threshold which
// 500 already meets; bumping ALL 500s globally would over-correct
// and visibly flatten the type hierarchy.
//
// Run: node scripts/codemod-color-contrast.mjs
// Run with --dry-run to count without writes.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND = path.join(ROOT, 'concord-frontend');
const DRY_RUN = process.argv.includes('--dry-run');

function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next', 'dist', 'build', 'public', 'audit'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

const files = [
  ...walk(path.join(FRONTEND, 'components'), ['.tsx']),
  ...walk(path.join(FRONTEND, 'app'), ['.tsx']),
];

// Patterns we'll patch — token-aware so we don't touch unrelated text-500.
// We match small-text + muted-500 in either order within a className string.
// Two passes per file: small-text + zinc/gray/slate-500 OR -600 → -400 or -500.

// Specific replacements: small-text + 500 → 400, small-text + 600 → 500.
const REPLACEMENTS = [
  // Order matters - more specific patterns first
  // text-{xs|[10-12]px} ... text-{zinc|gray|slate}-{500|600} -> -400/-500
  {
    name: 'text-zinc-500 (small) → text-zinc-400',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)zinc-500\b/g,
    replace: '$1zinc-400',
  },
  {
    name: 'text-gray-500 (small) → text-gray-400',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)gray-500\b/g,
    replace: '$1gray-400',
  },
  {
    name: 'text-slate-500 (small) → text-slate-400',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)slate-500\b/g,
    replace: '$1slate-400',
  },
  // Same with muted BEFORE size class
  {
    name: 'text-zinc-500 (then size) → text-zinc-400',
    pattern: /(\btext-)zinc-500(\b[^"'`\n]*?\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\]))/g,
    replace: '$1zinc-400$2',
  },
  {
    name: 'text-gray-500 (then size) → text-gray-400',
    pattern: /(\btext-)gray-500(\b[^"'`\n]*?\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\]))/g,
    replace: '$1gray-400$2',
  },
  {
    name: 'text-slate-500 (then size) → text-slate-400',
    pattern: /(\btext-)slate-500(\b[^"'`\n]*?\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\]))/g,
    replace: '$1slate-400$2',
  },
  // 600 → 500 for small text (also failing AA, contrast ~2.46)
  {
    name: 'text-zinc-600 (small) → text-zinc-500',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)zinc-600\b/g,
    replace: '$1zinc-400',
  },
  {
    name: 'text-gray-600 (small) → text-gray-400',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)gray-600\b/g,
    replace: '$1gray-400',
  },
  {
    name: 'text-slate-600 (small) → text-slate-400',
    pattern: /(\btext-(?:xs|\[8px\]|\[9px\]|\[10px\]|\[11px\]|\[12px\])[^"'`\n]*?\btext-)slate-600\b/g,
    replace: '$1slate-400',
  },
];

let totalReplacements = 0;
let filesChanged = 0;
const perRule = {};

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let fileChanged = false;
  for (const r of REPLACEMENTS) {
    const before = src;
    src = src.replace(r.pattern, r.replace);
    if (src !== before) {
      const count = before.match(r.pattern)?.length || 0;
      perRule[r.name] = (perRule[r.name] || 0) + count;
      totalReplacements += count;
      fileChanged = true;
    }
  }
  if (fileChanged) {
    if (!DRY_RUN) fs.writeFileSync(file, src);
    filesChanged++;
  }
}

console.error(`Files changed: ${filesChanged}${DRY_RUN ? ' (dry-run)' : ''}`);
console.error(`Total class replacements: ${totalReplacements}`);
for (const [rule, n] of Object.entries(perRule).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${rule}: ${n}`);
}
