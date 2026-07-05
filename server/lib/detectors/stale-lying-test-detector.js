// server/lib/detectors/stale-lying-test-detector.js
//
// "Stale lying test" detector — catches tests that assert against SOURCE
// CODE STRINGS instead of real runtime behavior. The anti-pattern:
//
//   const src = readFileSync(SomeComponent.tsx, 'utf8');
//   it('wires the button to dispatch the FooEvent', () => {
//     expect(src).toMatch(/dispatchEvent\(.*FooEvent/);
//   });
//
// This "test" can never meaningfully fail from a behavior regression — it
// only fails if someone edits the SOURCE TEXT (renames a variable, reformats
// a line, changes quote style). Nothing renders, nothing dispatches, nothing
// runs. The title claims a behavior ("wires... dispatch...") the body never
// exercises.
//
// Seeded from a REAL miss found in this session's verification audit
// (fixed in commit 75d46fb4, branch claude/wave-abc-ci-fixes-debt-434jn3):
// `concord-frontend/tests/command-palette-wired.test.tsx`'s
// "wires run-mode start dispatches via the GameModesHotbarGroup" test (and
// the sibling `game-modes-hotbar-wired.test.tsx` file) both regex-matched
// two source files for the string `concordia:start-mode` and an
// `addEventListener(...)` call — and PASSED even though, at the time, the
// command palette never actually dispatched that event. The real bug (the
// palette had no run-mode entries at all) was invisible to the "test" suite
// because the suite tested the text of the files, not their behavior. The
// fix (same commit) replaced the source-string assertions with real
// `render()` + `fireEvent` + `dispatchEvent` interaction tests that fail
// when the wiring is actually broken.
//
// Precision discipline — NOT every `readFileSync` + regex test is bad. Some
// genuinely-static claims are legitimate uses of source-string matching:
// "this file exists", "this constant equals X", a doc-claims-style
// reproduction check. The signal this detector hunts for is narrower: a
// MISMATCH between what the test's own name (or a comment right above it)
// CLAIMS to verify (a runtime behavior — wiring/dispatch/firing/handling/
// rendering/opening/closing something) and what the test body ACTUALLY does
// (read a file's text and regex/substring-match it, with zero render, zero
// simulated interaction, zero call-was-made assertion). A test titled
// "exports the correct constant" that reads a config file and matches a
// value is NOT flagged — it never claimed to test behavior.
//
// Detection strategy (regex/span based, consistent with this detector
// suite's existing style — not a full AST parse):
//   1. Only consider `it(...)` / `test(...)` blocks (optionally `.only`/
//      `.skip`) inside `*.test.{ts,tsx,js,jsx}` / `*.spec.{ts,tsx,js,jsx}`
//      files under concord-frontend/.
//   2. Track every variable bound to `readFileSync(...)` anywhere in the
//      file (`fileVars`), best-effort filtered to source-code targets
//      (`.ts`/`.tsx`/`.js`/`.jsx`, not the test's own file, not an obviously
//      non-source extension like `.json`/`.yml`/`.md`).
//   3. Find every `expect(<expr>).toMatch(/…/)` / `.toContain(…)` and every
//      bare `<var>.match(…)` / `<var>.includes(…)` whose `<expr>`/`<var>`
//      references a tracked file-content variable (or inlines
//      `readFileSync(...)` directly) — these are "source-string assertion"
//      spans.
//   4. Find every "runtime indicator" span — `render(`, `fireEvent`,
//      `screen.`, `userEvent.`, `waitFor(`, `mount(`, `shallow(`, `act(`,
//      `.toHaveBeenCalled*(`, `dispatchEvent(`, `new Component(`, or a raw
//      JSX tag `<Component` — EXCLUDING any such text that falls inside a
//      source-string-assertion span (so `expect(src).toMatch(/<Foo \/>/)`
//      does not get miscounted as "this test renders <Foo>").
//   5. For each it/test block: if its title (or a `//` comment on the 1-2
//      lines directly above it, or its enclosing `describe(...)` title)
//      contains a behavior-claim word (wires/dispatches/fires/calls/
//      triggers/handles/renders/opens/closes, any tense) AND the block
//      contains a source-string-assertion span AND the block contains NO
//      runtime-indicator span → flag it. Severity: medium (a real coverage
//      gap, not a crash — but per this repo's own "verification IS the
//      product" thesis, a test that structurally cannot fail from the bug
//      it claims to guard against is close to as bad as having no test).

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const TEST_FILE_RE = /\.(?:test|spec)\.(?:tsx?|jsx?)$/;

// Behavior-claim vocabulary, per the session's naming (any common tense).
//
// The `(?<![.:])` guard matters: without it, "concordia:open-dialogue" and
// "ar.render" (an event name and a macro reference, both common in this
// codebase's test titles) spuriously match "open"/"render" as if they were
// the English verb — the title isn't claiming the test opens or renders
// anything, it's just naming an identifier. Requiring the match NOT be
// immediately preceded by `.` or `:` (namespaced-identifier access) filters
// that out while leaving genuine prose ("dispatches concordia:foo", "renders
// sonar contacts list") untouched, since there the keyword is preceded by a
// space, not a punctuation-joined identifier.
const BEHAVIOR_CLAIM_RE =
  /(?<![.:])\b(wire[sd]?|wiring|dispatch(?:e[sd])?|dispatching|fire[sd]?|firing|call(?:s|ed|ing)?|trigger(?:s|ed|ing)?|handle[sd]?|handling|render(?:s|ed|ing)?|open(?:s|ed|ing)?|close[sd]?|closing)\b/i;

// Text that proves a test actually exercises runtime behavior rather than
// only reading source text. Kept deliberately broad (any one hit disqualifies
// a block from being flagged) — precision comes from EXCLUDING hits that
// live inside a source-string-assertion span (see collectAssertionSpans).
const RUNTIME_INDICATOR_RE =
  /\brender\s*\(|\bfireEvent\b|\bscreen\s*\.|\buserEvent\s*\.|\bwaitFor\s*\(|\bmount\s*\(|\bshallow\s*\(|\bact\s*\(|\.toHaveBeenCalled\w*\s*\(|\bdispatchEvent\s*\(|\bnew\s+[A-Z]\w*\s*\(|<[A-Z][\w.]*[\s/>]/g;

const READFILESYNC_ASSIGN_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*readFileSync\s*\(/g;
const PATHVAR_ASSIGN_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:resolve|join)\s*\(/g;
const NON_SOURCE_EXT_RE = /\.(?:json|ya?ml|md|txt|csv|lock)['"`]/i;
const SOURCE_EXT_RE = /\.(?:tsx|ts|jsx|js|mjs|cjs)$/i;
const TEST_OR_SPEC_EXT_RE = /\.(?:test|spec)\.(?:tsx|ts|jsx|js)$/i;

const TEST_CALL_RE = /(^|[^.\w$])(it|test)(?:\.(?:only|skip))?\s*\(/g;
const DESCRIBE_CALL_RE = /(^|[^.\w$])describe(?:\.(?:only|skip))?\s*\(/g;
const TITLE_RE = /^\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/;
const EXPECT_RE = /\bexpect\s*\(/g;
const TRAILING_ASSERT_RE = /^\s*\.\s*(?:not\s*\.\s*)?(?:toMatch|toContain)\s*\(/;
const BARE_MATCH_RE = /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:match|includes)\s*\(/g;

const SKIP_FILES = [
  // The detector's own fixtures/tests carry seed examples of the very
  // pattern it hunts for; scanning them is meta-noise.
  /\/lib\/detectors\//,
];

// Test-assertion source is full of regex literals (`.toMatch(/['"]k['"]/)`),
// and a naive string-tracker treats the quote characters INSIDE the regex
// as string delimiters — desyncing depth-counting and swallowing the rest of
// the file. `looksLikeRegexStart` + `scanRegexLiteral` give `extractBalanced`
// just enough JS-lexer awareness to skip a `/regex/flags` span as one opaque
// unit, the same ambiguity every hand-rolled JS tokenizer has to resolve.
const REGEX_PRECEDING_CHARS = new Set("=(:,;!&|?{[+-*%<>~^".split(""));
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await",
]);

function looksLikeRegexStart(content, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(content[j])) j--;
  if (j < 0) return true; // start of content — an expression position
  const ch = content[j];
  if (REGEX_PRECEDING_CHARS.has(ch)) return true;
  if (!/[A-Za-z_$]/.test(ch)) return false;
  let k = j;
  while (k >= 0 && /[A-Za-z_$0-9]/.test(content[k])) k--;
  return REGEX_PRECEDING_KEYWORDS.has(content.slice(k + 1, j + 1));
}

/** content[i] === '/'. Returns the index right after the literal (incl. flags), or null if not a terminated regex. */
function scanRegexLiteral(content, i) {
  let j = i + 1;
  let inClass = false;
  const n = content.length;
  while (j < n) {
    const c = content[j];
    if (c === "\n") return null; // regex literals don't span lines — this was division/a stray slash
    if (c === "\\") { j += 2; continue; }
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "]") { inClass = false; j++; continue; }
    if (c === "/" && !inClass) { j++; break; }
    j++;
  }
  if (j >= n || content[j - 1] !== "/") return null;
  while (j < n && /[a-z]/i.test(content[j])) j++;
  return j;
}

/**
 * Extract the balanced `{…}` or `(…)` span starting exactly at `openIdx`
 * (content[openIdx] must be `openCh`). String/template contents are tracked
 * (escape-aware) so a stray brace/paren inside a string literal never
 * desyncs the depth count; regex literals are skipped as opaque units for
 * the same reason (see above). Returns the full substring INCLUDING both
 * delimiters, or null if unterminated.
 */
export function extractBalanced(content, openIdx, openCh, closeCh) {
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "/" && looksLikeRegexStart(content, i)) {
      const after = scanRegexLiteral(content, i);
      if (after != null) { i = after; continue; }
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return content.slice(openIdx, i + 1);
    }
    i++;
  }
  return null;
}

/** Leading identifier token of an expression string, e.g. "shim" from "shim.trim()". */
function leadingIdent(expr) {
  const m = /^\s*([A-Za-z_$][\w$]*)/.exec(expr || "");
  return m ? m[1] : null;
}

/** Does `expr` reference any name in `fileVarNames` (bare identifier anywhere in it)? */
function referencesFileVar(expr, fileVarNames) {
  if (!expr) return false;
  const ids = expr.match(/[A-Za-z_$][\w$]*/g) || [];
  return ids.some((id) => fileVarNames.has(id));
}

/**
 * Collect `path.resolve(...)`/`path.join(...)` variable bindings, best-effort
 * mapping to the LAST string-literal segment (typically the filename) so a
 * later `readFileSync(NAME, ...)` can be extension-checked.
 */
export function collectPathVarLiterals(content) {
  const map = new Map();
  let m;
  PATHVAR_ASSIGN_RE.lastIndex = 0;
  while ((m = PATHVAR_ASSIGN_RE.exec(content)) != null) {
    const openIdx = content.indexOf("(", m.index + m[0].length - 1);
    if (openIdx < 0) continue;
    const call = extractBalanced(content, openIdx, "(", ")");
    if (!call) continue;
    const strs = call.match(/['"`]([^'"`]*)['"`]/g) || [];
    if (!strs.length) continue;
    map.set(m[1], strs[strs.length - 1].slice(1, -1));
  }
  return map;
}

/**
 * Collect `const NAME = readFileSync(...)` bindings whose target resolves
 * (best-effort) to a source-code file — not the test's own file, not an
 * obviously non-source extension (.json/.yml/.md/...). Bindings we can't
 * classify at all default to "eligible" (permissive) so the detector doesn't
 * silently miss the real seeded case over a formatting variant.
 */
export function collectFileVars(content, testFileBasename) {
  const pathLiterals = collectPathVarLiterals(content);
  const names = new Set();
  let m;
  READFILESYNC_ASSIGN_RE.lastIndex = 0;
  while ((m = READFILESYNC_ASSIGN_RE.exec(content)) != null) {
    const openIdx = content.indexOf("(", m.index + m[0].length - 1);
    if (openIdx < 0) continue;
    const call = extractBalanced(content, openIdx, "(", ")");
    if (!call) continue;
    const inner = call.slice(1, -1);
    const arg0 = leadingIdent(inner);
    const literal = arg0 ? pathLiterals.get(arg0) : null;

    let eligible = true;
    if (literal) {
      const isTestFile = TEST_OR_SPEC_EXT_RE.test(literal) || literal === testFileBasename;
      const isSource = SOURCE_EXT_RE.test(literal);
      eligible = isSource && !isTestFile;
    } else if (NON_SOURCE_EXT_RE.test(inner)) {
      eligible = false;
    }
    if (eligible) names.add(m[1]);
  }
  return names;
}

/**
 * Whole-file span collection: every `expect(<x>).toMatch/toContain(...)` and
 * every bare `<x>.match/.includes(...)` whose `<x>` touches a tracked
 * file-content variable (or inlines `readFileSync` directly). Returns
 * `[{ start, end, var }]` in file-content character offsets.
 */
export function collectAssertionSpans(content, fileVarNames) {
  const spans = [];

  EXPECT_RE.lastIndex = 0;
  let m;
  while ((m = EXPECT_RE.exec(content)) != null) {
    const openIdx = m.index + m[0].length - 1;
    const call = extractBalanced(content, openIdx, "(", ")");
    if (!call) continue;
    const afterIdx = openIdx + call.length;
    const rest = content.slice(afterIdx, afterIdx + 80);
    const trail = TRAILING_ASSERT_RE.exec(rest);
    if (!trail) continue;
    const inner = call.slice(1, -1);
    const touches = referencesFileVar(inner, fileVarNames) || /readFileSync\s*\(/.test(inner);
    if (!touches) continue;
    const chainOpenAbs = afterIdx + trail[0].length - 1;
    const chainCall = extractBalanced(content, chainOpenAbs, "(", ")");
    const end = chainCall ? chainOpenAbs + chainCall.length : afterIdx + trail[0].length;
    spans.push({ start: m.index, end, var: leadingIdent(inner) || "(expr)" });
  }

  BARE_MATCH_RE.lastIndex = 0;
  while ((m = BARE_MATCH_RE.exec(content)) != null) {
    if (!fileVarNames.has(m[1])) continue;
    const openIdx = m.index + m[0].length - 1;
    const call = extractBalanced(content, openIdx, "(", ")");
    const end = call ? openIdx + call.length : m.index + m[0].length;
    spans.push({ start: m.index, end, var: m[1] });
  }

  return spans;
}

/** Runtime-indicator spans, excluding any hit nested inside an assertion span. */
export function collectRuntimeSpans(content, assertionSpans) {
  const spans = [];
  RUNTIME_INDICATOR_RE.lastIndex = 0;
  let m;
  while ((m = RUNTIME_INDICATOR_RE.exec(content)) != null) {
    const idx = m.index;
    const inAssertion = assertionSpans.some((s) => idx >= s.start && idx < s.end);
    if (inAssertion) continue;
    spans.push({ start: idx, end: idx + m[0].length });
  }
  return spans;
}

function spanWithin(spans, start, end) {
  return spans.some((s) => s.start >= start && s.start < end);
}

function varsWithin(spans, start, end) {
  const out = new Set();
  for (const s of spans) if (s.start >= start && s.start < end) out.add(s.var);
  return Array.from(out);
}

/** Find the title of the nearest enclosing `describe(...)` before `beforeIdx`. */
export function findEnclosingDescribeTitle(content, beforeIdx) {
  let found = null;
  DESCRIBE_CALL_RE.lastIndex = 0;
  let m;
  while ((m = DESCRIBE_CALL_RE.exec(content)) != null) {
    if (m.index >= beforeIdx) break;
    const openIdx = m.index + m[0].length - 1;
    const call = extractBalanced(content, openIdx, "(", ")");
    if (!call) continue;
    const blockEnd = openIdx + call.length;
    if (beforeIdx >= m.index && beforeIdx < blockEnd) {
      const titleMatch = TITLE_RE.exec(call.slice(1));
      if (titleMatch) found = titleMatch[2];
    }
  }
  return found;
}

/** Find every `it(...)`/`test(...)` block: `[{ start, end, title, titleLine }]`. */
export function findTestBlocks(content) {
  const blocks = [];
  TEST_CALL_RE.lastIndex = 0;
  let m;
  while ((m = TEST_CALL_RE.exec(content)) != null) {
    const nameStart = m.index + m[1].length;
    const openIdx = m.index + m[0].length - 1;
    const call = extractBalanced(content, openIdx, "(", ")");
    if (!call) continue;
    const blockEnd = openIdx + call.length;
    const inner = call.slice(1, -1);
    const titleMatch = TITLE_RE.exec(inner);
    if (titleMatch) {
      blocks.push({ start: nameStart, end: blockEnd, title: titleMatch[2] });
    }
    TEST_CALL_RE.lastIndex = blockEnd;
  }
  return blocks;
}

/** Does a `//` comment on the 1-2 raw lines above `lineNo` (1-based) carry a behavior claim? */
function commentAboveClaimsBehavior(rawLines, lineNo) {
  for (let ln = lineNo - 1; ln >= Math.max(1, lineNo - 2); ln--) {
    const line = rawLines[ln - 1] || "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("//")) continue;
    if (BEHAVIOR_CLAIM_RE.test(trimmed)) return true;
  }
  return false;
}

export async function runStaleLyingTestDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("stale-lying-test", "no_root", null, t0);

  try {
    const frontendRoot = path.join(root, "concord-frontend");
    const files = await walk(frontendRoot, [".ts", ".tsx", ".js", ".jsx"]);
    const findings = [];
    let scanned = 0;
    let candidateFiles = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (!TEST_FILE_RE.test(f)) continue;
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      candidateFiles++;

      const raw = await readSafe(f);
      if (!raw || !/readFileSync\s*\(/.test(raw)) continue;
      scanned++;

      const content = stripComments(raw); // line numbers preserved
      const rawLines = raw.split("\n");
      const testFileBasename = path.basename(f);

      const fileVarNames = collectFileVars(content, testFileBasename);
      if (fileVarNames.size === 0) continue; // no source-file reads to worry about

      const assertionSpans = collectAssertionSpans(content, fileVarNames);
      if (assertionSpans.length === 0) continue;
      const runtimeSpans = collectRuntimeSpans(content, assertionSpans);

      const blocks = findTestBlocks(content);
      for (const block of blocks) {
        const lineNo = lineOf(content, block.start);

        const titleClaims = BEHAVIOR_CLAIM_RE.test(block.title);
        const commentClaims = !titleClaims && commentAboveClaimsBehavior(rawLines, lineNo);
        const describeTitle = !titleClaims && !commentClaims ? findEnclosingDescribeTitle(content, block.start) : null;
        const describeClaims = describeTitle ? BEHAVIOR_CLAIM_RE.test(describeTitle) : false;
        if (!titleClaims && !commentClaims && !describeClaims) continue;

        const usesFileVarAssertion = spanWithin(assertionSpans, block.start, block.end);
        if (!usesFileVarAssertion) continue;

        const hasRuntimeIndicator = spanWithin(runtimeSpans, block.start, block.end);
        if (hasRuntimeIndicator) continue;

        const referencedVars = varsWithin(assertionSpans, block.start, block.end);
        findings.push({
          id: "stale_lying_test",
          severity: "medium",
          kind: "static",
          category: "test-quality",
          subject: { kind: "file", path: rel },
          message:
            `it("${snippet(block.title, 80)}") claims a runtime behavior but only regex/substring-matches ` +
            `source text (${referencedVars.join(", ")}) — no render/fireEvent/dispatchEvent/toHaveBeenCalled, ` +
            "so it cannot fail from the behavior actually breaking",
          location: `${rel}:${lineNo}`,
          evidence: { title: block.title, referencedVars },
          fixHint: "replace_source_string_assertion_with_render_or_execution_test",
        });
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "stale_lying_test_summary",
      severity: "info",
      kind: "static",
      category: "test-quality",
      message: `Scanned ${scanned} readFileSync-using test file(s) of ${candidateFiles} test file(s); flagged ${findings.length}`,
      evidence: { scanned, candidateFiles, flagged: findings.length },
    });

    return makeReport("stale-lying-test", findings, t0);
  } catch (err) {
    return makeError("stale-lying-test", "exception", err, t0);
  }
}
