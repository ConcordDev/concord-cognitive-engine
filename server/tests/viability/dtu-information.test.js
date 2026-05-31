// Engine N2 × DTU substrate — compression measure. Pins cluster entropy
// (diversity), consolidation fidelity (KL-based topic preservation), and the
// information compression ratio.
//
// Run: node --test tests/viability/dtu-information.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tagCounts, clusterEntropy, compressionFidelity, informationRatio } from "../../lib/viability/dtu-information.js";

const dtu = (tags) => ({ tags });

describe("clusterEntropy", () => {
  it("a diverse cluster has higher entropy than a uniform-topic one", () => {
    const diverse = [dtu(["a"]), dtu(["b"]), dtu(["c"]), dtu(["d"])];
    const narrow = [dtu(["a"]), dtu(["a"]), dtu(["a"]), dtu(["a"])];
    assert.ok(clusterEntropy(diverse) > clusterEntropy(narrow));
    assert.ok(Math.abs(clusterEntropy(narrow)) < 1e-9); // single topic → 0 bits
  });
});

describe("compressionFidelity", () => {
  const originals = [dtu(["combat", "fire"]), dtu(["combat", "fire"]), dtu(["combat", "ice"])];
  it("a summary carrying the dominant topics is high-fidelity", () => {
    const good = compressionFidelity(originals, dtu(["combat", "fire"]));
    const bad = compressionFidelity(originals, dtu(["cooking", "romance"])); // unrelated
    assert.ok(good > bad);
    assert.ok(good > 0.4);
    assert.ok(bad < good);
  });
  it("is bounded (0,1] and 1 for an empty cluster", () => {
    assert.equal(compressionFidelity([], {}), 1);
    const f = compressionFidelity(originals, dtu(["combat"]));
    assert.ok(f > 0 && f <= 1);
  });
});

describe("informationRatio", () => {
  it("a summary of many originals into fewer topics compresses (ratio > 1)", () => {
    const originals = Array.from({ length: 10 }, (_, i) => dtu([`t${i % 6}`]));
    const summary = dtu(["t0", "t1"]);
    assert.ok(informationRatio(originals, summary) > 1);
  });
  it("tagCounts tallies across DTUs", () => {
    assert.deepEqual(tagCounts([dtu(["x", "y"]), dtu(["x"])]), { x: 2, y: 1 });
  });
});
