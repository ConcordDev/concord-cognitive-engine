// server/lib/detectors/agent-budget-detector.js
//
// Catches category #10 (AI/agent-specific): LLM calls in hot paths
// without throttling, agent loops without budget caps, multi-step
// agent flows without max-iteration limits, hallucination passthrough
// (LLM output written directly to user without bounds check).
//
// Patterns:
//   - LLM call inside a heartbeat handler without rate limit
//   - while (true) / for (;;) loop containing an LLM call
//   - Agent recursion without depth bound
//   - LLM output passed to res.json / response without sanitization
//   - Cost-tracking gap: LLM call without an associated cost increment
//
// Severities:
//   high   — agent recursion / while-true without budget cap
//   medium — LLM call inside a heartbeat without rate limit guard
//   low    — LLM output sent to user without length cap
//   info   — LLM call lacking cost-tracking annotation

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "agent-budget";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_PATHS = ["server/lib", "server/emergent", "server/routes"];
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", "tests", "__tests__"]);
const ANNOTATION_OK_RE = /@agent-budget-ok\b/;

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
  return SCAN_PATHS.some(p => rel.startsWith(p + "/"));
}

const LLM_CALL_RE = /\b(?:ctx\.llm\.chat|callBrain|callLLM|callOllama|callVision|fetch.*ollama|invokeBrain)\s*\(/gi;
const WHILE_TRUE_RE = /\bwhile\s*\(\s*(?:true|1)\s*\)\s*\{[^}]{0,4000}\b(?:ctx\.llm|callBrain|callLLM|callOllama|callVision)/gs;
const FOR_INFINITE_RE = /\bfor\s*\(\s*;\s*;\s*\)\s*\{[^}]{0,4000}\b(?:ctx\.llm|callBrain|callLLM|callOllama|callVision)/gs;
const RECURSE_RE = /async\s+function\s+(\w+)[^{]*\{[^}]{0,3000}\b\1\s*\(/gs;
const HEARTBEAT_FN_RE = /export\s+async\s+function\s+(run[A-Z]\w+Cycle)/g;

export async function runAgentBudgetDetector({ root, opts = {} } = {}) {
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

      // High: while(true) containing an LLM call.
      let m;
      const wtRe = new RegExp(WHILE_TRUE_RE.source, "gs");
      while ((m = wtRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "while_true_with_llm_call",
          severity: "high",
          kind: "static",
          category: CATEGORY,
          message: "while (true) loop containing an LLM call — risk of unbounded cost spiral.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "agent_loop", file: rel },
          fixHint: "Add an explicit iteration cap + cost budget; break when reached. Annotate `// @agent-budget-ok: <reason>` if the loop is externally bounded.",
        });
      }

      const fiRe = new RegExp(FOR_INFINITE_RE.source, "gs");
      while ((m = fiRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "for_infinite_with_llm_call",
          severity: "high",
          kind: "static",
          category: CATEGORY,
          message: "for(;;) loop containing an LLM call — same cost-spiral risk.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "agent_loop", file: rel },
        });
      }

      // High: async self-recursion containing an LLM call (within ~3000 chars
      // of the recursive call). We use a separate check for the LLM call
      // proximity since the regex above just matches recursion structure.
      const recRe = new RegExp(RECURSE_RE.source, "gs");
      while ((m = recRe.exec(content)) !== null) {
        const fnBody = m[0];
        if (!LLM_CALL_RE.test(fnBody)) continue;
        // Require an explicit depth-cap parameter in signature OR
        // a depth-related guard in body to clear.
        if (/\b(maxDepth|depth\s*<|MAX_RECURSION|MAX_DEPTH|MAX_ITERATIONS|MAX_BUDGET|budgetRemaining)/i.test(fnBody)) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "recursive_llm_without_depth_cap",
          severity: "high",
          kind: "static",
          category: CATEGORY,
          message: `Async function '${m[1]}' recursively calls itself and contains an LLM call with no visible depth/budget cap.`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "agent_recursion", file: rel, fn: m[1] },
        });
      }

      // Medium: LLM call inside a heartbeat handler without rate-limit guard
      // (no throttling logic visible in the function body).
      const hbRe = new RegExp(HEARTBEAT_FN_RE.source, "g");
      while ((m = hbRe.exec(content)) !== null) {
        const startLine = content.slice(0, m.index).split("\n").length;
        const window = lines.slice(startLine - 1, startLine + 80).join("\n");
        const hasLlm = LLM_CALL_RE.test(window);
        if (!hasLlm) continue;
        const hasThrottle = /\b(Date\.now\(\)\s*-\s*last|MIN_INTERVAL|throttle|rateLimit|MAX_PER_PASS|MAX_PER_CYCLE)\b/.test(window);
        if (hasThrottle) continue;
        const lineText = lines[startLine - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        findings.push({
          id: "heartbeat_llm_without_throttle",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Heartbeat ${m[1]} contains an LLM call without visible rate-limit or per-pass cap.`,
          location: `${rel}:${startLine}`,
          subject: { kind: "heartbeat_agent", file: rel, fn: m[1] },
          fixHint: "Add a MAX_PER_PASS cap or a MIN_INTERVAL guard before the LLM call.",
        });
      }

      // Low: LLM output sent directly to a user response without length cap.
      // Heuristic: `res.json({...llm.content})` or `res.send(...llm.content)`
      // without a `.slice(0, N)` or `.substring(0, N)` near it.
      const resWithLlm = /res\.(?:json|send|write)\s*\([^)]{0,200}\b(content|message|response|completion)\b/g;
      let rm;
      while ((rm = resWithLlm.exec(content)) !== null) {
        const lineNum = content.slice(0, rm.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        const window = lines.slice(Math.max(0, lineNum - 4), lineNum + 4).join("\n");
        if (/\.slice\(\s*0\s*,|\.substring\(\s*0\s*,|\.substr\(\s*0\s*,|MAX_RESPONSE|truncate/.test(window)) continue;
        // Only report if there's also an LLM call in this file (correlate).
        if (!LLM_CALL_RE.test(content)) continue;
        findings.push({
          id: "llm_output_without_length_cap",
          severity: "low",
          kind: "static",
          category: CATEGORY,
          message: "LLM-shaped output passed to res.* without a visible length cap — hallucination passthrough risk.",
          location: `${rel}:${lineNum}`,
          subject: { kind: "llm_passthrough", file: rel },
        });
        // One per file is enough to prompt review.
        break;
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
