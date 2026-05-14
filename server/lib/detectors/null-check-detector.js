// server/lib/detectors/null-check-detector.js
//
// 404-class bug detector — catches DB query results that are used without
// a null-check. The single highest-frequency pattern that turns a missing
// row into a 500 (`Cannot read properties of null`) instead of a clean
// 404.
//
// Pattern matched (the obvious + load-bearing one):
//
//   const row = db.prepare("SELECT … WHERE id = ?").get(id);
//   return row.something;                  // ← unguarded property access
//
// Safe shapes the detector recognises and SKIPS:
//
//   const row = db.prepare(…).get(id);
//   if (!row) return res.status(404)…;     // explicit null-check
//   if (row == null) return …;
//   if (row && row.x)                      // truthy-guard
//   row?.something                          // optional-chain on the use
//   const arr = db.prepare(…).all(…);      // .all() returns an array,
//                                          // arrays are never null
//
// Severity:
//   medium — query result used 1-N lines later with no guard between.
//   low    — query result used inside a try { } that probably catches
//            the throw (but the route returns a generic 500 not a 404).
//
// Operator opt-out:
//   `// @null-check-ok: <reason>` on the same line OR up to 3 lines
//   above the .get() call. Used for queries that are KNOWN to always
//   return a row (singleton tables, INSERT-OR-IGNORE then SELECT, etc.).
//
// Fix template (registered in lib/autofix/null-check.js):
//   Insert `if (!row) return res.status(404).json({ ok: false, error: "<resource>_not_found" });`
//   between the .get() and the first property access. The autofix is
//   medium-risk: it changes the response shape and adds an early return,
//   so the repair-cortex applies it as a suggestion rather than landing
//   it directly.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "null-check";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

// We scan only the paths where a missing null-check actually surfaces as
// an HTTP 500. Heartbeats and emergent cycles fail silently / retry on
// next tick, so the same pattern is lower-stakes there.
const SCAN_PATHS = ["server/routes", "server/lib", "server/domains", "server/economy"];

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", "tests", "__tests__"]);
const ANNOTATION_OK_RE = /@null-check-ok\b/;

// Anchor on the BEGINNING of a `const|let|var <name> = ` assignment.
// The body of the assignment is then extracted by walking forward to
// the matching semicolon (or end-of-statement), and we only flag when
// that single-statement body contains BOTH `db.prepare(` (or
// `stmts.<name>`) AND `.get(`. Splitting into two checks prevents the
// `const r = db.prepare(...).run(...)` … `.get(` cross-statement
// false-match that one combined regex was producing.
const ASSIGN_RE = /(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*/g;

// SELECT bodies that ALWAYS return a row — aggregate queries, COUNT,
// EXISTS. Skip null-check requirement when matched.
const AGGREGATE_SQL_RE = /\bSELECT\s+[^;`'"]*\b(?:COUNT|AVG|SUM|MIN|MAX|EXISTS)\s*\(/i;

// `findById` / `findOne` / `getById` / `getOne` ORM-style helpers. Plain
// `.get(` is NOT in this list — `Map.get`, `Set.get`, etc. would
// otherwise overwhelm the report. Plain DB `.get(...)` is captured by
// the assignment-body check (requires `.prepare(` ahead of it on the
// same statement).
const FIND_BY_OP_RE = /(?:findById|findOne|getById|getOne)\s*\(/;

function isInteresting(file) {
  return /\.(js|mjs)$/.test(file);
}

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile() && isInteresting(entry.name)) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  if (!SCAN_PATHS.some(p => rel.startsWith(p + "/"))) return false;
  // Skip code-gen template files — TODO markers + database calls live
  // inside backtick template strings and would self-flag.
  if (/forge-template-(engine|generator)/.test(rel)) return false;
  // Skip test files — assertions there are the test fixture, not the
  // production bug surface.
  if (/\.test\.(js|mjs)$|\/tests?\//.test(rel)) return false;
  return true;
}

/**
 * Decide whether a `.get()` result is guarded before its first property
 * access. Returns { guarded: boolean, firstUseLine?: number }.
 *
 * Heuristics:
 *   - explicit null-check: `if (!name)` / `if (name == null)` / `if (!name || …)`
 *   - early-return guard: `if (!name) return …;` even tighter signal
 *   - optional chain at first use: `name?.field` → safe
 *   - assignment that throws on missing: `const { x } = name` → bug (we flag)
 */
function isGuarded(content, name, fromIdx) {
  // Brace-bounded forward scan: from the `.get()` callsite, walk forward
  // through the SAME function body only, stopping when the enclosing
  // function's closing `}` is reached. Prevents `const row` in
  // getTransaction() from being "used unsafely" by `row.x` inside the
  // sibling parseRow() function.
  let depth = 0;
  let endIdx = fromIdx;
  for (let i = fromIdx; i < Math.min(content.length, fromIdx + 4000); i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      if (depth === 0) { endIdx = i; break; }
      depth--;
    }
  }
  if (endIdx === fromIdx) endIdx = Math.min(content.length, fromIdx + 600);
  const window = content.slice(fromIdx, endIdx);

  // Strong "the developer knows it's nullable" signal: the variable is
  // used with optional-chaining (`name?.`) ANYWHERE in its scope, OR
  // appears in a ternary test position (`name ? … : …`). Either means
  // the nullable case was consciously handled — not a missing-guard bug.
  if (new RegExp("\\b" + name + "\\?\\.").test(window)) return { guarded: true };
  if (new RegExp("\\b" + name + "\\s*\\?[^?:]*:").test(window)) return { guarded: true };
  // Look for guard first — any of these forms within the window before
  // a non-optional property access counts. Includes:
  //   if (!name)                     negative-check guard
  //   if (name == null) / === null   explicit null compare
  //   if (!name || …)                early-return chain
  //   if (name && …)                 truthy short-circuit
  //   if (name) { …name.x… }         positive bare check (use is inside the block)
  //   if (name)return …              one-line positive
  //   name ? name.x : default        ternary truthy
  //   !!name && name.x               double-bang short-circuit
  //   name && name.x                 ampersand short-circuit
  const guardRe = new RegExp(
    "\\bif\\s*\\(\\s*!\\s*" + name + "\\b" +
    "|\\bif\\s*\\(\\s*" + name + "\\s*==\\s*null\\b" +
    "|\\bif\\s*\\(\\s*" + name + "\\s*===\\s*null\\b" +
    "|\\bif\\s*\\(\\s*!" + name + "\\s*\\|\\|" +
    // `if (!other || !name)` — name as the 2nd+ operand of an OR-guard
    "|\\|\\|\\s*!" + name + "\\b" +
    "|\\bif\\s*\\(\\s*" + name + "\\s*&&" +
    "|\\bif\\s*\\(\\s*" + name + "\\s*\\)" +
    // `if (name?.field)` — optional-chain truthy check on a property
    "|\\bif\\s*\\(\\s*" + name + "\\?\\." +
    "|!!" + name + "\\s*&&" +
    // `name && name.x` OR `name && (name.x` — same guard intent, the
    // paren version is common when there are multiple .x checks ORed.
    "|\\b" + name + "\\s*&&\\s*\\(?\\s*" + name + "\\." +
    "|\\b" + name + "\\s*\\?\\s*\\(?\\s*" + name + "\\." +
    // `return name ? <anything>(name) : <anything>` — passes through to a parser
    "|return\\s+" + name + "\\s*\\?\\s*\\w+\\s*\\(" + name + "\\s*\\)"
  );
  const guardMatch = guardRe.exec(window);
  // Look for unguarded property access: `name.x`, `name[y]`, or destructure
  // `{ x } = name` — but NOT `name?.x`.
  const unsafeRe = new RegExp(
    "(?<!\\?\\.)\\b" + name + "(?:\\.[a-zA-Z_$]|\\[)" +
    "|\\}\\s*=\\s*" + name + "(?!\\s*\\?)"
  );
  // Find the FIRST unsafe use after the assignment.
  const unsafeMatch = unsafeRe.exec(window);
  if (!unsafeMatch) return { guarded: true };
  // If a guard appears BEFORE the unsafe use, we're fine.
  if (guardMatch && guardMatch.index < unsafeMatch.index) return { guarded: true };
  // Optional chain on the use itself? Already excluded by the regex's
  // negative lookbehind for `?.` — so reaching here means real-unsafe.
  return { guarded: false, firstUseOffset: unsafeMatch.index };
}

export async function runNullCheckDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  try {
    for await (const rel of walk(repoRoot)) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;

      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      // File-level operator opt-out — same as fake-data's @fake-data-ok-file.
      if (/@null-check-ok-file\b/.test(content)) continue;

      const lines = content.split("\n");

      // Walk each `(const|let|var) <name> = <rhs>;` assignment. Extract
      // the RHS body (bounded to the same statement by walking forward
      // to the matching `;` at depth-0). Then check whether the RHS is
      // a single-statement DB call we care about.
      const assignRe = new RegExp(ASSIGN_RE.source, "g");
      let am;
      while ((am = assignRe.exec(content)) !== null) {
        if (findings.length >= findingCap) break;
        const name = am[1];
        if (!name || name === "_" || name.startsWith("_")) continue;
        const eqIdx = am.index + am[0].length;
        // Extract single-statement RHS: walk forward to `;` at paren/brace depth 0.
        let depthP = 0, depthC = 0;
        let endStmt = eqIdx;
        for (let i = eqIdx; i < Math.min(content.length, eqIdx + 4000); i++) {
          const ch = content[i];
          if (ch === "(" || ch === "[" || ch === "{") depthP++;
          else if (ch === ")" || ch === "]" || ch === "}") depthP = Math.max(0, depthP - 1);
          else if (ch === ";" && depthP === 0 && depthC === 0) { endStmt = i; break; }
        }
        if (endStmt === eqIdx) continue;
        const rhs = content.slice(eqIdx, endStmt);

        // If the RHS contains an arrow function or `function` keyword,
        // the captured variable is the CLOSURE result (e.g. a `.map()`
        // / `.filter()` collection), not a raw DB row — any `.get()`
        // inside is on a DIFFERENT, closure-local variable. Skip;
        // the inner variable gets its own assignment scan.
        if (/=>|\bfunction\b/.test(rhs)) continue;

        // Decide if this is a DB-style query we should null-check.
        let opCalled = null;
        const hasPrepare = /(?:db\.prepare|prepare|stmts\.\w+)\s*\(/.test(rhs);
        const hasGetCall = /\)\s*\.\s*get\s*\(/.test(rhs);
        const hasFindBy = FIND_BY_OP_RE.test(rhs);
        if (hasPrepare && hasGetCall) opCalled = "db.prepare(...).get()";
        else if (hasFindBy && !hasPrepare) opCalled = "findById/findOne/getOne";
        else continue;

        // If the get-result is consumed INLINE — optional-chained
        // (`.get(…)?.x`), defaulted (`.get(…) || …`, `.get(…) ?? …`),
        // or fed straight into another call (`JSON.parse(.get(…)…)`) —
        // then the captured variable holds the POST-PROCESSED value, not
        // the raw row. The nullable row was already handled inline; the
        // variable itself isn't the thing to null-check.
        if (/\)\s*\.\s*get\s*\([^;]*\)\s*\?\./.test(rhs)) continue;       // .get(…)?.
        if (/\)\s*\.\s*get\s*\([^;]*\)\s*(?:\|\||\?\?)/.test(rhs)) continue; // .get(…) || / ??

        // Skip aggregate SQL (COUNT/AVG/SUM/MIN/MAX/EXISTS) — those
        // ALWAYS return one row.
        if (opCalled === "db.prepare(...).get()" && AGGREGATE_SQL_RE.test(rhs)) continue;

        const lineNum = content.slice(0, am.index).split("\n").length;
        // Annotation opt-out: same line or up to 3 lines above.
        let exempted = false;
        for (let j = Math.max(0, lineNum - 4); j <= lineNum; j++) {
          if (ANNOTATION_OK_RE.test(lines[j - 1] || "")) { exempted = true; break; }
        }
        if (exempted) continue;

        // Guard scan starts AFTER the statement-ending `;`.
        const guardScanFromIdx = endStmt + 1;
        const { guarded, firstUseOffset } = isGuarded(content, name, guardScanFromIdx);
        if (guarded) continue;

        const useLine =
          firstUseOffset != null
            ? content.slice(0, guardScanFromIdx + firstUseOffset).split("\n").length
            : lineNum;
        findings.push({
          id: "null_check_missing",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Query result \`${name}\` from ${opCalled} used at line ${useLine} without null-check — missing row will 500 with "Cannot read properties of null" instead of returning 404.`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "null_check", file: rel, variable: name, opCalled },
          fixHint: "insert_null_check_404",
        });
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
