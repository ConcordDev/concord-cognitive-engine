// Reasoning-traces build (RT-S1) — the producer stamps its caller.
//
// The defect (premise, F-C row 15): runHLR recorded traces WITHOUT the
// caller's userId, while the log-access read policy shows a member only
// traces stamped with their id — so a member's own runs were invisible
// to them (list projection 0, detail 403) and the traces surface read
// permanently empty. The fix stamps the producer (engine keeps
// input.userId; the reasoning.run macro injects the ctx caller). The
// policy layer is untouched.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runHLR, listTraces, getReasoningTrace } from "../emergent/hlr-engine.js";
import { projectReasoningTraces, reasoningTraceAccess } from "../lib/log-access.js";
import { registerReasoningTraceMacros } from "../domains/reasoning.js";

const ALICE = { userId: "user_alice" };
const BOB = { userId: "user_bob" };
const OWNER = { userId: "root", role: "owner" };

function captureMacros() {
  const handlers = new Map();
  registerReasoningTraceMacros((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
  return handlers;
}

describe("RT-S1 — the engine stamps the caller", () => {
  it("a run with userId records it, and the list summary surfaces it", () => {
    const r = runHLR({ topic: "rt stamp probe", mode: "deductive", depth: 2, userId: "user_alice" });
    assert.equal(r.ok, true);
    const stored = getReasoningTrace(r.traceId);
    assert.equal(stored.input.userId, "user_alice");
    const summary = listTraces(100).find((t) => t.traceId === r.traceId);
    assert.ok(summary, "the run is in the raw list");
    assert.equal(summary.userId, "user_alice");
  });

  it("a run without userId stays unstamped (system traces unchanged)", () => {
    const r = runHLR({ topic: "rt system probe", mode: "temporal", depth: 2 });
    assert.equal(r.ok, true);
    assert.equal(getReasoningTrace(r.traceId).input.userId, null);
    const summary = listTraces(100).find((t) => t.traceId === r.traceId);
    assert.equal(summary.userId, null);
  });
});

describe("RT-S1 — the read policy now reaches the runner (policy untouched)", () => {
  it("the runner sees and opens their own trace; another member sees none of it", () => {
    const r = runHLR({ topic: "rt visibility probe", mode: "abductive", depth: 2, userId: "user_alice" });
    const raw = listTraces(100);
    const forAlice = projectReasoningTraces(raw, ALICE);
    assert.ok(forAlice.some((t) => t.traceId === r.traceId), "alice's list contains her trace");
    const forBob = projectReasoningTraces(raw, BOB);
    assert.ok(!forBob.some((t) => t.traceId === r.traceId), "bob's list does not");
    const stored = getReasoningTrace(r.traceId);
    assert.equal(reasoningTraceAccess(stored, ALICE).status, 200);
    assert.equal(reasoningTraceAccess(stored, BOB).status, 403);
  });

  it("unstamped system traces stay operator-only", () => {
    const r = runHLR({ topic: "rt operator probe", mode: "analogical", depth: 2 });
    const raw = listTraces(100);
    assert.ok(!projectReasoningTraces(raw, ALICE).some((t) => t.traceId === r.traceId));
    assert.ok(projectReasoningTraces(raw, OWNER).some((t) => t.traceId === r.traceId));
    assert.equal(reasoningTraceAccess(getReasoningTrace(r.traceId), OWNER).status, 200);
    assert.equal(reasoningTraceAccess(getReasoningTrace(r.traceId), ALICE).status, 403);
  });
});

describe("RT-S1 — the macro stamps from ctx, never from client input", () => {
  it("ctx userId stamps the trace", async () => {
    const handlers = captureMacros();
    const out = await handlers.get("reasoning.run")({ userId: "user_carol" }, { topic: "rt macro probe", mode: "deductive", depth: 2 });
    assert.equal(out.ok, true);
    assert.equal(getReasoningTrace(out.traceId).input.userId, "user_carol");
  });

  it("ctx actor.userId stamps the trace", async () => {
    const handlers = captureMacros();
    const out = await handlers.get("reasoning.run")({ actor: { userId: "user_dave" } }, { topic: "rt macro actor probe", mode: "deductive", depth: 2 });
    assert.equal(out.ok, true);
    assert.equal(getReasoningTrace(out.traceId).input.userId, "user_dave");
  });

  it("a forged input.userId loses to the ctx caller", async () => {
    const handlers = captureMacros();
    const out = await handlers.get("reasoning.run")({ userId: "user_carol" }, { topic: "rt macro forge probe", mode: "deductive", depth: 2, userId: "mallory" });
    assert.equal(out.ok, true);
    assert.equal(getReasoningTrace(out.traceId).input.userId, "user_carol");
  });

  it("no ctx user leaves the run unstamped; anon does not stamp", async () => {
    const handlers = captureMacros();
    const a = await handlers.get("reasoning.run")({}, { topic: "rt macro internal probe", mode: "deductive", depth: 2 });
    assert.equal(getReasoningTrace(a.traceId).input.userId, null);
    const b = await handlers.get("reasoning.run")({ userId: "anon" }, { topic: "rt macro anon probe", mode: "deductive", depth: 2 });
    assert.equal(getReasoningTrace(b.traceId).input.userId, null);
  });

  it("the traces/trace macros round-trip a stamped run", async () => {
    const handlers = captureMacros();
    const out = await handlers.get("reasoning.run")({ userId: "user_carol" }, { topic: "rt macro roundtrip", mode: "temporal", depth: 2 });
    const list = await handlers.get("reasoning.traces")({}, { limit: 100 });
    assert.equal(list.ok, true);
    assert.ok(list.traces.some((t) => t.traceId === out.traceId && t.userId === "user_carol"));
    const one = await handlers.get("reasoning.trace")({}, { traceId: out.traceId });
    assert.equal(one.ok, true);
    assert.equal(one.trace.input.userId, "user_carol");
    const missing = await handlers.get("reasoning.trace")({}, {});
    assert.equal(missing.ok, false);
  });
});

describe("RT-S1 — engine refusal shapes unchanged", () => {
  it("no topic/question still refuses; a bad mode still refuses", () => {
    assert.equal(runHLR({ mode: "deductive" }).error, "topic_or_question_required");
    assert.equal(runHLR({ topic: "x", mode: "sideways" }).error, "invalid_mode");
  });
});
