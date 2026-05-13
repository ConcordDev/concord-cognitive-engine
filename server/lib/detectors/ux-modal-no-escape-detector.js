// server/lib/detectors/ux-modal-no-escape-detector.js
//
// Catches `<Modal>` / `<Dialog>` / `<Drawer>` / `<Sheet>` /
// `<Popover>` components opened without any way to close:
//   - no `onClose` / `onOpenChange` / `onDismiss` prop
//   - no Esc-key handler in the file
//   - no close button child / aria-label "close"
//
// User opens the modal, clicks outside expecting to dismiss, gets
// trapped. Tabbing away does nothing. The only escape is page
// refresh.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-modal-no-escape";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "out", "__tests__", "stories"]);
const ANNOTATION_OK_RE = /@modal-escape-ok\b/;

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

// Modal-shape JSX opens. Capture every capitalised JSX tag, then
// filter by suffix in the loop — this admits both bare `<Modal>` and
// composed `<UserProfileDialog>` while keeping the regex simple.
const MODAL_OPEN_RE = /<([A-Z]\w*)\b/g;
const MODAL_SUFFIX_RE = /(?:Modal|Dialog|Drawer|Sheet|Popover|Overlay)$/;
const CLOSE_PROP_RE = /\bon(?:Close|OpenChange|Dismiss|Esc|EscapeKeyDown|InteractOutside)\b/;
const ESC_HANDLER_FILE_RE = /\bkey\s*===?\s*['"]Escape['"]|\bEscapeKeyDown\b|\baddEventListener\s*\(\s*['"`]keydown['"`]/;

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

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

export async function runUxModalNoEscapeDetector({ root, opts = {} } = {}) {
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
      // File-level shortcut: an Escape-key handler anywhere in the
      // file is presumed to apply globally (typical of a shell
      // component that owns the Esc binding for nested modals).
      const fileHasEscHandler = ESC_HANDLER_FILE_RE.test(content);
      const fileLines = content.split("\n");
      const re = new RegExp(MODAL_OPEN_RE.source, "g");
      const seen = new Set();
      let m;
      while ((m = re.exec(content)) != null) {
        const tagName = m[1];
        if (!MODAL_SUFFIX_RE.test(tagName)) continue;
        const opening = extractOpeningTag(content, m.index);
        if (!opening) continue;
        const attrs = opening.attrs;
        // Has an explicit close-prop?
        if (CLOSE_PROP_RE.test(attrs)) continue;
        // Has a spread? Conservatively skip.
        if (/\{\s*\.\.\.[\w$]/.test(attrs)) continue;
        // Defining the modal component itself (not consuming it).
        // Heuristic: lower-cased tag-name match inside `export function`
        // or `function <Tag>` near the top of file → this file IS the
        // modal definition, not a consumer.
        const defRe = new RegExp(`\\b(?:export\\s+)?(?:function|const)\\s+${tagName}\\b`);
        if (defRe.test(content.slice(0, m.index))) continue;
        if (fileHasEscHandler) continue;
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        const key = `${rel}:${tagName}:${lineNum}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          id: "modal_no_escape",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `<${tagName}> has no onClose / onOpenChange / onDismiss / Esc-handler — opening it traps the user.`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "ux_modal", file: rel, tagName },
          fixHint: `Pass an onClose / onOpenChange prop to <${tagName}>, OR add a keydown listener that closes on Escape.`,
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
