// server/tests/law-enforcement-full-build.test.js
//
// Build gate for the law-enforcement full lens build (2026-11-03,
// branch muse/law-enforcement) — the canonical slices from the filed
// first pass + Lead compilation (lens-reviews/law-enforcement.md):
//
//   S1  analysis scoping — crimeStats counts the lens's records (Crime
//       Map incidents + cases on file) alongside staged workbench rows
//       and names its scope; caseAnalysis weighs evidence actually
//       booked against a resolved case; patrolOptimize names its
//       staged-planning scope.
//   S2(i)   the identifier definition — evidenceTransfer/evidenceChain
//       accept the display ID (EVD-…) the booking issues, not only the
//       internal id (ev_…).
//   S2(ii)  the case lifecycle — caseUpdate title/synopsis edits (the
//       surfacing's server half) and the new caseDelete macro: deletes
//       the case row only, linked records stay on file and are counted
//       in the result.
//
// Harness mirrors law-enforcement-domain-parity.test.js: handlers
// driven directly, a fresh actor per test, store reset between tests.
// Cases exercise the in-memory fallback store (no ctx.db), the same
// store interface the le_cases table path implements.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawEnforcementActions from "../domains/lawenforcement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, data = undefined) {
  const fn = ACTIONS.get(`law-enforcement.${name}`);
  if (!fn) throw new Error(`law-enforcement.${name} not registered`);
  return fn(ctx, { id: null, data: data ?? {}, meta: {} }, params);
}

before(() => { registerLawEnforcementActions(register); });

let seq = 0;
function freshCtx() {
  seq += 1;
  return { actor: { userId: `le_build_${seq}` }, userId: `le_build_${seq}` };
}

beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._lawEnforcement;
});

describe("S2(i) — evidence identifier definition", () => {
  it("transfer accepts the display ID (EVD-…) the booking issues", () => {
    const ctx = freshCtx();
    const booked = call("evidenceIntake", ctx, { description: "9mm shell casing", caseNumber: "CASE-1", officer: "Ofc. A" });
    assert.equal(booked.ok, true);
    const { id, barcode } = booked.result.evidence;
    assert.match(barcode, /^EVD-/);

    const byDisplay = call("evidenceTransfer", ctx, { evidenceId: barcode, to: "Forensics Lab", signature: "Det. Wells" });
    assert.equal(byDisplay.ok, true);
    assert.equal(byDisplay.result.evidence.currentHolder, "Forensics Lab");

    // Display ID matching is case-insensitive.
    const lower = call("evidenceTransfer", ctx, { evidenceId: barcode.toLowerCase(), to: "Ofc. B", signature: "Det. Wells" });
    assert.equal(lower.ok, true);
    assert.equal(lower.result.evidence.currentHolder, "Ofc. B");

    // The internal id still works, and the chain resolves by display ID.
    const byInternal = call("evidenceTransfer", ctx, { evidenceId: id, to: "Ofc. C", signature: "Det. Wells" });
    assert.equal(byInternal.ok, true);
    const chain = call("evidenceChain", ctx, { evidenceId: barcode });
    assert.equal(chain.ok, true);
    assert.equal(chain.result.chainIntact, true);
    assert.equal(chain.result.transferCount, 4); // intake + 3 transfers
  });

  it("an unknown ID fails with an error naming both accepted forms", () => {
    const ctx = freshCtx();
    const r = call("evidenceTransfer", ctx, { evidenceId: "EVD-NOPE", to: "Lab", signature: "S" });
    assert.equal(r.ok, false);
    assert.match(r.error, /EVD-/);
    assert.match(r.error, /ev_/);
  });
});

describe("S2(ii) — case lifecycle: edit + delete", () => {
  it("caseUpdate edits title and synopsis (the surfacing's server half)", () => {
    const ctx = freshCtx();
    const created = call("caseCreate", ctx, { title: "Wrong title", synopsis: "old" });
    assert.equal(created.ok, true);
    const id = created.result.case.id;
    const edited = call("caseUpdate", ctx, { id, title: "Oak St burglary series", synopsis: "3 linked break-ins" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.case.title, "Oak St burglary series");
    const got = call("caseGet", ctx, { id });
    assert.equal(got.result.case.synopsis, "3 linked break-ins");
  });

  it("caseDelete removes the case row only — linked evidence stays on file and is counted", () => {
    const ctx = freshCtx();
    const created = call("caseCreate", ctx, { title: "Probe case", caseNumber: "CASE-DEL-1" });
    const id = created.result.case.id;
    call("evidenceIntake", ctx, { description: "booked item", caseNumber: "CASE-DEL-1", officer: "Ofc. A" });

    const del = call("caseDelete", ctx, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(del.result.case.caseNumber, "CASE-DEL-1");
    assert.equal(del.result.linked.evidence, 1);

    assert.equal(call("caseGet", ctx, { id }).ok, false);
    const list = call("evidenceList", ctx, {});
    assert.equal(list.result.total, 1); // custody record survives the case delete

    assert.equal(call("caseDelete", ctx, { id }).ok, false); // already gone
  });

  it("caseDelete resolves by case number and is owner-scoped", () => {
    const ctx = freshCtx();
    const other = freshCtx();
    call("caseCreate", ctx, { title: "Mine", caseNumber: "CASE-DEL-2" });
    assert.equal(call("caseDelete", other, { caseNumber: "CASE-DEL-2" }).ok, false); // not the owner's
    const del = call("caseDelete", ctx, { caseNumber: "case-del-2" }); // case-insensitive
    assert.equal(del.ok, true);
  });
});

describe("S1 — analysis scoping", () => {
  it("crimeStats counts the mapped incident and the case, not only staged rows", () => {
    const ctx = freshCtx();
    call("mapAddIncident", ctx, { type: "theft", lat: 41.7, lon: -73.9 });
    call("caseCreate", ctx, { title: "Standing case" });
    const r = call("crimeStats", ctx, {}, { incidents: [{ type: "dui", resolved: true }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalIncidents, 3);
    assert.deepEqual(r.result.sources, { mappedIncidents: 1, cases: 1, stagedRows: 1 });
    assert.equal(r.result.clearanceRate, 33); // only the staged resolved row clears
    assert.match(r.result.scope, /Crime Map incident\(s\)/);
    const byType = Object.fromEntries(r.result.byType.map((b) => [b.type, b.count]));
    assert.equal(byType.theft, 1);
    assert.equal(byType.case, 1);
    assert.equal(byType.dui, 1);
  });

  it("crimeStats over records alone (no staged rows) still reports, and a closed case clears", () => {
    const ctx = freshCtx();
    call("mapAddIncident", ctx, { type: "assault", lat: 41.7, lon: -73.9 });
    const c = call("caseCreate", ctx, { title: "Closable" });
    call("caseUpdate", ctx, { id: c.result.case.id, status: "under_investigation" });
    call("caseUpdate", ctx, { id: c.result.case.id, status: "closed" });
    const r = call("crimeStats", ctx, {}, {});
    assert.equal(r.result.totalIncidents, 2);
    assert.equal(r.result.clearanceRate, 50);
    assert.deepEqual(r.result.sources, { mappedIncidents: 1, cases: 1, stagedRows: 0 });
  });

  it("crimeStats with nothing on record returns the honest prompt, with scope", () => {
    const ctx = freshCtx();
    const r = call("crimeStats", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(typeof r.result.scope, "string");
    assert.equal(r.result.totalIncidents, undefined);
  });

  it("caseAnalysis sees the evidence booked against the resolved case", () => {
    const ctx = freshCtx();
    call("caseCreate", ctx, { title: "Strength case", caseNumber: "CASE-FE80EC" });
    call("evidenceIntake", ctx, { description: "PR2LAW-EVIDENCE-1101", caseNumber: "CASE-FE80EC", officer: "Ofc. A" });
    const r = call("caseAnalysis", ctx, {}, { caseId: "CASE-FE80EC", evidence: [{ description: "staged row" }], witnesses: [], suspects: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.bookedEvidenceCount, 1);
    assert.equal(r.result.stagedEvidenceCount, 1);
    assert.equal(r.result.evidenceCount, 2);
    assert.equal(r.result.linkedCase.caseNumber, "CASE-FE80EC");
    assert.match(r.result.scope, /booked in custody/);
  });

  it("caseAnalysis with no resolvable case stays staged-only and says so", () => {
    const ctx = freshCtx();
    const r = call("caseAnalysis", ctx, {}, { caseId: "CASE-UNKNOWN", evidence: [{}], witnesses: [{}], suspects: [] });
    assert.equal(r.result.bookedEvidenceCount, 0);
    assert.equal(r.result.evidenceCount, 1);
    assert.equal(r.result.linkedCase, null);
    assert.match(r.result.scope, /workbench entries only/);
  });

  it("patrolOptimize names its staged-planning scope on both paths", () => {
    const ctx = freshCtx();
    const empty = call("patrolOptimize", ctx, {}, { zones: [] });
    assert.match(empty.result.scope, /not detections/);
    const r = call("patrolOptimize", ctx, {}, { zones: [{ name: "North", crimeRate: "80", population: "1000", currentPatrols: "1" }] });
    assert.deepEqual(r.result.hotspots, ["North"]); // staged high-rate rows, labelled by scope
    assert.match(r.result.scope, /Crime Map is the lens's hotspot detector/);
  });
});
