// server/tests/his-vsa.test.js
//
// Holographic Invariant Storage (#40) — bipolar VSA primitives + the ethics
// safety contract. The algebra is exact and deterministic, so these assertions
// are hard oracles (no LLM, no randomness beyond seeded hypervectors). Offline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomHV, bind, unbind, bundle, permute, similarity, cleanup, makeCodebook } from "../lib/hypervector.js";
import {
  buildEthicsCodebook, encodeContext, corrupt, reinject, recover, checkInvariant,
  recoveryFidelity, contract, ETHICS_INVARIANTS,
} from "../lib/ethics-his.js";
import registerHisMacros from "../domains/his.js";

describe("HDC/VSA primitives (#40)", () => {
  it("bind is self-inverse: unbind(bind(a,b),b) === a", () => {
    const a = randomHV("alpha"), b = randomHV("beta");
    const bound = bind(a, b);
    const back = unbind(bound, b);
    assert.equal(similarity(back, a), 1, "exact recovery");
  });

  it("random hypervectors are near-orthogonal; identical seeds are identical", () => {
    const a = randomHV("alpha"), b = randomHV("beta");
    assert.ok(Math.abs(similarity(a, b)) < 0.05, "near-orthogonal");
    assert.equal(similarity(randomHV("x"), randomHV("x")), 1, "deterministic seed");
  });

  it("bundle preserves membership: a bundled member out-scores a non-member", () => {
    const a = randomHV("a"), b = randomHV("b"), c = randomHV("c"), z = randomHV("z");
    const sum = bundle([a, b, c]);
    assert.ok(similarity(sum, a) > similarity(sum, z), "member beats non-member");
    assert.ok(similarity(sum, a) > 0.2, "member is clearly present");
  });

  it("permute is invertible by the inverse shift and decorrelates", () => {
    const a = randomHV("seq");
    const p = permute(a, 3);
    assert.ok(similarity(p, a) < 0.05, "rotation decorrelates");
    assert.equal(similarity(permute(p, -3), a), 1, "inverse shift restores");
  });

  it("cleanup recovers the right codebook entry from a noisy vector", () => {
    const cb = makeCodebook(["red", "green", "blue"]);
    const noisy = corrupt(cb.green, 0.2, "n"); // flip 20% of signs
    assert.equal(cleanup(noisy, cb).label, "green", "nearest is the original");
  });
});

describe("Ethics HIS safety contract (#40)", () => {
  it("stores every refusal invariant as a recoverable codebook entry", () => {
    const cb = buildEthicsCodebook();
    assert.equal(Object.keys(cb).length, ETHICS_INVARIANTS.length);
    // each invariant cleans up to itself
    for (const label of ETHICS_INVARIANTS) {
      assert.equal(recover(cb[label], cb).label, label);
    }
  });

  it("re-injection pulls a drifted context back toward the safety invariant", () => {
    const cb = buildEthicsCodebook();
    const ctx = cb.hostility_paused;
    const drifted = corrupt(ctx, 0.45, "drift"); // heavy drift
    const before = similarity(drifted, cb.hostility_paused);
    const fixed = reinject(drifted, "hostility_paused", cb);
    const after = similarity(fixed, cb.hostility_paused);
    assert.ok(after > before, "re-injection increases alignment with the invariant");
  });

  it("checkInvariant flags alignment vs an unrelated context", () => {
    const cb = buildEthicsCodebook();
    const aligned = checkInvariant(cb.death_suspended, cb, 0.05);
    assert.equal(aligned.aligned, true);
    assert.equal(aligned.label, "death_suspended");
    const noise = encodeContext("totally unrelated random tokens here");
    const r = checkInvariant(noise, cb, 0.2);
    assert.equal(r.aligned, false, "unrelated context is not falsely aligned");
  });

  it("recovery fidelity falls monotonically as more signals are bundled", () => {
    const cb = buildEthicsCodebook();
    const f1 = recoveryFidelity(cb, 1);
    const f3 = recoveryFidelity(cb, 3);
    const f8 = recoveryFidelity(cb, 8);
    assert.equal(f1, 1, "single signal recovers exactly");
    assert.ok(f1 > f3 && f3 > f8, "crosstalk grows with capacity");
  });

  it("the design-time contract returns the closed-form bounds", () => {
    const c = contract(8);
    assert.equal(c.singleSignalFidelity, 0.707, "≈ 1/√2");
    assert.equal(c.capacityDegradation, Math.round(Math.sqrt(1 / 9) * 1000) / 1000);
    assert.ok(contract(20).capacityDegradation < c.capacityDegradation, "larger codebook → more degradation");
  });
});

describe("his domain macros (#40)", () => {
  const macros = new Map();
  registerHisMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));

  it("his.invariants + his.fidelity + his.reinject round-trip", async () => {
    const inv = await macros.get("his.invariants")({}, {});
    assert.equal(inv.invariants.length, 8);
    assert.equal(inv.contract.singleSignalFidelity, 0.707);

    const fid = await macros.get("his.fidelity")({}, { k: 1 });
    assert.equal(fid.empiricalFidelity, 1);

    const re = await macros.get("his.reinject")({}, { context: "hostility_paused", invariant: "hostility_paused", driftFraction: 0.4 });
    assert.equal(re.ok, true);
    assert.ok(re.similarityAfter >= re.similarityBefore, "re-injection does not worsen alignment");
  });
});
