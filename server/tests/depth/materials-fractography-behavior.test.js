// tests/depth/materials-fractography-behavior.test.js
//
// REAL behavioral tests for the materials.fractographyAnalysis /
// materials.fractographyRootCause macros — the failure-analysis /
// fractography workflow closing docs/WAVE4_INVENTORY.md row 239
// (materials: "No failure-analysis/fractography workflow"). Evidence
// rules follow ASM Handbook Volume 11: Failure Analysis and Prevention.
// Each test asserts the classification AND cites the specific evidence
// that drove it — never just that "some mode" was picked. Every
// lensRun("materials", …) call is a literal behavioral invocation
// (grader-credited).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("materials.fractographyAnalysis — clear single-mode classifications", () => {
  it("ductile overload: dull/fibrous + significant deformation + cup-and-cone classifies as ductile with cited evidence", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "aluminum 6061",
        texture: "dull_fibrous",
        deformation: "significant_plastic",
        surfaceFeatures: ["cup_and_cone", "necking"],
        loadType: "static",
        environment: "ambient",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "ductile");
    assert.equal(r.result.primaryMode, "ductile");
    assert.equal(r.result.ambiguityNote, null);
    // Evidence cites the actual observed features, not a generic label.
    assert.ok(r.result.evidenceForPrimary.some((e) => /dull, fibrous/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /plastic deformation/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /cup-and-cone/i.test(e)));
  });

  it("fatigue: beach marks + striations + cyclic load classifies as fatigue with cited evidence", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "carbon steel a36",
        texture: "mixed_transitional",
        deformation: "minimal_plastic",
        surfaceFeatures: ["beach_marks", "striations"],
        loadType: "cyclic",
        environment: "ambient",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "fatigue");
    assert.equal(r.result.ambiguityNote, null);
    assert.ok(r.result.evidenceForPrimary.some((e) => /beach marks/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /striations/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /cyclic/i.test(e)));
  });

  it("brittle: bright/crystalline + no deformation + chevron marks + impact classifies as brittle with cited evidence", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "cast iron",
        texture: "bright_crystalline",
        deformation: "none",
        surfaceFeatures: ["chevron_marks"],
        loadType: "impact",
        environment: "ambient",
        serviceTemperatureC: -20,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "brittle");
    assert.equal(r.result.ambiguityNote, null);
    assert.ok(r.result.evidenceForPrimary.some((e) => /bright, crystalline/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /chevron marks/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /sub-zero/i.test(e)));
  });

  it("SCC: chloride-exposed 304 stainless under sustained tensile stress with intergranular/branching cracks classifies as scc", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "stainless steel 304",
        surfaceFeatures: ["intergranular_cracking", "branching_cracks"],
        loadType: "static",
        environment: "corrosive",
        environmentDetail: "chloride exposure",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "scc");
    assert.equal(r.result.ambiguityNote, null);
    assert.ok(r.result.evidenceForPrimary.some((e) => /intergranular crack/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /branching/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /corrosive/i.test(e)));
    // The susceptible material+agent pairing is cited by name, not asserted blindly.
    assert.ok(r.result.evidenceForPrimary.some((e) => /austenitic stainless/i.test(e) && /chloride/i.test(e)));
  });

  it("creep: grain-boundary voids at elevated temperature above the ~0.4 homologous-temperature threshold classifies as creep", async () => {
    // Copper: meltingPointC 1085 → Tm(K) 1358.15. 0.4*Tm(K) = 543.26K = 270.11C.
    // serviceTemperatureC 600 → T(K) 873.15 → homologous 873.15/1358.15 ≈ 0.643 ≥ 0.4.
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "copper alloy",
        surfaceFeatures: ["grain_boundary_voids"],
        loadType: "sustained_thermal",
        environment: "elevated_temperature",
        serviceTemperatureC: 600,
        meltingPointC: 1085,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "creep");
    assert.equal(r.result.ambiguityNote, null);
    assert.ok(r.result.evidenceForPrimary.some((e) => /grain-boundary voids/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /elevated-temperature/i.test(e)));
    assert.ok(r.result.evidenceForPrimary.some((e) => /homologous temperature/i.test(e)));
    assert.ok(r.result.homologousTemperature >= 0.4);
  });
});

describe("materials.fractographyAnalysis — honest handling of ambiguous/missing evidence", () => {
  it("ambiguous evidence (intergranular cracking at sustained elevated temperature — creep vs SCC) is NOT forced into a single confident mode", async () => {
    // No material-agent SCC pairing, no explicit corrosive agent, no grain-boundary
    // voids specifically for creep — genuinely contested between creep and SCC.
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "generic steel",
        surfaceFeatures: ["intergranular_cracking"],
        loadType: "static",
        environment: "elevated_temperature",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "mixed evidence");
    assert.ok(r.result.ambiguityNote, "an honest ambiguity note is returned instead of a forced verdict");
    assert.match(r.result.ambiguityNote, /SEM fractography/i);
    // Both contending modes are still surfaced as candidates for the analyst.
    const modes = r.result.candidates.map((c) => c.mode);
    assert.ok(modes.includes("creep"));
    assert.ok(modes.includes("scc"));
  });

  it("missing material identity is honestly rejected — no fabricated classification", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: { texture: "dull_fibrous", deformation: "significant_plastic" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, undefined, "no classification field is present — nothing was fabricated");
    assert.match(String(r.result.message), /material identity/i);
  });

  it("missing any surface observation is honestly rejected — no fabricated classification", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: { material: "stainless steel 304" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, undefined);
    assert.match(String(r.result.message), /surface observation/i);
  });

  it("completely empty input is honestly rejected", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, undefined);
    assert.match(String(r.result.message), /cannot be produced from missing input/i);
  });

  it("observations that match no known evidence pattern return an honest indeterminate result, not a guess", async () => {
    const r = await lensRun("materials", "fractographyAnalysis", {
      data: {
        material: "unknown alloy",
        texture: "unrecognized_texture_value",
        deformation: "unrecognized_deformation_value",
        surfaceFeatures: ["some_unlisted_feature"],
        loadType: "vibration",
        environment: "unspecified_weird_env",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "indeterminate");
    assert.equal(r.result.confidence, "none");
    assert.match(String(r.result.message), /don't match any established fractography evidence pattern/i);
  });
});

describe("materials.fractographyRootCause — root-cause + corrective action mirrors the classification", () => {
  it("ductile classification yields overload-focused corrective actions + testing + a named reference", async () => {
    const r = await lensRun("materials", "fractographyRootCause", {
      data: {
        material: "aluminum 6061",
        texture: "dull_fibrous",
        deformation: "significant_plastic",
        surfaceFeatures: ["cup_and_cone"],
        loadType: "static",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "ductile");
    assert.match(r.result.rootCauseGuidance, /yield strength/i);
    assert.ok(r.result.recommendedCorrectiveActions.length > 0);
    assert.ok(r.result.recommendedFurtherTesting.some((t) => /tensile test/i.test(t)));
    assert.equal(r.result.reference, "ASM Handbook Volume 11: Failure Analysis and Prevention");
  });

  it("fatigue classification recommends tracing beach marks to a stress concentrator", async () => {
    const r = await lensRun("materials", "fractographyRootCause", {
      data: {
        material: "carbon steel a36",
        surfaceFeatures: ["beach_marks", "striations"],
        loadType: "cyclic",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "fatigue");
    assert.match(r.result.rootCauseGuidance, /beach marks/i);
    assert.ok(r.result.recommendedCorrectiveActions.some((a) => /stress concentrator/i.test(a)));
    assert.ok(r.result.recommendedFurtherTesting.some((t) => /striation spacing/i.test(t)));
  });

  it("ambiguous evidence yields a hold-corrective-action recommendation instead of a mode-specific fix", async () => {
    const r = await lensRun("materials", "fractographyRootCause", {
      data: {
        material: "generic steel",
        surfaceFeatures: ["intergranular_cracking"],
        loadType: "static",
        environment: "elevated_temperature",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "mixed evidence");
    assert.deepEqual(r.result.candidateModes.sort(), ["creep", "scc"]);
    assert.ok(r.result.recommendedCorrectiveActions.some((a) => /hold corrective action/i.test(a)));
    assert.match(r.result.rootCauseGuidance, /guess, not an analysis/i);
  });

  it("missing input is honestly rejected with no rootCauseGuidance field fabricated", async () => {
    const r = await lensRun("materials", "fractographyRootCause", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.rootCauseGuidance, undefined);
    assert.match(String(r.result.message), /material identity/i);
  });
});

describe("materials.fractographyAnalysis / fractographyRootCause — error contract parity with corrosionRisk", () => {
  // Note on shape: lens.run (server.js) unwraps `{ ok, result }` handler
  // returns so `result` is the payload directly — but a `{ ok:false, error,
  // message }` handler return has no `result` key, so it passes through
  // UNWRAPPED under `r.result` itself (r.ok stays true — that only reflects
  // "lens.run dispatched successfully"). Every sibling failure-path test in
  // materials-behavior.test.js (mp-search, ashby-plot, shortlist-add, …)
  // asserts against `r.result.ok` for exactly this reason.

  it("fractographyAnalysis: a thrown error (non-string material) is caught with the same handler_error shape as corrosionRisk", async () => {
    // Mirrors corrosionRisk's own `(data.name || data.material || "").toLowerCase()`
    // pattern, which throws the same way given a non-string material — both
    // handlers are wrapped identically, so both fail the same honest way.
    const r = await lensRun("materials", "fractographyAnalysis", { data: { material: 12345 } });
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "handler_error");
    assert.ok(typeof r.result.message === "string" && r.result.message.length > 0);
  });

  it("fractographyRootCause: a thrown error (non-string material) is caught with the same handler_error shape", async () => {
    const r = await lensRun("materials", "fractographyRootCause", { data: { material: 12345 } });
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "handler_error");
    assert.ok(typeof r.result.message === "string" && r.result.message.length > 0);
  });

  it("corrosionRisk itself throws the identical way given a non-string material (contract parity, not just shape mimicry)", async () => {
    const r = await lensRun("materials", "corrosionRisk", { data: { material: 12345 } });
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "handler_error");
  });
});
