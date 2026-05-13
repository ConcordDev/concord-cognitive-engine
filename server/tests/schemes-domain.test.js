/**
 * Tier-2 contract tests for Concordia Phase 1 — schemes + hooks macros.
 *
 * Pins:
 *   - schemes.propose_player_scheme requires motive (opinion ≤ -50 OR stress ≥ 60)
 *   - schemes.list_targets surfaces both buckets (low_opinion + high_stress) deduped
 *   - schemes.gather_evidence advances evidence_count AND drops a hook artifact
 *   - schemes.abandon transitions player scheme to 'abandoned'
 *   - hooks.pickup / hooks.drop / hooks.destroy round-trip via macro layer
 *   - ownership: another player can't operate on your scheme or hook
 *
 * Run: node --test tests/schemes-domain.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerSchemesMacros from "../domains/schemes.js";
import { up as up117 } from "../migrations/117_faction_strategy.js";
import { up as up133 } from "../migrations/133_npc_legacy.js";
import { up as up152 } from "../migrations/152_npc_stress.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { up as up172 } from "../migrations/172_hook_artifacts.js";
import { recordOpinionEvent } from "../lib/npc-opinions.js";
import { bumpStress } from "../lib/npc-stress.js";

function setupDb() {
  const db = new Database(":memory:");
  up117(db); up133(db); up152(db); up153(db); up154(db); up155(db); up172(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('npc_hostile','Hostile','red','warrior')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('npc_friendly','Friendly','blue','scholar')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('npc_stressed','Stressed','red','mystic')`).run();
  return db;
}

function buildMacros() {
  const map = new Map();
  function register(domain, name, handler) {
    map.set(`${domain}.${name}`, handler);
  }
  registerSchemesMacros(register);
  return map;
}

function ctxFor(db, userId) {
  return { db, actor: { userId }, io: null };
}

describe("Phase 1 / schemes domain — propose_player_scheme motive gate", () => {
  it("rejects when target has neutral opinion + low stress", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const propose = macros.get("schemes.propose_player_scheme");
    const r = await propose(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_friendly", kind: "blackmail",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_motive");
  });

  it("accepts when target hates the player (opinion ≤ -50)", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "betrayed");
    const macros = buildMacros();
    const r = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "blackmail");
    assert.ok(r.schemeId.startsWith("sch_player_"));
  });

  it("accepts when target stress ≥ 60 even with neutral opinion", async () => {
    const db = setupDb();
    bumpStress(db, "npc_stressed", "custom", 35);  // 30 baseline + 35 = 65
    const macros = buildMacros();
    const r = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_stressed", kind: "seduce",
    });
    assert.equal(r.ok, true);
  });

  it("rejects bad kind", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "betrayed");
    const macros = buildMacros();
    const r = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "haunting",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_kind");
  });

  it("missing inputs rejected", async () => {
    const db = setupDb();
    const macros = buildMacros();
    const r = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("Phase 1 / schemes domain — list_targets", () => {
  it("surfaces low_opinion bucket", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const r = await macros.get("schemes.list_targets")(ctxFor(db, "user_1"));
    assert.equal(r.ok, true);
    assert.ok(r.targets.some((t) => t.npcId === "npc_hostile" && t.reason === "low_opinion"));
  });

  it("surfaces high_stress bucket", async () => {
    const db = setupDb();
    bumpStress(db, "npc_stressed", "custom", 35);
    const macros = buildMacros();
    const r = await macros.get("schemes.list_targets")(ctxFor(db, "user_1"));
    assert.ok(r.targets.some((t) => t.npcId === "npc_stressed" && t.reason === "high_stress"));
  });

  it("dedupes when both buckets match same NPC", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    bumpStress(db, "npc_hostile", "custom", 35);
    const macros = buildMacros();
    const r = await macros.get("schemes.list_targets")(ctxFor(db, "user_1"));
    const matches = r.targets.filter((t) => t.npcId === "npc_hostile");
    assert.equal(matches.length, 1);
    // First-listed bucket wins (low_opinion is listed first).
    assert.equal(matches[0].reason, "low_opinion");
  });
});

describe("Phase 1 / schemes domain — gather_evidence drops a hook", () => {
  it("inserts evidence row + drops a hook + increments evidence_count", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();

    // Open a player scheme.
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    const schemeId = proposed.schemeId;

    // Force scheme into gathering_evidence phase so gather_evidence is valid.
    db.prepare(`UPDATE npc_schemes SET phase = 'gathering_evidence' WHERE id = ?`).run(schemeId);

    const r = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_1"), {
      schemeId, worldId: "concordia-hub", location: { x: 1, y: 0, z: 2 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "evidence_added");
    assert.ok(r.hookId);

    const sch = db.prepare(`SELECT evidence_count FROM npc_schemes WHERE id = ?`).get(schemeId);
    assert.equal(sch.evidence_count, 1);

    const hook = db.prepare(`SELECT id, evidence_id, world_id, label FROM hook_artifacts WHERE id = ?`).get(r.hookId);
    assert.equal(hook.evidence_id, r.evidenceId);
    assert.equal(hook.world_id, "concordia-hub");
    assert.match(hook.label, /blackmail/);
  });

  it("rejects when scheme is in wrong phase", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    // Scheme starts in 'planning', not gathering_evidence.
    const r = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_1"), {
      schemeId: proposed.schemeId, worldId: "concordia-hub",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wrong_phase");
  });

  it("refuses to gather on someone else's scheme", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    db.prepare(`UPDATE npc_schemes SET phase = 'gathering_evidence' WHERE id = ?`).run(proposed.schemeId);
    const r = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_2"), {
      schemeId: proposed.schemeId, worldId: "concordia-hub",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yours");
  });
});

describe("Phase 1 / schemes domain — abandon", () => {
  it("marks scheme phase = abandoned", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    const r = await macros.get("schemes.abandon")(ctxFor(db, "user_1"), { schemeId: proposed.schemeId });
    assert.equal(r.action, "abandoned");
    const sch = db.prepare(`SELECT phase FROM npc_schemes WHERE id = ?`).get(proposed.schemeId);
    assert.equal(sch.phase, "abandoned");
  });
});

describe("Phase 1 / hooks domain — pickup / drop / destroy round trip", () => {
  it("pickup → drop → pickup → destroy works", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    db.prepare(`UPDATE npc_schemes SET phase = 'gathering_evidence' WHERE id = ?`).run(proposed.schemeId);
    const ev = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_1"), {
      schemeId: proposed.schemeId, worldId: "concordia-hub", location: { x: 1, y: 0, z: 2 },
    });
    const hookId = ev.hookId;

    // Hook is in world. Player picks it up.
    const p1 = await macros.get("hooks.pickup")(ctxFor(db, "user_1"), { hookId });
    assert.equal(p1.action, "picked_up");

    // Player drops it elsewhere.
    const d1 = await macros.get("hooks.drop")(ctxFor(db, "user_1"), { hookId, location: { x: 99, y: 0, z: 99 } });
    assert.equal(d1.action, "dropped");

    // Pickup again.
    const p2 = await macros.get("hooks.pickup")(ctxFor(db, "user_1"), { hookId });
    assert.equal(p2.action, "picked_up");

    // Destroy.
    const x = await macros.get("hooks.destroy")(ctxFor(db, "user_1"), { hookId });
    assert.equal(x.action, "destroyed");
  });

  it("hooks.list scopes to satchel only", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    db.prepare(`UPDATE npc_schemes SET phase = 'gathering_evidence' WHERE id = ?`).run(proposed.schemeId);
    const ev = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_1"), {
      schemeId: proposed.schemeId, worldId: "concordia-hub",
    });
    // Hook still in world.
    let r = await macros.get("hooks.list")(ctxFor(db, "user_1"));
    assert.equal(r.hooks.length, 0);
    // Pickup → list now finds it.
    await macros.get("hooks.pickup")(ctxFor(db, "user_1"), { hookId: ev.hookId });
    r = await macros.get("hooks.list")(ctxFor(db, "user_1"));
    assert.equal(r.hooks.length, 1);
  });

  it("can't operate on another player's satchel hook", async () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "npc_hostile", targetKind: "player", targetId: "user_1" }, -75, "x");
    const macros = buildMacros();
    const proposed = await macros.get("schemes.propose_player_scheme")(ctxFor(db, "user_1"), {
      targetKind: "npc", targetId: "npc_hostile", kind: "blackmail",
    });
    db.prepare(`UPDATE npc_schemes SET phase = 'gathering_evidence' WHERE id = ?`).run(proposed.schemeId);
    const ev = await macros.get("schemes.gather_evidence")(ctxFor(db, "user_1"), {
      schemeId: proposed.schemeId, worldId: "concordia-hub",
    });
    await macros.get("hooks.pickup")(ctxFor(db, "user_1"), { hookId: ev.hookId });
    const r = await macros.get("hooks.destroy")(ctxFor(db, "user_2"), { hookId: ev.hookId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yours");
  });
});
