/**
 * T2.3 — scheme barge-in ("overhear a scheme").
 *
 * Pins:
 *   - a player near a plotting NPC overhears it: one discovered evidence row +
 *     a bump to the scheme's evidence_count / discovery_pct
 *   - overhearing is once-only per (scheme, player)
 *   - only overhearable phases (recruiting/gathering_evidence/moving) surface
 *   - the overheard evidence feeds the existing discover/expose pipeline
 *   - the snippet is deterministic
 *
 * Run: node --test tests/integration/scheme-overhear.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up155 } from "../../migrations/155_npc_schemes.js";
import {
  composeOverheardSnippet, hasOverheard, recordOverhear, overhearForWorld,
} from "../../lib/scheme-overhear.js";

function freshDb() {
  const db = new Database(":memory:");
  up155(db);
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, name TEXT, x REAL, z REAL);`);
  return db;
}

function seedScheme(db, { id, plotterId, phase = "gathering_evidence", kind = "blackmail" }) {
  db.prepare(`
    INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase)
    VALUES (?, 'npc', ?, 'player', 'victim', ?, ?)
  `).run(id, plotterId, kind, phase);
}

describe("T2.3 — overhear snippet", () => {
  it("is deterministic", () => {
    assert.equal(composeOverheardSnippet("s1", "blackmail"), composeOverheardSnippet("s1", "blackmail"));
    assert.match(composeOverheardSnippet("s1", "blackmail"), /blackmail/);
  });
});

describe("T2.3 — recordOverhear", () => {
  it("records one discovered evidence row and bumps the scheme", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name, x, z) VALUES ('plot','w1','Plotter',0,0)`).run();
    seedScheme(db, { id: "s1", plotterId: "plot" });

    const r = recordOverhear(db, { schemeId: "s1", plotterId: "plot", userId: "u1", kind: "blackmail" });
    assert.equal(r.ok, true);
    assert.equal(r.overheard, true);

    const ev = db.prepare(`SELECT * FROM npc_scheme_evidence WHERE scheme_id='s1'`).get();
    assert.equal(ev.evidence_kind, "overheard");
    assert.equal(ev.discovered_by_user, "u1");
    assert.ok(ev.discovered_at);
    const sch = db.prepare(`SELECT evidence_count, discovery_pct FROM npc_schemes WHERE id='s1'`).get();
    assert.equal(sch.evidence_count, 1);
    assert.ok(sch.discovery_pct >= 8);
    db.close();
  });

  it("is once-only per (scheme, player)", () => {
    const db = freshDb();
    seedScheme(db, { id: "s1", plotterId: "plot" });
    recordOverhear(db, { schemeId: "s1", userId: "u1" });
    assert.equal(hasOverheard(db, "s1", "u1"), true);
    const again = recordOverhear(db, { schemeId: "s1", userId: "u1" });
    assert.equal(again.overheard, false);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM npc_scheme_evidence WHERE scheme_id='s1'`).get().n;
    assert.equal(n, 1);
    // a different player can still overhear it
    const other = recordOverhear(db, { schemeId: "s1", userId: "u2" });
    assert.equal(other.overheard, true);
    db.close();
  });
});

describe("T2.3 — overhearForWorld", () => {
  it("fires only for overhearable phases + nearby players", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name, x, z) VALUES ('p1','w1','A',0,0)`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name, x, z) VALUES ('p2','w1','B',0,0)`).run();
    seedScheme(db, { id: "active", plotterId: "p1", phase: "moving" });
    seedScheme(db, { id: "early",  plotterId: "p2", phase: "planning" }); // not overhearable

    // u1 is near p1, nobody near p2
    const nearby = (plotterId) => (plotterId === "p1" ? ["u1"] : []);
    const res = overhearForWorld(db, "w1", nearby);
    assert.equal(res.fired.length, 1);
    assert.equal(res.fired[0].schemeId, "active");
    assert.equal(res.fired[0].userId, "u1");

    // 'early' scheme produced no evidence
    const earlyEv = db.prepare(`SELECT COUNT(*) AS n FROM npc_scheme_evidence WHERE scheme_id='early'`).get().n;
    assert.equal(earlyEv, 0);
    db.close();
  });

  it("re-running does not double-fire for the same player", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name, x, z) VALUES ('p1','w1','A',0,0)`).run();
    seedScheme(db, { id: "s1", plotterId: "p1", phase: "recruiting" });
    const nearby = () => ["u1"];
    assert.equal(overhearForWorld(db, "w1", nearby).fired.length, 1);
    assert.equal(overhearForWorld(db, "w1", nearby).fired.length, 0);
    db.close();
  });
});
