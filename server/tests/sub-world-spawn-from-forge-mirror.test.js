// server/tests/sub-world-spawn-from-forge-mirror.test.js
//
// Wave 4 gap-closure — the legacy singular `sub_world.spawn_from_forge`
// macro (registered inline in server.js) had the identical "never mirrors
// to the real `worlds` table" defect as `sub_worlds.spawn`
// (server/domains/sub-worlds.js), PLUS it never mirrored at all: it wrote
// ONLY to the `sub_worlds` SQL table (migration 165), so the real
// cross-world travel path (`POST /api/worlds/travel` → `loadWorld`,
// `SELECT * FROM worlds WHERE id = ? AND status = 'active'`) would 404 on
// every world this macro ever spawned. See
// docs/lens-specs/sub-worlds-capability-map.md ("Investigated and
// honestly deferred" → legacy `spawn_from_forge` "flagged for a future
// backend-hygiene pass").
//
// This file drives the REAL macro (via server.js's __TEST__ surface,
// runMacro + makeInternalCtx — same pattern as
// tests/llm-hint-macros-contract.test.js) against the real, already-
// migrated dev DB, and asserts both:
//   1. the pre-existing behavior (a `sub_worlds` SQL row is written) is
//      unaffected;
//   2. the NEW behavior — a mirrored, travelable `worlds` row now exists,
//      with the same kind-appropriate starter content
//      `sub_worlds.spawn` gets, via the shared
//      `server/lib/sub-world-starter-content.js` helper.
//
// Kept in its own file (separate from the fast unit/domain-level
// tests/sub-world-starter-content.test.js) because reaching an inline
// server.js `register()` call requires booting the full server module.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

let __TEST__;
before(async () => {
  const mod = await import("../server.js");
  __TEST__ = mod.__TEST__;
  if (!__TEST__) throw new Error("server.js did not export __TEST__");
});
registerServerCleanExit(() => __TEST__);

function seedForgeAppDtu(db, id, userId) {
  db.prepare(`
    INSERT INTO dtus (id, title, type, creator_id, owner_user_id)
    VALUES (?, ?, 'forge_app', ?, ?)
  `).run(id, `Forge App ${id}`, userId, userId);
}

describe("sub_world.spawn_from_forge — real worlds-table mirror + starter content", () => {
  let db;
  let userId;
  let dtuId;

  before(() => {
    db = __TEST__.STATE?.db;
    assert.ok(db, "STATE.db must be a real sqlite handle for this test to mean anything");
    userId = `test_user_${crypto.randomUUID().slice(0, 8)}`;
    // Minimal FK-satisfying user row (dtus.owner_user_id references users(id)
    // ON DELETE SET NULL — not enforced without PRAGMA foreign_keys=ON, but
    // seed one anyway so this test reads honestly against the real schema).
    try {
      db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', unixepoch())`)
        .run(userId, `u_${userId}`, `${userId}@example.test`);
    } catch (_e) { /* users table shape may already have this row from a prior run; non-fatal */ }
    dtuId = `dtu_forge_${crypto.randomUUID().slice(0, 8)}`;
    seedForgeAppDtu(db, dtuId, userId);
  });

  after(() => {
    // Best-effort cleanup — don't leave synthetic rows in the shared dev DB.
    try {
      const worldIds = db.prepare(`SELECT world_id FROM sub_worlds WHERE forge_app_dtu_id = ?`).all(dtuId).map(r => r.world_id);
      for (const wid of worldIds) {
        try { db.prepare(`DELETE FROM world_npcs WHERE world_id = ?`).run(wid); } catch (_e) { /* table may not exist in some builds */ }
        try { db.prepare(`DELETE FROM worlds WHERE id = ?`).run(wid); } catch (_e) { /* best-effort */ }
      }
      db.prepare(`DELETE FROM sub_worlds WHERE forge_app_dtu_id = ?`).run(dtuId);
      db.prepare(`DELETE FROM dtus WHERE id = ?`).run(dtuId);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    } catch (_e) { /* best-effort teardown */ }
  });

  it("spawns the legacy sub_worlds row AND mirrors a real, travelable worlds row with starter content", async () => {
    const ctx = __TEST__.makeInternalCtx("test");
    ctx.actor = { userId, orgId: "internal", role: "owner", scopes: ["*"], internal: true };

    const r = await __TEST__.runMacro("sub_world", "spawn_from_forge", {
      forgeAppDtuId: dtuId,
      name: "Legacy Forge World",
      kind: "research_zone",
    }, ctx);

    assert.equal(r.ok, true, `spawn_from_forge should succeed: ${JSON.stringify(r)}`);
    const worldId = r.worldId;
    assert.ok(worldId, "must return a worldId");

    // Pre-existing behavior unaffected: the canonical sub_worlds SQL row.
    const legacyRow = db.prepare(`SELECT * FROM sub_worlds WHERE world_id = ?`).get(worldId);
    assert.ok(legacyRow, "the legacy sub_worlds row must still be written");
    assert.equal(legacyRow.name, "Legacy Forge World");

    // NEW: a real, travelable worlds row now exists — this is the fix.
    const worldRow = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId);
    assert.ok(worldRow, "spawn_from_forge must now mirror a row into the real worlds table");
    assert.equal(worldRow.status, "active");
    assert.equal(worldRow.universe_type, "research_zone");

    // NEW: it is not a bare shell — kind-appropriate modulators landed.
    assert.notEqual(worldRow.physics_modulators, "{}");
    assert.notEqual(worldRow.rule_modulators, "{}");
    const rules = JSON.parse(worldRow.rule_modulators);
    assert.equal(rules.theme, "research_outpost");

    // NEW: a small deterministic starter NPC roster exists, same table
    // shape/write-path the world lens NPC queries + real authored worlds
    // use (content-seeder.js#_persistAuthoredNpcToWorld).
    let npcs = [];
    try { npcs = db.prepare(`SELECT * FROM world_npcs WHERE world_id = ?`).all(worldId); }
    catch (_e) { /* world_npcs absent in some minimal builds — degrade gracefully */ }
    if (npcs.length || db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_npcs'").get()) {
      assert.equal(npcs.length, 2, "research_zone preset seeds exactly 2 starter NPCs");
      assert.ok(npcs.every(n => n.archetype === "scholar"));
    }
  });

  it("still fails honestly when the DTU is not a forge_app (pre-existing gate unaffected)", async () => {
    const notForgeId = `dtu_notforge_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO dtus (id, title, type, creator_id, owner_user_id) VALUES (?, 'Not Forge', 'knowledge', ?, ?)`)
      .run(notForgeId, userId, userId);
    const ctx = __TEST__.makeInternalCtx("test");
    ctx.actor = { userId, orgId: "internal", role: "owner", scopes: ["*"], internal: true };
    const r = await __TEST__.runMacro("sub_world", "spawn_from_forge", {
      forgeAppDtuId: notForgeId,
      name: "Should Not Spawn",
    }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_forge_app");
    db.prepare(`DELETE FROM dtus WHERE id = ?`).run(notForgeId);
  });
});
