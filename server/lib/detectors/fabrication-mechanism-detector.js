// server/lib/detectors/fabrication-mechanism-detector.js
//
// Mechanism-based fabrication detector.
//
// `fake-data-detector.js` already catches NAME-based fabrication — an
// identifier literally called `fake`/`mock`/`stub`. It has zero coverage of
// fabrication that carries no incriminating name: a `Math.random()` value
// wired into a metric/score/progress/telemetry-shaped field and rendered to
// the user (or shipped in an API/DTU payload) as if it were real. That is a
// MECHANISM, not a marker — grep for "fake" never finds it.
//
// Seeded from a real session (commit c74b60d6): `MixerPeekStrip.tsx`'s VU
// meter fabricated a level with no disclosure, and `NeuroActionPanel.tsx`'s
// `generateChannels()` produced synthetic EEG data that could be Minted /
// Published as if it were a real biosignal recording. The fix in both cases
// was disclosure (a visible label, a `synthetic: true` stamp on the
// payload) — the randomness itself is fine; being silent about it is the
// violation ("honest by construction", CLAUDE.md §3).
//
// Detection strategy (deliberately narrow — a regex detector cannot do real
// data-flow analysis, and a detector that cries wolf on this codebase's
// enormous amount of *legitimate* randomness — combat rolls, loot tables,
// NPC routines, weather, procgen — gets muted and might as well not exist):
//
//   1. Find `Math.random(` call sites.
//   2. Look at a small window of lines around each site and ask: does
//      Math.random() flow (same statement, or one hop through an
//      intermediate variable) into something whose NAME is metric-shaped
//      (score/progress/percent/level/telemetry/latency/uptime/power/count/
//      rate/health/status/signal/reading/metric)? This mirrors the
//      command-injection detector's one-hop taint tracking
//      (`collectTaintedVars` / `interpReferencesTainted`) — deliberately
//      simple, not a real dataflow engine.
//   3. If so, require independent corroboration that the value actually
//      reaches a user or an API: either (a) the SAME dictionary word shows
//      up as a JSX prop binding or text interpolation elsewhere in the file
//      (`level={level}`, `{level}`), or (b) the surrounding code sends
//      through `fetch`/`axios`/`api.post`/`res.json`/a DTU-mint/`runMacro`
//      call. Neither present → no finding (conservative: a Math.random()
//      feeding a metric-named LOCAL that never leaves the function is not
//      user-facing fabrication).
//   4. Skip the acknowledged game/sim allowlist (emergent modules, NPC
//      libs, procgen, sim, combat, creature, faction, weather, dice,
//      shuffle) where randomness is the actual mechanic, not a stand-in for
//      a real measurement.
//   5. Skip when the surrounding code is plainly ID/timing generation
//      (jitter/backoff/nonce/salt/seed/uuid/id) rather than fake data.
//
// A second, independent rule flags the "fake progress bar" antipattern
// this repo's own doc calls out by name (CLAUDE.md: "no setInterval/
// fake-progress"): a `setInterval` body that ticks a progress/percent-named
// setState with an expression that references nothing but the previous
// value and numeric literals — i.e. a bar that always fills at a fixed
// rate no matter what the real underlying work is doing.
//
// `// detector-allow: fabrication <reason>` on the flagged line (or up to 4
// lines above) suppresses a finding — same opt-out shape as the other
// security/quality detectors in this suite (`@fake-data-ok`, `@sync-fs-ok`,
// …), spelled out per this detector's own contract.
//
// Severity: findings here are "high" — same tier fake-data-detector uses
// for an exported fake identifier in production. Not "critical": this is a
// UI/data-honesty defect, not a security or money-conservation break.

import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "fabrication-mechanism";

// ── Path allowlist — randomness IS the mechanic here, not a stand-in for a
// real measurement. Matched against the repo-relative path.
const ALLOWLIST_PATH_RES = [
  /(?:^|\/)server\/emergent\//i,
  /(?:^|\/)server\/lib\/npc-[^/]*\.[cm]?[jt]sx?$/i,
  /procgen/i,
  /(?:^|\/)sim\//i,
  /combat/i,
  /creature/i,
  /faction/i,
  /weather/i,
  /dice/i,
  /shuffle/i,
];

function isAllowlistedPath(rel) {
  return ALLOWLIST_PATH_RES.some((re) => re.test(rel));
}

// Files we never want to scan at all.
const SKIP_FILES = [
  /\/(?:audit|reports|docs|skills|content|monitoring|nginx|k8s|load-tests)\//,
  /\.d\.ts$/,
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx|jsx)$/,
  /(?:^|\/)(tests?|__tests__|specs?|fixtures?)\//,
  // The detector suite itself documents this exact pattern in comments and
  // would tautologically flag its own source.
  /\/lib\/detectors\//,
];

// ── Metric-shaped identifier vocabulary ─────────────────────────────────
const METRIC_WORDS = new Set([
  "score", "progress", "percent", "percentage", "level", "telemetry",
  "latency", "uptime", "power", "count", "rate", "health", "status",
  "signal", "reading", "metric",
]);

// Words whose presence near a Math.random() call signal ID/timing
// generation, not fabricated data.
const EXCLUDE_CONTEXT_RE = /\b(jitter|backoff|nonce|salt|seed)\b/i;

/** Split a camelCase / snake_case / PascalCase identifier into lowercase words. */
function splitIdentWords(ident) {
  return String(ident)
    .replace(/[_$]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Returns the matched metric word, or null. */
function identHasMetricWord(ident) {
  if (!ident) return null;
  for (const w of splitIdentWords(ident)) {
    if (METRIC_WORDS.has(w)) return w;
    const singular = w.replace(/s$/, "");
    if (singular !== w && METRIC_WORDS.has(singular)) return singular;
  }
  return null;
}

const ID_WORDS = new Set(["id", "uid", "uuid", "guid"]);

/** True if any identifier in the text splits into an "id"/"uid"/"uuid"/"guid" word. */
function windowHasIdOrUuid(text) {
  const idents = text.match(/[A-Za-z_$][\w$]*/g) || [];
  for (const id of idents) {
    const words = splitIdentWords(id);
    if (words.some((w) => ID_WORDS.has(w))) return true;
  }
  return false;
}

const DETECTOR_ALLOW_RE = /detector-allow:\s*fabrication\b/;

/** `// detector-allow: fabrication <reason>` on the line itself or up to 4 lines above. */
function hasAllowAnnotation(lines, lineIdx) {
  for (let j = Math.max(0, lineIdx - 4); j <= lineIdx; j++) {
    if (DETECTOR_ALLOW_RE.test(lines[j] || "")) return true;
  }
  return false;
}

// ── Assignment extraction (one-hop, regex-based — see file header) ──────
//
// Each "head" regex matches only up to the start of the RHS expression;
// the RHS text itself is then extracted via bracket-balanced scanning
// (`expressionSpan` / `boundedBlock`) rather than a `[^;\n]+` character
// class. A naive single-line-or-else-rest-of-window rule was tried first
// and produced a real false positive: a `function statusOptionsFor(type)
// {...}` declared a few lines above an UNRELATED later `Math.random()`
// call had its "rhs" captured as the rest of the window (everything after
// its own declaration, including that later call) — so an ordinary status
// enum function looked like it "contained" a Math.random() from code that
// wasn't even inside its body. Bracket-balancing fixes this: the RHS of a
// declaration/key/member ends at its own top-level `;`/`,`/closing
// bracket, and a function body ends at ITS OWN matching `}` — never
// bleeding into whatever comes after it in the window.

const DECL_HEAD_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
// Object-literal key: `level: <expr>` — excludes ternary `? :` (no leading ?)
// and avoids matching inside a preceding `.`/word (member access) or a
// double-colon (`::`) / type-annotation colon-colon shape.
const KEY_HEAD_RE = /(?<![.\w?])([A-Za-z_$][\w$]*)\s*:\s*(?!:)/g;
const SETTER_HEAD_RE = /\bset([A-Z][\w$]*)\s*\(/g;
const MEMBER_ASSIGN_HEAD_RE = /\.([A-Za-z_$][\w$]*)\s*=\s*(?!=)/g;
const FUNC_DECL_RE = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Scan forward from `start` (just past a `=`/`:`) and return the RHS
 * expression text, stopping at the first top-level `;`, `,`, or a closing
 * bracket that doesn't match something opened after `start` — i.e. we've
 * walked out of the expression into whatever encloses it. Tracks
 * (){}[] and string/template-literal state so nested commas/braces don't
 * terminate early.
 */
function expressionSpan(text, start, maxLen = 4000) {
  let depth = 0;
  let str = null;
  const end = Math.min(text.length, start + maxLen);
  for (let i = start; i < end; i++) {
    const ch = text[i];
    if (str) {
      if (ch === "\\") { i++; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return text.slice(start, i);
      depth--;
      continue;
    }
    if (depth === 0 && (ch === ";" || ch === ",")) return text.slice(start, i);
  }
  return text.slice(start, end);
}

/** Bracket-balanced block starting at an opening `{` (inclusive), bounded by `maxLen`. */
function boundedBlock(text, openBraceIdx, maxLen = 6000) {
  let depth = 0;
  const end = Math.min(text.length, openBraceIdx + maxLen);
  for (let i = openBraceIdx; i < end; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(openBraceIdx, i + 1); }
  }
  return text.slice(openBraceIdx, end);
}

/** Bracket-balanced call-argument text, `open` = index of the call's `(`. */
function balancedParenArgs(text, open) {
  let depth = 0, i = open, buf = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "(") { if (depth > 0) buf += ch; depth++; }
    else if (ch === ")") { depth--; if (depth === 0) break; buf += ch; }
    else if (depth > 0) buf += ch;
    i++;
  }
  return buf;
}

/**
 * Extract a best-effort list of { target, rhs } pairs from a text window.
 * Not a parser — regex-located heads + bracket-balanced RHS extraction,
 * tuned to the shapes this detector cares about (see file header for the
 * one-hop taint-tracking rationale).
 */
function extractAssignments(winStr) {
  const out = [];
  let m;

  DECL_HEAD_RE.lastIndex = 0;
  while ((m = DECL_HEAD_RE.exec(winStr)) != null) {
    out.push({ target: m[1], rhs: expressionSpan(winStr, m.index + m[0].length) });
  }

  KEY_HEAD_RE.lastIndex = 0;
  while ((m = KEY_HEAD_RE.exec(winStr)) != null) {
    out.push({ target: m[1], rhs: expressionSpan(winStr, m.index + m[0].length) });
  }

  SETTER_HEAD_RE.lastIndex = 0;
  while ((m = SETTER_HEAD_RE.exec(winStr)) != null) {
    const openParen = m.index + m[0].length - 1;
    out.push({ target: m[1], rhs: balancedParenArgs(winStr, openParen) });
  }

  MEMBER_ASSIGN_HEAD_RE.lastIndex = 0;
  while ((m = MEMBER_ASSIGN_HEAD_RE.exec(winStr)) != null) {
    out.push({ target: m[1], rhs: expressionSpan(winStr, m.index + m[0].length) });
  }

  FUNC_DECL_RE.lastIndex = 0;
  while ((m = FUNC_DECL_RE.exec(winStr)) != null) {
    const openBrace = winStr.indexOf("{", m.index);
    const rhs = openBrace >= 0 ? boundedBlock(winStr, openBrace) : "";
    out.push({ target: m[1], rhs });
  }

  return out;
}

const RANDOM_RE = /Math\.random\s*\(/;

/**
 * Find a metric-shaped fabrication target within a text window: either a
 * direct assignment whose RHS contains Math.random(), or a metric-named
 * assignment whose RHS references a variable that was itself assigned
 * directly from Math.random() elsewhere in the same window (one hop).
 */
export function findFabricationTarget(winStr) {
  const assigns = extractAssignments(winStr);

  for (const a of assigns) {
    if (RANDOM_RE.test(a.rhs)) {
      const word = identHasMetricWord(a.target);
      if (word) return { target: a.target, word };
    }
  }

  const randomVars = new Set();
  for (const a of assigns) {
    if (RANDOM_RE.test(a.rhs) && !identHasMetricWord(a.target)) randomVars.add(a.target);
  }
  if (randomVars.size) {
    for (const a of assigns) {
      const word = identHasMetricWord(a.target);
      if (!word) continue;
      const refs = a.rhs.match(/[A-Za-z_$][\w$]*/g) || [];
      if (refs.some((r) => randomVars.has(r))) return { target: a.target, word };
    }
  }

  return null;
}

// ── Corroboration: does the value actually reach a user or an API? ─────

const API_SEND_RE = /\b(?:fetch|axios\.\w+|api\.(?:post|put|get|patch)|res\.(?:json|send)|mintCoins|mintDtu|dtu\.create|dtus\.create|createDTU|runMacro)\s*\(/i;

export function apiSendEvidence(text) {
  return API_SEND_RE.test(text);
}

export function jsxRenderEvidence(content, word) {
  if (!word) return false;
  const w = word.replace(/[^a-zA-Z0-9_$]/g, "");
  if (!w) return false;
  const propRe = new RegExp(`\\b${w}\\s*=\\s*\\{`, "i");
  const textRe = new RegExp(`\\{\\s*${w}\\s*\\}`, "i");
  return propRe.test(content) || textRe.test(content);
}

// ── Rule 2: setInterval "fake progress bar" ─────────────────────────────

const SET_INTERVAL_RE = /setInterval\s*\(/g;
const PROGRESS_WORDS = new Set(["progress", "percent", "percentage"]);
const SELF_PARAM_NAMES = new Set(["prev", "p", "old", "curr", "current", "c", "val", "v"]);
const SAFE_GLOBALS = new Set([
  "Math", "Number", "String", "Boolean", "Date", "JSON", "Array", "Object",
  "parseInt", "parseFloat", "Infinity", "NaN", "undefined", "null", "true", "false",
]);
const ASYNC_POLL_RE = /\b(?:await|fetch|axios\.|\.then\s*\()/;

function nonGlobalIdents(argExpr) {
  const noMembers = String(argExpr || "").replace(/\.[A-Za-z_$][\w$]*/g, "");
  return (noMembers.match(/[A-Za-z_$][\w$]*/g) || []).filter((id) => !SAFE_GLOBALS.has(id));
}

/** Does an increment expression reference anything beyond the self-param and JS globals? */
export function argHasRealComputation(argExpr, paramNames) {
  return nonGlobalIdents(argExpr).some((id) => !paramNames.has(id.toLowerCase()));
}

/**
 * Does the expression reference the self/prev parameter at all? A bare
 * reset like `setProgress(0)` or a cap like `setProgress(80)` references
 * nothing — it's not an "increment" in the fake-progress-bar sense (see
 * CLAUDE.md's own ban on this exact antipattern), just a completion/reset
 * write, and must NOT be flagged alongside genuine `prev => prev + N`
 * ticks.
 */
export function argReferencesSelf(argExpr, paramNames) {
  return nonGlobalIdents(argExpr).some((id) => paramNames.has(id.toLowerCase()));
}

const SETTER_CALL_RE = /\bset([A-Z][\w$]*)\s*\(\s*(?:\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*)?([\s\S]*?)\)\s*;/g;

/**
 * Scan a setInterval callback body for a progress/percent setter whose
 * increment expression self-references (proving it's an increment, not a
 * reset/cap) but has no real backing computation beyond that.
 */
export function findFakeProgressSetter(body) {
  SETTER_CALL_RE.lastIndex = 0;
  let m;
  while ((m = SETTER_CALL_RE.exec(body)) != null) {
    const stateName = m[1];
    const paramName = m[2];
    const argExpr = m[3];
    const word = identHasMetricWord(stateName);
    if (!word || !PROGRESS_WORDS.has(word)) continue;
    const paramNames = new Set(SELF_PARAM_NAMES);
    if (paramName) paramNames.add(paramName.toLowerCase());
    paramNames.add(stateName.toLowerCase());
    if (argReferencesSelf(argExpr, paramNames) && !argHasRealComputation(argExpr, paramNames)) {
      return { stateName, argExpr: argExpr.trim() };
    }
  }
  return null;
}

export async function runFabricationMechanismDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError(CATEGORY, "no_root", null, t0);

  try {
    const exts = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];
    const files = await walk(root, exts);
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      scanned++;

      const allowlisted = isAllowlistedPath(rel);
      const c = stripComments(raw);
      const lines = c.split("\n");
      // The `// detector-allow: fabrication` annotation lives INSIDE a
      // comment, which stripComments just erased — check it against the
      // raw, unstripped lines (stripComments preserves line count/newlines
      // so the two line arrays stay index-aligned).
      const rawLines = raw.split("\n");

      // ── Rule 1: Math.random() → metric-shaped target → rendered/sent.
      const randomRe = /Math\.random\s*\(/g;
      let rm;
      while ((rm = randomRe.exec(c)) != null) {
        if (findings.length > 500) break;
        const lineNum = lineOf(c, rm.index);
        const lineIdx = lineNum - 1;
        if (hasAllowAnnotation(rawLines, lineIdx)) continue;

        const winStart = Math.max(0, lineIdx - 10);
        const winEnd = Math.min(lines.length, lineIdx + 5);
        const winStr = lines.slice(winStart, winEnd).join("\n");

        if (allowlisted) continue;
        if (EXCLUDE_CONTEXT_RE.test(winStr) || windowHasIdOrUuid(winStr)) continue;

        const found = findFabricationTarget(winStr);
        if (!found) continue;

        const rendered = jsxRenderEvidence(c, found.word);
        const sent = apiSendEvidence(winStr) || apiSendEvidence(c.slice(rm.index, Math.min(c.length, rm.index + 2000)));
        if (!rendered && !sent) continue;

        findings.push({
          id: "fabrication_random_metric",
          severity: "high",
          kind: "static",
          category: CATEGORY,
          subject: { kind: "file", path: rel, identifier: found.target },
          message: `Math.random() flows into '${found.target}' (matches metric word '${found.word}') which is ${rendered ? "rendered in JSX" : "sent to an API/DTU-mint call"} with no synthetic/simulated disclosure`,
          location: `${rel}:${lineNum}`,
          evidence: { snippet: snippet(lines[lineIdx]?.trim(), 140), matchedWord: found.word, rendered, sent },
          fixHint: "Disclose the synthetic/simulated nature in the UI and stamp synthetic:true on any API/DTU payload derived from this value, or replace with a real measured/computed value.",
        });
      }
      if (findings.length > 500) break;

      // ── Rule 2: setInterval fake-progress antipattern.
      if (!allowlisted) {
        SET_INTERVAL_RE.lastIndex = 0;
        let sm;
        while ((sm = SET_INTERVAL_RE.exec(c)) != null) {
          if (findings.length > 500) break;
          const open = c.indexOf("(", sm.index + "setInterval".length);
          if (open < 0) continue;
          const args = balancedParenArgs(c, open);
          if (ASYNC_POLL_RE.test(args)) continue; // real async polling, not fabricated

          const lineNum = lineOf(c, sm.index);
          const lineIdx = lineNum - 1;
          if (hasAllowAnnotation(rawLines, lineIdx)) continue;

          const fake = findFakeProgressSetter(args);
          if (!fake) continue;

          findings.push({
            id: "fabrication_fake_progress_interval",
            severity: "high",
            kind: "static",
            category: CATEGORY,
            subject: { kind: "file", path: rel, identifier: fake.stateName },
            message: `setInterval ticks '${fake.stateName}' with '${snippet(fake.argExpr, 60)}' — no real backing computation (fake progress bar)`,
            location: `${rel}:${lineNum}`,
            evidence: { argExpr: snippet(fake.argExpr, 140) },
            fixHint: "Derive the value from real backing state (bytes transferred, steps completed, server-reported percentage), or stop presenting the animation as literal progress.",
          });
        }
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "fabrication_mechanism_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `Scanned ${scanned} file(s); flagged ${findings.length}`,
      evidence: { scanned, flagged: findings.length },
    });

    return makeReport(CATEGORY, findings, t0);
  } catch (err) {
    return makeError(CATEGORY, "exception", err, t0);
  }
}
