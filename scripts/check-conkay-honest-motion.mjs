#!/usr/bin/env node
// scripts/check-conkay-honest-motion.mjs
//
// Standalone CI gate for the "honest-hologram motion" integrity class:
// ConKay's flagship rule (docs/CONKAY_HONEST_HOLOGRAM_PLAN.md §"Honesty
// invariant (code rule)") is that EVERY animated element is a pure function of
// a real backend event. The ALLOWED animation mechanism is
// requestAnimationFrame (rAF); the FORBIDDEN one is a timer
// (setInterval/setTimeout) driving "work"/progress animation — fake progress,
// eased fake percentages, spinners that spin on a clock instead of on data.
//
// Until now the rule was enforced only by opt-in per-panel test scans
// (ArtifactViewer / OrchestrationTracePanel / ConnectorStatusPanel /
// ForwardSimPanel each readFileSync + `.not.toMatch(/setInterval|setTimeout/)`).
// There was NO repo-wide gate — a new ConKay component could ship a
// setInterval work-driver and nothing would catch it. This closes that gap.
//
// This is a SELF-CONTAINED ratchet with its OWN explicit allowlist (below) —
// it deliberately does NOT touch the guard-protected grader/baseline files
// (scripts/autoloop/guard.mjs, audit/detectors/BASELINE.json, the graders).
// Same standalone shape as scripts/check-name-collisions.mjs /
// scripts/check-doc-claims-all.mjs.
//
// The allowlist is NARROW and self-documenting: each entry names one known-safe
// UX-teardown timer (voice re-arm, finished-spine clear, nav delay) by
// (file, snippet, reason). It is NOT a blanket per-file exemption — the snippet
// must appear on the same source line as the timer call, so a NEW timer added
// to an already-allowlisted file still fails the gate.
//
// Detection is comment/string-aware: prose comments that merely mention the
// tokens (there are several — "No setInterval, no fake progress") are NOT
// matches; only real `setInterval(` / `setTimeout(` call sites are.
//
// Usage:
//   node scripts/check-conkay-honest-motion.mjs         # human report
//   node scripts/check-conkay-honest-motion.mjs --ci    # exit 1 on any violation
//   node scripts/check-conkay-honest-motion.mjs --json   # machine-readable
//   node scripts/check-conkay-honest-motion.mjs --report # list allowlisted too

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Directories scanned (recursively). `.test.` files are excluded — test scans
// legitimately reference the forbidden tokens as string patterns.
const SCAN_DIRS = [
  "concord-frontend/components/conkay",
  "concord-frontend/lib/conkay",
];

// ---------------------------------------------------------------------------
// The allowlist. Each entry is ONE known-safe UX-teardown timer, keyed by
// (file, snippet) with a one-line reason. Narrow by construction: `snippet`
// must be a distinctive substring of the source line carrying the timer call,
// so adding a NEW timer to any of these files does not inherit the exemption.
//
// Every entry below was reviewed to confirm it drives NO work/progress
// animation — it is a mic-re-arm, a finished-state clear, or a nav delay. If a
// genuine work-animation timer ever appears, it must NOT be added here; fix the
// component to be rAF/backend-event-driven instead.
// ---------------------------------------------------------------------------
export const ALLOWLIST = [
  {
    file: "concord-frontend/components/conkay/useConKayVoice.ts",
    snippet: "startListening(); }, 350",
    reason:
      "voice envelope: re-arm speech-recognition after the mic's onend fires (debounced restart, not work animation)",
  },
  {
    file: "concord-frontend/components/conkay/useConKayVoice.ts",
    snippet: "setTimeout(() => startListening(), 250)",
    reason:
      "voice envelope: re-arm the mic 250ms after ConKay's own TTS ends so she doesn't hear herself (not work animation)",
  },
  {
    file: "concord-frontend/components/conkay/useConKayVoice.ts",
    snippet: "startFallbackListening(), 250",
    reason:
      "voice envelope: re-arm the server-STT fallback mic 250ms after TTS ends (fallback path of the above; not work animation)",
  },
  {
    file: "concord-frontend/components/conkay/ConKayOverlay.tsx",
    snippet: "setSteps([]); setWorkStatus(''); }, 1400",
    reason:
      "finished-spine clear: lets a COMPLETED work spine linger ~1400ms then unmounts it — clears real state, never animates progress",
  },
  {
    file: "concord-frontend/components/conkay/ConKayOverlay.tsx",
    snippet: "window.location.href = dest; }, 900",
    reason:
      "nav delay: 900ms hold before a skill-driven navigation so the spoken/render beat is seen before the page changes (not work animation)",
  },
  {
    file: "concord-frontend/components/conkay/useConkayContextBudget.ts",
    snippet: "timer = setInterval(fetchOnce, intervalMs);",
    reason:
      "real-data poll, not animation: re-fetches the actual /api/chat/context-budget/:sessionId endpoint on an adaptive cadence (5s over-threshold, 30s otherwise); the rendered badge is pure derived state from that real payload, and the hook self-reports 'unreachable' on any fetch failure rather than faking a value — no progress/percentage is animated on this clock.",
  },
];

// ---------------------------------------------------------------------------
// Detection core (pure, unit-testable).
// ---------------------------------------------------------------------------

// Blank a char while preserving line/column structure (keep newlines + tabs).
function blankChar(c) {
  return c === "\n" ? "\n" : c === "\t" ? "\t" : " ";
}

// A `/` in code is a REGEX start (not division) when the previous significant
// char makes an operand impossible there. Regex literals matter because ConKay
// carries `.replace(/[#*_` + "`" + `>]/g, '')`-style regexes whose inner
// quote/backtick would otherwise be mis-read as a string open, masking real
// timer calls further down the file (the gate going blind — the failure we
// must not have). This heuristic matches how JS tokenizers disambiguate.
const REGEX_PRECEDER = new Set([
  "(", "{", "[", ",", ";", ":", "?", "=", "+", "-", "*", "/", "%",
  "&", "|", "^", "!", "~", "<", ">",
]);

/**
 * Replace comment + string + regex-literal content with spaces, preserving
 * newlines and column positions, so a subsequent `setInterval(`/`setTimeout(`
 * scan can never match inside a prose comment or a string. This is what makes
 * the gate honest in BOTH directions: the ConKay files carry several comments
 * that NAME the forbidden tokens ("No setInterval, no fake progress") — those
 * must not be flagged — while regex literals are parsed so their inner
 * quotes/backticks can't swallow real code and hide a genuine timer.
 * @param {string} src
 * @returns {string} same length/line-structure, comments+strings+regex blanked
 */
export function blankCommentsAndStrings(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  // states: 0 code, 1 line-comment, 2 block-comment, 3 single-string,
  //         4 double-string, 5 template-string, 6 regex, 7 regex char-class
  let state = 0;
  let lastSig = ""; // last significant (non-space, non-comment) code char
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === 0) {
      if (c === "/" && c2 === "/") { state = 1; out.push("  "); i += 2; continue; }
      if (c === "/" && c2 === "*") { state = 2; out.push("  "); i += 2; continue; }
      if (c === "/" && (lastSig === "" || REGEX_PRECEDER.has(lastSig))) {
        state = 6; out.push(" "); i += 1; continue; // regex literal
      }
      if (c === "'") { state = 3; out.push(" "); i += 1; continue; }
      if (c === '"') { state = 4; out.push(" "); i += 1; continue; }
      if (c === "`") { state = 5; out.push(" "); i += 1; continue; }
      out.push(c);
      if (!/\s/.test(c)) lastSig = c;
      i += 1; continue;
    }
    if (state === 1) { // line comment
      if (c === "\n") { state = 0; out.push("\n"); } else out.push(blankChar(c));
      i += 1; continue;
    }
    if (state === 2) { // block comment
      if (c === "*" && c2 === "/") { state = 0; out.push("  "); i += 2; continue; }
      out.push(blankChar(c)); i += 1; continue;
    }
    if (state === 6 || state === 7) { // regex literal (7 = inside [ ] class)
      if (c === "\\") { out.push("  "); i += 2; continue; } // escape blanks the pair
      if (state === 6 && c === "[") { state = 7; out.push(" "); i += 1; continue; }
      if (state === 7 && c === "]") { state = 6; out.push(" "); i += 1; continue; }
      if (state === 6 && c === "/") { state = 0; lastSig = "/"; out.push(" "); i += 1; continue; }
      out.push(blankChar(c)); i += 1; continue;
    }
    // string states (3 single, 4 double, 5 template)
    if (c === "\\") { out.push("  "); i += 2; continue; } // escape: blank the pair
    if (state === 3 && c === "'") { state = 0; lastSig = "'"; out.push(" "); i += 1; continue; }
    if (state === 4 && c === '"') { state = 0; lastSig = '"'; out.push(" "); i += 1; continue; }
    if (state === 5 && c === "`") { state = 0; lastSig = "`"; out.push(" "); i += 1; continue; }
    out.push(blankChar(c)); i += 1; continue;
  }
  return out.join("");
}

const TIMER_RE = /\b(setInterval|setTimeout)\s*\(/g;

/**
 * Find every real timer CALL SITE in a source string. Comments + strings are
 * blanked first, so prose mentions never count. Returns the original source
 * line text for reporting + allowlist matching.
 * @param {string} src
 * @returns {Array<{kind:string, line:number, lineText:string}>}
 */
export function findTimers(src) {
  if (typeof src !== "string" || !src) return [];
  const blanked = blankCommentsAndStrings(src);
  const srcLines = src.split("\n");
  const hits = [];
  let m;
  TIMER_RE.lastIndex = 0;
  while ((m = TIMER_RE.exec(blanked)) !== null) {
    const upto = blanked.slice(0, m.index);
    const line = upto.split("\n").length; // 1-based
    hits.push({
      kind: m[1],
      line,
      lineText: (srcLines[line - 1] || "").trim(),
    });
  }
  return hits;
}

/** Is a hit (in relFile, with lineText) covered by the allowlist? */
export function isAllowlisted(relFile, lineText, allowlist = ALLOWLIST) {
  return allowlist.some(
    (e) => e.file === relFile && typeof lineText === "string" && lineText.includes(e.snippet)
  );
}

// ---------------------------------------------------------------------------
// Filesystem walk.
// ---------------------------------------------------------------------------

function relPath(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function listSourceFiles(dir, acc = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // directory absent — treated as zero files
  }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      listSourceFiles(p, acc);
    } else if (ent.isFile()) {
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      if (/\.test\./.test(ent.name)) continue; // tests may reference the tokens
      acc.push(p);
    }
  }
  return acc;
}

export function scan({ allowlist = ALLOWLIST } = {}) {
  const files = [];
  for (const d of SCAN_DIRS) listSourceFiles(path.join(ROOT, d), files);
  files.sort();
  let timersFound = 0;
  const rows = []; // { file, kind, line, lineText, allowlisted }
  for (const abs of files) {
    const rel = relPath(abs);
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const hit of findTimers(src)) {
      timersFound += 1;
      rows.push({
        file: rel,
        kind: hit.kind,
        line: hit.line,
        lineText: hit.lineText,
        allowlisted: isAllowlisted(rel, hit.lineText, allowlist),
      });
    }
  }
  return { filesScanned: files.length, timersFound, rows };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const CI = argv.includes("--ci");
  const JSON_OUT = argv.includes("--json");
  const REPORT = argv.includes("--report");

  const { filesScanned, timersFound, rows } = scan();
  const violations = rows.filter((r) => !r.allowlisted);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          filesScanned,
          timersFound,
          allowlistSize: ALLOWLIST.length,
          allowlistedTimers: timersFound - violations.length,
          violations,
        },
        null,
        2
      )
    );
    if (CI && violations.length) process.exit(1);
    return;
  }

  console.log(
    `conkay honest-motion gate — scanned ${filesScanned} ConKay source file(s); ` +
      `${timersFound} timer call-site(s), ${ALLOWLIST.length} allowlisted UX-teardown timer(s)`
  );

  if (REPORT) {
    console.log("\nAll timer call-sites (incl. allowlisted):");
    for (const r of rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${r.allowlisted ? "·" : "✗"} ${r.file}:${r.line}  ${r.kind}  ${r.lineText}`);
    }
  }

  if (!violations.length) {
    console.log(
      `\n✓ 0 un-allowlisted setInterval/setTimeout in ConKay ` +
        `(${timersFound - violations.length} known UX-teardown timer(s) covered by the allowlist)`
    );
    return;
  }

  console.log(`\n✗ ${violations.length} un-allowlisted setInterval/setTimeout in ConKay:\n`);
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${v.file}:${v.line}  ${v.kind}(  →  ${v.lineText}`);
  }
  console.log(
    `\nConKay's honesty invariant (docs/CONKAY_HONEST_HOLOGRAM_PLAN.md): every animated\n` +
      `element is a pure function of a real backend event. Timers must NOT drive\n` +
      `"work"/progress animation — use requestAnimationFrame bound to real store/socket\n` +
      `state instead. If this is a genuine one-off UX-teardown timer (mic re-arm,\n` +
      `finished-state clear, nav delay), add it to the ALLOWLIST in\n` +
      `scripts/check-conkay-honest-motion.mjs with a one-line reason.`
  );

  if (CI) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
