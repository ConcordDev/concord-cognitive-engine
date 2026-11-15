// Audit fix sweep (PR #2356) — FIX-courtship-007 pins:
//  (a) an interaction the affinity cap swallows reports capped:true
//      (it used to return a plain ok and the UI silently refreshed);
//  (b) the 95% milestone scene ("The Long Field") no longer speaks of
//      vows/a wedding — it fires on affinity alone, for couples with
//      zero marriages, so its text must be true at any marital state.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { courtInteraction } from "../lib/romance-engine.js";
import { loadHeartEvents, _resetHeartEvents } from "../lib/heart-events.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_courtship (
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      affinity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'acquainted',
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (player_user_id, partner_kind, partner_id)
    );
    CREATE TABLE player_heart_events_seen (
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      milestone_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

function seed(affinity, status = "courting") {
  db.prepare(`INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u1', 'npc', 'n1', ?, ?)`)
    .run(affinity, status);
}

describe("courtship capped interactions say so", () => {
  it("reports capped at the affinity peak", () => {
    seed(1.0);
    const r = courtInteraction(db, "u1", "npc", "n1", 1);
    assert.equal(r.ok, true);
    assert.equal(r.affinity, 1);
    assert.equal(r.capped, true);
  });

  it("reports capped at the affinity floor", () => {
    seed(-1.0);
    const r = courtInteraction(db, "u1", "npc", "n1", -1);
    assert.equal(r.ok, true);
    assert.equal(r.affinity, -1);
    assert.equal(r.capped, true);
  });

  it("does not report capped when affinity actually moves", () => {
    seed(0.5);
    const r = courtInteraction(db, "u1", "npc", "n1", 1);
    assert.equal(r.ok, true);
    assert.equal(r.capped, false);
    assert.ok(r.affinity > 0.5);
  });
});

describe("The Long Field scene text matches the state it fires in", () => {
  it("speaks of no vows or wedding", () => {
    _resetHeartEvents();
    const scene = loadHeartEvents().find((s) => s.milestoneId === "the_long_field");
    assert.ok(scene, "the_long_field scene exists");
    const text = (scene.scene || []).map((d) => d.line).join(" ");
    assert.ok(!/vow|wedding/i.test(text), `scene text must not presuppose a marriage: ${text}`);
  });
});
