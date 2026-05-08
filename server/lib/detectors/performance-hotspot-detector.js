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
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

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
    customScan: (content, file) => {
      // Heuristic: lines containing `for (` where the next 12 lines contain
      // a db.prepare/get/all call.
      const lines = content.split("\n");
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/\bfor\s*\(|\bwhile\s*\(/.test(lines[i])) continue;
        const window = lines.slice(i, i + 12).join("\n");
        if (/db\.prepare\s*\([^)]*\)\s*\.\s*(?:get|all|run)\b/.test(window)) {
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
    severity: "medium",
    description: "Module-level Map / Set used as cache with no eviction",
    customScan: (content) => {
      const out = [];
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*(?:const|let)\s+(\w+)\s*=\s*new\s+(Map|Set)\s*\(/);
        if (!m) continue;
        const name = m[1];
        // If the same file never calls .delete or .clear on this var, flag
        // (very rough — but the false-positive rate is acceptable for
        // an info-level finding).
        const evictRe = new RegExp(`\\b${name}\\.(?:delete|clear)\\s*\\(`);
        if (!evictRe.test(content)) {
          out.push({ line: i + 1, name, kind: m[2] });
        }
      }
      return out;
    },
    skipFiles: [/\/tests?\//, /\/scripts\//],
  },
  {
    id: "regex_catastrophic_shape",
    severity: "medium",
    description: "Regex with nested quantifier shape (a+)+ — risk of catastrophic backtracking",
    regex: /\/[^/\n]*\([^()/\n]*\+[^()/\n]*\)\+/g,
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

      for (const p of PATTERNS) {
        if ((p.skipFiles || []).some(re => re.test(rel))) continue;

        if (p.customScan) {
          const hits = p.customScan(c, f) || [];
          for (const h of hits) {
            findings.push({
              id: `perf_${p.id}`,
              severity: p.severity,
              kind: "performance",
              subject: { kind: "file", path: rel, line: h.line },
              message: `${p.description}`,
              location: `${rel}:${h.line}`,
              evidence: h,
            });
            if (findings.length > 800) break;
          }
        } else if (p.regex) {
          p.regex.lastIndex = 0;
          let m;
          while ((m = p.regex.exec(c)) != null) {
            findings.push({
              id: `perf_${p.id}`,
              severity: p.severity,
              kind: "performance",
              subject: { kind: "file", path: rel, line: lineOf(c, m.index) },
              message: p.description,
              location: `${rel}:${lineOf(c, m.index)}`,
              evidence: { snippet: snippet(m[0], 80) },
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
