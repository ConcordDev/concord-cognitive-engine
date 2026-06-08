// tests/depth/standards-behavior.test.js — REAL behavioral tests for the
// standards domain (registerLensAction family). The standards domain is NOT yet
// registered globally in the running server (it was just added to
// domains/index.js but boot ordering / state isolation), so these tests use a
// LOCAL SHIM: import the registrar directly, capture its handlers in a Map, and
// invoke them with the same (ctx, artifact, params) contract.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/standards.js";

const H = new Map();
register((d, a, fn) => H.set(a, fn));

// run(action, data, params, ctx) → handler(ctx, { data }, params)
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

describe("standards — catalog (standards-list / standard-get)", () => {
  it("standards-list returns the curated authoritative catalog with real entries", () => {
    const r = run("standards-list");
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 6);
    const codes = r.result.standards.map((s) => s.code);
    assert.ok(codes.includes("IBC"));
    assert.ok(codes.includes("ASCE 7"));
    assert.ok(codes.includes("ACI 318"));
    assert.ok(codes.includes("AISC 360"));
    assert.ok(codes.includes("NFPA 70"));
    assert.ok(codes.includes("Eurocode 2"));

    const asce = r.result.standards.find((s) => s.id === "ASCE7");
    assert.equal(asce.org, "ASCE");
    assert.equal(asce.editionYear, 2022);
    assert.equal(asce.discipline, "Structural");
    assert.ok(asce.jurisdictions.includes("US"));
    assert.equal(asce.checkable, true);
    // Real clause references present.
    assert.ok(asce.clauses.find((c) => c.section === "26.5"));
    assert.equal(asce.clauseCount, asce.clauses.length);

    const nec = r.result.standards.find((s) => s.id === "NFPA70");
    assert.ok(nec.clauses.find((c) => c.section === "210.8"));
  });

  it("standards-list filters by discipline", () => {
    const r = run("standards-list", {}, { discipline: "Electrical" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.standards[0].id, "NFPA70");
  });

  it("standards-list 'All' discipline returns the full catalog", () => {
    const r = run("standards-list", {}, { discipline: "All" });
    assert.equal(r.result.count, 6);
  });

  it("standard-get returns a single standard by id (case-insensitive)", () => {
    const r = run("standard-get", {}, { id: "aci318" });
    assert.equal(r.ok, true);
    assert.equal(r.result.standard.id, "ACI318");
    assert.equal(r.result.standard.title, "Building Code Requirements for Structural Concrete");
    assert.ok(r.result.standard.rules.find((rule) => rule.check === "cover_minimum"));
  });

  it("standard-get rejects an unknown id", () => {
    const r = run("standard-get", {}, { id: "FAKE99" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("not found"));
  });

  it("standard-get rejects a missing id", () => {
    const r = run("standard-get", {}, {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("id required"));
  });
});

describe("standards — compliance-check (deterministic coded rules)", () => {
  it("ASCE 7: compliant values pass every rule", () => {
    const r = run("compliance-check", {}, { standardId: "ASCE7", values: { windSpeedMph: 115, sdsG: 1.2 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.rulesChecked, 2);
    assert.equal(r.result.passedCount, 2);
    assert.equal(r.result.failedCount, 0);
    assert.equal(r.result.verdict, "compliant");
    const wind = r.result.results.find((x) => x.check === "wind_speed_minimum");
    assert.equal(wind.status, "pass");
    assert.equal(wind.actual, "115 mph");
  });

  it("ASCE 7: below-floor wind speed + high seismic fail", () => {
    const r = run("compliance-check", {}, { standardId: "ASCE7", values: { windSpeedMph: 80, sdsG: 2.5 } });
    assert.equal(r.result.verdict, "non-compliant");
    assert.equal(r.result.failedCount, 2);
    const wind = r.result.results.find((x) => x.check === "wind_speed_minimum");
    assert.equal(wind.status, "fail");
    assert.equal(wind.expected, "≥ 90 mph");
    const seis = r.result.results.find((x) => x.check === "seismic_sds_limit");
    assert.equal(seis.status, "fail");
  });

  it("ACI 318: insufficient cover fails, adequate strength passes", () => {
    const r = run("compliance-check", {}, { standardId: "ACI318", values: { coverMm: 30, fcMpa: 28 } });
    assert.equal(r.result.failedCount, 1);
    assert.equal(r.result.passedCount, 1);
    const cover = r.result.results.find((x) => x.check === "cover_minimum");
    assert.equal(cover.status, "fail");
    assert.equal(cover.actual, "30 mm");
    const fc = r.result.results.find((x) => x.check === "compressive_strength_minimum");
    assert.equal(fc.status, "pass");
  });

  it("NFPA 70: missing GFCI value fails with a 'missing' actual", () => {
    const r = run("compliance-check", {}, { standardId: "NFPA70", values: { somethingElse: 1 } });
    assert.equal(r.result.verdict, "non-compliant");
    const gfci = r.result.results.find((x) => x.check === "gfci_required");
    assert.equal(gfci.status, "fail");
    assert.equal(gfci.actual, "missing");
  });

  it("compliance-check rejects a missing standardId", () => {
    const r = run("compliance-check", {}, { values: { windSpeedMph: 100 } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("standardId required"));
  });

  it("compliance-check rejects missing values", () => {
    const r = run("compliance-check", {}, { standardId: "ASCE7" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("values"));
  });

  it("compliance-check rejects an unknown standard", () => {
    const r = run("compliance-check", {}, { standardId: "NOPE", values: { x: 1 } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("not found"));
  });
});

describe("standards — saved-list / save round-trip (per user)", () => {
  it("save then saved-list reads the entry back for the same user", () => {
    const ctx = { actor: { userId: "saver-1" } };
    const empty = run("saved-list", {}, {}, ctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.count, 0);

    const saved = run("save", {}, { standardId: "ACI318", note: "deck design" }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.saved.standardId, "ACI318");
    assert.equal(saved.result.saved.note, "deck design");

    const list = run("saved-list", {}, {}, ctx);
    assert.equal(list.result.count, 1);
    assert.ok(list.result.saved.find((s) => s.id === saved.result.saved.id));
    assert.equal(list.result.saved[0].standardId, "ACI318");
  });

  it("saved entries are scoped per user", () => {
    const ctxA = { actor: { userId: "scope-a" } };
    const ctxB = { actor: { userId: "scope-b" } };
    run("save", {}, { standardId: "IBC" }, ctxA);
    const listB = run("saved-list", {}, {}, ctxB);
    assert.equal(listB.result.count, 0);
  });

  it("save rejects a missing standardId", () => {
    const r = run("save", {}, {}, { actor: { userId: "x" } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("standardId required"));
  });

  it("save rejects an unknown standardId", () => {
    const r = run("save", {}, { standardId: "GHOST" }, { actor: { userId: "x" } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("not found"));
  });
});
