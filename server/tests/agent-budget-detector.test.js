/**
 * Tier-2 contract tests for AgentBudgetDetector.
 *
 * Pinned: while(true) with LLM call (high), recursive LLM without depth cap
 * (high), heartbeat with LLM call lacking throttle (medium), LLM passthrough
 * to res.* without length cap (low), depth-cap clears recursion finding,
 * @agent-budget-ok annotation opt-out, report shape.
 *
 * Run: node --test tests/agent-budget-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgentBudgetDetector } from "../lib/detectors/agent-budget-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `agent-budget-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("AgentBudgetDetector — while(true) with LLM call (high)", () => {
  it("flags an unbounded while-loop containing ctx.llm.chat", async () => {
    const dir = withFixture({
      "server/lib/loop.js":
        `export async function spin(ctx) { while (true) { const r = await ctx.llm.chat({ prompt: 'go' }); if (r.done) break; } }\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      const f = r.findings.find(x => x.id === "while_true_with_llm_call");
      assert.ok(f);
      assert.equal(f.severity, "high");
    } finally { teardown(dir); }
  });

  it("flags for(;;) containing an LLM call", async () => {
    const dir = withFixture({
      "server/lib/loop.js":
        `export async function spin(ctx) { for (;;) { const r = await callBrain('go'); if (!r) break; } }\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      const f = r.findings.find(x => x.id === "for_infinite_with_llm_call");
      assert.ok(f);
      assert.equal(f.severity, "high");
    } finally { teardown(dir); }
  });
});

describe("AgentBudgetDetector — recursive LLM call (high)", () => {
  it("flags self-recursive async function containing an LLM call without depth cap", async () => {
    // Detector RECURSE_RE matches `async function NAME ... { ... NAME(` within
    // a single `{ ... }` window where the body has no closing brace in between.
    // Keep the body free of inline object literals to stay inside that window.
    const dir = withFixture({
      "server/lib/recurse.js":
        `export async function think(ctx, q) {\n  const r = await ctx.llm.chat(q);\n  if (r.followUp) return await think(ctx, r.followUp);\n  return r;\n}\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      const f = r.findings.find(x => x.id === "recursive_llm_without_depth_cap");
      assert.ok(f, "expected recursive_llm_without_depth_cap finding");
      assert.equal(f.severity, "high");
      assert.equal(f.subject.fn, "think");
    } finally { teardown(dir); }
  });

  it("does NOT flag recursive LLM call when MAX_DEPTH guard is present", async () => {
    const dir = withFixture({
      "server/lib/recurse.js":
        `const MAX_DEPTH = 5;\nexport async function think(ctx, q, depth = 0) {\n  if (depth >= MAX_DEPTH) return null;\n  const r = await ctx.llm.chat(q);\n  if (r.followUp) return await think(ctx, r.followUp, depth + 1);\n  return r;\n}\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "recursive_llm_without_depth_cap").length, 0);
    } finally { teardown(dir); }
  });
});

describe("AgentBudgetDetector — heartbeat LLM call without throttle (medium)", () => {
  it("flags run*Cycle that calls LLM without MAX_PER_PASS / MIN_INTERVAL", async () => {
    const dir = withFixture({
      "server/emergent/foo-cycle.js":
        `export async function runFooCycle({ db, ctx }) {\n  try {\n    const r = await ctx.llm.chat({ prompt: 'tick' });\n    return { ok: true, r };\n  } catch (err) { return { ok: false, reason: err.message }; }\n}\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      const f = r.findings.find(x => x.id === "heartbeat_llm_without_throttle");
      assert.ok(f);
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.fn, "runFooCycle");
    } finally { teardown(dir); }
  });

  it("does NOT flag heartbeat with MAX_PER_PASS guard", async () => {
    const dir = withFixture({
      "server/emergent/foo-cycle.js":
        `const MAX_PER_PASS = 5;\nexport async function runFooCycle({ db, ctx }) {\n  try {\n    let n = 0;\n    while (n < MAX_PER_PASS) { await ctx.llm.chat({ prompt: 'tick' }); n++; }\n    return { ok: true };\n  } catch (err) { return { ok: false, reason: err.message }; }\n}\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "heartbeat_llm_without_throttle").length, 0);
    } finally { teardown(dir); }
  });
});

describe("AgentBudgetDetector — LLM passthrough without length cap (low)", () => {
  it("flags res.json with content from an LLM-shaped variable when no slice/truncate near", async () => {
    const dir = withFixture({
      "server/routes/chat.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/chat', async (req, res) => {\n  const completion = await ctx.llm.chat({ prompt: req.body.q });\n  res.json({ content: completion.content });\n});\nexport default router;\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      const f = r.findings.find(x => x.id === "llm_output_without_length_cap");
      assert.ok(f);
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag when output is .slice(0, N) capped", async () => {
    const dir = withFixture({
      "server/routes/chat.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/chat', async (req, res) => {\n  const completion = await ctx.llm.chat({ prompt: req.body.q });\n  res.json({ content: completion.content.slice(0, 8000) });\n});\nexport default router;\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "llm_output_without_length_cap").length, 0);
    } finally { teardown(dir); }
  });
});

describe("AgentBudgetDetector — annotation + report shape", () => {
  it("skips file with @agent-budget-ok annotation", async () => {
    const dir = withFixture({
      "server/lib/ok.js":
        `// @agent-budget-ok: bounded by external scheduler\nexport async function spin(ctx) { while (true) { await ctx.llm.chat({}); } }\n`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.subject?.file === "server/lib/ok.js").length, 0);
    } finally { teardown(dir); }
  });

  it("returns a normalized report shape", async () => {
    const dir = withFixture({ "server/lib/empty.js": "export const x = 1;\n" });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(typeof r.ok, "boolean");
      assert.ok(Array.isArray(r.findings));
      assert.equal(typeof r.scanned, "number");
      for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
        assert.equal(typeof r.summary[k], "number");
      }
    } finally { teardown(dir); }
  });
});
