// server/lib/detectors/frontend-unsafe-chain-detector.js
//
// Catches unsafe member-chain access on API/macro response data in
// `concord-frontend/` — the bug class the 2026-07-05 verification audit
// found 48+ real instances of (commits db1a0a75 and 61122eef on
// claude/wave-abc-ci-fixes-debt-434jn3).
//
// The shape of the real bug: `POST /api/lens/run` always answers
// `{ ok: true, result: PAYLOAD }` where the outer `ok` is a transport flag,
// not the macro's own success/failure — PAYLOAD carries the real
// `{ ok, ...fields }`. Dozens of call sites read a macro-computed field
// (`.schemes`, `.listings`, `.events`, …) straight off the raw fetch/macro
// return, or off a `.data`/`.result` envelope field, with no guard at all.
// When the field doesn't exist at that level the access is `undefined`,
// and a later `.map()`/`.filter()`/`.length` throws — or worse, silently
// no-ops (`undefined?.map` swallowed by an outer try/catch), which reads
// to the player as a dead HUD / frozen panel / always-empty list.
//
// The house fix idiom (see db1a0a75, 61122eef) is:
//   const payload = j?.result ?? j;
//   if (payload?.items) payload.items.map(...)
// — an optional-chained unwrap, THEN a guard (or `?.`) before the deep
// chain. This detector flags the absence of both.
//
// Detection strategy (deliberately simple, BLOCK-scoped — same trade-off
// `collectTaintedVars` in command-injection-detector.js documents: "one-hop,
// intra-file, deliberately simple", not a real data-flow engine):
//
//   0. Scope every source-var binding to its NEAREST ENCLOSING `{...}`
//      block (found by a backward brace-depth walk from the assignment,
//      then a forward walk to the matching close). All source-var
//      detection, chain-usage scanning, AND guard detection for that
//      binding are confined to that block's text. Generic names (`res`,
//      `r`, `j`) get reused for unrelated things across a 2000-line page
//      component ALL the time — without scoping, a genuine macro-sourced
//      `res` in one hook would make an unrelated `(res) => {...}` callback
//      parameter in a totally different function get scanned too (a real
//      false positive this exact detector hit during development, on
//      `concord-frontend/app/lenses/art/page.tsx`'s `VisionAnalyzeButton`
//      `onResult` callback, colliding with an unrelated `res` bound
//      earlier in the file via `api.post(...)`). Block-scoping fixes it:
//      an unrelated callback parameter has no macro/fetch assignment
//      inside ITS OWN block, so its block never enters the tracked set.
//   1. Find identifiers assigned from a fetch/macro-call surface:
//      `await fetch(...).json()`, `await api.get/post/put/patch/delete(...)`,
//      `await lensRun(...)`, `await macroCall(...)`, a local `macro(...)`
//      helper (the `_macro.ts` / classroom / bounties idiom), or the
//      two-step `const r = await fetch(...); const j = await r.json();`.
//   2. Scan the whole file for that identifier used in a member chain
//      ending in a risky array method (`.map`/`.filter`/`.forEach`/
//      `.reduce`/`.some`/`.every`/`.find`/`.sort`/`.slice`/`.flatMap`),
//      `.length`, or any chain 2+ members deep (`res.data.listings`).
//   3. A chain is SAFE (no finding) when EITHER:
//        (a) the FIRST segment right after the base identifier is optional
//            (`res?.data.listings`) — per real JS semantics, `?.` on the
//            base short-circuits the WHOLE remainder of the chain the
//            instant the base is nullish, so nothing after it can throw
//            on account of the base being null/undefined; or
//        (b) an `if (...)`/`Array.isArray(...)` guard for that same base
//            identifier appears earlier in the file (textually precedes
//            this occurrence) — the house idiom
//            `if (payload?.items) payload.items.map(...)`.
//      Note `res.data?.listings` is NOT safe by this rule: `res.data` is a
//      plain, non-optional access evaluated before the `?.` is ever
//      reached, so it still throws if `res` is null/undefined — this is
//      the real historical bug shape (a `?.` added one link too late).
//   4. Severity: HIGH when the base var has NO guard anywhere in the file
//      (no `?.` on it, no `if (!x…) return`, no `Array.isArray(x)`, no
//      `x?.result ?? x` unwrap) — the classic zero-guard historical bug.
//      MEDIUM when SOME guard exists in the file for that name (elsewhere,
//      out of textual order, or the var is itself the product of an
//      envelope unwrap) but THIS occurrence isn't covered by it —
//      "unwrap present but a nested field still unguarded".
//
// False-positive discipline: a shallow single-property read off a source
// var (`res.ok`, `res.error`, `res.status`) is never flagged — that's
// exactly the shape a guard check takes, not the bug. Only risky-method
// calls, `.length`, or 2+-deep chains count.
//
// Opt-out: `@unsafe-chain-ok` in the file's first 5 lines suppresses the
// whole file; on the line above (or the same line as) a specific finding
// suppresses just that finding — same convention as
// frontend-ghost-click-detector.js's `@ghost-click-ok`.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "frontend-unsafe-chain";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = [
  "concord-frontend/app",
  "concord-frontend/components",
  "concord-frontend/lib",
];
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "coverage", "dist", "build", "out",
  "__tests__", "stories", "storybook",
]);
const ANNOTATION_OK_RE = /@unsafe-chain-ok\b/;
const FINDING_CAP = 500;

function isInteresting(file) {
  return /\.(tsx|ts)$/.test(file) && !file.endsWith(".d.ts");
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
  if (!SCAN_DIRS.some((p) => rel.startsWith(p + "/"))) return false;
  if (/\.(test|spec|stories)\.(tsx|ts)$/.test(rel)) return false;
  return true;
}

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function lineExempt(lines, lineNum) {
  const here = lines[lineNum - 1] || "";
  const prev = lines[lineNum - 2] || "";
  return ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Nearest enclosing `{...}` block containing `idx` (e.g. the index of a
 * `const NAME = await ...` assignment). Backward-walk brace depth to find
 * the innermost unmatched `{`, then forward-walk to its matching `}`.
 * Falls back to the whole file when no enclosing brace exists (a bare
 * top-level assignment).
 */
function enclosingBlock(content, idx) {
  let depth = 0;
  let i = idx - 1;
  while (i >= 0) {
    const ch = content[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        let fdepth = 1, j = i + 1;
        while (j < content.length && fdepth > 0) {
          if (content[j] === "{") fdepth++;
          else if (content[j] === "}") fdepth--;
          j++;
        }
        return { start: i + 1, end: fdepth === 0 ? j - 1 : content.length };
      }
      depth--;
    }
    i--;
  }
  return { start: 0, end: content.length };
}

/** Extract the balanced-paren argument substring of a call starting at `open`. */
function callArgs(content, open) {
  let depth = 0, i = open, buf = "";
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") { if (depth > 0) buf += ch; depth++; }
    else if (ch === ")") { depth--; if (depth === 0) break; buf += ch; }
    else if (depth > 0) buf += ch;
    i++;
  }
  return { text: buf, end: i + 1 };
}

// ── Source-variable detection ───────────────────────────────────────────

const ASSIGN_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+/g;
const FETCH_PREFIX_RE = /^fetch\s*\(/;
const API_CALL_PREFIX_RE = /^(?:api|apiClient|http)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/;
// `lensRun` (concord-frontend/lib/api/client.ts) is wrapped end-to-end in
// try/catch and its return type is `Promise<{ data: {...} }>` — it NEVER
// resolves to null/undefined, same guarantee as a raw axios response
// ("returns an axios-shaped { data } object" per its own doc comment).
// It gets the "axios" guard rule below. The page-local `macro()`/
// `macroCall()` helper idiom (bounties/classroom/_macro.ts/
// HUDContextProvider) is genuinely different — it explicitly
// `return r ? ... : null` / `catch { return null; }` — so it keeps the
// stricter "nullable" rule.
const LENS_RUN_PREFIX_RE = /^lensRun\s*\(/;
const MACRO_CALL_PREFIX_RE = /^(?:macroCall|macro|runMacro)\s*\(/;
const JSON_CHAIN_RE = /^\s*\.\s*json\s*\(\s*\)/;
const RECEIVER_JSON_RE = /\b(?:const|let|var\s+)?([A-Za-z_$][\w$]*)\s*=\s*await\s+([A-Za-z_$][\w$]*)\s*\.\s*json\s*\(\s*\)/g;

/**
 * Unwrap idiom: `const payload = j?.result ?? j;` (or `.data`). Presence
 * counts as a real (partial) guard event for `j`, AND marks `payload` as
 * a pre-guarded derived name so its own unguarded deep chains grade
 * medium rather than high (an unwrap already happened; a nested field
 * being unguarded is the lesser, documented residual risk).
 */
const UNWRAP_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\?\.\s*(?:result|data)\s*\?\?\s*\2\b/g;

/**
 * Scan a (block-scoped) content string for identifiers bound to a
 * fetch/macro-call JSON payload. Returns:
 *   { sourceVars: Set<string>, sourceOccurrences: Array<{name, index, kind}> }
 * `index` is the position of the ASSIGN_RE match — used by the caller to
 * find the SITE of the assignment, before block-scoping was applied, so
 * this same function also works for the whole-file first pass that
 * discovers candidate blocks.
 *
 * `kind` distinguishes two real risk profiles:
 *   - "nullable" (fetch().json(), local `macroCall()`/`macro()`/
 *     `runMacro()` page helpers) — the BOUND VARIABLE ITSELF can be
 *     null/undefined (the house `macro()` helper explicitly
 *     `return r ? ... : null`; `macroCall()` has `catch { return null }`),
 *     so the base identifier's own first link needs the `?.`.
 *   - "axios" (api.get/post/put/patch/delete via the shared axios
 *     instance, AND `lensRun()` — which documents itself as returning
 *     "an axios-shaped { data } object" and is fully try/catch-wrapped) —
 *     a resolved promise's `.data` is ALWAYS present; the base is never
 *     the throwing link. The real risk is entirely in what the server put
 *     inside `.data` (`.data.result`, `.data.ok`), so we don't require
 *     `?.` on `.data` itself — any `?.` anywhere in the chain is enough.
 */
function findSourceVars(c) {
  const responseVars = new Set(); // hold a raw fetch() Response, not yet .json()'d
  const sourceVars = new Set();   // hold a parsed JSON/macro payload
  const sourceOccurrences = [];

  let m;
  ASSIGN_RE.lastIndex = 0;
  while ((m = ASSIGN_RE.exec(c)) != null) {
    const name = m[1];
    const rhsStart = m.index + m[0].length;
    const rhs = c.slice(rhsStart, rhsStart + 4000);

    if (FETCH_PREFIX_RE.test(rhs)) {
      const openIdx = c.indexOf("(", rhsStart);
      if (openIdx < 0) continue;
      const { end } = callArgs(c, openIdx);
      const after = c.slice(end, end + 200);
      if (JSON_CHAIN_RE.test(after)) {
        sourceVars.add(name);
        sourceOccurrences.push({ name, index: m.index, kind: "nullable" });
      } else {
        responseVars.add(name);
      }
      continue;
    }
    if (API_CALL_PREFIX_RE.test(rhs) || LENS_RUN_PREFIX_RE.test(rhs)) {
      sourceVars.add(name);
      sourceOccurrences.push({ name, index: m.index, kind: "axios" });
      continue;
    }
    if (MACRO_CALL_PREFIX_RE.test(rhs)) {
      sourceVars.add(name);
      sourceOccurrences.push({ name, index: m.index, kind: "nullable" });
      continue;
    }
  }

  // Two-step: `const r = await fetch(...); const j = await r.json();`
  RECEIVER_JSON_RE.lastIndex = 0;
  while ((m = RECEIVER_JSON_RE.exec(c)) != null) {
    const [, lhs, receiver] = m;
    if (responseVars.has(receiver)) {
      sourceVars.add(lhs);
      sourceOccurrences.push({ name: lhs, index: m.index, kind: "nullable" });
    }
  }

  return { sourceVars, sourceOccurrences };
}

/** File-wide `x?.result ?? x` / `x?.data ?? x` unwrap derivations. */
function findUnwrapDerivations(c) {
  const derived = new Map(); // derivedName -> sourceName
  let m;
  UNWRAP_RE.lastIndex = 0;
  while ((m = UNWRAP_RE.exec(c)) != null) {
    derived.set(m[1], m[2]);
  }
  return derived;
}

// ── Guard detection (file-wide, per variable name — deliberately simple) ──

/**
 * Earliest index in `c` of an `if (...)`/`Array.isArray(...)` guard on
 * `name`, or -1 if none exists. Used two ways: (1) as a POSITIONAL check —
 * a guard that textually precedes a risky occurrence renders it safe
 * (the `if (payload?.items) payload.items.map(...)` idiom); (2) as a
 * file-wide "some guard exists" signal for the medium-vs-high split.
 */
function earliestGuardIndex(c, name) {
  const esc = escapeRegExp(name);
  const patterns = [
    new RegExp(`if\\s*\\(\\s*!\\s*${esc}\\b`),
    new RegExp(`if\\s*\\(\\s*${esc}\\s*&&`),
    new RegExp(`if\\s*\\(\\s*${esc}\\s*\\)`),
    new RegExp(`if\\s*\\(\\s*${esc}\\s*\\?\\.`),
    new RegExp(`Array\\.isArray\\(\\s*${esc}\\b`),
  ];
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(c);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/** Does `name?.` (base identifier immediately followed by optional chain) appear anywhere? */
function hasOptionalOnBase(c, name) {
  const esc = escapeRegExp(name);
  return new RegExp(`\\b${esc}\\?\\.`).test(c);
}

/**
 * Does an `if (...)` condition containing the exact chain-prefix text
 * (e.g. `r.data.result`) appear before `beforeIndex`? Covers the common
 * idiom `if (r.data.ok && r.data.result) { ...r.data.result.rfis... }` —
 * the guard targets a chain PREFIX, not the bare base identifier, so
 * `earliestGuardIndex` alone (which only looks at the base name) misses
 * it and would otherwise over-flag every field read inside the guarded
 * block as "zero guard".
 */
function hasPrecedingPrefixGuard(c, prefixText, beforeIndex) {
  if (!prefixText) return false;
  // Match the prefix with each `.` allowed to appear as `?.` in the GUARD
  // text. `escapeRegExp(prefixText)` alone produces literal dots, so the
  // canonical house idiom
  //     if (r.data?.result?.session) { …r.data.result.session… }
  // never matched a prefix recorded as `r.data.result.session`, and every
  // correctly-guarded read inside the block was reported as unguarded.
  // That was a pure false-negative-on-the-guard bug: `a?.b` proves exactly
  // the same thing about the path as `a.b` does — more, in fact, since it
  // also survives a null `a` — so accepting it cannot hide a real unguarded
  // chain. (2026-07-24: 26 of this detector's 27 findings were this one
  // blind spot, including the idiom the module's own header cites as
  // correct at `if (payload?.items) payload.items.map(...)`.)
  const optDot = prefixText.split(".").map(escapeRegExp).join("\\??\\.");
  // Two guard forms, both requiring the guard to PRECEDE the usage:
  //   1. `if (… prefix …)`      — statement guard
  //   2. `prefix ?` (ternary)   — expression guard, e.g.
  //        data?.zone ? { name: data.zone.name } : null
  //      The `(?!\.)` is load-bearing: it stops `prefix?.next` (an optional
  //      chain continuing) from being misread as a ternary test, which
  //      would let a genuinely unguarded deep chain mark itself safe.
  const re = new RegExp(`(?:if\\s*\\([^)]*\\b${optDot}\\b|\\b${optDot}\\b\\s*\\?(?!\\.))`, "g");
  let m;
  while ((m = re.exec(c)) != null) {
    if (m.index < beforeIndex) return true;
  }
  return false;
}

// ── Risky chain scanning ───────────────────────────────────────────────

const RISKY_METHODS = new Set([
  "map", "filter", "forEach", "reduce", "some", "every", "find", "sort", "slice", "flatMap",
]);
const CHAIN_SEG_RE = /(\?)?\.([A-Za-z_$][\w$]*)/g;

/**
 * Find every member-chain occurrence of `name` in `c` and classify it.
 * Returns an array of { index, chainText, guarded, reason } for chains
 * that qualify as "risky" (array method call, `.length`, or 2+ deep).
 *
 * `kind` selects the guard rule (see `findSourceVars` doc comment):
 *   - "nullable" (default): safe only if the FIRST link is optional —
 *     the base identifier itself can be null/undefined.
 *   - "axios": the base identifier's `.data` is guaranteed present, so
 *     any `?.` anywhere in the chain is enough (the risk lives in the
 *     server-controlled fields the axios response wraps, not in the
 *     axios response object itself).
 */
function findChainUsages(c, name, kind = "nullable") {
  const esc = escapeRegExp(name);
  const re = new RegExp(`\\b${esc}\\b(?:(?:\\?\\.|\\.)[A-Za-z_$][\\w$]*)+`, "g");
  const out = [];
  let m;
  while ((m = re.exec(c)) != null) {
    const full = m[0];
    const chainPart = full.slice(name.length);
    const segs = [...chainPart.matchAll(CHAIN_SEG_RE)].map((s) => ({ optional: s[1] === "?", ident: s[2] }));
    if (segs.length === 0) continue;
    const last = segs[segs.length - 1];
    const afterIdx = m.index + full.length;
    const after = c.slice(afterIdx, afterIdx + 4).replace(/^\s+/, "");
    const isCall = after.startsWith("(");

    // "axios" sources: the FIRST link (`.data`) is guaranteed present, so
    // merely READING a second-level field (`r.data.result`, e.g. in a
    // boolean guard check) never throws — only a THIRD level
    // (`r.data.result.institutions`) can, if `.result` turned out null.
    // Raise the deep-chain floor by one for this kind.
    const deepChainFloor = kind === "axios" ? 3 : 2;

    let reason = null;
    if (isCall && RISKY_METHODS.has(last.ident)) reason = "array_method";
    else if (!isCall && last.ident === "length") reason = "length_access";
    else if (segs.length >= deepChainFloor) reason = "deep_chain";
    if (!reason) continue;

    // "nullable" sources: safe only if the base identifier's OWN first
    // link is optional (see header comment, point 3) — a later `?.`
    // deeper in the chain does not retroactively protect an earlier
    // plain `.` access on a possibly-null base.
    // "axios" sources: the base's `.data` link can never throw, so any
    // `?.` anywhere in the chain already covers the real (server-shape)
    // risk.
    const guarded = kind === "axios" ? segs.some((s) => s.optional) : segs[0].optional === true;
    // The chain with its LAST segment dropped — e.g. for `r.data.result.rfis`
    // this is `r.data.result`. Used to recognize the
    // `if (r.data.ok && r.data.result) { ...r.data.result.rfis... }` idiom,
    // where the guard targets a chain PREFIX, not the bare base identifier.
    const lastSegRaw = (last.optional ? "?." : ".") + last.ident;
    const prefixText = segs.length >= 2 ? full.slice(0, full.length - lastSegRaw.length) : null;
    out.push({ index: m.index, chainText: full, guarded, reason, prefixText });
  }
  return out;
}

function reasonMessage(reason, name) {
  if (reason === "array_method") return `\`${name}\` chain calls an array method with no guard`;
  if (reason === "length_access") return `\`${name}\` chain reads .length with no guard`;
  return `\`${name}\` chain accesses a nested field 2+ levels deep with no guard`;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFrontendUnsafeChainDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 6000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : FINDING_CAP;
  let scanned = 0;
  let filesWithSources = 0;

  try {
    for await (const rel of walk(repoRoot)) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;

      let raw;
      try { raw = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      if (!raw) continue;

      const headLines = raw.split("\n").slice(0, 5).join("\n");
      if (ANNOTATION_OK_RE.test(headLines)) continue;

      // Comment-stripped source keeps line numbers accurate but never
      // flags a sink living in a doc example / commented-out code.
      const c = stripComments(raw);
      const { sourceOccurrences } = findSourceVars(c);
      if (sourceOccurrences.length === 0) continue;
      filesWithSources++;

      // Group occurrences by their enclosing block so unrelated sibling
      // scopes that happen to reuse the same generic name (`res`, `r`,
      // `j`) never contaminate each other (see header comment, point 0).
      const blocks = new Map(); // key `${start}:${end}` -> { start, end, text, names: Map<name, {preGuarded, srcKind}> }
      for (const { name, index, kind: srcKind } of sourceOccurrences) {
        const { start, end } = enclosingBlock(c, index);
        const key = `${start}:${end}`;
        let block = blocks.get(key);
        if (!block) {
          block = { start, end, text: c.slice(start, end), names: new Map() };
          blocks.set(key, block);
        }
        if (!block.names.has(name)) block.names.set(name, { preGuarded: false, srcKind });
      }
      // Unwrap-derived vars (`const payload = j?.result ?? j;`) local to
      // each block are pre-guarded — track them alongside raw sources.
      // They inherit the "nullable" rule (the unwrap expression itself
      // already handles the base's nullability; what's left to guard is
      // the derived object's own fields).
      for (const block of blocks.values()) {
        const derived = findUnwrapDerivations(block.text);
        for (const derivedName of derived.keys()) {
          if (!block.names.has(derivedName)) block.names.set(derivedName, { preGuarded: true, srcKind: "nullable" });
        }
      }

      const fileLines = raw.split("\n");

      for (const block of blocks.values()) {
        for (const [name, { preGuarded, srcKind }] of block.names) {
          const usages = findChainUsages(block.text, name, srcKind);
          if (usages.length === 0) continue;
          const guardIdxLocal = earliestGuardIndex(block.text, name);
          // "Some guard exists" signal for the medium-vs-high split —
          // scoped to this block (deliberately still not fully
          // order/branch-aware within the block — see header comment's
          // `collectTaintedVars` precedent).
          const anyPrefixGuard = usages.some(
            (u) => u.prefixText && new RegExp(`if\\s*\\([^)]*\\b${escapeRegExp(u.prefixText)}\\b`).test(block.text)
          );
          const anyGuard = preGuarded || guardIdxLocal !== -1 || hasOptionalOnBase(block.text, name) || anyPrefixGuard;
          for (const u of usages) {
            if (u.guarded) continue; // base identifier's own `?.` — fully safe
            // A guard for this identifier textually precedes this specific
            // occurrence — the `if (payload?.items) payload.items.map(...)`
            // idiom. Treat as fully safe, not merely "partial".
            if (guardIdxLocal !== -1 && guardIdxLocal < u.index) continue;
            // A guard targets the chain's own PREFIX rather than the bare
            // base identifier — `if (r.data.ok && r.data.result) { ...
            // r.data.result.rfis ... }`. Also fully safe.
            if (hasPrecedingPrefixGuard(block.text, u.prefixText, u.index)) continue;
            if (findings.length >= findingCap) break;
            const absIndex = block.start + u.index;
            const lineNum = lineNumberAt(c, absIndex);
            if (lineExempt(fileLines, lineNum)) continue;
            const severity = anyGuard ? "medium" : "high";
            findings.push({
              id: severity === "high" ? "unsafe_chain_no_guard" : "unsafe_chain_partial_guard",
              severity,
              kind: "static",
              category: CATEGORY,
              message:
                `${reasonMessage(u.reason, name)} — the same bug class as the 2026-07-05 ` +
                `/api/lens/run envelope audit (48+ real instances fixed in db1a0a75/61122eef). ` +
                `Chain: \`${u.chainText}\`.`,
              location: `${rel}:${lineNum}`,
              subject: { kind: "frontend_unsafe_chain", file: rel },
              evidence: { chain: u.chainText, reason: u.reason, anyGuardInScope: anyGuard },
              fixHint:
                severity === "high"
                  ? "Unwrap the envelope first (`const payload = x?.result ?? x;`) and guard the field before .map/.filter/.length, or use `?.` throughout the chain."
                  : "A guard exists elsewhere in this scope for this variable, but this chain still accesses a nested field unguarded — add `?.` or an explicit if-check before this specific access.",
            });
          }
          if (findings.length >= findingCap) break;
        }
        if (findings.length >= findingCap) break;
      }
      if (findings.length >= findingCap) break;
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  findings.unshift({
    id: "frontend_unsafe_chain_summary",
    severity: "info",
    kind: "static",
    category: CATEGORY,
    message: `Scanned ${scanned} frontend file(s); ${filesWithSources} had fetch/macro-sourced data; flagged ${findings.length}`,
    evidence: { scanned, filesWithSources },
  });

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
