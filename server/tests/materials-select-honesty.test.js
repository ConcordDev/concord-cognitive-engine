// FIX-materials-008 — select-by-spec recommendation honesty.
//
// Spec 200 MPa / 3 g/cm3 / 500 C / $100 produced "Recommended:
// qa-...-a (closest match)" under a trophy while the candidate met
// none of the requirements (tensile 0). Two defects compounded:
// unrecorded density/cost counted as PASSES (val === 0 passed a
// maximum), and a zero-pass candidate was still crowned a
// recommendation. Now: an unrecorded property fails as "not
// recorded"; a partial passer is a labelled closest match with its
// basis in the payload; and when nothing meets ANY requirement
// there is no recommendation at all (recommended: null,
// recommendationBasis: 'none').
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./depth/_harness.js";

describe("materials selectMaterial honesty (FIX-materials-008)", () => {
  it("a candidate meeting none of the requirements gets NO recommendation", async () => {
    const r = await lensRun("materials", "selectMaterial", {
      data: {
        requirements: { minTensile: 200, maxDensity: 3, minMelting: 500, maxCost: 100 },
        candidates: [
          { name: "qa-x-a", tensileStrength: 0, density: 7.85, meltingPoint: 100, cost: 500 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.qualifying, 0);
    assert.equal(r.result.recommended, null);
    assert.equal(r.result.recommendationBasis, "none");
    assert.equal(r.result.rankings[0].passes, 0);
  });

  it("an unrecorded density fails as not recorded instead of passing the maximum", async () => {
    const r = await lensRun("materials", "selectMaterial", {
      data: {
        requirements: { maxDensity: 3 },
        candidates: [
          { name: "no-density-recorded", tensileStrength: 900 },
          { name: "light-alloy", density: 2.7, tensileStrength: 310 },
        ],
      },
    });
    assert.equal(r.ok, true);
    const nd = r.result.rankings.find((m) => m.name === "no-density-recorded");
    assert.equal(nd.meetsAll, false);
    assert.ok(nd.failDetails.some((d) => /not recorded/.test(d)), nd.failDetails.join("; "));
    assert.equal(r.result.qualifying, 1);
    assert.equal(r.result.recommended, "light-alloy");
    assert.equal(r.result.recommendationBasis, "meets-all");
  });

  it("a partial passer is a labelled closest match with its meet count", async () => {
    const r = await lensRun("materials", "selectMaterial", {
      data: {
        requirements: { minTensile: 200, maxDensity: 3 },
        candidates: [
          { name: "strong-but-heavy", tensileStrength: 900, density: 7.85 },
          { name: "weak-and-heavy", tensileStrength: 50, density: 8.9 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.qualifying, 0);
    assert.equal(r.result.recommended, "strong-but-heavy (closest match)");
    assert.equal(r.result.recommendationBasis, "closest-partial");
    assert.equal(r.result.recommendedMeets, 1);
    assert.equal(r.result.recommendedOf, 2);
  });
});
