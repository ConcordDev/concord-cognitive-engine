// FIX-neuro-009 — imported recordings had a delete control but no
// rename: no renameRecording action existed. Pin the round trip and
// the owner scoping (another user cannot rename my recording).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNeuroActions from "../domains/neuro.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`neuro.${name}`);
  if (!fn) throw new Error(`neuro.${name} not registered`);
  return fn(ctx, { id: null, domain: "neuro", data: params, meta: {} }, params);
}

before(() => { registerNeuroActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "neuro_a" }, userId: "neuro_a" };
const ctxB = { actor: { userId: "neuro_b" }, userId: "neuro_b" };

function importOne(ctx) {
  const rows = ["Fz,Cz", "0.1,0.2", "0.3,0.4", "0.5,0.6", "0.7,0.8"];
  const r = call("importSignal", ctx, { format: "csv", name: "rest", text: rows.join("\n"), sampleRate: 256 });
  assert.equal(r.ok, true);
  return r.result.recordingId;
}

describe("FIX-neuro-009 renameRecording", () => {
  it("renames the owner's recording and the list reflects it", () => {
    const id = importOne(ctxA);
    const r = call("renameRecording", ctxA, { recordingId: id, name: "baseline rest" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "baseline rest");
    const list = call("listRecordings", ctxA, {});
    assert.equal(list.result.recordings.find((x) => x.id === id).name, "baseline rest");
  });

  it("refuses another user's recording and an empty name", () => {
    const id = importOne(ctxA);
    assert.equal(call("renameRecording", ctxB, { recordingId: id, name: "hijack" }).ok, false);
    assert.equal(call("renameRecording", ctxA, { recordingId: id, name: "  " }).ok, false);
    assert.equal(call("listRecordings", ctxA, {}).result.recordings[0].name, "rest");
  });
});
