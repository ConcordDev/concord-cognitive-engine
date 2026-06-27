// Macro surface for the detective lens (server/domains/detective.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB built from the actual migrations (065
// crime/evidence + 300 trial_records), and asserts each macro delegates to the
// real lib AND reads/mutates the database for REAL. No { ok:true }-only
// assertions: the load-bearing case is the 2-of-3 lock-in rule WITH a
// suspect_match required, and the persisted trial_records verdict row.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDetectiveMacros from "../domains/detective.js";
import { up as upCrime } from "../migrations/065_crime_and_jobs.js";
import { up as upTrial } from "../migrations/300_trial_records.js";

function collectMacros() {
  const map = new Map();
  registerDetectiveMacros((domain, name, handler) => {
    assert.equal(domain, "detective", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

const WORLD = "tunya";
const CRIME = "crime_1";
const CULPRIT = "npc_mallory";

function freshDb() {
  const db = new Database(":memory:");
  // Migration 065 unconditionally ALTERs world_npcs (its building-table ALTERs
  // are try/guarded, but this one isn't). Provide the minimal table so the real
  // migration runs and creates the canonical crime_events / evidence_items
  // schema we test against.
  db.exec("CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, name TEXT);");
  upCrime(db);
  upTrial(db);
  // One open theft committed by a known culprit, with one evidence item.
  db.prepare(`
    INSERT INTO crime_events (id, world_id, crime_type, location_type, location_id,
                              criminal_id, criminal_type, victim_id, status, occurred_at)
    VALUES (?, ?, 'theft', 'building', 'bld_market', ?, 'npc', 'npc_victim', 'open', unixepoch())
  `).run(CRIME, WORLD, CULPRIT);
  db.prepare(`
    INSERT INTO evidence_items (id, crime_event_id, world_id, evidence_type, description,
                                links_to_id, links_to_type, collected_at)
    VALUES ('ev_1', ?, ?, 'footprint', 'A muddy bootprint by the till.', ?, 'npc', unixepoch())
  `).run(CRIME, WORLD, CULPRIT);
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

describe("detective domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + act surface", () => {
    for (const name of ["list", "get", "evidence", "deduce", "create", "mine"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("list returns the open case for a world and omits the culprit", async () => {
    const r = await macros.get("list")(ctxFor(db, "u1"), { worldId: WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.crimes.length, 1);
    assert.equal(r.crimes[0].id, CRIME);
    assert.equal(r.crimes[0].crime_type, "theft");
    // The answer must NOT be on the board.
    assert.equal(r.crimes[0].criminal_id, undefined, "criminal_id leaked to the board");

    const empty = await macros.get("list")(ctxFor(db, "u1"), { worldId: "nowhere" });
    assert.equal(empty.ok, true);
    assert.equal(empty.crimes.length, 0);
  });

  it("get returns the case + evidence without leaking the culprit", async () => {
    const r = await macros.get("get")(ctxFor(db, "u1"), { crimeId: CRIME });
    assert.equal(r.ok, true);
    assert.equal(r.crime.id, CRIME);
    assert.equal(r.crime.criminal_id, undefined, "criminal_id leaked via get");
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].evidence_type, "footprint");

    const missing = await macros.get("get")(ctxFor(db, "u1"), { crimeId: "nope" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "no_crime");
  });

  it("evidence returns the collected clues for a case", async () => {
    const r = await macros.get("evidence")(ctxFor(db, "u1"), { crimeId: CRIME });
    assert.equal(r.ok, true);
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].links_to_id, CULPRIT);
  });

  it("deduce with only a suspect_match (1/3) does NOT solve the case", async () => {
    const r = await macros.get("deduce")(ctxFor(db, "u1"), {
      crimeId: CRIME, suspectId: CULPRIT, // correct suspect, wrong/empty weapon+motive
    });
    assert.equal(r.ok, true);
    assert.equal(r.correctCount, 1);
    assert.deepEqual(r.reasons, ["suspect_match"]);
    assert.equal(r.solved, false, "1/3 must not solve");

    const crime = db.prepare("SELECT status FROM crime_events WHERE id=?").get(CRIME);
    assert.equal(crime.status, "open", "case must stay open");

    // The attempt is still persisted as a pending verdict.
    const tr = db.prepare("SELECT verdict FROM trial_records WHERE crime_event_id=?").get(CRIME);
    assert.equal(tr.verdict, "pending");
  });

  it("deduce with 2/3 but NO suspect_match does NOT solve (suspect_match required)", async () => {
    const r = await macros.get("deduce")(ctxFor(db, "u1"), {
      crimeId: CRIME, suspectId: "npc_innocent", // WRONG suspect
      weapon: "theft", motive: "greed",          // both score → correctCount 2
    });
    assert.equal(r.ok, true);
    assert.equal(r.correctCount, 2);
    assert.ok(!r.reasons.includes("suspect_match"), "should not have suspect_match");
    assert.equal(r.solved, false, "2/3 without suspect_match must NOT solve");

    const crime = db.prepare("SELECT status FROM crime_events WHERE id=?").get(CRIME);
    assert.equal(crime.status, "open");
  });

  it("deduce with 2/3 INCLUDING suspect_match SOLVES the case and persists a guilty verdict", async () => {
    const r = await macros.get("deduce")(ctxFor(db, "u1"), {
      crimeId: CRIME, suspectId: CULPRIT, weapon: "theft", // suspect_match + weapon_match = 2
    });
    assert.equal(r.ok, true);
    assert.equal(r.correctCount, 2);
    assert.ok(r.reasons.includes("suspect_match"));
    assert.ok(r.reasons.includes("weapon_match"));
    assert.equal(r.solved, true, "2/3 with suspect_match must solve");

    const crime = db.prepare("SELECT status, resolved_at FROM crime_events WHERE id=?").get(CRIME);
    assert.equal(crime.status, "solved");
    assert.ok(crime.resolved_at > 0, "resolved_at stamped");

    // The trial/arrest record is persisted with a guilty verdict.
    const tr = db.prepare(
      "SELECT detective_id, suspect_id, verdict FROM trial_records WHERE crime_event_id=?"
    ).get(CRIME);
    assert.equal(tr.detective_id, "u1");
    assert.equal(tr.suspect_id, CULPRIT);
    assert.equal(tr.verdict, "guilty");

    // A solved case leaves the open list.
    const open = await macros.get("list")(ctxFor(db, "u1"), { worldId: WORLD });
    assert.equal(open.crimes.length, 0);

    // mine surfaces the deduction history.
    const mine = await macros.get("mine")(ctxFor(db, "u1"), {});
    assert.equal(mine.ok, true);
    assert.equal(mine.deductions.length, 1);
    assert.equal(mine.deductions[0].suspect_id, CULPRIT);
  });

  it("deduce on an already-solved case is rejected (case_closed)", async () => {
    await macros.get("deduce")(ctxFor(db, "u1"), { crimeId: CRIME, suspectId: CULPRIT, weapon: "theft" });
    const again = await macros.get("deduce")(ctxFor(db, "u2"), { crimeId: CRIME, suspectId: CULPRIT, weapon: "theft" });
    assert.equal(again.ok, false);
    assert.equal(again.error, "case_closed");
  });

  it("create is a true alias of deduce (same solve semantics)", async () => {
    const r = await macros.get("create")(ctxFor(db, "u1"), {
      crimeId: CRIME, suspectId: CULPRIT, weapon: "theft", motive: "greed",
    });
    assert.equal(r.ok, true);
    assert.equal(r.correctCount, 3);
    assert.equal(r.solved, true);
  });

  it("guards: no db / no user / missing inputs are rejected, not crashed", async () => {
    assert.equal((await macros.get("list")({}, { worldId: WORLD })).reason, "no_db");
    assert.equal((await macros.get("list")(ctxFor(db, "u1"), {})).reason, "missing_world");
    assert.equal((await macros.get("get")(ctxFor(db, "u1"), {})).reason, "missing_inputs");
    assert.equal((await macros.get("mine")(ctxFor(db, null), {})).reason, "no_user");
    assert.equal((await macros.get("deduce")(ctxFor(db, "u1"), { crimeId: CRIME })).error, "missing_suspect");
    assert.equal((await macros.get("deduce")(ctxFor(db, null), { crimeId: CRIME, suspectId: "x" })).reason, "no_user");
  });
});
