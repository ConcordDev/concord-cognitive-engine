import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgents from "../domains/agents.js";
import registerMoves from "../domains/move-builder.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };

before(() => {
  registerAgents(register);
  registerMoves(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("agent and move limits stay explained", () => {
  it("refuses an interval that is not a positive whole number", () => {
    const bad = actions.get("agents.createSchedule")(ctx, { id: null, data: {}, meta: {} }, { agentId: "ag", kind: "interval", spec: "-1" });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Interval/);
    const abc = actions.get("agents.createSchedule")(ctx, { id: null, data: {}, meta: {} }, { agentId: "ag", kind: "interval", spec: "abc" });
    assert.equal(abc.ok, false);
    const ok = actions.get("agents.createSchedule")(ctx, { id: null, data: {}, meta: {} }, { agentId: "ag", kind: "interval", spec: "60000" });
    assert.equal(ok.ok, true);
  });

  it("refuses a negative token budget and keeps a small positive one", () => {
    const bad = actions.get("agents.setBudget")(ctx, { id: null, data: {}, meta: {} }, { agentId: "ag", tokenLimit: -1 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "tokenLimit must be positive");
    assert.match(bad.message, /greater than 0/);
    const ok = actions.get("agents.setBudget")(ctx, { id: null, data: {}, meta: {} }, { agentId: "ag", tokenLimit: 1 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.budget.tokenLimit, 1);
  });

  it("refuses a move name over 120 characters", async () => {
    const bad = await actions.get("move-builder.mint")(ctx, { name: "m".repeat(121) });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /120/);
  });
});
