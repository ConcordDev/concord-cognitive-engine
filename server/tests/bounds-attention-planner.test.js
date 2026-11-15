// GB-1539 bounds enforcement — FIX-attention-002 (Daily Attention Planner).
// The walk: a 300-character name was accepted and Minutes took -1 and
// 999999 with Add enabled. The server now refuses out-of-policy values
// with invalid_input (HTTP 400 at the run layer) naming the limit —
// never a silent truncation or clamp. At-limit values still add.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAttentionActions from "../domains/attention.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`attention.${name}`);
  if (!fn) throw new Error(`attention.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAttentionActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_att_a" }, userId: "bnd_att_a" };

describe("plannerAddTask bounds (FIX-attention-002)", () => {
  it("a 300-character name refuses with invalid_input naming the 200 limit", () => {
    const r = call("plannerAddTask", ctxA, { name: "x".repeat(300), durationMinutes: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("a 200-character name is accepted whole (no silent truncation)", () => {
    const r = call("plannerAddTask", ctxA, { name: "x".repeat(200), durationMinutes: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.name.length, 200);
  });

  it("minutes -1 refuses (negatives rejected)", () => {
    const r = call("plannerAddTask", ctxA, { name: "Focus", durationMinutes: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("minutes 999999 refuses instead of clamping silently", () => {
    const r = call("plannerAddTask", ctxA, { name: "Focus", durationMinutes: 999999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /720/);
  });

  it("an ordinary task still adds", () => {
    const r = call("plannerAddTask", ctxA, { name: "Focus block", durationMinutes: 45, startMinute: 600 });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.durationMinutes, 45);
  });

  it("a refused add writes nothing", () => {
    call("plannerAddTask", ctxA, { name: "x".repeat(300), durationMinutes: 30 });
    const s = globalThis._concordSTATE?.attentionLens;
    const days = s?.plannerDays?.get?.("bnd_att_a") || {};
    const total = Object.values(days).reduce((n, d) => n + (d.tasks?.length || 0), 0);
    assert.equal(total, 0);
  });
});
