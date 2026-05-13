// server/lib/detectors/ux-loading-state-missing-detector.js
//
// Catches async onClick handlers that issue a request (fetch /
// axios / apiHelpers / mutate) without ANY visible loading feedback
// — no `disabled={loading}` / `disabled={busy}`, no spinner, no
// skeleton, no `setLoading(true)`. Result: a button users can
// double-click during the network round-trip, kicking off two
// duplicate requests; OR a button that gives no feedback so the
// user assumes nothing happened.
//
// Complements `loading_state_no_finally` from frontend-ghost-click:
// that one catches forgotten resets; this one catches missing
// starts.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-loading-state-missing";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "out", "__tests__", "stories"]);
const ANNOTATION_OK_RE = /@loading-ok\b/;

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

const ONCLICK_INLINE_RE = /\bonClick\s*=\s*\{\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*(\{[\s\S]*?\}|\([\s\S]*?\)|[^{}\n]+)\s*\}/g;
const NETWORK_RE = /\b(?:fetch|axios|apiHelpers|mutate|trigger)\s*[(.]/;
const LOADING_HINT_RE = /\bset(?:Loading|Running|Busy|Submitting|Pending)\s*\(|\bdisabled\s*=|\bisPending\b|\bisLoading\b|\bisSubmitting\b/;

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

export async function runUxLoadingStateMissingDetector({ root, opts = {} } = {}) {
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
      // Per-file shortcut: if the file uses isPending/isLoading/disabled
      // ANYWHERE (typical of a useMutation/useTransition pattern),
      // assume loading is generally handled and skip.
      if (LOADING_HINT_RE.test(content)) continue;
      const fileLines = content.split("\n");
      const re = new RegExp(ONCLICK_INLINE_RE.source, "g");
      let m;
      while ((m = re.exec(content)) != null) {
        const body = m[2] || "";
        const isAsync = /^\s*async\s*\(|\bawait\b/.test(m[0]);
        if (!isAsync) continue;
        if (!NETWORK_RE.test(body)) continue;
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        findings.push({
          id: "loading_state_missing",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: "Async onClick issues a network request with no visible loading state — users can't tell the click registered and may double-click.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "ux_loading", file: rel },
          fixHint: "Track loading via `useState`/`useTransition`/`useMutation` and reflect it in the button (`disabled={loading}` + a spinner or label change).",
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
