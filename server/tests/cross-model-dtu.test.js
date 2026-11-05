// Cohesive R-3, DTU-pair enrolment — seeded-fault pins for
// server/lib/cross-model-dtu.js. Each check class gets its seed: a
// declaration and its binding disagreeing, caught with the surface
// named. Pure fixtures: no server boot, no real registries.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateContentClasses, validateArtifactSchemas } from "../lib/cross-model-dtu.js";

const baseClasses = {
  contentClasses: ["alpha", "beta"],
  admissionProfiles: {
    alpha: { personalMin: 1, publicMin: 2, rejectReason: "alpha_low", useAcademicCore: true },
    beta: { personalMin: 1, publicMin: 1, rejectReason: "beta_low", useAcademicCore: false },
  },
  inferClass: (input) => input.want,
  probes: { alpha: { want: "alpha" }, beta: { want: "beta" } },
  scoreAdmission: () => ({ ok: true }),
};

describe("validateContentClasses — seeded faults", () => {
  it("a coherent declaration set passes clean", () => {
    const res = validateContentClasses(baseClasses);
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.unverifiable, []);
    assert.equal(res.checked.reachabilityProbes, 2);
  });
  it("catches a class with no profile (the silent generic fallback) and a profile with no class", () => {
    const res = validateContentClasses({
      ...baseClasses,
      contentClasses: ["alpha", "gamma"],
      admissionProfiles: { alpha: baseClasses.admissionProfiles.alpha, orphan: { personalMin: 1, publicMin: 1 } },
      probes: { alpha: { want: "alpha" }, gamma: { want: "gamma" } },
    });
    assert.deepEqual(res.errors.map((e) => e.kind).sort(), ["class_without_profile", "profile_without_class"]);
  });
  it("catches inverted minima", () => {
    const res = validateContentClasses({
      ...baseClasses,
      admissionProfiles: { ...baseClasses.admissionProfiles, alpha: { personalMin: 3, publicMin: 1, rejectReason: "x" } },
    });
    assert.deepEqual(res.errors.map((e) => e.kind), ["minima_inverted"]);
  });
  it("catches a class the producer cannot reach, and accounts a missing probe as unverifiable", () => {
    const res = validateContentClasses({
      ...baseClasses,
      probes: { alpha: { want: "beta" } },
    });
    assert.deepEqual(res.errors.map((e) => e.kind), ["class_unreachable_by_probe"]);
    assert.deepEqual(res.unverifiable.map((u) => u.kind), ["no_reachability_probe"]);
  });
  it("catches a declared composition gate that does not fire", () => {
    const res = validateContentClasses({
      ...baseClasses,
      admissionProfiles: {
        ...baseClasses.admissionProfiles,
        alpha: { personalMin: 1, publicMin: 2, rejectReason: "alpha_missing_composition", requireCompositionForPublic: true },
      },
      // a broken evaluator that ignores the gate entirely
      scoreAdmission: () => ({ ok: true }),
    });
    assert.deepEqual(res.errors.map((e) => e.kind), ["requirement_gate_not_firing"]);
  });
});

const getVocabulary = (name) => (name === "known_vocab" ? ["a", "b"] : undefined);
const schemaEntry = (schema) => [{ domain: "music", action: "act", schema }];

describe("validateArtifactSchemas — seeded faults", () => {
  it("a coherent schema passes clean", () => {
    const res = validateArtifactSchemas({
      schemas: schemaEntry({ required: ["title"], properties: { title: { type: "string", vocabulary: "known_vocab" } } }),
      getVocabulary,
    });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings, []);
  });
  it("catches a required field with no declared property, including nested in items", () => {
    const res = validateArtifactSchemas({
      schemas: schemaEntry({
        required: ["title", "ghost"],
        properties: {
          title: { type: "string" },
          notes: { type: "array", items: { required: ["pitch", "phantom"], properties: { pitch: { type: "number" } } } },
        },
      }),
      getVocabulary,
    });
    assert.deepEqual(res.errors.map((e) => e.kind), ["required_undeclared", "required_undeclared"]);
    assert.match(res.errors[1].detail, /notes\[\]\.phantom/);
  });
  it("catches a type the gate cannot enforce and a vocabulary that does not resolve", () => {
    const res = validateArtifactSchemas({
      schemas: schemaEntry({
        required: [],
        properties: {
          flag: { type: "boolean" },
          tag: { type: "string", vocabulary: "no_such_vocab" },
        },
      }),
      getVocabulary,
    });
    assert.deepEqual(res.errors.map((e) => e.kind).sort(), ["type_outside_gate_vocabulary", "vocabulary_unresolved"]);
  });
  it("reports string-form items as a warning, never an error", () => {
    const res = validateArtifactSchemas({
      schemas: schemaEntry({ required: [], properties: { tags: { type: "array", items: "string" } } }),
      getVocabulary,
    });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings.map((w) => w.kind), ["items_form_unenforced"]);
  });
});
