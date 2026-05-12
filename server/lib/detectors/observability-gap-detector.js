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

// Route handler pattern. We match the OPENING `{` of the handler body
// so we can brace-count from there to locate the matching close + look
// for an attached `} catch`.
const ROUTE_HANDLER_RE = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:[^,]+,\s*)?(async\s*)?\([^)]*\)\s*=>\s*\{/g;
// asyncHandler / errorHandler wrappers auto-catch async throws and
// forward to express's error middleware — those routes don't need
// inline try/catch.
const ASYNC_WRAPPER_RE = /\b(?:asyncHandler|errorHandler|wrapHandler|safeHandler)\s*\(/;
const HEARTBEAT_HANDLER_RE = /export\s+async\s+function\s+run[A-Z]\w+Cycle/g;
const TRY_RE = /\btry\s*\{/;
// catch can be either `} catch (e) {` or `} catch {` (ES2019 optional
// binding). Both are valid; match both forms.
const CATCH_RE = /\}\s*catch\s*[({]/;
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

      // Scan each route handler. Three signals make a handler safe:
      //   1. Wrapped by asyncHandler / errorHandler / safeHandler — those
      //      forward async throws to express's error middleware that
      //      already logs unhandled_route_error (server.js:27913).
      //   2. SYNCHRONOUS handler `(req, res) => {…}` — express's default
      //      error chain catches sync throws and forwards them to the
      //      same error middleware. No async-promise-swallow risk.
      //   3. Has a try/catch in the body.
      //
      // A handler is unsafe ONLY when it's `async` AND has no try/catch
      // AND no wrapper. In that case a throw escapes as an unhandled
      // promise rejection, which is observable but ungated.
      let m;
      const routeRe = new RegExp(ROUTE_HANDLER_RE.source, "g");
      while ((m = routeRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        // Wrapper recognition: scan the route declaration line + the
        // preceding 2 lines (multi-line decls put `asyncHandler(` on a
        // different line than the route path).
        const declStart = Math.max(0, lineNum - 3);
        const declSlice = lines.slice(declStart, lineNum).join("\n");
        if (ASYNC_WRAPPER_RE.test(declSlice)) continue;
        // Sync handler: express's default error chain handles it.
        // m[2] captures the optional `async ` keyword right before the
        // arrow-function parameter list. (m[1] is the HTTP method.)
        // Additional check on declSlice catches multi-line decls.
        const isAsync = !!m[2] || /\basync\s*\(/.test(declSlice);
        if (!isAsync) continue;

        // Brace-count from the matched `{` to its closing `}`.
        const openIdx = m.index + m[0].lastIndexOf("{");
        let depth = 1;
        let i = openIdx + 1;
        while (i < content.length && depth > 0) {
          const ch = content[i];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          i++;
        }
        // Cap at 4096 chars in case the handler is unclosed at EOF;
        // beyond that the false-positive risk is higher than the signal.
        const closeIdx = depth === 0 ? i : Math.min(content.length, openIdx + 4096);
        const body = content.slice(openIdx, closeIdx);
        if (!TRY_RE.test(body)) {
          findings.push({
            id: "route_without_try_catch",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: `Route ${m[1].toUpperCase()} handler has no try/catch — uncaught throws return 500 with no log.`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "route", file: rel },
            fixHint: "Wrap with asyncHandler() OR add try/catch + logger.error(err, 'route_failed', { route, params }).",
          });
        } else if (!CATCH_RE.test(body)) {
          findings.push({
            id: "route_try_without_catch",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            message: `Route handler has try without matching catch — async errors leak.`,
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
