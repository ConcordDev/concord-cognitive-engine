// GB-1539 bounds enforcement — FIX-law-enforcement-008 (case title)
// and the FIX-forecast-004 bounds legs (alert minConfidence).
// Law-enforcement: a 300-character case title was accepted with no
// maxlength; it now refuses with invalid_input on create and update.
// Forecast: the ticket's name field does not exist at head (the panel
// was rebuilt; kind is a server-validated enum) — the surviving
// bounds surface is minConfidence, a percent-class value that used to
// clamp silently into 0–1; out-of-range now refuses in the policy
// shape. (forecast-004's delete-confirm leg is not a bounds leg and
// stays open under its own genus.)
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerLawEnforcementActions from "../domains/lawenforcement.js";
import { createAlertSub, listAlertSubs } from "../lib/world-forecast.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law-enforcement.${name}`);
  if (!fn) throw new Error(`law-enforcement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawEnforcementActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_le_a" }, userId: "bnd_le_a" };

describe("case title bounds (FIX-law-enforcement-008)", () => {
  it("caseCreate refuses a 300-character title with invalid_input", () => {
    const r = call("caseCreate", ctxA, { title: "x".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("caseCreate accepts a title at the limit", () => {
    const r = call("caseCreate", ctxA, { title: "x".repeat(200) });
    assert.equal(r.ok, true);
    assert.equal(r.result.case.title.length, 200);
  });

  it("caseUpdate refuses an over-limit title and keeps the old one", () => {
    const created = call("caseCreate", ctxA, { title: "Warehouse burglary" });
    const id = created.result.case.id;
    const r = call("caseUpdate", ctxA, { id, title: "y".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    const after = call("caseGet", ctxA, { id });
    assert.equal(after.result.case.title, "Warehouse burglary");
  });
});

describe("forecast alert bounds (FIX-forecast-004, bounds legs)", () => {
  it("minConfidence above 1 refuses in the policy shape — no silent clamp", () => {
    const db = new Database(":memory:");
    const r = createAlertSub(db, "bnd_fc_a", { kind: "weather", minConfidence: 7 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.equal(listAlertSubs(db, "bnd_fc_a", null).length, 0);
  });

  it("a negative minConfidence refuses", () => {
    const db = new Database(":memory:");
    const r = createAlertSub(db, "bnd_fc_a", { kind: "weather", minConfidence: -0.5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("an in-range minConfidence subscribes", () => {
    const db = new Database(":memory:");
    const r = createAlertSub(db, "bnd_fc_a", { kind: "weather", minConfidence: 0.8 });
    assert.equal(r.ok, true);
    assert.equal(r.subscription.minConfidence, 0.8);
  });

  it("a bad kind still refuses as before (the enum was already honest)", () => {
    const db = new Database(":memory:");
    const r = createAlertSub(db, "bnd_fc_a", { kind: "" });
    assert.equal(r.ok, false);
  });
});
