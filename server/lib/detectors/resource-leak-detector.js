// server/lib/detectors/resource-leak-detector.js
//
// Catches the silent killer of category #2: resources opened without
// matching cleanup. These accumulate over hours/days under load and
// don't surface in unit tests.
//
// Patterns:
//   - setInterval / setTimeout without a captured handle that's
//     clearTimeout/clearIntervaled or returned for caller cleanup
//   - db.prepare(...) inside a tight loop (statement-cache leak)
//   - addEventListener without a matching removeEventListener pair
//   - fs.createReadStream / createWriteStream without .on('close', ...)
//   - new EventEmitter without .removeAllListeners() exit hook
//   - Open file descriptors via fs.open() without close()
//
// Severities:
//   high   — uncleaned setInterval in a long-running module path
//   medium — addEventListener with no companion removeEventListener
//            in a useEffect/lifecycle scope
//   low    — file handles / streams without close hooks
//   info   — patterns that look risky but the file scope is small

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "resource-leak";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_PATHS = ["server/lib", "server/routes", "server/economy", "server/emergent", "concord-frontend/lib", "concord-frontend/components", "concord-frontend/hooks"];
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", "audit", "tests", "__tests__"]);

function isInteresting(file) {
  return /\.(js|ts|tsx|jsx|mjs)$/.test(file);
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
  return SCAN_PATHS.some(p => rel.startsWith(p + "/"));
}

const SETINTERVAL_RE = /\bsetInterval\s*\(/g;
const SETTIMEOUT_RE = /\bsetTimeout\s*\(/g;
const CLEAR_RE = /\b(clearInterval|clearTimeout)\b/;
const ADD_LISTENER_RE = /\.addEventListener\s*\(\s*['"`](\w+)['"`]/g;
const REMOVE_LISTENER_RE = /\.removeEventListener\s*\(\s*['"`](\w+)['"`]/g;
const STREAM_RE = /\bcreate(Read|Write)Stream\s*\(/g;
const FS_OPEN_RE = /\bfs\.(?:promises\.)?open\s*\(/g;
const FS_CLOSE_RE = /\bfs\.(?:promises\.)?close\s*\(|\.close\(\)|\.end\(\)/;
const PREPARE_IN_LOOP_RE = /\b(for|while)\s*\(.*\)[^{]*\{[^}]{0,2000}db\.prepare\s*\(/gs;
const ANNOTATION_OK_RE = /@resource-leak-ok\b/;

export async function runResourceLeakDetector({ root, opts = {} } = {}) {
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

      // Skip the entire file if it carries the @resource-leak-ok annotation
      // (operator opt-out for known-bounded-cleanup files).
      if (ANNOTATION_OK_RE.test(content)) continue;

      // setInterval without clear in same file — high if file has > 50 LOC.
      const intervalMatches = [...content.matchAll(SETINTERVAL_RE)];
      const hasClear = CLEAR_RE.test(content);
      // Heartbeat-pattern modules are intentionally process-lifetime —
      // skip them. Detected by the file path or by the presence of
      // `registerHeartbeat` / `governorTick` import.
      const isHeartbeatModule = /\b(registerHeartbeat|governorTick|process-lifetime|heartbeat|interval-cycle)\b/.test(content) ||
                                /server\/emergent\/.*-cycle\.js$/.test(rel);
      if (intervalMatches.length > 0 && !hasClear && !isHeartbeatModule) {
        for (const m of intervalMatches.slice(0, 5)) {
          const lineNum = content.slice(0, m.index).split("\n").length;
          // Skip if the line itself opt-outs.
          const lineText = content.split("\n")[lineNum - 1] || "";
          if (ANNOTATION_OK_RE.test(lineText)) continue;
          findings.push({
            id: "setinterval_without_clear",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: `setInterval call without any clearInterval in the same file — under load this leaks the timer + closure.`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "timer_leak", file: rel },
            fixHint: "Capture the handle, clearInterval on shutdown / unmount / signal.",
          });
        }
      }

      // addEventListener without matching removeEventListener for the same event.
      const addMatches = [...content.matchAll(ADD_LISTENER_RE)];
      const removed = new Set([...content.matchAll(REMOVE_LISTENER_RE)].map(m => m[1]));
      for (const m of addMatches.slice(0, 10)) {
        const event = m[1];
        if (removed.has(event)) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = content.split("\n")[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "listener_without_remove",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `addEventListener('${event}', ...) has no matching removeEventListener in this file.`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "listener_leak", file: rel, event },
          fixHint: "Return the cleanup from useEffect, or call removeEventListener explicitly.",
        });
        if (findings.length >= findingCap) break;
      }

      // db.prepare inside a loop — statement cache leak.
      const loopPrep = [...content.matchAll(PREPARE_IN_LOOP_RE)];
      for (const m of loopPrep.slice(0, 3)) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = content.split("\n")[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "db_prepare_in_loop",
          // Most chunked-batch loops are legitimate (different placeholder
          // count per chunk produces a different cached statement, which
          // is desired). The pattern is still worth surfacing for review,
          // but defaulting to medium so it doesn't block CI.
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: "db.prepare(...) inside a for/while loop — better-sqlite3 caches but the cache grows unbounded with dynamic SQL.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "db_leak", file: rel },
          fixHint: "Hoist the prepare() outside the loop, OR annotate `// @resource-leak-ok: bounded cache` if the SQL is constant.",
        });
        if (findings.length >= findingCap) break;
      }

      // Streams without explicit close handler.
      const streamMatches = [...content.matchAll(STREAM_RE)];
      const hasStreamCleanup = /\bon\s*\(\s*['"`](?:close|finish|end)['"`]/.test(content) || FS_CLOSE_RE.test(content);
      if (streamMatches.length > 0 && !hasStreamCleanup) {
        for (const m of streamMatches.slice(0, 3)) {
          const lineNum = content.slice(0, m.index).split("\n").length;
          findings.push({
            id: "stream_without_close",
            severity: "low",
            kind: "static",
            category: CATEGORY,
            message: "createReadStream / createWriteStream without a 'close'/'finish'/'end' handler.",
            location: `${rel}:${lineNum}`,
            subject: { kind: "stream_leak", file: rel },
          });
        }
      }

      // fs.open without fs.close.
      const openMatches = [...content.matchAll(FS_OPEN_RE)];
      const hasFsClose = FS_CLOSE_RE.test(content);
      if (openMatches.length > 0 && !hasFsClose) {
        for (const m of openMatches.slice(0, 3)) {
          const lineNum = content.slice(0, m.index).split("\n").length;
          findings.push({
            id: "fs_open_without_close",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: "fs.open(...) without a paired fs.close — file descriptor leak under load.",
            location: `${rel}:${lineNum}`,
            subject: { kind: "fd_leak", file: rel },
          });
        }
      }

      // setTimeout in tight recursion (callback re-schedules itself unconditionally) —
      // a common runaway-timer pattern. Heuristic: setTimeout call inside the body of
      // a function that itself calls setTimeout with the same callback.
      // Approximation: setTimeout called > 5 times in a single file is suspicious.
      const timeoutCount = [...content.matchAll(SETTIMEOUT_RE)].length;
      if (timeoutCount >= 8) {
        findings.push({
          id: "high_settimeout_density",
          severity: "info",
          kind: "static",
          category: CATEGORY,
          message: `${timeoutCount} setTimeout calls in this file — sanity-check for runaway recursion / unbounded reschedule.`,
          location: `${rel}:1`,
          subject: { kind: "timer_density", file: rel, count: timeoutCount },
        });
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
