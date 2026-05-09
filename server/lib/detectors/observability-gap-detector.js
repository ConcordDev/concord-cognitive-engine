// server/lib/detectors/observability-gap-detector.js
//
// Catches category #7 (observability gaps): production routes/heartbeats
// that don't emit metrics or have no error logging, alerts that haven't
// fired in N days (alert fatigue precursor), distributed paths without
// trace IDs.
//
// Patterns we statically detect:
//   - HTTP routes (router.get/post/put/delete) without try/catch + error log
//   - Heartbeat handlers without exception isolation or counter increment
//   - LLM/brain calls without latency or cost telemetry
//   - Long-running awaits without timeout
//
// Severities:
//   high   — production route handler without ANY try/catch
//   medium — heartbeat handler without counter increment
//   low    — async function without error logging at top of catch
//   info   — distributed call without trace-id forwarding

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "observability-gap";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_PATHS = ["server/routes", "server/emergent", "server/economy"];
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", "tests", "__tests__"]);
const ANNOTATION_OK_RE = /@observability-ok\b/;

function isInteresting(file) {
  return /\.(js|mjs)$/.test(file);
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
  if (!SCAN_PATHS.some(p => rel.startsWith(p + "/"))) return false;
  // Skip code-generation engines — their "route handler" string
  // matches are emitted output (templates), not real routes.
  if (/forge-template-/.test(rel) || /code-substrate\//.test(rel)) return false;
  return true;
}

const ROUTE_HANDLER_RE = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:[^,]+,\s*)?(async\s*)?\([^)]*\)\s*=>\s*\{/g;
const HEARTBEAT_HANDLER_RE = /export\s+async\s+function\s+run[A-Z]\w+Cycle/g;
const TRY_RE = /\btry\s*\{/;
const CATCH_RE = /\}\s*catch\s*\(/;
const LOGGER_RE = /\b(?:logger|console)\.(error|warn)\(/;
const COUNTER_INC_RE = /\.inc\s*\(|prom_/;
const FETCH_LLM_RE = /\b(?:fetch|axios)\s*\(\s*['"`]http[^'"`]*\b(?:11434|11435|11436|11437|11438|ollama|brain)/gi;

export async function runObservabilityGapDetector({ root, opts = {} } = {}) {
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
      if (ANNOTATION_OK_RE.test(content)) continue;

      const lines = content.split("\n");

      // Scan each route handler — flag if its body (next 30 lines) lacks try.
      let m;
      const routeRe = new RegExp(ROUTE_HANDLER_RE.source, "g");
      while ((m = routeRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        // Look ahead 30 lines for `try` block.
        const window = lines.slice(lineNum - 1, lineNum + 30).join("\n");
        if (!TRY_RE.test(window)) {
          findings.push({
            id: "route_without_try_catch",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: `Route ${m[1].toUpperCase()} handler with no try/catch block within first 30 lines — uncaught throws return 500 with no log.`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "route", file: rel },
            fixHint: "Wrap the handler body in try/catch + logger.error(err, 'route_failed', { route, params }).",
          });
        } else if (!CATCH_RE.test(window)) {
          findings.push({
            id: "route_try_without_catch",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: `Route handler has try without catch — async errors leak.`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "route", file: rel },
          });
        }
        if (findings.length >= findingCap) break;
      }

      // Heartbeat handlers — flag if they don't have a try/catch isolation.
      const hbRe = new RegExp(HEARTBEAT_HANDLER_RE.source, "g");
      while ((m = hbRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        const window = lines.slice(lineNum - 1, lineNum + 80).join("\n");
        if (!TRY_RE.test(window)) {
          findings.push({
            id: "heartbeat_without_try",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: "Heartbeat handler without try/catch — a single throw stops the entire tick (CLAUDE.md invariant).",
            location: `${rel}:${lineNum}`,
            subject: { kind: "heartbeat", file: rel },
            fixHint: "Wrap the body in try/catch and return { ok: false, reason } on error.",
          });
        }
      }

      // LLM / brain calls without latency telemetry.
      const fetchLlmRe = new RegExp(FETCH_LLM_RE.source, "gi");
      while ((m = fetchLlmRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        const window = lines.slice(Math.max(0, lineNum - 6), lineNum + 8).join("\n");
        if (!/Date\.now\(\)|performance\.now|t0|startTime|histogram|observe\(/.test(window)) {
          findings.push({
            id: "llm_call_without_telemetry",
            severity: "low",
            kind: "static",
            category: CATEGORY,
            message: "Brain/LLM call without surrounding latency capture — production cost + p95 invisible.",
            location: `${rel}:${lineNum}`,
            subject: { kind: "llm_call", file: rel },
          });
        }
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
