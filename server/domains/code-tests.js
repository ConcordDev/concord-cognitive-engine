// server/domains/code-tests.js
//
// Code Sprint A — Item #1: real test runner macros.
//
// Wraps server/lib/code/test-runner.js (real spawn-sync, never throws)
// and mints each run as a kind='code_test_run' DTU so test history is
// queryable and citable. Failures stay on the lineage for the edit →
// test → fix loop (Sprint B item #6).

import { runTests, allowedRunners, workspaceRoot } from "../lib/code/test-runner.js";
import { randomUUID } from "node:crypto";

async function _mintTestRunDtu(db, userId, result, parentEditDtuId) {
  if (!db || !userId) return null;
  const id = `code_test_run:${randomUUID()}`;
  const meta = {
    runner: result.runner,
    projectPath: result.projectPath,
    exitCode: result.exitCode,
    verdict: result.verdict,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    durationMs: result.durationMs,
    parsedFailuresCount: result.parsedFailures?.length || 0,
    parsedFailures: (result.parsedFailures || []).slice(0, 20),
    parentEditDtuId: parentEditDtuId || null,
  };
  const title = `Test run · ${result.runner} · ${result.verdict} · ${result.passed}p ${result.failed}f`;
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'code_test_run', ?, ?, ?, 1, 0, unixepoch())
    `).run(id, title.slice(0, 120), userId, JSON.stringify(meta));
    if (parentEditDtuId) {
      try {
        const { registerCitation } = await import("../economy/royalty-cascade.js");
        await registerCitation({
          db, citingDtuId: id, citedDtuId: parentEditDtuId,
          citerUserId: userId,
          parentDtu: { visibility: "public" },
        });
      } catch { /* cascade best-effort */ }
    }
    return id;
  } catch {
    return null;
  }
}

export default function registerCodeTestMacros(register) {
  register("code", "run_tests", async (ctx, input = {}) => {
    const runner = String(input.runner || "").trim();
    const projectPath = String(input.projectPath || input.project_path || "").trim();
    const args = Array.isArray(input.args) ? input.args : [];
    const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : undefined;
    const parentEditDtuId = input.parentEditDtuId || input.parent_edit_dtu_id || null;
    const result = runTests({ runner, projectPath, args, timeoutMs });
    const userId = ctx?.actor?.userId || ctx?.userId;
    const db = ctx?.db || ctx?.STATE?.db;
    if (result.ok && db && userId) {
      // Note: _mintTestRunDtu uses `await import` inside; we wrap that
      // path to avoid swallowing failures silently in the result.
      try {
        const id = await _mintTestRunDtu(db, userId, result, parentEditDtuId);
        if (id) result.dtuId = id;
      } catch { /* mint best-effort; result still returns */ }
    }
    return result;
  }, { destructive: true, note: "Execute tests via spawn-sync; env-allowlisted runner; mints code_test_run DTU on success" });

  register("code", "list_runners", async () => {
    return { ok: true, runners: allowedRunners(), workspaceRoot: workspaceRoot() };
  }, { note: "Lists allowed test runners + workspace root for the UI" });
}
