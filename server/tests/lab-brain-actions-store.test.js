// INC-SWEEP lab F8 — design-experiment / validate-protocol must use lab stores
// (experimentDesign / protocol), never brain stubs with fabricated tickets.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLabActions from "../domains/lab.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
  if (!globalThis.__concordLensActions) globalThis.__concordLensActions = new Map();
  globalThis.__concordLensActions.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  return ACTIONS.get(`lab.${name}`)(ctx, artifact, params);
}

before(() => { registerLabActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a", displayName: "Lab QA" }, userId: "user_a" };

describe("lab F8 store-backed design-experiment / validate-protocol", () => {
  it("refuses empty design-experiment and missing protocol id", () => {
    const d = call("design-experiment", ctxA, {});
    assert.equal(d.ok, false);
    assert.match(d.error, /factors required/i);
    assert.equal(shapeLensRunHttp(d).status, 422);
    assert.ok(!String(d.source || "").includes("brain"));

    const v = call("validate-protocol", ctxA, {});
    assert.equal(v.ok, false);
    assert.match(v.error, /protocol id required/i);
  });

  it("design-experiment uses experimentDesign; validate-protocol reads the store", () => {
    const design = call("design-experiment", ctxA, {
      factors: [
        { name: "temp", levels: ["a", "b"] },
        { name: "ph", levels: ["5", "7"] },
      ],
      type: "full-factorial",
      replicates: 1,
    });
    assert.equal(design.ok, true, JSON.stringify(design));
    assert.equal(design.result.totalRuns, 4);
    assert.equal(design.result.source, "experimentDesign");
    assert.ok(!/T-0296|dtu probe|u-brain|r-brain/i.test(JSON.stringify(design)));

    const proto = call("protocol-create", ctxA, {
      name: "Protocol lab-f8 alpha",
      steps: [
        { text: "Prepare", durationMinutes: 10 },
        { text: "Run", durationMinutes: 5, critical: true },
      ],
    });
    assert.equal(proto.ok, true);
    const id = proto.result.protocol.id;

    const ok = call("validate-protocol", ctxA, { id });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.valid, true);
    assert.equal(ok.result.protocolName, "Protocol lab-f8 alpha");
    assert.equal(ok.result.stepCount, 2);
    assert.equal(ok.result.source, "protocol-store");
    assert.ok(!/lab:validate|artifactData\.id is empty/i.test(JSON.stringify(ok)));

    const missing = call("validate-protocol", ctxA, { id: "proto_does_not_exist_labf8" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /protocol not found/i);
  });
});
