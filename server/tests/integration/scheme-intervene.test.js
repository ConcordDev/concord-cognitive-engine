/**
 * T2.3 (plan) — scheme barge-in: interveneInScheme.
 *
 * Pins the three branches of the /schemes/:id/intervene route's core logic:
 *   - expose  → discovers evidence (may flip to 'exposed') + plotter resents you
 *   - abet    → player joins as accomplice, success_pct climbs, plotter warms
 *   - ignore  → no state change
 *   - terminal schemes reject intervention
 *
 * Run: node --test tests/integration/scheme-intervene.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up153 } from "../../migrations/153_npc_opinions.js";
import { up as up155 } from "../../migrations/155_npc_schemes.js";
import { interveneInScheme } from "../../lib/npc-schemes.js";
import { getOpinion } from "../../lib/npc-opinions.js";

function freshDb() {
  const db = new Database(":memory:");
  up153(db); up155(db);
  return db;
}
function scheme(db, { id, plotter = "plot", target = "victim", phase = "gathering_evidence", success = 30 }) {
  db.prepare(`
    INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct)
    VALUES (?, 'npc', ?, 'npc', ?, 'blackmail', ?, ?)
  `).run(id, plotter, target, phase, success);
}

describe("T2.3 — interveneInScheme", () => {
  it("expose surfaces evidence and the plotter resents the player", () => {
    const db = freshDb();
    scheme(db, { id: "s1" });
    // seed one undiscovered evidence row so discoverScheme has something to mark
    db.prepare(`INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind) VALUES ('e1','s1','overheard')`).run();
    const r = interveneInScheme(db, "u1", "s1", "expose");
    assert.equal(r.ok, true);
    assert.equal(r.action, "expose");
    // plotter opinion of player dropped
    const op = getOpinion(db, "plot", "player", "u1");
    assert.ok((op?.score ?? 0) < 0);
    db.close();
  });

  it("abet adds the player as accomplice, raises success, warms the plotter", () => {
    const db = freshDb();
    scheme(db, { id: "s1", success: 30 });
    const r = interveneInScheme(db, "u1", "s1", "abet");
    assert.equal(r.ok, true);
    assert.equal(r.scheme.accomplice_added, true);
    assert.ok(r.scheme.success_pct > 30);
    const op = getOpinion(db, "plot", "player", "u1");
    assert.ok((op?.score ?? 0) > 0);
    // idempotent: abetting again doesn't double-add
    const again = interveneInScheme(db, "u1", "s1", "abet");
    assert.equal(again.scheme.accomplice_added, false);
    db.close();
  });

  it("ignore makes no state change", () => {
    const db = freshDb();
    scheme(db, { id: "s1", success: 42 });
    const r = interveneInScheme(db, "u1", "s1", "ignore");
    assert.equal(r.ok, true);
    assert.equal(r.action, "ignore");
    assert.equal(db.prepare(`SELECT success_pct FROM npc_schemes WHERE id='s1'`).get().success_pct, 42);
    db.close();
  });

  it("rejects intervention on a terminal scheme", () => {
    const db = freshDb();
    scheme(db, { id: "s1", phase: "complete" });
    const r = interveneInScheme(db, "u1", "s1", "expose");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "scheme_terminal");
    db.close();
  });
});
