// grounding-verification-input.test.js
// FIX-grounding-008 / FIX-grounding-009 (GB-1521 slice B6) — the Grounding
// verification panel sends claim/evidence as action params, but factCheck,
// sourceCredibility and claimDecomposition read only artifact.data. A call
// without an attached DTU starved them: fact check reported 'unverifiable'
// with 0 sources for a textbook-true claim, decompose echoed one atomic
// claim, and a null artifact crashed the handler outright. Params are now
// the fallback; an attached artifact still wins.
//
// Run: node --test server/domains/grounding-verification-input.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerGroundingActions from "./grounding.js";

const actions = new Map();
registerGroundingActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };
const claim = { text: "Water is made of hydrogen and oxygen" };
const evidence = [{ text: "Water is a compound of hydrogen and oxygen, confirmed by chemistry", source: "textbook" }];

describe("grounding-008 — factCheck accepts the panel's params shape", () => {
  it("verdict is computed from params with a null artifact (no crash)", () => {
    const r = actions.get("grounding:factCheck")(ctx, null, { claim, evidence });
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "likely true");
    assert.equal(r.result.evidenceCount, 1);
  });
  it("the artifact shape still wins and agrees", () => {
    const r = actions.get("grounding:factCheck")(ctx, { data: { claim, evidence } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "likely true");
  });
  it("no evidence anywhere still reports unverifiable, honestly", () => {
    const r = actions.get("grounding:factCheck")(ctx, null, { claim, evidence: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "unverifiable");
  });
});

describe("grounding-009 — claimDecomposition splits a compound claim from params", () => {
  it("a causal compound claim decomposes past the input echo", () => {
    const r = actions.get("grounding:claimDecomposition")(ctx, null, {
      claim: { text: "The city built the bridge and it opened in 1990 because traffic demanded it" },
      evidence: [],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.atomicClaimCount >= 2, `expected >= 2 atomic claims, got ${r.result.atomicClaimCount}`);
  });
});

describe("sourceCredibility accepts params sources", () => {
  it("scores a named source instead of reporting none provided", () => {
    const r = actions.get("grounding:sourceCredibility")(ctx, null, {
      sources: [{ name: "Nature", type: "peer-reviewed", claims: [] }],
    });
    assert.equal(r.ok, true);
    assert.ok(!/No sources provided/.test(r.result.message || ""), `unexpected message: ${r.result.message}`);
  });
});
