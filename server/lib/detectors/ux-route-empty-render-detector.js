// server/lib/detectors/ux-route-empty-render-detector.js
//
// Catches lens-page components whose default export can return
// `null` / `undefined` / an empty fragment WITHOUT any
// loading-state, error-boundary, or empty-state marker. A user
// who lands on the page sees a blank screen and can't tell if
// the page is broken or just empty.
//
// Detection: lens pages (`concord-frontend/app/lenses/<X>/page.tsx`)
// whose default export has a `return null` / `return undefined` /
// `return <></>` branch that's NOT guarded by loading state and not
// paired with an EmptyState / Skeleton / ErrorBoundary nearby.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-route-empty-render";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIR = "concord-frontend/app/lenses";
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "__tests__"]);
const ANNOTATION_OK_RE = /@route-empty-ok\b/;

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile() && /page\.tsx$/.test(entry.name)) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  return rel.startsWith(SCAN_DIR + "/");
}

const NULL_RETURN_RE = /\breturn\s+(null|undefined|<>\s*<\/>|<>\s*<\s*\/\s*>)\s*;?/g;
const EMPTY_STATE_HINT_RE = /\bEmptyState\b|\bSkeleton\b|\bSpinner\b|\bLoadingState\b|\bErrorBoundary\b|\bLoading\.\.\.\b|\bNo data\b|\bNothing here\b|\b\.\.\. ?loading\b/i;
const LOADING_VAR_HINT_RE = /\b(?:loading|isLoading|pending|isPending|isFetching)\b/;

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

export async function runUxRouteEmptyRenderDetector({ root, opts = {} } = {}) {
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
      // Page-level shortcut: if the file mentions any empty-state /
      // loading-state component or guard variable, the developer is
      // already handling the empty render path — skip.
      if (EMPTY_STATE_HINT_RE.test(content)) continue;
      if (LOADING_VAR_HINT_RE.test(content)) continue;
      const fileLines = content.split("\n");
      const re = new RegExp(NULL_RETURN_RE.source, "g");
      let m;
      while ((m = re.exec(content)) != null) {
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        findings.push({
          id: "route_empty_render",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Lens page returns ${m[1]} with no <EmptyState> / <Skeleton> / <ErrorBoundary> / loading guard — user lands on a blank screen.`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "ux_route_empty", file: rel },
          fixHint: "Replace `return null` with an <EmptyState message=\"…\"/>, OR wrap the data load in `if (loading) return <Skeleton />`, so the user sees what's happening.",
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
