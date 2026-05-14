/**
 * Tier-2 contract tests for the war-in-3D mechanic.
 *
 * Pins:
 *   - declareWar requires both realms in the same world, not the hub,
 *     and the defender must hold the target territory.
 *   - declareWar auto-conscripts defender NPCs (up to budget).
 *   - rallyTroop adds a participant to a side and recounts.
 *   - advanceCampaign transitions mustering → marching → engaging.
 *   - runSkirmish writes a row + updates morale + can capture a town.
 *   - captureTown transfers the realm_territories row.
 *   - kidnap inserts a row; pay_ransom + truce both release.
 *
 * Run: node --test tests/war-campaign.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up158 } from "../migrations/158_kingdoms.js";
import { up as up186 } from "../migrations/186_war_campaigns.js";
import {
  declareWar,
  rallyTroop,
  advanceCampaign,
  runSkirmish,
  captureTown,
  kidnapNpc,
  payRansom,
  rescueKidnap,
  seekTruce,
  listActiveCampaigns,
  getCampaign,
} from "../lib/war-campaign.js";

function setupDb() {
  const db = new Database(":memory:");
  // Minimal world_npcs + realms schema.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, archetype TEXT,
      current_activity TEXT, current_task TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  up158(db);
  up186(db);
  // Seed two realms in tunya and the territory the defender holds.
  db.prepare(`
    INSERT INTO realms (id, name, world_id, capital_settlement_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury)
    VALUES ('realm_atk', 'Atk', 'tunya', 'atk_cap', 'atk', 'player', 'user_alice', 60, 1000),
           ('realm_def', 'Def', 'tunya', 'def_cap', 'def', 'npc',    'npc_jarl',   80, 1500)
  `).run();
  db.prepare(`INSERT INTO realm_territories (kingdom_id, region_id) VALUES (?, ?)`).run("realm_def", "def_cap");
  // Defender NPCs (warriors) eligible for conscription.
  for (let i = 0; i < 5; i++) {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES (?, 'tunya', 'warrior')`).run(`def_npc_${i}`);
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES (?, 'realm_def', 60)`).run(`def_npc_${i}`);
  }
  return db;
}

describe("declareWar — preconditions", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("opens a campaign with auto-conscripted defenders", () => {
    const r = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap", casusBelli: "expansion", declaredBy: "user_alice",
    });
    assert.equal(r.ok, true);
    assert.ok(r.campaignId);
    assert.equal(r.defenderConscripts, 5);
    const c = getCampaign(db, r.campaignId);
    assert.equal(c.state, "mustering");
    assert.equal(c.defender_troops, 5);
    assert.equal(c.attacker_troops, 0);
  });

  it("rejects self-war", () => {
    const r = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_atk",
      targetTerritory: "atk_cap",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_war");
  });

  it("rejects cross-world war", () => {
    db.prepare(`UPDATE realms SET world_id = 'cyber' WHERE id = 'realm_def'`).run();
    const r = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cross_world_war_forbidden");
  });

  it("rejects hub war (Concordant Law)", () => {
    db.prepare(`UPDATE realms SET world_id = 'concordia-hub' WHERE id IN ('realm_atk','realm_def')`).run();
    const r = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "concordant_law_refusal");
  });

  it("rejects when defender doesn't hold the target territory", () => {
    const r = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "atk_cap",  // attacker's own
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "defender_does_not_hold_territory");
  });
});

describe("rallyTroop + advance", () => {
  let db;
  let campaignId;
  beforeEach(() => {
    db = setupDb();
    campaignId = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap",
    }).campaignId;
  });

  it("rallies a player to attacker side", () => {
    const r = rallyTroop(db, {
      campaignId, participantKind: "player", participantId: "user_alice", side: "attacker",
    });
    assert.equal(r.ok, true);
    const c = getCampaign(db, campaignId);
    assert.equal(c.attacker_troops, 1);
    const me = c.troops.find((t) => t.participant_id === "user_alice");
    assert.equal(me.side, "attacker");
  });

  it("advance transitions mustering → marching once both sides have troops", () => {
    rallyTroop(db, { campaignId, participantKind: "player", participantId: "user_alice", side: "attacker" });
    // Force next_skirmish_at into the past.
    db.prepare(`UPDATE war_campaigns SET next_skirmish_at = unixepoch() - 1 WHERE id = ?`).run(campaignId);
    const c = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
    const r = advanceCampaign(db, c);
    assert.equal(r.newState, "marching");
  });

  it("a second advance pushes marching → engaging", () => {
    rallyTroop(db, { campaignId, participantKind: "player", participantId: "user_alice", side: "attacker" });
    db.prepare(`UPDATE war_campaigns SET state = 'marching', next_skirmish_at = unixepoch() - 1 WHERE id = ?`).run(campaignId);
    const c = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
    const r = advanceCampaign(db, c);
    assert.equal(r.newState, "engaging");
  });
});

describe("runSkirmish — outcomes", () => {
  let db, campaignId;
  beforeEach(() => {
    db = setupDb();
    campaignId = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap",
    }).campaignId;
    // Stack attackers so they win.
    for (let i = 0; i < 20; i++) {
      rallyTroop(db, { campaignId, participantKind: "npc", participantId: `atk_npc_${i}`, side: "attacker" });
    }
    db.prepare(`UPDATE war_campaigns SET state = 'engaging', attacker_morale = 90 WHERE id = ?`).run(campaignId);
  });

  it("attacker advantage produces defender losses + may capture town", () => {
    const c = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
    const r = runSkirmish(db, c);
    assert.ok(r.summary);
    assert.ok(r.defenderLosses >= r.attackerLosses, `expected defenderLosses(${r.defenderLosses}) ≥ attackerLosses(${r.attackerLosses})`);
    // With 20 attackers / 5 defenders and morale 90 — should capture.
    const afterC = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
    assert.ok(["engaging", "occupying"].includes(afterC.state));
  });

  it("captureTown transfers realm_territories ownership", () => {
    const r = captureTown(db, campaignId);
    assert.ok(r?.captureId);
    const t = db.prepare(`SELECT kingdom_id FROM realm_territories WHERE region_id = ?`).get("def_cap");
    assert.equal(t.kingdom_id, "realm_atk");
  });
});

describe("kidnap + ransom + truce", () => {
  let db, campaignId;
  beforeEach(() => {
    db = setupDb();
    campaignId = declareWar(db, {
      attackerRealmId: "realm_atk", defenderRealmId: "realm_def",
      targetTerritory: "def_cap",
    }).campaignId;
  });

  it("kidnap inserts a war_kidnaps row + marks NPC as captive", () => {
    const r = kidnapNpc(db, {
      campaignId, captorKind: "realm", captorId: "realm_atk",
      victimId: "def_npc_0", holdAt: "realm_atk", ransomCc: 250,
    });
    assert.ok(r?.kidnapId);
    const k = db.prepare(`SELECT * FROM war_kidnaps WHERE id = ?`).get(r.kidnapId);
    assert.equal(k.ransom_cc, 250);
    assert.equal(k.released_at, null);
    const npc = db.prepare(`SELECT current_activity FROM world_npcs WHERE id = ?`).get("def_npc_0");
    assert.equal(npc.current_activity, "captive");
  });

  it("payRansom releases the captive", () => {
    const r = kidnapNpc(db, {
      campaignId, captorKind: "realm", captorId: "realm_atk",
      victimId: "def_npc_0", ransomCc: 100,
    });
    const out = payRansom(db, r.kidnapId, "user_alice");
    assert.equal(out.ok, true);
    const k = db.prepare(`SELECT released_at, release_reason FROM war_kidnaps WHERE id = ?`).get(r.kidnapId);
    assert.ok(k.released_at);
    assert.equal(k.release_reason, "ransom_paid");
    const npc = db.prepare(`SELECT current_activity FROM world_npcs WHERE id = ?`).get("def_npc_0");
    assert.equal(npc.current_activity, null);
  });

  it("rescueKidnap releases without payment", () => {
    const r = kidnapNpc(db, {
      campaignId, captorKind: "realm", captorId: "realm_atk", victimId: "def_npc_1",
    });
    rescueKidnap(db, r.kidnapId, "user_alice");
    const k = db.prepare(`SELECT release_reason FROM war_kidnaps WHERE id = ?`).get(r.kidnapId);
    assert.equal(k.release_reason, "rescue");
  });

  it("seekTruce resolves the campaign + releases all kidnaps", () => {
    kidnapNpc(db, { campaignId, captorKind: "realm", captorId: "realm_atk", victimId: "def_npc_0" });
    kidnapNpc(db, { campaignId, captorKind: "realm", captorId: "realm_atk", victimId: "def_npc_1" });
    const r = seekTruce(db, campaignId);
    assert.equal(r.ok, true);
    assert.equal(r.kidnapsReleased, 2);
    const c = getCampaign(db, campaignId);
    assert.equal(c.state, "truced");
    assert.equal(c.outcome, "stalemate_truce");
  });
});

describe("listActiveCampaigns + isolation", () => {
  it("lists only non-resolved campaigns + filters by world", () => {
    const db = setupDb();
    declareWar(db, { attackerRealmId: "realm_atk", defenderRealmId: "realm_def", targetTerritory: "def_cap" });
    const tunya = listActiveCampaigns(db, "tunya");
    assert.equal(tunya.length, 1);
    const cyber = listActiveCampaigns(db, "cyber");
    assert.equal(cyber.length, 0);
  });
});
