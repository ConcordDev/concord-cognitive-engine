#!/usr/bin/env node
// scripts/codemod-div-as-button.mjs
//
// Mechanical a11y fix: every `<div ... onClick={...} ...>` that lacks
// keyboard support gets `role="button"`, `tabIndex={0}`, and an
// `onKeyDown` handler that synthesizes a click on Enter/Space.
//
// Why not convert to `<button>`? Because the div likely has layout
// classes (flex children, custom heights, etc.) that conflict with
// the browser's default button styles. Adding role+tabIndex+keydown
// gives the same a11y result without touching layout.
//
// The synthesized handler uses `e.currentTarget.click()` so the
// existing onClick handler runs unchanged — regardless of whether
// the original was an inline arrow function or a referenced function.
//
// Run: node scripts/codemod-div-as-button.mjs
// Run with --dry-run for a count without writes.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const FRONTEND = path.join(ROOT, 'concord-frontend');
const DRY_RUN = process.argv.includes('--dry-run');

const KEYDOWN_HANDLER =
  `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}`;

// ---- 1. File walk ----

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
console.error(`Scanning ${files.length} files…`);

// ---- 2. Scan a single source for `<div ...onClick=...>` opening tags ----

// Finds the matching `>` for a JSX opening tag starting at startIdx
// (which points at the `<`). Returns the index of the `>` (exclusive end
// would be index+1). Handles strings, template literals, balanced
// braces inside expression containers. Returns -1 on failure.
function findTagClose(src, startIdx) {
  let i = startIdx + 1;
  const n = src.length;
  while (i < n && /[a-zA-Z_]/.test(src[i])) i++; // skip tag name
  while (i < n) {
    const c = src[i];
    if (c === '>') return i;
    if (c === '/' && src[i + 1] === '>') return i + 1;
    if (c === '"' || c === "'") {
      // attribute string
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '`') {
      // template literal
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
      // expression container with balanced braces (skipping strings/templates inside)
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
        if (cc === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (cc === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
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

// Identify `<div ... onClick=... ... >` opening tags that need
// patching. Returns { start, closeIdx, isSelfClosing, contents }
// for each candidate.
function findDivOnClickTags(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<div', i);
    if (lt < 0) break;
    // `<div` must be followed by whitespace or `>` (not `<divider`)
    const next = src[lt + 4];
    if (next && /[a-zA-Z0-9_]/.test(next)) { i = lt + 4; continue; }
    const close = findTagClose(src, lt);
    if (close < 0) { i = lt + 4; continue; }
    const isSelfClosing = src[close - 1] === '/';
    const contents = src.slice(lt, close + 1);
    out.push({ start: lt, closeIdx: close, isSelfClosing, contents });
    i = close + 1;
  }
  return out;
}

function tagNeedsPatch(contents) {
  // Must have onClick attribute.
  if (!/\bonClick\s*=/.test(contents)) return false;
  // Must NOT already have keyboard support.
  if (/\bonKey(Down|Press|Up)\s*=/.test(contents)) return false;
  if (/\brole\s*=\s*["']button/.test(contents)) return false;
  if (/\btabIndex\s*=/.test(contents)) return false;
  return true;
}

function patchTag(contents) {
  // Insert ` role="button" tabIndex={0} onKeyDown={...}` before the
  // closing `>` (or `/>` for self-closing).
  const selfClosing = contents.endsWith('/>');
  const insertAt = selfClosing ? contents.length - 2 : contents.length - 1;
  // Trim trailing whitespace just before the close so the insertion
  // reads naturally.
  let head = contents.slice(0, insertAt).replace(/\s*$/, '');
  const tail = contents.slice(insertAt);
  const insertion = ` role="button" tabIndex={0} ${KEYDOWN_HANDLER}`;
  return head + insertion + (selfClosing ? ' /' : '') + (selfClosing ? '>' : '>');
}

// ---- 3. Process every file ----

let totalPatched = 0;
let filesPatched = 0;
let filesSkippedParseError = 0;

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  // Quick prefilter: skip files with no `<div` + `onClick` pair.
  if (!/<div\b/.test(original) || !/onClick/.test(original)) continue;

  let tags;
  try {
    tags = findDivOnClickTags(original);
  } catch (e) {
    filesSkippedParseError++;
    continue;
  }
  const candidates = tags
    .filter(t => tagNeedsPatch(t.contents))
    // patch back-to-front so earlier offsets stay valid
    .sort((a, b) => b.start - a.start);

  if (candidates.length === 0) continue;

  let mutated = original;
  for (const c of candidates) {
    const patched = patchTag(c.contents);
    const before = mutated.slice(0, c.start);
    const after = mutated.slice(c.closeIdx + 1);
    mutated = before + patched + after;
  }

  if (!DRY_RUN) {
    fs.writeFileSync(file, mutated);
  }
  totalPatched += candidates.length;
  filesPatched++;
}

console.error(`\nFiles patched: ${filesPatched}${DRY_RUN ? ' (dry-run)' : ''}`);
console.error(`Total <div onClick> instances patched: ${totalPatched}`);
console.error(`Files skipped (parse error): ${filesSkippedParseError}`);
if (!DRY_RUN) {
  console.error(`\nNext: run 'node scripts/grade-ux-polish.mjs' to verify the lift,`);
  console.error(`and 'npm run type-check' to confirm no TypeScript regressions.`);
}
