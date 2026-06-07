#!/usr/bin/env node
// scripts/check-depth-tests.mjs
//
// THE HONESTY GUARD for the depth multiplier. The grader credits a macro from
// the literal `lensRun("d","a")` text alone — it cannot see assertion quality.
// So a scaffold full of `assert.ok(r.ok)` would credit thousands of macros while
// asserting nothing (shape-only = exactly what --honest discounts). This check
// makes that impossible to merge:
//
//   1. No `@depth-todo` / `it.todo` / `.todo(` markers survive — a scaffold must
//      be COMPLETED, not committed half-done.
//   2. Every `it()` carries a SUBSTANTIVE assertion (exact value, round-trip
//      find, or rejection) — not merely `assert.equal(r.ok, true)` / typeof-object.
//
// `--ci` exits 1 on any violation. Wire into CI so the floor can only climb on
// real behavioral evidence.
//   node scripts/check-depth-tests.mjs        # report
//   node scripts/check-depth-tests.mjs --ci   # gate

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CI = process.argv.includes("--ci");
const DEPTH_DIR = path.join(ROOT, "server", "tests", "depth");

// Walk an `it(` / `test(` call from its open paren to the matching close,
// skipping strings/templates/line+block comments. Returns the call text.
function callText(src, openIdx) {
  let i = openIdx, depth = 0; const n = src.length;
  for (; i < n; i++) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c) { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "`") { i++; while (i < n && src[i] !== "`") { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}

// Strip comments (string/template-aware) so commented-out example assertions —
// e.g. the scaffold's `// assert.equal(r.result.X, …)` — can't be mistaken for
// real ones. Without this, a shape-only test could fake "substantive" with a
// comment.
function stripComments(s) {
  let out = "", i = 0; const n = s.length; let q = null;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (q) { out += c; if (c === "\\") { out += d ?? ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < n && s[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// A test body is "substantive" if it asserts something beyond shape: a result
// FIELD other than `ok`, a round-trip search, a structural/value comparison, or
// an explicit rejection. Bare `assert.equal(r.ok, true)` / typeof-object do NOT
// count (that's what the smoke harness already does).
function isSubstantive(body) {
  if (/\.result\.(?!ok\b)[a-zA-Z_]\w*/.test(body)) return true;          // reads a real result field (lens-family)
  if (/assert\.(match|deepEqual|deepStrictEqual|notEqual|notStrictEqual)\s*\(/.test(body)) return true;
  if (/\.(some|find|filter|includes)\s*\(/.test(body)) return true;       // round-trip / membership
  if (/result\.ok\s*,\s*false|result\.ok\s*===\s*false/.test(body)) return true; // rejection (lens-family)
  // register()-family macros (macroRuntime path) return the result DIRECTLY — no
  // `.result` wrapper — so a real assertion reads `r.<field>` not `r.result.<field>`.
  // Credit an exact-value assertion on a direct field other than `ok`
  // (assert.equal(r.bountyCents, 600); assert.equal(tally.total, 1)), a comparison
  // (assert.ok(last.affinity >= 0.85)), or a rejection reason
  // (assert.equal(r.reason, "no_courtship")). The (?!typeof)(?!Array\.) guards keep
  // bare typeof/Array.isArray shape-checks from sneaking through.
  if (/assert\.(?:equal|strictEqual)\s*\(\s*(?!typeof\b)(?!Array\.)\w+(?:\.\w+)*\.(?!ok\b)\w+\s*,/.test(body)) return true;
  if (/assert\.ok\s*\(\s*(?!typeof\b)(?!Array\.)\w+(?:\.\w+)*\.(?!ok\b)\w+\s*(?:>=|<=|===|!==|<|>|&&|\))/.test(body)) return true;
  if (/assert\.\w+\s*\(\s*\w+(?:\.\w+)*\.reason\b/.test(body)) return true; // rejection by reason (register-family)
  return false;
}

const files = (() => {
  try { return readdirSync(DEPTH_DIR).filter((f) => /-behavior\.test\.js$/.test(f)); }
  catch { return []; }
})();

const problems = [];
let itCount = 0;
for (const f of files) {
  const rel = path.join("server", "tests", "depth", f);
  const src = readFileSync(path.join(DEPTH_DIR, f), "utf8");
  if (/@depth-todo|\bit\.todo\b|\btest\.todo\b|\.todo\s*\(/.test(src)) {
    problems.push(`${rel}: contains an unfinished scaffold marker (@depth-todo / it.todo) — complete it before merge.`);
  }
  // each it("name", … ) / it("name", {opts}, …)
  const re = /\b(?:it|test)\s*\(/g;
  let m;
  while ((m = re.exec(src)) != null) {
    const open = m.index + m[0].length - 1;
    const body = stripComments(callText(src, open));
    itCount++;
    const nameMatch = /^\(\s*["'`]([^"'`]+)["'`]/.exec(body);
    const name = nameMatch ? nameMatch[1] : "(anonymous)";
    if (!isSubstantive(body)) {
      problems.push(`${rel}: it("${name.slice(0, 60)}") has no substantive assertion (shape-only). Assert a result field / round-trip / rejection.`);
    }
  }
}

if (problems.length === 0) {
  console.log(`depth-tests: OK — ${itCount} behavioral test(s) across ${files.length} domain file(s); all carry real assertions.`);
  process.exit(0);
}
console.log(`depth-tests: ${problems.length} issue(s) across ${files.length} file(s):\n`);
for (const p of problems.slice(0, 60)) console.log("  ✗ " + p);
if (problems.length > 60) console.log(`  …and ${problems.length - 60} more`);
console.log(`\nThe depth multiplier only counts REAL behavioral assertions — see server/tests/depth/README.md.`);
if (CI) process.exit(1);
process.exit(0);
