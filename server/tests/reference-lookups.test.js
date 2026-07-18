// Contract tests for the Track D CURATION reference lookups:
//   - inheritance.intestacy-lookup / inheritance.intestacy-states-list
//     (server/domains/inheritance.js, backed by
//     content/intestacy-reference.json via server/lib/intestacy-reference.js)
//   - legal.procedure-reference / legal.procedure-reference-states-list
//     (server/domains/legal.js, backed by
//     content/court-procedure-reference.json via
//     server/lib/court-procedure-reference.js)
//
// Asserts: the macros read the real content-file reference tables, every
// covered-state result carries a citation + a disclaimer, and an
// uncovered state gets an honest "not in reference set" response — never a
// fabricated table.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerInheritanceActions from "../domains/inheritance.js";
import registerLegalActions from "../domains/legal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerInheritanceActions(register);
  registerLegalActions(register);
});

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

describe("inheritance.intestacy-lookup", () => {
  it("returns a covered state's reference table with a citation and disclaimer", () => {
    const r = call("inheritance", "intestacy-lookup", ctx, { state: "California" });
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, true);
    assert.equal(r.result.state, "California");
    assert.equal(r.result.stateCode, "CA");
    assert.match(r.result.citation, /Cal\. Prob\. Code/);
    assert.ok(Array.isArray(r.result.scenarios) && r.result.scenarios.length > 0);
    assert.match(r.result.disclaimer, /not legal advice/i);
    assert.equal(r.result.representativeSubset, true);
  });

  it("is case-insensitive and accepts a two-letter state code", () => {
    const byName = call("inheritance", "intestacy-lookup", ctx, { state: "texas" });
    assert.equal(byName.result.covered, true);
    assert.equal(byName.result.stateCode, "TX");
    const byCode = call("inheritance", "intestacy-lookup", ctx, { state: "ny" });
    assert.equal(byCode.result.covered, true);
    assert.equal(byCode.result.state, "New York");
  });

  it("honestly reports an uncovered state instead of fabricating a table", () => {
    const r = call("inheritance", "intestacy-lookup", ctx, { state: "Wyoming" });
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, false);
    assert.match(r.result.message, /not in this reference set/i);
    assert.ok(Array.isArray(r.result.statesCovered) && r.result.statesCovered.length >= 6);
    assert.equal(r.result.representativeSubset, true);
    assert.match(r.result.disclaimer, /not legal advice/i);
    // No fabricated scenario/citation data on an uncovered-state response.
    assert.equal(r.result.scenarios, undefined);
    assert.equal(r.result.citation, undefined);
  });

  it("honestly reports when no state is supplied", () => {
    const r = call("inheritance", "intestacy-lookup", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, false);
    assert.match(r.result.message, /no state supplied/i);
  });

  it("never returns a fabricated statute citation for any covered entry", () => {
    const { statesCovered } = call("inheritance", "intestacy-states-list", ctx, {}).result;
    assert.ok(statesCovered.length >= 6, "expects a representative subset, not full 50-state coverage");
    for (const s of statesCovered) {
      const r = call("inheritance", "intestacy-lookup", ctx, { state: s.stateCode });
      assert.equal(r.result.covered, true);
      assert.ok(typeof r.result.citation === "string" && r.result.citation.length > 0, `${s.state} missing a citation`);
      assert.ok(typeof r.result.source === "string" && r.result.source.length > 0, `${s.state} missing a source`);
      assert.match(r.result.disclaimer, /not legal advice/i, `${s.state} missing disclaimer`);
    }
  });
});

describe("inheritance.intestacy-states-list", () => {
  it("lists the representative subset with the disclaimer", () => {
    const r = call("inheritance", "intestacy-states-list", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.representativeSubset, true);
    assert.equal(r.result.total, r.result.statesCovered.length);
    assert.match(r.result.disclaimer, /not legal advice/i);
  });
});

describe("legal.procedure-reference", () => {
  it("returns a covered state's rule pointers with citations and disclaimer", () => {
    const r = call("legal", "procedure-reference", ctx, { state: "Florida" });
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, true);
    assert.equal(r.result.state, "Florida");
    assert.equal(r.result.stateCode, "FL");
    assert.ok(Array.isArray(r.result.rules) && r.result.rules.length > 0);
    for (const rule of r.result.rules) {
      assert.ok(typeof rule.citation === "string" && rule.citation.length > 0);
      assert.ok(typeof rule.summary === "string" && rule.summary.length > 0);
    }
    assert.match(r.result.disclaimer, /not legal advice/i);
    assert.equal(r.result.representativeSubset, true);
  });

  it("is case-insensitive and accepts a two-letter state code", () => {
    const byCode = call("legal", "procedure-reference", ctx, { state: "tx" });
    assert.equal(byCode.result.covered, true);
    assert.equal(byCode.result.state, "Texas");
  });

  it("honestly reports an uncovered state instead of fabricating rule pointers", () => {
    const r = call("legal", "procedure-reference", ctx, { state: "Montana" });
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, false);
    assert.match(r.result.message, /not in this reference set/i);
    assert.ok(Array.isArray(r.result.statesCovered) && r.result.statesCovered.length >= 6);
    assert.equal(r.result.rules, undefined);
    assert.match(r.result.disclaimer, /not legal advice/i);
  });

  it("honestly reports when no state is supplied", () => {
    const r = call("legal", "procedure-reference", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.covered, false);
    assert.match(r.result.message, /no state supplied/i);
  });

  it("never returns a fabricated rule citation for any covered entry", () => {
    const { statesCovered } = call("legal", "procedure-reference-states-list", ctx, {}).result;
    assert.ok(statesCovered.length >= 6, "expects a representative subset, not full 50-state coverage");
    for (const s of statesCovered) {
      const r = call("legal", "procedure-reference", ctx, { state: s.stateCode });
      assert.equal(r.result.covered, true);
      assert.ok(Array.isArray(r.result.rules) && r.result.rules.length > 0, `${s.state} missing rules`);
      for (const rule of r.result.rules) {
        assert.ok(typeof rule.citation === "string" && rule.citation.length > 0, `${s.state}/${rule.topic} missing a citation`);
      }
      assert.match(r.result.disclaimer, /not legal advice/i, `${s.state} missing disclaimer`);
    }
  });
});

describe("legal.procedure-reference-states-list", () => {
  it("lists the representative subset with the disclaimer", () => {
    const r = call("legal", "procedure-reference-states-list", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.representativeSubset, true);
    assert.equal(r.result.total, r.result.statesCovered.length);
    assert.match(r.result.disclaimer, /not legal advice/i);
  });
});
