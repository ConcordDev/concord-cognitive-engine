// server/lib/runtime/mission-decomposer.js
//
// Parallel mission decomposition — splits multi-domain goals into parallel_batch tasks.

import { planDeterministic } from "../mission-planner.js";
import { AUTONOMOUS_SAFE_TOOLS } from "../mission-templates.js";

const PARALLEL_KEYWORDS = [
  { re: /\baudit\b.*\b(trading|market|code|database)\b/i, branches: ["research_filter", "economic_check", "sentinel_sweep"] },
  { re: /\b(research|audit).*\b(code|repo)\b/i, branches: ["repo_graph_index", "coding_loop_search", "concordia_verify"] },
  { re: /\b(full|comprehensive)\b.*\b(system|fleet|ops)\b/i, branches: ["sentinel_sweep", "concordia_assemble", "economic_check", "experience_stats"] },
];

export function shouldDecomposeParallel(goal, executionMode) {
  if (executionMode === "parallel") return true;
  const g = String(goal || "");
  return PARALLEL_KEYWORDS.some((k) => k.re.test(g)) || /\bparallel\b/i.test(g);
}

export function decomposeToParallelSteps(goal, opts = {}) {
  const g = String(goal || "").trim();
  if (!g) return { ok: false, reason: "missing_goal" };

  for (const { re, branches } of PARALLEL_KEYWORDS) {
    if (re.test(g)) {
      const tasks = branches
        .filter((tool) => AUTONOMOUS_SAFE_TOOLS.has(tool) || tool.startsWith("repo_graph") || tool.startsWith("coding_loop"))
        .map((tool) => ({ tool, args: opts.args || {} }));
      if (tasks.length >= 2) {
        return {
          ok: true,
          title: g.slice(0, 80),
          goal: g,
          template: "parallel_audit",
          planner: "parallel_decomposer",
          executionMode: "parallel",
          steps: [
            { tool: "parallel_batch", args: { tasks, concurrency: opts.concurrency || 3 } },
            { tool: "trace_recent", args: { limit: 10 } },
            { tool: "economic_check", args: {} },
          ],
        };
      }
    }
  }

  const base = planDeterministic(g, opts);
  if (!base.ok) return base;

  if (shouldDecomposeParallel(g, opts.executionMode) && base.steps?.length >= 3) {
    const safeTasks = base.steps.filter((s) => AUTONOMOUS_SAFE_TOOLS.has(s.tool));
    if (safeTasks.length >= 2) {
      return {
        ...base,
        executionMode: "parallel",
        planner: "parallel_wrap",
        steps: [
          { tool: "parallel_batch", args: { tasks: safeTasks.slice(0, 4), concurrency: 2 } },
          ...base.steps.filter((s) => !safeTasks.find((t) => t.tool === s.tool)).slice(0, 2),
        ],
      };
    }
  }

  return base;
}

export function mergeParallelResults(batchResult) {
  const results = batchResult?.results || batchResult?.result?.results || [];
  const completed = results.filter((r) => r.ok !== false).length;
  const failed = results.length - completed;
  return {
    ok: failed === 0,
    partial: failed > 0 && completed > 0,
    completed,
    failed,
    total: results.length,
    summary: `parallel_batch: ${completed}/${results.length} succeeded`,
  };
}
