// server/lib/detectors/asymmetric-status-update-detector.js
//
// Catches a specific honesty-violation shape in `concord-frontend/`: a
// state setter is called in a component's SUCCESS branch but not in its
// sibling early-return refusal/error branch(es), where that same state
// variable gates which of two things a status/verify surface renders.
//
// The real bug this was drafted from (SpikingNetworkPanel.tsx, since
// fixed — see the header comment at the top of its `runDemo` function):
//   const [runCount, setRunCount] = useState(0);
//   ...
//   <VerifyCell status={runCount === 0 ? 'idle' : status} reason={reason} />
//   ...
//   async function runDemo() {
//     ...
//     const simRes = await runFrontierMacro(...);
//     if (!simRes.ok || !simRes.result) {
//       setReason(...); setStatus('refused'); return;   // setRunCount NOT called here
//     }
//     ... (more work) ...
//     setRunCount((n) => n + 1);                          // only called here
//     setStatus('ok');
//   }
// A refusal on the FIRST run of a session left `runCount === 0`, so
// `VerifyCell` rendered the real, honest 'refused' state as the idle
// "run the compute cell above" placeholder — a refusal disguised as
// never-attempted. Three real refusal paths were silently invisible.
// The fix hoists the `setRunCount` call to run UNCONDITIONALLY right
// after the `await`, before any branch — it now dominates every branch
// instead of living only in the success tail.
//
// Detection strategy (deliberately narrow — see the module's task brief:
// "a narrow detector that catches this exact shape is far better than a
// general one that fires everywhere"), two correlated phases:
//
//   Phase 1 — find "gate ternaries": `gateVar <cmp> <falsy> ? 'idle-ish
//   string' : statusVar` (and the negated/reversed forms) where the
//   string literal reads like a never-attempted placeholder (idle/empty/
//   none/pending/never/not started/no data). This identifies WHICH state
//   variable is being used to distinguish "never ran" from "here's the
//   real status" — the load-bearing correlation that lets this detector
//   tell "a counter that's fine to only bump on success" apart from "a
//   counter a status display depends on to know the difference between
//   idle and refused/errored".
//
//   Phase 2 — resolve `gateVar`'s setter via the `useState` destructure
//   (`const [gateVar, setGateVar] = useState(...)`), then, for every
//   function containing a call to that setter, look for sibling
//   early-return refusal/error branches: `if (...) { ...; return; }`
//   blocks whose body calls SOME setter with a string literal matching
//   /refused|error|fail|invalid|denied/i. If such branches exist and
//   NONE of them (nor an unconditional call that textually precedes and
//   structurally dominates all of them — the real fix's shape) contains
//   a call to the gate setter, the gate setter is asymmetric: flag it.
//
// "Dominates" is computed via a brace-depth ancestor-chain walk so a
// single hoisted call before a set of sibling `if` guards is correctly
// recognized as covering ALL of them (matching the real fix), while a
// call nested one level deeper (e.g. inside an unrelated `if`/`for`) is
// not assumed to run unconditionally. This is a regex/text heuristic,
// not a real control-flow graph — like every other detector in this
// suite, it is deliberately simple and errs toward under-flagging
// (partial branch coverage is treated as "handled elsewhere, skip") over
// over-flagging.
//
// Deliberately OUT of scope: `catch` blocks. The task brief's shape is
// specifically an "adjacent early-return refusal/error branch" — a
// `catch` is exception-triggered, not an early return, and a strict
// dominance check on the pre-fix idiom used across this codebase's
// `FrontierEngineShell`-family panels (setter called partway through a
// `try` block, before the risky `await`, sibling to `catch`) would flag
// files this task explicitly named as already fixed and off-limits as
// fixtures. Scoping to `if`-with-`return` only keeps this detector
// aligned with the literal bug shape and avoids that false alarm.
//
// Opt-out: `@asymmetric-status-update-ok-file` anywhere in the file
// suppresses the whole file; `// detector-allow: asymmetric-status-update
// <reason>` on the flagged line or up to 4 lines above suppresses just
// that finding — same convention as the sibling detectors.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "asymmetric-status-update";

const SCAN_DIRS = [
  "concord-frontend/app/lenses",
  "concord-frontend/components",
];

const SKIP_FILES = [
  /\.(?:test|spec|stories)\.(?:tsx|jsx)$/,
  /\/(?:__tests__|__mocks__|__fixtures__|storybook)\//,
  /\.d\.ts$/,
];

const FILE_ALLOW_RE = /@asymmetric-status-update-ok-file\b/;
const LINE_ALLOW_RE = /detector-allow:\s*asymmetric-status-update\b/;

function isInScope(rel) {
  if (!SCAN_DIRS.some((p) => rel.startsWith(p + "/"))) return false;
  if (SKIP_FILES.some((re) => re.test(rel))) return false;
  return true;
}

function hasAllowAnnotation(lines, lineIdx) {
  for (let j = Math.max(0, lineIdx - 4); j <= lineIdx; j++) {
    if (LINE_ALLOW_RE.test(lines[j] || "")) return true;
  }
  return false;
}

// ── String/brace-aware low-level helpers (same shape as the sibling
// detectors — regex/text heuristic, not a real parser). ──────────────────

function findMatchingParen(text, openIdx) {
  let depth = 1, i = openIdx + 1, inStr = null;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) { if (ch === "\\") { i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return text.length;
}

function findMatchingBrace(text, openIdx) {
  let depth = 1, i = openIdx + 1, inStr = null;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) { if (ch === "\\") { i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  return text.length;
}

/** Brace depth AT `idx` — the number of currently-open `{` before it (string-aware, forward scan). */
function braceDepthAt(text, idx) {
  let depth = 0, inStr = null;
  for (let i = 0; i < idx && i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === "\\") { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

/**
 * Ancestor open-brace positions enclosing `idx`, nearest first (NOT
 * string-aware on the backward walk — same accepted trade-off the sibling
 * detectors' `enclosingBlock`-style backward walks make). `starts[0]` is
 * the start of the block `idx` sits directly inside (depth D); `starts[k]`
 * is the start of the block at depth `D - k`.
 */
function ancestorBlockStarts(text, idx) {
  const starts = [];
  let skip = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "}") { skip++; continue; }
    if (ch === "{") {
      if (skip > 0) { skip--; continue; }
      starts.push(i + 1);
      continue;
    }
  }
  return starts;
}

/**
 * Does `call` (an occurrence of the gate setter) dominate `branch` (an
 * early-return refusal/if block) — i.e. does it run on every execution
 * path that could reach `branch`, because it's not nested any deeper than
 * an ancestor scope of `branch` and it textually precedes it?
 */
function callDominatesBranch(functionText, branch, call) {
  if (call.index >= branch.headIndex) return false;
  if (call.depth > branch.depth) return false;
  const starts = ancestorBlockStarts(functionText, branch.headIndex);
  const levelIdx = branch.depth - call.depth;
  if (levelIdx < 0 || levelIdx >= starts.length) return false;
  return call.index >= starts[levelIdx];
}

// ── Function-body resolution (nearest enclosing function, innermost wins) ─

const FUNC_OPEN_RE = /(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^{]+)?\{|(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?const\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*(?:React\.)?(?:memo\s*\(\s*)?(?:async\s*)?\([^)]*\)\s*(?::[^{=]+)?=>\s*\{/g;

function enclosingFunctionBody(content, declIndex) {
  FUNC_OPEN_RE.lastIndex = 0;
  let m;
  let best = null;
  while ((m = FUNC_OPEN_RE.exec(content)) != null) {
    const openBraceIdx = m.index + m[0].length - 1;
    if (openBraceIdx < 0 || openBraceIdx >= declIndex) continue;
    const closeBraceIdx = findMatchingBrace(content, openBraceIdx);
    if (closeBraceIdx > declIndex) {
      if (!best || openBraceIdx > best.openBraceIdx) best = { openBraceIdx, closeBraceIdx };
    }
  }
  if (!best) return null;
  return { start: best.openBraceIdx, end: best.closeBraceIdx };
}

// ── Phase 1: gate-ternary discovery ───────────────────────────────────────

const IDLE_WORD_RE = /\b(idle|empty|none|pending|never|not[-_ ]?(?:started|run)|no[-_ ]?data)\b/i;

// `gateVar === <falsy> ? '...' : statusVar`
const R_EQ_IDLE = /\b([A-Za-z_$][\w$]*)\s*(?:===|==)\s*(?:0|false|null|undefined|''|""|``)\s*\?\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2\s*:\s*([A-Za-z_$][\w$]*)\b/g;
// `!gateVar ? '...' : statusVar`
const R_NEG = /!\s*([A-Za-z_$][\w$]*)\s*\?\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2\s*:\s*([A-Za-z_$][\w$]*)\b/g;
// `gateVar ? statusVar : '...'` (reversed order)
const R_TRUTHY_REV = /\b([A-Za-z_$][\w$]*)\s*\?\s*([A-Za-z_$][\w$]*)\s*:\s*(['"`])((?:(?!\3)[^\\]|\\.)*)\3/g;

function findGateCandidates(content) {
  const out = [];
  const seen = new Set();
  const add = (gateVar, statusVar, strContent) => {
    if (!gateVar || !statusVar || gateVar === statusVar) return;
    if (!IDLE_WORD_RE.test(strContent)) return;
    const key = `${gateVar}::${statusVar}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ gateVar, statusVar });
  };
  let m;
  R_EQ_IDLE.lastIndex = 0;
  while ((m = R_EQ_IDLE.exec(content)) != null) add(m[1], m[4], m[3]);
  R_NEG.lastIndex = 0;
  while ((m = R_NEG.exec(content)) != null) add(m[1], m[4], m[3]);
  R_TRUTHY_REV.lastIndex = 0;
  while ((m = R_TRUTHY_REV.exec(content)) != null) add(m[1], m[2], m[4]);
  return out;
}

function findSetterFor(content, varName) {
  const re = new RegExp(`\\bconst\\s*\\[\\s*${varName}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*useState\\b`);
  const m = re.exec(content);
  return m ? m[1] : null;
}

// ── Phase 2: sibling refusal/error branch discovery + coverage check ─────

const ERROR_SETTER_CALL_RE = /\bset[A-Za-z_$][\w$]*\s*\(\s*(['"`])(?:(?!\1)[^\\]|\\.)*?(?:refused|error|fail\w*|invalid|denied)(?:(?!\1)[^\\]|\\.)*?\1/i;

/** `if (...) { ... return ...; ... }` blocks whose body sets a refusal/error-ish status. */
function findGuardBranches(functionText) {
  const branches = [];
  const ifRe = /\bif\s*\(/g;
  let m;
  while ((m = ifRe.exec(functionText)) != null) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingParen(functionText, parenOpen);
    let k = parenClose + 1;
    while (k < functionText.length && /\s/.test(functionText[k])) k++;
    if (functionText[k] !== "{") continue; // braceless `if` — not handled, keeps this heuristic simple
    const blockStart = k;
    const blockEnd = findMatchingBrace(functionText, blockStart);
    const body = functionText.slice(blockStart + 1, blockEnd);
    if (!/\breturn\b/.test(body)) continue; // must be an early-return guard
    if (!ERROR_SETTER_CALL_RE.test(body)) continue; // must set a refusal/error-ish status
    branches.push({ headIndex: m.index, blockStart, blockEnd, depth: braceDepthAt(functionText, m.index) });
  }
  return branches;
}

/**
 * For one (gateVar, setterName) pair, examine every function that calls
 * `setterName` and look for an asymmetric-coverage function. Returns an
 * array of `{ functionStart, successIndex, branchCount }` findings — one
 * per qualifying function (there can be more than one handler per file).
 */
function analyzeSetterUsage(content, setterName) {
  const results = [];
  const callRe = new RegExp(`\\b${setterName}\\s*\\(`, "g");
  const blocks = new Map(); // `${start}:${end}` -> {start,end}
  let cm;
  while ((cm = callRe.exec(content)) != null) {
    const scope = enclosingFunctionBody(content, cm.index);
    if (!scope) continue;
    const key = `${scope.start}:${scope.end}`;
    if (!blocks.has(key)) blocks.set(key, scope);
  }

  for (const scope of blocks.values()) {
    const functionText = content.slice(scope.start, scope.end + 1);
    const branches = findGuardBranches(functionText);
    if (branches.length === 0) continue;

    const localCallRe = new RegExp(`\\b${setterName}\\s*\\(`, "g");
    const callSites = [];
    let lm;
    while ((lm = localCallRe.exec(functionText)) != null) {
      callSites.push({ index: lm.index, depth: braceDepthAt(functionText, lm.index) });
    }
    if (callSites.length === 0) continue;

    for (const b of branches) {
      const insideOwnBlock = callSites.some((c) => c.index > b.blockStart && c.index < b.blockEnd);
      const dominated = callSites.some((c) => callDominatesBranch(functionText, b, c));
      b.covered = insideOwnBlock || dominated;
    }

    const anyCovered = branches.some((b) => b.covered);
    if (anyCovered) continue; // fully or partially handled — conservative skip (avoid noise on ambiguous partial cases)

    const successSite = callSites.find((c) => !branches.some((b) => c.index > b.blockStart && c.index < b.blockEnd));
    if (!successSite) continue;

    results.push({
      absoluteIndex: scope.start + successSite.index,
      branchCount: branches.length,
    });
  }
  return results;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runAsymmetricStatusUpdateDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError(CATEGORY, "no_root", null, t0);

  try {
    const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
    const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
    const files = [];
    for (const scanDir of SCAN_DIRS) {
      files.push(...await walk(path.join(root, scanDir), [".tsx"]));
    }
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      const rel = relPath(root, f);
      if (!isInScope(rel)) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      scanned++;

      if (FILE_ALLOW_RE.test(raw)) continue;

      // Comment-stripped source keeps line numbers accurate (stripComments
      // preserves every newline) but never analyzes a shape living only in
      // a doc example / commented-out code. The allow-annotation check
      // below runs against the RAW lines, not these — the annotation IS a
      // comment, so checking it against comment-stripped text would always
      // find nothing.
      const content = stripComments(raw);
      const rawLines = raw.split("\n");

      const gates = findGateCandidates(content);
      const seenSites = new Set();
      for (const { gateVar, statusVar } of gates) {
        const setterName = findSetterFor(content, gateVar);
        if (!setterName) continue; // can't verify statically — skip rather than guess
        const hits = analyzeSetterUsage(content, setterName);
        for (const hit of hits) {
          if (findings.length >= findingCap) break;
          const lineNum = lineOf(content, hit.absoluteIndex);
          const siteKey = `${setterName}:${lineNum}`;
          if (seenSites.has(siteKey)) continue; // same setter matched via >1 gate ternary
          seenSites.add(siteKey);
          if (hasAllowAnnotation(rawLines, lineNum - 1)) continue;

          findings.push({
            id: "asymmetric_status_update",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            subject: { kind: "file", path: rel, identifier: setterName },
            message: `'${setterName}' (gating '${gateVar}' in a \`${gateVar} ? … : ${statusVar}\`-shaped idle/status ternary) is called on the success path but not in ${hit.branchCount} sibling early-return refusal/error branch(es) in this function — a refusal on the first attempt renders as the idle/never-run placeholder instead of the real status.`,
            location: `${rel}:${lineNum}`,
            evidence: { setter: setterName, gateVar, statusVar, uncoveredBranches: hit.branchCount, snippet: snippet((rawLines[lineNum - 1] || "").trim(), 140) },
            fixHint: `Call ${setterName}(...) unconditionally before the refusal/error checks (so it dominates every branch), or call it explicitly inside each early-return branch too.`,
          });
        }
      }
    }

    findings.unshift({
      id: "asymmetric_status_update_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `Scanned ${scanned} frontend file(s) under app/lenses + components; flagged ${findings.length}`,
      evidence: { scanned, flagged: findings.length },
    });

    return makeReport(CATEGORY, findings, t0);
  } catch (err) {
    return makeError(CATEGORY, "exception", err, t0);
  }
}
