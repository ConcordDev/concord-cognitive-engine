// Phase AB — Nemesis NPC↔NPC graph tests.
//
// Uses a real better-sqlite3 in-memory DB so we exercise the actual
// SQL (sorted-pair CHECK + UNIQUE) rather than stubbing it. Each test
// boots a fresh schema via migration 226, plus the small subset of
// existing tables the cycle reads (world_npcs, npc_grudges,
// npc_schemes, character_opinions). We avoid running the full
// migrate.js pipeline here — the cycle is only allowed to consult
// these tables and gracefully no-ops when they're missing.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  formRelationship,
  escalate,
  decay,
  listForNpc,
  listInWorld,
  getVillageGossipFeed,
} from "../lib/npc-relationships.js";
import { runNemesisCycle } from "../emergent/nemesis-cycle.js";
import { up as upRelationships } from "../migrations/226_npc_relationships.js";

function freshDb() {
  const db = new Database(":memory:");
  upRelationships(db);

  // Tables the cycle's rule engine reads — minimal shape only.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      faction TEXT,
      archetype TEXT,
      level INTEGER
    );
    CREATE TABLE npc_grudges (
      npc_id TEXT,
      target_kind TEXT,
      target_id TEXT,
      narrative TEXT,
      severity INTEGER,
      event_at INTEGER
    );
    CREATE TABLE npc_schemes (
      id TEXT,
      plotter_id TEXT,
      target_id TEXT,
      phase TEXT,
      resolved_at INTEGER
    );
    CREATE TABLE character_opinions (
      npc_id TEXT,
      target_kind TEXT,
      target_id TEXT,
      score INTEGER
    );
  `);
  return db;
}

describe("Phase AB — npc-relationships primitives", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("formRelationship inserts with sorted pair", () => {
    const r = formRelationship(db, "npc-b", "npc-a", "rival", 0.2, { worldId: "tunya" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT npc_a_id, npc_b_id FROM npc_nemesis WHERE id = ?`).get(r.relationshipId);
    assert.equal(row.npc_a_id, "npc-a", "smaller id sorts first");
    assert.equal(row.npc_b_id, "npc-b");
  });

  it("formRelationship is idempotent on (pair, kind)", () => {
    const r1 = formRelationship(db, "n1", "n2", "rival", 0.2, { worldId: "tunya" });
    const r2 = formRelationship(db, "n2", "n1", "rival", 0.5, { worldId: "tunya" });
    assert.equal(r1.relationshipId, r2.relationshipId);
    assert.equal(r2.alreadyExisted, true);
  });

  it("same pair can carry multiple relationship kinds", () => {
    const a = formRelationship(db, "n1", "n2", "rival", 0.2, { worldId: "tunya" });
    const b = formRelationship(db, "n1", "n2", "former_lover", 0.3, { worldId: "tunya" });
    assert.notEqual(a.relationshipId, b.relationshipId);
  });

  it("formRelationship rejects self-relationship and invalid kind/intensity", () => {
    assert.equal(formRelationship(db, "x", "x", "rival").ok, false);
    assert.equal(formRelationship(db, "a", "b", "best_friend").ok, false);
    assert.equal(formRelationship(db, "a", "b", "rival", 2.5).ok, false);
  });

  it("escalate appends event and bumps intensity (clamped)", () => {
    const r = formRelationship(db, "n1", "n2", "rival", 0.9, { worldId: "tunya" });
    const e = escalate(db, r.relationshipId, "betrayal", "Mid-deal stab.", { intensityDelta: 0.5 });
    assert.equal(e.ok, true);
    assert.equal(e.newIntensity, 1, "intensity clamps at 1");
  });

  it("decay removes stale rows", () => {
    const r = formRelationship(db, "n1", "n2", "rival", 0.1, { worldId: "tunya" });
    db.prepare(`UPDATE npc_nemesis SET last_event_at = 0 WHERE id = ?`).run(r.relationshipId);
    const d = decay(db, 60 * 60); // 1h threshold
    assert.equal(d.ok, true);
    assert.equal(d.removed, 1);
  });

  it("listForNpc surfaces either side of the pair", () => {
    formRelationship(db, "alpha", "beta", "rival", 0.2, { worldId: "tunya" });
    formRelationship(db, "alpha", "gamma", "mentor", 0.5, { worldId: "tunya" });
    const list = listForNpc(db, "alpha");
    assert.equal(list.length, 2);
    const others = new Set(list.map(r => r.otherNpcId));
    assert.ok(others.has("beta") && others.has("gamma"));
  });

  it("listInWorld scopes by world", () => {
    formRelationship(db, "a", "b", "rival", 0.1, { worldId: "tunya" });
    formRelationship(db, "c", "d", "rival", 0.1, { worldId: "cyber" });
    const tunya = listInWorld(db, "tunya");
    assert.equal(tunya.length, 1);
  });

  it("getVillageGossipFeed paginates by recency", () => {
    const r = formRelationship(db, "n1", "n2", "rival", 0.1, { worldId: "tunya" });
    for (let i = 0; i < 5; i++) {
      escalate(db, r.relationshipId, "feud_event", `Event ${i}`);
    }
    const feed = getVillageGossipFeed(db, "tunya", { sinceS: 0, limit: 3 });
    assert.equal(feed.length, 3);
    assert.ok(feed[0].ts >= feed[1].ts, "newest first");
  });
});

describe("Phase AB — runNemesisCycle rule engine", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("player kill → kin pairs form family_enemy", () => {
    // Slain NPC + 3 surviving kin in tunya, same faction/archetype.
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("victim", "tunya", "faction-a", "guard", 12);
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("kin-1", "tunya", "faction-a", "guard", 10);
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("kin-2", "tunya", "faction-a", "guard", 8);
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("kin-3", "tunya", "faction-a", "guard", 7);
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, narrative, severity, event_at) VALUES (?, 'player', 'player', 'killed by player — the memory burns.', 8, ?)`)
      .run("victim", Math.floor(Date.now() / 1000));

    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    // 3 kin pair up to 3 family_enemy edges (C(3,2) = 3).
    const edges = listInWorld(db, "tunya", { kind: "family_enemy" });
    assert.equal(edges.length, 3);
  });

  it("scheme betrayal + soured opinion → rival relationship", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('actor', 'tunya')`).run();
    db.prepare(`INSERT INTO npc_schemes (plotter_id, target_id, phase, resolved_at) VALUES (?, ?, 'exposed', ?)`)
      .run("actor", "target", Math.floor(Date.now() / 1000));
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score) VALUES (?, 'npc', ?, ?)`)
      .run("actor", "target", -75);
    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    const rivals = listInWorld(db, "tunya", { kind: "rival" });
    assert.equal(rivals.length, 1);
  });

  it("mentor pair forms when level gap ≥ 15 and archetype matches", () => {
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("elder", "tunya", "f", "scholar", 25);
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("apprentice", "tunya", "f", "scholar", 5);
    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    const mentors = listInWorld(db, "tunya", { kind: "mentor" });
    assert.equal(mentors.length, 1);
  });

  it("no kin → no edges (single victim, no surviving same-archetype)", () => {
    db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?)`)
      .run("victim", "tunya", "f", "guard", 5);
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, narrative, severity, event_at) VALUES (?, 'player', 'player', 'killed by player — the memory burns.', 8, ?)`)
      .run("victim", Math.floor(Date.now() / 1000));
    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 0);
  });

  it("never throws on missing substrate", () => {
    const bareDb = new Database(":memory:");
    upRelationships(bareDb);
    const r = runNemesisCycle({ db: bareDb, worldId: "tunya" });
    assert.equal(r.ok, true);
  });

  it("returns no_db_or_world on missing inputs", () => {
    assert.equal(runNemesisCycle({}).ok, false);
    assert.equal(runNemesisCycle({ db }).ok, false);
  });

  it("env disable short-circuits the cycle", () => {
    process.env.CONCORD_NEMESIS_CYCLE = "0";
    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "disabled_by_env");
    delete process.env.CONCORD_NEMESIS_CYCLE;
  });

  it("decay runs every tick (idempotent + cheap)", () => {
    formRelationship(db, "a", "b", "rival", 0.1, { worldId: "tunya" });
    db.prepare(`UPDATE npc_nemesis SET last_event_at = 0`).run();
    // Stub the decay threshold by pinning npc_grudges window short — but
    // the cycle's internal threshold is 60d; we directly test the
    // wrapper by calling decay() with a 1s threshold here.
    const d = decay(db, 1);
    assert.equal(d.removed, 1);
    const r = runNemesisCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
  });

  it("escalate de-duplicates rivalry — second betrayal escalates, doesn't double-row", () => {
    // Set up: actor betrays target twice in window.
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('a', 'tunya')`).run();
    db.prepare(`INSERT INTO npc_schemes (plotter_id, target_id, phase, resolved_at) VALUES (?, ?, 'exposed', ?)`)
      .run("a", "b", Math.floor(Date.now() / 1000));
    db.prepare(`INSERT INTO npc_schemes (plotter_id, target_id, phase, resolved_at) VALUES (?, ?, 'exposed', ?)`)
      .run("a", "b", Math.floor(Date.now() / 1000));
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score) VALUES (?, 'npc', ?, ?)`)
      .run("a", "b", -75);
    runNemesisCycle({ db, worldId: "tunya" });
    const rivals = listInWorld(db, "tunya", { kind: "rival" });
    assert.equal(rivals.length, 1, "still one rival row, second betrayal escalates the first");
  });

  it("village gossip feed surfaces escalations", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('x', 'tunya')`).run();
    db.prepare(`INSERT INTO npc_schemes (plotter_id, target_id, phase, resolved_at) VALUES (?, ?, 'exposed', ?)`)
      .run("x", "y", Math.floor(Date.now() / 1000));
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score) VALUES (?, 'npc', ?, ?)`)
      .run("x", "y", -80);
    // Second pass escalates the same row.
    runNemesisCycle({ db, worldId: "tunya" });
    db.prepare(`INSERT INTO npc_schemes (plotter_id, target_id, phase, resolved_at) VALUES (?, ?, 'exposed', ?)`)
      .run("x", "y", Math.floor(Date.now() / 1000));
    runNemesisCycle({ db, worldId: "tunya" });
    const feed = getVillageGossipFeed(db, "tunya", { sinceS: 0 });
    assert.ok(feed.length >= 1);
  });
});
