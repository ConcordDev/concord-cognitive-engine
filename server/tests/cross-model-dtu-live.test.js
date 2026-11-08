// Cohesive R-3, DTU-pair enrolment — the LIVE enrolment: the real
// content-class module and the real artifact-schema registry,
// validated by the adapters in lib/cross-model-dtu.js.
//
// Baselines, first run 2026-11-03 (main 0513f2ad6), probed before
// the slice was built and pinned here:
//   Content classes — 7 classes ↔ 7 profiles exactly, no inverted
//   minima, all 7 classes reachable by the probes below, the one
//   hard gate any profile declares (formula's
//   requireCompositionForPublic) firing exactly as declared.
//   Artifact schemas — 37 registered schemas; ZERO errors on
//   required-resolves / type-vocabulary / vocabulary-resolves
//   (3 vocabulary names referenced, all resolve); exactly FOUR
//   items-form warnings (string-form items the quality gate does
//   not enforce), pinned by target below; and the registration
//   census reconciles exactly: 37 literal registerSchema calls in
//   the source files == 37 unique (domain, action) pairs == 37
//   live registry keys (the raw grep count of 47 includes the 10
//   per-file import lines; the extraction below matches call
//   sites only).
// A new class without a probe, a new screening of drift in either
// surface, or a new unenforced items declaration changes these
// baselines consciously — that is what makes the suite a gate.
//
// NOT checked here (named boundary): whether each schema's
// (domain, action) names a real lens action — the lens-action
// registry lives in server.js's monolith scope and is not
// importable; that check belongs to the boot report-mode slice.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CONTENT_CLASSES, ADMISSION_PROFILES, inferClass, scoreAdmission,
} from "../lib/dtu-content-classes.js";
import { listArtifactSchemas, schemasReady } from "../lib/artifact-schemas.js";
import "../lib/vocabularies.js";
import { getVocabulary } from "../lib/quality-gate.js";
import { validateContentClasses, validateArtifactSchemas } from "../lib/cross-model-dtu.js";

// One probe per class, crafted against inferClass's documented
// signals. The coverage assertion in the first test fails loudly
// when a class is declared without a probe here.
const PROBES = {
  media: { mimeType: "audio/mpeg", title: "song" },
  dataset: { mimeType: "text/csv", title: "data" },
  software: { mimeType: "application/javascript", title: "lib" },
  world_asset: { type: "world_asset", title: "prop" },
  formula: { composition: "H2O", title: "water" },
  knowledge: { type: "knowledge", title: "essay" },
  generic: { title: "plain note" },
};

describe("cross-model DTU pair — live: content classes", () => {
  it("the probe table covers exactly the declared classes", () => {
    assert.deepEqual(Object.keys(PROBES).sort(), [...CONTENT_CLASSES].sort());
  });
  it("declarations and bindings agree: no errors, nothing unverifiable", () => {
    const res = validateContentClasses({
      contentClasses: CONTENT_CLASSES,
      admissionProfiles: ADMISSION_PROFILES,
      inferClass,
      probes: PROBES,
      scoreAdmission,
    });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.unverifiable, []);
    assert.equal(res.checked.classes, 7);
    assert.equal(res.checked.reachabilityProbes, 7);
  });
});

describe("cross-model DTU pair — live: artifact schemas", () => {
  it("the registry validates clean, with exactly the four pinned items-form warnings", async () => {
    await schemasReady;
    const res = validateArtifactSchemas({ schemas: listArtifactSchemas(), getVocabulary });
    assert.deepEqual(res.errors, []);
    assert.equal(res.checked.schemas, 37);
    assert.equal(res.checked.vocabularies, 4);
    const warned = res.warnings.map((w) => w.location).sort();
    assert.deepEqual(warned, [
      "food.generate-meal-plan",
      "healthcare.build-care-plan",
      "law.analyze-contract",
      "studio.suggest-chords",
    ]);
  });
  it("the registration census reconciles: source calls == unique pairs == live keys", async () => {
    await schemasReady;
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../lib/artifact-schemas");
    const pairs = new Set();
    let calls = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/registerSchema\("([^"]+)", "([^"]+)"/g)) {
        calls++;
        pairs.add(`${m[1]}.${m[2]}`);
      }
    }
    const live = new Set(listArtifactSchemas().map((s) => `${s.domain}.${s.action}`));
    assert.equal(calls, 37);
    assert.equal(pairs.size, 37);
    assert.deepEqual([...pairs].sort(), [...live].sort());
  });
});
