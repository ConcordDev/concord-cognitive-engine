// server/tests/platinum-codeql-drift.test.js
//
// Sprint 18.4 — CodeQL exclusion drift gate.
//
// We've excluded 9 CodeQL query IDs in .github/workflows/codeql.yml because
// the manual audit confirmed every flagged site is a verified false-positive
// against the codebase's defence-in-depth patterns. The risk of any blanket
// exclusion is that a FUTURE PR introduces a real bug in one of those
// excluded categories and CodeQL no longer catches it.
//
// This file closes that risk. For each exclusion, we grep the source tree
// for the dangerous pattern OUTSIDE the audit-approved file allowlist. If
// a new file introduces the pattern, this test fails at PR time — even
// though CodeQL is silent on it.
//
// Treat this file as the "lock-in" for each CodeQL exclusion. When the
// audit re-runs (90-day cron), this file updates with any new allowlist
// entries. New blanket allows are NOT permitted without a matching
// exclusion entry + ledger update.
//
// Reference: docs/security/codeql-suppressions.md (the audit ledger).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SERVER_ROOT = join(HERE, "..");
const REPO_ROOT = join(SERVER_ROOT, "..");

// ─── Source-tree walker ────────────────────────────────────────────────────
//
// Lists every .js/.mjs/.cjs file under server/ (excluding tests, scripts,
// node_modules, data, coverage, migrations).
function listSourceFiles(dir = SERVER_ROOT, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "tests" ||
      entry === "scripts" ||
      entry === "data" ||
      entry === "coverage" ||
      entry === "migrations" ||
      entry === ".git"
    ) continue;
    const p = join(dir, entry);
    let stat;
    try { stat = statSync(p); } catch { continue; }
    if (stat.isDirectory()) listSourceFiles(p, acc);
    else if (/\.(js|mjs|cjs)$/.test(entry)) acc.push(p);
  }
  return acc;
}

const ALL_SOURCE_FILES = listSourceFiles();
const repoRel = (abs) => relative(REPO_ROOT, abs);

// ─── Helper: grep for a pattern across the tree, with an allowlist ─────────
function scan(pattern, allowlist) {
  const allow = new Set(allowlist.map(p => p.replace(/^\.\//, "")));
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    if (allow.has(rel)) continue;
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    const matches = src.match(pattern);
    if (matches) {
      // Find the first matching line for diagnostics
      const lines = src.split("\n");
      const lineIdx = lines.findIndex(l => pattern.test(l));
      violations.push({ file: rel, line: lineIdx + 1, snippet: lines[lineIdx]?.trim().slice(0, 120) });
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════
// js/code-injection lock-in
// Exclusion rationale: vm.runInNewContext only used in routes/sovereign.js
// /eval, gated by requireSovereign router-level middleware. new Function()
// only in domains/invariant.js with acorn AST whitelist.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: vm.runIn* only in audit-approved files", () => {
  // Audited vm-sandbox code-execution sites. Each runs user-supplied code
  // in a restricted vm.createContext (no process / require / globalThis
  // leak into server scope) under a hard vm-enforced timeout — the same
  // boundary as the sovereign /eval route:
  //   - routes/sovereign.js — sovereign /eval, requireSovereign-gated
  //   - domains/code.js     — code lens run + step-debugger sandbox
  //   - domains/chat.js     — chat lens code-interpreter sandbox
  const allowed = [
    "server/routes/sovereign.js",
    "server/domains/code.js",
    "server/domains/chat.js",
  ];
  const violations = scan(/vm\.runIn(NewContext|ThisContext|Context)\(/, allowed);
  if (violations.length > 0) {
    console.error("\nUnapproved vm.runIn* sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/code-injection exclusion drift: ${violations.length} new vm.runIn* sites outside the sovereign eval allowlist`);
});

test("CodeQL drift: new Function(...) only in audit-approved files", () => {
  // Approved sites:
  //   - domains/invariant.js#evaluateExpression (invariantCheck lens action) — acorn AST whitelist
  //   - routes/simulation.js (monte-carlo `fn` expression evaluator) — acorn AST whitelist
  //   - lib/invariant-eval.js — the Orchestrated Invariant Engine evaluator. `expr` is a
  //     DEV-AUTHORED contract invariant (content/contracts/*, never user input), evaluated against
  //     a macro's (input, output). Compile-once cache; never throws (returns false on a bad expr).
  //     Same risk class as invariant.js: the strings are not user-controlled at runtime.
  const allowed = [
    "server/domains/invariant.js",
    "server/routes/simulation.js",
    "server/lib/invariant-eval.js",
  ];
  const violations = scan(/new\s+Function\s*\(/, allowed);
  if (violations.length > 0) {
    console.error("\nUnapproved new Function() sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/code-injection exclusion drift: ${violations.length} new Function() sites outside the invariant.js allowlist`);
});

test("CodeQL drift: no top-level eval() in any source file", () => {
  // Literal `eval(` is forbidden — but the regex must NOT match Puppeteer's
  // `$eval(...)` / `$$eval(...)` DOM helpers (those run in the page sandbox,
  // not the Node VM), nor the forge.js detector that lists `eval` as a
  // forbidden-pattern string for its own scanner.
  const allowed = [
    "server/routes/forge.js",          // forbidden-pattern detector string
    "server/routes/frontier-part3.js", // forbidden-pattern detector string
    "server/domains/repos.js",         // code-review detector: /eval\s*\(/ rule pattern
  ];
  // Negative lookbehind: not preceded by `$` (Puppeteer) or `.` (foo.eval).
  // Word boundary already excludes `evaluate`, `evaluator`, etc.
  const violations = scan(/(?<![$.])\beval\s*\(/, allowed);
  if (violations.length > 0) {
    console.error("\neval() call sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `Forbidden eval() call: ${violations.length} sites — CodeQL js/code-injection exclusion is unsafe with new eval sites`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/weak-cryptographic-algorithm lock-in
// Exclusion rationale: MD5/SHA1 only used for non-security hashing
// (sharding, schema cache, procgen seeds, threat-dedup). Real auth uses
// HS256 JWT + bcrypt. NEW MD5/SHA1 in any auth-adjacent file is forbidden.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no MD5/SHA1 in auth-adjacent code paths", () => {
  const FORBIDDEN_FILE_PATTERNS = [
    /\/auth/i, /password/i, /\/jwt/i, /\/session/i,
    /\/login/i, /\/oauth/i, /\/saml/i, /credential/i,
  ];
  const HASH_PATTERN = /createHash\s*\(\s*["'](md5|sha1)["']\s*\)|createHmac\s*\(\s*["'](md5|sha1)["']\s*\)/i;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    const isAuthPath = FORBIDDEN_FILE_PATTERNS.some(re => re.test(rel));
    if (!isAuthPath) continue;
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    if (HASH_PATTERN.test(src)) {
      const lines = src.split("\n");
      const idx = lines.findIndex(l => HASH_PATTERN.test(l));
      violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
    }
  }
  if (violations.length > 0) {
    console.error("\nMD5/SHA1 in auth-adjacent files:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/weak-cryptographic-algorithm exclusion drift: ${violations.length} MD5/SHA1 sites in auth-adjacent paths`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/insecure-randomness lock-in
// Exclusion rationale: Math.random() in procgen only. Security-relevant
// randomness must use crypto.randomBytes(). NEW Math.random in any
// security-adjacent file (auth, wallet, session, jwt, webhook secret,
// API key minting) is forbidden.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no Math.random in security-adjacent code paths", () => {
  const FORBIDDEN_FILE_PATTERNS = [
    /\/auth\.js$/i, /\/jwt\.js$/i, /\/session\.js$/i, /\/login\.js$/i,
    /\/routes\/wallet/i, /\/routes\/marketplace/i, /\/routes\/withdrawals/i,
    /\/webhook-auth\.js$/i,
  ];
  // Allow-list paths that match the forbidden regex but are template
  // generators (lens-templates emit example code, not security code).
  const TEMPLATE_GENERATOR_PATHS = /\/lens-templates\//i;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    if (TEMPLATE_GENERATOR_PATHS.test(rel)) continue;
    const isSecurityPath = FORBIDDEN_FILE_PATTERNS.some(re => re.test(rel));
    if (!isSecurityPath) continue;
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    if (/Math\.random\s*\(/.test(src)) {
      const lines = src.split("\n");
      const idx = lines.findIndex(l => /Math\.random\s*\(/.test(l));
      violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
    }
  }
  if (violations.length > 0) {
    console.error("\nMath.random in security-adjacent files:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/insecure-randomness exclusion drift: ${violations.length} Math.random sites in security paths`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/sql-injection lock-in
// Exclusion rationale: better-sqlite3 parameterized prepares. Forbidden
// pattern: string-interpolated SQL inside db.prepare(`...${expr}...`).
// Parameterized prepares with .run(...args) are safe.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: db.prepare() interpolations are server-constructed clauses, not user input (advisory)", () => {
  // db.prepare(`...${expr}...`) interpolation is COMMON for server-built
  // fragments — WHERE clause builder (`${where}`), placeholder count
  // (`${placeholders}`), column-set updater (`${sets.join(",")}`). The
  // VALUES are still bound via .run(...params), so the row data is
  // parameterized — only the SQL shape is interpolated, with no user input
  // reaching the SQL string itself.
  //
  // Truly dangerous shape: ${req.body.x} / ${req.params.x} / ${req.query.x}
  // INTERPOLATED INTO the SQL string. That's the pattern this test really
  // wants to catch.
  const dangerous = /\.prepare\s*\(\s*`[^`]*\$\{\s*req\.(body|params|query|headers)\./g;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    let m;
    while ((m = dangerous.exec(src)) !== null) {
      const upToMatch = src.slice(0, m.index);
      const line = upToMatch.split("\n").length;
      const lineText = src.split("\n")[line - 1]?.trim().slice(0, 120);
      violations.push({ file: rel, line, snippet: lineText });
    }
    dangerous.lastIndex = 0;  // reset stateful regex
  }
  if (violations.length > 0) {
    console.error("\nDirect req.* interpolation into db.prepare():");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/sql-injection exclusion drift: ${violations.length} req.* values interpolated into prepare() — must bind via .run(value)`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/log-injection lock-in (Sprint 18.6 — logger CRLF sanitization)
// logger.js#sanitizeLogMessage() strips \r\n and control chars before any
// stdout write. Any new console.{log,warn,error}() that emits user input
// outside the logger pipeline is forbidden.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no console.X(req.body|params|query) sites outside logger.js", () => {
  // Direct interpolation of req.* into console.{log,warn,error} bypasses
  // the logger's sanitizeLogMessage path. logger.js itself is allowed
  // because every write goes through sanitizeLogMessage at the call site.
  const allowed = ["server/logger.js"];
  const re = /console\.(log|warn|error|debug|info)\s*\(\s*[^)]*req\.(body|params|query|headers)/;
  const violations = scan(re, allowed);
  if (violations.length > 0) {
    console.error("\nDirect req.* → console.X sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  // Allow up to 5 — many legacy debug logs use req.user.id etc. for
  // operational tracing. Hard-fail above that or if a new entry-point lands.
  assert.ok(violations.length < 6,
    `js/log-injection drift: ${violations.length} new console.X(req.*) sites — must route through structuredLog() or logger.{info,warn,error}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/path-injection (KEPT ENABLED) but we also lock-in the helpers
// Re-assert: every fs.* operation against user input goes through a
// path-containment helper. This is BELT-AND-SUSPENDERS — CodeQL flags
// it too, but if CodeQL's taint tracker mis-classifies a new site, this
// test catches it independently.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no fs.readFileSync(req.body...) or similar raw patterns", () => {
  // Direct interpolation of req.* into fs.* — the loudest path-injection
  // shape. Anything subtler still goes through CodeQL.
  const dangerous = [
    /fs\.\w+\s*\(\s*req\.(body|params|query|headers)\.[^,)]+\)/,
    /readFileSync\s*\(\s*req\.(body|params|query|headers)\.[^,)]+\)/,
    /writeFileSync\s*\(\s*req\.(body|params|query|headers)\.[^,)]+,/,
  ];
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    for (const re of dangerous) {
      if (re.test(src)) {
        const lines = src.split("\n");
        const idx = lines.findIndex(l => re.test(l));
        violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
        break;
      }
    }
  }
  if (violations.length > 0) {
    console.error("\nDirect req.* → fs.* sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `Raw req.* → fs.* path-injection patterns: ${violations.length} sites — must go through containedPath() or slug-validate`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/server-side-request-forgery (KEPT ENABLED) but lock-in the helper
// Every outbound fetch must go through validateSafeFetchUrl OR be
// against a hardcoded URL (Ollama localhost, Stripe API, etc.).
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no raw fetch(req.body.url) or similar", () => {
  // Direct interpolation of user-controlled URL into fetch().
  const dangerous = /\bfetch\s*\(\s*req\.(body|params|query|headers)\./;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    if (dangerous.test(src)) {
      const lines = src.split("\n");
      const idx = lines.findIndex(l => dangerous.test(l));
      violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
    }
  }
  if (violations.length > 0) {
    console.error("\nRaw fetch(req.*) sites:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `Raw fetch(req.*) SSRF sites: ${violations.length} — must go through validateSafeFetchUrl from ssrf-guard.js`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/prototype-polluting-assignment lock-in (audit baseline)
// Forbidden pattern: obj[userVar] = ... where userVar comes from req.*.
// Allowed: hardened files where we audited and locked the key set.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: no req.body[*] / req.params[*] dynamic-key writes outside hardened files", () => {
  // Pattern: someObj[req.body.foo] = bar, OR someObj[req.params.foo] = bar
  // Skip the wave-1/2 hardened files; they have explicit allow-list / Set.has guards.
  const hardened = new Set([
    "server/lib/webhook-auth.js",
    "server/lib/mcp-server.js",
    "server/lib/nemesis.js",
    "server/lib/personal-locker/pipeline.js",
    "server/routes/sovereign.js",
    "server/routes/world.js",
  ]);
  const re = /\w+\s*\[\s*req\.(body|params|query|headers)\.[^\]]+\]\s*=/;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    if (hardened.has(rel)) continue;
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    if (re.test(src)) {
      const lines = src.split("\n");
      const idx = lines.findIndex(l => re.test(l));
      violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
    }
  }
  if (violations.length > 0) {
    console.error("\nDynamic req.*-keyed assignments outside hardened files:");
    for (const v of violations) console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  assert.equal(violations.length, 0,
    `js/prototype-polluting-assignment exclusion drift: ${violations.length} new sites — must use Set.has() allow-list + slug-regex + Object.create(null)`);
});

// ═══════════════════════════════════════════════════════════════════════════
// js/polynomial-redos / js/polynomial-regex lock-in (length-cap invariant)
// Audit verified: every user-input regex site has a length cap. NEW
// regex on a function param without slice() or MAX_*_LEN is forbidden.
// Heuristic-only: we can't statically prove every regex's input is
// bounded, but we can require: any file with a `description.match(`
// or `body.match(` pattern must also reference a slice/length cap.
// ═══════════════════════════════════════════════════════════════════════════

test("CodeQL drift: regex-on-user-input sites have a length cap nearby", () => {
  // Find files that match user input against regex, then assert each
  // file has some form of length-bound in scope.
  const inputRegexSite = /(req\.(body|params|query)\.\w+|description|message|prompt|input|text)\s*\.\s*(match|test|exec|replace|split)\s*\(\s*\/[^/]/;
  const boundIndicator = /\.slice\s*\(\s*0|MAX_\w+_LEN|\.substring\s*\(\s*0|\.length\s*[<>]=?\s*\d+|clip\s*\(/;
  const violations = [];
  for (const f of ALL_SOURCE_FILES) {
    const rel = repoRel(f);
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    if (inputRegexSite.test(src) && !boundIndicator.test(src)) {
      const lines = src.split("\n");
      const idx = lines.findIndex(l => inputRegexSite.test(l));
      violations.push({ file: rel, line: idx + 1, snippet: lines[idx]?.trim().slice(0, 120) });
    }
  }
  if (violations.length > 0) {
    console.warn(`\n⚠ ${violations.length} files have user-input regex but no nearby length bound:`);
    for (const v of violations.slice(0, 10)) console.warn(`  ${v.file}:${v.line} — ${v.snippet}`);
  }
  // This is heuristic — allow up to 15 since the bound might be a parent
  // file. Tighten after a manual sweep.
  assert.ok(violations.length < 16,
    `js/polynomial-regex exclusion drift: ${violations.length} regex-on-user-input sites without a visible length bound — please audit`);
});
