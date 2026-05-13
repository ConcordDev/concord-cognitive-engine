// server/lib/detectors/frontend-ghost-click-detector.js
//
// Catches frontend "ghost click" patterns — UI states where the user
// clicks a button and nothing visible happens because the handler is
// missing, throws silently, or never resets the loading state.
//
// Backend-side ghost-click causes are covered by http-error-detector
// (400/404/409/429/504 paths). This detector covers the FRONTEND half:
//
//   1. button_without_handler (high)
//      <button> with no onClick, no type="submit"/"reset", no
//      {...spread}, no disabled. The button literally does nothing.
//
//   2. click_handler_no_error_path (medium)
//      onClick={async () => { ...fetch/axios/apiHelpers... }} with
//      neither a try/catch in the handler body nor a .catch() on the
//      promise. Failed requests are silently swallowed — the user sees
//      a spinner that never resolves or stale UI.
//
//   3. form_submit_no_preventDefault (medium)
//      <form onSubmit={handler}> where the handler body has no
//      `preventDefault()` call. The form posts and reloads the page,
//      losing all client state — looks like the click did nothing
//      because the page comes back blank.
//
//   4. loading_state_set_no_finally (medium)
//      setLoading(true) / setRunning(...) / setBusy(true) in an async
//      onClick body that has no `finally` block resetting the state.
//      Stuck-spinner pattern — looks like the click was ignored.
//
// 401 (lens-decorative-state-detector#lens_empty_handler) already
// catches `onClick={() => {}}`; this detector skips that rule to
// avoid duplicates.
//
// File-level opt-out: `@ghost-click-ok` annotation anywhere in the
// file suppresses every rule for that file. Line-level: same
// annotation on the line above or same line as a finding suppresses
// just that finding.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "frontend-ghost-click";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = [
  "concord-frontend/app/lenses",
  "concord-frontend/components",
];
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "coverage", "dist", "build", "out",
  "__tests__", "stories", "storybook",
]);
const ANNOTATION_OK_RE = /@ghost-click-ok\b/;

function isInteresting(file) {
  return /\.(tsx|jsx)$/.test(file);
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
  if (!SCAN_DIRS.some(p => rel.startsWith(p + "/"))) return false;
  // Skip test fixtures and storybook examples.
  if (/\.(test|spec|stories)\.(tsx|jsx)$/.test(rel)) return false;
  return true;
}

// ── Patterns ───────────────────────────────────────────────────────────────

// Locate `<button` and `<form` openings. JSX attrs commonly contain
// `=>` (arrow functions) so we can't use `[^>]*` to capture attrs —
// the regex would stop at the `>` inside `=>`. We use a paired-brace
// walk in extractOpeningTag() instead and locate the tag-closing `>`
// by skipping anything inside balanced `{}` or `""`/`''`/`` `` ``.
const BUTTON_OPEN_RE = /<button\b/g;
const FORM_OPEN_RE = /<form\b/g;

/**
 * Given the index of `<button`/`<form` in content, return:
 *   { attrs, closeIdx } where attrs is the source text between the tag
 *   name and the closing `>` of the opening tag, and closeIdx points
 *   one past the `>`.
 * Returns null if no balanced `>` is found within 4 KB.
 */
function extractOpeningTag(content, startIdx) {
  const tagNameEnd = content.indexOf(/\s|\/|>/.test(content[startIdx + 7]) ? content[startIdx + 7] : "", startIdx + 7);
  // The above heuristic is unreliable; just start scanning from
  // startIdx + 1 (past the `<`) and let the brace-walker handle it.
  let i = startIdx + 1;
  // Skip the tag name itself.
  while (i < content.length && /[a-zA-Z0-9]/.test(content[i])) i++;
  const attrStart = i;
  const cap = Math.min(content.length, startIdx + 4096);
  let depth = 0;
  let inStr = "";
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth--; i++; continue; }
    if (ch === ">" && depth === 0) {
      return { attrs: content.slice(attrStart, i), closeIdx: i + 1 };
    }
    i++;
  }
  return null;
}

// Detect onSubmit handler value reference (named function or inline).
const FORM_ONSUBMIT_INLINE_RE = /\bonSubmit\s*=\s*\{\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\}\s*\}/g;
const FORM_ONSUBMIT_NAMED_RE = /\bonSubmit\s*=\s*\{\s*([a-zA-Z_$][\w$]*)\s*\}/g;

// Detect onClick handler value reference.
const ONCLICK_INLINE_RE = /\bonClick\s*=\s*\{\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*(\{[\s\S]*?\}|\([\s\S]*?\)|[^{}\n]+)\s*\}/g;

const FETCH_LIKE_RE = /\b(?:fetch|axios|apiHelpers|api\.\w+|mutate|trigger|swr|useSWR\b)\s*[(.]/;
const TRY_RE = /\btry\s*\{/;
const CATCH_RE = /\.catch\s*\(|\}\s*catch\s*[({]/;
const PREVENT_DEFAULT_RE = /\.preventDefault\s*\(/;
// Fires only on a STARTING transition — setLoading(true) or
// setRunning(<truthy id>). setLoading(false) / setRunning(null) are
// synchronous resets and don't need a finally.
const LOADING_START_RE = /\bset(?:Loading|Running|Busy|Submitting|Pending)\s*\(\s*(?:true|['"`]|new\s|[\w$]+\.[\w$]+|\{|\[)/;
const HAS_AWAIT_RE = /\bawait\b/;
const FINALLY_RE = /\}\s*finally\s*\{/;

// ── Helpers ────────────────────────────────────────────────────────────────

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

function locOf(rel, lineNum) {
  return `${rel}:${lineNum}`;
}

// Brace-count from openIdx forward to find the matching close brace.
function findMatchingBrace(content, openIdx, limit = 8192) {
  let depth = 1;
  let i = openIdx + 1;
  const cap = Math.min(content.length, openIdx + limit);
  while (i < cap && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return depth === 0 ? i : cap;
}

// Resolve a named handler reference to its definition body within the
// same file. Returns the body string (handler.body) or "" if not found.
// Captures `const NAME = (...) => { … }` and `function NAME(...) { … }`.
function findHandlerBody(content, name) {
  const arrowRe = new RegExp(
    `\\bconst\\s+${name}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>\\s*\\{`,
    ""
  );
  const fnRe = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`, "");
  let m = arrowRe.exec(content) || fnRe.exec(content);
  if (!m) return "";
  const openIdx = content.indexOf("{", m.index + m[0].length - 1);
  if (openIdx < 0) return "";
  const closeIdx = findMatchingBrace(content, openIdx);
  return content.slice(openIdx, closeIdx);
}

// ── Rule implementations ───────────────────────────────────────────────────

function isInsideTemplateLiteral(content, idx) {
  // Walk backward from idx, count unescaped backticks. Odd count = we're
  // inside a `…` template literal. Used to skip <button> tags that live
  // inside an HTML string template assigned to innerHTML, where the
  // handler is wired separately via querySelector.
  let count = 0;
  for (let i = 0; i < idx; i++) {
    if (content[i] === "\\") { i++; continue; }
    if (content[i] === "`") count++;
  }
  return count % 2 === 1;
}

function isInsideComment(content, idx) {
  // Skip matches inside line comments (// …) and block comments
  // (/* … */, including JSDoc). Without this, plaintext mentions of
  // `<button>` in code comments would generate false-positive findings.
  // Line comment: walk back to start of line, if `//` is encountered
  // before idx without a leading string/template context, we're in.
  let lineStart = idx;
  while (lineStart > 0 && content[lineStart - 1] !== "\n") lineStart--;
  // Scan forward from lineStart toward idx, tracking string state.
  let inStr = "";
  for (let i = lineStart; i < idx; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && content[i + 1] === "/") return true;
  }
  // Block comment: walk back to find /* ... */ pairs. If unmatched
  // `/*` precedes idx, we're inside a block comment. Scan whole file
  // up to idx, tracking string state to avoid /* inside strings.
  let blockOpen = -1;
  inStr = "";
  for (let i = 0; i < idx - 1; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (blockOpen === -1) {
      if (ch === "/" && content[i + 1] === "*") { blockOpen = i; i++; }
    } else {
      if (ch === "*" && content[i + 1] === "/") { blockOpen = -1; i++; }
    }
  }
  return blockOpen !== -1;
}

function checkButtonWithoutHandler(rel, content, fileLines, findings) {
  const re = new RegExp(BUTTON_OPEN_RE.source, "g");
  let m;
  while ((m = re.exec(content)) != null) {
    if (isInsideTemplateLiteral(content, m.index)) continue;
    if (isInsideComment(content, m.index)) continue;
    const opening = extractOpeningTag(content, m.index);
    if (!opening) continue;
    const attrs = opening.attrs;
    // Safe shapes (any of these is enough to clear the rule):
    //   • has onClick / onMouseDown / onKeyDown / onPointerDown
    //   • has type="submit" or type="reset" (form-driven)
    //   • has aria-disabled, disabled (intentionally inert)
    //   • has {...spread} of props (handler is in the spread)
    //   • has `as={...}` polymorphic (e.g. as={Link})
    //   • has formAction (server action / form-submit)
    if (/\bonClick\s*=|\bonMouseDown\s*=|\bonKeyDown\s*=|\bonPointerDown\s*=/.test(attrs)) continue;
    if (/\btype\s*=\s*['"`](submit|reset)['"`]/.test(attrs)) continue;
    if (/\bdisabled\b|\baria-disabled\b/.test(attrs)) continue;
    if (/\{\s*\.\.\.[\w$]/.test(attrs)) continue;
    if (/\bas\s*=/.test(attrs)) continue;
    if (/\bformAction\s*=/.test(attrs)) continue;
    const lineNum = lineNumberAt(content, m.index);
    if (lineExempt(fileLines, lineNum)) continue;
    findings.push({
      id: "button_without_handler",
      severity: "high",
      kind: "static",
      category: CATEGORY,
      message: "<button> has no onClick, no type=\"submit\"/\"reset\", no spread, no disabled — clicking does nothing.",
      location: locOf(rel, lineNum),
      subject: { kind: "frontend_button", file: rel },
      fixHint: "Add an onClick handler, OR set type=\"submit\" if it lives in a <form>, OR add disabled if the button is intentionally inert.",
    });
  }
}

function checkClickHandlerNoErrorPath(rel, content, fileLines, findings) {
  const re = new RegExp(ONCLICK_INLINE_RE.source, "g");
  let m;
  while ((m = re.exec(content)) != null) {
    const body = m[2] || "";
    // Only flag async handlers that issue a request.
    const isAsync = /^\s*async\s*\(|\bawait\b/.test(m[0]);
    if (!isAsync) continue;
    if (!FETCH_LIKE_RE.test(body)) continue;
    if (TRY_RE.test(body) || CATCH_RE.test(body)) continue;
    const lineNum = lineNumberAt(content, m.index);
    if (lineExempt(fileLines, lineNum)) continue;
    findings.push({
      id: "click_handler_no_error_path",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: "Async onClick issues a request without try/catch or .catch() — a server error is silently swallowed; the button looks dead.",
      location: locOf(rel, lineNum),
      subject: { kind: "frontend_button", file: rel },
      fixHint: "Wrap the body in try/catch and surface the error via addToast or your error pattern; OR chain .catch(err => …) on the promise.",
    });
  }
}

function checkLoadingNoFinally(rel, content, fileLines, findings) {
  const re = new RegExp(ONCLICK_INLINE_RE.source, "g");
  let m;
  while ((m = re.exec(content)) != null) {
    const body = m[2] || "";
    // Only fire when the handler STARTS a loading transition AND
    // performs async work. A synchronous setRunning(false) reset has
    // no spinner to stick.
    if (!LOADING_START_RE.test(body)) continue;
    if (!HAS_AWAIT_RE.test(body)) continue;
    if (FINALLY_RE.test(body)) continue;
    const lineNum = lineNumberAt(content, m.index);
    if (lineExempt(fileLines, lineNum)) continue;
    findings.push({
      id: "loading_state_no_finally",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: "onClick starts a loading state (setLoading/setRunning/setBusy/setSubmitting/setPending) before async work without a `finally` block resetting it — stuck spinner if the request throws.",
      location: locOf(rel, lineNum),
      subject: { kind: "frontend_button", file: rel },
      fixHint: "Use try { … } finally { setLoading(false) } so the spinner always resets, even on error.",
    });
  }
}

function checkFormSubmitNoPreventDefault(rel, content, fileLines, findings) {
  const formRe = new RegExp(FORM_OPEN_RE.source, "g");
  let m;
  while ((m = formRe.exec(content)) != null) {
    const opening = extractOpeningTag(content, m.index);
    if (!opening) continue;
    const attrs = opening.attrs;
    if (!/\bonSubmit\s*=/.test(attrs)) continue;
    const lineNum = lineNumberAt(content, m.index);
    if (lineExempt(fileLines, lineNum)) continue;
    // Resolve the handler — inline or named — and check the body.
    // Slice a 2KB window forward from the form-open match so the regex
    // can scan an isolated chunk. Don't combine `lastIndex` + slicing
    // (the engine resets to position 0 on the sliced string).
    const forwardWindow = content.slice(m.index, m.index + 2000);
    let handlerBody = "";
    const inlineM = new RegExp(FORM_ONSUBMIT_INLINE_RE.source).exec(forwardWindow);
    if (inlineM) {
      handlerBody = inlineM[2] || "";
    } else {
      const namedM = new RegExp(FORM_ONSUBMIT_NAMED_RE.source).exec(forwardWindow);
      if (namedM) {
        handlerBody = findHandlerBody(content, namedM[1]);
      }
    }
    if (!handlerBody) continue;
    if (PREVENT_DEFAULT_RE.test(handlerBody)) continue;
    findings.push({
      id: "form_submit_no_preventDefault",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: "<form onSubmit={...}> handler does not call e.preventDefault() — the page reloads on submit, looking like the click did nothing.",
      location: locOf(rel, lineNum),
      subject: { kind: "frontend_form", file: rel },
      fixHint: "Call e.preventDefault() at the top of the onSubmit handler before invoking async work.",
    });
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runFrontendGhostClickDetector({ root, opts = {} } = {}) {
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
      // File-level annotation in the first 5 lines suppresses every rule.
      const headLines = content.split("\n").slice(0, 5).join("\n");
      if (ANNOTATION_OK_RE.test(headLines)) continue;

      const fileLines = content.split("\n");

      checkButtonWithoutHandler(rel, content, fileLines, findings);
      if (findings.length >= findingCap) break;
      checkClickHandlerNoErrorPath(rel, content, fileLines, findings);
      if (findings.length >= findingCap) break;
      checkLoadingNoFinally(rel, content, fileLines, findings);
      if (findings.length >= findingCap) break;
      checkFormSubmitNoPreventDefault(rel, content, fileLines, findings);
      if (findings.length >= findingCap) break;
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
