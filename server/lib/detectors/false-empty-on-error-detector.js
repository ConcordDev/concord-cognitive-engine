// server/lib/detectors/false-empty-on-error-detector.js
//
// "false-empty-on-error" — a frontend component that renders a macro
// result's empty fallback (`|| []` / `?? []`) as content WITHOUT
// distinguishing an actual server/transport error, so a failed fetch
// silently renders "no data" / an empty list instead of an error state.
//
// Real example (fixed 2026-07-18, commit e201116b — the projects lens):
// `lensRun()` (concord-frontend/lib/api/client.ts) is fully try/catch-wrapped
// internally and NEVER throws — on failure it resolves to
// `{ data: { ok:false, result:null, error } }`. Several projects-lens panels
// read `r.data?.result?.tasks || []` straight off that envelope with no
// `r.data?.ok` check anywhere, so an ACTUAL fetch failure silently rendered
// "No issues match these filters" — indistinguishable from a real empty
// project. The fix (ProjectsSection / PjBoardPanel / PjBacklogPanel) checks
// `r.data?.ok === false` first and renders `<ErrorState onRetry={...}>` with
// the real server reason before ever reaching the `|| []` fallback.
//
// Detection strategy — precision is the #1 requirement here (a noisy
// detector is worse than none), so every rule below is deliberately narrow
// and defaults to NOT flagging when uncertain:
//
//   1. Find identifiers bound to an awaited envelope call:
//        const NAME = await lensRun(...)
//        const NAME = await apiHelpers.<ns>.runDomain(...)  /  await X.runDomain(...)
//      or the Promise.all destructure shape actually used in this codebase
//      (the PjBoardPanel bug's exact form):
//        const [a, b, ...] = await Promise.all([lensRun(...), lensRun(...), ...])
//      — only matched positionally when the destructured-name count equals
//      the call count (otherwise ambiguous — skipped for precision).
//
//   2. For each bound NAME, compute its NEAREST ENCLOSING `{...}` block
//      (the immediately surrounding function/useCallback/useEffect body —
//      NOT the whole component; see rationale below) and search that block
//      text for the risky shape:
//        NAME(.data)?  ?.  result  ?.  <field>   (|||??)  []
//      A finding requires at least one such risky occurrence.
//
//   3. The SAME block must contain NONE of:
//        - an `.ok` check on the SAME bound variable (`NAME.data?.ok`,
//          `NAME?.ok`, `!NAME.data.ok`, `NAME.data.ok ?` ternary, …)
//        - a `try { <this await> } catch (...) { ... }` DIRECTLY wrapping
//          the assignment (the block's own opening brace is `try {` and a
//          `catch` immediately follows the block's closing brace)
//        - a `.catch(...)` chained directly on the awaited call
//          (`await apiHelpers.lens.runDomain(...).catch(() => null)`)
//        - a `setXxxError(...)` / `toast.error(...)` / `toastError(...)` call
//        - a react-query `isError` reference
//        - an `<ErrorState>` / `<ErrorBanner>` render or `role="alert"`
//      If any of these is present, the block is judged to distinguish the
//      error case and nothing is flagged for that NAME.
//
// Why block-scoped, not component-scoped: a real, already-fixed instance
// (PjBacklogPanel.tsx) has TWO independent fetch functions in the same
// component — `refresh` (which now checks `r.data?.ok===false` before its
// `|| []`) and `loadMeta` (a sibling function, unrelated variable). Scoping
// the "is this handled" search to the whole component would let refresh's
// handling of `r` silently paper over a genuinely different, unguarded `v`
// in loadMeta — the opposite of what this detector exists to catch.
// Block-scoping keeps each bound variable's judgment tied to its own
// fetch function, at the cost of occasionally missing a real handling
// pattern that lives in a sibling scope (e.g. an <ErrorState> rendered in
// the component's JSX return, gated by state set inside the fetch function
// itself) — that's the accepted precision/recall trade this detector takes:
// default to NOT flagging when the block itself already shows the ok-check
// or setError call (which is where the fix idiom in this codebase actually
// lives — see e201116b), and accept missing the rarer cross-scope case.
//
// Deliberately EXCLUDED (per the honesty-class brief):
//   - `|| []` on any value with no lensRun/runDomain source nearby (never
//     considered — occurrences are only found by walking FROM a bound
//     envelope variable, never by scanning `|| []` in isolation).
//   - Files where the SAME block already shows a react-query `isError` /
//     `error` handling idiom (useQuery/useSWR/useMutation) — treated as
//     "handled via the hook", per the brief's exclusion.
//
// Opt-out: `// detector-allow: false-empty-on-error <reason>` on the
// flagged line or up to 4 lines above suppresses that finding;
// `// @false-empty-on-error-ok-file` anywhere in the file suppresses the
// whole file (same convention as the sibling frontend detectors).

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "false-empty-on-error";

const SCAN_DIRS = [
  "concord-frontend/app",
  "concord-frontend/components",
];

const SKIP_FILES = [
  /\.(?:test|spec|stories)\.(?:tsx|jsx)$/,
  /\/(?:__tests__|__mocks__|__fixtures__|storybook)\//,
  /\.d\.ts$/,
];

const FILE_ALLOW_RE = /@false-empty-on-error-ok-file\b/;
const LINE_ALLOW_RE = /detector-allow:\s*false-empty-on-error\b/;

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Bracket/paren balanced-matching helpers (regex-based heuristic scanner,
// same trade-off as the sibling detectors — not a real AST parser). ────────

function findMatchingParen(content, openIdx, limit = 6000) {
  let depth = 1;
  let i = openIdx + 1;
  let inStr = null;
  const cap = Math.min(content.length, openIdx + limit);
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return cap;
}

function findMatchingBracket(content, openIdx, limit = 20000) {
  let depth = 1;
  let i = openIdx + 1;
  let inStr = null;
  const cap = Math.min(content.length, openIdx + limit);
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return i; }
    i++;
  }
  return cap;
}

/**
 * Nearest enclosing `{...}` block containing `idx` — backward brace-depth
 * walk to the innermost unmatched `{`, then forward to its match. Falls
 * back to the whole file when no enclosing brace exists.
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

/** Splits a comma-separated list at bracket-depth 0 (respects (), [], {}, strings). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, inStr = null, buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      buf += ch;
      if (ch === "\\") { i++; buf += text[i] ?? ""; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; buf += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((s) => s.trim());
}

// ── Source-variable discovery ───────────────────────────────────────────

// `const NAME = await lensRun(...)` / `const NAME = await apiHelpers.lens.runDomain(...)`
// / `const NAME = await X.runDomain(...)`.
const DIRECT_ASSIGN_RE = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+((?:lensRun)|(?:(?:[\w$]+\.)*runDomain))\s*\(/g;

// `const [a, b, ...] = await Promise.all([lensRun(...), apiHelpers.lens.runDomain(...), ...])`
const PROMISE_ALL_RE = /\bconst\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\s*\(\s*\[/g;
const CALL_STARTS_ENVELOPE_RE = /^(?:lensRun|(?:[\w$]+\.)*runDomain)\s*\(/;

/**
 * Returns `[{ name, index, openParenIdx }]` — every identifier bound to a
 * lensRun/runDomain envelope call. `openParenIdx` (the call's own `(`) is
 * only set for direct assigns; Promise.all-destructured entries leave it
 * null (the `.catch()`-chain check doesn't apply to a Promise.all member).
 */
function findSourceVarOccurrences(c) {
  const out = [];

  DIRECT_ASSIGN_RE.lastIndex = 0;
  let m;
  while ((m = DIRECT_ASSIGN_RE.exec(c)) != null) {
    const openParenIdx = m.index + m[0].length - 1; // index of the call's own '('
    out.push({ name: m[1], index: m.index, openParenIdx });
  }

  PROMISE_ALL_RE.lastIndex = 0;
  while ((m = PROMISE_ALL_RE.exec(c)) != null) {
    const namesRaw = m[1];
    const arrOpenIdx = m.index + m[0].length - 1; // the '[' right after Promise.all(
    const arrCloseIdx = findMatchingBracket(c, arrOpenIdx);
    const arrBody = c.slice(arrOpenIdx + 1, arrCloseIdx);
    const entries = splitTopLevel(arrBody);
    const names = namesRaw.split(",").map((s) => s.trim());
    if (names.length !== entries.length || names.length === 0) continue; // ambiguous — skip
    for (let idx = 0; idx < entries.length; idx++) {
      const name = names[idx];
      const entry = entries[idx];
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue; // skip destructure/default patterns
      if (!CALL_STARTS_ENVELOPE_RE.test(entry)) continue;
      out.push({ name, index: m.index, openParenIdx: null });
    }
  }

  return out;
}

// ── Risky "empty fallback off the envelope" pattern ─────────────────────

function findRiskyEmptyFallback(scopeText, name) {
  const esc = escapeRegExp(name);
  const re = new RegExp(
    `\\b${esc}\\b(?:\\s*\\.\\s*data)?\\s*\\?\\.\\s*result\\s*\\?\\.\\s*[A-Za-z_$][\\w$]*\\s*(?:\\|\\|\\s*\\[\\s*\\]|\\?\\?\\s*\\[\\s*\\])`,
    "g",
  );
  const out = [];
  let m;
  while ((m = re.exec(scopeText)) != null) out.push({ index: m.index, text: m[0] });
  return out;
}

// ── Error-handling recognition (all scoped to the SAME block) ───────────

function hasOkCheck(scopeText, name) {
  const esc = escapeRegExp(name);
  const re = new RegExp(`\\b${esc}\\b(?:\\s*\\.\\s*data)?\\s*(?:\\?\\.|\\.)\\s*ok\\b`);
  return re.test(scopeText);
}

const SET_ERROR_RE = /\bset[A-Za-z_$]*[Ee]rror[A-Za-z_$]*\s*\(|\btoast\.error\s*\(|\btoastError\s*\(/;
const IS_ERROR_RE = /\bisError\b/;
const ERROR_RENDER_RE = /\bErrorState\b|\bErrorBanner\b|role\s*=\s*["']alert["']/;

/**
 * Does the block's OWN opening brace read as `try {`, and does `catch`
 * immediately follow the block's closing brace? Only the DIRECT-wrap idiom
 * (`try { const r = await lensRun(...); ... } catch (...) { ... }`) counts —
 * deliberately not a general "a try/catch exists somewhere in the file"
 * scan, which would be too permissive.
 */
function isDirectTryWrap(content, block) {
  const braceIdx = block.start - 1;
  if (content[braceIdx] !== "{") return false;
  let j = braceIdx - 1;
  while (j >= 0 && /\s/.test(content[j])) j--;
  const kwEnd = j + 1;
  if (content.slice(Math.max(0, kwEnd - 3), kwEnd) !== "try") return false;
  const beforeCh = content[kwEnd - 4];
  if (beforeCh && /[\w$]/.test(beforeCh)) return false; // not a suffix of a longer ident
  const after = content.slice(block.end + 1, block.end + 30).replace(/^\s+/, "");
  return after.startsWith("catch");
}

/** `await X.runDomain(...).catch(() => null)` — promise `.catch` chained directly on the call. */
function hasPromiseCatchChain(content, openParenIdx) {
  if (openParenIdx == null) return false;
  const closeIdx = findMatchingParen(content, openParenIdx);
  const after = content.slice(closeIdx + 1, closeIdx + 1 + 12).replace(/^\s+/, "");
  return after.startsWith(".catch(") || after.startsWith(".catch (");
}

function isHandled(content, block, name, openParenIdx) {
  const scopeText = content.slice(block.start, block.end);
  if (hasOkCheck(scopeText, name)) return true;
  if (SET_ERROR_RE.test(scopeText)) return true;
  if (IS_ERROR_RE.test(scopeText)) return true;
  if (ERROR_RENDER_RE.test(scopeText)) return true;
  if (isDirectTryWrap(content, block)) return true;
  if (hasPromiseCatchChain(content, openParenIdx)) return true;
  return false;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFalseEmptyOnErrorDetector({ root, opts = {} } = {}) {
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
    let filesWithSources = 0;

    for (const f of files) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      const rel = relPath(root, f);
      if (!isInScope(rel)) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      scanned++;

      if (FILE_ALLOW_RE.test(raw)) continue;

      // Comment-stripped source for regex scanning (keeps line numbers
      // accurate; never flags a sink living in a comment/doc example).
      const c = stripComments(raw);
      const rawLines = raw.split("\n");

      const occurrences = findSourceVarOccurrences(c);
      if (occurrences.length === 0) continue;
      filesWithSources++;

      // De-dupe identical (name, blockStart) pairs — a Promise.all with
      // several envelope entries can otherwise produce redundant block
      // computations, but never redundant findings (each risky occurrence
      // is still keyed by its own line below).
      const seenPerBlock = new Set();

      for (const { name, index, openParenIdx } of occurrences) {
        const block = enclosingBlock(c, index);
        const blockKey = `${block.start}:${block.end}:${name}`;
        if (seenPerBlock.has(blockKey)) continue;
        seenPerBlock.add(blockKey);

        const scopeText = c.slice(block.start, block.end);
        const risky = findRiskyEmptyFallback(scopeText, name);
        if (risky.length === 0) continue;

        if (isHandled(c, block, name, openParenIdx)) continue;

        for (const r of risky) {
          if (findings.length >= findingCap) break;
          const absIndex = block.start + r.index;
          const lineNum = lineOf(c, absIndex);
          if (hasAllowAnnotation(rawLines, lineNum - 1)) continue;

          findings.push({
            id: "false_empty_on_error",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            subject: { kind: "file", path: rel, identifier: name },
            message:
              `'${name}' is bound to an envelope call (lensRun/runDomain) whose result flows to ` +
              `an empty-array fallback (\`${r.text}\`) with no \`.ok\` check, try/catch, setError, ` +
              `isError, or ErrorState render anywhere in the enclosing function — a real fetch ` +
              `failure will silently render as "no data" instead of an error state.`,
            location: `${rel}:${lineNum}`,
            evidence: { identifier: name, chain: r.text },
            fixHint:
              `Check the envelope's ok flag before falling back to an empty array ` +
              `(if (${name}.data?.ok === false) { setError(...); return; }), and render an ` +
              `ErrorState from that error state — see concord-frontend/components/projects/ProjectsSection.tsx for the reference fix.`,
          });
        }
        if (findings.length >= findingCap) break;
      }
    }

    findings.unshift({
      id: "false_empty_on_error_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `Scanned ${scanned} frontend file(s) under app/ + components/; ${filesWithSources} had lensRun/runDomain-bound identifiers; flagged ${findings.length}`,
      evidence: { scanned, filesWithSources, flagged: findings.length },
    });

    return makeReport(CATEGORY, findings, t0);
  } catch (err) {
    return makeError(CATEGORY, "exception", err, t0);
  }
}
