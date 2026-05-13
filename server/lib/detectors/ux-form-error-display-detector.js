// server/lib/detectors/ux-form-error-display-detector.js
//
// Catches `<form onSubmit>` whose catch path doesn't surface an
// error to the user. Server rejected the submission, the catch
// fired, but the UI shows nothing — the user assumes "it worked"
// or "nothing happened".
//
// Rule: a form onSubmit handler that contains a try/catch where the
// catch body has NO error-surface call (no addToast / setError /
// throw / <ErrorMessage> render branch). The user-visible failure
// is silent.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-form-error-display";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "out", "__tests__", "stories"]);
const ANNOTATION_OK_RE = /@form-error-ok\b/;

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile() && /\.(tsx|jsx)$/.test(entry.name)) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  if (!SCAN_DIRS.some(p => rel.startsWith(p + "/"))) return false;
  if (/\.(test|spec|stories)\.(tsx|jsx)$/.test(rel)) return false;
  return true;
}

// We can't use a single regex for the full onSubmit handler body
// because the body has nested `{}` from try/catch. Match the opening
// shape with a regex, then brace-count from the opening `{` of the
// arrow-function body to find the matching close.
const FORM_OPEN_RE = /<form\b[^>]*?\bonSubmit\s*=\s*\{\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
const ERROR_SURFACE_RE = /\baddToast\b|\bsetError\b|\bsetErrorMessage\b|\btoast\.\w+\s*\(|\bnotify\b|\bthrow\b|\bconsole\.(error|warn)\b/;

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function balancedBody(content, openIdx) {
  // openIdx points at the `{` of the arrow-function body. Walk
  // forward counting brace depth, ignoring `{`/`}` inside strings
  // and template literals. Returns the inner body text.
  let depth = 1;
  let i = openIdx + 1;
  let inStr = "";
  const cap = Math.min(content.length, openIdx + 16384);
  while (i < cap && depth > 0) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return content.slice(openIdx + 1, i - 1);
}

function findCatchBodies(handler) {
  // Find every `catch (...) { … }` block in the handler body, using
  // brace counting so nested `{}` inside the catch don't truncate.
  const out = [];
  const re = /\bcatch\s*(?:\([^)]*\)\s*)?\{/g;
  let m;
  while ((m = re.exec(handler)) != null) {
    const openIdx = m.index + m[0].length - 1; // points at `{`
    let depth = 1;
    let i = openIdx + 1;
    let inStr = "";
    const cap = Math.min(handler.length, openIdx + 8192);
    while (i < cap && depth > 0) {
      const ch = handler[i];
      if (inStr) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inStr) inStr = "";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    out.push(handler.slice(openIdx + 1, i - 1));
  }
  return out;
}

export async function runUxFormErrorDisplayDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  try {
    for await (const rel of walk(repoRoot)) {
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;
      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      if (content.split("\n").slice(0, 5).some(l => ANNOTATION_OK_RE.test(l))) continue;
      const fileLines = content.split("\n");
      const re = new RegExp(FORM_OPEN_RE.source, "g");
      let m;
      while ((m = re.exec(content)) != null) {
        const openIdx = m.index + m[0].length - 1; // points at the `{`
        const handlerBody = balancedBody(content, openIdx);
        const catches = findCatchBodies(handlerBody);
        if (catches.length === 0) continue;
        let silentCatch = false;
        for (const cb of catches) {
          if (!ERROR_SURFACE_RE.test(cb)) { silentCatch = true; break; }
        }
        if (!silentCatch) continue;
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        findings.push({
          id: "form_error_display_missing",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: "<form onSubmit> has a catch block that doesn't surface the error (no addToast / setError / throw) — failed submissions look silent to the user.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "ux_form_error", file: rel },
          fixHint: "Inside the catch, call addToast({ type: 'error', message: err.message }) OR setError(err.message), so the user sees what went wrong.",
        });
        if (findings.length >= findingCap) break;
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }
  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
