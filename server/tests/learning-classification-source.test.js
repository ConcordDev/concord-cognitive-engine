/**
 * INC-36 — classification migration must survive a non-string DTU source.
 *
 * Boot calls migrateClassifications(STATE.dtus). isRepairDTU used to do
 * (dtu.source || "").toLowerCase(), so one object/array/number source aborted
 * the whole pass. Strings keep their previous meaning. A record that still
 * throws is counted, sampled, and skipped.
 *
 * Run: node --test tests/learning-classification-source.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDTU, isRepairDTU, migrateClassifications } from "../learning/classification.js";

describe("isRepairDTU non-string source", () => {
  it("keeps string source meaning, including case-insensitive repair labels", () => {
    assert.equal(isRepairDTU({ source: "repair_cortex" }), true);
    assert.equal(isRepairDTU({ source: "Repair.audit" }), true);
    assert.equal(isRepairDTU({ source: "learned" }), false);
    assert.equal(isRepairDTU({ source: "seed" }), false);
  });

  it("derives a label from an object's type, name, or kind", () => {
    assert.equal(isRepairDTU({ source: { type: "repair_cortex" } }), true);
    assert.equal(isRepairDTU({ source: { name: "Repair_Cortex" } }), true);
    assert.equal(isRepairDTU({ source: { kind: "repair.sweep" } }), true);
    assert.equal(isRepairDTU({ source: { type: "", name: "repair_cortex" } }), true);
    assert.equal(isRepairDTU({ source: { url: "https://example.test/a", id: "abc" } }), false);
    assert.equal(isRepairDTU({ source: { kind: "table" } }), false);
  });

  it("treats array, number, and null source as empty", () => {
    assert.equal(isRepairDTU({ source: ["repair_cortex"] }), false);
    assert.equal(isRepairDTU({ source: 12 }), false);
    assert.equal(isRepairDTU({ source: 0 }), false);
    assert.equal(isRepairDTU({ source: null }), false);
    assert.equal(isRepairDTU({ source: undefined }), false);
  });

  it("reads object meta and tag labels without throwing on non-strings", () => {
    assert.equal(isRepairDTU({ meta: { createdBy: "repair_cortex" } }), true);
    assert.equal(isRepairDTU({ meta: { createdBy: { name: "repair_cortex" } } }), true);
    assert.equal(isRepairDTU({ meta: { brainSource: "repair" } }), true);
    assert.equal(isRepairDTU({ meta: { brainSource: { kind: "repair" } } }), true);
    assert.equal(isRepairDTU({ meta: { createdBy: 4, brainSource: null } }), false);
    assert.equal(isRepairDTU({ meta: ["repair_cortex"] }), false);
    assert.equal(isRepairDTU({ tags: ["repair"] }), true);
    assert.equal(isRepairDTU({ tags: [{ name: "repair_cortex" }] }), true);
    assert.equal(isRepairDTU({ tags: [1, null, "general"] }), false);
  });
});

describe("classifyDTU non-string fields", () => {
  it("keeps string source and tier meaning", () => {
    assert.equal(classifyDTU({ source: "seed" }), "seed");
    assert.equal(classifyDTU({ source: "bootstrap" }), "seed");
    assert.equal(classifyDTU({ source: "Seed" }), "knowledge");
    assert.equal(classifyDTU({ source: "repair_cortex" }), "repair");
    assert.equal(classifyDTU({ tier: "regular", source: "learned" }), "knowledge");
    assert.equal(classifyDTU({ tier: "hyper", source: "learned" }), "hyper");
    assert.equal(classifyDTU({ tier: "SHADOW" }), "shadow");
    assert.equal(classifyDTU({ tags: ["shadow"] }), "shadow");
  });

  it("classifies object, array, number, and null sources without throwing", () => {
    assert.equal(classifyDTU({ source: { type: "repair_cortex" } }), "repair");
    assert.equal(classifyDTU({ source: { name: "bootstrap" } }), "seed");
    assert.equal(classifyDTU({ source: { kind: "seed" } }), "seed");
    assert.equal(classifyDTU({ source: { url: "https://example.test/a", id: "abc" } }), "knowledge");
    assert.equal(classifyDTU({ source: ["seed"], tier: "regular" }), "knowledge");
    assert.equal(classifyDTU({ source: 7, tier: "regular" }), "knowledge");
    assert.equal(classifyDTU({ source: null, tier: "mega" }), "mega");
  });

  it("classifies non-string tier and tag labels without throwing", () => {
    assert.equal(classifyDTU({ tier: { kind: "hyper" }, source: "learned" }), "hyper");
    assert.equal(classifyDTU({ tier: { name: "mega" } }), "mega");
    assert.equal(classifyDTU({ tier: { type: "shadow" } }), "shadow");
    assert.equal(classifyDTU({ tier: 3, source: "learned" }), "knowledge");
    assert.equal(classifyDTU({ tier: ["mega"], source: "learned" }), "knowledge");
    assert.equal(classifyDTU({ tier: null, source: "learned" }), "knowledge");
    assert.equal(classifyDTU({ tags: [{ kind: "shadow" }] }), "shadow");
    assert.equal(classifyDTU({ tags: [1, null] }), "knowledge");
  });
});

describe("migrateClassifications isolates per-DTU failures", () => {
  it("migrates object, array, number, and null sources and reports no failures", () => {
    const dtus = new Map();
    dtus.set("obj", { id: "obj", source: { type: "repair_cortex" } });
    dtus.set("arr", { id: "arr", source: ["repair_cortex"], tier: "regular" });
    dtus.set("num", { id: "num", source: 12, tier: "hyper" });
    dtus.set("nil", { id: "nil", source: null, tier: "mega" });
    dtus.set("seed-obj", { id: "seed-obj", source: { kind: "seed" } });

    const result = migrateClassifications(dtus);

    assert.equal(result.failed, 0);
    assert.deepEqual(result.failedSamples, []);
    assert.equal(result.migrated, 5);
    assert.equal(dtus.get("obj").classification, "repair");
    assert.equal(dtus.get("arr").classification, "knowledge");
    assert.equal(dtus.get("num").classification, "hyper");
    assert.equal(dtus.get("nil").classification, "mega");
    assert.equal(dtus.get("seed-obj").classification, "seed");
  });

  it("migrates the other DTUs when one record throws and reports that failure", () => {
    const dtus = new Map();
    dtus.set("ok-knowledge", { id: "ok-knowledge", tier: "regular", source: "learned" });
    dtus.set("ok-object", { id: "ok-object", source: { name: "repair_cortex" } });
    dtus.set("ok-mega", { id: "ok-mega", tier: "mega", source: "learned" });
    const bad = { id: "bad-dtu", tier: "regular", source: "learned" };
    Object.defineProperty(bad, "classification", {
      get() { throw new Error("classification unreadable"); },
      set() { throw new Error("classification unreadable"); },
    });
    dtus.set("bad-key", bad);

    const result = migrateClassifications(dtus);

    assert.equal(result.migrated, 3);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failedSamples, ["bad-dtu"]);
    assert.equal(dtus.get("ok-knowledge").classification, "knowledge");
    assert.equal(dtus.get("ok-object").classification, "repair");
    assert.equal(dtus.get("ok-mega").classification, "mega");
    assert.equal(result.byClassification.knowledge, 1);
    assert.equal(result.byClassification.repair, 1);
    assert.equal(result.byClassification.mega, 1);
    assert.equal(result.byClassification["bad-dtu"], undefined);
  });

  it("caps sample ids and still migrates a later good DTU", () => {
    const dtus = new Map();
    for (let i = 0; i < 7; i++) dtus.set(`bad-${i}`, null);
    dtus.set("keeper", { id: "keeper", source: "learned", tier: "regular" });

    const result = migrateClassifications(dtus);

    assert.equal(result.failed, 7);
    assert.deepEqual(result.failedSamples, ["bad-0", "bad-1", "bad-2", "bad-3", "bad-4"]);
    assert.equal(result.migrated, 1);
    assert.equal(dtus.get("keeper").classification, "knowledge");
    assert.equal(result.byClassification.knowledge, 1);
  });
});
