// tests/depth/healthcare-behavior.test.js — REAL behavioral tests for the
// healthcare domain (registerLensAction family, via lensRun). Exact-value
// clinical calcs (BMI, vitals red-flags, lab abnormal-flag ranges, drug
// interactions, protocol matching, claim adjudication) + EHR CRUD round-trips
// (patients / problems / allergies / encounters / orders) + validation
// rejections. Every value is derived from the SOURCE in
// server/domains/healthcare.js — none vacuous.
//
// Wrapping note (server.js:37452-37458): the lens.run dispatcher UNWRAPS a
// handler's `{ ok, result }` — so a handler success surfaces as `r.result.<field>`
// directly, while a handler refusal `{ ok:false, error }` (no `result` key)
// surfaces verbatim as `r.result.ok === false` + `r.result.error`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("healthcare — clinical calcs (exact values)", () => {
  it("vitals-record: BMI = weightLb*703/heightIn^2 (180/70 → 25.8)", async () => {
    const pid = `pat-${randomUUID()}`;
    const r = await lensRun("healthcare", "vitals-record", {
      params: { patientId: pid, weightLb: 180, heightIn: 70 },
    });
    // 180 * 703 / (70*70) = 126540/4900 = 25.824... → round(*10)/10 = 25.8
    assert.equal(r.result.vitals.bmi, 25.8);
  });

  it("vitals-record: red-flag table — systolic 185 critical + spo2 90 hypoxia", async () => {
    const pid = `pat-${randomUUID()}`;
    const r = await lensRun("healthcare", "vitals-record", {
      params: { patientId: pid, systolic: 185, diastolic: 95, spo2: 90, tempF: 101 },
    });
    // systolic>=180 → bp_critical; diastolic>=90 → bp_high; spo2<92 → hypoxia; tempF>=100.4 → fever
    assert.ok(r.result.vitals.flags.includes("bp_critical"));
    assert.ok(r.result.vitals.flags.includes("hypoxia"));
    assert.ok(r.result.vitals.flags.includes("fever"));
  });

  it("labs-record: glucose flag — 45 → 'low', 410 → 'critical_high'", async () => {
    const pid = `pat-${randomUUID()}`;
    // glucose range low 70 / high 100 / critLow 40 / critHigh 400
    const low = await lensRun("healthcare", "labs-record", { params: { patientId: pid, test: "glucose", value: 45 } });
    assert.equal(low.result.lab.flag, "low");      // 45 > critLow(40), 45 < low(70)
    assert.equal(low.result.lab.unit, "mg/dL");    // pulled from LAB_RANGES
    const crit = await lensRun("healthcare", "labs-record", { params: { patientId: pid, test: "glucose", value: 410 } });
    assert.equal(crit.result.lab.flag, "critical_high"); // 410 >= critHigh(400)
  });

  it("checkInteractions: matched pair surfaces by RxCUI, sorted critical-first", async () => {
    const r = await lensRun("healthcare", "checkInteractions", {
      data: {
        prescriptions: [
          { drug: "Warfarin", rxcui: "11289" },
          { drug: "Aspirin", rxcui: "1191" },
          { drug: "Lisinopril", rxcui: "29046" },
        ],
        knownInteractions: [
          { pair: ["11289", "1191"], severity: "critical", description: "bleeding" },
        ],
      },
    });
    assert.equal(r.result.totalChecked, 3);
    assert.equal(r.result.interactionsFound, 1);
    assert.equal(r.result.hasCritical, true);
    assert.deepEqual(r.result.interactions[0].drugs, ["Warfarin", "Aspirin"]);
  });

  it("protocolMatch: full match when ALL triggers present (ratio 1)", async () => {
    const r = await lensRun("healthcare", "protocolMatch", {
      data: {
        conditions: ["E11.9", "I10"],
        protocols: [
          { id: "p1", name: "Diabetes+HTN bundle", triggerConditions: ["E11.9", "I10"], steps: ["A1C", "BP"] },
          { id: "p2", name: "Asthma only", triggerConditions: ["J45.909"], steps: ["spirometry"] },
        ],
      },
    });
    assert.equal(r.result.matched.length, 1);
    assert.equal(r.result.matched[0].protocolId, "p1");
    assert.equal(r.result.matched[0].matchRatio, 1);
    assert.equal(r.result.protocolsEvaluated, 2);
  });
});

describe("healthcare — EHR CRUD round-trips", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-crud");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Ada", lastName: "Lovelace", dob: "1815-12-10", sex: "F" } }, ctx);
    patientId = p.result.patient.id;
    assert.ok(patientId, "patient id minted");
  });

  it("patients-create → patients-list reads it back", async () => {
    const list = await lensRun("healthcare", "patients-list", {}, ctx);
    assert.ok(list.result.patients.some((p) => p.id === patientId));
  });

  it("problems-add → problems-list (filtered by patientId)", async () => {
    const add = await lensRun("healthcare", "problems-add", { params: { patientId, name: "Type 2 diabetes", icd10: "E11.9" } }, ctx);
    const probId = add.result.problem.id;
    assert.match(add.result.problem.number, /^PRB-\d{5}$/);
    const list = await lensRun("healthcare", "problems-list", { params: { patientId } }, ctx);
    assert.ok(list.result.problems.some((p) => p.id === probId && p.icd10 === "E11.9"));
  });

  it("allergies-add → allergies-list → allergies-delete", async () => {
    const add = await lensRun("healthcare", "allergies-add", { params: { patientId, allergen: "Penicillin", severity: "severe", reaction: "anaphylaxis" } }, ctx);
    const algId = add.result.allergy.id;
    assert.equal(add.result.allergy.severity, "severe");
    const list = await lensRun("healthcare", "allergies-list", { params: { patientId } }, ctx);
    assert.ok(list.result.allergies.some((a) => a.id === algId));
    const del = await lensRun("healthcare", "allergies-delete", { params: { id: algId } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("healthcare", "allergies-list", { params: { patientId } }, ctx);
    assert.ok(!after.result.allergies.some((a) => a.id === algId));
  });

  it("encounters-create → encounters-sign (Assessment+Plan unlock signing)", async () => {
    const enc = await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "cough", assessment: "URI", plan: "rest + fluids" } }, ctx);
    const encId = enc.result.encounter.id;
    assert.equal(enc.result.encounter.status, "open");
    const signed = await lensRun("healthcare", "encounters-sign", { params: { id: encId } }, ctx);
    assert.equal(signed.result.encounter.status, "signed");
    assert.ok(signed.result.encounter.signedAt);
  });

  it("order-create (medication) → order-list → drug-interaction-check finds warfarin+aspirin", async () => {
    await lensRun("healthcare", "order-create", { params: { patientId, kind: "medication", name: "Warfarin 5mg", dose: "5mg" } }, ctx);
    const o2 = await lensRun("healthcare", "order-create", { params: { patientId, kind: "medication", name: "Aspirin 81mg", dose: "81mg" } }, ctx);
    assert.equal(o2.result.order.status, "active"); // medication orders default 'active'
    const list = await lensRun("healthcare", "order-list", { params: { patientId, kind: "medication" } }, ctx);
    assert.ok(list.result.orders.some((o) => o.name.includes("Aspirin")));
    const check = await lensRun("healthcare", "drug-interaction-check", { params: { patientId } }, ctx);
    // DRUG_INTERACTIONS: ['warfarin','aspirin','major', …] — substring match, both active
    assert.equal(check.result.hasMajor, true);
    assert.ok(check.result.interactions.some((i) => i.type === "drug-drug" && i.severity === "major"));
  });

  it("claim-create sums charges; claim-submit→adjudicate computes patient responsibility", async () => {
    const c = await lensRun("healthcare", "claim-create", { params: { patientId, lines: [
      { cpt: "99213", chargeUsd: 120, units: 1 },
      { cpt: "85025", chargeUsd: 40, units: 2 },
    ] } }, ctx);
    assert.equal(c.result.claim.totalChargeUsd, 200); // 120*1 + 40*2
    const claimId = c.result.claim.id;
    await lensRun("healthcare", "claim-submit", { params: { id: claimId } }, ctx);
    const adj = await lensRun("healthcare", "claim-adjudicate", { params: { id: claimId, allowedUsd: 150, paidUsd: 110 } }, ctx);
    assert.equal(adj.result.claim.patientResponsibilityUsd, 40); // allowed - paid
    assert.equal(adj.result.claim.status, "partial");            // 0 < paid < allowed
  });
});

describe("healthcare — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-validation"); });

  it("patients-create without lastName is rejected", async () => {
    const bad = await lensRun("healthcare", "patients-create", { params: { firstName: "Solo" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /firstName \+ lastName required/);
  });

  it("encounters-sign without Assessment+Plan is rejected (CMS audit rule)", async () => {
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Empty", lastName: "Chart" } }, ctx);
    const enc = await lensRun("healthcare", "encounters-create", { params: { patientId: p.result.patient.id, chiefComplaint: "checkup" } }, ctx);
    const bad = await lensRun("healthcare", "encounters-sign", { params: { id: enc.result.encounter.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /Assessment \+ Plan required/);
  });

  it("order-create with an invalid kind is rejected", async () => {
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Order", lastName: "Patient" } }, ctx);
    const bad = await lensRun("healthcare", "order-create", { params: { patientId: p.result.patient.id, kind: "spell", name: "Fireball" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /kind must be one of/);
  });
});
