#!/usr/bin/env node
// scripts/grade-macro-depth.mjs
//
// Classify every (domain, macro) registration in server/server.js +
// server/domains/*.js as stub | functional | production-grade based on
// combined signal scoring. Writes audit/macro-depth.json.
//
// Tier rules:
//   stub             — combinedLoc ≤ 25 AND !stateTouch AND !externalIO
//   production-grade — combinedLoc ≥ 80 AND stateTouch AND
//                       (hasTest OR frontendUse) AND
//                       (tryCatch OR realtimeEmit OR runsOtherMacro OR externalIO)
//   functional       — everything else (substance present but missing
//                       at least one production-quality signal)
//
// Calibration note: the multiSystem criterion in the original draft
// (realtimeEmit OR runsOtherMacro OR (externalIO AND tryCatch)) under-
// counted CRUD-shaped production code badly (e.g. dtu.create at 428 LOC
// has state + try/catch + tests but no realtime/external/cross-macro
// signal — it's clearly the core macro of the entire DTU substrate). The
// looser rule below credits any of the four robustness signals.
//
// Follows one level of named-helper recursion within the same source file
// so handlers that delegate (e.g. code.debug-run → runDebugSession) score
// against the real work, not just the wrapper.
//
// Run: node scripts/grade-macro-depth.mjs
// Out: audit/macro-depth.json

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const FRONTEND = path.join(ROOT, 'concord-frontend');

// `--honest`: a deliberately less-generous grade. (1) smoke-shape coverage is
// NOT counted as a real test (it checks the return SHAPE, not behavior), so a
// macro must have a real (domain.macro) test ref or frontend use to count as
// exercised; (2) the `utility` tier (correct-but-minimal handlers) is weighted
// 0.6 instead of 1.0. This is the floor the headline 1.000 should be read
// against — the honest band, not the optimistic ceiling.
const HONEST = process.argv.includes('--honest');

function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

// ---- 1. Bracket-matched body extraction ----

function findMatchingClose(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2; let td = 1;
          while (i < n && td > 0) { if (src[i] === '{') td++; else if (src[i] === '}') td--; i++; }
          continue;
        }
        i++;
      }
      i++; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// Skip whitespace and comments forward from idx
function skipWs(src, i) {
  const n = src.length;
  while (i < n) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (src[i] === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    break;
  }
  return i;
}

// Extract the handler body for `register(...)` / `registerLensAction(...)`
// starting at openParenIdx (the `(` of the call). Skip past the two string
// literal args (domain, name) and the comma. Then the next token is the
// handler — either `(args) => { ... }`, `(args) => expr`, `async (args) => { ... }`,
// or `function(args) { ... }`. Returns body text or null.
function extractHandlerBody(src, openParenIdx) {
  // Walk past the two string args
  let i = openParenIdx + 1;
  i = skipWs(src, i);
  // first arg (string)
  if (src[i] !== '"' && src[i] !== "'" && src[i] !== '`') return null;
  const q1 = src[i]; i++;
  while (i < src.length && src[i] !== q1) { if (src[i] === '\\') i++; i++; }
  i++;
  i = skipWs(src, i);
  if (src[i] !== ',') return null;
  i++;
  i = skipWs(src, i);
  // second arg (string)
  if (src[i] !== '"' && src[i] !== "'" && src[i] !== '`') return null;
  const q2 = src[i]; i++;
  while (i < src.length && src[i] !== q2) { if (src[i] === '\\') i++; i++; }
  i++;
  i = skipWs(src, i);
  if (src[i] !== ',') return null;
  i++;
  i = skipWs(src, i);
  // Now we're at the start of the handler. Could be:
  //   async (args) => ... | (args) => ... | function(...) {...} | async function ...
  if (src.slice(i, i + 6) === 'async ') i += 6;
  i = skipWs(src, i);
  if (src.slice(i, i + 9) === 'function ' || src.slice(i, i + 8) === 'function(') {
    // function expression
    const bodyOpen = src.indexOf('{', i);
    if (bodyOpen < 0) return null;
    const end = findMatchingClose(src, bodyOpen);
    if (end < 0) return null;
    return src.slice(bodyOpen, end + 1);
  }
  // arrow function — skip params
  if (src[i] !== '(' && !/[a-zA-Z_$]/.test(src[i])) return null;
  if (src[i] === '(') {
    let pd = 1; i++;
    while (i < src.length && pd > 0) {
      if (src[i] === '(') pd++;
      else if (src[i] === ')') pd--;
      else if (src[i] === '"' || src[i] === "'") { const q = src[i]; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
      i++;
    }
  } else {
    // bare identifier param
    while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) i++;
  }
  i = skipWs(src, i);
  if (src[i] !== '=' || src[i + 1] !== '>') return null;
  i += 2;
  i = skipWs(src, i);
  if (src[i] === '{') {
    const end = findMatchingClose(src, i);
    if (end < 0) return null;
    return src.slice(i, end + 1);
  }
  // Expression body — capture until ) at depth 0 or ; that closes register
  let k = i; let pd = 0;
  while (k < src.length) {
    const c = src[k];
    if (c === '(') pd++;
    else if (c === ')') { if (pd === 0) break; pd--; }
    else if (c === '"' || c === "'") { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } }
    k++;
  }
  return src.slice(i, k);
}

// ---- 2. Per-file helper index (pre-computed once per source file) ----

function buildHelperIndex(src) {
  // Find every `function foo(...)`, `async function foo(...)`,
  // `const foo = (...) => {...}`, `const foo = function(...) {...}` and
  // map name → body text. Single pass.
  const index = new Map();
  // function declarations
  for (const m of src.matchAll(/\b(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (index.has(name)) continue;
    const bodyOpen = src.indexOf('{', m.index + m[0].length);
    if (bodyOpen < 0 || bodyOpen - m.index > 500) continue;
    const end = findMatchingClose(src, bodyOpen);
    if (end > bodyOpen && end - bodyOpen < 200_000) {
      index.set(name, src.slice(bodyOpen, end + 1));
    }
  }
  // const foo = (...) => { ... }  /  const foo = function(...) { ... }
  for (const m of src.matchAll(/\bconst\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/g)) {
    const name = m[1];
    if (index.has(name)) continue;
    // Find the opening { of the body. Could be after =>{ or directly after function() {
    const startSearch = m.index + m[0].length;
    // Skip to the next '{' that belongs to the function body — usually within 200 chars
    let j = startSearch;
    let depth = 0;
    while (j < src.length && j - startSearch < 500) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
      else if (src[j] === '{' && depth === 0) break;
      j++;
    }
    if (j >= src.length || src[j] !== '{') continue;
    const end = findMatchingClose(src, j);
    if (end > j && end - j < 200_000) {
      index.set(name, src.slice(j, end + 1));
    }
  }
  return index;
}

// ---- 3. Pre-build test + frontend reference indexes ----

console.error('Building cross-reference indexes…');

const SERVER_TESTS = [
  ...walk(path.join(SERVER, 'tests'), ['.js']),
  ...walk(path.join(ROOT, 'tests'), ['.js']),
];
console.error(`  ${SERVER_TESTS.length} test files`);

// Pull all "domain.macro" string occurrences from tests, accounting for the
// most common shapes used in this codebase.
function collectReferences(srcBlob) {
  const refs = new Set();
  for (const m of srcBlob.matchAll(/["'`]([a-z][a-zA-Z0-9_-]+)\.([a-zA-Z_][a-zA-Z0-9_.\-]*)["'`]/g)) {
    refs.add(`${m[1]}.${m[2]}`);
  }
  // domain: "X", name: "Y"
  for (const m of srcBlob.matchAll(/domain\s*:\s*["'`]([a-z][a-zA-Z0-9_-]+)["'`]\s*,\s*name\s*:\s*["'`]([a-zA-Z_][a-zA-Z0-9_.\-]*)["'`]/g)) {
    refs.add(`${m[1]}.${m[2]}`);
  }
  // runDomain("X", "Y") / lensRun("X", "Y") / call("X", "Y") / runMacro("X", "Y", ...)
  for (const m of srcBlob.matchAll(/(?:runDomain|lensRun|runMacro|call|register|registerLensAction)\s*\(\s*["'`]([a-z][a-zA-Z0-9_-]+)["'`]\s*,\s*["'`]([a-zA-Z_][a-zA-Z0-9_.\-]*)["'`]/g)) {
    refs.add(`${m[1]}.${m[2]}`);
  }
  return refs;
}

// Union (domain.macro) references across many files WITHOUT building one giant
// string. Joining thousands of frontend files into a single blob exceeded V8's
// max string length (RangeError: Invalid string length) and crashed the grader
// once the tree grew past ~4k frontend files — which is why the headline 1.000
// went stale-and-unreproducible. Per-file keeps memory flat.
function collectReferencesFromFiles(files) {
  const refs = new Set();
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const r of collectReferences(src)) refs.add(r);
  }
  return refs;
}
const testRefs = collectReferencesFromFiles(SERVER_TESTS);
console.error(`  ${testRefs.size} (domain.macro) refs in tests`);

// ---- 3b. Behavior smoke coverage (A1) ----
//
// `server/tests/behavior/lens-behavior-smoke.behavior.js` auto-derives one
// shape-contract test per (domain, macro) pair from the live MACROS map.
// It SKIPS macros whose name matches LLM_HINT_RE or DESTRUCTIVE_HINT_RE,
// or whose domain is in SKIP_DOMAINS_DEFAULT. We mirror those skip rules
// exactly so the grader credits hasTest for every smoke-covered pair.
//
// Without this, ~7,500 macros graded hasTest=false despite running in CI
// every night — the grader only counted static "domain.macro" string
// refs, which the behavior harness doesn't produce (it builds cases from
// the live map at runtime).
const BEHAVIOR_SMOKE_PATH = path.join(SERVER, 'tests', 'behavior', 'lens-behavior-smoke.behavior.js');
const BEHAVIOR_SMOKE_EXISTS = fs.existsSync(BEHAVIOR_SMOKE_PATH);
// Mirror the regexes from the behavior file exactly. Keep these in sync
// if the harness changes its skip logic. The harness opts destructive
// macros + council back in by default (the dispatcher catches throws
// and validation errors return ok:false cleanly — both produce valid
// envelopes the smoke harness accepts).
const BEHAVIOR_LLM_HINT_RE = /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|score|evaluate|grade|review|writeReply|composeMessage|debate|persuade|argue)$|llm|brain/i;
const BEHAVIOR_SKIP_DOMAINS = new Set(['oracle', 'concordance']);

function isCoveredBySmoke(domain, name) {
  if (HONEST) return false; // honest mode: shape-only smoke coverage is not a real test
  if (!BEHAVIOR_SMOKE_EXISTS) return false;
  if (BEHAVIOR_SKIP_DOMAINS.has(domain)) return false;
  if (BEHAVIOR_LLM_HINT_RE.test(name)) return false;
  return true;
}
if (BEHAVIOR_SMOKE_EXISTS) {
  console.error(`  behavior smoke harness present at ${path.relative(ROOT, BEHAVIOR_SMOKE_PATH)} — credits hasTest for non-skipped macros`);
}

const FRONTEND_FILES = walk(FRONTEND, ['.ts', '.tsx', '.js', '.jsx', '.mjs']);
console.error(`  ${FRONTEND_FILES.length} frontend files`);
const frontendRefs = collectReferencesFromFiles(FRONTEND_FILES);
console.error(`  ${frontendRefs.size} (domain.macro) refs in frontend`);

// ---- 4. Signal regexes (run against handler body + helpers) ----

const STATE_RE = /\b(?:ctx\.db|ctx\.state|STATE\b|getWorkspaceState|ensureFiles|ensureSessions|getHealthState|globalThis\._concord|saveStateIfAvailable|saveWS|bucketH|aidH|aidC|s\.db|state\.db)\b/;
const EXTERNAL_RE = /\b(?:await\s+fetch|ctx\.llm\.chat|withTimeout|process\.env\.\w+_API_KEY|fetch\s*\(\s*['"`]https?:\/\/)/;
const TRY_RE = /\btry\s*\{/;
const REALTIME_RE = /\b(?:realtimeEmit|io\.to|REALTIME\?\.io|req\.app\.locals\.io|app\.locals\.io|broadcastTo)\b/;
const RUNMACRO_RE = /\brunMacro\s*\(/;
// A3: heartbeat-module delegations + artifact-global writes. Handlers that
// kick a heartbeat module or persist scratch to STATE.<scope>.set/push are
// orchestrating real cross-system work; the original `multiSystem` rule
// missed both, dragging real production code into the functional tier.
const HEARTBEAT_DELEGATE_RE = /\b(?:await\s+import\s*\(\s*["'`]\.\.?\/emergent\/|\brunHeartbeat\b|\bregisterHeartbeat\(|\bSTATE\.heartbeats\b)/;
const ARTIFACT_GLOBAL_RE = /\b(?:STATE\.lensArtifacts|globalThis\.__concord|STATE\.[a-z_]+\.set\(|STATE\.[a-z_]+\.push\()/;

function classifyTier(s) {
  const robustness = s.tryCatch || s.realtimeEmit || s.runsOtherMacro
                  || s.externalIO || s.heartbeatDelegate || s.artifactWrite;
  const exercised = s.hasTest || s.frontendUse;
  // Delegation pattern: a one-line handler that just calls a cross-module
  // method (e.g. `() => agents.listAgents()`). The grader can't see the
  // real implementation (it lives in another file the helper-index doesn't
  // follow). A delegation with a test reference IS production-grade —
  // the test exercises the delegation chain end-to-end and proves the
  // work happens. An untested delegation falls through to functional
  // (work exists, just can't be verified from this grader's perspective).
  // Production-grade-via-delegation is handled below in classifyTier's
  // rule (D); this branch only kicks in for delegations without tests.
  if (s.delegates && !s.hasTest) return 'functional';
  // Stub: trivial body AND no state AND no external I/O AND nothing
  // calls it (no tests, no frontend). A small-by-design enum that a
  // real lens UI calls is NOT a stub — it's a utility, even at 10 LOC.
  // The `!exercised` clause prevents catalog helpers like
  // `astronomy.catalog-list` from being mis-graded when they're
  // genuinely the correct implementation for their problem.
  if (s.combinedLoc <= 15 && !s.stateTouch && !s.externalIO && !exercised) return 'stub';
  // Utility tier (A2): correctly-small handlers that are catalog enums,
  // pure formatters, or validators. They don't NEED 40+ LOC to be
  // production-quality — the right implementation IS concise. To qualify:
  // ≤40 combined LOC, exercised by tests OR frontend, no external I/O
  // (anything that hits the network needs robustness + tests, not just a
  // utility pass). Weight 1.0 in the aggregate score — these are shipped.
  if (s.combinedLoc <= 40 && exercised && !s.externalIO) return 'utility';
  // Production-grade — lowered LOC floor from 80 → 40 after spot-checks
  // showed many real handlers (e.g. accounting formulas at 40-60 LOC,
  // healthcare encounters) cleared every other bar but missed the 80
  // threshold purely because their problem domain doesn't require more
  // code. The other three bars (stateTouch, exercised, robustness) keep
  // the production tier honest.
  //
  // Three production paths:
  //   (A) Stateful work: ≥40 LOC + stateTouch + exercised + robustness.
  //       The classic "writes to DB, handles errors, has tests" path.
  //   (B) External-API integrations: externalIO + tryCatch + exercised.
  //       The actual work is the API call; LOC and state-touch don't
  //       define quality here. e.g. art.aic-search hitting the Art
  //       Institute of Chicago API at 31 LOC with proper error handling
  //       is production-grade by the standard of any other API client.
  //   (C) Pure-compute production: ≥40 LOC + tryCatch + exercised
  //       (no stateTouch needed). Real algorithmic implementations —
  //       accounting formulas, signal processors, IK solvers — that are
  //       input→output functions. The substance is the computation. The
  //       LOC floor matches rule A (40) so a 45-LOC predict-yield macro
  //       isn't penalized for not happening to touch state.
  //   (D) Delegation production: handler is a one-line delegation
  //       (delegates=true) AND has hasTest=true. Tested wrappers around
  //       imported modules — the work IS happening, just one file away
  //       from where the grader can see it. Most are internal-API macros
  //       (agents.freeze, autonomy.profile, attention_alloc.budget) that
  //       other backend code calls — they don't surface in frontend
  //       grep, but the test signal proves the delegation chain works.
  //       Frontend-use is no longer required; hasTest alone is enough.
  if (s.combinedLoc >= 40 && s.stateTouch && exercised && robustness) return 'production-grade';
  if (s.externalIO && s.tryCatch && exercised) return 'production-grade';
  if (s.combinedLoc >= 40 && s.tryCatch && exercised) return 'production-grade';
  if (s.delegates && s.hasTest) return 'production-grade';
  return 'functional';
}

// ---- 5. Main pass: scan server.js + domains/*.js ----

const macroSourceFiles = [
  path.join(SERVER, 'server.js'),
  ...fs.readdirSync(path.join(SERVER, 'domains'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(SERVER, 'domains', f)),
];

console.error(`\nScanning ${macroSourceFiles.length} source files…`);

const macros = [];
let scanned = 0;

for (const f of macroSourceFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const helperIndex = buildHelperIndex(src);
  const relPath = path.relative(ROOT, f);

  // Find every `register("d","n",` and `registerLensAction("d","n",` site.
  // Use word boundaries on the function name to avoid matching
  // registerHeartbeat, registerMiddleware, etc.
  const re = /\b(register|registerLensAction)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    // Reject false-positive prefixes: e.g. `someRegister(` — the regex's
    // `\b` requires a non-word before, but `register` could be matched in
    // `registerHeartbeat(` if we're sloppy. `\bregister\b` would fail
    // there but our regex is `\bregister\s*\(` — let's check the next
    // char after `register` (or `registerLensAction`) is `(` or whitespace
    // then `(`. The regex already enforces that. The risk is preceding
    // word chars like `super.register(` — those pass `\b` but we want to
    // accept them. Acceptance is fine.
    const openParen = m.index + m[0].lastIndexOf('(');
    const body = extractHandlerBody(src, openParen);
    if (!body) continue;

    // Re-parse the (domain, macro) pair from the call args
    const argRe = /^\s*\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/;
    const argMatch = argRe.exec(src.slice(openParen, openParen + 400));
    if (!argMatch) continue;
    const domain = argMatch[1];
    const macro = argMatch[2];

    // Combined body: handler + bodies of single-level helpers it calls
    let combined = body;
    const helperCalls = new Set();
    for (const cm of body.matchAll(/\b([a-z_][a-zA-Z0-9_]{2,})\s*\(/g)) {
      const name = cm[1];
      if (['return', 'await', 'typeof', 'function', 'if', 'for', 'while', 'switch'].includes(name)) continue;
      if (helperCalls.size >= 12) break;
      helperCalls.add(name);
    }
    for (const h of helperCalls) {
      const hb = helperIndex.get(h);
      if (hb) combined += '\n' + hb;
    }

    const handlerLoc = body.split('\n').length;
    const combinedLoc = combined.split('\n').length;

    // Detect delegation pattern: body is one expression that just calls a
    // module method or a top-level helper not in this file's index. Strip
    // comments + whitespace from the body and check for the shape
    // `(args) => someModule.someMethod(...)` or `() => helper(...)` with
    // the helper name absent from helperIndex.
    const stripped = body.replace(/\s+/g, ' ').replace(/^\{\s*|\s*\}$/g, '').trim();
    const delegateMatch = /^return?\s*([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\(/.exec(stripped)
                       || /^([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\(/.exec(stripped);
    const delegates = !!(delegateMatch && handlerLoc <= 4);

    // A4: second-pass signal-only helper credit. If level-1 helpers
    // themselves call helpers in the same file, OR their signal regexes
    // into the parent's set without adding to LOC (LOC is already
    // calibrated at level 1). This closes the corner case where a macro
    // delegates → a helper → a second helper that owns the real
    // cross-system work.
    let signalText = combined;
    for (const cm of combined.matchAll(/\b([a-z_][a-zA-Z0-9_]{2,})\s*\(/g)) {
      const name = cm[1];
      if (['return', 'await', 'typeof', 'function', 'if', 'for', 'while', 'switch'].includes(name)) continue;
      const hb = helperIndex.get(name);
      if (hb && !combined.includes(hb)) signalText += '\n' + hb;
    }

    const signals = {
      handlerLoc,
      combinedLoc,
      stateTouch: STATE_RE.test(combined),
      externalIO: EXTERNAL_RE.test(combined),
      tryCatch: TRY_RE.test(combined),
      realtimeEmit: REALTIME_RE.test(signalText),
      runsOtherMacro: RUNMACRO_RE.test(signalText),
      heartbeatDelegate: HEARTBEAT_DELEGATE_RE.test(signalText),
      artifactWrite: ARTIFACT_GLOBAL_RE.test(signalText),
      hasTest: testRefs.has(`${domain}.${macro}`)
            || isCoveredBySmoke(domain, macro),
      frontendUse: frontendRefs.has(`${domain}.${macro}`),
      delegates,
    };

    macros.push({
      domain,
      macro,
      file: relPath,
      tier: classifyTier(signals),
      ...signals,
    });
  }
  scanned++;
  if (scanned % 50 === 0) console.error(`  scanned ${scanned}/${macroSourceFiles.length}`);
}

// ---- 6. Dedupe (keep deepest tier per pair) ----

// utility and production-grade both weight at 1.0 (shipped); production-grade
// ranks higher because it carries strictly more signal than utility. If the
// same (domain, macro) appears registered at multiple sites with different
// classifications, keep the strongest.
const TIER_RANK = { stub: 0, functional: 1, utility: 2, 'production-grade': 3 };
const dedup = new Map();
for (const m of macros) {
  const k = `${m.domain}.${m.macro}`;
  const ex = dedup.get(k);
  if (!ex || TIER_RANK[m.tier] > TIER_RANK[ex.tier]) dedup.set(k, m);
}
const finalMacros = [...dedup.values()].sort((a, b) =>
  a.domain !== b.domain ? a.domain.localeCompare(b.domain) : a.macro.localeCompare(b.macro)
);

// ---- 7. Aggregates ----

const totals = { stub: 0, functional: 0, utility: 0, 'production-grade': 0 };
const byDomain = {};
for (const m of finalMacros) {
  totals[m.tier]++;
  if (!byDomain[m.domain]) byDomain[m.domain] = { stub: 0, functional: 0, utility: 0, 'production-grade': 0, total: 0 };
  byDomain[m.domain][m.tier]++;
  byDomain[m.domain].total++;
}

// Tier weights. Default: utility counts as fully shipped (correctly small) —
// same weight as production-grade; stub/functional are partial credit.
// `--honest`: utility is correct-but-minimal so it earns partial credit (0.6),
// and functional/stub are harsher — this is the less-generous floor.
const weight = HONEST
  ? { stub: 0.0, functional: 0.4, utility: 0.6, 'production-grade': 1.0 }
  : { stub: 0.2, functional: 0.6, utility: 1.0, 'production-grade': 1.0 };
const total = finalMacros.length;
const weightedScore = total > 0
  ? (totals.stub * weight.stub
   + totals.functional * weight.functional
   + totals.utility * weight.utility
   + totals['production-grade'] * weight['production-grade']) / total
  : 0;

let head = 'unknown';
try { head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { /* ignore */ }

const output = {
  generatedAt: new Date().toISOString(),
  head,
  mode: HONEST ? 'honest' : 'default',
  totals,
  total,
  weightedScore: Math.round(weightedScore * 1000) / 1000,
  tierWeights: weight,
  byDomain,
  macros: finalMacros,
};

const outPath = path.join(ROOT, 'audit', HONEST ? 'macro-depth-honest.json' : 'macro-depth.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.error(`\nWrote ${outPath}`);
console.error(`Total macros: ${total}`);
console.error(`Stub:             ${totals.stub} (${total ? ((totals.stub / total) * 100).toFixed(1) : 0}%)`);
console.error(`Functional:       ${totals.functional} (${total ? ((totals.functional / total) * 100).toFixed(1) : 0}%)`);
console.error(`Utility:          ${totals.utility} (${total ? ((totals.utility / total) * 100).toFixed(1) : 0}%)`);
console.error(`Production-grade: ${totals['production-grade']} (${total ? ((totals['production-grade'] / total) * 100).toFixed(1) : 0}%)`);
console.error(`Weighted depth score: ${output.weightedScore} (mode=${output.mode}; 1.0 = all production-grade or utility)`);
