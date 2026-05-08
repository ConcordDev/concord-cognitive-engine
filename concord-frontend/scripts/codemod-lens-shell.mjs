#!/usr/bin/env node
/**
 * codemod-lens-shell.mjs — bulk-wrap every app/lenses/<id>/page.tsx with
 * <LensShell lensId="<id>" asMain={false}> ... </LensShell>.
 *
 * Skips files that already mount <LensShell>. Conservative: only edits
 * pages whose main `export default function` body has a single
 * top-level `return (` ... `);` block at indent level 2.
 *
 * Run from concord-frontend/:
 *   node scripts/codemod-lens-shell.mjs           # apply
 *   node scripts/codemod-lens-shell.mjs --dry     # preview
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FRONTEND = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const LENSES = path.join(FRONTEND, 'app', 'lenses');

function findExportDefault(src) {
  const m = src.match(/^export default function\s+\w+/m);
  if (!m) return -1;
  return m.index;
}

function findMainReturn(src, fromIndex) {
  // First `  return (` at exactly indent 2 after the export default.
  const slice = src.slice(fromIndex);
  const re = /^  return \(\s*$/m;
  const m = slice.match(re);
  if (!m) return -1;
  return fromIndex + m.index;
}

function findMatchingClose(src, fromIndex) {
  // Match `^  );` at the same indent 2 by tracking paren balance.
  let depth = 0;
  let i = src.indexOf('(', fromIndex);
  if (i === -1) return -1;
  depth = 1;
  i += 1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        // Now expect `^  );` — verify line shape.
        const lineStart = src.lastIndexOf('\n', i) + 1;
        const lineEnd = src.indexOf('\n', i);
        const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
        if (line === '  );') return { closeParen: i, lineStart };
        return -1;
      }
    }
  }
  return -1;
}

function ensureLensShellImport(src) {
  if (src.includes("from '@/components/lens/LensShell'")) return src;
  // Insert after the first `import` line.
  const m = src.match(/^import .+;\s*$/m);
  if (!m) return src;
  const insertAt = m.index + m[0].length;
  return (
    src.slice(0, insertAt) +
    "\nimport { LensShell } from '@/components/lens/LensShell';" +
    src.slice(insertAt)
  );
}

async function processFile(file, lensId) {
  let src = await readFile(file, 'utf8');
  if (src.includes('<LensShell')) return { file, skipped: 'already-wrapped' };
  const expIdx = findExportDefault(src);
  if (expIdx === -1) return { file, skipped: 'no-default-export' };
  const retIdx = findMainReturn(src, expIdx);
  if (retIdx === -1) return { file, skipped: 'no-main-return' };
  const closeInfo = findMatchingClose(src, retIdx);
  if (closeInfo === -1) return { file, skipped: 'no-matching-close' };

  // Insert LensShell open after `  return (\n` and close before `  );`.
  const openInsertAt = src.indexOf('\n', retIdx) + 1;
  const openLine = `    <LensShell lensId="${lensId}" asMain={false}>\n`;
  src = src.slice(0, openInsertAt) + openLine + src.slice(openInsertAt);

  // Recompute close position because insertion shifted indices.
  // Re-find: walk from retIdx forward through paren-balance again.
  const newCloseInfo = findMatchingClose(src, retIdx);
  if (newCloseInfo === -1) return { file, skipped: 'close-shift-error' };
  const closeLine = `    </LensShell>\n`;
  src = src.slice(0, newCloseInfo.lineStart) + closeLine + src.slice(newCloseInfo.lineStart);

  src = ensureLensShellImport(src);

  if (!DRY) await writeFile(file, src, 'utf8');
  return { file, applied: true };
}

async function main() {
  const lensDirs = (await readdir(LENSES, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('.'))
    .map((d) => d.name);

  const results = { applied: [], skipped: {}, errors: [] };
  for (const id of lensDirs) {
    const file = path.join(LENSES, id, 'page.tsx');
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    try {
      const r = await processFile(file, id);
      if (r.applied) results.applied.push(id);
      else if (r.skipped) {
        results.skipped[r.skipped] = (results.skipped[r.skipped] || 0) + 1;
        if (r.skipped !== 'already-wrapped') results.errors.push({ id, reason: r.skipped });
      }
    } catch (e) {
      results.errors.push({ id, reason: String(e?.message || e) });
    }
  }

  console.log(`\n${DRY ? 'DRY RUN — ' : ''}lens-shell codemod`);
  console.log(`  applied: ${results.applied.length}`);
  console.log(`  skipped:`, results.skipped);
  if (results.errors.length) {
    console.log(`  unapplied (${results.errors.length}):`);
    for (const e of results.errors.slice(0, 30)) console.log(`    - ${e.id}: ${e.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
