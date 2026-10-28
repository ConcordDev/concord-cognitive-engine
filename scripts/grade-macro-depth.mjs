#!/usr/bin/env node
// scripts/grade-macro-depth.mjs
//
// Macro-depth grader — the instrument behind docs/STUB_UPGRADE_BACKLOG.md,
// docs/DEPTH_IMPORTANT_BACKLOG.md, and server/tests/grade-macro-depth.test.js.
//
// HISTORY (audit Q63, 2026-10-28): the original grader was never committed —
// its test and both backlog docs referenced scripts/grade-macro-depth.mjs,
// but `git log --all` for the path was empty and the test failed on a clean
// tree (the before() hook execs a missing file). This is a rebuild from the
// surviving spec: the pinned invariants in grade-macro-depth.test.js, the
// tier rubric + weights in STUB_UPGRADE_BACKLOG.md (stub 0.2 / functional
// 0.6 / utility 1.0 / production-grade 1.0; 2026-05-23 default weighted
// 0.898), and the honest-rubric description in DEPTH_IMPORTANT_BACKLOG.md.
// Where the original's exact heuristics are unrecoverable, this rebuild
// documents its own — the numbers it emits are therefore a NEW baseline,
// not a continuation of the May series.
//
// WHAT IT GRADES — every (domain, macro) pair registered via
// registerLensAction("d","m",…) / register("d","m",…) in server/domains/*.js
// and server/server.js:
//   loc          handler body lines (non-blank, non-comment)
//   combinedLoc  loc + the dominant delegate's body lines, when the handler
//                delegates to an imported lib function
//   hasTest      test credit (mode-dependent, below)
//   tier         stub | functional | utility | production-grade
//
// TEST CREDIT
//   both modes:  a literal runMacro("d","m") invocation in a test file, or a
//                (Known undercount, deliberate: domain test harnesses that
//                capture the registrar and invoke handlers via a local
//                call("macro") helper are real invocations too, but are
//                not credited yet — the honest number is a floor, per the
//                pinned test's own framing. Crediting them is a follow-up
//                calibration, not a silent omission.)
//                TESTED DELEGATION — the handler calls an imported lib fn
//                that a test file imports AND calls.
//   default only: SHAPE credit — the "d.m" string (or the pair) merely
//                appearing in a test file (smoke harnesses, bulk CASES
//                tables). This is what --honest strips: shape coverage
//                proves a macro is reachable, not that its behavior is
//                verified.
//
// TIERS (per macro)
//   production-grade: credited test (mode rules) AND a robustness signal
//                     (try/catch, or input validation + non-trivial body)
//   utility:          credited test without the robustness signal
//   functional:       real implementation (loc >= 8 or behavioral signals)
//                     without test credit
//   stub:             everything else — tiny, untested, signal-free
//
// OUTPUT: audit/macro-depth.json (default) / audit/macro-depth-honest.json
// (--honest), each { mode, total, totals, weightedScore, macros[] }.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HONEST = process.argv.includes("--honest");
const MODE = HONEST ? "honest" : "default";
const WEIGHTS = { stub: 0.2, functional: 0.6, utility: 1.0, "production-grade": 1.0 };

// ── source scanning helpers ──────────────────────────────────────────────

/** Brace-match from the `{` at index `start`; returns the index just past
 * the matching `}`. Skips strings, template literals (with ${} nesting),
 * line/block comments, and regex literals (heuristic: a `/` that follows
 * an operator/opening token). Never throws — caps at end of file. */
function matchBrace(src, start) {
  let depth = 0;
  let i = start;
  const n = src.length;
  let prevSignificant = "";
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e === -1 ? n : e + 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { i = skipQuoted(src, i, c); prevSignificant = c; continue; }
    if (c === "`") { i = skipTemplate(src, i); prevSignificant = "`"; continue; }
    if (c === "/" && /[(,=:[!&|?{};]|^$/.test(prevSignificant || "(")) { i = skipRegex(src, i); prevSignificant = "/"; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return n;
}
function skipQuoted(src, i, q) {
  i++;
  while (i < src.length) { if (src[i] === "\\") i += 2; else if (src[i] === q) return i + 1; else i++; }
  return i;
}
function skipRegex(src, i) {
  i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === "[") { inClass = true; i++; }
    else if (c === "]") { inClass = false; i++; }
    else if (c === "/" && !inClass) { i++; while (i < src.length && /[a-z]/i.test(src[i])) i++; return i; }
    else if (c === "\n") return i;
    else i++;
  }
  return i;
}
function skipTemplate(src, i) {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === "`") return i + 1;
    else if (c === "$" && src[i + 1] === "{") { i = matchBrace(src, i + 1); }
    else i++;
  }
  return i;
}

function countLoc(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    n++;
  }
  return n;
}

/** Parse a file's import statements: localName -> resolved source path. */
function parseImports(src, fileDir) {
  const map = new Map();
  const re = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:[\w$]+\s*,?\s*)?from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const [, defaultName, named, spec] = m;
    if (!spec.startsWith(".")) continue;
    const resolved = path.resolve(fileDir, spec);
    if (defaultName) map.set(defaultName, resolved);
    if (named) {
      for (const part of named.split(",")) {
        const p = part.trim();
        if (!p) continue;
        const as = p.split(/\s+as\s+/);
        map.set((as[1] || as[0]).trim(), resolved);
      }
    }
  }
  return map;
}

/** Find a top-level function definition's body span in a source file. */
function findFunctionSpan(src, name) {
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`),
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:async\\s+)?[\\w$]+\\s*=>`),
  ];
  for (const re of patterns) {
    const m = re.exec(src);
    if (!m) continue;
    const brace = src.indexOf("{", m.index);
    if (brace === -1) continue;
    return src.slice(brace, matchBrace(src, brace));
  }
  return null;
}

// ── enumerate macros ─────────────────────────────────────────────────────

function collectSourceFiles() {
  const files = [];
  const domainsDir = path.join(ROOT, "server", "domains");
  for (const f of fs.readdirSync(domainsDir)) if (f.endsWith(".js")) files.push(path.join(domainsDir, f));
  files.push(path.join(ROOT, "server", "server.js"));
  return files;
}

const REG_RE = /\bregister(?:LensAction)?\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;

function enumerateMacros() {
  const macros = new Map(); // "d.m" -> record
  for (const file of collectSourceFiles()) {
    const src = fs.readFileSync(file, "utf8");
    const imports = parseImports(src, path.dirname(file));
    let m;
    REG_RE.lastIndex = 0;
    while ((m = REG_RE.exec(src))) {
      const [, domain, macro] = m;
      const key = `${domain}.${macro}`;
      // Handler body: the first `{` of the function that follows the pair —
      // find the `=>` or `function` after the match, then its `{`.
      const rest = src.slice(m.index, m.index + 4000);
      const arrow = rest.indexOf("=>");
      const fnKw = rest.indexOf("function");
      let bodyStart = -1;
      if (arrow !== -1 && (fnKw === -1 || arrow < fnKw)) bodyStart = rest.indexOf("{", arrow);
      else if (fnKw !== -1) bodyStart = rest.indexOf("{", fnKw);
      if (bodyStart === -1) continue;
      const absStart = m.index + bodyStart;
      const body = src.slice(absStart, matchBrace(src, absStart));
      macros.set(key, { domain, macro, file: path.relative(ROOT, file), body, imports });
    }
  }
  return macros;
}

// ── test corpus ──────────────────────────────────────────────────────────

function collectTestFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.test\.(js|mjs)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server", "tests"));
  return out;
}

function buildTestIndex(testFiles) {
  const literal = new Set();       // "d.m" via runMacro("d","m")
  const shape = new Set();         // "d.m" mentioned anywhere
  const calledImported = new Set(); // resolved module paths whose imported names are called in some test
  const LIT_RE = /runMacro\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  for (const file of testFiles) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    LIT_RE.lastIndex = 0;
    while ((m = LIT_RE.exec(src))) literal.add(`${m[1]}.${m[2]}`);
    for (const q of src.matchAll(/"([a-z][a-z0-9_-]*)\.([a-z][a-zA-Z0-9_-]*)"/g)) shape.add(`${q[1]}.${q[2]}`);
    const imports = parseImports(src, path.dirname(file));
    for (const [name, resolved] of imports) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(src)) calledImported.add(resolved);
    }
  }
  return { literal, shape, calledImported };
}

// ── grading ──────────────────────────────────────────────────────────────

const libSpanCache = new Map();
function delegateLoc(imports, body) {
  // Candidate delegates: imported identifiers called in the body.
  const called = new Set();
  for (const name of imports.keys()) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(body)) called.add(name);
  }
  let best = null;
  for (const name of called) {
    const target = imports.get(name);
    if (!target || !fs.existsSync(target)) continue;
    const cacheKey = `${target}#${name}`;
    if (!libSpanCache.has(cacheKey)) {
      const src = fs.readFileSync(target, "utf8");
      const span = findFunctionSpan(src, name);
      libSpanCache.set(cacheKey, span ? { loc: countLoc(span), target, span } : null);
    }
    const info = libSpanCache.get(cacheKey);
    if (info && (!best || info.loc > best.loc)) best = { name, ...info };
  }
  return best;
}

function grade(macros, testIdx) {
  const results = [];
  for (const rec of macros.values()) {
    const { body, imports } = rec;
    const loc = countLoc(body);
    const delegate = delegateLoc(imports, body);
    const combinedLoc = loc + (delegate ? delegate.loc : 0);

    const hasTryCatch = /\btry\s*{/.test(body) || (delegate ? /\btry\s*{/.test(delegate.span || "") : false);
    const validations = (body.match(/\bif\s*\(\s*!|typeof\s|Number\.isFinite|Array\.isArray|\.length\s*[<>=!]/g) || []).length;
    const writesState = /INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|\.run\(|saveState|emitEvent\(/.test(body);
    const robust = hasTryCatch || validations >= 2 || (validations >= 1 && combinedLoc >= 10);

    // Test credit
    const key = `${rec.domain}.${rec.macro}`;
    let hasTest = testIdx.literal.has(key);
    let via = hasTest ? "literal" : null;
    if (!hasTest && delegate && testIdx.calledImported.has(delegate.target)) { hasTest = true; via = "delegation"; }
    if (!hasTest && !HONEST && testIdx.shape.has(key)) { hasTest = true; via = "shape"; }

    let tier;
    if (hasTest && robust) tier = "production-grade";
    else if (hasTest) tier = "utility";
    else if (combinedLoc >= 8 || writesState || validations >= 1) tier = "functional";
    else tier = "stub";

    results.push({
      domain: rec.domain, macro: rec.macro, tier, hasTest,
      ...(via ? { testVia: via } : {}),
      loc, combinedLoc,
      ...(delegate ? { delegatesTo: delegate.name } : {}),
    });
  }
  results.sort((a, b) => a.domain.localeCompare(b.domain) || a.macro.localeCompare(b.macro));
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────

const macros = enumerateMacros();
const testIdx = buildTestIndex(collectTestFiles());
const graded = grade(macros, testIdx);
const totals = { stub: 0, functional: 0, utility: 0, "production-grade": 0 };
for (const g of graded) totals[g.tier]++;
const total = graded.length;
const weightedScore = total ? graded.reduce((s, g) => s + WEIGHTS[g.tier], 0) / total : 0;

const out = { mode: MODE, total, totals, weightedScore: Math.round(weightedScore * 1000) / 1000, macros: graded };
const outDir = path.join(ROOT, "audit");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, HONEST ? "macro-depth-honest.json" : "macro-depth.json");
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`[grade-macro-depth] mode=${MODE} total=${total} weighted=${out.weightedScore} totals=${JSON.stringify(totals)} -> ${path.relative(ROOT, outFile)}`);
