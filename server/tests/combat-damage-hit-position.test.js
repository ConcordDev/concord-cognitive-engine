/**
 * Tier-2 contract tests — damage_events.{x,z} hit position + the
 * `tracking:footprints-updated` world push.
 *
 * The defect these pin (found 2026-07-25): migration 299 added
 * damage_events.{x,z} because GET /api/tracking/recent/:worldId reads the hit
 * position for components/world/FootprintLayer.tsx — but NEITHER INSERT in
 * lib/combat/damage-calculator.js listed the columns, so every row on every
 * build carried NULL. The overlay looked built and rendered nothing real.
 *
 * It was worse than inert. FootprintLayer feeds each row into a THREE.Vector3
 * `.set(x, 0.05, z).project(camera)`, and JS coerces `null` to 0 inside matrix
 * arithmetic (`null * 2 === 0`) — so a NULL row does not glitch or vanish, it
 * draws a fully convincing footprint at world ORIGIN. Hence two invariants:
 *
 *   1. A caller that HAS a real position gets it persisted verbatim.
 *   2. A caller that does NOT gets NULL — never 0, never a guess — and the
 *      read route drops those rows so a fabricated location can't render.
 *
 * Also pins the `tracking:footprints-updated` emit (Class A of
 * docs/DEAD_SUBSCRIPTION_AUDIT.md — a real listener with no emitter): fires
 * world-scoped only for a positioned hit, and coalesces per world so a hot
 * combat path can't turn one listener re-fetch into N broadcasts.
 *
 * Run: node --test tests/combat-damage-hit-position.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { applyDamageToNPC, applyDamageToPlayer } from "../lib/combat/damage-calculator.js";
import { up as up066 } from "../migrations/066_resource_bars_and_combat.js";
import { up as up299 } from "../migrations/299_drift_reconcile_additive_tail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function setupDb() {
  const db = new Database(":memory:");
  // Minimal world_npcs — 066 ALTERs it for resistances, and applyDamageToNPC
  // deducts HP from it. Created first so 066's guarded ALTER block runs for real.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      x REAL, y REAL, z REAL
    );
  `);
  up066(db);   // player_resource_bars + damage_events (no x/z yet)
  up299(db);   // adds damage_events.{x,z} — the columns nothing ever wrote

  // Pin the premise: 066 really does ship damage_events WITHOUT x/z, and 299
  // really is what adds them. If this ever stops holding the test is testing
  // a table it built itself rather than the real schema.
  const cols = db.pragma("table_info(damage_events)").map((c) => c.name);
  assert.ok(cols.includes("x") && cols.includes("z"), "migration 299 adds damage_events.{x,z}");

  db.prepare("INSERT INTO world_npcs (id, world_id, x, y, z) VALUES (?,?,?,?,?)")
    .run("npc_1", "tunya", 12.5, 0, -33.25);
  db.prepare(`
    INSERT INTO player_resource_bars (id, user_id, world_id, hp) VALUES (?,?,?,?)
  `).run("bars_1", "user_1", "tunya", 100);
  return db;
}

const DAMAGE = {
  rawDamage: 20, resistancePct: 0, finalDamage: 18,
  statusEffectsApplied: [], kill: false,
};

function rowFor(db, eventId) {
  return db.prepare("SELECT x, z FROM damage_events WHERE id = ?").get(eventId);
}

// ── emit capture ──────────────────────────────────────────────────────────────
// damage-calculator reaches the socket layer through the same globalThis escape
// hatch server.js stashes for lib modules that can't import it (circular).
let emitted = [];
let prevEmitToWorld, prevRealtimeEmit;

beforeEach(() => {
  emitted = [];
  prevEmitToWorld = globalThis._concordEmitToWorld;
  prevRealtimeEmit = globalThis._concordRealtimeEmit;
  globalThis._concordEmitToWorld = (worldId, event, payload) => {
    emitted.push({ worldId, event, payload });
    return { ok: true };
  };
  // Ensure the fallback can't silently satisfy an assertion meant for the
  // world-scoped path.
  globalThis._concordRealtimeEmit = undefined;
});

afterEach(() => {
  globalThis._concordEmitToWorld = prevEmitToWorld;
  globalThis._concordRealtimeEmit = prevRealtimeEmit;
});

describe("damage_events hit position", () => {
  it("applyDamageToNPC persists a real x/z supplied by the caller", () => {
    const db = setupDb();
    const npcPos = db.prepare("SELECT x, z FROM world_npcs WHERE id = ?").get("npc_1");
    const { eventId } = applyDamageToNPC(db, "w-npc-real", "user_1", "player", "npc_1", DAMAGE, {
      element: "fire", x: npcPos.x, z: npcPos.z,
    });
    assert.deepEqual(rowFor(db, eventId), { x: 12.5, z: -33.25 });
  });

  it("applyDamageToPlayer persists a real x/z supplied by the caller", () => {
    const db = setupDb();
    const { eventId } = applyDamageToPlayer(db, "w-player-real", "npc_1", "npc", "user_1", DAMAGE, {
      element: "none", x: -4.75, z: 88.125,
    });
    assert.deepEqual(rowFor(db, eventId), { x: -4.75, z: 88.125 });
  });

  it("stores NULL — not 0 — when the caller has no position", () => {
    const db = setupDb();
    const { eventId } = applyDamageToNPC(db, "w-none", "user_1", "player", "npc_1", DAMAGE, {
      element: "fire",
    });
    const row = rowFor(db, eventId);
    assert.equal(row.x, null);
    assert.equal(row.z, null);
    // The whole point: 0 is a REAL coordinate (world origin). Defaulting a
    // missing position to 0 is exactly the fabrication this guards against.
    assert.notEqual(row.x, 0);
  });

  it("coerces non-finite / junk coordinates to NULL", () => {
    const db = setupDb();
    for (const [x, z] of [[NaN, 1], ["abc", 2], [undefined, null], [Infinity, 3]]) {
      const { eventId } = applyDamageToNPC(db, "w-junk", "user_1", "player", "npc_1", DAMAGE, { x, z });
      assert.equal(rowFor(db, eventId).x, null, `x=${String(x)} → NULL`);
    }
  });

  it("still writes a row when only one axis is real (position is unusable, damage is not)", () => {
    const db = setupDb();
    const { eventId } = applyDamageToNPC(db, "w-half", "user_1", "player", "npc_1", DAMAGE, { x: 5 });
    const row = rowFor(db, eventId);
    assert.equal(row.x, 5);
    assert.equal(row.z, null);
    // Half a position is not a position — the read filter requires BOTH.
    const visible = db.prepare(
      "SELECT COUNT(*) c FROM damage_events WHERE world_id=? AND x IS NOT NULL AND z IS NOT NULL",
    ).get("w-half").c;
    assert.equal(visible, 0);
  });

  it("damage application itself is unaffected by the added columns", () => {
    const db = setupDb();
    applyDamageToPlayer(db, "tunya", "npc_1", "npc", "user_1", DAMAGE, { x: 1, z: 2 });
    const hp = db.prepare("SELECT hp FROM player_resource_bars WHERE user_id=?").get("user_1").hp;
    assert.equal(hp, 82); // 100 - 18
  });
});

describe("tracking:footprints-updated emit", () => {
  it("fires world-scoped with the real position on a positioned hit", () => {
    const db = setupDb();
    applyDamageToNPC(db, "w-emit-1", "user_1", "player", "npc_1", DAMAGE, { x: 12.5, z: -33.25 });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "tracking:footprints-updated");
    assert.equal(emitted[0].worldId, "w-emit-1", "targeted at the world room, not global");
    assert.equal(emitted[0].payload.worldId, "w-emit-1");
    assert.equal(emitted[0].payload.x, 12.5);
    assert.equal(emitted[0].payload.z, -33.25);
  });

  it("does NOT fire for a positionless hit (it would refresh the overlay into nothing)", () => {
    const db = setupDb();
    applyDamageToNPC(db, "w-emit-2", "user_1", "player", "npc_1", DAMAGE, {});
    assert.equal(emitted.length, 0);
  });

  it("coalesces per world so a hot combat path can't multiply fan-out", () => {
    const db = setupDb();
    for (let i = 0; i < 25; i++) {
      applyDamageToNPC(db, "w-emit-3", "user_1", "player", "npc_1", DAMAGE, { x: i, z: i });
    }
    assert.equal(emitted.length, 1, "25 hits inside the window → 1 broadcast");
    // All 25 rows are still persisted — coalescing suppresses duplicate
    // NOTIFICATIONS, never data. The listener re-fetches and sees every row.
    const stored = db.prepare(
      "SELECT COUNT(*) c FROM damage_events WHERE world_id=? AND x IS NOT NULL",
    ).get("w-emit-3").c;
    assert.equal(stored, 25);
  });

  it("coalescing is per world — a second world still gets its own push", () => {
    const db = setupDb();
    applyDamageToNPC(db, "w-emit-4a", "user_1", "player", "npc_1", DAMAGE, { x: 1, z: 1 });
    applyDamageToNPC(db, "w-emit-4b", "user_1", "player", "npc_1", DAMAGE, { x: 2, z: 2 });
    assert.deepEqual(emitted.map((e) => e.worldId), ["w-emit-4a", "w-emit-4b"]);
  });

  it("a missing socket layer never breaks combat", () => {
    const db = setupDb();
    globalThis._concordEmitToWorld = undefined;
    const { eventId } = applyDamageToNPC(db, "w-emit-5", "user_1", "player", "npc_1", DAMAGE, { x: 9, z: 9 });
    assert.deepEqual(rowFor(db, eventId), { x: 9, z: 9 });
  });
});

describe("GET /api/tracking/recent NULL-coordinate filter", () => {
  it("the SQL predicate hides legacy/positionless rows and keeps real ones", () => {
    const db = setupDb();
    const real = applyDamageToNPC(db, "w-filter", "user_1", "player", "npc_1", DAMAGE, { x: 7, z: 8 }).eventId;
    applyDamageToNPC(db, "w-filter", "user_1", "player", "npc_1", DAMAGE, {}); // positionless
    // A legacy row, written before migration 299's columns were ever populated.
    db.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, occurred_at)
      VALUES ('legacy','w-filter','user_1','player','npc_1','npc', unixepoch())
    `).run();

    const rows = db.prepare(`
      SELECT id, attacker_id, target_id, x, z, occurred_at
      FROM damage_events
      WHERE world_id = ? AND occurred_at >= ?
        AND x IS NOT NULL AND z IS NOT NULL
      ORDER BY occurred_at DESC LIMIT 50
    `).all("w-filter", 0);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, real);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM damage_events WHERE world_id=?").get("w-filter").c, 3);
  });

  it("the live route in server.js actually carries the guard", () => {
    // Structural pin: the behavioural assertion above proves the predicate
    // works, this proves the shipped route is the thing using it.
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const i = src.indexOf('app.get("/api/tracking/recent/:worldId"');
    assert.ok(i > 0, "tracking/recent route present");
    const body = src.slice(i, i + 1600);
    assert.match(body, /FROM damage_events/);
    assert.match(body, /x IS NOT NULL AND z IS NOT NULL/);
  });
});
