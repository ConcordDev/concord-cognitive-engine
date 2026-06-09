/**
 * Item 3 contract tests — the HDC ↔ refusal-glyph bridge + compositional recall.
 *
 * Pins: the base-6 number→hypervector mapping is deterministic + distinguishes
 * values (anchored to the same radix as the glyph algebra); the concept encoder
 * bundles words into a hypervector; and hdcRecall surfaces a topically-related
 * candidate by HD concept-overlap while honoring the exclude set.
 *
 * Run: node --test server/tests/hdc-refusal-bridge.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { numberToHypervector, encodeConcepts, hdcRecall } from "../lib/hdc-refusal-bridge.js";
import { similarity } from "../lib/hdc.js";

describe("base-6 number → hypervector (glyph-algebra anchor)", () => {
  it("is deterministic and distinguishes values", () => {
    assert.ok(similarity(numberToHypervector(13), numberToHypervector(13)) > 0.999, "same number → same HV");
    assert.ok(similarity(numberToHypervector(13), numberToHypervector(40)) < 0.6, "distinct values are distinguishable");
    assert.equal(numberToHypervector(0).length, numberToHypervector(99).length, "fixed dimension");
  });
});

describe("concept encoder", () => {
  it("bundles words; empty/short input → null", () => {
    assert.equal(encodeConcepts("a b"), null); // all tokens too short
    const v = encodeConcepts("frost magic in cold caves");
    assert.ok(v && v.length === 2048);
    // a related phrase is more similar than an unrelated one
    const related = encodeConcepts("cold frost spell");
    const unrelated = encodeConcepts("marketplace royalty economy");
    assert.ok(similarity(v, related) > similarity(v, unrelated));
  });
});

describe("hdcRecall — compositional associative retrieval", () => {
  const candidates = [
    { id: "d1", title: "Frost magic in cold caverns", tags: ["frost", "ice", "magic"] },
    { id: "d2", title: "Quarterly royalty payout schedule", tags: ["economy", "royalty"] },
    { id: "d3", title: "Cold-weather survival cooking", tags: ["cold", "cooking", "survival"] },
  ];

  it("surfaces the topically-related candidates and respects the exclude set", () => {
    const hits = hdcRecall("how does cold frost magic work", candidates, { topK: 3, threshold: 0.05 });
    const ids = hits.map((h) => h.id);
    assert.ok(ids.includes("d1"), "the frost-magic DTU is recalled");
    assert.ok(!ids.includes("d2") || ids.indexOf("d1") < ids.indexOf("d2"), "the unrelated economy DTU is not ranked above it");

    const excluded = hdcRecall("cold frost magic", candidates, { topK: 3, threshold: 0.05, exclude: new Set(["d1"]) });
    assert.ok(!excluded.map((h) => h.id).includes("d1"), "exclude set honored (only adds NEW hits)");
  });

  it("returns [] for an empty query or no candidates (never throws)", () => {
    assert.deepEqual(hdcRecall("", candidates), []);
    assert.deepEqual(hdcRecall("frost", null), []);
  });
});
