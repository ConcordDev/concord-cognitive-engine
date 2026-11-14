// GB-1539 bounds enforcement — FIX-privacy-005 (DSAR note) and
// FIX-engineering-003 (negative axial load).
// Privacy: a 5001-character form text saved silently (truncated at
// 1,000). The DSAR note is NOTE class (5,000): over that it refuses
// with invalid_input; in-policy notes store whole.
// Engineering: a -1000 axial load produced no error and a null
// ("—") factor of safety. Negative loads now refuse in the bounds
// shape; positive loads are deliberately uncapped (physical
// quantities, per the ticket's own expected text).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPrivacyActions from "../domains/privacy.js";
import registerEngineeringActions from "../domains/engineering.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerPrivacyActions(register); registerEngineeringActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_priv_a" }, userId: "bnd_priv_a" };

describe("privacy DSAR note bounds (FIX-privacy-005)", () => {
  it("a 5001-character note refuses with invalid_input naming 5000", () => {
    const r = call("privacy", "dsarSubmit", ctxA, { kind: "access", note: "x".repeat(5001) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /5000 characters/);
  });

  it("a 3000-character note stores whole (no silent truncation at 1000)", () => {
    const r = call("privacy", "dsarSubmit", ctxA, { kind: "access", note: "y".repeat(3000) });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.note.length, 3000);
  });

  it("an ordinary DSAR still submits", () => {
    const r = call("privacy", "dsarSubmit", ctxA, { kind: "export", note: "Please export my data." });
    assert.equal(r.ok, true);
  });
});

describe("engineering negative load (FIX-engineering-003)", () => {
  const column = { lengthFt: 10, modulusE: 29000000, momentI: 100, kFactor: 1 };

  it("a -1000 kip axial load refuses with invalid_input — no silent null FoS", () => {
    const r = call("engineering", "columnBucklingCheck", ctxA, { ...column, loadKips: -1000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /loadKips/);
  });

  it("a negative loadN refuses too", () => {
    const r = call("engineering", "columnBucklingCheck", ctxA, { ...column, loadN: -5000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("a positive load still computes a factor of safety", () => {
    const r = call("engineering", "columnBucklingCheck", ctxA, { ...column, loadKips: 50 });
    assert.equal(r.ok, true);
    assert.ok(r.result.factorOfSafety > 0);
  });
});
