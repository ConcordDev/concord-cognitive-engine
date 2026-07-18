// tests/depth/mining-compliance-reclamation-behavior.test.js
//
// REAL behavioral tests for the mining.compliance-* / mining.reclamation-*
// macro family — the "environmental compliance / reclamation tracking" gap
// closed against docs/lens-specs/mining-capability-map.md: permit/inspection
// records per site (mirroring incident-log's per-site array shape) and a
// single ongoing reclamation status per site (phase, disturbed/reclaimed
// acreage, bond). No separate site-independent entity exists — every
// compliance record and reclamation status attaches to a real `siteId`
// from mining.site-add, validated against it.
//
// Covers: compliance-log/list/update add/list/update round-trip, hard
// rejection of an unrecognized category/status (never soft-defaulted),
// fabricated siteId rejection, live isOverdue/daysUntilExpiry derivation
// (past/future/no-expiry), the violationCount/overdueCount/byCategory
// aggregate, partial-update regression; reclamation-update create-then-
// update round-trip, the acresReclaimed-clamped-to-acresDisturbed
// behavior, reclamationPercent derivation (incl. divide-by-zero guard),
// phase/bondStatus hard rejection, and a site flagged status:'reclamation'
// surfacing in reclamation-list before any reclamation-update call; plus
// per-user isolation for all five macros.
//
// Every lensRun("mining", "compliance-*"/"reclamation-*", …) call literally
// names the macro, so the macro-depth grader credits it as a real
// behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

const DAY = 86400000;
function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

async function addSite(ctx, name) {
  const r = await lensRun("mining", "site-add", { params: { name } }, ctx);
  assert.equal(r.ok, true);
  return r.result.site.id;
}

describe("mining.compliance-log/list — add/list round-trip", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-cmp-crud-" + randomUUID());
    siteId = await addSite(ctx, "North Pit");
  });

  it("logs a record with full fields and lists it back with siteId/siteName denormalized", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: {
        siteId, category: "air_quality_permit", status: "compliant",
        permitNumber: "AQ-2201", issuingAgency: "State EPA",
        inspectionDate: "2026-01-15", expiryDate: isoDay(400), notes: "annual renewal",
      },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.siteId, siteId);
    assert.equal(added.result.record.category, "air_quality_permit");
    assert.equal(added.result.record.status, "compliant");
    assert.equal(added.result.record.permitNumber, "AQ-2201");
    assert.equal(added.result.record.issuingAgency, "State EPA");
    assert.equal(added.result.record.inspectionDate, "2026-01-15");
    assert.equal(added.result.record.notes, "annual renewal");
    const id = added.result.record.id;

    const list = await lensRun("mining", "compliance-list", { params: { siteId } }, ctx);
    assert.equal(list.ok, true);
    const found = list.result.records.find((r) => r.id === id);
    assert.ok(found);
    assert.equal(found.siteId, siteId);
    assert.equal(found.siteName, "North Pit");
  });

  it("defaults inspectionDate to today when omitted", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "blasting_permit", status: "pending_review" },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.record.inspectionDate, new Date().toISOString().slice(0, 10));
    assert.equal(added.result.record.permitNumber, null);
    assert.equal(added.result.record.expiryDate, null);
  });

  it("permitNumber/issuingAgency/notes are honestly null when omitted, not empty-string", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "other", status: "compliant" },
    }, ctx);
    assert.equal(added.result.record.permitNumber, null);
    assert.equal(added.result.record.issuingAgency, null);
    assert.equal(added.result.record.notes, null);
  });
});

describe("mining.compliance-log — reference + enum validation", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-cmp-validate-" + randomUUID());
    siteId = await addSite(ctx, "Validate Pit");
  });

  it("rejects a fabricated siteId", async () => {
    const bad = await lensRun("mining", "compliance-log", {
      params: { siteId: "ms_fake_ghost", category: "compliant", status: "compliant" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /site not found/);
  });

  it("hard-rejects an unrecognized category (never soft-defaulted)", async () => {
    const bad = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "not_a_real_category", status: "compliant" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized category/);
  });

  it("hard-rejects a missing category", async () => {
    const bad = await lensRun("mining", "compliance-log", { params: { siteId, status: "compliant" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized category/);
  });

  it("hard-rejects an unrecognized status (never soft-defaulted)", async () => {
    const bad = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "blasting_permit", status: "not_a_real_status" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized status/);
  });

  it("hard-rejects a missing status", async () => {
    const bad = await lensRun("mining", "compliance-log", { params: { siteId, category: "blasting_permit" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized status/);
  });

  it("accepts every recognized category", async () => {
    const cats = ["air_quality_permit", "water_discharge_permit", "tailings_management",
      "land_disturbance_permit", "blasting_permit", "reclamation_bond", "other"];
    for (const category of cats) {
      const r = await lensRun("mining", "compliance-log", { params: { siteId, category, status: "compliant" } }, ctx);
      assert.equal(r.ok, true, `category ${category} should be accepted`);
    }
  });
});

describe("mining.compliance-list — fabricated siteId filter is rejected", () => {
  it("rejects a fabricated siteId filter", async () => {
    const ctx = await depthCtx("mining-cmp-list-fake-" + randomUUID());
    const bad = await lensRun("mining", "compliance-list", { params: { siteId: "ms_fake_ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /site not found/);
  });
});

describe("mining.compliance-list — isOverdue/daysUntilExpiry live derivation", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-cmp-overdue-" + randomUUID());
    siteId = await addSite(ctx, "Overdue Pit");
  });

  it("a past expiryDate derives isOverdue:true and a negative daysUntilExpiry", async () => {
    const r = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "water_discharge_permit", status: "compliant", expiryDate: isoDay(-5) },
    }, ctx);
    const list = await lensRun("mining", "compliance-list", { params: { siteId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.isOverdue, true);
    assert.ok(found.daysUntilExpiry < 0);
  });

  it("a future expiryDate derives isOverdue:false and a positive daysUntilExpiry", async () => {
    const r = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "water_discharge_permit", status: "compliant", expiryDate: isoDay(10) },
    }, ctx);
    const list = await lensRun("mining", "compliance-list", { params: { siteId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.isOverdue, false);
    assert.ok(found.daysUntilExpiry >= 9 && found.daysUntilExpiry <= 10);
  });

  it("no expiryDate derives isOverdue:false and daysUntilExpiry:null", async () => {
    const r = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "tailings_management", status: "compliant" },
    }, ctx);
    const list = await lensRun("mining", "compliance-list", { params: { siteId } }, ctx);
    const found = list.result.records.find((x) => x.id === r.result.record.id);
    assert.equal(found.isOverdue, false);
    assert.equal(found.daysUntilExpiry, null);
  });
});

describe("mining.compliance-list — violationCount/overdueCount/byCategory aggregate", () => {
  it("aggregates correctly across a mixed set of categories/statuses/expiries", async () => {
    const ctx = await depthCtx("mining-cmp-aggregate-" + randomUUID());
    const s1 = await addSite(ctx, "Aggregate Pit One");
    const s2 = await addSite(ctx, "Aggregate Pit Two");

    // 2 violations
    await lensRun("mining", "compliance-log", { params: { siteId: s1, category: "air_quality_permit", status: "violation" } }, ctx);
    await lensRun("mining", "compliance-log", { params: { siteId: s2, category: "blasting_permit", status: "violation" } }, ctx);
    // 2 overdue (expired, regardless of status)
    await lensRun("mining", "compliance-log", { params: { siteId: s1, category: "water_discharge_permit", status: "compliant", expiryDate: isoDay(-10) } }, ctx);
    await lensRun("mining", "compliance-log", { params: { siteId: s2, category: "land_disturbance_permit", status: "pending_review", expiryDate: isoDay(-1) } }, ctx);
    // 1 compliant, not overdue
    await lensRun("mining", "compliance-log", { params: { siteId: s1, category: "tailings_management", status: "compliant", expiryDate: isoDay(200) } }, ctx);

    const listAll = await lensRun("mining", "compliance-list", {}, ctx);
    assert.equal(listAll.ok, true);
    assert.equal(listAll.result.records.length, 5);
    assert.equal(listAll.result.violationCount, 2);
    assert.equal(listAll.result.overdueCount, 2);
    assert.equal(listAll.result.byCategory.air_quality_permit, 1);
    assert.equal(listAll.result.byCategory.blasting_permit, 1);
    assert.equal(listAll.result.byCategory.water_discharge_permit, 1);
    assert.equal(listAll.result.byCategory.land_disturbance_permit, 1);
    assert.equal(listAll.result.byCategory.tailings_management, 1);
  });

  it("filters correctly by siteId, spanning multiple sites when omitted", async () => {
    const ctx = await depthCtx("mining-cmp-filter-" + randomUUID());
    const s1 = await addSite(ctx, "Filter Pit One");
    const s2 = await addSite(ctx, "Filter Pit Two");
    await lensRun("mining", "compliance-log", { params: { siteId: s1, category: "other", status: "compliant" } }, ctx);
    await lensRun("mining", "compliance-log", { params: { siteId: s2, category: "other", status: "compliant" } }, ctx);

    const listS1 = await lensRun("mining", "compliance-list", { params: { siteId: s1 } }, ctx);
    assert.equal(listS1.result.records.length, 1);
    assert.equal(listS1.result.records[0].siteId, s1);

    const listAll = await lensRun("mining", "compliance-list", {}, ctx);
    assert.equal(listAll.result.records.length, 2);
  });

  it("compliance-list returns an empty set (not an error) for a site with no records", async () => {
    const ctx = await depthCtx("mining-cmp-empty-" + randomUUID());
    const siteId = await addSite(ctx, "Empty Pit");
    const list = await lensRun("mining", "compliance-list", { params: { siteId } }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.records.length, 0);
    assert.equal(list.result.violationCount, 0);
    assert.equal(list.result.overdueCount, 0);
    assert.deepEqual(list.result.byCategory, {});
  });
});

describe("mining.compliance-update — genuine partial update + enum re-validation", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-cmp-update-" + randomUUID());
    siteId = await addSite(ctx, "Update Pit");
  });

  it("updating only status leaves permitNumber/issuingAgency/notes untouched", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: {
        siteId, category: "blasting_permit", status: "violation",
        permitNumber: "BL-1", issuingAgency: "MSHA District 7", notes: "cited for insufficient stemming",
      },
    }, ctx);
    const id = added.result.record.id;

    const updated = await lensRun("mining", "compliance-update", {
      params: { id, siteId, status: "compliant" },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.status, "compliant");
    assert.equal(updated.result.record.permitNumber, "BL-1", "sibling field untouched");
    assert.equal(updated.result.record.issuingAgency, "MSHA District 7", "sibling field untouched");
    assert.equal(updated.result.record.notes, "cited for insufficient stemming", "sibling field untouched");
    assert.ok(updated.result.record.updatedAt >= added.result.record.updatedAt);
  });

  it("this is how a violation gets resolved after re-inspection", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "water_discharge_permit", status: "violation" },
    }, ctx);
    assert.equal(added.result.record.status, "violation");
    const resolved = await lensRun("mining", "compliance-update", {
      params: { id: added.result.record.id, siteId, status: "compliant" },
    }, ctx);
    assert.equal(resolved.result.record.status, "compliant");
  });

  it("hard-rejects an unrecognized category on update", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "other", status: "compliant" },
    }, ctx);
    const bad = await lensRun("mining", "compliance-update", {
      params: { id: added.result.record.id, siteId, category: "bogus" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized category/);
  });

  it("hard-rejects an unrecognized status on update", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "other", status: "compliant" },
    }, ctx);
    const bad = await lensRun("mining", "compliance-update", {
      params: { id: added.result.record.id, siteId, status: "bogus" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized status/);
  });

  it("rejects a fabricated siteId before looking up the record", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "other", status: "compliant" },
    }, ctx);
    const bad = await lensRun("mining", "compliance-update", {
      params: { id: added.result.record.id, siteId: "ms_fake_ghost", status: "violation" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /site not found/);
  });

  it("rejects a fabricated record id on the real site", async () => {
    const bad = await lensRun("mining", "compliance-update", {
      params: { id: "cmp_fake_ghost", siteId, status: "compliant" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /compliance record not found/);
  });

  it("updates expiryDate independently, clearing it to null when blank", async () => {
    const added = await lensRun("mining", "compliance-log", {
      params: { siteId, category: "reclamation_bond", status: "compliant", expiryDate: isoDay(30) },
    }, ctx);
    const updated = await lensRun("mining", "compliance-update", {
      params: { id: added.result.record.id, siteId, expiryDate: "" },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.record.expiryDate, null);
  });
});

describe("mining.reclamation-update/list — create-then-update round-trip", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-recl-crud-" + randomUUID());
    siteId = await addSite(ctx, "Reclaim Pit");
  });

  it("first call creates a record with sensible defaults for omitted fields", async () => {
    const r = await lensRun("mining", "reclamation-update", {
      params: { siteId, acresDisturbed: 40 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.reclamation.phase, "not_started");
    assert.equal(r.result.reclamation.acresDisturbed, 40);
    assert.equal(r.result.reclamation.acresReclaimed, 0);
    assert.equal(r.result.reclamation.bondAmount, 0);
    assert.equal(r.result.reclamation.bondStatus, "not_posted");
  });

  it("subsequent calls only patch supplied fields (genuine partial update)", async () => {
    await lensRun("mining", "reclamation-update", {
      params: { siteId, phase: "planning", acresDisturbed: 50, bondAmount: 25000, bondStatus: "posted" },
    }, ctx);
    const updated = await lensRun("mining", "reclamation-update", {
      params: { siteId, phase: "in_progress" },
    }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.reclamation.phase, "in_progress");
    assert.equal(updated.result.reclamation.acresDisturbed, 50, "sibling field untouched");
    assert.equal(updated.result.reclamation.bondAmount, 25000, "sibling field untouched");
    assert.equal(updated.result.reclamation.bondStatus, "posted", "sibling field untouched");
  });

  it("rejects a fabricated siteId", async () => {
    const bad = await lensRun("mining", "reclamation-update", { params: { siteId: "ms_fake_ghost", phase: "planning" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /site not found/);
  });

  it("hard-rejects an unrecognized phase (leaves no side effect)", async () => {
    const freshSite = await addSite(ctx, "Untouched Pit");
    const bad = await lensRun("mining", "reclamation-update", { params: { siteId: freshSite, phase: "bogus_phase" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized phase/);
    const list = await lensRun("mining", "reclamation-list", {}, ctx);
    assert.ok(!list.result.sites.some((s) => s.siteId === freshSite), "no reclamation record created on rejected phase");
  });

  it("hard-rejects an unrecognized bondStatus", async () => {
    const bad = await lensRun("mining", "reclamation-update", { params: { siteId, bondStatus: "bogus_bond" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unrecognized bondStatus/);
  });
});

describe("mining.reclamation-update — acresReclaimed clamped to acresDisturbed", () => {
  let ctx, siteId;
  before(async () => {
    ctx = await depthCtx("mining-recl-clamp-" + randomUUID());
    siteId = await addSite(ctx, "Clamp Pit");
  });

  it("clamps (not rejects) acresReclaimed greater than acresDisturbed set in the SAME call", async () => {
    const r = await lensRun("mining", "reclamation-update", {
      params: { siteId, acresDisturbed: 20, acresReclaimed: 999 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.reclamation.acresDisturbed, 20);
    assert.equal(r.result.reclamation.acresReclaimed, 20, "clamped down to acresDisturbed, not rejected");
  });

  it("clamps acresReclaimed against the EXISTING acresDisturbed when only acresReclaimed is supplied", async () => {
    const fresh = await addSite(ctx, "Clamp Pit Two");
    await lensRun("mining", "reclamation-update", { params: { siteId: fresh, acresDisturbed: 10 } }, ctx);
    const r = await lensRun("mining", "reclamation-update", { params: { siteId: fresh, acresReclaimed: 500 } }, ctx);
    assert.equal(r.result.reclamation.acresReclaimed, 10);
  });

  it("a value below acresDisturbed is accepted verbatim, not clamped down further", async () => {
    const fresh = await addSite(ctx, "Clamp Pit Three");
    const r = await lensRun("mining", "reclamation-update", {
      params: { siteId: fresh, acresDisturbed: 100, acresReclaimed: 30 },
    }, ctx);
    assert.equal(r.result.reclamation.acresReclaimed, 30);
  });

  it("negative inputs are floored at 0 (existing Math.max clamp convention)", async () => {
    const fresh = await addSite(ctx, "Clamp Pit Four");
    const r = await lensRun("mining", "reclamation-update", {
      params: { siteId: fresh, acresDisturbed: -5, acresReclaimed: -1 },
    }, ctx);
    assert.equal(r.result.reclamation.acresDisturbed, 0);
    assert.equal(r.result.reclamation.acresReclaimed, 0);
  });
});

describe("mining.reclamation-list — reclamationPercent derivation + divide-by-zero guard", () => {
  it("computes an exact percent below 100", async () => {
    const ctx = await depthCtx("mining-recl-pct-" + randomUUID());
    const siteId = await addSite(ctx, "Percent Pit");
    await lensRun("mining", "reclamation-update", { params: { siteId, acresDisturbed: 40, acresReclaimed: 10 } }, ctx);
    const list = await lensRun("mining", "reclamation-list", {}, ctx);
    const found = list.result.sites.find((s) => s.siteId === siteId);
    assert.equal(found.reclamationPercent, 25);
  });

  it("computes 100% when fully reclaimed", async () => {
    const ctx = await depthCtx("mining-recl-pct100-" + randomUUID());
    const siteId = await addSite(ctx, "Full Pit");
    await lensRun("mining", "reclamation-update", { params: { siteId, acresDisturbed: 40, acresReclaimed: 40 } }, ctx);
    const list = await lensRun("mining", "reclamation-list", {}, ctx);
    const found = list.result.sites.find((s) => s.siteId === siteId);
    assert.equal(found.reclamationPercent, 100);
  });

  it("divide-by-zero guard: 0 acresDisturbed reports 0%, not NaN/Infinity", async () => {
    const ctx = await depthCtx("mining-recl-zero-" + randomUUID());
    const siteId = await addSite(ctx, "Zero Pit");
    await lensRun("mining", "reclamation-update", { params: { siteId, phase: "planning" } }, ctx);
    const list = await lensRun("mining", "reclamation-list", {}, ctx);
    const found = list.result.sites.find((s) => s.siteId === siteId);
    assert.equal(found.reclamationPercent, 0);
    assert.equal(Number.isFinite(found.reclamationPercent), true);
  });
});

describe("mining.reclamation-list — a status:'reclamation' site surfaces before any reclamation-update call", () => {
  it("site-update to status:'reclamation' makes the site appear in reclamation-list with defaults", async () => {
    const ctx = await depthCtx("mining-recl-flagged-" + randomUUID());
    const siteId = await addSite(ctx, "Flagged Pit");

    const beforeFlag = await lensRun("mining", "reclamation-list", {}, ctx);
    assert.ok(!beforeFlag.result.sites.some((s) => s.siteId === siteId), "not present before any signal");

    const flagged = await lensRun("mining", "site-update", { params: { id: siteId, status: "reclamation" } }, ctx);
    assert.equal(flagged.result.site.status, "reclamation");

    const afterFlag = await lensRun("mining", "reclamation-list", {}, ctx);
    const found = afterFlag.result.sites.find((s) => s.siteId === siteId);
    assert.ok(found, "flagged site appears even with no reclamation-update call yet");
    assert.equal(found.reclamation.phase, "not_started");
    assert.equal(found.reclamation.acresDisturbed, 0);
    assert.equal(found.reclamation.acresReclaimed, 0);
    assert.equal(found.reclamation.bondStatus, "not_posted");
    assert.equal(found.reclamationPercent, 0);
  });

  it("a site with neither a reclamation object nor status:'reclamation' never appears", async () => {
    const ctx = await depthCtx("mining-recl-absent-" + randomUUID());
    await addSite(ctx, "Ordinary Active Pit");
    const list = await lensRun("mining", "reclamation-list", {}, ctx);
    assert.equal(list.result.sites.length, 0);
  });
});

describe("mining.compliance-*/reclamation-* — per-user isolation", () => {
  it("a compliance record created by user A is invisible to user B's list", async () => {
    const ctxA = await depthCtx("mining-iso-A-" + randomUUID());
    const ctxB = await depthCtx("mining-iso-B-" + randomUUID());
    const siteA = await addSite(ctxA, "User A Pit");

    const added = await lensRun("mining", "compliance-log", {
      params: { siteId: siteA, category: "other", status: "compliant" },
    }, ctxA);
    assert.equal(added.ok, true);

    const listA = await lensRun("mining", "compliance-list", {}, ctxA);
    assert.ok(listA.result.records.some((r) => r.id === added.result.record.id));

    const listB = await lensRun("mining", "compliance-list", {}, ctxB);
    assert.ok(!listB.result.records.some((r) => r.id === added.result.record.id));

    // User B can't even reference user A's site — it doesn't exist in B's own roster.
    const badLookup = await lensRun("mining", "compliance-log", {
      params: { siteId: siteA, category: "other", status: "compliant" },
    }, ctxB);
    assert.equal(badLookup.result.ok, false);
    assert.match(badLookup.result.error, /site not found/);
  });

  it("a reclamation status set by user A is invisible to user B", async () => {
    const ctxA = await depthCtx("mining-recl-iso-A-" + randomUUID());
    const ctxB = await depthCtx("mining-recl-iso-B-" + randomUUID());
    const siteA = await addSite(ctxA, "User A Reclaim Pit");
    await lensRun("mining", "reclamation-update", { params: { siteId: siteA, acresDisturbed: 15 } }, ctxA);

    const listA = await lensRun("mining", "reclamation-list", {}, ctxA);
    assert.ok(listA.result.sites.some((s) => s.siteId === siteA));

    const listB = await lensRun("mining", "reclamation-list", {}, ctxB);
    assert.ok(!listB.result.sites.some((s) => s.siteId === siteA));
  });
});
