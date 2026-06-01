/**
 * Contract tests for the macro-bus contract primitives
 * (docs/CONTRACT_ENFORCEMENT_STRATEGY.md — the cheap gates).
 *
 *   Gate A — checkMacroArgs catches the runMacro(ctx, …) arg-order bug class.
 *   isFallthroughMasking — detects the utility-brain "fetch failed" mask.
 *   Gate B — validateRegistry flags structural drift + missing expected domains.
 *
 * Run: node --test server/tests/macro-contract.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkMacroArgs,
  isFallthroughMasking,
  validateRegistry,
  EXPECTED_BUS_DOMAINS,
} from "../lib/macro-contract.js";

describe("Gate A — checkMacroArgs", () => {
  it("passes a well-formed (domain, name)", () => {
    assert.deepEqual(checkMacroArgs("dtu", "create"), { ok: true });
  });

  it("catches the runMacro(ctx, name, …) arg-order bug (object as domain)", () => {
    const r = checkMacroArgs({ db: {}, actor: {} }, "dtu");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "non_string_domain");
  });

  it("catches a non-string / empty name", () => {
    assert.equal(checkMacroArgs("dtu", undefined).reason, "non_string_name");
    assert.equal(checkMacroArgs("dtu", "").reason, "non_string_name");
    assert.equal(checkMacroArgs("", "create").reason, "non_string_domain");
  });
});

describe("isFallthroughMasking", () => {
  it("detects the utility-brain mask", () => {
    assert.equal(isFallthroughMasking({ ok: false, source: "utility-brain", output: "fetch failed" }), true);
  });
  it("does not flag a real macro result or a real success", () => {
    assert.equal(isFallthroughMasking({ ok: false, error: "missing_inputs" }), false);
    assert.equal(isFallthroughMasking({ ok: true, source: "utility-brain" }), false);
    assert.equal(isFallthroughMasking(null), false);
  });
});

describe("Gate B — validateRegistry", () => {
  // Build a live-shaped MACROS map: Map<domain, Map<name, {fn, spec}>>.
  function makeMacros(spec) {
    const m = new Map();
    for (const [domain, names] of Object.entries(spec)) {
      const inner = new Map();
      for (const n of names) inner.set(n, { fn: () => {}, spec: { domain, name: n } });
      m.set(domain, inner);
    }
    return m;
  }

  // A registry covering every expected domain → no reachability violations.
  function fullRegistry() {
    const spec = {};
    for (const d of EXPECTED_BUS_DOMAINS) spec[d] = ["list"];
    return makeMacros(spec);
  }

  it("passes a registry that covers every expected domain", () => {
    const r = validateRegistry(fullRegistry());
    assert.equal(r.ok, true, JSON.stringify(r.violations));
    assert.equal(r.domains, EXPECTED_BUS_DOMAINS.length);
  });

  it("flags a missing expected domain (the #2/#11 regression)", () => {
    const m = fullRegistry();
    m.delete("minigames"); // simulate the never-imported / un-dispatched class
    const r = validateRegistry(m);
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.kind === "missing_expected_domain" && v.domain === "minigames"));
  });

  it("flags an empty domain and a non-function handler", () => {
    const m = fullRegistry();
    m.set("ghosttown", new Map()); // empty
    m.get("dtu").set("broken", { spec: {} }); // no fn
    const r = validateRegistry(m);
    assert.ok(r.violations.some((v) => v.kind === "empty_domain" && v.domain === "ghosttown"));
    assert.ok(r.violations.some((v) => v.kind === "non_function_handler" && v.name === "broken"));
  });

  it("respects a custom expectedDomains list", () => {
    const m = makeMacros({ dtu: ["create"] });
    assert.equal(validateRegistry(m, { expectedDomains: ["dtu"] }).ok, true);
    assert.equal(validateRegistry(m, { expectedDomains: ["nope"] }).ok, false);
  });

  it("returns a clean no_registry violation on a bad input (never throws)", () => {
    const r = validateRegistry(null);
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].kind, "no_registry");
  });
});
