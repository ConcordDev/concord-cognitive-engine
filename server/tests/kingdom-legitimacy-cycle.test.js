/**
 * Tier-2 contract tests — wiring `kingdom-takeover.js#tickLegitimacy` onto a
 * heartbeat (`server/emergent/kingdom-legitimacy-cycle.js`).
 *
 * `tickLegitimacy` was fully built but had zero callers anywhere in the
 * codebase; this pins the new heartbeat handler's real behavior:
 *   (a) legitimacy actually drifts across simulated passes,
 *   (b) a player-held realm at zero legitimacy is NEVER auto-resolved
 *       (the safety-critical case),
 *   (c) an interregnum (ruler-less) realm at zero legitimacy DOES get a
 *       real new NPC ruler assigned via the same heir-finding path death
 *       uses elsewhere,
 *   (d) the handler never throws, even against malformed/missing rows.
 *
 * Run: node --test tests/kingdom-legitimacy-cycle.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runKingdomLegitimacyCycle } from "../emergent/kingdom-legitimacy-cycle.js";
import { TAKEOVER_CONSTANTS } from "../lib/kingdom-takeover.js";
import { assignRuler } from "../lib/kingdoms.js";

import { up as up158 } from "../migrations/158_kingdoms.js";
import { up as up133 } from "../migrations/133_npc_legacy.js";

function setupDb() {
  const db = new Database(":memory:");
  up158(db);
  up133(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  return db;
}

function insertRealm(db, overrides = {}) {
  const realm = {
    id: overrides.id || "kd_test",
    name: overrides.name || "Test Realm",
    world_id: overrides.world_id || "concordia-hub",
    faction_id: overrides.faction_id || "iron_wardens",
    ruler_kind: overrides.ruler_kind || "npc",
    ruler_id: "ruler_id" in overrides ? overrides.ruler_id : "ruler_npc_1",
    legitimacy: overrides.legitimacy ?? 60,
    treasury: overrides.treasury ?? 1000,
    tax_rate: overrides.tax_rate ?? 0.1,
  };
  db.prepare(`
    INSERT INTO realms (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (@id, @name, @world_id, @faction_id, @ruler_kind, @ruler_id, @legitimacy, @treasury, @tax_rate)
  `).run(realm);
  return realm;
}

function insertDecree(db, kingdomId, popularityDelta, issuedAtOffset = 0) {
  db.prepare(`
    INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, issued_at, effect_state, popularity_delta)
    VALUES (?, ?, 'festival', '{}', 'system', unixepoch() + ?, 'active', ?)
  `).run(`dcr_${Math.random().toString(36).slice(2)}`, kingdomId, issuedAtOffset, popularityDelta);
}

describe("kingdom-legitimacy-cycle — real legitimacy drift", () => {
  it("decays legitimacy when the most recent decree was unpopular", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { legitimacy: 50 });
    insertDecree(db, realm.id, -10);

    const before = db.prepare(`SELECT legitimacy FROM realms WHERE id = ?`).get(realm.id).legitimacy;
    assert.equal(before, 50);

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.ok, true);

    const after = db.prepare(`SELECT legitimacy FROM realms WHERE id = ?`).get(realm.id).legitimacy;
    assert.equal(after, 48, "unpopular decree should apply the real -2 delta tickLegitimacy computes");
  });

  it("regens legitimacy when the most recent decree was popular", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { legitimacy: 50 });
    insertDecree(db, realm.id, 12);

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.ok, true);

    const after = db.prepare(`SELECT legitimacy FROM realms WHERE id = ?`).get(realm.id).legitimacy;
    assert.equal(after, 51, "popular decree should apply the real +1 delta tickLegitimacy computes");
  });

  it("drifts across multiple simulated passes (repeated unpopular decrees)", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { legitimacy: 50 });
    insertDecree(db, realm.id, -10);

    await runKingdomLegitimacyCycle({ db });
    let mid = db.prepare(`SELECT legitimacy FROM realms WHERE id = ?`).get(realm.id).legitimacy;
    assert.equal(mid, 48);

    // A fresh, later decree simulates the next in-game pass.
    insertDecree(db, realm.id, -10, 10);
    await runKingdomLegitimacyCycle({ db });
    const final = db.prepare(`SELECT legitimacy FROM realms WHERE id = ?`).get(realm.id).legitimacy;
    assert.equal(final, 46);
  });
});

describe("kingdom-legitimacy-cycle — safety-critical: never auto-resolve a player-held realm", () => {
  it("leaves a ruler_kind==='player' realm at zero legitimacy completely untouched", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { ruler_kind: "player", ruler_id: "user_42", legitimacy: 0 });
    // Give the realm a faction + heir candidates so we can be sure the
    // cycle *could* have resolved it, and prove it deliberately didn't.
    db.prepare(`INSERT INTO world_npcs (id, faction, archetype) VALUES ('heir_a', 'iron_wardens', 'warrior')`).run();

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.autoResolved, 0);
    assert.deepEqual(r.autoResolvedIds, []);

    const after = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(after.ruler_kind, "player");
    assert.equal(after.ruler_id, "user_42");
    assert.equal(after.legitimacy, 0);
  });
});

describe("kingdom-legitimacy-cycle — auto-succession for a collapsed interregnum realm", () => {
  it("assigns a real new NPC ruler via findHeirs when interregnum + legitimacy floor", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { ruler_kind: "interregnum", ruler_id: null, legitimacy: 0 });
    db.prepare(`INSERT INTO world_npcs (id, faction, archetype) VALUES ('heir_candidate', 'iron_wardens', 'warrior')`).run();

    const before = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(before.ruler_kind, "interregnum");
    assert.equal(before.ruler_id, null);

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.autoResolved, 1);
    assert.deepEqual(r.autoResolvedIds, [realm.id]);

    const after = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(after.ruler_kind, "npc");
    assert.equal(after.ruler_id, "heir_candidate");
    assert.equal(after.legitimacy, TAKEOVER_CONSTANTS.INHERITANCE_LEGITIMACY);
  });

  it("leaves the realm untouched when no heir can be found", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { ruler_kind: "interregnum", ruler_id: null, legitimacy: 0, faction_id: "lonely_faction" });
    // No world_npcs rows for this faction at all — findHeirs returns [].

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.autoResolved, 0);

    const after = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(after.ruler_kind, "interregnum");
    assert.equal(after.ruler_id, null);
  });

  it("does not touch an interregnum realm above the legitimacy floor", async () => {
    const db = setupDb();
    const realm = insertRealm(db, { ruler_kind: "interregnum", ruler_id: null, legitimacy: 20 });
    db.prepare(`INSERT INTO world_npcs (id, faction, archetype) VALUES ('heir_candidate', 'iron_wardens', 'warrior')`).run();

    const r = await runKingdomLegitimacyCycle({ db });
    assert.equal(r.autoResolved, 0);

    const after = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(after.ruler_kind, "interregnum");
  });
});

describe("kingdom-legitimacy-cycle — honest degrade, never throws", () => {
  it("returns ok:false (not a throw) with no db", async () => {
    const r = await runKingdomLegitimacyCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("never throws when the realms table is entirely missing", async () => {
    const db = new Database(":memory:"); // no migrations applied at all
    let threw = false;
    let r;
    try {
      r = await runKingdomLegitimacyCycle({ db });
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.equal(r.ok, true);
  });

  it("never throws when a realm row is malformed (null faction_id, null ruler_id, interregnum, floor legitimacy)", async () => {
    const db = setupDb();
    // Malformed on purpose: interregnum + zero legitimacy + no faction to
    // key heir lookup off of at all.
    insertRealm(db, { id: "kd_malformed", ruler_kind: "interregnum", ruler_id: null, legitimacy: 0, faction_id: null });

    let threw = false;
    let r;
    try {
      r = await runKingdomLegitimacyCycle({ db });
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.equal(r.ok, true);
    assert.equal(r.autoResolved, 0);
  });

  it("respects the CONCORD_KINGDOM_LEGITIMACY=0 kill-switch", async () => {
    const prior = process.env.CONCORD_KINGDOM_LEGITIMACY;
    process.env.CONCORD_KINGDOM_LEGITIMACY = "0";
    try {
      const db = setupDb();
      insertRealm(db, { legitimacy: 50 });
      const r = await runKingdomLegitimacyCycle({ db });
      assert.equal(r.ok, true);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prior === undefined) delete process.env.CONCORD_KINGDOM_LEGITIMACY;
      else process.env.CONCORD_KINGDOM_LEGITIMACY = prior;
    }
  });
});

describe("kingdom-legitimacy-cycle — assignRuler sanity (imported helper, not re-implemented)", () => {
  it("assignRuler itself round-trips ruler_kind/ruler_id/legitimacy", () => {
    const db = setupDb();
    const realm = insertRealm(db, { ruler_kind: "interregnum", ruler_id: null, legitimacy: 0 });
    const res = assignRuler(db, realm.id, { rulerKind: "npc", rulerId: "npc_x", legitimacy: 60 });
    assert.equal(res.ok, true);
    assert.equal(res.changes, 1);
    const row = db.prepare(`SELECT * FROM realms WHERE id = ?`).get(realm.id);
    assert.equal(row.ruler_kind, "npc");
    assert.equal(row.ruler_id, "npc_x");
    assert.equal(row.legitimacy, 60);
  });
});
