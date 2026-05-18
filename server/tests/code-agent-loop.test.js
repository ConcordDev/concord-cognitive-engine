// server/tests/code-agent-loop.test.js
//
// Tier-2 contract test for Code Sprint B #6 — edit→test→fix loop.
// We run the loop with a stub ctx.runMacro that simulates a planning
// brain whose first iteration ships a failing patch and second
// iteration fixes it (against a REAL `node`-based test runner). The
// real spawning happens in test-runner.js — we exercise both layers.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { runAgentLoop } from "../lib/code/agent-loop.js";
import registerCodeTestMacros from "../domains/code-tests.js";

describe("agent-loop: real-runner edit → test → fix → retry", () => {
  let workdir; const macros = new Map(); let db;
  before(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    )`);
    workdir = mkdtempSync(join(tmpdir(), "agent-loop-"));
    process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
    process.env.CONCORD_TEST_RUNNERS = "node";
    const register = (_d, n, h) => macros.set(n, h);
    registerCodeTestMacros(register);
  });
  after(() => {
    rmSync(workdir, { recursive: true, force: true });
    try { db.close(); } catch { /* ok */ }
  });

  it("loop converges on a real-passing test on iteration 2", async () => {
    // Failing initial state: the test script exits 1.
    writeFileSync(join(workdir, "check.js"), `
      const fs = require('fs');
      const content = fs.readFileSync('${workdir}/source.js', 'utf-8');
      if (content.includes('return 42')) { process.exit(0); }
      else { console.error('expected: return 42'); process.exit(1); }
    `);
    writeFileSync(join(workdir, "source.js"), "function answer() { return 7; }");

    let iter = 0;
    const planFirst = `function answer() { return 13; }`; // still wrong
    const planFinal = `function answer() { return 42; }`; // right

    const ctx = {
      db,
      actor: { userId: "u_test" },
      runMacro: async (domain, name, input) => {
        if (domain !== "code") throw new Error("unexpected domain " + domain);
        if (name === "multi-file-plan") {
          iter++;
          const after = iter === 1 ? planFirst : planFinal;
          return { ok: true, result: { edits: [{
            scriptId: "source",
            filename: "source.js",
            language: "javascript",
            before: "function answer() { return 7; }",
            after,
            reason: iter === 1 ? "first attempt" : "fix per failure",
          }]}};
        }
        if (name === "multi-file-apply") {
          // Real write to disk so the next test invocation sees it.
          const e = input.edits[0];
          writeFileSync(join(workdir, e.filename), e.after);
          return { ok: true, result: { applied: [{ scriptId: e.scriptId, filename: e.filename, bytes: e.after.length, revision: iter }], skipped: [] }};
        }
        if (name === "run_tests") {
          return macros.get("run_tests")(ctx, input);
        }
        if (name === "memory_active_prompt") return { ok: true, prompt: "" };
        throw new Error("unexpected macro " + name);
      },
    };

    const r = await runAgentLoop(ctx, {
      task: "make answer() return 42",
      files: [{ scriptId: "source", filename: "source.js", language: "javascript", content: "function answer() { return 7; }" }],
      projectPath: workdir,
      runner: "node",
      runnerArgs: ["check.js"],
      maxIterations: 3,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.verdict, "pass", `expected pass, got ${r.verdict}`);
    assert.equal(r.iterations, 2);
    assert.ok(r.sessionId.startsWith("code_agent_session:"));
    assert.equal(r.steps.length, 2);
    assert.equal(r.steps[0].verdict, "fail");
    assert.equal(r.steps[1].verdict, "pass");
    // Step DTUs were minted
    assert.ok(r.stepDtuIds.length === 2);
    // Session DTU was minted
    const sessionRow = db.prepare("SELECT kind FROM dtus WHERE id = ?").get(r.sessionId);
    assert.equal(sessionRow?.kind, "code_agent_session");
  });

  it("loop gives up after maxIterations and returns lastFailures", async () => {
    writeFileSync(join(workdir, "always_fail.js"), `process.exit(1)`);
    writeFileSync(join(workdir, "src2.js"), "x");

    const ctx = {
      db,
      actor: { userId: "u_test" },
      runMacro: async (_domain, name, input) => {
        if (name === "multi-file-plan") return { ok: true, result: { edits: [{
          scriptId: "src2", filename: "src2.js", language: "javascript",
          before: "x", after: "y",
        }]}};
        if (name === "multi-file-apply") {
          writeFileSync(join(workdir, input.edits[0].filename), input.edits[0].after);
          return { ok: true, result: { applied: [{ scriptId: input.edits[0].scriptId, filename: input.edits[0].filename, bytes: 1, revision: 1 }], skipped: [] }};
        }
        if (name === "run_tests") return macros.get("run_tests")(ctx, input);
        if (name === "memory_active_prompt") return { ok: true, prompt: "" };
        throw new Error("unexpected macro " + name);
      },
    };
    const r = await runAgentLoop(ctx, {
      task: "x",
      files: [{ scriptId: "src2", filename: "src2.js", language: "javascript", content: "x" }],
      projectPath: workdir,
      runner: "node", runnerArgs: ["always_fail.js"],
      maxIterations: 2,
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "fail");
    assert.equal(r.iterations, 2);
  });

  it("rejects empty task / files / projectPath", async () => {
    const ctx = { db };
    assert.equal((await runAgentLoop(ctx, {})).reason, "task_required");
    assert.equal((await runAgentLoop(ctx, { task: "x" })).reason, "files_required");
    assert.equal((await runAgentLoop(ctx, { task: "x", files: [{}] })).reason, "project_path_required");
  });
});
