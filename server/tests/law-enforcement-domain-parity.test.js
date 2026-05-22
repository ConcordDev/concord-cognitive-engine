// Contract tests for server/domains/lawenforcement.js — RMS/CAD macros.
//
// Exercises the full computer-aided-dispatch, evidence chain-of-custody,
// officer roster, crime mapping, warrant lifecycle, report writing, and
// booking macro surface added for the law-enforcement lens. Pattern mirrors
// server/tests/travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawEnforcementActions from "../domains/lawenforcement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law-enforcement.${name}`);
  if (!fn) throw new Error(`law-enforcement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawEnforcementActions(register); });

// Fresh per-user store before each test by using a unique userId.
let seq = 0;
function freshCtx() {
  seq += 1;
  return { actor: { userId: `le_user_${seq}` }, userId: `le_user_${seq}` };
}

beforeEach(() => {
  // Reset the per-process store so prior tests don't leak.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._lawEnforcement;
});

describe("law-enforcement CAD — dispatch", () => {
  it("creates a call, queues it, and reports priority counts", () => {
    const ctx = freshCtx();
    const c = call("cadCreateCall", ctx, { callType: "Burglary", location: "12 Oak St", priority: "P1" });
    assert.equal(c.ok, true);
    assert.equal(c.result.call.priority, "P1");
    const q = call("cadCallQueue", ctx, {});
    assert.equal(q.ok, true);
    assert.equal(q.result.activeCount, 1);
    assert.equal(q.result.byPriority.P1, 1);
  });

  it("rejects a call missing callType or location", () => {
    const ctx = freshCtx();
    assert.equal(call("cadCreateCall", ctx, { location: "x" }).ok, false);
    assert.equal(call("cadCreateCall", ctx, { callType: "x" }).ok, false);
  });

  it("registers units and renders the unit board", () => {
    const ctx = freshCtx();
    const u = call("cadRegisterUnit", ctx, { callSign: "Adam-12", officerName: "Reed" });
    assert.equal(u.ok, true);
    const b = call("cadUnitBoard", ctx, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.totalUnits, 1);
    assert.equal(b.result.availableCount, 1);
  });

  it("auto-routes the nearest available unit on dispatch", () => {
    const ctx = freshCtx();
    const c = call("cadCreateCall", ctx, { callType: "Theft", location: "Loc", lat: 37.0, lon: -122.0 });
    call("cadRegisterUnit", ctx, { callSign: "Far", lat: 38.0, lon: -123.0 });
    const near = call("cadRegisterUnit", ctx, { callSign: "Near", lat: 37.01, lon: -122.01 });
    const d = call("cadDispatchUnit", ctx, { callId: c.result.call.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.unit.id, near.result.unit.id);
    assert.equal(d.result.routed, true);
    assert.equal(typeof d.result.etaMinutes, "number");
  });

  it("updates unit status and clears the call", () => {
    const ctx = freshCtx();
    const c = call("cadCreateCall", ctx, { callType: "DUI", location: "Hwy" });
    const u = call("cadRegisterUnit", ctx, { callSign: "U-1" });
    call("cadDispatchUnit", ctx, { callId: c.result.call.id, unitId: u.result.unit.id });
    const cleared = call("cadUpdateStatus", ctx, { unitId: u.result.unit.id, status: "cleared" });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.result.unit.status, "available");
    assert.equal(cleared.result.call.status, "cleared");
  });
});

describe("law-enforcement evidence — chain of custody", () => {
  it("intakes evidence with a barcode and seeded custody chain", () => {
    const ctx = freshCtx();
    const e = call("evidenceIntake", ctx, { description: "shell casing", caseNumber: "24-1", officer: "Det. Wells" });
    assert.equal(e.ok, true);
    assert.match(e.result.evidence.barcode, /^EVD-/);
    assert.equal(e.result.evidence.custody.length, 1);
  });

  it("rejects intake without description", () => {
    assert.equal(call("evidenceIntake", freshCtx(), {}).ok, false);
  });

  it("transfers custody and keeps the chain intact", () => {
    const ctx = freshCtx();
    const e = call("evidenceIntake", ctx, { description: "knife", officer: "A" });
    const t = call("evidenceTransfer", ctx, { evidenceId: e.result.evidence.id, to: "Lab", signature: "A" });
    assert.equal(t.ok, true);
    const chain = call("evidenceChain", ctx, { evidenceId: e.result.evidence.id });
    assert.equal(chain.ok, true);
    assert.equal(chain.result.chainIntact, true);
    assert.equal(chain.result.currentHolder, "Lab");
  });

  it("requires recipient and signature on transfer", () => {
    const ctx = freshCtx();
    const e = call("evidenceIntake", ctx, { description: "phone" });
    assert.equal(call("evidenceTransfer", ctx, { evidenceId: e.result.evidence.id, to: "Lab" }).ok, false);
  });

  it("lists evidence with locker breakdown", () => {
    const ctx = freshCtx();
    call("evidenceIntake", ctx, { description: "a", locker: "A-1" });
    call("evidenceIntake", ctx, { description: "b", locker: "A-1" });
    const l = call("evidenceList", ctx, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.total, 2);
    assert.ok(l.result.byLocker.some((x) => x.locker === "A-1" && x.count === 2));
  });
});

describe("law-enforcement roster — scheduling + overtime", () => {
  it("adds an officer and schedules a shift", () => {
    const ctx = freshCtx();
    const o = call("rosterAddOfficer", ctx, { name: "J. Reyes", rank: "Sergeant" });
    assert.equal(o.ok, true);
    const s = call("scheduleShift", ctx, { officerId: o.result.officer.id, date: "2026-05-21", hours: 8 });
    assert.equal(s.ok, true);
    assert.equal(s.result.dayOvertime, 0);
  });

  it("flags daily overtime over 8 hours", () => {
    const ctx = freshCtx();
    const o = call("rosterAddOfficer", ctx, { name: "X" });
    const s = call("scheduleShift", ctx, { officerId: o.result.officer.id, date: "2026-05-21", hours: 12 });
    assert.equal(s.result.dayOvertime, 4);
  });

  it("computes weekly overtime on the roster board", () => {
    const ctx = freshCtx();
    const o = call("rosterAddOfficer", ctx, { name: "Y" });
    for (const d of ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23"]) {
      call("scheduleShift", ctx, { officerId: o.result.officer.id, date: d, hours: 8 });
    }
    const b = call("rosterBoard", ctx, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.officersOnOvertime, 1);
    assert.ok(b.result.totalOvertimeHours > 0);
  });

  it("rejects a shift for an unknown officer", () => {
    assert.equal(call("scheduleShift", freshCtx(), { officerId: "nope", date: "2026-01-01" }).ok, false);
  });
});

describe("law-enforcement crime mapping — hotspots", () => {
  it("plots an incident and returns it on the map", () => {
    const ctx = freshCtx();
    const i = call("mapAddIncident", ctx, { type: "auto theft", lat: 37.5, lon: -122.5 });
    assert.equal(i.ok, true);
    const m = call("crimeMap", ctx, {});
    assert.equal(m.ok, true);
    assert.equal(m.result.total, 1);
  });

  it("rejects an incident with bad coordinates", () => {
    assert.equal(call("mapAddIncident", freshCtx(), { type: "x", lat: 999, lon: 0 }).ok, false);
  });

  it("detects a hotspot when incidents cluster", () => {
    const ctx = freshCtx();
    for (let n = 0; n < 4; n++) call("mapAddIncident", ctx, { type: "robbery", lat: 37.5 + n * 0.0001, lon: -122.5 });
    const m = call("crimeMap", ctx, { radiusKm: 0.5, threshold: 3 });
    assert.equal(m.ok, true);
    assert.ok(m.result.hotspotCount >= 1);
  });
});

describe("law-enforcement warrants — lifecycle", () => {
  it("issues a warrant with a number and expiry", () => {
    const w = call("warrantIssue", freshCtx(), { subject: "John Doe", warrantType: "arrest", validDays: 30 });
    assert.equal(w.ok, true);
    assert.match(w.result.warrant.warrantNumber, /^WR-/);
    assert.equal(w.result.warrant.status, "active");
  });

  it("rejects a warrant without a subject", () => {
    assert.equal(call("warrantIssue", freshCtx(), {}).ok, false);
  });

  it("records a service attempt and marks served", () => {
    const ctx = freshCtx();
    const w = call("warrantIssue", ctx, { subject: "Jane" });
    const a = call("warrantServiceAttempt", ctx, { warrantId: w.result.warrant.id, outcome: "served" });
    assert.equal(a.ok, true);
    assert.equal(a.result.warrant.status, "served");
  });

  it("returns a warrant with a disposition", () => {
    const ctx = freshCtx();
    const w = call("warrantIssue", ctx, { subject: "Z" });
    const r = call("warrantReturn", ctx, { warrantId: w.result.warrant.id, disposition: "quashed" });
    assert.equal(r.ok, true);
    assert.equal(r.result.warrant.status, "quashed");
  });

  it("lists warrants with status counts", () => {
    const ctx = freshCtx();
    call("warrantIssue", ctx, { subject: "A" });
    call("warrantIssue", ctx, { subject: "B" });
    const l = call("warrantList", ctx, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.total, 2);
    assert.equal(l.result.active, 2);
  });
});

describe("law-enforcement reports — statute + approval", () => {
  it("drafts a report and auto-populates a statute", () => {
    const r = call("reportDraft", freshCtx(), { offense: "grand theft", narrative: "Suspect took the vehicle." });
    assert.equal(r.ok, true);
    assert.equal(r.result.statuteFound, true);
    assert.equal(r.result.report.statute.code, "PC 487");
  });

  it("rejects a report missing offense or narrative", () => {
    assert.equal(call("reportDraft", freshCtx(), { offense: "x" }).ok, false);
  });

  it("runs the submit → approve workflow", () => {
    const ctx = freshCtx();
    const d = call("reportDraft", ctx, { offense: "burglary", narrative: "n" });
    const sub = call("reportSubmit", ctx, { reportId: d.result.report.id });
    assert.equal(sub.result.report.status, "submitted");
    const ap = call("reportApprove", ctx, { reportId: d.result.report.id, decision: "approve", supervisor: "Sgt. Cole" });
    assert.equal(ap.ok, true);
    assert.equal(ap.result.report.status, "approved");
  });

  it("lists reports with pending-approval count", () => {
    const ctx = freshCtx();
    const d = call("reportDraft", ctx, { offense: "theft", narrative: "n" });
    call("reportSubmit", ctx, { reportId: d.result.report.id });
    const l = call("reportList", ctx, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.pendingApproval, 1);
  });
});

describe("law-enforcement booking — field interview / arrest", () => {
  it("creates an arrest booking and flags missing prints/mugshot", () => {
    const b = call("bookingCreate", freshCtx(), { kind: "arrest", subjectName: "Doe", charges: ["robbery"] });
    assert.equal(b.ok, true);
    assert.equal(b.result.complete, false);
    assert.ok(b.result.missingFields.includes("mugshot"));
  });

  it("marks an arrest booking complete with all captures", () => {
    const b = call("bookingCreate", freshCtx(), {
      kind: "arrest", subjectName: "Doe", charges: ["assault"],
      mugshotCaptured: true, printsCaptured: true,
    });
    assert.equal(b.result.complete, true);
    assert.ok(b.result.booking.statutes.length >= 1);
  });

  it("rejects a booking without a subject name", () => {
    assert.equal(call("bookingCreate", freshCtx(), {}).ok, false);
  });

  it("lists bookings split by kind", () => {
    const ctx = freshCtx();
    call("bookingCreate", ctx, { kind: "arrest", subjectName: "A", mugshotCaptured: true, printsCaptured: true, charges: ["theft"] });
    call("bookingCreate", ctx, { kind: "field_interview", subjectName: "B" });
    const l = call("bookingList", ctx, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.arrests, 1);
    assert.equal(l.result.fieldInterviews, 1);
  });
});

describe("law-enforcement original analytics macros still register", () => {
  it("caseAnalysis scores a case", () => {
    const fn = ACTIONS.get("law-enforcement.caseAnalysis");
    const r = fn(freshCtx(), { data: { evidence: [1, 2], witnesses: [1], suspects: [] }, title: "C-1" }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.caseStrength, "number");
  });
});
