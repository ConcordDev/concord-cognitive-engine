/**
 * Pins substrate oracle macros: invoked through dual-registry dispatch with
 * real computed outputs (not catalog reflection).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMathActions from "../../domains/math.js";
import registerEngineeringActions from "../../domains/engineering.js";
import registerPhysicsActions from "../../domains/physics.js";
import registerChemActions from "../../domains/chem.js";
import registerAccountingActions from "../../domains/accounting.js";
import { runSubstrateOracles } from "../../lib/runtime/substrate-oracles.js";

const LENS_ACTIONS = new Map();

function register(domain, name, fn) {
  LENS_ACTIONS.set(`${domain}.${name}`, fn);
}

async function dispatch(domain, name, input, ctx = { actor: { userId: "oracle-test" } }) {
  const fn = LENS_ACTIONS.get(`${domain}.${name}`);
  if (!fn) return { ok: false, error: "unknown_macro" };
  const data = input?.artifact?.data ? { ...input.artifact.data, ...input } : (input || {});
  const virtualArtifact = { id: null, domain, type: "domain_action", data, meta: {} };
  return await fn(ctx, virtualArtifact, data);
}

before(() => {
  globalThis._concordSTATE = {};
  registerMathActions(register);
  registerEngineeringActions(register);
  registerPhysicsActions(register);
  registerChemActions(register);
  registerAccountingActions(register);
});

describe("substrate oracles — real invocation", () => {
  it("all oracle cases verify computed results", async () => {
    const report = await runSubstrateOracles({ dispatch, ctx: { actor: { userId: "oracle-test" } } });
    assert.equal(report.ok, true, `failures: ${JSON.stringify(report.failures)}`);
    assert.equal(report.passed, report.total);
    assert.ok(report.total >= 10);
  });
});
