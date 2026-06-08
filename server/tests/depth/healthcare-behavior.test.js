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

// ────────────────────────────────────────────────────────────────────
// Wave 7 top-up — UNCOVERED deterministic macros: more clinical-calc
// edge branches (vitals red-flag table cells, lab ranges, device-metric
// flags), medication scheduling, immunizations, scheduling, insurance
// eligibility, care-gaps BPA, CDS order check, orders lifecycle, refills,
// SmartPhrases. Skipped (network/integration/LLM): fhir-export,
// telehealth-create (WebRTC), providers-search/icd10-search (live HTTP),
// rx-price-compare (PBM API), appointment-charge-copay (Stripe), ai-scribe
// / ai-chart-search / soapAutoFill / generateSummary / symptom-triage (LLM).
// ────────────────────────────────────────────────────────────────────

describe("healthcare — clinical-calc edges (wave 7 top-up)", () => {
  it("vitals-record: hr_critical (HR 135) + temp_critical (tempF 103) red-flags", async () => {
    const pid = `pat-${randomUUID()}`;
    const r = await lensRun("healthcare", "vitals-record", {
      params: { patientId: pid, heartRate: 135, tempF: 103, diastolic: 55 },
    });
    // heartRate>130 → hr_critical; tempF>=103 → temp_critical; diastolic<60 → bp_critical
    assert.ok(r.result.vitals.flags.includes("hr_critical"));
    assert.ok(r.result.vitals.flags.includes("temp_critical"));
    assert.ok(r.result.vitals.flags.includes("bp_critical"));
    // tempF 103 is temp_critical, NOT the milder fever flag
    assert.ok(!r.result.vitals.flags.includes("fever"));
  });

  it("vitals-record: BMI 154lb / 68in → 23.4 (154*703/68^2)", async () => {
    const pid = `pat-${randomUUID()}`;
    const r = await lensRun("healthcare", "vitals-record", {
      params: { patientId: pid, weightLb: 154, heightIn: 68 },
    });
    // 154*703 / (68*68) = 108262 / 4624 = 23.413... → round(*10)/10 = 23.4
    assert.equal(r.result.vitals.bmi, 23.4);
    assert.deepEqual(r.result.vitals.flags, []); // no vitals → no flags
  });

  it("labs-record: a1c 14 → critical_high, sodium 130 → low, unknown test → unflagged", async () => {
    const pid = `pat-${randomUUID()}`;
    // a1c critHigh 14 → value>=14 hits critical_high
    const a1c = await lensRun("healthcare", "labs-record", { params: { patientId: pid, test: "a1c", value: 14 } });
    assert.equal(a1c.result.lab.flag, "critical_high");
    assert.equal(a1c.result.lab.unit, "%");
    // sodium range low 135 / critLow 120 → 130 is below low but above critLow → 'low'
    const na = await lensRun("healthcare", "labs-record", { params: { patientId: pid, test: "sodium", value: 130 } });
    assert.equal(na.result.lab.flag, "low");
    assert.equal(na.result.lab.refLow, 135);
    // unknown test → no range → 'unflagged'
    const unk = await lensRun("healthcare", "labs-record", { params: { patientId: pid, test: "mystery_assay", value: 42 } });
    assert.equal(unk.result.lab.flag, "unflagged");
  });

  it("labs-record: rejects missing/non-numeric value", async () => {
    const bad = await lensRun("healthcare", "labs-record", { params: { patientId: "p1", test: "glucose", value: "high" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /numeric value required/);
  });

  it("labs-known-tests: exposes the LAB_RANGES catalog with glucose unit/range", async () => {
    const r = await lensRun("healthcare", "labs-known-tests", {});
    const glucose = r.result.tests.find((t) => t.test === "glucose");
    assert.equal(glucose.unit, "mg/dL");
    assert.equal(glucose.low, 70);
    assert.equal(glucose.high, 100);
  });
});

describe("healthcare — medications & immunizations (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-topup-meds"); });

  it("medications-add (twice_daily) → list: dosesScheduledToday=2, takenToday false until 2 logged", async () => {
    const add = await lensRun("healthcare", "medications-add", { params: { name: "Metformin", dose: "500mg", schedule: "twice_daily" } }, ctx);
    const medId = add.result.medication.id;
    assert.equal(add.result.medication.refillRemaining, 30); // default
    let list = await lensRun("healthcare", "medications-list", {}, ctx);
    let med = list.result.medications.find((m) => m.id === medId);
    assert.equal(med.dosesScheduledToday, 2); // scheduleToDosesPerDay('twice_daily')
    assert.equal(med.takenToday, false);
    // log one dose → still not complete (1 < 2)
    await lensRun("healthcare", "medications-log-dose", { params: { id: medId } }, ctx);
    list = await lensRun("healthcare", "medications-list", {}, ctx);
    med = list.result.medications.find((m) => m.id === medId);
    assert.equal(med.dosesTakenToday, 1);
    assert.equal(med.takenToday, false);
    // log the second → complete
    await lensRun("healthcare", "medications-log-dose", { params: { id: medId } }, ctx);
    list = await lensRun("healthcare", "medications-list", {}, ctx);
    med = list.result.medications.find((m) => m.id === medId);
    assert.equal(med.dosesTakenToday, 2);
    assert.equal(med.takenToday, true);
  });

  it("medications-add without dose is rejected", async () => {
    const bad = await lensRun("healthcare", "medications-add", { params: { name: "Aspirin" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name and dose required/);
  });

  it("immunizations-add → immunizations-list reads it back with IMM-##### number", async () => {
    const pid = `pat-${randomUUID()}`;
    const add = await lensRun("healthcare", "immunizations-add", { params: { patientId: pid, vaccine: "Influenza", cvx: "140" } }, ctx);
    const immId = add.result.immunization.id;
    assert.match(add.result.immunization.number, /^IMM-\d{5}$/);
    const list = await lensRun("healthcare", "immunizations-list", { params: { patientId: pid } }, ctx);
    assert.ok(list.result.immunizations.some((i) => i.id === immId && i.cvx === "140"));
  });
});

describe("healthcare — scheduling, devices & insurance (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-topup-sched"); });

  it("appointment-book rounds copay + defaults bad kind to in_person → appointment-list", async () => {
    const book = await lensRun("healthcare", "appointment-book", {
      params: { providerId: "npi_123", date: "2026-07-01", time: "09:00", kind: "carrier_pigeon", copayUsd: 25.009 },
    }, ctx);
    assert.equal(book.result.appointment.kind, "in_person"); // invalid kind → default
    assert.equal(book.result.appointment.copayUsd, 25.01);   // round(25.009*100)/100
    assert.equal(book.result.appointment.copayStatus, "unpaid");
    const apptId = book.result.appointment.id;
    const list = await lensRun("healthcare", "appointment-list", {}, ctx);
    assert.ok(list.result.appointments.some((a) => a.id === apptId));
  });

  it("appointment-book rejects missing date/time", async () => {
    const bad = await lensRun("healthcare", "appointment-book", { params: { providerId: "npi_x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /providerId, date, time required/);
  });

  it("device-ingest flags glucose 180 'high' (range 70-140) → device-readings trend 'up'", async () => {
    const pid = `pat-${randomUUID()}`;
    const r1 = await lensRun("healthcare", "device-ingest", { params: { patientId: pid, metric: "glucose", value: 100, recordedAt: "2026-06-01T08:00:00Z" } }, ctx);
    assert.equal(r1.result.reading.flag, "normal"); // 70 <= 100 <= 140
    const r2 = await lensRun("healthcare", "device-ingest", { params: { patientId: pid, metric: "glucose", value: 180, recordedAt: "2026-06-02T08:00:00Z" } }, ctx);
    assert.equal(r2.result.reading.flag, "high");   // 180 > 140
    assert.equal(r2.result.reading.unit, "mg/dL");  // pulled from DEVICE_METRICS
    const read = await lensRun("healthcare", "device-readings", { params: { patientId: pid, metric: "glucose" } }, ctx);
    const summary = read.result.summary.find((s) => s.metric === "glucose");
    assert.equal(summary.count, 2);
    assert.equal(summary.latest, 180);
    assert.equal(summary.trend, "up"); // 180 > 100*1.05
  });

  it("coverage-add → coverage-verify stamps 'active' + computes remainingDeductible", async () => {
    const pid = `pat-${randomUUID()}`;
    const add = await lensRun("healthcare", "coverage-add", { params: { patientId: pid, payer: "BlueCross", memberId: "BC123", deductibleUsd: 1500 } }, ctx);
    const covId = add.result.policy.id;
    assert.equal(add.result.policy.eligibilityStatus, "unverified");
    const verify = await lensRun("healthcare", "coverage-verify", { params: { id: covId } }, ctx);
    assert.equal(verify.result.eligibilityStatus, "active");          // payer+memberId complete
    assert.equal(verify.result.remainingDeductible, 1500);            // 1500 - deductibleMetUsd(0)
    assert.ok(verify.result.policy.verifiedAt);
  });

  it("coverage-add without memberId is rejected", async () => {
    const bad = await lensRun("healthcare", "coverage-add", { params: { patientId: "p1", payer: "Aetna" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /patientId \+ payer \+ memberId required/);
  });
});

describe("healthcare — CDS, orders lifecycle, refills & SmartPhrases (wave 7 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-topup-cds");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Gregory", lastName: "House", dob: "1959-05-15", sex: "M" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("care-gaps: diabetic patient with no A1C in 180d surfaces the A1C gap", async () => {
    await lensRun("healthcare", "problems-add", { params: { patientId, name: "Type 2 diabetes mellitus", icd10: "E11.9", status: "active" } }, ctx);
    const r = await lensRun("healthcare", "care-gaps", { params: { patientId } }, ctx);
    assert.equal(r.result.allClear, false);
    const a1cGap = r.result.gaps.find((g) => g.item === "Hemoglobin A1C");
    assert.ok(a1cGap, "A1C gap surfaced for diabetic with no recent A1C");
    assert.equal(a1cGap.status, "due"); // never done → 'due'
  });

  it("cds-order-check: documented allergy raises a major ALLERGY alert at med order entry", async () => {
    await lensRun("healthcare", "allergies-add", { params: { patientId, allergen: "Penicillin", severity: "severe", reaction: "rash" } }, ctx);
    const r = await lensRun("healthcare", "cds-order-check", { params: { patientId, orderKind: "medication", orderName: "Amoxicillin-Penicillin 500mg" } }, ctx);
    assert.equal(r.result.hasMajor, true);
    assert.equal(r.result.clean, false);
    assert.ok(r.result.alerts.some((a) => a.code === "ALLERGY" && a.severity === "major"));
  });

  it("order-cancel: medication order → 'discontinued'; re-cancel is rejected", async () => {
    const ord = await lensRun("healthcare", "order-create", { params: { patientId, kind: "medication", name: "Lisinopril 10mg", dose: "10mg" } }, ctx);
    const ordId = ord.result.order.id;
    const cancel = await lensRun("healthcare", "order-cancel", { params: { id: ordId } }, ctx);
    assert.equal(cancel.result.order.status, "discontinued"); // medication → discontinued, not cancelled
    const again = await lensRun("healthcare", "order-cancel", { params: { id: ordId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already discontinued/);
  });

  it("order-update-status: completing a lab order stamps completedAt", async () => {
    const ord = await lensRun("healthcare", "order-create", { params: { patientId, kind: "lab", name: "CBC" } }, ctx);
    assert.equal(ord.result.order.status, "placed"); // non-medication → placed
    const upd = await lensRun("healthcare", "order-update-status", { params: { id: ord.result.order.id, status: "completed" } }, ctx);
    assert.equal(upd.result.order.status, "completed");
    assert.ok(upd.result.order.completedAt);
  });

  it("drug-interaction-check: candidateDrug warfarin against active aspirin order finds major drug-drug", async () => {
    await lensRun("healthcare", "order-create", { params: { patientId, kind: "medication", name: "Aspirin 81mg", dose: "81mg" } }, ctx);
    const r = await lensRun("healthcare", "drug-interaction-check", { params: { patientId, candidateDrug: "Warfarin 5mg" } }, ctx);
    assert.equal(r.result.hasMajor, true);
    assert.ok(r.result.interactions.some((i) => i.type === "drug-drug" && i.severity === "major"));
  });

  it("refills-request → refills-respond (approved) round-trip", async () => {
    const req = await lensRun("healthcare", "refills-request", { params: { patientId, medication: "Atorvastatin 20mg", dose: "20mg" } }, ctx);
    const refillId = req.result.refill.id;
    assert.equal(req.result.refill.status, "requested");
    assert.match(req.result.refill.number, /^RX-\d{5}$/);
    const resp = await lensRun("healthcare", "refills-respond", { params: { id: refillId, status: "approved" } }, ctx);
    assert.equal(resp.result.refill.status, "approved");
    assert.ok(resp.result.refill.respondedAt);
    const list = await lensRun("healthcare", "refills-list", { params: { status: "approved" } }, ctx);
    assert.ok(list.result.refills.some((r) => r.id === refillId));
  });

  it("refills-respond with an invalid status is rejected", async () => {
    const req = await lensRun("healthcare", "refills-request", { params: { patientId, medication: "Omeprazole" } }, ctx);
    const bad = await lensRun("healthcare", "refills-respond", { params: { id: req.result.refill.id, status: "maybe" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /status must be approved \| denied \| filled/);
  });

  it("smartphrases-create → smartphrases-expand substitutes the dot-phrase token", async () => {
    await lensRun("healthcare", "smartphrases-create", { params: { name: "normalexam", text: "Patient appears well, no acute distress." } }, ctx);
    const exp = await lensRun("healthcare", "smartphrases-expand", { params: { text: "On exam: .normalexam Follow up in 2 weeks." } }, ctx);
    assert.ok(exp.result.expanded.includes("Patient appears well, no acute distress."));
    assert.ok(!exp.result.expanded.includes(".normalexam"));
    assert.ok(exp.result.expandedLength > exp.result.originalLength);
  });
});

// ────────────────────────────────────────────────────────────────────
// Wave 7 top-up (batch 2) — further UNCOVERED deterministic macros:
// lab critical_low + abnormal flag branch (potassium), results-release
// → patient-portal-view gating, patients-update/detail aggregation,
// problems-update resolve-date, vitals-list round-trip, secure-message
// CRUD, care-team CRUD, claim-list outstanding sum + claim denied path,
// proxy CRUD, dashboard-summary computed counters, after-visit-summary
// text composition, provider-slots empty-feed. Skipped (network/LLM/
// integration, per the header note): fhir-export, telehealth-create
// (WebRTC), providers-search / icd10-search / rx-price-compare (HTTP),
// appointment-charge-copay (Stripe), ai-scribe / ai-chart-search /
// soapAutoFill / generateSummary / symptom-triage (LLM).
// ────────────────────────────────────────────────────────────────────

describe("healthcare — labs portal release gating (wave 7 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-topup-labs");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Lab", lastName: "Patient" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("labs-record: potassium 2.3 → critical_low (critLow 2.5 takes precedence over low 3.5)", async () => {
    // potassium range low 3.5 / critLow 2.5 → 2.3 <= 2.5 hits critical_low before the 'low' branch
    const r = await lensRun("healthcare", "labs-record", { params: { patientId, test: "potassium", value: 2.3 } }, ctx);
    assert.equal(r.result.lab.flag, "critical_low");
    assert.equal(r.result.lab.unit, "mEq/L");
    assert.equal(r.result.lab.refLow, 3.5);
  });

  it("labs-portal-view hides UNreleased labs; labs-release surfaces them with critical grouping", async () => {
    // freshly-recorded potassium is not yet released → portal view shows nothing
    const before = await lensRun("healthcare", "labs-portal-view", { params: { patientId } }, ctx);
    assert.equal(before.result.labs.length, 0);
    assert.equal(before.result.hasCritical, false);
    // record + release a critical_low lab
    const rec = await lensRun("healthcare", "labs-record", { params: { patientId, test: "potassium", value: 2.2 } }, ctx);
    const labId = rec.result.lab.id;
    const rel = await lensRun("healthcare", "labs-release", { params: { id: labId, commentary: "Recheck stat", releasedBy: "Dr. Chase" } }, ctx);
    assert.equal(rel.result.lab.released, true);
    assert.equal(rel.result.lab.providerCommentary, "Recheck stat");
    // now the portal surfaces exactly the released one, flagged abnormal + critical
    const after = await lensRun("healthcare", "labs-portal-view", { params: { patientId } }, ctx);
    assert.ok(after.result.labs.some((l) => l.id === labId));
    assert.equal(after.result.abnormalCount, 1);
    assert.equal(after.result.normalCount, 0);
    assert.equal(after.result.hasCritical, true);
  });

  it("labs-list reads back every recorded lab for the patient", async () => {
    const list = await lensRun("healthcare", "labs-list", { params: { patientId } }, ctx);
    // both potassium labs recorded above (2.3 unreleased + 2.2 released) are present
    assert.ok(list.result.labs.filter((l) => l.test === "potassium").length >= 2);
  });
});

describe("healthcare — patient/problem record edits (wave 7 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-topup-edits");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Edit", lastName: "Me", dob: "1980-01-01", sex: "U" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("patients-update mutates name + sex; patients-detail aggregates the chart", async () => {
    const upd = await lensRun("healthcare", "patients-update", { params: { id: patientId, lastName: "Updated", sex: "F", phone: "555-0100" } }, ctx);
    assert.equal(upd.result.patient.lastName, "Updated");
    assert.equal(upd.result.patient.sex, "F");
    assert.equal(upd.result.patient.phone, "555-0100");
    // add a problem then confirm detail rolls it up
    await lensRun("healthcare", "problems-add", { params: { patientId, name: "Asthma", icd10: "J45.909" } }, ctx);
    const detail = await lensRun("healthcare", "patients-detail", { params: { id: patientId } }, ctx);
    assert.equal(detail.result.patient.id, patientId);
    assert.ok(detail.result.problems.some((p) => p.icd10 === "J45.909"));
  });

  it("patients-update on a non-existent id is rejected", async () => {
    const bad = await lensRun("healthcare", "patients-update", { params: { id: "pat-does-not-exist", lastName: "Ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /patient not found/);
  });

  it("problems-update to 'resolved' stamps resolvedDate; reverting clears it", async () => {
    const add = await lensRun("healthcare", "problems-add", { params: { patientId, name: "Sinusitis", icd10: "J01.90" } }, ctx);
    const probId = add.result.problem.id;
    assert.equal(add.result.problem.resolvedDate, null);
    const resolved = await lensRun("healthcare", "problems-update", { params: { id: probId, status: "resolved" } }, ctx);
    assert.equal(resolved.result.problem.status, "resolved");
    assert.match(resolved.result.problem.resolvedDate, /^\d{4}-\d{2}-\d{2}$/);
    const reactivated = await lensRun("healthcare", "problems-update", { params: { id: probId, status: "active" } }, ctx);
    assert.equal(reactivated.result.problem.status, "active");
    assert.equal(reactivated.result.problem.resolvedDate, null);
  });

  it("vitals-record → vitals-list reads it back newest-first", async () => {
    await lensRun("healthcare", "vitals-record", { params: { patientId, systolic: 120, diastolic: 80, recordedAt: "2026-01-01T08:00:00Z" } }, ctx);
    const second = await lensRun("healthcare", "vitals-record", { params: { patientId, systolic: 118, diastolic: 76, recordedAt: "2026-06-01T08:00:00Z" } }, ctx);
    const list = await lensRun("healthcare", "vitals-list", { params: { patientId } }, ctx);
    assert.ok(list.result.vitals.some((v) => v.id === second.result.vitals.id));
    // sorted by recordedAt desc → the June reading is first
    assert.equal(list.result.vitals[0].recordedAt, "2026-06-01T08:00:00Z");
  });
});

describe("healthcare — messaging & care team (wave 7 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-topup-msg");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Msg", lastName: "Patient" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("messages-send → messages-list → messages-mark-read round-trip", async () => {
    const send = await lensRun("healthcare", "messages-send", { params: { patientId, body: "Your results are in.", subject: "Lab results", direction: "to_patient" } }, ctx);
    const msgId = send.result.message.id;
    assert.match(send.result.message.number, /^MSG-\d{5}$/);
    assert.equal(send.result.message.readAt, null);
    const list = await lensRun("healthcare", "messages-list", { params: { patientId } }, ctx);
    assert.ok(list.result.messages.some((m) => m.id === msgId));
    const read = await lensRun("healthcare", "messages-mark-read", { params: { id: msgId } }, ctx);
    assert.ok(read.result.message.readAt, "readAt stamped on mark-read");
  });

  it("messages-send without a body is rejected", async () => {
    const bad = await lensRun("healthcare", "messages-send", { params: { patientId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /patientId \+ body required/);
  });

  it("care-team-assign → care-team-list → care-team-remove round-trip", async () => {
    const assign = await lensRun("healthcare", "care-team-assign", { params: { patientId, providerName: "Dr. Cuddy", role: "pcp", specialty: "Internal Medicine" } }, ctx);
    const memberId = assign.result.member.id;
    assert.equal(assign.result.member.role, "pcp");
    const list = await lensRun("healthcare", "care-team-list", { params: { patientId } }, ctx);
    assert.ok(list.result.careTeam.some((m) => m.id === memberId));
    const rem = await lensRun("healthcare", "care-team-remove", { params: { id: memberId } }, ctx);
    assert.equal(rem.result.removed, memberId);
    const after = await lensRun("healthcare", "care-team-list", { params: { patientId } }, ctx);
    assert.ok(!after.result.careTeam.some((m) => m.id === memberId));
  });

  it("care-team-assign onto an unknown patient is rejected", async () => {
    const bad = await lensRun("healthcare", "care-team-assign", { params: { patientId: "pat-nope", providerName: "Dr. X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /patient not found/);
  });
});

describe("healthcare — claims, proxy, dashboard & AVS (wave 7 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-topup-claims");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Claim", lastName: "Patient", dob: "1970-03-04" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("claim-list sums outstandingUsd over draft/submitted/denied claims", async () => {
    // a draft claim (charge 90) counts toward outstanding; an unrelated patient's claim does not
    await lensRun("healthcare", "claim-create", { params: { patientId, lines: [{ cpt: "99214", chargeUsd: 90, units: 1 }] } }, ctx);
    const list = await lensRun("healthcare", "claim-list", { params: { patientId, status: "all" } }, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.outstandingUsd, 90); // single draft claim, 90*1
  });

  it("claim-adjudicate with paidUsd 0 → status 'denied' + full patient responsibility", async () => {
    const c = await lensRun("healthcare", "claim-create", { params: { patientId, lines: [{ cpt: "99213", chargeUsd: 100, units: 1 }] } }, ctx);
    const claimId = c.result.claim.id;
    await lensRun("healthcare", "claim-submit", { params: { id: claimId } }, ctx);
    const adj = await lensRun("healthcare", "claim-adjudicate", { params: { id: claimId, allowedUsd: 80, paidUsd: 0, denialReason: "non-covered" } }, ctx);
    assert.equal(adj.result.claim.status, "denied");                 // paid <= 0
    assert.equal(adj.result.claim.patientResponsibilityUsd, 80);     // allowed - paid
    assert.equal(adj.result.claim.denialReason, "non-covered");
  });

  it("claim-adjudicate rejects paidUsd > allowedUsd", async () => {
    const c = await lensRun("healthcare", "claim-create", { params: { patientId, lines: [{ cpt: "99212", chargeUsd: 60, units: 1 }] } }, ctx);
    await lensRun("healthcare", "claim-submit", { params: { id: c.result.claim.id } }, ctx);
    const bad = await lensRun("healthcare", "claim-adjudicate", { params: { id: c.result.claim.id, allowedUsd: 50, paidUsd: 70 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /paidUsd cannot exceed allowedUsd/);
  });

  it("proxy-grant → proxy-list (activeCount) → proxy-revoke; re-revoke rejected", async () => {
    const grant = await lensRun("healthcare", "proxy-grant", { params: { patientId, proxyName: "Jane Doe", relationship: "spouse", accessLevel: "full" } }, ctx);
    const grantId = grant.result.grant.id;
    assert.equal(grant.result.grant.accessLevel, "full");
    assert.equal(grant.result.grant.relationship, "spouse");
    const list = await lensRun("healthcare", "proxy-list", { params: { patientId } }, ctx);
    assert.equal(list.result.activeCount, 1);
    assert.ok(list.result.grants.some((g) => g.id === grantId));
    const rev = await lensRun("healthcare", "proxy-revoke", { params: { id: grantId } }, ctx);
    assert.equal(rev.result.grant.status, "revoked");
    assert.ok(rev.result.grant.revokedAt);
    const again = await lensRun("healthcare", "proxy-revoke", { params: { id: grantId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already revoked/);
  });

  it("dashboard-summary counts unsigned notes, pending refills, critical labs & active problems", async () => {
    // open (unsigned) encounter
    await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "f/u" } }, ctx);
    // pending refill request
    await lensRun("healthcare", "refills-request", { params: { patientId, medication: "Lisinopril 10mg" } }, ctx);
    // a critical lab
    await lensRun("healthcare", "labs-record", { params: { patientId, test: "glucose", value: 420 } }, ctx);
    // active problem
    await lensRun("healthcare", "problems-add", { params: { patientId, name: "Hypertension", icd10: "I10", status: "active" } }, ctx);
    const d = await lensRun("healthcare", "dashboard-summary", {}, ctx);
    assert.ok(d.result.unsignedNotes >= 1, "the open encounter is counted unsigned");
    assert.ok(d.result.pendingRefills >= 1, "the requested refill is pending");
    assert.ok(d.result.criticalLabs >= 1, "glucose 420 is a critical lab");
    assert.ok(d.result.activeProblems >= 1, "the active hypertension problem is counted");
    assert.equal(d.result.patientCount, 1);
  });

  it("visit-summary composes the after-visit summary text from a signed encounter", async () => {
    const enc = await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "annual physical", assessment: "Healthy adult", plan: "Routine screening" } }, ctx);
    const encId = enc.result.encounter.id;
    await lensRun("healthcare", "encounters-sign", { params: { id: encId } }, ctx);
    const avs = await lensRun("healthcare", "visit-summary", { params: { encounterId: encId } }, ctx);
    assert.equal(avs.result.summary.signed, true);
    assert.equal(avs.result.summary.chiefComplaint, "annual physical");
    assert.ok(avs.result.text.includes("AFTER-VISIT SUMMARY"));
    assert.ok(avs.result.text.includes("Healthy adult"));   // assessment line
    assert.ok(avs.result.text.includes("Routine screening")); // plan line
  });

  it("provider-slots with no scheduling feed returns empty + a wiring note", async () => {
    const r = await lensRun("healthcare", "provider-slots", { params: { providerId: "npi_unwired" } }, ctx);
    assert.deepEqual(r.result.slots, []);
    assert.equal(r.result.source, "empty");
    assert.ok(r.result.notes.includes("FHIR R4 Slot"));
  });
});

// ────────────────────────────────────────────────────────────────────
// Wave 8 top-up — remaining UNCOVERED deterministic macros not yet
// reached by waves above: record-get (empty-record default), medications-
// delete (round-trip + not-found), encounters-list (patient filter +
// newest-first sort), encounters-save-soap (mutate-while-open + signed
// lock), smartphrases-list (canonical seed) + smartphrases-delete,
// coverage-list (patient filter + required-param), telehealth-list +
// telehealth-update-status (status state machine + validation). Skipped
// (network/LLM/integration, per the earlier header notes): fhir-export,
// telehealth-CREATE (WebRTC), providers-search / icd10-search /
// rx-price-compare (HTTP), appointment-charge-copay (Stripe), ai-scribe /
// ai-chart-search / soapAutoFill / generateSummary / symptom-triage (LLM).
// ────────────────────────────────────────────────────────────────────

describe("healthcare — record-get & medication delete (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-w8-record"); });

  it("record-get on a fresh user returns the empty-record default (no auto-seeded demo data)", async () => {
    const r = await lensRun("healthcare", "record-get", {}, ctx);
    assert.equal(r.result.source, "empty");
    assert.deepEqual(r.result.vitals, []);
    assert.deepEqual(r.result.allergies, []);
    assert.deepEqual(r.result.immunizations, []);
    assert.deepEqual(r.result.conditions, []);
    assert.ok(r.result.notes.includes("No health record on file"));
  });

  it("medications-add → medications-delete removes it; re-delete is rejected", async () => {
    const add = await lensRun("healthcare", "medications-add", { params: { name: "Sertraline", dose: "50mg" } }, ctx);
    const medId = add.result.medication.id;
    let list = await lensRun("healthcare", "medications-list", {}, ctx);
    assert.ok(list.result.medications.some((m) => m.id === medId));
    const del = await lensRun("healthcare", "medications-delete", { params: { id: medId } }, ctx);
    assert.equal(del.result.deleted, true);
    assert.equal(del.result.id, medId);
    list = await lensRun("healthcare", "medications-list", {}, ctx);
    assert.ok(!list.result.medications.some((m) => m.id === medId));
    const again = await lensRun("healthcare", "medications-delete", { params: { id: medId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /med not found/);
  });
});

describe("healthcare — encounter list/SOAP edits (wave 8 top-up)", () => {
  let ctx, patientId;
  before(async () => {
    ctx = await depthCtx("healthcare-w8-enc");
    const p = await lensRun("healthcare", "patients-create", { params: { firstName: "Enc", lastName: "Patient" } }, ctx);
    patientId = p.result.patient.id;
  });

  it("encounters-list filters by patientId and sorts newest-first by encounteredAt", async () => {
    const older = await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "old", encounteredAt: "2026-01-01T08:00:00Z" } }, ctx);
    const newer = await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "new", encounteredAt: "2026-06-01T08:00:00Z" } }, ctx);
    // an unrelated patient's encounter must not leak into this patient's filtered list
    const other = await lensRun("healthcare", "patients-create", { params: { firstName: "Other", lastName: "Body" } }, ctx);
    await lensRun("healthcare", "encounters-create", { params: { patientId: other.result.patient.id, chiefComplaint: "elsewhere" } }, ctx);
    const list = await lensRun("healthcare", "encounters-list", { params: { patientId } }, ctx);
    assert.ok(list.result.encounters.every((e) => e.patientId === patientId));
    assert.equal(list.result.encounters[0].id, newer.result.encounter.id); // June first (desc sort)
    assert.ok(list.result.encounters.some((e) => e.id === older.result.encounter.id));
  });

  it("encounters-save-soap mutates an open note; signing then locks further saves", async () => {
    const enc = await lensRun("healthcare", "encounters-create", { params: { patientId, chiefComplaint: "headache" } }, ctx);
    const encId = enc.result.encounter.id;
    const saved = await lensRun("healthcare", "encounters-save-soap", { params: { id: encId, assessment: "Tension HA", plan: "Hydrate + rest", subjective: "throbbing" } }, ctx);
    assert.equal(saved.result.encounter.assessment, "Tension HA");
    assert.equal(saved.result.encounter.plan, "Hydrate + rest");
    assert.equal(saved.result.encounter.subjective, "throbbing");
    // now sign the encounter (A+P present); a further save is then rejected
    const signed = await lensRun("healthcare", "encounters-sign", { params: { id: encId } }, ctx);
    assert.equal(signed.result.encounter.status, "signed");
    const blocked = await lensRun("healthcare", "encounters-save-soap", { params: { id: encId, plan: "changed" } }, ctx);
    assert.equal(blocked.result.ok, false);
    assert.match(blocked.result.error, /encounter signed; create an amendment/);
  });

  it("encounters-save-soap on an unknown id is rejected", async () => {
    const bad = await lensRun("healthcare", "encounters-save-soap", { params: { id: "enc-nope", plan: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /encounter not found/);
  });
});

describe("healthcare — SmartPhrase seed/delete & coverage list (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-w8-sp"); });

  it("smartphrases-list seeds the canonical Epic dot-phrases on first read, then deletes one", async () => {
    const list = await lensRun("healthcare", "smartphrases-list", {}, ctx);
    const ros = list.result.smartPhrases.find((sp) => sp.name === ".ros");
    assert.ok(ros, ".ros seeded");
    assert.ok(ros.text.includes("Constitutional"));
    assert.ok(list.result.smartPhrases.some((sp) => sp.name === ".normalexam"));
    // delete the seeded .ros, confirm it's gone
    const del = await lensRun("healthcare", "smartphrases-delete", { params: { id: ros.id } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("healthcare", "smartphrases-list", {}, ctx);
    assert.ok(!after.result.smartPhrases.some((sp) => sp.id === ros.id));
  });

  it("smartphrases-delete on an unknown id is rejected", async () => {
    const bad = await lensRun("healthcare", "smartphrases-delete", { params: { id: "sp-nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /SmartPhrase not found/);
  });

  it("coverage-list filters by patientId; missing patientId is rejected", async () => {
    const pid = `pat-${randomUUID()}`;
    await lensRun("healthcare", "coverage-add", { params: { patientId: pid, payer: "Cigna", memberId: "CG1", deductibleUsd: 1000 } }, ctx);
    await lensRun("healthcare", "coverage-add", { params: { patientId: "pat-other", payer: "Humana", memberId: "HU1" } }, ctx);
    const list = await lensRun("healthcare", "coverage-list", { params: { patientId: pid } }, ctx);
    assert.equal(list.result.policies.length, 1);
    assert.equal(list.result.policies[0].payer, "Cigna");
    const bad = await lensRun("healthcare", "coverage-list", {}, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /patientId required/);
  });
});

describe("healthcare — telehealth list & status state machine (wave 8 top-up)", () => {
  let ctx, visitId;
  before(async () => {
    ctx = await depthCtx("healthcare-w8-tele");
  });

  it("telehealth-list reflects directly-seeded visits filtered by patientId, newest-first", async () => {
    // telehealth-create is the WebRTC/network path (skipped); seed the visit
    // bucket directly so we exercise the deterministic list/status macros only.
    // First call telehealth-list to trigger ensureBacklogBuckets (creates the
    // per-user telehealth Map under STATE.healthLens), then seed the bucket.
    await lensRun("healthcare", "telehealth-list", {}, ctx);
    const STATE = globalThis._concordSTATE;
    const uid = ctx.actor.userId;
    const v1 = { id: `tele_${randomUUID()}`, patientId: "pat-tele-1", status: "scheduled", scheduledAt: "2026-01-01T08:00:00Z" };
    const v2 = { id: `tele_${randomUUID()}`, patientId: "pat-tele-1", status: "scheduled", scheduledAt: "2026-06-01T08:00:00Z" };
    const vOther = { id: `tele_${randomUUID()}`, patientId: "pat-tele-2", status: "scheduled", scheduledAt: "2026-03-01T08:00:00Z" };
    STATE.healthLens.telehealth.set(uid, [v1, v2, vOther]);
    visitId = v2.id;
    const list = await lensRun("healthcare", "telehealth-list", { params: { patientId: "pat-tele-1" } }, ctx);
    assert.equal(list.result.visits.length, 2);
    assert.ok(list.result.visits.every((v) => v.patientId === "pat-tele-1"));
    assert.equal(list.result.visits[0].id, v2.id); // June first (desc by scheduledAt)
  });

  it("telehealth-update-status walks scheduled→in_progress→completed stamping timestamps", async () => {
    const inProg = await lensRun("healthcare", "telehealth-update-status", { params: { id: visitId, status: "in_progress" } }, ctx);
    assert.equal(inProg.result.visit.status, "in_progress");
    assert.ok(inProg.result.visit.startedAt, "startedAt stamped on in_progress");
    const done = await lensRun("healthcare", "telehealth-update-status", { params: { id: visitId, status: "completed" } }, ctx);
    assert.equal(done.result.visit.status, "completed");
    assert.ok(done.result.visit.endedAt, "endedAt stamped on completed");
  });

  it("telehealth-update-status rejects an invalid status and an unknown visit id", async () => {
    const badStatus = await lensRun("healthcare", "telehealth-update-status", { params: { id: visitId, status: "teleported" } }, ctx);
    assert.equal(badStatus.result.ok, false);
    assert.match(badStatus.result.error, /status must be scheduled \| in_progress \| completed \| cancelled \| no_show/);
    const badId = await lensRun("healthcare", "telehealth-update-status", { params: { id: "tele-nope", status: "completed" } }, ctx);
    assert.equal(badId.result.ok, false);
    assert.match(badId.result.error, /visit not found/);
  });
});
