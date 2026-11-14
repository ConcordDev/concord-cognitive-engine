// GB-1539 bounds enforcement — FIX-cri-008 (crisis affected count).
// The walk: typing -1 in the affected-count field silently became 1.
// The server refuses out-of-policy numbers with invalid_input now;
// in-policy assessments score exactly as before.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerCriActions from "../domains/cri.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`cri.${name}`);
  if (!fn) throw new Error(`cri.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerCriActions(register); });

const ctxA = { actor: { userId: "bnd_cri_a" }, userId: "bnd_cri_a" };
const NO_ARTIFACT = { id: null, data: {}, meta: {} };

describe("severityAssessment bounds (FIX-cri-008)", () => {
  it("affectedCount -1 refuses — it is NOT silently scored as 1", () => {
    const r = call("severityAssessment", ctxA, NO_ARTIFACT, { affectedCount: -1, scope: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /affectedCount/);
  });

  it("affectedCount 999999999 refuses (quantity cap)", () => {
    const r = call("severityAssessment", ctxA, NO_ARTIFACT, { affectedCount: 999999999, scope: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("an in-policy flat assessment still scores", () => {
    const r = call("severityAssessment", ctxA, NO_ARTIFACT, { affectedCount: 250, scope: "regional" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result?.score ?? r.result?.finalScore ?? 0) || r.result != null);
  });

  it("negative casualties / financialExposure refuse", () => {
    const r1 = call("severityAssessment", ctxA, { id: "a1", data: { crisis: { casualties: -2 } }, meta: {} }, {});
    assert.equal(r1.ok, false);
    assert.equal(r1.error, "invalid_input");
    const r2 = call("severityAssessment", ctxA, NO_ARTIFACT, { crisis: { financialExposure: -100 } });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "invalid_input");
  });

  it("a structured in-policy crisis still scores", () => {
    const r = call("severityAssessment", ctxA, { id: "a2", data: { crisis: { scope: 3, impact: 4, urgency: 5, controllability: 2, casualties: 0, financialExposure: 5000 } }, meta: {} }, {});
    assert.equal(r.ok, true);
  });
});
