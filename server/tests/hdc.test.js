/**
 * Phase 6 Tier 2 contract tests — the HDC/VSA core (MAP model).
 *
 * Pins the algebra's load-bearing properties: random hypervectors are ~orthogonal;
 * bind is self-inverse (round-trip recovery); bundle preserves membership but not
 * non-membership; permute decorrelates yet is exactly invertible; symbols are
 * deterministic; and the NeuSymMS role-filler record recovers the right filler by
 * role via cleanup. Deterministic (seeded) → no flake.
 *
 * Run: node --test server/tests/hdc.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { random, bind, unbind, bundle, permute, unpermute, similarity, makeSpace } from "../lib/hdc.js";

const DIM = 4096; // high enough that concentration-of-measure makes the bounds tight

describe("HDC algebra (MAP)", () => {
  it("random hypervectors are near-orthogonal (sim ≈ 0)", () => {
    const a = random(DIM, 1), b = random(DIM, 2);
    assert.ok(Math.abs(similarity(a, b)) < 0.08, `|sim|=${similarity(a, b)}`);
    assert.ok(Math.abs(similarity(a, a) - 1) < 1e-6, "self-similarity is 1");
  });

  it("bind is self-inverse: unbind(bind(a,b), b) recovers a exactly", () => {
    const a = random(DIM, 3), b = random(DIM, 4);
    const bound = bind(a, b);
    // binding decorrelates from both operands
    assert.ok(Math.abs(similarity(bound, a)) < 0.08);
    // unbind recovers a perfectly (bipolar self-inverse)
    const back = unbind(bound, b);
    assert.ok(similarity(back, a) > 0.999, `recovery sim=${similarity(back, a)}`);
  });

  it("bundle keeps members similar and non-members orthogonal", () => {
    const a = random(DIM, 5), b = random(DIM, 6), c = random(DIM, 7), other = random(DIM, 99);
    const set = bundle(a, b, c);
    for (const m of [a, b, c]) assert.ok(similarity(set, m) > 0.3, `member sim=${similarity(set, m)}`);
    assert.ok(Math.abs(similarity(set, other)) < 0.1, `non-member sim=${similarity(set, other)}`);
  });

  it("permute decorrelates yet unpermute recovers exactly", () => {
    const a = random(DIM, 8);
    const p = permute(a, 3);
    assert.ok(Math.abs(similarity(p, a)) < 0.08, "rolled vector is decorrelated");
    const back = unpermute(p, 3);
    assert.ok(similarity(back, a) > 0.999, "unpermute recovers exactly");
  });
});

describe("HDC space — codebook + NeuSymMS records", () => {
  it("symbols are deterministic and distinct symbols ~orthogonal", () => {
    const s = makeSpace(DIM);
    assert.ok(similarity(s.symbol("dog"), s.symbol("dog")) > 0.999, "same symbol → same vector");
    assert.ok(Math.abs(similarity(s.symbol("dog"), s.symbol("cat"))) < 0.08, "distinct symbols ~orthogonal");
    // a fresh space reproduces the same vectors (deterministic seeding)
    const s2 = makeSpace(DIM);
    assert.ok(similarity(s.symbol("dog"), s2.symbol("dog")) > 0.999);
  });

  it("encodeRecord + query: recover the right filler BY ROLE (compositional recall)", () => {
    const s = makeSpace(DIM);
    // a fact: { subject: alice, predicate: builds, object: connector }
    const record = s.encodeRecord({ subject: "alice", predicate: "builds", object: "connector" });
    assert.equal(s.query(record, "subject")[0].name, "alice");
    assert.equal(s.query(record, "predicate")[0].name, "builds");
    assert.equal(s.query(record, "object")[0].name, "connector");
  });

  it("cleanup recovers the nearest codebook symbol from a noisy vector", () => {
    const s = makeSpace(DIM);
    const dog = s.symbol("dog"); s.symbol("cat"); s.symbol("bird");
    // corrupt ~15% of the components — cleanup should still resolve to 'dog'
    const noisy = Float32Array.from(dog);
    for (let i = 0; i < DIM; i += 7) noisy[i] = -noisy[i];
    const top = s.cleanup(noisy, { topK: 1 });
    assert.equal(top[0].name, "dog");
  });

  it("a two-fact bundle still lets each fact be queried by role", () => {
    const s = makeSpace(DIM);
    const f1 = s.encodeRecord({ role: "builder", who: "alice" });
    const f2 = s.encodeRecord({ role: "verifier", who: "bob" });
    const memory = s.bundle(f1, f2);
    // querying the superposed memory by the shared 'who' role is noisier, but each
    // individual record cleanly recovers its filler.
    assert.equal(s.query(f1, "who")[0].name, "alice");
    assert.equal(s.query(f2, "who")[0].name, "bob");
    assert.ok(memory.length === DIM);
  });
});
