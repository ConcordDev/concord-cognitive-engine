// Behavioral contract tests for the HLR reasoning-trace macro surface
// (server/domains/reasoning.js#registerReasoningTraceMacros).
//
// These macros back the /lenses/reasoning/traces watcher. They are thin
// delegations to the real High-Level-Reasoning engine
// (server/emergent/hlr-engine.js) — so the assertions below check ACTUAL
// computed behaviour against the live engine (a run records a real trace that
// round-trips through list + get), NOT just envelope shape.
//
// No DB is required: the HLR engine keeps its trace store in-memory, which is
// the real production store (REST routes /api/reasoning/{run,traces,trace}
// read the same Map). The macros are registered into a local registry the same
// way runMacro would, and invoked directly.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerReasoningTraceMacros } from "../domains/reasoning.js";

const MACROS = new Map();
function register(domain, name, fn) { MACROS.set(`${domain}.${name}`, fn); }
async function run(name, input = {}, ctx = {}) {
  const fn = MACROS.get(`reasoning.${name}`);
  if (!fn) throw new Error(`reasoning.${name} not registered`);
  return await fn(ctx, input);
}

before(() => { registerReasoningTraceMacros(register); });

describe("reasoning HLR trace macros — registration + delegation", () => {
  it("registers traces / trace / run", () => {
    assert.ok(MACROS.has("reasoning.traces"), "reasoning.traces registered");
    assert.ok(MACROS.has("reasoning.trace"), "reasoning.trace registered");
    assert.ok(MACROS.has("reasoning.run"), "reasoning.run registered");
  });

  it("reasoning.run executes a real HLR pass and records a trace", async () => {
    const r = await run("run", {
      topic: "Does adding a heartbeat improve emergent depth?",
      mode: "deductive",
      depth: 3,
    });
    assert.equal(r.ok, true, "run succeeded");
    assert.ok(typeof r.traceId === "string" && r.traceId.length > 0, "traceId returned");
    // Real engine output: at least one reasoning chain with a conclusion.
    assert.ok(Array.isArray(r.chains) && r.chains.length >= 1, "chains produced");
    assert.ok(typeof r.synthesizedConclusion === "string", "synthesized conclusion");
    // Modes list surfaced for the filter UI — exactly the 7 reasoning modes.
    assert.ok(Array.isArray(r.modes) && r.modes.includes("deductive"), "modes include deductive");
    assert.equal(r.modes.length, 7, "seven reasoning modes");
  });

  it("reasoning.run rejects missing topic/question (real engine guard)", async () => {
    const r = await run("run", { mode: "deductive" });
    assert.equal(r.ok, false, "rejected without topic/question");
    assert.equal(r.error, "topic_or_question_required");
  });

  it("a recorded trace round-trips through traces (list) + trace (get)", async () => {
    // Run a pass with a distinctive topic, then find it back in the list and
    // fetch its full detail — proving the macros read the SAME live store.
    const topic = `roundtrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await run("run", { topic, mode: "abductive", depth: 2 });
    assert.equal(created.ok, true);
    const traceId = created.traceId;

    const list = await run("traces", { limit: 100 });
    assert.equal(list.ok, true);
    assert.ok(Array.isArray(list.traces), "traces is an array");
    const found = list.traces.find((t) => t.traceId === traceId);
    assert.ok(found, "newly recorded trace appears in the list");
    assert.equal(found.mode, "abductive", "list reflects the run's mode");
    assert.equal(found.topic, topic, "list reflects the run's topic");

    const detail = await run("trace", { traceId });
    assert.equal(detail.ok, true, "trace detail fetched");
    assert.equal(detail.trace.traceId, traceId, "detail is the right trace");
    assert.equal(detail.trace.input.topic, topic, "detail carries the real input");
    assert.ok(Array.isArray(detail.trace.chains) && detail.trace.chains.length >= 1, "detail has chains");
  });

  it("reasoning.trace returns no_trace for an unknown id", async () => {
    const r = await run("trace", { traceId: "hlr_trace_does_not_exist_zzz" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_trace");
  });

  it("reasoning.trace requires a traceId", async () => {
    const r = await run("trace", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "traceId_required");
  });

  it("reasoning.traces clamps limit to [1,100] and stays read-only", async () => {
    // Seed a couple of traces so the list is non-empty regardless of test order.
    await run("run", { topic: "clamp-seed-a", mode: "inductive" });
    await run("run", { topic: "clamp-seed-b", mode: "temporal" });
    const big = await run("traces", { limit: 9999 });
    assert.equal(big.ok, true);
    assert.ok(big.traces.length <= 100, "limit clamped to <= 100");
    const small = await run("traces", { limit: 0 });
    assert.equal(small.ok, true);
    assert.ok(small.traces.length >= 1, "limit floored to >= 1 (non-empty)");
  });
});
