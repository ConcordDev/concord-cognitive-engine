/**
 * T2.1 (plan) — NPC-autonomous secret weaponisation.
 *
 * Pins:
 *   - a hostile holder of a secret against a live NPC subject opens a blackmail
 *     scheme along the secret-edge (the secret is the motive — disposition gate
 *     bypassed) and stamps weaponised_holder_at
 *   - a calm/neutral holder does NOT weaponise (disposition still chooses who)
 *   - it fires once per secret (the marker + scheme dedupe)
 *   - proposeScheme(motive:'secret') bypasses the no-motive gate
 *
 * Run: node --test tests/integration/secret-weaponise-npc.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up152 } from "../../migrations/152_npc_stress.js";
import { up as up153 } from "../../migrations/153_npc_opinions.js";
import { up as up154 } from "../../migrations/154_secrets.js";
import { up as up155 } from "../../migrations/155_npc_schemes.js";
import { up as up263 } from "../../migrations/263_secret_holder_weaponise.js";
import { weaponiseHeldSecrets } from "../../lib/secrets.js";
import { proposeScheme } from "../../lib/npc-schemes.js";

function freshDb() {
  const db = new Database(":memory:");
  up152(db); up153(db); up154(db); up155(db); up263(db);
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);`);
  return db;
}

function npc(db, id, worldId = "w1") {
  db.prepare(`INSERT INTO world_npcs (id, world_id, is_dead) VALUES (?, ?, 0)`).run(id, worldId);
}
function secret(db, id, holder, subject) {
  db.prepare(`
    INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
    VALUES (?, ?, 'npc', ?, 'crime', 'knows where the body is', 6)
  `).run(id, holder, subject);
}
function stress(db, npcId, value, coping = null) {
  db.prepare(`INSERT INTO npc_stress (npc_id, stress, coping_trait) VALUES (?, ?, ?)`).run(npcId, value, coping);
}

describe("T2.1 — proposeScheme motive override", () => {
  it("bypasses the no-motive gate when motive:'secret'", () => {
    const db = freshDb();
    npc(db, "holder"); npc(db, "subject");
    // calm holder, neutral opinion → would normally be no_motive
    const blocked = proposeScheme(db, { plotterNpcId: "holder", targetKind: "npc", targetId: "subject", kind: "blackmail" });
    assert.equal(blocked.reason, "no_motive");
    const forced = proposeScheme(db, { plotterNpcId: "holder", targetKind: "npc", targetId: "subject", kind: "blackmail", motive: "secret" });
    assert.equal(forced.ok, true);
    assert.equal(forced.kind, "blackmail");
    db.close();
  });
});

describe("T2.1 — weaponiseHeldSecrets", () => {
  it("a hostile holder weaponises; a calm holder does not", () => {
    const db = freshDb();
    npc(db, "cruel-holder"); npc(db, "victim-a");
    npc(db, "calm-holder"); npc(db, "victim-b");
    secret(db, "s1", "cruel-holder", "victim-a");
    secret(db, "s2", "calm-holder", "victim-b");
    stress(db, "cruel-holder", 70, "cruel"); // disposition → acts
    stress(db, "calm-holder", 20, null);     // calm → sits on it

    const r = weaponiseHeldSecrets(db, { proposeScheme });
    assert.equal(r.ok, true);
    assert.equal(r.weaponised.length, 1);
    assert.equal(r.weaponised[0].holderNpcId, "cruel-holder");
    assert.ok(r.weaponised[0].schemeId);

    // a blackmail scheme exists from cruel-holder → victim-a
    const sch = db.prepare(`SELECT kind, target_id FROM npc_schemes WHERE plotter_id = 'cruel-holder'`).get();
    assert.equal(sch.kind, "blackmail");
    assert.equal(sch.target_id, "victim-a");
    // marker stamped
    assert.ok(db.prepare(`SELECT weaponised_holder_at FROM secrets WHERE id='s1'`).get().weaponised_holder_at);
    // calm holder's secret untouched
    assert.equal(db.prepare(`SELECT weaponised_holder_at FROM secrets WHERE id='s2'`).get().weaponised_holder_at, null);
    db.close();
  });

  it("fires once — re-running does not re-weaponise", () => {
    const db = freshDb();
    npc(db, "h"); npc(db, "v");
    secret(db, "s1", "h", "v");
    stress(db, "h", 80, "paranoid");
    assert.equal(weaponiseHeldSecrets(db, { proposeScheme }).weaponised.length, 1);
    assert.equal(weaponiseHeldSecrets(db, { proposeScheme }).weaponised.length, 0);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM npc_schemes WHERE plotter_id='h'`).get().n;
    assert.equal(n, 1);
    db.close();
  });

  it("skips secrets whose subject NPC is dead", () => {
    const db = freshDb();
    npc(db, "h"); db.prepare(`INSERT INTO world_npcs (id, world_id, is_dead) VALUES ('ghost','w1',1)`).run();
    secret(db, "s1", "h", "ghost");
    stress(db, "h", 90, "cruel");
    assert.equal(weaponiseHeldSecrets(db, { proposeScheme }).weaponised.length, 0);
    db.close();
  });
});
