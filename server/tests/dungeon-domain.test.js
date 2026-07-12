/**
 * Wave 4 gap-closure — Tier-2 contract test for the `dungeon` macro domain
 * (server/domains/dungeon.js). The lib-level engine (openInstance, recordHit,
 * phase math, loot-by-share, lockouts) is already pinned by
 * server/tests/integration/dungeon-instance.test.js; this file pins the thin
 * macro wrappers actually reached by `POST /api/lens/run` — in particular
 * the two macros this pass added (`dungeon.active`, `dungeon.lockouts`) that
 * the new frontend DungeonHUD depends on to discover an in-progress instance
 * without persisting an instanceId client-side.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up241 } from "../migrations/241_difficulty_tiers.js";
import { up as up269 } from "../migrations/269_dungeon_instances.js";

// Register the macros into a captive registry so we can call them directly,
// the same lightweight pattern used by tests/appearance-domain.test.js —
// no full server.js boot required.
const _registry = new Map();
function register(domain, name, handler) {
  _registry.set(`${domain}.${name}`, handler);
}

import("../domains/dungeon.js").then((mod) => {
  mod.default(register);
});

async function waitForRegistration(name) {
  for (let i = 0; i < 50; i++) {
    if (_registry.has(name)) return;
    await new Promise((r) => { setTimeout(r, 20); });
  }
}

function freshDb() {
  const db = new Database(":memory:");
  up241(db);
  up269(db);
  return db;
}

describe("dungeon.encounters", () => {
  beforeEach(() => waitForRegistration("dungeon.encounters"));

  it("returns the authored catalog with no auth required", async () => {
    const handler = _registry.get("dungeon.encounters");
    const r = await handler({}, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.encounters) && r.encounters.length >= 2);
    assert.ok(r.encounters.some((e) => e.id === "hollow_warden"));
  });
});

describe("dungeon.open / dungeon.hit / dungeon.state", () => {
  let db;
  beforeEach(async () => {
    db = freshDb();
    await waitForRegistration("dungeon.state");
  });

  it("open requires an authenticated actor + worldId + encounterId", async () => {
    const open = _registry.get("dungeon.open");
    const noUser = await open({ db }, { worldId: "w1", encounterId: "hollow_warden" });
    assert.equal(noUser.reason, "missing_inputs");

    const opened = await open({ db, actor: { userId: "u1" } }, { worldId: "w1", encounterId: "hollow_warden" });
    assert.equal(opened.ok, true);
    assert.ok(opened.instanceId);
  });

  it("hit rejects a damage report above the shared combat cap through the macro path", async () => {
    const open = _registry.get("dungeon.open");
    const hit = _registry.get("dungeon.hit");
    const opened = await open({ db, actor: { userId: "u1" } }, { worldId: "w1", encounterId: "tide_colossus" });

    const over = await hit({ db, actor: { userId: "u1" } }, { instanceId: opened.instanceId, damage: 999999 });
    assert.equal(over.ok, false);
    assert.equal(over.reason, "damage_cap_exceeded");

    const state = _registry.get("dungeon.state");
    const s = await state({ db }, { instanceId: opened.instanceId });
    assert.equal(s.instance.boss_hp, s.instance.boss_max_hp, "a rejected report must not move boss hp");
  });

  it("state round-trips the live instance for the HUD", async () => {
    const open = _registry.get("dungeon.open");
    const state = _registry.get("dungeon.state");
    const opened = await open({ db, actor: { userId: "u1" } }, { worldId: "w1", encounterId: "hollow_warden" });
    const s = await state({ db }, { instanceId: opened.instanceId });
    assert.equal(s.ok, true);
    assert.equal(s.instance.id, opened.instanceId);
    assert.equal(s.instance.status, "active");
    assert.equal(s.instance.participants.length, 1);
  });
});

describe("dungeon.active — Wave 4 (frontend reconnect path)", () => {
  let db;
  beforeEach(async () => {
    db = freshDb();
    await waitForRegistration("dungeon.active");
  });

  it("requires an authenticated actor", async () => {
    const active = _registry.get("dungeon.active");
    const r = await active({ db }, { worldId: "w1" });
    assert.equal(r.reason, "missing_inputs");
  });

  it("returns null (not an error) when the caller has no active instance", async () => {
    const active = _registry.get("dungeon.active");
    const r = await active({ db, actor: { userId: "u1" } }, { worldId: "w1" });
    assert.equal(r.ok, true);
    assert.equal(r.instance, null);
  });

  it("finds the caller's real in-progress instance, world-scoped", async () => {
    const open = _registry.get("dungeon.open");
    const active = _registry.get("dungeon.active");
    const opened = await open({ db, actor: { userId: "u1" } }, { worldId: "w1", encounterId: "hollow_warden" });

    const found = await active({ db, actor: { userId: "u1" } }, { worldId: "w1" });
    assert.equal(found.ok, true);
    assert.equal(found.instance.id, opened.instanceId);

    const wrongWorld = await active({ db, actor: { userId: "u1" } }, { worldId: "some-other-world" });
    assert.equal(wrongWorld.instance, null);
  });
});

describe("dungeon.lockouts — Wave 4", () => {
  let db;
  beforeEach(async () => {
    db = freshDb();
    await waitForRegistration("dungeon.lockouts");
  });

  it("requires an authenticated actor", async () => {
    const lockouts = _registry.get("dungeon.lockouts");
    const r = await lockouts({ db }, {});
    assert.equal(r.reason, "missing_inputs");
  });

  it("is empty for a user who has never cleared/wiped an encounter", async () => {
    const lockouts = _registry.get("dungeon.lockouts");
    const r = await lockouts({ db, actor: { userId: "u1" } }, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.lockouts, []);
  });

  it("surfaces a real lockout after a clear", async () => {
    const open = _registry.get("dungeon.open");
    const hit = _registry.get("dungeon.hit");
    const lockouts = _registry.get("dungeon.lockouts");
    const opened = await open({ db, actor: { userId: "u1" } }, { worldId: "w1", encounterId: "hollow_warden" });

    // Grind the boss down with capped hits until it clears.
    let last;
    do {
      last = await hit({ db, actor: { userId: "u1" } }, { instanceId: opened.instanceId, damage: 500 });
      assert.equal(last.ok, true);
    } while (!last.cleared);

    const r = await lockouts({ db, actor: { userId: "u1" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.lockouts.length, 1);
    assert.equal(r.lockouts[0].encounterId, "hollow_warden");
    assert.equal(r.lockouts[0].tier, "finder");
  });
});
