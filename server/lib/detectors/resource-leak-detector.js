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
// Event names can be namespaced ("entity:death", "concordia:hit-reaction")
// or plain word characters. Allow colons, hyphens, and dots so the
// "matching remove" lookup catches namespaced + Concord-emergent events.
const ADD_LISTENER_RE = /\.addEventListener\s*\(\s*['"`]([\w:.-]+)['"`]/g;
const REMOVE_LISTENER_RE = /\.removeEventListener\s*\(\s*['"`]([\w:.-]+)['"`]/g;
const STREAM_RE = /\bcreate(Read|Write)Stream\s*\(/g;
const FS_OPEN_RE = /\bfs\.(?:promises\.)?open\s*\(/g;
const FS_CLOSE_RE = /\bfs\.(?:promises\.)?close\s*\(|\.close\(\)|\.end\(\)/;
// Locate `for (…) {` / `while (…) {` opening braces; brace-counting
// later verifies whether a db.prepare() actually lives INSIDE the
// loop body (vs after it).
const LOOP_OPEN_RE = /\b(for|while)\s*\([^)]*\)\s*\{/g;
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

      // db.prepare inside a loop — only a real leak when:
      //   (a) the prepare is ACTUALLY inside the loop's brace-balanced
      //       body (not after it), AND
      //   (b) the SQL is dynamic (template `${…}` or string concat).
      // better-sqlite3 caches prepared statements by SQL string; a
      // constant SQL adds 1 cache entry, dynamic SQL adds N.
      const loopOpens = [...content.matchAll(LOOP_OPEN_RE)];
      let loopFindings = 0;
      for (const m of loopOpens) {
        if (loopFindings >= 3) break;
        // Brace-count from the loop's opening `{` to its matching `}`.
        const openIdx = m.index + m[0].lastIndexOf("{");
        let depth = 1;
        let i = openIdx + 1;
        while (i < content.length && depth > 0) {
          const ch = content[i];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          i++;
        }
        const closeIdx = depth === 0 ? i : Math.min(content.length, openIdx + 4096);
        const body = content.slice(openIdx, closeIdx);
        // Locate db.prepare( inside the body
        const prepareInBody = body.indexOf("db.prepare");
        if (prepareInBody < 0) continue;
        // Extract just the SQL string passed to db.prepare(...). The
        // dynamism check has to scan only that string — not the chained
        // .run()/.all() args that follow, which often interpolate
        // runtime values into BIND parameters (and would falsely mark
        // every prepare with template-literal binds as dynamic SQL).
        const prepareAbsIdx = openIdx + prepareInBody;
        const afterParen = content.slice(prepareAbsIdx + "db.prepare(".length);
        // Find the FIRST string literal (`, ', or ") and capture up to
        // its matching closing quote. Skip leading whitespace.
        const m1 = afterParen.match(/^\s*([`'"])/);
        if (!m1) continue;
        const quote = m1[1];
        const stringStart = afterParen.indexOf(quote);
        let j = stringStart + 1;
        let sqlString = "";
        // Walk forward respecting backslash escapes, find matching quote.
        while (j < afterParen.length) {
          const ch = afterParen[j];
          if (ch === "\\") { sqlString += ch + (afterParen[j + 1] || ""); j += 2; continue; }
          if (ch === quote) break;
          sqlString += ch;
          j++;
        }
        // Dynamic when EITHER:
        //   (a) the SQL string itself contains `${...}` template
        //       interpolation (template-literal SQL building), OR
        //   (b) the SQL string is followed by `+ <expr>` outside the
        //       string (string-concat SQL building).
        // The `?` parameter placeholder is NOT dynamic SQL — it's a
        // bind that better-sqlite3 caches as the same query.
        const tail = afterParen.slice(j + 1, j + 200);
        const isTemplateInterpolated = /\$\{/.test(sqlString);
        const isConcat = /^\s*\+\s*[^)\s]/.test(tail);
        const isDynamic = isTemplateInterpolated || isConcat;
        if (!isDynamic) continue;

        // BOUNDED-CARDINALITY EXEMPTION. Template interpolation only leaks
        // the statement cache when it can produce UNBOUNDED distinct SQL.
        // When every `${…}` resolves to a SMALL, fixed set, the cache is
        // bounded → not a leak. Two statically-detectable safe shapes:
        //   (A) ternary with string-literal branches:
        //         `... ${flag ? ", x = 1" : ""} ...`  → ≤2 distinct SQL.
        //   (B) the interpolated identifier is the iterator of an
        //       enclosing `for (const X of CONST)` where CONST is an
        //       UPPER_SNAKE_CASE constant (e.g. PER_WORLD_WRITE_TABLES) —
        //       the SQL varies only across a fixed table list.
        // The `+ concat` form (no template) is left as-is — its
        // boundedness can't be judged from the literal alone.
        if (isTemplateInterpolated && !isConcat) {
          const interps = [];
          const ire = /\$\{([^}]*)\}/g;
          let im;
          while ((im = ire.exec(sqlString)) !== null) interps.push(im[1].trim());
          // Loop header text (`for (const t of PER_WORLD_WRITE_TABLES) {`).
          const loopHeader = m[0] || "";
          // Iterators bound to an UPPER_SNAKE_CASE constant in this loop.
          const boundedIterators = new Set();
          const itm = loopHeader.match(/\bfor\s*\(\s*(?:const|let|var)\s+(?:\[\s*([\w,\s]+)\s*\]|(\w+))\s+of\s+([A-Z][A-Z0-9_]*)\b/);
          if (itm) {
            const names = (itm[1] || itm[2] || "").split(",").map(s => s.trim()).filter(Boolean);
            for (const n of names) boundedIterators.add(n);
          }
          const isBoundedInterp = (expr) => {
            // (A) ternary with both branches string literals.
            const tern = expr.match(/^[^?]+\?\s*(['"`])(?:[^'"`]*)\1\s*:\s*(['"`])(?:[^'"`]*)\2$/);
            if (tern) return true;
            // (B) bare identifier that is a bounded loop iterator.
            if (/^\w+$/.test(expr) && boundedIterators.has(expr)) return true;
            return false;
          };
          if (interps.length > 0 && interps.every(isBoundedInterp)) continue;
        }
        const lineNum = content.slice(0, prepareAbsIdx).split("\n").length;
        const lineText = content.split("\n")[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        // Also accept the annotation up to 3 lines above the prepare.
        let exempted = false;
        for (let j = Math.max(0, lineNum - 4); j < lineNum; j++) {
          if (ANNOTATION_OK_RE.test(content.split("\n")[j] || "")) { exempted = true; break; }
        }
        if (exempted) continue;
        findings.push({
          id: "db_prepare_in_loop",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: "db.prepare(...) inside a loop with DYNAMIC SQL — statement cache grows unbounded.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "db_leak", file: rel },
          fixHint: "Build the SQL once outside the loop using a parameter placeholder, OR annotate `// @resource-leak-ok: <reason>` if the dynamic axis is bounded.",
        });
        loopFindings++;
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
