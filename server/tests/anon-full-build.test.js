// anon-full-build.test.js — B6 F-B build(anon) server pins.
//
// (S4/F3) after an identity rotation, a conversation's member views
// resolve to the member's CURRENT identity — the old pseudonym must not
// sit in the thread as a ghost participant.
// (S5/F4) anonymize returns the full generalized set beside the sample,
// and its minClassSize equals the smallest class in that returned set.
// (S6/F5 + S3/F2 standing-machinery pins) privacyRisk carries all three
// attack models; differentialPrivacy returns named statistics with
// noisy answers.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnonActions from "../domains/anon.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`anon.${name}`);
  if (!fn) throw new Error(`anon.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "anon_user_a" }, userId: "anon_user_a" };
const ctxB = { actor: { userId: "anon_user_b" }, userId: "anon_user_b" };

before(() => { registerAnonActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  delete process.env.CONCORD_ANON_CLIENT_E2E;
});

describe("S4 — rotation re-keys conversation member views (F3)", () => {
  it("after rotate, the thread shows the NEW pseudonym and never the old", () => {
    const idA = call("identity", ctxA).result;
    const idB = call("identity", ctxB).result;
    const oldAlias = idA.alias;
    const started = call("startConversation", ctxA, null, { peerAnonId: idB.anonId });
    assert.equal(started.ok, true);

    const beforeList = call("listConversations", ctxA).result.conversations;
    assert.equal(beforeList.length, 1);
    assert.ok(beforeList[0].members.some((m) => m.alias === oldAlias));

    const rotated = call("rotateIdentity", ctxA);
    assert.equal(rotated.ok, true);
    const newAlias = rotated.result.alias;
    assert.notEqual(newAlias, oldAlias);

    const afterList = call("listConversations", ctxA).result.conversations;
    const members = afterList[0].members;
    assert.ok(members.some((m) => m.alias === newAlias), "the new pseudonym is the member");
    assert.ok(!members.some((m) => m.alias === oldAlias), "the old pseudonym is gone from the roster");
    assert.ok(members.some((m) => m.alias === idB.alias), "the peer still shows");
  });
});

describe("S5 — anonymize returns its work (F4)", () => {
  const records = [
    { age: 23, zipcode: "90210", condition: "flu" },
    { age: 24, zipcode: "90211", condition: "flu" },
    { age: 25, zipcode: "90212", condition: "cold" },
    { age: 26, zipcode: "90213", condition: "cold" },
    { age: 53, zipcode: "10001", condition: "asthma" },
    { age: 54, zipcode: "10002", condition: "asthma" },
    { age: 55, zipcode: "10003", condition: "diabetes" },
    { age: 56, zipcode: "10004", condition: "diabetes" },
  ];
  it("the full generalized set returns, and minClassSize is its smallest class", () => {
    const r = call("anonymize", ctxA, { data: { records, quasiIdentifiers: ["age", "zipcode"], sensitiveFields: ["condition"] } }, { k: 2 });
    assert.equal(r.ok, true);
    const out = r.result;
    assert.ok(Array.isArray(out.anonymizedRecords), "the full set rides the result");
    assert.equal(out.anonymizedRecords.length, records.length);
    // The smallest class over the RETURNED rows equals the printed k.
    const classes = {};
    for (const row of out.anonymizedRecords) {
      const key = `${row.age}||${row.zipcode}`;
      classes[key] = (classes[key] || 0) + 1;
    }
    assert.equal(Math.min(...Object.values(classes)), out.minClassSize);
    // Generalization is visible in the rows themselves.
    assert.ok(out.anonymizedRecords.every((row) => String(row.age).includes("-")));
    assert.ok(out.anonymizedRecords.every((row) => row.condition === "[REDACTED]"));
  });
});

describe("standing machinery the panels now render (F5 · F2)", () => {
  it("privacyRisk carries prosecutor, journalist and marketer figures", () => {
    const r = call("privacyRisk", ctxA, { data: { records: [
      { age: 23, zipcode: "90210" }, { age: 23, zipcode: "90210" }, { age: 40, zipcode: "10001" },
    ], quasiIdentifiers: ["age", "zipcode"] } });
    assert.equal(r.ok, true);
    for (const model of ["prosecutor", "journalist", "marketer"]) {
      assert.equal(typeof r.result.attackModels[model].risk, "number", model);
    }
  });

  it("differentialPrivacy returns named statistics with noisy answers", () => {
    const r = call("differentialPrivacy", ctxA, { data: { values: [10, 20, 30, 40] } }, { epsilon: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.results.length, 3);
    for (const row of r.result.results) {
      assert.ok(["count", "sum", "mean"].includes(row.type));
      assert.equal(typeof row.noisyAnswer, "number");
      assert.equal(typeof row.confidenceInterval95, "number");
    }
  });
});
