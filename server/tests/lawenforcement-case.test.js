// server/tests/lawenforcement-case.test.js
//
// Contract + DB-persistence tests for the law-enforcement "Case" entity
// (migration 362 — le_cases, domains/lawenforcement.js caseCreate/caseGet/
// caseList/caseUpdate/caseLinked). See docs/lens-specs/
// law-enforcement-capability-map.md ("No persisted 'Case' record type
// exists server-side" — now closed) and docs/WAVE4_INVENTORY.md's
// `| law-enforcement |` row.
//
// Two halves:
//   1. In-memory fallback (no ctx.db) — same pattern as
//      law-enforcement-domain-parity.test.js, covers the macro contract
//      and the status-transition state machine.
//   2. Real DB persistence (mirrors tests/tournaments-persistence.test.js)
//      — proves case rows land in the ACTUAL le_cases SQL table (not just
//      the macro's own reader), survive a second independent DB handle,
//      and that caseLinked correctly joins reports/evidence/bookings by
//      caseNumber while excluding non-matching records.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerLawEnforcementActions from "../domains/lawenforcement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law-enforcement.${name}`);
  if (!fn) throw new Error(`law-enforcement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawEnforcementActions(register); });

let seq = 0;
function freshCtx(db) {
  seq += 1;
  const userId = `le_case_user_${seq}`;
  return db ? { db, actor: { userId }, userId } : { actor: { userId }, userId };
}

// ===========================================================================
// In-memory fallback — macro contract + status state machine.
// ===========================================================================
describe("law-enforcement caseCreate/caseGet/caseList/caseUpdate — in-memory fallback", () => {
  beforeEach(() => {
    if (globalThis._concordSTATE) delete globalThis._concordSTATE._lawEnforcement;
  });

  it("caseCreate requires a title and defaults status to open", () => {
    const ctx = freshCtx();
    const missing = call("caseCreate", ctx, {});
    assert.equal(missing.ok, false);

    const c = call("caseCreate", ctx, { title: "Oak St burglary series", synopsis: "3 linked break-ins" });
    assert.equal(c.ok, true, c.error);
    assert.equal(c.result.case.title, "Oak St burglary series");
    assert.equal(c.result.case.status, "open");
    assert.ok(c.result.case.caseNumber.startsWith("CASE-"));
    assert.ok(c.result.case.id);
  });

  it("caseCreate normalizes a caller-supplied caseNumber and rejects a duplicate for the same officer", () => {
    const ctx = freshCtx();
    const a = call("caseCreate", ctx, { title: "First", caseNumber: "  c-2026-0042  " });
    assert.equal(a.ok, true, a.error);
    assert.equal(a.result.case.caseNumber, "C-2026-0042");

    const dup = call("caseCreate", ctx, { title: "Second", caseNumber: "c-2026-0042" });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already exists/);
  });

  it("caseGet resolves by id AND by (normalized) caseNumber", () => {
    const ctx = freshCtx();
    const c = call("caseCreate", ctx, { title: "Resolvable", caseNumber: "case-77" });
    const byId = call("caseGet", ctx, { id: c.result.case.id });
    assert.equal(byId.ok, true);
    assert.equal(byId.result.case.id, c.result.case.id);

    const byNumber = call("caseGet", ctx, { caseNumber: "CASE-77" });
    assert.equal(byNumber.ok, true);
    assert.equal(byNumber.result.case.id, c.result.case.id);

    const missing = call("caseGet", ctx, { id: "nope" });
    assert.equal(missing.ok, false);
  });

  it("caseList scopes per-officer and filters by status", () => {
    const ctx1 = freshCtx();
    const ctx2 = freshCtx();
    call("caseCreate", ctx1, { title: "Officer1 case A" });
    call("caseCreate", ctx1, { title: "Officer1 case B" });
    call("caseCreate", ctx2, { title: "Officer2 case" });

    const list1 = call("caseList", ctx1, {});
    assert.equal(list1.result.total, 2);
    const list2 = call("caseList", ctx2, {});
    assert.equal(list2.result.total, 1);

    const closedCase = call("caseCreate", ctx1, { title: "Officer1 closed" });
    call("caseUpdate", ctx1, { id: closedCase.result.case.id, status: "closed", closureReason: "cleared by arrest" });
    const openOnly = call("caseList", ctx1, { status: "open" });
    assert.equal(openOnly.result.total, 2);
    const closedOnly = call("caseList", ctx1, { status: "closed" });
    assert.equal(closedOnly.result.total, 1);
  });

  it("caseUpdate enforces the status state machine and rejects invalid transitions", () => {
    const ctx = freshCtx();
    const c = call("caseCreate", ctx, { title: "Lifecycle case" });
    const id = c.result.case.id;

    // open -> cold is not allowed (must go through under_investigation).
    const badJump = call("caseUpdate", ctx, { id, status: "cold" });
    assert.equal(badJump.ok, false);
    assert.match(badJump.error, /invalid transition/);

    // open -> under_investigation is allowed.
    const toInvestigation = call("caseUpdate", ctx, { id, status: "under_investigation", assignedDetective: "Det. Ramos" });
    assert.equal(toInvestigation.ok, true, toInvestigation.error);
    assert.equal(toInvestigation.result.case.status, "under_investigation");
    assert.equal(toInvestigation.result.case.assignedDetective, "Det. Ramos");

    // under_investigation -> closed is allowed, and stamps closedAt/closureReason.
    const toClosed = call("caseUpdate", ctx, { id, status: "closed", closureReason: "arrest made" });
    assert.equal(toClosed.ok, true, toClosed.error);
    assert.equal(toClosed.result.case.status, "closed");
    assert.ok(toClosed.result.case.closedAt);
    assert.equal(toClosed.result.case.closureReason, "arrest made");

    // closed -> open (reopen) is allowed and clears the closure stamp.
    const reopened = call("caseUpdate", ctx, { id, status: "open" });
    assert.equal(reopened.ok, true, reopened.error);
    assert.equal(reopened.result.case.status, "open");
    assert.equal(reopened.result.case.closedAt, null);
    assert.equal(reopened.result.case.closureReason, null);

    // Unknown status is rejected outright.
    const badStatus = call("caseUpdate", ctx, { id, status: "archived" });
    assert.equal(badStatus.ok, false);

    // Unknown case id is rejected.
    const badId = call("caseUpdate", ctx, { id: "nope", status: "closed" });
    assert.equal(badId.ok, false);
  });

  it("caseUpdate can patch title/synopsis/assignedDetective without touching status", () => {
    const ctx = freshCtx();
    const c = call("caseCreate", ctx, { title: "Draft title" });
    const r = call("caseUpdate", ctx, { id: c.result.case.id, title: "Final title", synopsis: "Updated synopsis" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.case.status, "open");
    assert.equal(r.result.case.title, "Final title");
    assert.equal(r.result.case.synopsis, "Updated synopsis");
  });

  it("caseLinked joins reports/evidence/bookings/warrants by caseNumber and excludes non-matching records", () => {
    const ctx = freshCtx();
    const c = call("caseCreate", ctx, { title: "Linked case", caseNumber: "LINK-1" });

    // Matching records (case-insensitive caseNumber match).
    call("reportDraft", ctx, { offense: "burglary", narrative: "Forced entry at 12 Oak St.", caseNumber: "link-1" });
    call("evidenceIntake", ctx, { description: "Crowbar", caseNumber: "LINK-1" });
    call("bookingCreate", ctx, { subjectName: "John Doe", caseNumber: "Link-1" });
    call("warrantIssue", ctx, { subject: "John Doe", caseNumber: "LINK-1" });

    // Non-matching records — must be excluded.
    call("reportDraft", ctx, { offense: "theft", narrative: "Unrelated shoplifting report.", caseNumber: "OTHER-9" });
    call("evidenceIntake", ctx, { description: "Unrelated bag", caseNumber: "OTHER-9" });
    call("bookingCreate", ctx, { subjectName: "Jane Roe", caseNumber: "OTHER-9" });
    // A record with no caseNumber at all must also be excluded.
    call("reportDraft", ctx, { offense: "vandalism", narrative: "No case number on this one." });

    const linked = call("caseLinked", ctx, { id: c.result.case.id });
    assert.equal(linked.ok, true, linked.error);
    assert.equal(linked.result.counts.reports, 1);
    assert.equal(linked.result.counts.evidence, 1);
    assert.equal(linked.result.counts.bookings, 1);
    assert.equal(linked.result.counts.warrants, 1);
    assert.equal(linked.result.reports[0].narrative, "Forced entry at 12 Oak St.");
    assert.equal(linked.result.evidence[0].description, "Crowbar");
    assert.equal(linked.result.bookings[0].subjectName, "John Doe");
    assert.equal(linked.result.warrants[0].subject, "John Doe");

    // Also resolvable by caseNumber instead of id.
    const linkedByNumber = call("caseLinked", ctx, { caseNumber: "link-1" });
    assert.equal(linkedByNumber.ok, true);
    assert.equal(linkedByNumber.result.counts.reports, 1);
  });

  it("caseLinked returns ok:false for an unknown case", () => {
    const ctx = freshCtx();
    const r = call("caseLinked", ctx, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

// ===========================================================================
// Real DB persistence (migration 362 — le_cases).
// ===========================================================================
describe("law-enforcement cases — DB persistence (durable, restart-equivalent)", () => {
  let db;
  let dbFile;

  beforeEach(async () => {
    dbFile = path.join(
      os.tmpdir(),
      `le-cases-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = new Database(dbFile);
    await runMigrations(db);
    // Keep the in-memory fallback empty so we can be sure the DB path is exercised.
    globalThis._concordSTATE = {};
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it("persists a created case into le_cases, not a process Map", () => {
    const ctx = freshCtx(db);
    const c = call("caseCreate", ctx, { title: "Durable case", caseNumber: "DUR-1", assignedDetective: "Det. Nakamura" });
    assert.equal(c.ok, true, c.error);
    const id = c.result.case.id;

    // Load-bearing proof: query the RAW SQL table directly, not through the
    // macro's own getById handler.
    const row = db.prepare("SELECT * FROM le_cases WHERE id = ?").get(id);
    assert.ok(row, "case row must exist on disk in le_cases");
    assert.equal(row.user_id, ctx.userId);
    assert.equal(row.title, "Durable case");
    assert.equal(row.case_number, "DUR-1");
    assert.equal(row.status, "open");
    assert.equal(row.assigned_detective, "Det. Nakamura");

    // The process-global in-memory fallback must be untouched.
    assert.equal(globalThis._concordSTATE._lawEnforcement, undefined);
  });

  it("survives a brand-new independent DB handle to the same file (restart-equivalence)", () => {
    const ctx = freshCtx(db);
    const c = call("caseCreate", ctx, { title: "Restart case", caseNumber: "RST-1" });
    const id = c.result.case.id;
    call("caseUpdate", ctx, { id, status: "under_investigation" });

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare("SELECT * FROM le_cases WHERE id = ?").get(id);
      assert.ok(row, "row must be visible from a second, independent handle");
      assert.equal(row.status, "under_investigation");
    } finally {
      db2.close();
    }
  });

  it("scopes per-officer in the DB — never leaks across users", () => {
    const ctx1 = freshCtx(db);
    const ctx2 = freshCtx(db);
    call("caseCreate", ctx1, { title: "Officer1 only" });
    assert.equal(call("caseList", ctx1, {}).result.total, 1);
    assert.equal(call("caseList", ctx2, {}).result.total, 0);
  });

  it("caseLinked joins reports/evidence/bookings by caseNumber through the DB-backed case path", () => {
    const ctx = freshCtx(db);
    const c = call("caseCreate", ctx, { title: "DB linked case", caseNumber: "DBLINK-1" });
    call("reportDraft", ctx, { offense: "robbery", narrative: "DB-path linked report.", caseNumber: "dblink-1" });
    call("evidenceIntake", ctx, { description: "DB-path evidence", caseNumber: "DBLINK-1" });
    call("bookingCreate", ctx, { subjectName: "DB Suspect", caseNumber: "DBLINK-1" });
    call("reportDraft", ctx, { offense: "theft", narrative: "Unrelated.", caseNumber: "NOPE" });

    const linked = call("caseLinked", ctx, { id: c.result.case.id });
    assert.equal(linked.ok, true, linked.error);
    assert.equal(linked.result.counts.reports, 1);
    assert.equal(linked.result.counts.evidence, 1);
    assert.equal(linked.result.counts.bookings, 1);
  });

  it("rejects a duplicate caseNumber for the same officer through the DB unique index", () => {
    const ctx = freshCtx(db);
    const a = call("caseCreate", ctx, { title: "First", caseNumber: "DUPE-1" });
    assert.equal(a.ok, true, a.error);
    const b = call("caseCreate", ctx, { title: "Second", caseNumber: "DUPE-1" });
    assert.equal(b.ok, false);
    const rows = db.prepare("SELECT COUNT(*) n FROM le_cases WHERE case_number = 'DUPE-1'").get();
    assert.equal(rows.n, 1);
  });

  it("caseGet resolves by id and by caseNumber against the DB", () => {
    const ctx = freshCtx(db);
    const c = call("caseCreate", ctx, { title: "Findable", caseNumber: "FIND-1" });
    const byId = call("caseGet", ctx, { id: c.result.case.id });
    assert.equal(byId.ok, true);
    const byNumber = call("caseGet", ctx, { caseNumber: "find-1" });
    assert.equal(byNumber.ok, true);
    assert.equal(byNumber.result.case.id, c.result.case.id);
  });
});
