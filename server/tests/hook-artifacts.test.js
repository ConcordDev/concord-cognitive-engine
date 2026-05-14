/**
 * Tier-2 contract tests for Concordia Phase 1 — hook artifacts.
 *
 * Pins:
 *   - dropHook validates input (worldId, exactly one substrate link)
 *   - pickup transitions world → player
 *   - drop transitions player → world (with location)
 *   - destroy is final (final state, not deletable)
 *   - stealHook records opinion delta and transitions player → npc
 *   - listHooksForPlayer / listHooksInWorld filter correctly
 *   - destroyed hooks are excluded from list queries
 *
 * Run: node --test tests/hook-artifacts.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  dropHook,
  pickupHook,
  dropFromSatchel,
  destroyHook,
  stealHook,
  listHooksForPlayer,
  listHooksInWorld,
} from "../lib/hook-artifacts.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { up as up172 } from "../migrations/172_hook_artifacts.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db); up154(db); up155(db); up172(db);
  // Seed a secret + evidence so hooks have parents to reference.
  db.prepare(`
    INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
    VALUES ('sec_test_1', 'npc_holder', 'npc', 'npc_subject', 'crime', 'stole the chest', 5)
  `).run();
  db.prepare(`
    INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind)
    VALUES ('sch_1', 'player', 'user_1', 'npc', 'npc_subject', 'blackmail')
  `).run();
  db.prepare(`
    INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind, detail)
    VALUES ('ev_1', 'sch_1', 'blackmail', 'letter')
  `).run();
  return db;
}

describe("Phase 1 / hook-artifacts — dropHook validation", () => {
  it("rejects when no worldId", () => {
    const db = setupDb();
    const r = dropHook(db, { secretId: "sec_test_1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("rejects when no substrate link", () => {
    const db = setupDb();
    const r = dropHook(db, { worldId: "concordia-hub" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_substrate_link");
  });

  it("rejects when both substrate links given", () => {
    const db = setupDb();
    const r = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", evidenceId: "ev_1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "two_substrate_links");
  });

  it("rejects bad holder kind", () => {
    const db = setupDb();
    const r = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "ghost" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_holder_kind");
  });

  it("drops into world successfully", () => {
    const db = setupDb();
    const r = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", location: { x: 10, y: 0, z: 5 } });
    assert.equal(r.ok, true);
    assert.ok(r.hookId.startsWith("hook_"));
  });

  it("drops directly into player's satchel", () => {
    const db = setupDb();
    const r = dropHook(db, {
      worldId: "concordia-hub",
      evidenceId: "ev_1",
      holderKind: "player",
      holderId: "user_1",
    });
    assert.equal(r.ok, true);
    const hooks = listHooksForPlayer(db, "user_1");
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].evidence_id, "ev_1");
  });
});

describe("Phase 1 / hook-artifacts — pickup lifecycle", () => {
  it("pickups world hook into player satchel", () => {
    const db = setupDb();
    const drop = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1" });
    const pickup = pickupHook(db, "user_1", drop.hookId);
    assert.equal(pickup.action, "picked_up");
    const held = listHooksForPlayer(db, "user_1");
    assert.equal(held.length, 1);
  });

  it("idempotent when already holding", () => {
    const db = setupDb();
    const drop = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = pickupHook(db, "user_1", drop.hookId);
    assert.equal(r.action, "already_held");
  });

  it("refuses pickup when held by NPC", () => {
    const db = setupDb();
    const drop = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "npc", holderId: "npc_holder" });
    const r = pickupHook(db, "user_1", drop.hookId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_in_world");
  });
});

describe("Phase 1 / hook-artifacts — drop from satchel", () => {
  it("drops from satchel back into world with location", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = dropFromSatchel(db, "user_1", drop1.hookId, { x: 42, y: 0, z: 17 });
    assert.equal(r.action, "dropped");
    const inWorld = listHooksInWorld(db, "concordia-hub");
    assert.equal(inWorld.length, 1);
    assert.match(inWorld[0].location_json, /42/);
  });

  it("refuses to drop someone else's hook", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = dropFromSatchel(db, "user_2", drop1.hookId, null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yours");
  });
});

describe("Phase 1 / hook-artifacts — destroy is final", () => {
  it("destroys a held hook", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = destroyHook(db, "user_1", drop1.hookId);
    assert.equal(r.action, "destroyed");
    assert.equal(r.linked.secretId, "sec_test_1");
  });

  it("destroyed hook excluded from satchel listing", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    destroyHook(db, "user_1", drop1.hookId);
    assert.equal(listHooksForPlayer(db, "user_1").length, 0);
  });

  it("destroyed hook excluded from world listing", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    destroyHook(db, "user_1", drop1.hookId);
    assert.equal(listHooksInWorld(db, "concordia-hub").length, 0);
  });

  it("can't destroy someone else's hook", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = destroyHook(db, "user_2", drop1.hookId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yours");
  });

  it("idempotent on re-destroy", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    destroyHook(db, "user_1", drop1.hookId);
    const r = destroyHook(db, "user_1", drop1.hookId);
    assert.equal(r.ok, true);
    assert.equal(r.action, "already_destroyed");
  });
});

describe("Phase 1 / hook-artifacts — stealHook by NPC", () => {
  it("transitions player → npc and records opinion delta", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    const r = stealHook(db, drop1.hookId, "npc_holder", "user_1");
    assert.equal(r.action, "stolen");
    // Opinion delta -10 recorded.
    const op = db.prepare(`
      SELECT score FROM character_opinions
      WHERE npc_id = 'npc_holder' AND target_kind = 'player' AND target_id = 'user_1'
    `).get();
    assert.equal(op?.score, -10);
    // Hook no longer in player satchel.
    assert.equal(listHooksForPlayer(db, "user_1").length, 0);
  });

  it("refuses when victim isn't the holder", () => {
    const db = setupDb();
    const drop1 = dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1" });
    const r = stealHook(db, drop1.hookId, "npc_holder", "user_1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "victim_not_holder");
  });
});

describe("Phase 1 / hook-artifacts — world scoping (mig 101 invariant)", () => {
  it("worldId filter excludes other-world hooks", () => {
    const db = setupDb();
    dropHook(db, { worldId: "concordia-hub", secretId: "sec_test_1", holderKind: "player", holderId: "user_1" });
    db.prepare(`
      INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
      VALUES ('sec_test_2', 'npc_holder', 'npc', 'npc_subject', 'debt', 'owes 50 sparks', 5)
    `).run();
    dropHook(db, { worldId: "tunya", secretId: "sec_test_2", holderKind: "player", holderId: "user_1" });
    assert.equal(listHooksForPlayer(db, "user_1").length, 2);
    assert.equal(listHooksForPlayer(db, "user_1", { worldId: "concordia-hub" }).length, 1);
    assert.equal(listHooksForPlayer(db, "user_1", { worldId: "tunya" }).length, 1);
  });
});
