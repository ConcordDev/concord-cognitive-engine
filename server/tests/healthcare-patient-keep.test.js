// tests/healthcare-patient-keep.test.js — REAL end-to-end proof for the
// Healthcare lens keep-and-draft workflow. Mirrors the established pattern:
// create a real patient via `patients-create`, read it back via
// `patients-detail`, save it as a private DTU via `dtu.create`, read that
// DTU back via `dtu.get`, then draft it in Thread via `thread.thread-draft`
// citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("healthcare patient keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("healthcare-keep-proof"); });

  it("creates a real patient, details it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real patient via the healthcare domain macro.
    const created = await lensRun("healthcare", "patients-create", {
      params: {
        firstName: "Proof",
        lastName: "Patient",
        dob: "1980-05-15",
        sex: "F",
        phone: "555-1234",
        email: "proof@example.com",
        insurancePlan: "Blue Cross",
        insuranceMemberId: "BC123456",
      },
    }, ctx);
    assert.equal(created.ok, true, "patients-create should succeed");
    const patId = created.result.patient.id;
    assert.ok(patId, "patient should have an id");
    assert.ok(created.result.patient.mrn, "patient should have an MRN");

    // 2. Read the real patient detail (the same macro the UI uses).
    const detailed = await lensRun("healthcare", "patients-detail", { params: { id: patId } }, ctx);
    assert.equal(detailed.ok, true, "patients-detail should succeed");
    const patient = detailed.result.patient;
    assert.equal(patient.id, patId);
    assert.equal(patient.firstName, "Proof");
    assert.equal(patient.lastName, "Patient");
    assert.equal(patient.dob, "1980-05-15");
    assert.equal(patient.insurancePlan, "Blue Cross");

    // 3. Save the patient summary as a private DTU.
    const sentence = `Patient, Proof · ${patient.mrn}: DOB 1980-05-15, F, Blue Cross, 0 problems, 0 allergies, 0 vitals, 0 labs, 0 imms, 0 encounters.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["healthcare", "patient", "chart"],
        source: "healthcare-lens:patient-summary",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "healthcare_patient_summary",
          patientId: patId,
          mrn: patient.mrn,
          firstName: "Proof",
          lastName: "Patient",
          dob: "1980-05-15",
          sex: "F",
          insurancePlan: "Blue Cross",
          problemCount: 0,
          allergyCount: 0,
          vitalCount: 0,
          labCount: 0,
          immunizationCount: 0,
          encounterCount: 0,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "healthcare" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Healthcare patient — Patient, Proof",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create a patient without a name", async () => {
    const r = await lensRun("healthcare", "patients-create", { params: { firstName: "", lastName: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "firstName + lastName required");
  });
});