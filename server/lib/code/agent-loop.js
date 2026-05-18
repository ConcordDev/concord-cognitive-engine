// server/lib/code/agent-loop.js
//
// Code Sprint B Item #6 — edit → test → fix → retry loop.
//
// What every 2026 rival ships and concord didn't:
//   Cursor Agent Mode, Windsurf Turbo, Copilot Workspace repair
//   agent, Claude Code's Bash loop, Aider's architect mode, Zed
//   parallel agents, Codex subagents.
//
// Real implementation:
//   1. Call the existing `code.multi-file-plan` macro to produce
//      a structured edit JSON (re-uses the multi-brain plan path
//      from server/domains/code.js).
//   2. Call `code.multi-file-apply` to land the edits (real disk
//      writes when CONCORD_CODE_PERSIST_TO_DISK is on).
//   3. Call `code.run_tests` to actually run the test runner
//      (real spawn-sync via server/lib/code/test-runner.js).
//   4. If failing, re-plan with the parsed failures as added
//      context. Loop until pass or maxIterations.
//
// Each iteration = one step DTU; the whole session = a
// kind='code_agent_session' DTU citing all steps + the original
// project memory bundle. No mocks, no fake "agent finished"
// responses — verdict comes from actual exit code.

import { randomUUID } from "node:crypto";

const DEFAULT_MAX_ITER = 5;
const DEFAULT_RUNNER = "npm";

function _runMacro(ctx, domain, name, input) {
  if (typeof ctx?.runMacro === "function") return ctx.runMacro(domain, name, input);
  if (typeof globalThis._concordRunMacro === "function") {
    return globalThis._concordRunMacro(domain, name, input, ctx);
  }
  throw new Error("no_macro_dispatcher");
}

function _mintStepDtu(db, userId, sessionId, step) {
  if (!db || !userId) return null;
  const id = `code_agent_step:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'code_agent_step', ?, ?, ?, 1, 0, unixepoch())
    `).run(id, `Step ${step.iteration} · ${step.verdict ?? 'planning'}`.slice(0, 200), userId, JSON.stringify({
      sessionId,
      iteration: step.iteration,
      verdict: step.verdict,
      plan: step.plan ? { editCount: step.plan.edits?.length ?? 0, narrative: step.plan.narrative } : null,
      apply: step.apply ? { appliedCount: step.apply.applied?.length ?? 0, skippedCount: step.apply.skipped?.length ?? 0 } : null,
      tests: step.tests ? {
        runner: step.tests.runner, exitCode: step.tests.exitCode,
        passed: step.tests.passed, failed: step.tests.failed,
        parsedFailures: (step.tests.parsedFailures || []).slice(0, 10),
      } : null,
    }));
    return id;
  } catch { return null; }
}

function _mintSessionDtu(db, userId, sessionId, summary, stepDtuIds) {
  if (!db || !userId) return null;
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'code_agent_session', ?, ?, ?, 1, 0, unixepoch())
    `).run(sessionId, summary.title.slice(0, 200), userId, JSON.stringify({
      ...summary, stepDtuIds,
    }));
    return sessionId;
  } catch { return null; }
}

/**
 * Run an edit → test → retry loop end to end.
 *
 * @param {object} ctx — runMacro-bearing macro context
 * @param {object} input
 * @param {string} input.task — natural-language change to make
 * @param {Array<{scriptId: string, filename: string, language: string, content: string}>} input.files
 * @param {string} [input.projectPath] — for the test runner
 * @param {string} [input.runner=npm]
 * @param {string[]} [input.runnerArgs=['test']]
 * @param {number} [input.maxIterations=5]
 * @param {string} [input.architectBrain] — Sprint B #7 split (default 'conscious')
 * @param {string} [input.editorBrain] — Sprint B #7 split (default 'utility')
 */
export async function runAgentLoop(ctx, input = {}) {
  const db = ctx?.db || ctx?.STATE?.db;
  const userId = ctx?.actor?.userId || ctx?.userId;
  const task = String(input.task || "").trim();
  if (!task) return { ok: false, reason: "task_required" };
  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length === 0) return { ok: false, reason: "files_required" };
  const projectPath = String(input.projectPath || input.project_path || "");
  if (!projectPath) return { ok: false, reason: "project_path_required" };
  const runner = String(input.runner || DEFAULT_RUNNER);
  const runnerArgs = Array.isArray(input.runnerArgs) ? input.runnerArgs : ["test"];
  const maxIterations = Math.min(10, Math.max(1, Number(input.maxIterations) || DEFAULT_MAX_ITER));
  const architectBrain = String(input.architectBrain || "conscious");
  const editorBrain = String(input.editorBrain || "utility");

  // Active project memory becomes the leading system prompt for every
  // iteration's plan call.
  let memoryPrompt = "";
  try {
    const m = await _runMacro(ctx, "code", "memory_active_prompt", { projectPath });
    if (m?.ok && m.prompt) memoryPrompt = m.prompt;
  } catch { /* memory is optional */ }

  const sessionId = `code_agent_session:${randomUUID()}`;
  const steps = [];
  const stepDtuIds = [];
  let lastFailures = null;
  let currentFiles = files.map((f) => ({ ...f }));

  for (let i = 1; i <= maxIterations; i++) {
    const planInput = {
      prompt: task,
      files: currentFiles,
      architectBrain, editorBrain,
      systemContext: memoryPrompt + (lastFailures
        ? `\n\nPrevious iteration failed. Failures to fix:\n${lastFailures.slice(0, 10).map((f, ix) => `${ix + 1}. ${f.file || "?"}:${f.line || "?"} — ${f.msg}`).join("\n")}`
        : ""),
    };
    let plan;
    try {
      plan = await _runMacro(ctx, "code", "multi-file-plan", planInput);
    } catch (err) {
      return { ok: false, reason: "plan_dispatch_failed", error: err?.message };
    }
    if (!plan?.ok && !plan?.result) {
      const step = { iteration: i, verdict: "plan_failed", plan: null };
      steps.push(step);
      const dtuId = _mintStepDtu(db, userId, sessionId, step);
      if (dtuId) stepDtuIds.push(dtuId);
      break;
    }
    const planResult = plan.result || plan;
    const apply = await _runMacro(ctx, "code", "multi-file-apply", {
      edits: (planResult.edits || []).map((e) => ({
        scriptId: e.scriptId, filename: e.filename, language: e.language, after: e.after, reason: e.reason,
      })),
    });
    const applyResult = apply?.result || apply;
    const tests = await _runMacro(ctx, "code", "run_tests", {
      runner, projectPath, args: runnerArgs,
    });
    const verdict = tests?.ok && tests.verdict === "pass" ? "pass" : "fail";
    const step = {
      iteration: i, verdict,
      plan: planResult,
      apply: applyResult,
      tests,
    };
    steps.push(step);
    const dtuId = _mintStepDtu(db, userId, sessionId, step);
    if (dtuId) stepDtuIds.push(dtuId);
    if (verdict === "pass") {
      const summary = {
        title: `Agent loop · pass after ${i} iter`,
        task, projectPath, runner, runnerArgs,
        iterations: i, verdict: "pass",
      };
      _mintSessionDtu(db, userId, sessionId, summary, stepDtuIds);
      return { ok: true, sessionId, iterations: i, verdict: "pass", steps, stepDtuIds };
    }
    // Re-plan with new context next iteration.
    lastFailures = tests?.parsedFailures || [];
    // Update currentFiles with the applied content so the next plan
    // starts from the just-applied state, not stale originals.
    if (Array.isArray(applyResult?.applied)) {
      for (const a of applyResult.applied) {
        const f = currentFiles.find((x) => x.scriptId === a.scriptId);
        if (f && typeof a.bytes === "number") {
          // We don't have the new content back from apply, but the
          // plan already had it; map by edit.
          const e = (planResult.edits || []).find((x) => x.scriptId === a.scriptId);
          if (e?.after) f.content = e.after;
        }
      }
    }
  }
  const summary = {
    title: `Agent loop · gave up after ${maxIterations} iter`,
    task, projectPath, runner, runnerArgs,
    iterations: maxIterations, verdict: "fail",
  };
  _mintSessionDtu(db, userId, sessionId, summary, stepDtuIds);
  return { ok: true, sessionId, iterations: maxIterations, verdict: "fail", steps, stepDtuIds, lastFailures };
}
