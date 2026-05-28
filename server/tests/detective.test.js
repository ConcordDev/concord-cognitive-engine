// Phase CA5 — detective deduction tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  listOpenCrimes, listEvidenceForCrime, lockInDeduction, getDeductionsByUser,
} from "../lib/detective.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal crime tables from mig 065 — only what detective.js reads.
  db.exec(`
    CREATE TABLE crime_events (
      id TEXT PRIMARY KEY, world_id TEXT, crime_type TEXT, location_type TEXT,
      location_id TEXT, criminal_id TEXT, criminal_type TEXT,
      victim_id TEXT, victim_type TEXT,
      evidence TEXT DEFAULT '[]', witnesses TEXT DEFAULT '[]',
      status TEXT DEFAULT 'open', detective_id TEXT, suspect_ids TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0, stolen_items TEXT DEFAULT '[]',
      occurred_at INTEGER, resolved_at INTEGER, report_text TEXT
    );
    CREATE TABLE evidence_items (
      id TEXT PRIMARY KEY, crime_event_id TEXT, world_id TEXT,
      evidence_type TEXT, description TEXT,
      links_to_id TEXT, links_to_type TEXT,
      confidence_boost REAL DEFAULT 0.1, collected_by TEXT,
      collected_at INTEGER, decay_at INTEGER, created_at INTEGER
    );
    CREATE TABLE arrest_records (
      id TEXT PRIMARY KEY, world_id TEXT, crime_id TEXT,
      arresting_detective_id TEXT, suspect_id TEXT, suspect_type TEXT,
      charges TEXT, evidence_summary TEXT,
      verdict TEXT, sentence_type TEXT, sentence_data TEXT,
      processed_at INTEGER
    );
  `);
  return db;
}

function seedCrime(db, opts = {}) {
  const id = opts.id || "crime-1";
  db.prepare(`
    INSERT INTO crime_events (id, world_id, crime_type, location_type, location_id, criminal_id, criminal_type, occurred_at)
    VALUES (?, ?, ?, 'room', ?, ?, 'npc', unixepoch())
  `).run(id, opts.worldId || "tunya", opts.crimeType || "theft", opts.locationId || "room-1", opts.criminalId || "npc-criminal");
  return id;
}

describe("Phase CA5 — detective deduction", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("listOpenCrimes filters by world + status", () => {
    seedCrime(db, { id: "c1", worldId: "tunya" });
    seedCrime(db, { id: "c2", worldId: "cyber" });
    const tunya = listOpenCrimes(db, "tunya");
    assert.equal(tunya.length, 1);
    assert.equal(tunya[0].id, "c1");
  });

  it("listEvidenceForCrime returns linked evidence", () => {
    const c = seedCrime(db);
    db.prepare(`INSERT INTO evidence_items (id, crime_event_id, world_id, evidence_type, description, links_to_id) VALUES ('e1', ?, 'tunya', 'footprint', 'small boot', 'npc-criminal')`).run(c);
    db.prepare(`INSERT INTO evidence_items (id, crime_event_id, world_id, evidence_type, description) VALUES ('e2', ?, 'tunya', 'blood', 'red spatter')`).run(c);
    const list = listEvidenceForCrime(db, c);
    assert.equal(list.length, 2);
  });

  it("lockInDeduction solves crime when suspect matches + 2-of-3 reasons hit", () => {
    const c = seedCrime(db, { crimeType: "theft", criminalId: "npc-criminal" });
    const r = lockInDeduction(db, "u1", c, {
      suspectId: "npc-criminal",
      weapon: "theft",
      motive: "money",
    });
    assert.equal(r.ok, true);
    assert.equal(r.correctCount, 3);
    assert.equal(r.solved, true);
    const crime = db.prepare(`SELECT status FROM crime_events WHERE id = ?`).get(c);
    assert.equal(crime.status, "solved");
  });

  it("wrong suspect → not solved, even with motive offered", () => {
    const c = seedCrime(db, { crimeType: "theft", criminalId: "npc-criminal" });
    const r = lockInDeduction(db, "u1", c, {
      suspectId: "innocent-npc",
      weapon: "theft",
      motive: "money",
    });
    assert.equal(r.solved, false);
    const crime = db.prepare(`SELECT status FROM crime_events WHERE id = ?`).get(c);
    assert.equal(crime.status, "open", "case stays open on wrong suspect");
  });

  it("already-closed case rejects further deductions", () => {
    const c = seedCrime(db);
    db.prepare(`UPDATE crime_events SET status = 'solved' WHERE id = ?`).run(c);
    const r = lockInDeduction(db, "u1", c, { suspectId: "x", weapon: "theft", motive: "m" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "case_closed");
  });

  it("getDeductionsByUser returns per-user attempts newest-first", () => {
    const c = seedCrime(db);
    lockInDeduction(db, "u1", c, { suspectId: "x", weapon: "theft", motive: "m" });
    const list = getDeductionsByUser(db, "u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].suspect_id, "x");
  });
});
