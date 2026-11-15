// IDLE-02 (GB-1540) — the degenerate-sample skip, pinned hermetically.
// The observation prompt is titles-only, so degeneracy is a pure function
// of the sample's titles: thin / monoculture / repeat (premise CB-0723).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessSampleDegeneracy, sampleSignature } from "../emergent/idle-behavior.js";

const item = (title) => ({ id: `dtu_${title}`, title, content: "..." });

describe("IDLE-02 sample degeneracy", () => {
  it("thin: fewer than two items cannot carry a pattern", () => {
    assert.equal(assessSampleDegeneracy([], null), "thin");
    assert.equal(assessSampleDegeneracy([item("Wood")], null), "thin");
    assert.equal(assessSampleDegeneracy(null, null), "thin");
  });

  it("monoculture: one distinct title, however many rows", () => {
    assert.equal(assessSampleDegeneracy([item("Wood"), item("Wood"), item(" wood ")], null), "monoculture");
    assert.equal(assessSampleDegeneracy([item("Shelter"), item("SHELTER")], null), "monoculture");
  });

  it("repeat: the same title multiset as the citizen's last sample, any order", () => {
    const items = [item("Alpha"), item("Beta"), item("Gamma")];
    const sig = sampleSignature(items);
    assert.equal(assessSampleDegeneracy([item("Gamma"), item("Alpha"), item("Beta")], sig), "repeat");
    assert.equal(assessSampleDegeneracy(items, sig), "repeat");
  });

  it("a varied, fresh sample is not degenerate", () => {
    const items = [item("Alpha"), item("Beta")];
    assert.equal(assessSampleDegeneracy(items, null), null);
    assert.equal(assessSampleDegeneracy(items, sampleSignature([item("Alpha"), item("Delta")])), null);
    assert.equal(assessSampleDegeneracy([item("Alpha"), item("Beta"), item("Beta")], null), null);
  });

  it("monoculture outranks repeat (the more specific diagnosis wins)", () => {
    const items = [item("Wood"), item("Wood")];
    assert.equal(assessSampleDegeneracy(items, sampleSignature(items)), "monoculture");
  });

  it("the signature is order-insensitive and case/space-normalised", () => {
    assert.equal(
      sampleSignature([item(" Beta "), item("alpha")]),
      sampleSignature([item("Alpha"), item("beta")]),
    );
  });
});
