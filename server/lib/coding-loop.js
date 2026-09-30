// server/lib/coding-loop.js
//
// P7 — Open-ended coding loop: index → search → verify.
// Deterministic orchestration; marathon/LLM handles actual edits.

import { findSymbol, indexRepo, repoGraphOverview } from "./runtime/repo-graph.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function extractKeywords(goal) {
  const g = String(goal || "").toLowerCase();
  const words = g.match(/[a-z][a-z0-9_-]{2,}/gi) || [];
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "make", "fix", "add"]);
  return words.filter((w) => !stop.has(w)).slice(0, 5).join(" ") || g.slice(0, 40);
}

/**
 * Plan a coding-loop mission from a natural-language goal.
 */
export function planCodingLoop(goal, opts = {}) {
  const g = String(goal || "").trim();
  if (!g) return { ok: false, reason: "missing_goal" };
  const query = opts.query || extractKeywords(g);
  const testPattern = opts.testPattern || extractKeywords(g).split(" ")[0] || "mission";

  return {
    ok: true,
    title: `Coding loop: ${g.slice(0, 60)}`,
    goal: g,
    template: "coding_loop_closed",
    planner: "pce",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "pce_execute", args: {} },
      { tool: "coding_loop_verify", args: { testPattern } },
    ],
  };
}

export async function searchCodingTargets(db, { query, repoRoot } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "missing_query" };
  const matches = findSymbol(db, repoRoot, q);
  return { ok: true, query: q, count: matches.length, matches: matches.slice(0, 25) };
}

/**
 * Run targeted test verification (node --test with name pattern).
 */
export async function verifyCodingTests({ testPattern, cwd } = {}) {
  const pattern = String(testPattern || "").trim();
  if (!pattern) return { ok: false, reason: "missing_test_pattern" };

  const root = cwd || process.cwd().replace(/\/server$/, "") || process.cwd();
  const serverDir = root.endsWith("/server") ? root : `${root}/server`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--test", "--test-name-pattern", pattern, "tests/depth/mission-runtime-behavior.test.js"],
      { cwd: serverDir, timeout: 120_000, env: { ...process.env, NODE_ENV: "test" } },
    );
    const combined = `${stdout}\n${stderr}`;
    const passed = !/not ok/i.test(combined) || /# pass \d+/.test(combined);
    return { ok: passed, pattern, testsPassed: passed, outputTail: combined.slice(-2000) };
  } catch (e) {
    const out = `${e.stdout || ""}\n${e.stderr || ""}`;
    const passed = e.code === 0;
    return {
      ok: passed,
      pattern,
      testsPassed: passed,
      outputTail: out.slice(-2000),
      error: e.message,
    };
  }
}

export async function runCodingLoopIteration({ db, goal, dispatchMCP, repoRoot } = {}) {
  const plan = planCodingLoop(goal);
  if (!plan.ok) return plan;

  const idx = await indexRepo(db, repoRoot);
  const search = await searchCodingTargets(db, { query: extractKeywords(goal), repoRoot });
  let verify = { ok: true, skipped: true };
  if (typeof dispatchMCP === "function") {
    await dispatchMCP("concordia_assemble", {}, { db });
    await dispatchMCP("concordia_verify", {}, { db });
  }
  if (process.env.CONCORD_CODING_LOOP_VERIFY !== "0") {
    verify = await verifyCodingTests({ testPattern: extractKeywords(goal).split(" ")[0] });
  }

  return {
    ok: idx.ok && search.ok,
    goal,
    index: idx,
    search,
    verify,
    overview: repoGraphOverview(db, repoRoot),
  };
}
