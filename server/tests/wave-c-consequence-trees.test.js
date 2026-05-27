// server/tests/wave-c-consequence-trees.test.js
//
// Wave C / C1 — long-arc consequence cascades.
//   - fire(db, 'royal_kill', context) schedules 3 rows
//   - cancelCascade flips them all to fired with reason=redemption
//   - royal_kill handler chain: radicalize → form_cult → attack
//   - betrayal handler chain: gossip → distrust → blacklist
//   - mass_atrocity handler chain: legend → news → bounty

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  CASCADE_TEMPLATES, fire, cancelCascade,
} from "../lib/consequence-cascades.js";
import { listForSource, due } from "../lib/scheduled-consequences.js";
import royalKillHandler from "../lib/consequence-handlers/royal-kill.js";
import betrayalHandler from "../lib/consequence-handlers/betrayal.js";
import atrocityHandler from "../lib/consequence-handlers/atrocity-legend.js";
import bountyHandler from "../lib/consequence-handlers/bounty.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE scheduled_consequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, fires_at INTEGER NOT NULL,
      source_kind TEXT, source_id TEXT, target_kind TEXT, target_id TEXT,
      world_id TEXT, payload_json TEXT, fired_at INTEGER, fire_result TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      faction TEXT, archetype TEXT, name TEXT,
      x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
      is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL DEFAULT 0,
      kind TEXT DEFAULT 'neutral', top_reason TEXT,
      last_event_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
    CREATE TABLE npc_preoccupations (
      id TEXT PRIMARY KEY, npc_id TEXT, kind TEXT, target_kind TEXT, target_id TEXT,
      severity REAL DEFAULT 0.5, expires_at INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE faction_relations (
      faction_a TEXT NOT NULL, faction_b TEXT NOT NULL CHECK (faction_a < faction_b),
      score REAL DEFAULT 0, kind TEXT DEFAULT 'neutral',
      PRIMARY KEY (faction_a, faction_b)
    );
    CREATE TABLE war_campaigns (
      id TEXT PRIMARY KEY, world_id TEXT, aggressor_id TEXT, defender_id TEXT,
      state TEXT, attacker_troops INTEGER, defender_troops INTEGER,
      next_skirmish_at INTEGER, resolved_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE land_claims (
      id TEXT PRIMARY KEY, owner_user_id TEXT,
      anchor_x REAL, anchor_z REAL, radius_m REAL, status TEXT DEFAULT 'active'
    );
    CREATE TABLE world_quests (
      id TEXT PRIMARY KEY, world_id TEXT, giver_npc_id TEXT, title TEXT,
      description TEXT, status TEXT DEFAULT 'available', reward TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_legends (
      id TEXT PRIMARY KEY, world_id TEXT, subject_kind TEXT, subject_id TEXT,
      title TEXT, body TEXT, sentiment REAL, severity INTEGER,
      composed_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Seed faction members for radicalization tests.
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, archetype, x, z) VALUES
    ('npc_guard_a', 'concordia', 'sovereign', 'guard', 10, 10),
    ('npc_guard_b', 'concordia', 'sovereign', 'guard', 12, 11),
    ('npc_guard_c', 'concordia', 'sovereign', 'guard', 11, 12),
    ('npc_sheriff', 'concordia', 'crown', 'sheriff', 50, 50)
  `).run();
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, anchor_x, anchor_z, radius_m)
    VALUES ('lc_p1', 'U1', 100, 100, 40)
  `).run();
});

after(() => { db?.close(); });

describe("CASCADE_TEMPLATES", () => {
  it("has the 3 advertised cascades", () => {
    assert.ok(CASCADE_TEMPLATES.royal_kill);
    assert.ok(CASCADE_TEMPLATES.betrayal);
    assert.ok(CASCADE_TEMPLATES.mass_atrocity);
    for (const [k, tpl] of Object.entries(CASCADE_TEMPLATES)) {
      assert.ok(Array.isArray(tpl.chain), `${k} chain is array`);
      assert.ok(tpl.chain.length >= 3, `${k} has ≥3 steps`);
    }
  });
});

describe("fire / cancelCascade", () => {
  it("royal_kill schedules 3 rows with growing fires_at", () => {
    const r = fire(db, "royal_kill", {
      source: { kind: "npc_death", id: "npc_queen" },
      target: { kind: "user", id: "U1" },
      worldId: "concordia",
      actorUserId: "U1",
      victimNpcId: "npc_queen",
      factionId: "sovereign",
      location: { x: 50, z: 50 },
      meta: { archetype: "queen", name: "Queen Aelis" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.stepCount, 3);
    const rows = listForSource(db, "npc_death", "npc_queen");
    assert.equal(rows.length, 3);
    // Each row has a deeper fires_at than the previous.
    const fireTimes = rows.map((r) => r.firesAt).sort((a, b) => a - b);
    assert.ok(fireTimes[2] > fireTimes[0]);
  });

  it("unknown trigger returns ok:false", () => {
    const r = fire(db, "nonsense", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_trigger");
  });

  it("cancelCascade marks all scheduled rows fired with reason=redemption", () => {
    const r = fire(db, "betrayal", { worldId: "concordia", actorUserId: "U2" });
    assert.equal(r.stepCount, 3);
    const cancel = cancelCascade(db, r.scheduledIds, "player_redemption_arc");
    assert.equal(cancel.ok, true);
    assert.equal(cancel.cancelled, 3);
    // Each row should now be fired.
    for (const id of r.scheduledIds) {
      const row = db.prepare(`SELECT fired_at, fire_result FROM scheduled_consequences WHERE id = ?`).get(id);
      assert.ok(row.fired_at);
      const result = JSON.parse(row.fire_result);
      assert.equal(result.cancelled, true);
    }
  });
});

describe("royal_kill handler chain", () => {
  it("radicalize bumps opinion + sets preoccupation", async () => {
    const r = await royalKillHandler(db, {
      kind: "royal_kill_radicalize",
      worldId: "concordia",
      payload: { factionId: "sovereign", actorUserId: "U1", victimNpcId: "npc_queen" },
    });
    assert.equal(r.ok, true);
    assert.ok(r.radicalised >= 3);
    const opn = db.prepare(`SELECT score FROM character_opinions WHERE npc_id = 'npc_guard_a' AND target_id = 'U1'`).get();
    assert.ok(opn && opn.score <= -10);
    const pre = db.prepare(`SELECT * FROM npc_preoccupations WHERE npc_id = 'npc_guard_a' AND kind = 'personal_loss'`).get();
    assert.ok(pre);
  });

  it("form_cult creates a cult faction + relations row", async () => {
    const r = await royalKillHandler(db, {
      kind: "royal_kill_form_cult",
      worldId: "concordia",
      payload: { factionId: "sovereign", actorUserId: "U1", victimNpcId: "npc_queen" },
    });
    assert.equal(r.ok, true);
    assert.ok(r.cultId);
    assert.ok(r.memberCount >= 1);
    const rel = db.prepare(`SELECT * FROM faction_relations WHERE kind = 'war' LIMIT 1`).get();
    assert.ok(rel);
  });

  it("attack spawns a war campaign targeting the player's land claim", async () => {
    const r = await royalKillHandler(db, {
      kind: "royal_kill_attack",
      worldId: "concordia",
      payload: { actorUserId: "U1", victimNpcId: "npc_queen", location: { x: 50, z: 50 } },
    });
    assert.equal(r.ok, true);
    assert.ok(r.campaignId);
    assert.equal(r.target.kind, "claim");
    const camp = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(r.campaignId);
    assert.ok(camp);
    assert.equal(camp.state, "marching");
  });
});

describe("betrayal handler chain", () => {
  it("blacklist flips faction_relations to war", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, faction, archetype)
      VALUES ('npc_ally', 'concordia', 'goldfield', 'merchant')`).run();
    const r = await betrayalHandler(db, {
      kind: "betrayal_blacklist",
      worldId: "concordia",
      payload: { factionId: "goldfield", actorUserId: "U3" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.factionId, "goldfield");
    const rel = db.prepare(`SELECT * FROM faction_relations
      WHERE (faction_a = 'goldfield' OR faction_b = 'goldfield')
        AND (faction_a = 'player_U3' OR faction_b = 'player_U3')
    `).get();
    assert.ok(rel);
    assert.equal(rel.kind, "war");
  });
});

describe("atrocity_legend + bounty handlers", () => {
  it("atrocity_legend writes a world_legends row + emits", async () => {
    const r = await atrocityHandler(db, {
      kind: "mass_atrocity_legend",
      worldId: "concordia",
      payload: {
        actorUserId: "U4", victimNpcId: "npc_civilian_x",
        location: { x: 30, z: 30 },
        meta: { archetype: "villager", name: "U4" },
      },
    });
    assert.equal(r.ok, true);
    assert.ok(r.legendId);
    const lg = db.prepare(`SELECT * FROM world_legends WHERE id = ?`).get(r.legendId);
    assert.ok(lg);
    assert.equal(lg.subject_id, "U4");
    assert.ok(lg.sentiment < 0);
  });

  it("bounty handler creates a kill quest with player target", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES ('npc_sheriff_2', 'concordia', 'sheriff')`).run();
    const r = await bountyHandler(db, {
      kind: "bounty_posted",
      worldId: "concordia",
      payload: { actorUserId: "U4", location: { x: 30, z: 30 }, meta: { name: "U4" } },
    });
    assert.equal(r.ok, true);
    assert.ok(r.questId);
    const q = db.prepare(`SELECT * FROM world_quests WHERE id = ?`).get(r.questId);
    assert.ok(q);
    const reward = JSON.parse(q.reward);
    assert.equal(reward.type, "kill_player");
    assert.equal(reward.target_user_id, "U4");
  });
});
