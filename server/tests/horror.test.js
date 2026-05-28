// Phase CC6 — asymmetric horror tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startSession, joinAsInvestigator, recordSighting, downInvestigator,
  endSession, getSession, EVIDENCE_TO_WIN,
} from "../lib/horror.js";
import { up as upHorror } from "../migrations/256_asymmetric_horror.js";

function freshDb() { const db = new Database(":memory:"); upHorror(db); return db; }

describe("Phase CC6 — asymmetric horror", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startSession + joinAsInvestigator round-trip", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    const j = joinAsInvestigator(db, s.sessionId, "inv1");
    assert.equal(j.ok, true);
    assert.deepEqual(j.investigators, ["inv1"]);
  });

  it("ghost cannot join as investigator", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    const j = joinAsInvestigator(db, s.sessionId, "ghost");
    assert.equal(j.ok, false);
    assert.equal(j.error, "ghost_cannot_investigate");
  });

  it("recordSighting accumulates distinct evidence; 3 kinds → investigators win", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    joinAsInvestigator(db, s.sessionId, "inv1");
    recordSighting(db, s.sessionId, "inv1", { x: 1, y: 1, z: 1, sightingKind: "blur" });
    recordSighting(db, s.sessionId, "inv1", { x: 2, y: 2, z: 2, sightingKind: "voice" });
    const win = recordSighting(db, s.sessionId, "inv1", { x: 3, y: 3, z: 3, sightingKind: "writing" });
    assert.equal(win.sessionEnded, true);
    assert.equal(win.winner, "investigators");
    assert.equal(win.evidenceCount, EVIDENCE_TO_WIN);
  });

  it("downInvestigator → ghost wins when all downed", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    joinAsInvestigator(db, s.sessionId, "inv1");
    joinAsInvestigator(db, s.sessionId, "inv2");
    const a = downInvestigator(db, s.sessionId, "ghost", "inv1");
    assert.equal(a.sessionEnded || false, false);
    const b = downInvestigator(db, s.sessionId, "ghost", "inv2");
    assert.equal(b.sessionEnded, true);
    assert.equal(b.winner, "ghost");
  });

  it("downInvestigator rejected when caller is not the ghost", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    joinAsInvestigator(db, s.sessionId, "inv1");
    const r = downInvestigator(db, s.sessionId, "stranger", "inv1");
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_ghost");
  });

  it("end manually cancels session", () => {
    const s = startSession(db, "ghost", { worldId: "tunya" });
    endSession(db, s.sessionId, { reason: "cancelled" });
    const row = getSession(db, s.sessionId);
    assert.equal(row.end_reason, "cancelled");
  });
});
