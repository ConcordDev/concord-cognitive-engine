// server/lib/detectors/performance-hotspot-detector.js
//
// Flags likely performance issues:
//   - SELECT * (broad reads on hot tables)
//   - SQL inside loops (N+1 patterns)
//   - synchronous fs / crypto inside async request handlers
//   - regex with catastrophic-backtracking shape
//   - unbounded JSON.parse on a request body without size cap
//   - growing in-memory caches (Map/Set) without eviction
//
// All findings include the subject file:line so repair-cortex can route
// auto-fixes (e.g. wrap in batch query, switch to async fs API, etc.).

import path from "node:path";
import {
  walk, readSafe, makeReport, makeError, lineOf, relPath, snippet,
  syncFsExempt, sqlLoopExempt,
} from "./_framework.js";

const PATTERNS = [
  {
    id: "select_star_hot",
    severity: "low",
    description: "SELECT * — better to project explicit columns",
    regex: /SELECT\s+\*\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
  },
  {
    id: "sync_fs_in_handler",
    severity: "high",
    description: "Synchronous fs call (readFileSync / writeFileSync) inside async path",
    regex: /\bfs\.(?:readFileSync|writeFileSync|appendFileSync|statSync|existsSync)\s*\(/g,
    skipFiles: [/\/scripts\//, /\/migrations\//, /server\.js$/],
  },
  {
    id: "sync_crypto",
    severity: "medium",
    description: "Synchronous pbkdf2Sync / scryptSync — blocks the event loop",
    regex: /\bcrypto\.(?:pbkdf2Sync|scryptSync|randomBytesSync)\s*\(/g,
  },
  {
    id: "json_parse_no_limit",
    severity: "medium",
    description: "JSON.parse on a fetched body without an explicit size cap",
    regex: /JSON\.parse\s*\(\s*await\s+(?:res|response)\s*\.\s*text\s*\(\s*\)\s*\)/g,
  },
  {
    id: "uncaught_sql_loop",
    severity: "high",
    description: "Likely N+1 — db.prepare(...).get/all inside a for/while loop",
    customScan: (content, _file) => {
      // Tighter heuristic — earlier 12-line look-ahead window caught
      // sibling queries (queries that lived AFTER the loop closed) and
      // queries inside template literals (forge-template-engine generates
      // app code containing for+SELECT). This pass:
      //   - tracks brace nesting so the window stops at the loop's closing }
      //   - skips lines that are inside a backtick template literal
      //   - requires the db.prepare to be MORE indented than the loop
      const lines = content.split("\n");
      const out = [];
      // Pre-compute "is this line inside a template literal?" by counting
      // unescaped backticks up to the start of each line.
      const insideTemplate = new Array(lines.length).fill(false);
      let backticks = 0;
      let runningIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        insideTemplate[i] = (backticks % 2) === 1;
        const line = lines[i];
        runningIdx += line.length + 1;
        for (let j = 0; j < line.length; j++) {
          if (line[j] === "`" && (j === 0 || line[j - 1] !== "\\")) backticks++;
        }
      }
      for (let i = 0; i < lines.length; i++) {
        if (insideTemplate[i]) continue;
        const m = lines[i].match(/^(\s*).*\b(?:for|while)\s*\(/);
        if (!m) continue;
        const loopIndent = m[1].length;
        // Walk forward, tracking brace depth from the start of the loop body.
        let depth = 0;
        let started = false;
        let hit = false;
        for (let j = i; j < Math.min(i + 60, lines.length); j++) {
          if (insideTemplate[j]) continue;
          const ln = lines[j];
          // Strip /* … */ + // for cheaper brace counting.
          const stripped = ln.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
          for (const ch of stripped) {
            if (ch === "{") { depth++; started = true; }
            else if (ch === "}") {
              depth--;
              if (started && depth <= 0) { j = lines.length; break; }
            }
          }
          if (!started || depth <= 0) continue;
          // Inside the loop body: detect a query call.
          if (!/db\.prepare\s*\([^)]*\)\s*\.\s*(?:get|all|run)\b/.test(ln)) continue;
          // Ignore the boundary line (the for/while line itself).
          if (j === i) continue;
          // Require it to be indented strictly more than the loop header.
          const indMatch = ln.match(/^(\s*)/);
          if (!indMatch || indMatch[1].length <= loopIndent) continue;
          hit = true;
          break;
        }
        if (hit) {
          out.push({
            line: i + 1,
            snippet: snippet(lines[i].trim(), 100),
          });
        }
      }
      return out;
    },
    skipFiles: [/\/scripts\//, /\/migrations\//, /\.test\.js$/],
  },
  {
    id: "unbounded_cache_growth",
    severity: "low",
    description: "Module-level Map / Set with no eviction path (architectural review)",
    customScan: (content) => {
      // Tightened heuristic — earlier version flagged every Set/Map without
      // .delete/.clear, which over-reported by 500×. To be a real cache,
      // a Map/Set must:
      //   - Live at module scope (NOT inside a function body — locals die
      //     when the function returns).
      //   - Have a non-constant initializer (constants are written
      //     `new Set(["a","b","c"])` and never grow).
      //   - Have a non-UPPER_SNAKE_CASE name (constants are usually
      //     uppercase by convention).
      //   - Have at least one `.set(` / `.add(` callsite (otherwise it
      //     never grows).
      //   - Not be tagged `// @bounded-cache-ok: <reason>`.
      const lines = content.split("\n");
      const out = [];
      // Track brace nesting to determine module-scope vs function-scope.
      let depth = 0;
      let insideTemplate = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // crude template-literal toggle (cheap; not perfect)
        for (const ch of line) {
          if (ch === "`") insideTemplate = !insideTemplate;
        }
        if (insideTemplate) continue;
        // Update depth based on this line's effect on brace count, but
        // record depth-at-start so a `function () {` line that opens a
        // brace still treats the body as nested.
        const depthAtStart = depth;
        const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        for (const ch of stripped) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        if (depthAtStart > 0) continue;   // inside a function body — skip

        const m = line.match(/^\s*(?:const|let)\s+(\w+)\s*=\s*new\s+(Map|Set)\s*\(([^)]*)\)/);
        if (!m) continue;
        const [, name, kind, args] = m;
        // Constant initializer (`new Set([…])`) — not a cache.
        if (/^\s*\[[^[\]]*\]\s*$/.test(args)) continue;
        // UPPER_SNAKE_CASE — convention says it's a constant.
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
        // Bounded-cache annotation — explicit operator opt-out.
        if (/@bounded-cache-ok\b/.test(content) &&
            new RegExp(`\\b${name}\\b[^\\n]*@bounded-cache-ok`).test(content)) {
          continue;
        }
        // Must actually grow somewhere — `.set(` or `.add(` callsite.
        const growsRe = new RegExp(`\\b${name}\\.(?:set|add)\\s*\\(`);
        if (!growsRe.test(content)) continue;
        // And must NOT have an eviction path.
        const evictRe = new RegExp(`\\b${name}\\.(?:delete|clear)\\s*\\(`);
        if (evictRe.test(content)) continue;
        // Reassignment to a fresh container counts as eviction — `name = new Map(`.
        const reassignRe = new RegExp(`\\b${name}\\s*=\\s*new\\s+(?:Map|Set)\\s*\\(`);
        // Strip the declaration line itself before testing reassignment.
        const restOfFile = content.replace(line, "");
        if (reassignRe.test(restOfFile)) continue;

        out.push({ line: i + 1, name, kind });
      }
      return out;
    },
    skipFiles: [/\/tests?\//, /\/scripts\//, /\/migrations\//],
  },
  {
    id: "regex_catastrophic_shape",
    severity: "medium",
    description: "Regex with nested quantifier shape (a+)+ — risk of catastrophic backtracking",
    regex: /\/[^/\n]*\([^()/\n]*\+[^()/\n]*\)\+/g,
  },
  {
    id: "console_log_production",
    severity: "low",
    description: "console.log left in production code — drop or replace with logger",
    regex: /^\s*console\.log\s*\(/gm,
    skipFiles: [/\/tests?\//, /\/scripts\//, /\/migrations\//, /\/examples?\//],
  },
  {
    id: "empty_catch",
    severity: "medium",
    description: "Empty catch block — silent failure swallowed without observation",
    regex: /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g,
    // The autofix layer's docstrings literally contain the pattern they
    // match — skip those files so they don't self-flag.
    skipFiles: [/\/tests?\//, /\/scripts\//, /silent-ok/, /\/(?:lib\/)?autofix\//],
  },
];

export async function runPerformanceHotspotDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("performance-hotspot", "no_root", null, t0);

  try {
    const dir = path.join(root, "server");
    const files = await walk(dir, [".js"]);
    const findings = [];

    for (const f of files) {
      const rel = relPath(root, f);
      const c = await readSafe(f);
      if (!c) continue;
      // Files annotated `// @sync-fs-ok: <reason>` OR matching startup
      // path patterns get sync-fs findings demoted from high → low.
      const exemptFromSyncFs = syncFsExempt(rel, c);
      const exemptFromSqlLoop = sqlLoopExempt(rel, c);

      for (const p of PATTERNS) {
        if ((p.skipFiles || []).some(re => re.test(rel))) continue;

        // For sync_fs_in_handler specifically, demote severity for exempt
        // files instead of skipping outright — we still want visibility.
        // Same treatment for uncaught_sql_loop with @sql-loop-ok.
        const effectiveSeverity = (p.id === "sync_fs_in_handler" && exemptFromSyncFs) ? "low"
                                 : (p.id === "uncaught_sql_loop" && exemptFromSqlLoop) ? "low"
                                 : p.severity;

        if (p.customScan) {
          const hits = p.customScan(c, f) || [];
          for (const h of hits) {
            findings.push({
              id: `perf_${p.id}`,
              severity: effectiveSeverity,
              kind: "static",
              category: "performance",
              subject: { kind: "file", path: rel, line: h.line },
              message: `${p.description}`,
              location: `${rel}:${h.line}`,
              evidence: h,
              fixHint: p.id === "sync_fs_in_handler" ? "sync_fs_to_promises" : null,
            });
            if (findings.length > 800) break;
          }
        } else if (p.regex) {
          p.regex.lastIndex = 0;
          let m;
          while ((m = p.regex.exec(c)) != null) {
            findings.push({
              id: `perf_${p.id}`,
              severity: effectiveSeverity,
              kind: "static",
              category: "performance",
              subject: { kind: "file", path: rel, line: lineOf(c, m.index) },
              message: p.description,
              location: `${rel}:${lineOf(c, m.index)}`,
              evidence: { snippet: snippet(m[0], 80), exempt: exemptFromSyncFs },
              fixHint: p.id === "sync_fs_in_handler" ? "sync_fs_to_promises"
                     : p.id === "select_star_hot" ? "replace_select_star"
                     : p.id === "console_log_production" ? "drop_console_log"
                     : p.id === "empty_catch" ? "empty_catch_to_logger"
                     : null,
            });
            if (findings.length > 800) break;
          }
        }
        if (findings.length > 800) break;
      }
      if (findings.length > 800) break;
    }

    findings.unshift({
      id: "perf_summary",
      severity: "info",
      kind: "performance",
      message: `Scanned ${files.length} server files`,
      evidence: { fileCount: files.length, hits: findings.length },
    });

    return makeReport("performance-hotspot", findings, t0);
  } catch (err) {
    return makeError("performance-hotspot", "exception", err, t0);
  }
}
