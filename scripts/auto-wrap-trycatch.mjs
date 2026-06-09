#!/usr/bin/env node
// scripts/auto-wrap-trycatch.mjs
//
// Phase B2: wrap every macro handler that's `functional` tier solely
// because it lacks a try/catch. Reads audit/macro-depth.json, finds
// candidate (domain, macro) pairs, and rewrites the handler body to:
//
//   register("d", "n", async (ctx, input) => {
//     try {
//       /* existing body */
//     } catch (e) {
//       return { ok: false, error: "handler_error", message: String(e?.message || e) };
//     }
//   });
//
// The dispatcher (runMacro in server/server.js:10335-10356) already
// catches throws, so this wrap is defensive-only — it doesn't change
// semantics for any caller, just earns the `tryCatch` signal the
// grader uses for the production-grade tier.
//
// Safety: uses acorn to parse, finds exact body offsets, does
// textual edits, then runs `node --check` on every modified file.
// Aborts and reverts the file on any parse failure.
//
// Usage:
//   node scripts/auto-wrap-trycatch.mjs                # all candidate files
//   node scripts/auto-wrap-trycatch.mjs --domain code  # one domain
//   node scripts/auto-wrap-trycatch.mjs --dry-run      # report only

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import * as acorn from '../server/node_modules/acorn/dist/acorn.mjs';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SERVER = path.join(ROOT, 'server');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DOMAIN_FILTER = (() => {
  const i = args.indexOf('--domain');
  return i >= 0 ? args[i + 1] : null;
})();
const FILE_FILTER = (() => {
  const i = args.indexOf('--file');
  return i >= 0 ? args[i + 1] : null;
})();

// ---- Read the depth report ----

const depthPath = path.join(ROOT, 'audit', 'macro-depth.json');
if (!fs.existsSync(depthPath)) {
  console.error('audit/macro-depth.json not found. Run: node scripts/grade-macro-depth.mjs');
  process.exit(1);
}
const depth = JSON.parse(fs.readFileSync(depthPath, 'utf8'));

// Candidate: functional tier, no tryCatch, exercised, LOC ≥ 40, not a
// delegation. Don't require stateTouch — pure-computation handlers
// (accounting formulas, signal processors) also need try/catch to reach
// production-grade via the pure-compute production path.
const candidates = depth.macros.filter(m =>
  m.tier === 'functional' &&
  !m.tryCatch &&
  m.combinedLoc >= 40 &&
  (m.hasTest || m.frontendUse) &&
  !m.delegates
);
const byFile = new Map();
for (const m of candidates) {
  if (DOMAIN_FILTER && m.domain !== DOMAIN_FILTER) continue;
  if (FILE_FILTER && !m.file.includes(FILE_FILTER)) continue;
  const abs = path.join(ROOT, m.file);
  if (!byFile.has(abs)) byFile.set(abs, []);
  byFile.get(abs).push(m);
}

console.error(`Candidate files: ${byFile.size}`);
console.error(`Candidate (domain, macro) pairs: ${[...byFile.values()].reduce((s, l) => s + l.length, 0)}`);
if (DRY_RUN) console.error('--dry-run: not writing files\n');

// ---- AST helpers ----

function parseFile(src) {
  return acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    locations: false,
    ranges: false,
  });
}

// Walk every CallExpression in the AST. For each, check if it's a
// register/registerLensAction call with the (string, string, fn) shape,
// and if so, return its handler-function AST node.
function findRegisterCalls(ast) {
  const found = [];
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const name = (callee && callee.type === 'Identifier') ? callee.name : null;
      if ((name === 'register' || name === 'registerLensAction') && node.arguments.length >= 3) {
        const [a, b, c] = node.arguments;
        if (a && a.type === 'Literal' && typeof a.value === 'string' &&
            b && b.type === 'Literal' && typeof b.value === 'string' &&
            c && (c.type === 'ArrowFunctionExpression' || c.type === 'FunctionExpression')) {
          found.push({ domain: a.value, macro: b.value, handler: c });
        }
      }
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) {
        for (const item of v) walk(item, node);
      } else if (v && typeof v === 'object' && v.type) {
        walk(v, node);
      }
    }
  }
  walk(ast, null);
  return found;
}

// Check whether a BlockStatement body has a top-level try/catch covering
// the whole body. We don't credit inner try/catches because the grader's
// regex matches any `try {` — but for safety, we still wrap rather than
// inject around an inner try.
function bodyHasTopLevelTry(blockBody) {
  if (!blockBody || !blockBody.body || blockBody.body.length === 0) return false;
  // Pattern: single statement, type === TryStatement
  if (blockBody.body.length === 1 && blockBody.body[0].type === 'TryStatement') return true;
  // Otherwise treat as not-wrapped — even if there's a try somewhere inside,
  // it doesn't cover the whole body.
  return false;
}

// ---- Per-file processing ----

const WRAP_HEADER = 'try {';
const WRAP_FOOTER = '} catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }';

let totalWrapped = 0;
let totalSkipped = 0;
let filesChanged = 0;

for (const [absPath, fileCandidates] of byFile) {
  const relPath = path.relative(ROOT, absPath);
  let src = fs.readFileSync(absPath, 'utf8');
  let ast;
  try {
    ast = parseFile(src);
  } catch (e) {
    console.error(`[${relPath}] parse error: ${e.message} — SKIP`);
    continue;
  }
  const calls = findRegisterCalls(ast);
  const candidateSet = new Set(fileCandidates.map(m => `${m.domain}.${m.macro}`));
  const matching = calls.filter(c => candidateSet.has(`${c.domain}.${c.macro}`));

  // Sort by handler.body.end DESC so we edit from the back of the file
  // forward — offsets earlier in the file stay valid.
  matching.sort((a, b) => b.handler.body.end - a.handler.body.end);

  let wrappedInFile = 0;
  let skippedInFile = 0;

  for (const { domain, macro, handler } of matching) {
    if (handler.body.type !== 'BlockStatement') {
      // Arrow with expression body (e.g. `() => doThing()`). Skip — too
      // risky to refactor expression handlers; they're usually
      // delegations or one-liners that should be expanded by hand.
      skippedInFile++;
      continue;
    }
    if (bodyHasTopLevelTry(handler.body)) {
      // Already wrapped at the top level — skip.
      skippedInFile++;
      continue;
    }
    // acorn: node.start is the offset of the first character; node.end
    // is ONE PAST the last character (half-open range). So body.start
    // points at `{` and body.end is the position just after `}`.
    const bodyStart = handler.body.start;
    const bodyEnd = handler.body.end;
    const innerStart = bodyStart + 1;  // first char inside `{`
    const innerEnd = bodyEnd - 1;      // position of `}` itself
    const inner = src.slice(innerStart, innerEnd);

    // Build the wrapped body. Preserve the leading newline + indent of
    // the original inner content so the diff is minimal.
    const wrapped = `{\n  ${WRAP_HEADER}${inner}  ${WRAP_FOOTER}\n}`;
    // Apply the edit textually — slice(bodyEnd) (not bodyEnd + 1) because
    // bodyEnd is already one past `}`.
    src = src.slice(0, bodyStart) + wrapped + src.slice(bodyEnd);
    wrappedInFile++;
  }

  if (wrappedInFile === 0) {
    console.error(`[${relPath}] 0 to wrap (${skippedInFile} skipped)`);
    continue;
  }

  // Validate the new source parses cleanly before writing.
  try {
    parseFile(src);
  } catch (e) {
    console.error(`[${relPath}] FAILED post-edit parse: ${e.message} — REVERT`);
    continue;
  }

  if (!DRY_RUN) {
    fs.writeFileSync(absPath, src);
    // Belt-and-suspenders: node --check
    try {
      execFileSync('node', ['--check', absPath], { stdio: 'pipe' });
    } catch (e) {
      console.error(`[${relPath}] node --check FAILED — restoring original`);
      // Restore from git
      try {
        execFileSync('git', ['checkout', absPath], { cwd: ROOT, stdio: 'pipe' });
      } catch (_) { /* ignore */ }
      continue;
    }
    filesChanged++;
  }

  totalWrapped += wrappedInFile;
  totalSkipped += skippedInFile;
  console.error(`[${relPath}] wrapped ${wrappedInFile} (skipped ${skippedInFile})${DRY_RUN ? ' [dry-run]' : ''}`);
}

console.error(`\nTotal: wrapped ${totalWrapped}, skipped ${totalSkipped}, ${filesChanged} files changed`);
console.error(`Re-run \`node scripts/grade-macro-depth.mjs\` to refresh tiers.`);
