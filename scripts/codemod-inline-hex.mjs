#!/usr/bin/env node
// scripts/codemod-inline-hex.mjs
//
// Mechanical fix: `style={{ color: '#xxx' }}` → `text-[#xxx]` Tailwind
// arbitrary-value class. Same for background / backgroundColor /
// borderColor / fill / stroke. Merges with the element's existing
// className attribute when present.
//
// Conservative: only touches single-property static-hex styles. If
// the style contains multiple properties, a ternary, a fallback `||`,
// or any computed expression, the codemod skips it — those need a
// human decision (token mapping isn't trivial).
//
// Run: node scripts/codemod-inline-hex.mjs
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
console.error(`Scanning ${files.length} files…`);

// Map CSS property → Tailwind arbitrary-value class prefix.
const PROP_MAP = {
  color: 'text',
  background: 'bg',
  backgroundColor: 'bg',
  borderColor: 'border',
  borderTopColor: 'border-t',
  borderRightColor: 'border-r',
  borderBottomColor: 'border-b',
  borderLeftColor: 'border-l',
  fill: 'fill',
  stroke: 'stroke',
  outlineColor: 'outline',
};

// Match a single-property static hex style on one JSX element.
// Captures:
//   1 — CSS property name
//   2 — hex value (3, 4, 6, or 8 hex digits)
// Anchored to the whole `style={{ ... }}` expression so we don't
// accidentally rewrite a complex multi-prop style.
const STYLE_RE = /style\s*=\s*\{\{\s*(\w+)\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]\s*\}\}/g;

// Find the className attribute (if any) on the same element. JSX
// attributes are independent of order, so we have to scan within the
// enclosing tag. Since proper tag-boundary parsing is needed to find
// className, we'll use the same approach as the div-button codemod:
// find each `style={{...}}` match, then walk left to find the `<`
// that starts the tag, then walk right to find the tag's `>`. Within
// that tag, look for a `className=` attribute and either append the
// new class or insert a new attribute.

function findTagBounds(src, styleIdx) {
  // Walk left from styleIdx to find the opening `<`.
  let lt = styleIdx;
  while (lt > 0 && src[lt] !== '<') {
    lt--;
    // Sanity: don't cross a `>` (we'd be outside the tag).
    if (src[lt] === '>') return null;
  }
  if (src[lt] !== '<') return null;
  // Walk right from styleIdx to find the tag's terminating `>`,
  // tracking brace/string nesting (same as the div-button codemod).
  let i = styleIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '>') return { lt, gt: i };
    if (c === '/' && src[i + 1] === '>') return { lt, gt: i + 1 };
    if (c === '"' || c === "'") {
      i++; while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; continue;
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
      i++; let depth = 1;
      while (i < n && depth > 0) {
        const cc = src[i];
        if (cc === '"' || cc === "'") { i++; while (i < n && src[i] !== cc) { if (src[i] === '\\') i++; i++; } i++; continue; }
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
  return null;
}

// Insert a class into an existing `className="..."` attribute, or add
// a new `className="..."` attribute to the tag. Returns the modified
// tag content + a flag indicating whether the change was applied.
function appendClassToTag(tag, newClass) {
  // String form: className="..." or className={'...'} or className={`...`}
  const stringMatch = tag.match(/className\s*=\s*(["'`])([^"'`]*?)\1/);
  if (stringMatch) {
    const quote = stringMatch[1];
    const existing = stringMatch[2];
    const replaced = `className=${quote}${existing}${existing.length > 0 ? ' ' : ''}${newClass}${quote}`;
    return tag.replace(stringMatch[0], replaced);
  }
  // Expression form: className={cn(...)} or className={someVar}. We
  // wrap with `${someVar} newClass` only if it's a simple cn() call.
  const cnMatch = tag.match(/className\s*=\s*\{cn\s*\(([\s\S]*?)\)\s*\}/);
  if (cnMatch) {
    const args = cnMatch[1];
    const replaced = `className={cn(${args}, ${JSON.stringify(newClass)})}`;
    return tag.replace(cnMatch[0], replaced);
  }
  // No safe append target — insert a new className just before the
  // closing `>` (or `/>`).
  const selfClose = tag.endsWith('/>');
  const insertAt = selfClose ? tag.length - 2 : tag.length - 1;
  return tag.slice(0, insertAt).replace(/\s*$/, '') + ` className=${JSON.stringify(newClass)}` + (selfClose ? ' />' : '>');
}

// Process one file. Patches back-to-front to keep offsets valid.
function processFile(src) {
  const sites = [];
  for (const m of src.matchAll(STYLE_RE)) {
    const prop = m[1];
    const hex = m[2];
    const twPrefix = PROP_MAP[prop];
    if (!twPrefix) continue;
    sites.push({ idx: m.index, len: m[0].length, prop, hex, twPrefix });
  }
  if (sites.length === 0) return { src, count: 0 };
  // back-to-front
  sites.sort((a, b) => b.idx - a.idx);
  let out = src;
  let count = 0;
  for (const s of sites) {
    const bounds = findTagBounds(out, s.idx);
    if (!bounds) continue;
    const tag = out.slice(bounds.lt, bounds.gt + 1);
    // Remove the style attribute from the tag (re-locate within tag).
    const idxInTag = s.idx - bounds.lt;
    const styleMatch = tag.slice(idxInTag).match(/^style\s*=\s*\{\{[^}]*\}\}/);
    if (!styleMatch) continue;
    const styleStr = styleMatch[0];
    const withoutStyle = tag.slice(0, idxInTag) + tag.slice(idxInTag + styleStr.length).replace(/^\s+/, ' ');
    // Append the Tailwind class.
    const newClass = `${s.twPrefix}-[${s.hex}]`;
    const newTag = appendClassToTag(withoutStyle.replace(/\s+>/g, '>').replace(/\s+\/>/g, ' />'), newClass);
    out = out.slice(0, bounds.lt) + newTag + out.slice(bounds.gt + 1);
    count++;
  }
  return { src: out, count };
}

// ---- 3. Run ----

let totalPatched = 0;
let filesPatched = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  if (!STYLE_RE.test(original)) continue;
  STYLE_RE.lastIndex = 0;
  const { src: mutated, count } = processFile(original);
  if (count === 0) continue;
  if (!DRY_RUN) fs.writeFileSync(file, mutated);
  totalPatched += count;
  filesPatched++;
}

console.error(`\nFiles patched: ${filesPatched}${DRY_RUN ? ' (dry-run)' : ''}`);
console.error(`Total inline-hex instances converted: ${totalPatched}`);
if (!DRY_RUN) {
  console.error(`\nNext: re-run 'node scripts/grade-ux-polish.mjs' to verify the lift.`);
}
