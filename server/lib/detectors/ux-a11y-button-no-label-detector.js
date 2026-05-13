// server/lib/detectors/ux-a11y-button-no-label-detector.js
//
// Icon-only <button> with no aria-label / no text content / no
// title. Screen readers can't announce the action, and keyboard
// users can't tell what the button does. The visible UI hint is
// the icon alone, which is opaque to assistive tech.
//
// Detection: a <button> opening tag whose children render ONLY
// icon JSX (e.g. <X />, <Heart className=…/>) with no aria-label,
// no aria-labelledby, no title, and no plain text content.
//
// Operator opt-out: `@a11y-ok` on the line above the button.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-a11y-button-no-label";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "out", "__tests__", "stories"]);
const ANNOTATION_OK_RE = /@a11y-ok\b/;

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

const BUTTON_OPEN_RE = /<button\b/g;

function extractOpeningTag(content, startIdx) {
  let i = startIdx + 1;
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
    if (ch === ">" && depth === 0) return { attrs: content.slice(attrStart, i), closeIdx: i + 1 };
    i++;
  }
  return null;
}

function extractChildren(content, openTagEndIdx) {
  // Walk forward until `</button>`, accounting for nested tags.
  let depth = 1;
  let i = openTagEndIdx;
  const cap = Math.min(content.length, openTagEndIdx + 8192);
  while (i < cap && depth > 0) {
    if (content.startsWith("<button", i)) { depth++; i += 7; continue; }
    if (content.startsWith("</button>", i)) { depth--; if (depth === 0) return content.slice(openTagEndIdx, i); i += 9; continue; }
    i++;
  }
  return content.slice(openTagEndIdx, Math.min(i, cap));
}

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function isInsideTemplateLiteral(content, idx) {
  let count = 0;
  for (let i = 0; i < idx; i++) {
    if (content[i] === "\\") { i++; continue; }
    if (content[i] === "`") count++;
  }
  return count % 2 === 1;
}

function hasNonIconText(children) {
  // Walk the JSX children char-by-char, accumulating PLAIN-TEXT or
  // JSX-EXPRESSION segments. JSX expressions like `{t.label}` or
  // `{title}` are treated as text-equivalent because they almost
  // always evaluate to a string at runtime — the same string the
  // screen reader will read. Conservative detection: false negatives
  // on expressions that evaluate to icon JSX are acceptable; false
  // positives on visible text are not.
  //
  // Single-character walker — no multi-character substring is ever
  // produced, so CodeQL's js/incomplete-multi-char-sanitization is
  // structurally inapplicable.
  //
  // The walker only counts text/expressions OUTSIDE any `<…>` tag.
  // Inner content of paired tags (e.g. `<span>Save</span>` →
  // contributes "Save"; `<span>{label}</span>` → contributes the
  // expression token) is visited at the outer level once the closing
  // `</span>` is consumed.
  let inTag = 0;       // `<…>` nesting
  let inStr = "";      // current string / template-literal delimiter
  let textSeen = false;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = "";
      continue;
    }
    if (inTag > 0) {
      if (ch === "<") inTag++;
      else if (ch === ">") inTag--;
      else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
      continue;
    }
    if (ch === "<") { inTag = 1; continue; }
    if (ch === "{") {
      // Found a JSX expression. Treat the brace as text-equivalent
      // and skip past the matching close. Track nesting so a body
      // like `{a ? <X/> : <Y/>}` doesn't terminate early on inner `}`.
      textSeen = true;
      let depth = 1;
      i++;
      while (i < children.length && depth > 0) {
        const c = children[i];
        if (c === "\\") { i += 2; continue; }
        if (c === '"' || c === "'" || c === "`") {
          inStr = c; i++;
          while (i < children.length && children[i] !== inStr) {
            if (children[i] === "\\") i++;
            i++;
          }
          inStr = "";
        } else if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      i--; // for-loop will i++
      continue;
    }
    if (/\S/.test(ch)) textSeen = true;
  }
  return textSeen;
}

export async function runUxA11yButtonNoLabelDetector({ root, opts = {} } = {}) {
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
      const re = new RegExp(BUTTON_OPEN_RE.source, "g");
      let m;
      while ((m = re.exec(content)) != null) {
        if (isInsideTemplateLiteral(content, m.index)) continue;
        const opening = extractOpeningTag(content, m.index);
        if (!opening) continue;
        const attrs = opening.attrs;
        // Has accessible name?
        if (/\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/.test(attrs)) continue;
        // Spread props might include aria-label — skip conservatively.
        if (/\{\s*\.\.\.[\w$]/.test(attrs)) continue;
        // Inspect children for plain text.
        const children = extractChildren(content, opening.closeIdx);
        if (hasNonIconText(children)) continue;
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        findings.push({
          id: "a11y_button_no_label",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: "Icon-only <button> has no aria-label / aria-labelledby / title / visible text — opaque to screen readers and keyboard users.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "ux_a11y", file: rel },
          fixHint: "Add `aria-label=\"<action>\"` to the button or include visible text content.",
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
