// server/tests/law-enforcement-lens-macros.test.js
//
// PHASE-2 component-exact-shape behavioral gate for the law-enforcement lens.
//
// Unlike server/tests/law-enforcement-domain-parity.test.js (which drives the
// handlers directly with already-flat params), THIS test reproduces the REAL
// /api/lens/run dispatch end-to-end so the EXACT object the two frontend
// components send is what reaches the handler:
//
//   1. concord-frontend/components/law-enforcement/LawEnforcementActionPanel.tsx
//      → callMacro(action, { artifact: { data, title } })
//      → runDomain('law-enforcement', action, { input: { artifact: {data,title} } })
//      → server body.input = { artifact: { data, title } }
//      → peelRedundantArtifactWrapper(body.input) === artifact.data   (sole-key peel)
//      → virtualArtifact.data = <data>, params = <data>
//      The analytics handlers read `artifact.data.*`, so this peel is what makes
//      them see the real case/zones/incident object instead of a dead wrapper.
//
//   2. concord-frontend/components/law-enforcement/RmsCadConsole.tsx
//      → lensRun('law-enforcement', action, <flat input>)
//      → server body.input = <flat input> (no artifact wrapper)
//      → peel is a no-op → params = <flat input>
//      The RMS/CAD handlers read `params.*`.
//
// Every case drives the EXACT inner-data object the component sends and asserts
// the EXACT fields the component renders from `r.result`, with real computed
// values. Plus: validation-rejection, degrade-graceful (empty stores),
// fail-CLOSED poisoned-numeric (Number.isFinite gate on lat/lon).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawEnforcementActions from "../domains/lawenforcement.js";
import peelRedundantArtifactWrapper from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Faithful reproduction of the /api/lens/run dispatch for one (action,input):
//   - peel the redundant artifact wrapper exactly as server.js does
//   - build the virtualArtifact with data = rest, and pass rest as params
function dispatch(action, ctx, input = {}) {
  const fn = ACTIONS.get(`law-enforcement.${action}`);
  if (!fn) throw new Error(`law-enforcement.${action} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "law-enforcement", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// The analytics panel's wire: callMacro(action,{artifact:{data,title}}) maps to
// body.input === { artifact: { data, title } }. Reproduce that exact body.
function analytics(action, ctx, data, title) {
  return dispatch(action, ctx, { artifact: { data, ...(title !== undefined ? { title } : {}) } });
}
// The RMS/CAD console's wire: lensRun(action, flatInput) → body.input === flatInput.
function cad(action, ctx, params = {}) {
  return dispatch(action, ctx, params);
}

before(() => { registerLawEnforcementActions(register); });

let seq = 0;
function freshCtx() {
  seq += 1;
  return { actor: { userId: `lemacro_user_${seq}` }, userId: `lemacro_user_${seq}` };
}
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._lawEnforcement;
});

// ===========================================================================
// Analytics channel — LawEnforcementActionPanel (artifact-wrapped dispatch)
// ===========================================================================
describe("law-enforcement analytics — EXACT panel shapes through the real peel", () => {
  it("caseAnalysis: the artifact wrapper peels and every rendered field is computed", () => {
    // Component sends: { data: parsed, title: parsed.caseId }.
    const parsed = {
      caseId: "C-2026-0042",
      evidence: [{}, {}, {}],          // 3 → evidenceScore min(100,45)=45
      witnesses: [{}, {}],             // 2 → witnessScore 40
      suspects: [{ evidenceLinks: [1, 2] }], // 2 links → suspectLinks 2 → min(100,50)=50
    };
    const r = analytics("caseAnalysis", freshCtx(), parsed, parsed.caseId);
    assert.equal(r.ok, true);
    // EXACT rendered fields (LawEnforcementActionPanel CaseResult block):
    // caseId, caseStrength, status, evidenceCount, witnessCount, suspectCount, nextSteps[], prosecutable
    assert.equal(r.result.caseId, "C-2026-0042");     // peel did NOT strand the case id
    assert.equal(r.result.evidenceCount, 3);
    assert.equal(r.result.witnessCount, 2);
    assert.equal(r.result.suspectCount, 1);
    // caseStrength = round(45*0.4 + 40*0.3 + 50*0.3) = round(18+12+15)=45
    assert.equal(r.result.caseStrength, 45);
    assert.equal(r.result.prosecutable, false);       // <60
    assert.equal(r.result.status, "insufficient-evidence");
    assert.ok(Array.isArray(r.result.nextSteps) && r.result.nextSteps.length > 0);
  });

  it("caseAnalysis: a strong case crosses the prosecutable threshold", () => {
    const parsed = {
      caseId: "C-STRONG",
      evidence: [1, 2, 3, 4, 5, 6, 7], // 7 → min(100,105)=100 → *0.4 = 40
      witnesses: [1, 2, 3, 4, 5],      // 5 → 100 → *0.3 = 30
      suspects: [{ evidenceLinks: [1, 2, 3, 4] }], // 4 → min(100,100)=100 → *0.3 = 30
    };
    const r = analytics("caseAnalysis", freshCtx(), parsed, parsed.caseId);
    assert.equal(r.result.caseStrength, 100);
    assert.equal(r.result.prosecutable, true);
    assert.equal(r.result.status, "strong-case");
    assert.deepEqual(r.result.nextSteps, ["Prepare prosecution brief"]);
  });

  it("patrolOptimize: zone rows + hotspots match what the patrol card renders", () => {
    // Component sends: { data: { zones: [...] } }.
    const data = {
      zones: [
        { name: "Downtown", crimeRate: 60, population: 5000, currentPatrols: 2 },
        { name: "Suburb", crimeRate: 20, population: 8000, currentPatrols: 1 },
      ],
    };
    const r = analytics("patrolOptimize", freshCtx(), data);
    assert.equal(r.ok, true);
    // EXACT rendered fields: totalCurrentUnits, totalUnitsNeeded, hotspots[], zones[{zone,crimeRate,currentPatrols,recommended}]
    assert.deepEqual(r.result.hotspots, ["Downtown"]);     // crimeRate>50
    // recommended = ceil(crimeRate/10): Downtown 6, Suburb 2 → total 8
    assert.equal(r.result.totalUnitsNeeded, 8);
    assert.equal(r.result.totalCurrentUnits, 3);
    assert.equal(r.result.zones[0].zone, "Downtown");
    assert.equal(r.result.zones[0].crimeRate, 60);
    assert.equal(r.result.zones[0].currentPatrols, 2);
    assert.equal(r.result.zones[0].recommended, 6);
  });

  it("patrolOptimize: empty zones returns the honest prompt message, not a fabricated tally", () => {
    const r = analytics("patrolOptimize", freshCtx(), { zones: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.zones, undefined);   // no fake zone rows
  });

  it("incidentReport: the report card fields are computed from the incident form", () => {
    // Component sends: { data: { type, date, location, description, officer } }.
    const data = { type: "theft", date: "2026-06-28T00:00:00.000Z", location: "5th & Main", description: "Bike stolen", officer: "badge-1138" };
    const r = analytics("incidentReport", freshCtx(), data);
    assert.equal(r.ok, true);
    // EXACT rendered fields: reportId, type, location, severity, complete, missingFields[]
    assert.match(r.result.reportId, /^IR-/);
    assert.equal(r.result.type, "theft");
    assert.equal(r.result.location, "5th & Main");
    assert.equal(r.result.severity, "standard");
    assert.equal(r.result.complete, true);             // all required present
    assert.deepEqual(r.result.missingFields, []);
    assert.equal(r.result.status, "filed");
  });

  it("incidentReport: a partial form reports its real missing fields", () => {
    // Component requires type+location before calling, but description can be blank.
    const data = { type: "vandalism", location: "Park", description: "", officer: "badge-1138" };
    const r = analytics("incidentReport", freshCtx(), data);
    assert.equal(r.result.complete, false);
    assert.ok(r.result.missingFields.includes("date"));
    assert.ok(r.result.missingFields.includes("description"));
  });

  it("crimeStats: clearance + byType breakdown match the stats card", () => {
    // Component sends: { data: { incidents: [...] } }.
    const data = {
      incidents: [
        { type: "theft", resolved: true },
        { type: "theft" },
        { type: "dui", status: "closed" },
        { type: "assault" },
      ],
    };
    const r = analytics("crimeStats", freshCtx(), data);
    assert.equal(r.ok, true);
    // EXACT rendered fields: trend, clearanceRate, totalIncidents, mostCommon, byType[{type,count}]
    assert.equal(r.result.totalIncidents, 4);
    assert.equal(r.result.clearanceRate, 50);          // 2 of 4 resolved/closed
    assert.equal(r.result.mostCommon, "theft");
    assert.equal(r.result.trend, "normal");
    assert.deepEqual(r.result.byType[0], { type: "theft", count: 2 });
  });

  it("crimeStats: an empty log returns the honest prompt, not a fabricated 0% card", () => {
    const r = analytics("crimeStats", freshCtx(), { incidents: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.clearanceRate, undefined);
  });
});

// ===========================================================================
// RMS/CAD console channel — RmsCadConsole (flat-input dispatch)
// ===========================================================================
describe("law-enforcement RMS/CAD — EXACT console shapes (flat lensRun input)", () => {
  it("CAD: create → queue → board → dispatch render the fields the tabs read", () => {
    const ctx = freshCtx();
    // CadTab.createCall sends { callType, location, priority, callerName, lat?, lon? }
    const c = cad("cadCreateCall", ctx, { callType: "Burglary in progress", location: "1200 Market St", priority: "P1", lat: 37.77, lon: -122.41 });
    assert.equal(c.ok, true);
    assert.equal(c.result.call.priority, "P1");        // banner reads callPriority echo

    // CadTab.refresh reads cadCallQueue → queue[], byPriority
    const q = cad("cadCallQueue", ctx, {});
    assert.equal(q.result.activeCount, 1);
    assert.equal(q.result.byPriority.P1, 1);            // P1 counter card
    const callId = q.result.queue[0].id;
    assert.equal(q.result.queue[0].callType, "Burglary in progress");
    assert.equal(q.result.queue[0].status, "pending"); // queue shows Dispatch btn when pending

    // CadTab.registerUnit sends { callSign, officerName, beat, lat?, lon? }
    cad("cadRegisterUnit", ctx, { callSign: "Adam-12", officerName: "Reed", lat: 37.78, lon: -122.42 });
    const b = cad("cadUnitBoard", ctx, {});
    assert.equal(b.result.units[0].callSign, "Adam-12");
    assert.equal(b.result.units[0].status, "available"); // UNIT_TONE badge

    // CadTab.dispatch reads r.result.unit.callSign + r.result.etaMinutes for the banner
    const d = cad("cadDispatchUnit", ctx, { callId });
    assert.equal(d.ok, true);
    assert.equal(d.result.unit.callSign, "Adam-12");
    assert.equal(typeof d.result.etaMinutes, "number"); // ETA shown only when numeric
  });

  it("CAD: cadUpdateStatus clears the call and frees the unit (status board flip)", () => {
    const ctx = freshCtx();
    const c = cad("cadCreateCall", ctx, { callType: "DUI", location: "Hwy 1" });
    const u = cad("cadRegisterUnit", ctx, { callSign: "U-9" });
    cad("cadDispatchUnit", ctx, { callId: c.result.call.id, unitId: u.result.unit.id });
    const cleared = cad("cadUpdateStatus", ctx, { unitId: u.result.unit.id, status: "cleared" });
    assert.equal(cleared.result.unit.status, "available");
    assert.equal(cleared.result.call.status, "cleared");
  });

  it("Evidence: intake → list → chain render barcode + locker + chainIntact", () => {
    const ctx = freshCtx();
    // EvidenceTab.intake sends { description, caseNumber, category, locker }
    const e = cad("evidenceIntake", ctx, { description: "9mm shell casing", caseNumber: "24-00123", category: "firearm", locker: "Locker A-12" });
    assert.equal(e.ok, true);
    assert.match(e.result.evidence.barcode, /^EVD-/);  // banner reads evidence.barcode

    // EvidenceTab.refresh reads evidenceList → evidence[], byLocker[]
    const l = cad("evidenceList", ctx, {});
    assert.equal(l.result.total, 1);
    assert.ok(l.result.byLocker.some((x) => x.locker === "Locker A-12" && x.count === 1));

    // EvidenceTab.transfer sends { evidenceId, to, signature, event, locker }
    const t = cad("evidenceTransfer", ctx, { evidenceId: e.result.evidence.id, to: "Forensics Lab", signature: "Det. Wells", event: "transfer", locker: "Lab-1" });
    assert.equal(t.ok, true);

    // EvidenceTab.viewChain reads evidenceChain → chain[], chainIntact, barcode
    const chain = cad("evidenceChain", ctx, { evidenceId: e.result.evidence.id });
    assert.equal(chain.result.chainIntact, true);      // INTACT/BROKEN badge
    assert.equal(chain.result.currentHolder, "Forensics Lab");
    assert.equal(chain.result.barcode, e.result.evidence.barcode);
    assert.ok(chain.result.chain.length >= 2);
  });

  it("Roster: add → schedule → board render weeklyHours + overtime", () => {
    const ctx = freshCtx();
    // RosterTab.addOfficer sends { name, badgeNumber, rank, beat, defaultShift }
    const o = cad("rosterAddOfficer", ctx, { name: "J. Reyes", rank: "Sergeant", beat: "Beat 4", defaultShift: "day" });
    assert.equal(o.ok, true);
    // RosterTab.scheduleShift reads r.result.dayOvertime for the banner warning
    const s = cad("scheduleShift", ctx, { officerId: o.result.officer.id, date: "2026-05-21", hours: 12, shift: "day", beat: "Beat 4" });
    assert.equal(s.result.dayOvertime, 4);             // 12 - 8

    // weekly overtime path: 6×8h in one week → 48 → 8h OT
    for (const dte of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06"]) {
      cad("scheduleShift", ctx, { officerId: o.result.officer.id, date: dte, hours: 8 });
    }
    // RosterTab.refresh reads rosterBoard → roster[{name,weeklyHours,overtimeHours}], officersOnOvertime, totalOvertimeHours
    const board = cad("rosterBoard", ctx, {});
    assert.equal(board.result.officersOnOvertime, 1);
    assert.ok(board.result.totalOvertimeHours > 0);
    const row = board.result.roster.find((r) => r.name === "J. Reyes");
    assert.ok(row.weeklyHours >= 48);
    assert.ok(row.overtimeHours > 0);
  });

  it("Crime Map: plot → crimeMap render incidents + hotspots + byType", () => {
    const ctx = freshCtx();
    // CrimeMapTab.addIncident sends { type, lat, lon, address, severity }
    for (let n = 0; n < 4; n++) {
      const r = cad("mapAddIncident", ctx, { type: "auto theft", lat: 37.5 + n * 0.0001, lon: -122.5, address: "Lot", severity: "high" });
      assert.equal(r.ok, true);
    }
    // CrimeMapTab.refresh reads crimeMap → incidents[], hotspots[{centerLat,centerLon,incidentCount}], byType[]
    const m = cad("crimeMap", ctx, { radiusKm: 0.5, threshold: 3 });
    assert.equal(m.result.total, 4);
    assert.ok(m.result.hotspots.length >= 1);
    assert.equal(m.result.hotspots[0].incidentCount, 4);
    assert.ok(Number.isFinite(m.result.hotspots[0].centerLat));
    assert.deepEqual(m.result.byType[0], { type: "auto theft", count: 4 });
  });

  it("Warrants: issue → attempt → list render warrantNumber + status counts", () => {
    const ctx = freshCtx();
    // WarrantsTab.issue sends { subject, warrantType, caseNumber, charges, issuingJudge, validDays }
    const w = cad("warrantIssue", ctx, { subject: "John Doe", warrantType: "arrest", caseNumber: "24-00123", charges: "robbery, assault", issuingJudge: "Hon. Patel", validDays: 30 });
    assert.equal(w.ok, true);
    assert.match(w.result.warrant.warrantNumber, /^WR-/);  // banner + register chip
    assert.equal(w.result.warrant.status, "active");
    assert.equal(w.result.warrant.charges, "robbery, assault"); // register row renders charges

    cad("warrantServiceAttempt", ctx, { warrantId: w.result.warrant.id, outcome: "not_home" });
    // WarrantsTab.refresh reads warrantList → warrants[], active, expiringSoon
    const l = cad("warrantList", ctx, {});
    assert.equal(l.result.total, 1);
    assert.equal(l.result.active, 1);
    assert.equal(l.result.warrants[0].attempts.length, 1);
    assert.ok(typeof l.result.expiringSoon === "number");
  });

  it("Reports: draft → submit → approve render statuteFound + status chain", () => {
    const ctx = freshCtx();
    // ReportsTab.draft sends { offense, narrative, location, caseNumber } and reads r.result.statuteFound
    const d = cad("reportDraft", ctx, { offense: "grand theft", narrative: "Suspect took the vehicle.", location: "3rd & Main", caseNumber: "24-00123" });
    assert.equal(d.ok, true);
    assert.equal(d.result.statuteFound, true);
    assert.equal(d.result.report.statute.code, "PC 487"); // statute chip
    const reportId = d.result.report.id;

    cad("reportSubmit", ctx, { reportId });
    // ReportsTab.refresh reads reportList → reports[], pendingApproval
    const pending = cad("reportList", ctx, {});
    assert.equal(pending.result.pendingApproval, 1);

    // ReportsTab.review sends { reportId, decision, supervisor }
    const ap = cad("reportApprove", ctx, { reportId, decision: "approve", supervisor: "Sgt. Cole" });
    assert.equal(ap.result.report.status, "approved");
    assert.equal(ap.result.report.approvedBy, "Sgt. Cole");
  });

  it("Booking: create renders complete + missingFields + statutes the booking log shows", () => {
    const ctx = freshCtx();
    // BookingTab.createBooking sends charges as a real array (split+trim+filter).
    const incomplete = cad("bookingCreate", ctx, { kind: "arrest", subjectName: "Jane Doe", charges: ["burglary"], mugshotCaptured: false, printsCaptured: false });
    assert.equal(incomplete.result.complete, false);
    assert.ok(incomplete.result.missingFields.includes("mugshot"));
    assert.ok(incomplete.result.missingFields.includes("prints"));
    // statutes auto-populate from the charge (PC 459 Burglary) → rendered as chips
    assert.ok(incomplete.result.booking.statutes.some((s) => s.code === "PC 459"));

    const complete = cad("bookingCreate", ctx, { kind: "arrest", subjectName: "John Roe", charges: ["assault"], mugshotCaptured: true, printsCaptured: true });
    assert.equal(complete.result.complete, true);

    // BookingTab.refresh reads bookingList → bookings[], arrests, fieldInterviews
    cad("bookingCreate", ctx, { kind: "field_interview", subjectName: "Witness W" });
    const list = cad("bookingList", ctx, {});
    assert.equal(list.result.arrests, 2);
    assert.equal(list.result.fieldInterviews, 1);
  });
});

// ===========================================================================
// Validation-rejection
// ===========================================================================
describe("law-enforcement — validation rejection (honest { ok:false, error })", () => {
  it("cadCreateCall rejects missing callType / location", () => {
    const ctx = freshCtx();
    assert.equal(cad("cadCreateCall", ctx, { location: "x" }).ok, false);
    assert.equal(cad("cadCreateCall", ctx, { callType: "x" }).ok, false);
  });
  it("evidenceTransfer rejects missing recipient / signature", () => {
    const ctx = freshCtx();
    const e = cad("evidenceIntake", ctx, { description: "phone" });
    assert.equal(cad("evidenceTransfer", ctx, { evidenceId: e.result.evidence.id, to: "Lab" }).ok, false);
    assert.equal(cad("evidenceTransfer", ctx, { evidenceId: e.result.evidence.id, signature: "s" }).ok, false);
  });
  it("scheduleShift rejects an unknown officer and out-of-range hours", () => {
    const ctx = freshCtx();
    assert.equal(cad("scheduleShift", ctx, { officerId: "nope", date: "2026-01-01" }).ok, false);
    const o = cad("rosterAddOfficer", ctx, { name: "OT" });
    assert.equal(cad("scheduleShift", ctx, { officerId: o.result.officer.id, date: "2026-01-01", hours: 99 }).ok, false);
    assert.equal(cad("scheduleShift", ctx, { officerId: o.result.officer.id, date: "2026-01-01", hours: 0 }).ok, false);
  });
  it("warrantIssue rejects a missing subject; reportDraft rejects missing offense/narrative", () => {
    const ctx = freshCtx();
    assert.equal(cad("warrantIssue", ctx, {}).ok, false);
    assert.equal(cad("reportDraft", ctx, { offense: "x" }).ok, false);
    assert.equal(cad("reportDraft", ctx, { narrative: "y" }).ok, false);
  });
  it("bookingCreate rejects a missing subjectName", () => {
    assert.equal(cad("bookingCreate", freshCtx(), {}).ok, false);
  });
});

// ===========================================================================
// Degrade-graceful — empty stores never throw, never fabricate
// ===========================================================================
describe("law-enforcement — degrade-graceful empty reads", () => {
  it("every list/board read on an empty store returns ok:true with zero counts", () => {
    const ctx = freshCtx();
    const q = cad("cadCallQueue", ctx, {});
    assert.equal(q.ok, true); assert.equal(q.result.activeCount, 0); assert.deepEqual(q.result.queue, []);
    const b = cad("cadUnitBoard", ctx, {});
    assert.equal(b.ok, true); assert.equal(b.result.totalUnits, 0);
    const ev = cad("evidenceList", ctx, {});
    assert.equal(ev.ok, true); assert.equal(ev.result.total, 0); assert.deepEqual(ev.result.byLocker, []);
    const ro = cad("rosterBoard", ctx, {});
    assert.equal(ro.ok, true); assert.equal(ro.result.totalOfficers, 0);
    const cm = cad("crimeMap", ctx, {});
    assert.equal(cm.ok, true); assert.equal(cm.result.total, 0); assert.deepEqual(cm.result.hotspots, []);
    const wl = cad("warrantList", ctx, {});
    assert.equal(wl.ok, true); assert.equal(wl.result.total, 0);
    const rl = cad("reportList", ctx, {});
    assert.equal(rl.ok, true); assert.equal(rl.result.total, 0);
    const bl = cad("bookingList", ctx, {});
    assert.equal(bl.ok, true); assert.equal(bl.result.total, 0);
  });
});

// ===========================================================================
// Fail-CLOSED poisoned-numeric — Number.isFinite gate on geospatial input
// ===========================================================================
describe("law-enforcement — fail-CLOSED on poisoned numeric coordinates", () => {
  it("mapAddIncident rejects NaN / Infinity / non-numeric lat or lon (never stores a poisoned point)", () => {
    const ctx = freshCtx();
    for (const bad of [
      { type: "x", lat: "NaN", lon: -122 },
      { type: "x", lat: Infinity, lon: 0 },
      { type: "x", lat: 37, lon: "not-a-number" },
      { type: "x", lat: null, lon: null },
    ]) {
      const r = cad("mapAddIncident", ctx, bad);
      assert.equal(r.ok, false, `expected fail-closed for ${JSON.stringify(bad)}`);
    }
    // out-of-range finite numbers are also rejected (lat/lon bounds)
    assert.equal(cad("mapAddIncident", ctx, { type: "x", lat: 999, lon: 0 }).ok, false);
    assert.equal(cad("mapAddIncident", ctx, { type: "x", lat: 0, lon: -999 }).ok, false);
    // and a poisoned store never accumulated a row
    const m = cad("crimeMap", ctx, {});
    assert.equal(m.result.total, 0);
  });

  it("crimeMap with a poisoned radius/threshold still returns finite hotspot centers", () => {
    const ctx = freshCtx();
    for (let n = 0; n < 3; n++) cad("mapAddIncident", ctx, { type: "robbery", lat: 40 + n * 0.0001, lon: -73 });
    // CrimeMapTab passes Number(radius)/Number(threshold); a blank field yields NaN.
    const m = cad("crimeMap", ctx, { radiusKm: NaN, threshold: NaN });
    assert.equal(m.ok, true);
    for (const h of m.result.hotspots) {
      assert.ok(Number.isFinite(h.centerLat) && Number.isFinite(h.centerLon));
      assert.ok(Number.isFinite(h.incidentCount));
    }
  });
});
