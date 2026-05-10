/**
 * Tier-2 contract tests for Sprint C / Track D — kingdoms + decrees +
 * takeover + rebellion (the new "rule" substrate, distinct from the older
 * `kingdoms.test.js` which tests the territory-polygon library).
 *
 * Run: node --test tests/kingdoms-rule.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  seedKingdomsFromFactions,
  getKingdom,
  recomputeCitizenLoyalty,
  kingdomLoyaltySummary,
  assignRuler,
} from "../lib/kingdoms.js";
import {
  proposeDecree,
  issueDecree,
  expireDueDecrees,
  pickRulerDecree,
} from "../lib/kingdom-decrees.js";
import {
  takeoverByConquest,
  takeoverByInheritance,
  takeoverByElection,
  deposeRuler,
  TAKEOVER_CONSTANTS,
} from "../lib/kingdom-takeover.js";
import {
  evaluateRebellionRisk,
  listRebellionsForKingdom,
} from "../lib/kingdom-rebellion.js";

import { up as up117 } from "../migrations/117_faction_strategy.js";
import { up as up128 } from "../migrations/128_npc_asymmetry.js";
import { up as up133 } from "../migrations/133_npc_legacy.js";
import { up as up152 } from "../migrations/152_npc_stress.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { up as up158 } from "../migrations/158_kingdoms.js";
import { recordOpinionEvent, getOpinion } from "../lib/npc-opinions.js";
import { bumpStress } from "../lib/npc-stress.js";

function setupDb() {
  const db = new Database(":memory:");
  up117(db); up128(db); up133(db); up152(db); up153(db); up154(db); up155(db); up158(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS procgen_regions (id TEXT PRIMARY KEY, faction_id TEXT);
  `);
  return db;
}

const FACTIONS = [
  { id: "iron_wardens", name: "Iron Wardens", leader_npc_id: "warden_voss", home_world: "concordia-hub" },
  { id: "shroud_guild", name: "Shroud Guild", leader_npc_id: "shroud_kale", home_world: "concordia-hub" },
];

describe("Sprint C / D1 — seedKingdomsFromFactions", () => {
  it("creates one kingdom per faction with a leader", () => {
    const db = setupDb();
    const r = seedKingdomsFromFactions(db, FACTIONS);
    assert.equal(r.inserted, 2);
    const k = db.prepare(`SELECT * FROM realms WHERE faction_id = ?`).get("iron_wardens");
    assert.ok(k);
    assert.equal(k.ruler_kind, "npc");
    assert.equal(k.ruler_id, "warden_voss");
  });

  it("idempotent on re-seed", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const second = seedKingdomsFromFactions(db, FACTIONS);
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, 2);
  });

  it("skips factions without a leader", () => {
    const db = setupDb();
    const r = seedKingdomsFromFactions(db, [{ id: "headless", name: "Headless", home_world: "x" }]);
    assert.equal(r.inserted, 0);
  });
});

describe("Sprint C / D2 — proposeDecree authority gate", () => {
  it("rejects when issuer is not the ruler", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = getKingdom(db, db.prepare(`SELECT id FROM realms LIMIT 1`).get().id);
    const r = proposeDecree(db, k.id, { kind: "festival", issuedByKind: "player", issuedById: "u-impostor" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_authorised");
  });

  it("accepts ruler match", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = getKingdom(db, db.prepare(`SELECT id FROM realms LIMIT 1`).get().id);
    const r = proposeDecree(db, k.id, { kind: "festival", issuedByKind: "npc", issuedById: k.ruler_id });
    assert.equal(r.ok, true);
  });

  it("rejects unknown kind", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = getKingdom(db, db.prepare(`SELECT id FROM realms LIMIT 1`).get().id);
    const r = proposeDecree(db, k.id, { kind: "summon_dragon", issuedByKind: "system" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });
});

describe("Sprint C / D2 — issueDecree cascades opinion", () => {
  it("festival decree shifts citizens' opinion of ruler upward", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = getKingdom(db, db.prepare(`SELECT id FROM realms WHERE faction_id = ?`).get("iron_wardens").id);
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('citizen_a', 'iron_wardens')`).run();
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('citizen_b', 'iron_wardens')`).run();
    recomputeCitizenLoyalty(db, k.id);

    const before = getOpinion(db, "citizen_a", "npc", k.ruler_id);
    const beforeScore = before?.score ?? 0;
    const prop = proposeDecree(db, k.id, { kind: "festival", issuedByKind: "npc", issuedById: k.ruler_id });
    issueDecree(db, prop.id);
    const after = getOpinion(db, "citizen_a", "npc", k.ruler_id);
    assert.ok(after.score > beforeScore);
  });
});

describe("Sprint C / D2 — expireDueDecrees", () => {
  it("flips active+past-expiry to expired", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    db.prepare(`
      INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, expires_at, effect_state, popularity_delta)
      VALUES ('dcr_test', ?, 'festival', '{}', 'system', unixepoch() - 100, 'active', 12)
    `).run(k.id);
    const r = expireDueDecrees(db);
    assert.equal(r.expired, 1);
    const row = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = 'dcr_test'`).get();
    assert.equal(row.effect_state, "expired");
  });
});

describe("Sprint C / D3 — takeoverByConquest", () => {
  it("rejects without proof", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    const r = takeoverByConquest(db, "u1", k.id, {});
    assert.equal(r.ok, false);
  });

  it("accepts with bypass and assigns ruler at conquest legitimacy", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    const r = takeoverByConquest(db, "u1", k.id, { bypass: true });
    assert.equal(r.ok, true);
    assert.equal(r.legitimacy, TAKEOVER_CONSTANTS.CONQUEST_LEGITIMACY);
    const updated = getKingdom(db, k.id);
    assert.equal(updated.ruler_kind, "player");
    assert.equal(updated.ruler_id, "u1");
  });
});

describe("Sprint C / D3 — takeoverByInheritance", () => {
  it("requires heir slot OR no-heirs", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id, ruler_id FROM realms LIMIT 1`).get();
    const reject = takeoverByInheritance(db, "u1", k.id, { heirOfNpcId: k.ruler_id });
    assert.equal(reject.ok, false);
    db.prepare(`INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id, inherited_kind) VALUES ('il1', ?, 'u1', 'wealth')`).run(k.ruler_id);
    const accept = takeoverByInheritance(db, "u1", k.id, { heirOfNpcId: k.ruler_id });
    assert.equal(accept.ok, true);
    assert.equal(accept.legitimacy, TAKEOVER_CONSTANTS.INHERITANCE_LEGITIMACY);
  });
});

describe("Sprint C / D3 — takeoverByElection + deposeRuler", () => {
  it("election sets player ruler at high legitimacy", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    const r = takeoverByElection(db, "u_pres", k.id, { voterTurnoutOk: true });
    assert.equal(r.legitimacy, TAKEOVER_CONSTANTS.ELECTION_LEGITIMACY);
    assert.equal(getKingdom(db, k.id).ruler_id, "u_pres");
  });

  it("depose drops ruler to interregnum + suspends decrees", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    db.prepare(`
      INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, effect_state, popularity_delta)
      VALUES ('dx', ?, 'festival', '{}', 'system', 'active', 12)
    `).run(k.id);
    deposeRuler(db, k.id, "regicide");
    assert.equal(getKingdom(db, k.id).ruler_kind, "interregnum");
    const dx = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = 'dx'`).get();
    assert.equal(dx.effect_state, "expired");
  });
});

describe("Sprint C / D4 — evaluateRebellionRisk", () => {
  it("returns ok:false when ruler is interregnum", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    deposeRuler(db, k.id);
    const r = evaluateRebellionRisk(db, k.id);
    assert.equal(r.ok, false);
  });

  it("scores high when avg loyalty critical + spawns scheme", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id, ruler_id, faction_id FROM realms WHERE faction_id = ?`).get("iron_wardens");

    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('c1', 'iron_wardens')`).run();
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('c2', 'iron_wardens')`).run();
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('c1', ?, 10)`).run(k.id);
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('c2', ?, 15)`).run(k.id);

    bumpStress(db, "c1", "custom_event", 50);
    bumpStress(db, "c2", "custom_event", 50);
    recordOpinionEvent(db, { npcId: "c1", targetKind: "npc", targetId: k.ruler_id }, -75);

    // Push score above 70 with one unpopular decree (popularity_delta -10).
    db.prepare(`
      INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, effect_state, popularity_delta)
      VALUES ('dcr_unp', ?, 'tax_change', '{}', 'system', 'active', -15)
    `).run(k.id);

    const r = evaluateRebellionRisk(db, k.id);
    assert.ok(r.score >= 70, `expected score >= 70, got ${r.score}`);
    assert.equal(r.spawned, true);
    assert.ok(r.schemeId);

    const list = listRebellionsForKingdom(db, k.id);
    assert.equal(list.length, 1);
  });
});

describe("Sprint C / D2 — pickRulerDecree", () => {
  it("returns null when not past cooldown", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    db.prepare(`UPDATE realms SET next_decree_at = unixepoch() + 1000 WHERE id = ?`).run(k.id);
    assert.equal(pickRulerDecree(db, k.id), null);
  });

  it("returns festival/exile when avg loyalty < 35", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id, ruler_id FROM realms WHERE faction_id = ?`).get("iron_wardens");
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('cz', ?, 20)`).run(k.id);
    const kind = pickRulerDecree(db, k.id);
    assert.ok(["festival", "exile"].includes(kind));
  });
});

describe("Sprint C / D — assignRuler / kingdomLoyaltySummary", () => {
  it("assigns + summarises", () => {
    const db = setupDb();
    seedKingdomsFromFactions(db, FACTIONS);
    const k = db.prepare(`SELECT id FROM realms LIMIT 1`).get();
    assignRuler(db, k.id, { rulerKind: "player", rulerId: "u1", legitimacy: 50 });
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('a', ?, 80)`).run(k.id);
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('b', ?, 20)`).run(k.id);
    const sum = kingdomLoyaltySummary(db, k.id);
    assert.equal(sum.count, 2);
    assert.equal(sum.high, 80);
    assert.equal(sum.low, 20);
  });
});
