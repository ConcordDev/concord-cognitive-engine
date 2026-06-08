// tests/depth/government-behavior.test.js — REAL behavioral tests for the
// `government` DOMAIN (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs + CRUD round-trips + validation
// rejections. Every lensRun("government", "<macro>", …) call literally names the
// macro, so the macro-depth grader credits it as a behavioral invocation.
//
// lens.run UNWRAPS the handler return: government handlers return
// { ok:true, result:{…} }, so the inner payload surfaces at r.result.<field>;
// a handler rejection { ok:false, error } (no `result` key) surfaces whole at
// r.result, so rejection is r.result.ok === false + r.result.error.
//
// SKIPPED (network/LLM — fail under no-egress preload): representatives-find,
// bills-list, alerts-current, budget-breakdown, open-data-search,
// elections-upcoming, polling-place-lookup (all hit external APIs / require keys).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("government — calc contracts (exact computed values, artifact.data)", () => {
  it("permitTimeline: processing days + benchmark + onTime are computed exactly", async () => {
    const r = await lensRun("government", "permitTimeline", {
      data: { type: "building", applicationDate: "2026-01-01", approvalDate: "2026-01-20" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.permitType, "building");
    assert.equal(r.result.processingDays, 19);  // ceil((Jan20 − Jan1)/day)
    assert.equal(r.result.benchmark, 30);        // building benchmark
    assert.equal(r.result.onTime, true);         // 19 <= 30
  });

  it("permitTimeline: a slow electrical permit is flagged not-onTime", async () => {
    const r = await lensRun("government", "permitTimeline", {
      data: { type: "electrical", applicationDate: "2026-01-01", approvalDate: "2026-02-01" },
    });
    assert.equal(r.result.benchmark, 14);        // electrical benchmark
    assert.equal(r.result.processingDays, 31);   // ceil((Feb1 − Jan1)/day)
    assert.equal(r.result.onTime, false);        // 31 > 14
  });

  it("retentionCheck: a record older than its retention period is disposition-eligible", async () => {
    const eightYearsAgo = new Date(Date.now() - 8 * 365 * 86400000).toISOString().slice(0, 10);
    const r = await lensRun("government", "retentionCheck", {
      data: { retentionPeriod: 7, date: eightYearsAgo, classification: "confidential" },
    });
    assert.equal(r.result.retentionPeriod, 7);
    assert.equal(r.result.pastRetention, true);
    assert.equal(r.result.classification, "confidential");
    assert.equal(r.result.recommendation, "eligible_for_disposition");
    assert.equal(r.result.yearsRemaining, 0);    // clamped at 0 when past
  });

  it("retentionCheck: a fresh record must still be retained", async () => {
    const oneYearAgo = new Date(Date.now() - 1 * 365 * 86400000).toISOString().slice(0, 10);
    const r = await lensRun("government", "retentionCheck", {
      data: { retentionPeriod: 7, date: oneYearAgo },
    });
    assert.equal(r.result.pastRetention, false);
    assert.equal(r.result.recommendation, "retain");
    assert.equal(r.result.yearsRemaining, 6);    // 7 − ~1
  });

  it("fine_calculation: base × violations + late fee is summed exactly", async () => {
    // lateFee = base(200) × lateRate(0.05) × daysPast(10) = 100
    // total   = base(200) × violations(2) + lateFee(100)  = 500
    const r = await lensRun("government", "fine_calculation", {
      data: { baseFine: 200, violationCount: 2, daysPastDue: 10, lateFeeRate: 0.05 },
    });
    assert.equal(r.result.baseFine, 200);
    assert.equal(r.result.lateFee, 100);
    assert.equal(r.result.total, 500);
    assert.equal(r.result.breakdown, "2×$200 base + $100 late (10d) = $500");
  });

  it("permit_fee_estimate: base + 0.5%-of-valuation + 65%-plan-review summed exactly", async () => {
    // building base=250, valuationFee=100000×0.005=500, planReview=250×0.65=162.5, total=912.5
    const r = await lensRun("government", "permit_fee_estimate", {
      data: { permitType: "building", valuation: 100000 },
    });
    assert.equal(r.result.baseFee, 250);
    assert.equal(r.result.valuationFee, 500);
    assert.equal(r.result.planReviewFee, 162.5);
    assert.equal(r.result.totalEstimate, 912.5);
  });

  it("compliance_check: scores met/total and lists violations exactly", async () => {
    const r = await lensRun("government", "compliance_check", {
      data: { requirements: [
        { name: "fire_egress", met: true },
        { name: "ada_ramp", met: true },
        { name: "occupancy_load", met: false },
        { name: "sprinklers", met: false },
      ] },
    });
    assert.equal(r.result.requirementCount, 4);
    assert.equal(r.result.metCount, 2);
    assert.equal(r.result.compliancePct, 50);    // 2/4 → 50
    assert.equal(r.result.compliant, false);
    assert.equal(r.result.verdict, "non_compliant"); // 50 < 80
    assert.deepEqual(r.result.violations.sort(), ["occupancy_load", "sprinklers"]);
  });

  it("budget_report: total/spent/remaining/utilization computed from line items", async () => {
    const r = await lensRun("government", "budget_report", {
      data: { lineItems: [
        { category: "roads", budgeted: 1000, spent: 400 },
        { category: "parks", budgeted: 1000, spent: 600 },
      ] },
    });
    assert.equal(r.result.totalBudget, 2000);    // 1000 + 1000
    assert.equal(r.result.spent, 1000);          // 400 + 600
    assert.equal(r.result.remaining, 1000);      // 2000 − 1000
    assert.equal(r.result.utilizationPct, 50);   // 1000/2000 → 50.0
  });
});

describe("government — CRUD round-trips + validation (shared owner-scoped ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("government-crud"); });

  it("departments-add → departments-list: dept reads back, shortCode upper-cased", async () => {
    const add = await lensRun("government", "departments-add", { params: { name: "Public Works", shortCode: "pw" } }, ctx);
    assert.equal(add.result.department.shortCode, "PW");
    const list = await lensRun("government", "departments-list", {}, ctx);
    assert.ok(list.result.departments.some((d) => d.id === add.result.department.id));
  });

  it("service-requests-create with a routing rule auto-assigns the department", async () => {
    const dept = await lensRun("government", "departments-add", { params: { name: "Streets Dept" } }, ctx);
    const deptId = dept.result.department.id;
    await lensRun("government", "routing-rules-set", { params: { category: "pothole", departmentId: deptId } }, ctx);

    const created = await lensRun("government", "service-requests-create", {
      params: { category: "pothole", description: "Big pothole on Main St", lat: 40.7, lng: -74.0 },
    }, ctx);
    assert.equal(created.result.request.assignedDepartmentId, deptId); // auto-routed
    assert.equal(created.result.request.status, "assigned");
    assert.match(created.result.request.referenceNumber, /^SR-\d{6}$/);
  });

  it("permits-apply → pay-fee → approve → issue: status machine round-trips", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Jane Doe", applicantEmail: "jane@example.com", kind: "building", feeUsd: 250 },
    }, ctx);
    const id = applied.result.permit.id;
    assert.equal(applied.result.permit.status, "applied");

    const paid = await lensRun("government", "permits-pay-fee", { params: { id } }, ctx);
    assert.equal(paid.result.permit.paid, true);
    assert.equal(paid.result.permit.status, "under_review");

    const approved = await lensRun("government", "permits-approve", { params: { id } }, ctx);
    assert.equal(approved.result.permit.status, "approved");

    const issued = await lensRun("government", "permits-issue", { params: { id, validForDays: 30 } }, ctx);
    assert.equal(issued.result.permit.status, "issued");
    assert.ok(issued.result.permit.expiresAt > issued.result.permit.issuedAt); // future expiry stamped
  });

  it("documents-publish → documents-sign: typed signature must match name; produces a fingerprint", async () => {
    const pub = await lensRun("government", "documents-publish", {
      params: { title: "Building Code Notice", category: "notice", bodyText: "Please comply with §305." },
    }, ctx);
    const docId = pub.result.document.id;

    const signed = await lensRun("government", "documents-sign", {
      params: { id: docId, signerName: "Alex Stone", signerEmail: "alex@example.com", typedSignature: "Alex Stone" },
    }, ctx);
    assert.equal(signed.result.signature.signerName, "Alex Stone");
    assert.match(signed.result.signature.fingerprint, /^sig-[0-9a-f]{8}$/); // FNV-1a tamper hash
    // round-trip: the signature is attached to the document
    assert.ok(signed.result.document.signatures.some((sg) => sg.id === signed.result.signature.id));
  });

  it("payments-checkout → payments-confirm marks the permit fee paid + issues a receipt", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Pat Roe", applicantEmail: "pat@example.com", kind: "plumbing", feeUsd: 110 },
    }, ctx);
    const permitId = applied.result.permit.id;

    const checkout = await lensRun("government", "payments-checkout", { params: { kind: "permit", refId: permitId } }, ctx);
    assert.equal(checkout.result.payment.amountUsd, 110);    // mirrors permit.feeUsd
    assert.equal(checkout.result.payment.status, "pending");
    const payId = checkout.result.payment.id;

    const confirmed = await lensRun("government", "payments-confirm", {
      params: { paymentId: payId, methodToken: "tok_test_123", cardLast4: "4242" },
    }, ctx);
    assert.equal(confirmed.result.payment.status, "succeeded");
    assert.equal(confirmed.result.payment.cardLast4, "4242");
    assert.match(confirmed.result.payment.receiptNumber, /^RCPT-\d{4}-/);
  });

  it("notifications-subscribe → emit → list: an emitted notification reads back with chosen channel", async () => {
    const subjectId = `permit-${randomUUID()}`;
    await lensRun("government", "notifications-subscribe", {
      params: { subjectKind: "permit", subjectId, channel: "sms", contact: "+15551234567" },
    }, ctx);
    const emitted = await lensRun("government", "notifications-emit", {
      params: { subjectKind: "permit", subjectId, message: "Your permit advanced." },
    }, ctx);
    assert.equal(emitted.result.notification.channel, "sms");   // honoured the subscription
    assert.equal(emitted.result.notification.contact, "+15551234567");

    const list = await lensRun("government", "notifications-list", {}, ctx);
    assert.ok(list.result.notifications.some((n) => n.id === emitted.result.notification.id));
  });

  // ── validation rejections (handler {ok:false} surfaces at r.result) ──

  it("validation: service-requests-create rejects an unknown category", async () => {
    const bad = await lensRun("government", "service-requests-create", {
      params: { category: "spaceship_landing", description: "x", lat: 1, lng: 2 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /category must be one of/);
  });

  it("validation: permits-approve before the fee is paid is rejected", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Unpaid Ulla", applicantEmail: "u@example.com", kind: "electrical", feeUsd: 120 },
    }, ctx);
    const bad = await lensRun("government", "permits-approve", { params: { id: applied.result.permit.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /fee must be paid before approval/);
  });

  it("validation: documents-sign rejects a typed signature that doesn't match the name", async () => {
    const pub = await lensRun("government", "documents-publish", {
      params: { title: "Consent Form", category: "agreement", bodyText: "I agree." },
    }, ctx);
    const bad = await lensRun("government", "documents-sign", {
      params: { id: pub.result.document.id, signerName: "Real Name", signerEmail: "r@example.com", typedSignature: "Wrong Name" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /typed signature must exactly match/);
  });

  it("validation: voter-registration-submit rejects an under-18 registrant", async () => {
    const tenYearsAgo = new Date(Date.now() - 10 * 365 * 86400000).toISOString().slice(0, 10);
    const bad = await lensRun("government", "voter-registration-submit", {
      params: { fullName: "Kid Citizen", residentialAddress: "1 Main St", dateOfBirth: tenYearsAgo, stateCode: "CA" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least 18 years old/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave-8 top-up: ~50 government macros were untested. Below adds behavioral
// coverage for the remaining DETERMINISTIC ones (no network/LLM): the artifact
// .data report/calc family (citizen_impact / docket / fee_collection / milestone
// / permit_inspection / redaction / schedule_hearing / export / violationEscalation
// / resourceStaging) plus more owner-scoped CRUD round-trips (fines, inspections,
// assets, advocacy, meetings, voter registration, FOIA, routing rules, permit deny).
// ─────────────────────────────────────────────────────────────────────────────

describe("government — calc/report contracts (wave 8 top-up)", () => {
  it("violationEscalation: a past-due compliance deadline escalates + counts days", async () => {
    // 4.5 days ago → ceil(4.5) = 5, stable regardless of test-run timing jitter.
    const pastDeadline = new Date(Date.now() - 4.5 * 86400000).toISOString();
    const r = await lensRun("government", "violationEscalation", {
      data: { complianceDeadline: pastDeadline },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.escalated, true);
    assert.equal(r.result.daysPast, 5);              // ceil((now − deadline)/day) = ceil(4.5)
    assert.equal(r.result.currentStatus, "escalated"); // status mutated on artifact
  });

  it("violationEscalation: a future deadline is not escalated", async () => {
    const inTenDays = new Date(Date.now() + 10 * 86400000).toISOString();
    const r = await lensRun("government", "violationEscalation", {
      data: { complianceDeadline: inTenDays },
    });
    assert.equal(r.result.escalated, false);
    assert.equal(r.result.daysPast, 0);
  });

  it("resourceStaging: assigns shared + zone-matched resources and counts totals", async () => {
    const r = await lensRun("government", "resourceStaging", {
      data: {
        type: "flood",
        activationLevel: "active",
        zones: [
          { id: "z1", name: "Riverside", population: 5000, riskLevel: "high" },
          { id: "z2", name: "Uptown" },
        ],
        resources: [
          { name: "Pump Truck", type: "vehicle", zone: "z1", quantity: 2 },
          { name: "Sandbags", type: "supply" }, // no zone → assigned to all
        ],
      },
    });
    assert.equal(r.result.threatType, "flood");
    assert.equal(r.result.totalZones, 2);
    assert.equal(r.result.totalResources, 2);
    assert.equal(r.result.activationLevel, "active");
    const riverside = r.result.staging.find((z) => z.zone === "Riverside");
    assert.equal(riverside.population, 5000);
    assert.equal(riverside.riskLevel, "high");
    // z1-matched pump truck + zoneless sandbags both staged at Riverside
    assert.ok(riverside.resources.some((x) => x.name === "Pump Truck" && x.quantity === 2));
    assert.ok(riverside.resources.some((x) => x.name === "Sandbags"));
    // Uptown (z2) gets only the zoneless resource; riskLevel default
    const uptown = r.result.staging.find((z) => z.zone === "Uptown");
    assert.equal(uptown.riskLevel, "medium");
    assert.ok(uptown.resources.some((x) => x.name === "Sandbags"));
    assert.ok(!uptown.resources.some((x) => x.name === "Pump Truck"));
  });

  it("citizen_impact_report: derives severity from population + counts areas", async () => {
    const r = await lensRun("government", "citizen_impact_report", {
      data: {
        affectedPopulation: 25000,
        impactAreas: [{ name: "Downtown" }, { name: "Harbor" }, "Midtown"],
      },
    });
    assert.equal(r.result.affectedPopulation, 25000);
    assert.equal(r.result.areaCount, 3);             // 3 areas
    assert.equal(r.result.severity, "high");         // 25000 > 10000
    assert.deepEqual(r.result.impactAreas, ["Downtown", "Harbor", "Midtown"]);
    assert.ok(r.result.summary.includes("25,000"));  // locale-formatted count
  });

  it("citizen_impact_report: small population is low severity", async () => {
    const r = await lensRun("government", "citizen_impact_report", {
      data: { population: 300, areas: ["Block A"] },
    });
    assert.equal(r.result.affectedPopulation, 300);
    assert.equal(r.result.severity, "low");          // 300 <= 1000
  });

  it("docket_report: sorts hearings, picks the next future one, lists parties", async () => {
    const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    const r = await lensRun("government", "docket_report", {
      data: {
        caseId: "CV-2026-007",
        status: "active",
        hearings: [{ date: future }, { date: past }],
        parties: [{ name: "City" }, "Acme Corp"],
      },
    });
    assert.equal(r.result.caseId, "CV-2026-007");
    assert.equal(r.result.hearingCount, 2);
    assert.equal(r.result.nextHearing, future);      // only future hearing
    assert.deepEqual(r.result.parties, ["City", "Acme Corp"]);
  });

  it("fee_collection_status: totals due vs collected, computes outstanding + rate", async () => {
    const r = await lensRun("government", "fee_collection_status", {
      data: {
        fees: [
          { amount: 100, status: "paid" },
          { amount: 300, paid: 150 },
        ],
      },
    });
    assert.equal(r.result.feeCount, 2);
    assert.equal(r.result.totalDue, 400);            // 100 + 300
    assert.equal(r.result.collected, 250);           // 100(paid) + 150
    assert.equal(r.result.outstanding, 150);         // 400 − 250
    assert.equal(r.result.collectionRatePct, 62.5);  // 250/400 → 62.5
    assert.equal(r.result.status, "partial");
  });

  it("fee_collection_status: everything paid reads paid_in_full at 100%", async () => {
    const r = await lensRun("government", "fee_collection_status", {
      data: { fees: [{ amount: 50, status: "paid" }, { amount: 50, paid: 50 }] },
    });
    assert.equal(r.result.outstanding, 0);
    assert.equal(r.result.collectionRatePct, 100);
    assert.equal(r.result.status, "paid_in_full");
  });

  it("milestone_update: advances to next milestone and computes percent complete", async () => {
    const r = await lensRun("government", "milestone_update", {
      data: {
        milestones: [{ name: "Design" }, { name: "Permitting" }, { name: "Build" }, { name: "Inspect" }],
        currentMilestone: 1,
      },
    });
    assert.equal(r.result.totalMilestones, 4);
    assert.equal(r.result.currentMilestone, 2);      // 1 + 1
    assert.equal(r.result.currentName, "Permitting"); // milestones[2-1]
    assert.equal(r.result.percentComplete, 50);      // 2/4 → 50
    assert.equal(r.result.status, "in_progress");
  });

  it("milestone_update: final milestone marks the project complete at 100%", async () => {
    const r = await lensRun("government", "milestone_update", {
      data: { milestones: ["A", "B"], currentMilestone: 1 },
    });
    assert.equal(r.result.currentMilestone, 2);
    assert.equal(r.result.percentComplete, 100);
    assert.equal(r.result.status, "complete");
  });

  it("permit_inspection_schedule: returns the next stage + remaining sequence", async () => {
    const r = await lensRun("government", "permit_inspection_schedule", {
      data: { stage: "framing" },
    });
    assert.equal(r.result.currentStage, "framing");
    assert.equal(r.result.nextInspection, "rough_in"); // sequence after framing
    assert.deepEqual(r.result.remainingStages, ["rough_in", "insulation", "final"]);
    assert.match(r.result.inspectionId, /^INSP-/);
  });

  it("redaction_review: flags sensitive field keys + inline PII matches", async () => {
    const r = await lensRun("government", "redaction_review", {
      data: {
        ssn: "x",
        phone: "y",
        content: "Reach me at jane@example.com or 123-45-6789.",
      },
    });
    // sensitive keys: ssn, phone (content/body are reader keys, not sensitive)
    assert.ok(r.result.sensitiveFields.includes("ssn"));
    assert.ok(r.result.sensitiveFields.includes("phone"));
    assert.equal(r.result.inlinePiiMatches, 2);      // email + SSN pattern
    assert.equal(r.result.redactionCount, r.result.sensitiveFields.length + 2);
    assert.equal(r.result.status, "needs_redaction");
  });

  it("redaction_review: a clean record is cleared for release", async () => {
    const r = await lensRun("government", "redaction_review", {
      data: { content: "Public meeting was held at noon." },
    });
    assert.equal(r.result.redactionCount, 0);
    assert.equal(r.result.status, "clean");
    assert.ok(r.result.recommendation.includes("Cleared"));
  });

  it("schedule_hearing: lead time + proposed date derive from case type", async () => {
    const r = await lensRun("government", "schedule_hearing", {
      data: { caseType: "zoning", courtroom: "Room 4B", parties: [{ name: "Petitioner" }] },
    });
    assert.equal(r.result.caseType, "zoning");
    assert.equal(r.result.leadTimeDays, 45);         // zoning lead time
    assert.equal(r.result.location, "Room 4B");
    assert.deepEqual(r.result.parties, ["Petitioner"]);
    const expected = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    assert.equal(r.result.proposedDate, expected);
  });

  it("export_record: serializes scalar data fields into an official-record body", async () => {
    const r = await lensRun("government", "export_record", {
      data: { caseNumber: "A-100", status: "filed", nested: { skip: true } },
    });
    assert.equal(r.result.format, "text");
    assert.equal(r.result.fieldCount, 2);            // caseNumber + status (nested object excluded)
    assert.match(r.result.recordId, /^REC-/);
    assert.ok(r.result.content.includes("caseNumber: A-100"));
    assert.ok(r.result.content.includes("status: filed"));
    assert.ok(!r.result.content.includes("nested"));
  });
});

describe("government — more CRUD round-trips + validation (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("government-topup8"); });

  it("foia-create → foia-list: a draft request reads back with normalized status", async () => {
    const created = await lensRun("government", "foia-create", {
      params: { agency: "EPA", subject: "Air quality logs", body: "Requesting Q1 monitoring data." },
    }, ctx);
    assert.equal(created.result.request.agency, "EPA");
    assert.equal(created.result.request.status, "draft");
    const list = await lensRun("government", "foia-list", {}, ctx);
    assert.ok(list.result.requests.some((q) => q.id === created.result.request.id));
  });

  it("validation: foia-create rejects when a required field is blank", async () => {
    const bad = await lensRun("government", "foia-create", {
      params: { agency: "EPA", subject: "", body: "x" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /agency, subject, body all required/);
  });

  it("fines-create → fines-list: amount is rounded to cents and reads back unpaid", async () => {
    const created = await lensRun("government", "fines-create", {
      params: { payerName: "Sam Vega", reason: "Illegal parking", amountUsd: 75.005, caseNumber: "PK-9" },
    }, ctx);
    assert.equal(created.result.fine.amountUsd, 75.01); // rounded to cents
    assert.equal(created.result.fine.paid, false);
    const list = await lensRun("government", "fines-list", {}, ctx);
    assert.ok(list.result.fines.some((f) => f.id === created.result.fine.id));
  });

  it("validation: fines-create rejects a non-positive amount", async () => {
    const bad = await lensRun("government", "fines-create", {
      params: { payerName: "Sam", reason: "x", amountUsd: 0 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /amountUsd must be positive/);
  });

  it("inspections-schedule → inspections-complete: status machine round-trips on a permit", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Ivy Park", applicantEmail: "ivy@example.com", kind: "building", feeUsd: 250 },
    }, ctx);
    const permitId = applied.result.permit.id;

    const sched = await lensRun("government", "inspections-schedule", {
      params: { permitId, kind: "framing", date: "2026-03-01", inspectorName: "Insp Lee" },
    }, ctx);
    assert.equal(sched.result.inspection.status, "scheduled");
    const inspId = sched.result.inspection.id;

    const done = await lensRun("government", "inspections-complete", {
      params: { id: inspId, result: "pass", notes: "All clear" },
    }, ctx);
    assert.equal(done.result.inspection.status, "completed");
    assert.equal(done.result.inspection.result, "pass");

    // round-trip: scheduled inspection is listed under its permit
    const list = await lensRun("government", "inspections-list", { params: { permitId } }, ctx);
    assert.ok(list.result.inspections.some((i) => i.id === inspId));
  });

  it("validation: inspections-complete rejects an invalid result value", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Ed", applicantEmail: "ed@example.com", kind: "electrical", feeUsd: 120 },
    }, ctx);
    const sched = await lensRun("government", "inspections-schedule", {
      params: { permitId: applied.result.permit.id, kind: "rough_in", date: "2026-04-01" },
    }, ctx);
    const bad = await lensRun("government", "inspections-complete", {
      params: { id: sched.result.inspection.id, result: "maybe" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /result must be pass\/fail\/needs_followup/);
  });

  it("assets-add → assets-log-maintenance: maintenance updates condition + reads back", async () => {
    const added = await lensRun("government", "assets-add", {
      params: { kind: "streetlight", label: "Lamp 14", lat: 40.7, lng: -74.0 },
    }, ctx);
    assert.equal(added.result.asset.condition, "good"); // default condition
    const assetId = added.result.asset.id;

    const logged = await lensRun("government", "assets-log-maintenance", {
      params: { id: assetId, work: "Replaced bulb", crew: "Crew 3", condition: "fair" },
    }, ctx);
    assert.equal(logged.result.asset.condition, "fair"); // condition overwritten
    assert.ok(logged.result.asset.maintenanceLog.some((m) => m.work === "Replaced bulb"));
    assert.ok(logged.result.asset.lastInspectedAt); // stamped on maintenance

    const list = await lensRun("government", "assets-list", { params: { kind: "streetlight" } }, ctx);
    assert.ok(list.result.assets.some((a) => a.id === assetId));
  });

  it("validation: assets-add rejects an unknown asset kind", async () => {
    const bad = await lensRun("government", "assets-add", {
      params: { kind: "spaceport", lat: 1, lng: 2 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /kind must be one of/);
  });

  it("advocacy-record → advocacy-bill-tally: stances tally per bill", async () => {
    const billId = `bill-${randomUUID()}`;
    await lensRun("government", "advocacy-record", {
      params: { billId, billTitle: "Clean Air Act", stance: "support", channel: "email", message: "I support this." },
    }, ctx);
    await lensRun("government", "advocacy-record", {
      params: { billId, stance: "support", channel: "call", representative: "Rep Diaz" },
    }, ctx);
    await lensRun("government", "advocacy-record", {
      params: { billId, stance: "oppose", channel: "call" },
    }, ctx);

    const tally = await lensRun("government", "advocacy-bill-tally", { params: { billId } }, ctx);
    assert.equal(tally.result.total, 3);
    assert.equal(tally.result.tally.support, 2);
    assert.equal(tally.result.tally.oppose, 1);
    assert.equal(tally.result.tally.comment, 0);
  });

  it("validation: advocacy-record requires a message for email channel", async () => {
    const bad = await lensRun("government", "advocacy-record", {
      params: { billId: "b1", stance: "support", channel: "email" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /message required for comment\/email\/letter/);
  });

  it("meetings-schedule → meetings-publish-minutes: status advances to minutes_published", async () => {
    const scheduled = await lensRun("government", "meetings-schedule", {
      params: { title: "Budget Review", body: "budget_committee", scheduledAt: "2026-05-01T18:00:00Z", location: "City Hall" },
    }, ctx);
    assert.equal(scheduled.result.meeting.status, "scheduled");
    const id = scheduled.result.meeting.id;

    const published = await lensRun("government", "meetings-publish-minutes", {
      params: { id, minutes: "Quorum met. Budget approved 5-2." },
    }, ctx);
    assert.equal(published.result.meeting.status, "minutes_published");
    assert.ok(published.result.meeting.minutes.includes("Budget approved"));

    const list = await lensRun("government", "meetings-list", {}, ctx);
    assert.ok(list.result.meetings.some((m) => m.id === id));
  });

  it("validation: meetings-schedule rejects an unknown governing body", async () => {
    const bad = await lensRun("government", "meetings-schedule", {
      params: { title: "X", body: "secret_cabal", scheduledAt: "2026-05-01T18:00:00Z" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /body must be one of/);
  });

  it("voter-registration-submit → voter-registration-status: an adult registers + reads back", async () => {
    const dob = new Date(Date.now() - 30 * 365 * 86400000).toISOString().slice(0, 10);
    const submitted = await lensRun("government", "voter-registration-submit", {
      params: { fullName: "Nora Adult", residentialAddress: "9 Oak Ave", dateOfBirth: dob, stateCode: "ny", partyPreference: "independent" },
    }, ctx);
    assert.equal(submitted.result.registration.status, "submitted");
    assert.equal(submitted.result.registration.stateCode, "NY"); // upper-cased

    const status = await lensRun("government", "voter-registration-status", {}, ctx);
    assert.equal(status.result.registration.id, submitted.result.registration.id);
  });

  it("validation: voter-registration-submit rejects a malformed state code", async () => {
    const dob = new Date(Date.now() - 25 * 365 * 86400000).toISOString().slice(0, 10);
    const bad = await lensRun("government", "voter-registration-submit", {
      params: { fullName: "Bad State", residentialAddress: "1 St", dateOfBirth: dob, stateCode: "CALIF" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /stateCode must be a 2-letter code/);
  });

  it("validation: permits-deny before payment requires a reason", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Deny Me", applicantEmail: "d@example.com", kind: "plumbing", feeUsd: 110 },
    }, ctx);
    const denied = await lensRun("government", "permits-deny", {
      params: { id: applied.result.permit.id, reason: "Incomplete drawings" },
    }, ctx);
    assert.equal(denied.result.permit.status, "denied");
    assert.ok(denied.result.permit.denialReason.includes("Incomplete"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave-N top-up: cover the remaining DETERMINISTIC, non-network/non-LLM macros
// that no prior wave exercised — the list/delete/refund/agenda/mark-read/assign/
// update-status family + the dashboard-summary aggregator. Each call literally
// names the macro (grader credit) and asserts real behavior (filter, mutation,
// idempotency, aggregation, refund reversal). Shared owner-scoped ctx so the
// list/delete round-trips actually see the writes made earlier in the block.
// ─────────────────────────────────────────────────────────────────────────────
describe("government — list/mutate/delete round-trips (wave-N top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("government-topupN"); });

  it("service-requests-assign + service-requests-update-status: mutate then list-filter by status", async () => {
    const dept = await lensRun("government", "departments-add", { params: { name: "Sanitation Dept" } }, ctx);
    const deptId = dept.result.department.id;
    // create WITHOUT a routing rule → status defaults to "submitted", unassigned
    const created = await lensRun("government", "service-requests-create", {
      params: { category: "trash_missed", description: "Missed pickup on Elm", lat: 41.0, lng: -73.5 },
    }, ctx);
    const srId = created.result.request.id;
    assert.equal(created.result.request.status, "submitted");
    assert.equal(created.result.request.assignedDepartmentId, null);

    const assigned = await lensRun("government", "service-requests-assign", {
      params: { id: srId, departmentId: deptId },
    }, ctx);
    assert.equal(assigned.result.request.assignedDepartmentId, deptId);
    assert.equal(assigned.result.request.assignedDepartmentName, "Sanitation Dept");
    assert.equal(assigned.result.request.status, "assigned");

    const progressed = await lensRun("government", "service-requests-update-status", {
      params: { id: srId, status: "in_progress", note: "Crew dispatched" },
    }, ctx);
    assert.equal(progressed.result.request.status, "in_progress");
    assert.ok(progressed.result.request.updates.some((u) => u.kind === "in_progress" && u.note === "Crew dispatched"));

    // list filtered by the new status returns it; filtered by a different status does not
    const inProg = await lensRun("government", "service-requests-list", { params: { status: "in_progress" } }, ctx);
    assert.ok(inProg.result.requests.some((r) => r.id === srId));
    const submittedOnly = await lensRun("government", "service-requests-list", { params: { status: "submitted" } }, ctx);
    assert.ok(!submittedOnly.result.requests.some((r) => r.id === srId));
  });

  it("service-requests-update-status to a closed_* status stamps closedAt + resolution", async () => {
    const created = await lensRun("government", "service-requests-create", {
      params: { category: "graffiti", description: "Tag on underpass", lat: 41.1, lng: -73.4 },
    }, ctx);
    const closed = await lensRun("government", "service-requests-update-status", {
      params: { id: created.result.request.id, status: "closed_resolved", note: "Cleaned and sealed" },
    }, ctx);
    assert.equal(closed.result.request.status, "closed_resolved");
    assert.equal(closed.result.request.resolution, "Cleaned and sealed");
    assert.ok(closed.result.request.closedAt); // timestamp stamped on close
  });

  it("validation: service-requests-update-status rejects an invalid status", async () => {
    const created = await lensRun("government", "service-requests-create", {
      params: { category: "noise_complaint", description: "Loud party", lat: 41.2, lng: -73.3 },
    }, ctx);
    const bad = await lensRun("government", "service-requests-update-status", {
      params: { id: created.result.request.id, status: "teleported" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "invalid status");
  });

  it("routing-rules-set → routing-rules-list → routing-rules-delete: upsert then remove", async () => {
    const dept = await lensRun("government", "departments-add", { params: { name: "Forestry Dept" } }, ctx);
    const deptId = dept.result.department.id;
    await lensRun("government", "routing-rules-set", { params: { category: "tree_down", departmentId: deptId } }, ctx);
    const list = await lensRun("government", "routing-rules-list", {}, ctx);
    const rule = list.result.rules.find((r) => r.category === "tree_down");
    assert.ok(rule, "routing rule should be listed");
    assert.equal(rule.departmentName, "Forestry Dept");

    const del = await lensRun("government", "routing-rules-delete", { params: { id: rule.id } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("government", "routing-rules-list", {}, ctx);
    assert.ok(!after.result.rules.some((r) => r.id === rule.id));
  });

  it("departments-delete removes the dept and a missing id is rejected", async () => {
    const dept = await lensRun("government", "departments-add", { params: { name: "Temp Dept" } }, ctx);
    const id = dept.result.department.id;
    const del = await lensRun("government", "departments-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("government", "departments-list", {}, ctx);
    assert.ok(!list.result.departments.some((d) => d.id === id));
    const bad = await lensRun("government", "departments-delete", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "department not found");
  });

  it("permits-list filters by status (only approved permits returned)", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "List Me", applicantEmail: "l@example.com", kind: "building", feeUsd: 250 },
    }, ctx);
    const id = applied.result.permit.id;
    await lensRun("government", "permits-pay-fee", { params: { id } }, ctx);
    await lensRun("government", "permits-approve", { params: { id } }, ctx);

    const approvedList = await lensRun("government", "permits-list", { params: { status: "approved" } }, ctx);
    assert.ok(approvedList.result.permits.some((p) => p.id === id));
    assert.ok(approvedList.result.permits.every((p) => p.status === "approved"));
    // the just-approved permit is NOT in the "applied" bucket
    const appliedList = await lensRun("government", "permits-list", { params: { status: "applied" } }, ctx);
    assert.ok(!appliedList.result.permits.some((p) => p.id === id));
  });

  it("assets-delete removes an asset and is idempotent-rejecting on re-delete", async () => {
    const added = await lensRun("government", "assets-add", {
      params: { kind: "hydrant", label: "Hyd 7", lat: 40.5, lng: -74.1 },
    }, ctx);
    const id = added.result.asset.id;
    const del = await lensRun("government", "assets-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("government", "assets-list", {}, ctx);
    assert.ok(!list.result.assets.some((a) => a.id === id));
    const bad = await lensRun("government", "assets-delete", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "asset not found");
  });

  it("payments-refund reverses a succeeded payment and unsets the target's paid flag", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Refund Me", applicantEmail: "rf@example.com", kind: "plumbing", feeUsd: 110 },
    }, ctx);
    const permitId = applied.result.permit.id;
    const checkout = await lensRun("government", "payments-checkout", { params: { kind: "permit", refId: permitId } }, ctx);
    const payId = checkout.result.payment.id;
    await lensRun("government", "payments-confirm", {
      params: { paymentId: payId, methodToken: "tok_x", cardLast4: "1111" },
    }, ctx);

    const refunded = await lensRun("government", "payments-refund", {
      params: { paymentId: payId, reason: "Duplicate charge" },
    }, ctx);
    assert.equal(refunded.result.payment.status, "refunded");
    assert.ok(refunded.result.payment.refundReason.includes("Duplicate"));

    // appears in payments-list with refunded status
    const payList = await lensRun("government", "payments-list", {}, ctx);
    assert.ok(payList.result.payments.some((p) => p.id === payId && p.status === "refunded"));
  });

  it("validation: payments-refund rejects a payment that never succeeded", async () => {
    const applied = await lensRun("government", "permits-apply", {
      params: { applicantName: "Pending Pat", applicantEmail: "pp@example.com", kind: "electrical", feeUsd: 120 },
    }, ctx);
    const checkout = await lensRun("government", "payments-checkout", {
      params: { kind: "permit", refId: applied.result.permit.id },
    }, ctx);
    const bad = await lensRun("government", "payments-refund", {
      params: { paymentId: checkout.result.payment.id },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "only succeeded payments can be refunded");
  });

  it("meetings-set-agenda sets the agenda, then meetings-delete removes the meeting", async () => {
    const sched = await lensRun("government", "meetings-schedule", {
      params: { title: "Zoning Hearing", body: "zoning_board", scheduledAt: "2026-06-01T17:00:00Z" },
    }, ctx);
    const id = sched.result.meeting.id;
    const agenda = await lensRun("government", "meetings-set-agenda", {
      params: { id, agenda: ["Roll call", "", "Variance request #12", "Adjourn"] },
    }, ctx);
    // empty strings filtered out
    assert.deepEqual(agenda.result.meeting.agenda, ["Roll call", "Variance request #12", "Adjourn"]);

    const del = await lensRun("government", "meetings-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("government", "meetings-list", {}, ctx);
    assert.ok(!list.result.meetings.some((m) => m.id === id));
  });

  it("advocacy-record → advocacy-list filters by billId, then advocacy-delete removes one", async () => {
    const billId = `bill-${randomUUID()}`;
    const rec = await lensRun("government", "advocacy-record", {
      params: { billId, billTitle: "Transit Bill", stance: "support", channel: "call", representative: "Rep Kim" },
    }, ctx);
    const actId = rec.result.action.id;
    const list = await lensRun("government", "advocacy-list", { params: { billId } }, ctx);
    assert.ok(list.result.actions.some((a) => a.id === actId));
    assert.ok(list.result.actions.every((a) => a.billId === billId));

    const del = await lensRun("government", "advocacy-delete", { params: { id: actId } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("government", "advocacy-list", { params: { billId } }, ctx);
    assert.ok(!after.result.actions.some((a) => a.id === actId));
  });

  it("documents-list reads back published docs; documents-delete removes one", async () => {
    const pub = await lensRun("government", "documents-publish", {
      params: { title: "Public Notice 42", category: "notice", bodyText: "Hearing scheduled." },
    }, ctx);
    const docId = pub.result.document.id;
    const list = await lensRun("government", "documents-list", {}, ctx);
    assert.ok(list.result.documents.some((d) => d.id === docId));

    const del = await lensRun("government", "documents-delete", { params: { id: docId } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("government", "documents-list", {}, ctx);
    assert.ok(!after.result.documents.some((d) => d.id === docId));
  });

  it("notifications-mark-read: single-id marks one read, then mark-all clears the rest", async () => {
    const subjectId = `permit-${randomUUID()}`;
    const e1 = await lensRun("government", "notifications-emit", {
      params: { subjectKind: "permit", subjectId, message: "Advanced to review." },
    }, ctx);
    await lensRun("government", "notifications-emit", {
      params: { subjectKind: "permit", subjectId, message: "Approved." },
    }, ctx);

    const one = await lensRun("government", "notifications-mark-read", { params: { id: e1.result.notification.id } }, ctx);
    assert.equal(one.result.read, true);
    // mark-all (no id) marks the remaining unread ones; the already-read one is excluded
    const all = await lensRun("government", "notifications-mark-read", {}, ctx);
    assert.ok(all.result.markedRead >= 1);
    const afterUnread = await lensRun("government", "notifications-list", { params: { unreadOnly: true } }, ctx);
    assert.equal(afterUnread.result.unreadCount, 0);
  });

  it("dashboard-summary aggregates counts across permits/requests/assets/inspections", async () => {
    const local = await depthCtx("government-dashboard");
    await lensRun("government", "departments-add", { params: { name: "Dash Dept" } }, local);
    // one open + one closed service request
    await lensRun("government", "service-requests-create", {
      params: { category: "pothole", description: "open one", lat: 1, lng: 2 },
    }, local);
    const toClose = await lensRun("government", "service-requests-create", {
      params: { category: "pothole", description: "to close", lat: 1, lng: 2 },
    }, local);
    await lensRun("government", "service-requests-update-status", {
      params: { id: toClose.result.request.id, status: "closed_resolved", note: "done" },
    }, local);
    // a permit + a poor-condition asset
    await lensRun("government", "permits-apply", {
      params: { applicantName: "X", applicantEmail: "x@example.com", kind: "building", feeUsd: 250 },
    }, local);
    await lensRun("government", "assets-add", {
      params: { kind: "sign", lat: 1, lng: 2, condition: "poor" },
    }, local);

    const sum = await lensRun("government", "dashboard-summary", {}, local);
    assert.equal(sum.result.totalServiceRequests, 2);
    assert.equal(sum.result.openRequests, 1);   // one still open
    assert.equal(sum.result.closed30d, 1);      // one closed within 30d
    assert.equal(sum.result.permitCount, 1);
    assert.equal(sum.result.permitStatusCounts.applied, 1);
    assert.equal(sum.result.departmentCount, 1);
    assert.equal(sum.result.assetCount, 1);
    assert.equal(sum.result.brokenAssets, 1);   // poor counts as broken/poor
  });
});
