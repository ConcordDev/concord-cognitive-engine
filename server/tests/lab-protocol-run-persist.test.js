// INC-SWEEP lab F10 — protocol-run mints an id that run-list shows; survives
// labLens serialize/hydrate restart.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLabActions from "../domains/lab.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  return ACTIONS.get(`lab.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLabActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("lab F10 protocol-run persistence", () => {
  it("protocol-run appears in run-list and survives rehydrate", () => {
    const proto = call("protocol-create", ctxA, {
      name: "Protocol lab-f10",
      steps: [
        { text: "A", durationMinutes: 10 },
        { text: "B", durationMinutes: 13 },
      ],
    });
    assert.equal(proto.ok, true);
    const protocolId = proto.result.protocol.id;

    const run = call("protocol-run", ctxA, { id: protocolId });
    assert.equal(run.ok, true, JSON.stringify(run));
    const runId = run.result.run.runId || run.result.run.id;
    assert.ok(runId);
    assert.equal(run.result.run.estimatedMinutes, 23);
    assert.equal(run.result.run.kind, "protocol");

    const list = call("run-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(
      list.result.runs.some((r) => (r.id === runId || r.runId === runId)),
      `run-list missing ${runId}: ${JSON.stringify(list.result.runs)}`,
    );

    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    const next = {};
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;

    const fresh = call("run-list", ctxA, {});
    assert.ok(
      fresh.result.runs.some((r) => (r.id === runId || r.runId === runId)),
      "protocol run missing after rehydrate",
    );
  });
});
