// Regression pinning: `emergent.bridge.lensScope` is a trivial synchronous
// permission check called on every generic `lens.create` (the create-modal
// path nearly every lens uses). Routing it to the worker pool meant it threw
// `worker_no_snapshot: STATE not yet synced` whenever a call landed between
// the pool's ~2-minute snapshot syncs, which `lens.create`'s own catch
// collapses into a fake `scope_denied` permissions error. Confirmed live
// across the `science`/`security`/`services`/`studio` create-modal
// investigations and the `animation` lens's own visible "worker no snapshot"
// toast (see audit/LENS_DESIGN_UPGRADE_PLAN.md). Fix: run it inline via
// LIGHT_OVERRIDES, same as the other trivial `emergent.*` reads.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHeavy } from "../workers/macro-pool.js";

describe("macro-pool LIGHT_OVERRIDES", () => {
  it("does not route emergent.bridge.lensScope to the worker pool", () => {
    assert.equal(isHeavy("emergent", "bridge.lensScope"), false);
  });

  // Same rationale, added during the LENS_DESIGN_UPGRADE_PLAN.md #177 (paper)
  // re-verification pass: `bridge.lensValidate` (paper.validate's empirical
  // gates) is an equally trivial synchronous check that doesn't need a
  // worker round-trip.
  it("does not route emergent.bridge.lensValidate to the worker pool", () => {
    assert.equal(isHeavy("emergent", "bridge.lensValidate"), false);
  });

  it("still routes other emergent.* macros to the worker pool (no over-broadening)", () => {
    assert.equal(isHeavy("emergent", "bridge.heartbeatTick"), true);
    assert.equal(isHeavy("emergent", "someUnlistedHeavyOp"), true);
  });

  it("still routes non-overridden heavy domains normally", () => {
    assert.equal(isHeavy("hlr", "runHLR"), true);
    assert.equal(isHeavy("accounting", "trialBalance"), false);
  });
});
