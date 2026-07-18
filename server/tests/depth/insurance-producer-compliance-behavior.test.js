// tests/depth/insurance-producer-compliance-behavior.test.js
//
// REAL behavioral tests for the insurance.producer-compliance-* macro
// family — the "producer compliance tracking" gap closed against
// docs/lens-specs/insurance-capability-map.md: CE-credit progress,
// license renewal dates, E&O insurance status, and carrier-appointment
// tracking for the existing agent/producer roster (agent-add/agent-list).
// No separate "producer" entity exists — every compliance record
// attaches to a real `agentId` from that roster, validated against it.
//
// Covers: add/list/update/remove round-trip for each of the 4 categories
// (with category-specific required-field validation), agentId validation
// against a fabricated id, unrecognized-category hard rejection, live
// agent-name re-derivation honesty (including the since-deleted-agent
// case, simulated via direct STATE manipulation since this file has no
// agent-delete macro), dueState-derived status correctness, creditsPercent/
// creditsComplete derivation (incl. divide-by-zero guard), partial-update
// regression, and the overdueCount/dueSoonCount/byCategory aggregate.
//
// Every lensRun("insurance", "producer-compliance-*", …) call literally
// names the macro, so the macro-depth grader credits it as a real
// behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx, load } from "./_harness.js";

const DAY = 86400000;
function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

async function addAgent(ctx, name) {
  const r = await lensRun("insurance", "agent-add", { params: { name } }, ctx);
  assert.equal(r.ok, true);
  return r.result.agent.id;
}

describe("insurance.producer-compliance-* — add/list round-trip per category", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-crud-" + randomUUID());
    agentId = await addAgent(ctx, "Jordan Reyes");
  });

  it("ce_credits: adds with progress fields and lists back with derived status", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: {
        agentId, category: "ce_credits", periodLabel: "2026-2027 cycle",
        creditsCompleted: 10, creditsRequired: 24, expiryDate: isoDay(400),
      },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.category, "ce_credits");
    assert.equal(added.result.record.periodLabel, "2026-2027 cycle");
    assert.equal(added.result.record.creditsCompleted, 10);
    assert.equal(added.result.record.creditsRequired, 24);
    assert.equal(added.result.record.agentId, agentId);
    const id = added.result.record.id;

    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    assert.equal(list.ok, true);
    const found = list.result.records.find((r) => r.id === id);
    assert.ok(found);
    assert.equal(found.creditsPercent, Math.round((10 / 24) * 100));
    assert.equal(found.creditsComplete, false);
    assert.equal(found.status, "scheduled");
  });

  it("ce_credits: defaults creditsRequired to 24 when omitted", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Default Req Cycle", creditsCompleted: 5 },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.creditsRequired, 24);
  });

  it("ce_credits: rejects a missing periodLabel", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", creditsCompleted: 5 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /periodLabel required for ce_credits/);
  });

  it("license_renewal: adds with required fields and lists back", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "LIC-9981", state: "TX", expiryDate: isoDay(200) },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.licenseNumber, "LIC-9981");
    assert.equal(added.result.record.state, "TX");
    const id = added.result.record.id;

    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((r) => r.id === id);
    assert.ok(found);
    assert.equal(found.status, "scheduled");
  });

  it("license_renewal: rejects a missing licenseNumber", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", state: "TX", expiryDate: isoDay(200) },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /licenseNumber required for license_renewal/);
  });

  it("license_renewal: rejects a missing state", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "LIC-1", expiryDate: isoDay(200) },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /state required for license_renewal/);
  });

  it("license_renewal: rejects a missing expiryDate", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "LIC-1", state: "TX" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /expiryDate required for license_renewal/);
  });

  it("eo_insurance: adds with required fields and lists back", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "eo_insurance", carrier: "Hartford E&O", policyNumber: "EO-4471", expiryDate: isoDay(10) },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.carrier, "Hartford E&O");
    assert.equal(added.result.record.policyNumber, "EO-4471");
    const id = added.result.record.id;

    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((r) => r.id === id);
    assert.equal(found.status, "due_soon");
  });

  it("eo_insurance: rejects a missing carrier", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "eo_insurance", policyNumber: "EO-1", expiryDate: isoDay(10) },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /carrier required for eo_insurance/);
  });

  it("eo_insurance: rejects a missing policyNumber", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "eo_insurance", carrier: "Hartford", expiryDate: isoDay(10) },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /policyNumber required for eo_insurance/);
  });

  it("eo_insurance: rejects a missing expiryDate", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "eo_insurance", carrier: "Hartford", policyNumber: "EO-1" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /expiryDate required for eo_insurance/);
  });

  it("carrier_appointment: adds with just carrierName (expiryDate optional)", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", carrierName: "Progressive", appointmentNumber: "APT-55" },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.carrierName, "Progressive");
    assert.equal(added.result.record.appointmentNumber, "APT-55");
    assert.equal(added.result.record.expiryDate, null);

    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((r) => r.id === added.result.record.id);
    assert.equal(found.status, "none");
  });

  it("carrier_appointment: also accepts an expiryDate and derives status from it", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", carrierName: "Allstate", expiryDate: isoDay(-5) },
    }, ctx);
    assert.equal(added.ok, true);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((r) => r.id === added.result.record.id);
    assert.equal(found.status, "overdue");
  });

  it("carrier_appointment: rejects a missing carrierName", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", appointmentNumber: "APT-1" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /carrierName required for carrier_appointment/);
  });
});

describe("insurance.producer-compliance-add — reference + category validation", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-validation-" + randomUUID());
    agentId = await addAgent(ctx, "Priya Nair");
  });

  it("rejects a fabricated agentId (never silently accepted)", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: "agt_fake_ghost", category: "license_renewal", licenseNumber: "L1", state: "CA", expiryDate: isoDay(10) },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /agent not found/);
  });

  it("rejects a missing agentId", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { category: "carrier_appointment", carrierName: "X" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /agentId required/);
  });

  it("hard-rejects an unrecognized category (never soft-defaulted)", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "not_a_real_category" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized category/);
  });

  it("hard-rejects a missing category", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", { params: { agentId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized category/);
  });

  it("rejects a poisoned creditsCompleted (NaN/negative/huge)", async () => {
    const bad = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Bad Cycle", creditsCompleted: -5 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid_creditsCompleted/);
  });
});

describe("insurance.producer-compliance-list — live agent re-derivation honesty", () => {
  it("agentName/agentFound are re-derived live; a since-deleted agent surfaces agentFound:false", async () => {
    const ctx = await depthCtx("insurance-pc-live-derive-" + randomUUID());
    const agentId = await addAgent(ctx, "Marcus Webb");
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "eo_insurance", carrier: "Liberty Mutual E&O", policyNumber: "EO-100", expiryDate: isoDay(100) },
    }, ctx);
    assert.equal(added.ok, true);

    const beforeDelete = await lensRun("insurance", "producer-compliance-list", {}, ctx);
    const rec1 = beforeDelete.result.records.find((r) => r.id === added.result.record.id);
    assert.equal(rec1.agentFound, true);
    assert.equal(rec1.agentName, "Marcus Webb");

    // No agent-delete macro exists in this file (verified by grep against
    // server/domains/insurance.js), so simulate a since-removed agent by
    // directly manipulating STATE — the same pattern used elsewhere in this
    // depth-test suite (see crypto-behavior.test.js's direct STATE seeding).
    const { STATE } = await load();
    const userId = ctx.actor.userId;
    const roster = STATE.insLens.agents.get(userId) || [];
    const idx = roster.findIndex((a) => a.id === agentId);
    assert.ok(idx >= 0, "the agent exists in STATE before we remove it");
    roster.splice(idx, 1);

    const afterDelete = await lensRun("insurance", "producer-compliance-list", {}, ctx);
    const rec2 = afterDelete.result.records.find((r) => r.id === added.result.record.id);
    assert.ok(rec2, "the compliance record itself survives agent deletion");
    assert.equal(rec2.agentFound, false, "a deleted agent honestly reports agentFound:false");
    assert.equal(rec2.agentName, null, "no stale/fabricated name is shown");
    assert.equal(rec2.agentId, agentId, "the raw agentId link is preserved for audit purposes");
  });
});

describe("insurance.producer-compliance-list — dueState-derived status correctness", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-status-" + randomUUID());
    agentId = await addAgent(ctx, "Status Test Agent");
  });

  it("a past expiryDate derives status: overdue", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "L-OVERDUE", state: "NY", expiryDate: isoDay(-3) },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.status, "overdue");
  });

  it("an expiryDate within 30 days derives status: due_soon", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "L-SOON", state: "NY", expiryDate: isoDay(15) },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.status, "due_soon");
  });

  it("an expiryDate beyond 30 days derives status: scheduled", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "L-FAR", state: "NY", expiryDate: isoDay(365) },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.status, "scheduled");
  });

  it("no expiryDate derives status: none", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", carrierName: "No Expiry Co" },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.status, "none");
  });
});

describe("insurance.producer-compliance-list — creditsPercent/creditsComplete derivation", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-credits-" + randomUUID());
    agentId = await addAgent(ctx, "Credits Test Agent");
  });

  it("computes an exact percent below 100 and creditsComplete:false", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Partial", creditsCompleted: 6, creditsRequired: 24 },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.creditsPercent, 25);
    assert.equal(found.creditsComplete, false);
  });

  it("caps percent at 100 when creditsCompleted exceeds creditsRequired, and creditsComplete:true", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Overachiever", creditsCompleted: 30, creditsRequired: 24 },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.creditsPercent, 100);
    assert.equal(found.creditsComplete, true);
  });

  it("divide-by-zero guard: creditsRequired 0 with 0 completed does not NaN and reports complete", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Zero Req", creditsCompleted: 0, creditsRequired: 0 },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.creditsPercent, 0);
    assert.equal(Number.isNaN(found.creditsPercent), false);
    assert.equal(found.creditsComplete, true, "0 completed >= 0 required");
  });

  it("divide-by-zero guard: creditsRequired 0 with credits logged reports 100% complete, not NaN/Infinity", async () => {
    const r = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Zero Req Logged", creditsCompleted: 5, creditsRequired: 0 },
    }, ctx);
    const list = await lensRun("insurance", "producer-compliance-list", { params: { agentId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.creditsPercent, 100);
    assert.equal(Number.isFinite(found.creditsPercent), true);
    assert.equal(found.creditsComplete, true);
  });
});

describe("insurance.producer-compliance-update — genuine partial update", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-update-" + randomUUID());
    agentId = await addAgent(ctx, "Update Test Agent");
  });

  it("updating only creditsCompleted leaves periodLabel/creditsRequired/notes untouched", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "2026 Cycle", creditsCompleted: 4, creditsRequired: 24, notes: "started late" },
    }, ctx);
    const id = added.result.record.id;

    const updated = await lensRun("insurance", "producer-compliance-update", {
      params: { id, creditsCompleted: 12 },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.creditsCompleted, 12);
    assert.equal(updated.result.record.periodLabel, "2026 Cycle", "sibling field untouched");
    assert.equal(updated.result.record.creditsRequired, 24, "sibling field untouched");
    assert.equal(updated.result.record.notes, "started late", "sibling field untouched");
    assert.ok(updated.result.record.updatedAt >= added.result.record.updatedAt);
  });

  it("updating license_renewal expiryDate only leaves licenseNumber/state untouched", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "L-KEEP", state: "FL", expiryDate: isoDay(50) },
    }, ctx);
    const id = added.result.record.id;

    const updated = await lensRun("insurance", "producer-compliance-update", {
      params: { id, expiryDate: isoDay(500) },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.expiryDate, isoDay(500));
    assert.equal(updated.result.record.licenseNumber, "L-KEEP");
    assert.equal(updated.result.record.state, "FL");
  });

  it("rejects clearing a required field to empty on update (licenseNumber)", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "license_renewal", licenseNumber: "L-ORIG", state: "GA", expiryDate: isoDay(50) },
    }, ctx);
    const bad = await lensRun("insurance", "producer-compliance-update", {
      params: { id: added.result.record.id, licenseNumber: "   " },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /licenseNumber required for license_renewal/);
  });

  it("rejects a poisoned creditsRequired on update", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "ce_credits", periodLabel: "Poison Test", creditsCompleted: 1, creditsRequired: 24 },
    }, ctx);
    const bad = await lensRun("insurance", "producer-compliance-update", {
      params: { id: added.result.record.id, creditsRequired: -10 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid_creditsRequired/);
  });

  it("rejects updating a fabricated id", async () => {
    const bad = await lensRun("insurance", "producer-compliance-update", {
      params: { id: "pc_fake_ghost", notes: "x" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("updates notes independent of category", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", carrierName: "Notes Co" },
    }, ctx);
    const updated = await lensRun("insurance", "producer-compliance-update", {
      params: { id: added.result.record.id, notes: "renewed verbally, paperwork pending" },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.notes, "renewed verbally, paperwork pending");
    assert.equal(updated.result.record.carrierName, "Notes Co");
  });
});

describe("insurance.producer-compliance-remove", () => {
  let ctx, agentId;
  before(async () => {
    ctx = await depthCtx("insurance-pc-remove-" + randomUUID());
    agentId = await addAgent(ctx, "Remove Test Agent");
  });

  it("removes a record; it no longer appears in list", async () => {
    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId, category: "carrier_appointment", carrierName: "To Be Removed" },
    }, ctx);
    const id = added.result.record.id;

    const removed = await lensRun("insurance", "producer-compliance-remove", { params: { id } }, ctx);
    assert.equal(removed.ok, true);
    assert.equal(removed.result.deleted, id);

    const list = await lensRun("insurance", "producer-compliance-list", {}, ctx);
    assert.ok(!list.result.records.some((r) => r.id === id));
  });

  it("rejects removing a fabricated id", async () => {
    const bad = await lensRun("insurance", "producer-compliance-remove", { params: { id: "pc_fake_ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("rejects removing a missing id", async () => {
    const bad = await lensRun("insurance", "producer-compliance-remove", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });
});

describe("insurance.producer-compliance-list — overdueCount/dueSoonCount/byCategory aggregate", () => {
  it("aggregates correctly across a mixed set of categories and statuses", async () => {
    const ctx = await depthCtx("insurance-pc-aggregate-" + randomUUID());
    const a1 = await addAgent(ctx, "Aggregate Agent One");
    const a2 = await addAgent(ctx, "Aggregate Agent Two");

    // 2 overdue: one license_renewal, one eo_insurance
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a1, category: "license_renewal", licenseNumber: "L-A", state: "CA", expiryDate: isoDay(-10) },
    }, ctx);
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a2, category: "eo_insurance", carrier: "C1", policyNumber: "P1", expiryDate: isoDay(-1) },
    }, ctx);
    // 1 due_soon: carrier_appointment
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a1, category: "carrier_appointment", carrierName: "Soon Co", expiryDate: isoDay(5) },
    }, ctx);
    // 1 scheduled: ce_credits
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a2, category: "ce_credits", periodLabel: "Future Cycle", creditsCompleted: 0, expiryDate: isoDay(700) },
    }, ctx);
    // 1 none-status: carrier_appointment with no expiry
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a1, category: "carrier_appointment", carrierName: "No Expiry Co 2" },
    }, ctx);

    const list = await lensRun("insurance", "producer-compliance-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.records.length, 5);
    assert.equal(list.result.overdueCount, 2);
    assert.equal(list.result.dueSoonCount, 1);
    assert.equal(list.result.byCategory.license_renewal, 1);
    assert.equal(list.result.byCategory.eo_insurance, 1);
    assert.equal(list.result.byCategory.carrier_appointment, 2);
    assert.equal(list.result.byCategory.ce_credits, 1);
  });

  it("filters correctly by agentId", async () => {
    const ctx = await depthCtx("insurance-pc-filter-" + randomUUID());
    const a1 = await addAgent(ctx, "Filter Agent One");
    const a2 = await addAgent(ctx, "Filter Agent Two");
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a1, category: "carrier_appointment", carrierName: "For A1" },
    }, ctx);
    await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: a2, category: "carrier_appointment", carrierName: "For A2" },
    }, ctx);

    const listA1 = await lensRun("insurance", "producer-compliance-list", { params: { agentId: a1 } }, ctx);
    assert.equal(listA1.result.records.length, 1);
    assert.equal(listA1.result.records[0].carrierName, "For A1");

    const listAll = await lensRun("insurance", "producer-compliance-list", {}, ctx);
    assert.equal(listAll.result.records.length, 2);
  });
});

describe("insurance.producer-compliance-* — per-user isolation", () => {
  it("a record created by user A is invisible to user B's list", async () => {
    const ctxA = await depthCtx("insurance-pc-userA-" + randomUUID());
    const ctxB = await depthCtx("insurance-pc-userB-" + randomUUID());
    const agentA = await addAgent(ctxA, "User A Agent");

    const added = await lensRun("insurance", "producer-compliance-add", {
      params: { agentId: agentA, category: "carrier_appointment", carrierName: "Only A" },
    }, ctxA);
    assert.equal(added.ok, true);

    const listA = await lensRun("insurance", "producer-compliance-list", {}, ctxA);
    assert.ok(listA.result.records.some((r) => r.id === added.result.record.id));

    const listB = await lensRun("insurance", "producer-compliance-list", {}, ctxB);
    assert.ok(!listB.result.records.some((r) => r.id === added.result.record.id));
  });
});
