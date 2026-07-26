/**
 * R5 status-correction follow-on — closes the gap docs/GODOT_PROTOCOL.md
 * named: `server/lib/combat-polish.js`'s `combat:polish` emit and
 * `server/routes/worlds.js`'s NPC-route `combat:impact` emit both called
 * `io.to(world:${worldId}).emit(...)` directly, which predates and BYPASSES
 * the Godot gateway mirror (`realtimeEmit`/`emitToWorld` →
 * `_godotGatewayEmitter` in server.js). A connected Godot client received
 * ZERO frames on either channel even though the web client received every
 * one.
 *
 * This file pins, for BOTH sites:
 *   1. The web client still receives the exact same event name and the same
 *      domain-meaningful payload fields it always did (byte-identical on
 *      what any consumer actually reads — see
 *      concord-frontend/components/world/CombatBridges.tsx's
 *      `CombatPolishEvent`/`combat:impact` shapes, which read only
 *      id/worldId/actorKind/actorId/eventKind/detail/ts and
 *      attackerId/targetId/severity/isKill/targetPosition/attackerPosition/
 *      feel respectively — never `_seq`/`_evt`).
 *   2. The Godot gateway mirror now ALSO fires — modeled with a faithful,
 *      minimal reconstruction of server.js#emitToWorld's real contract
 *      (room-broadcast via `io.to(room).emit(...)` PLUS a best-effort
 *      `_godotGatewayEmitter.emitToRoom(...)` call), not a bare stub — so
 *      the assertion actually proves the mirror pattern, not just "a
 *      function was called."
 *   3. The pre-existing (legacy) `io.to()`-only path keeps working when
 *      `emitToWorld`/`_concordEmitToWorld` isn't supplied — the fix is
 *      additive, not a breaking replacement.
 *
 * Run: node --test tests/godot-gateway-mirror-emit.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreateActorState,
  triggerRocked,
} from "../lib/combat-polish.js";

import { emitWorldEvent } from "../routes/worlds.js";

// ── Fake DB (mirrors the shape combat-polish-integration.test.js uses) ─────

function makeFakeDb() {
  const t = { combat_actor_state: new Map(), combat_events: new Map() };
  const k = (kind, id) => `${kind}|${id}`;
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(s, a),
      get: (...a) => getStmt(s, a),
      all: () => [],
    };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO combat_actor_state")) {
      const [kind, id, world, profile] = args;
      t.combat_actor_state.set(k(kind, id), {
        actor_kind: kind, actor_id: id, world_id: world, profile_id: profile,
        stance: "high", posture: "balanced", awareness: "idle", awareness_target: null,
        gas: 100, max_gas: 100, combo_count: 0, combo_last_at_ms: 0, rocked_until_ms: 0,
        grapple_target: null, updated_at: 0,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE combat_actor_state")) return { changes: 1 };
    if (sql.startsWith("INSERT INTO combat_events")) {
      const [id, world, kind, actor, eventKind, detail] = args;
      t.combat_events.set(id, { id, world_id: world, actor_kind: kind, actor_id: actor, event_kind: eventKind, detail_json: detail });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM combat_actor_state")) return t.combat_actor_state.get(k(args[0], args[1])) || null;
    if (sql.startsWith("SELECT profile_id FROM combat_actor_state")) {
      const r = t.combat_actor_state.get(k(args[0], args[1]));
      return r ? { profile_id: r.profile_id } : null;
    }
    if (sql.startsWith("SELECT rocked_until_ms FROM combat_actor_state")) {
      const r = t.combat_actor_state.get(k(args[0], args[1]));
      return r ? { rocked_until_ms: r.rocked_until_ms } : null;
    }
    return null;
  }
  return { prepare, _t: t };
}

// ── A faithful (not bare-stub) reconstruction of server.js#emitToWorld's
//    real contract: room-broadcast via socket.io + best-effort Godot mirror
//    fan-out. Mirrors server.js:8719-8737 exactly in shape. ────────────────

function makeGatewayHarness() {
  const roomEmissions = [];   // what the web client (socket.io room) sees
  const godotEmissions = [];  // what a connected Godot client sees
  const io = {
    to(channel) {
      return {
        emit(event, payload) { roomEmissions.push({ channel, event, payload }); },
      };
    },
  };
  const godotGatewayEmitter = {
    emitToRoom(room, event, payload) { godotEmissions.push({ room, event, payload }); },
  };
  function emitToWorld(worldId, event, payload) {
    if (!worldId) return { ok: false, reason: "no_target" };
    const enriched = { ...payload, ts: new Date().toISOString(), _seq: 1, _evt: event };
    io.to(`world:${worldId}`).emit(event, enriched);
    try { godotGatewayEmitter.emitToRoom(`world:${worldId}`, event, enriched); } catch { /* survive */ }
    return { ok: true };
  }
  return { io, godotGatewayEmitter, emitToWorld, roomEmissions, godotEmissions };
}

beforeEach(() => {
  delete globalThis._concordEmitToWorld;
  delete globalThis.__CONCORD_REALTIME__;
});
afterEach(() => {
  delete globalThis._concordEmitToWorld;
  delete globalThis.__CONCORD_REALTIME__;
});

// ── Site 1: server/lib/combat-polish.js:599 (combat:polish) ────────────────

describe("combat-polish.js `combat:polish` — Godot mirror fix", () => {
  it("legacy fallback (no gateway hook): web client gets the exact same event/payload as before the fix", () => {
    const db = makeFakeDb();
    const legacyIo = {
      to(channel) {
        return { emit: (event, payload) => legacyEmissions.push({ channel, event, payload }) };
      },
    };
    const legacyEmissions = [];
    globalThis.__CONCORD_REALTIME__ = { io: legacyIo };
    // No globalThis._concordEmitToWorld set — exercises the pre-fix code path.

    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", worldId: "concordia-hub", profileId: "sifu_brawler" });
    triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 50, nowMs: 1000 });

    assert.equal(legacyEmissions.length, 1, "expected exactly one legacy io emission");
    const e = legacyEmissions[0];
    assert.equal(e.channel, "world:concordia-hub");
    assert.equal(e.event, "combat:polish");
    assert.equal(e.payload.actorKind, "player");
    assert.equal(e.payload.actorId, "u1");
    assert.equal(e.payload.eventKind, "rocked");
    assert.ok(typeof e.payload.detail === "object");
    // Pinned by the pre-existing tests/combat-polish-integration.test.js too —
    // reasserted here so this file is self-contained proof the fix didn't
    // regress the un-enriched, plain-number ts contract on the fallback path.
    assert.ok(typeof e.payload.ts === "number", "fallback path must not enrich ts to an ISO string");
  });

  it("gateway hook present: web client STILL gets the same domain fields, AND the Godot mirror now fires", () => {
    const db = makeFakeDb();
    const gw = makeGatewayHarness();
    globalThis._concordEmitToWorld = gw.emitToWorld;
    // Deliberately also set a legacy REALTIME.io so we can prove it is NOT
    // used directly (the gateway hook takes priority, per the fix).
    const legacyEmissions = [];
    globalThis.__CONCORD_REALTIME__ = {
      io: { to: () => ({ emit: (...a) => legacyEmissions.push(a) }) },
    };

    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", worldId: "concordia-hub", profileId: "sifu_brawler" });
    triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 50, nowMs: 1000 });

    // The legacy direct-io path must NOT have fired — the gateway hook owns
    // the room emit now (it does its own io.to() internally).
    assert.equal(legacyEmissions.length, 0, "legacy REALTIME.io must not be touched once the gateway hook is present");

    // 1) Web client: same event name, same domain payload fields.
    assert.equal(gw.roomEmissions.length, 1);
    const room = gw.roomEmissions[0];
    assert.equal(room.channel, "world:concordia-hub");
    assert.equal(room.event, "combat:polish");
    assert.equal(room.payload.actorKind, "player");
    assert.equal(room.payload.actorId, "u1");
    assert.equal(room.payload.eventKind, "rocked");
    assert.ok(typeof room.payload.detail === "object");
    assert.ok(room.payload.id?.startsWith("ce_"));

    // 2) NEW: a connected Godot client now ALSO receives the identical frame.
    assert.equal(gw.godotEmissions.length, 1, "Godot mirror must fire exactly once");
    const godot = gw.godotEmissions[0];
    assert.equal(godot.room, "world:concordia-hub");
    assert.equal(godot.event, "combat:polish");
    assert.equal(godot.payload.actorId, "u1");
    assert.equal(godot.payload.eventKind, "rocked");
    // Same enrichment instance reached both the web room emit and the Godot
    // mirror (emitToWorld enriches once, fans to both) — not two divergent
    // payloads.
    assert.deepEqual(godot.payload, room.payload);
  });
});

// ── Site 2: server/routes/worlds.js:2795 (combat:impact, NPC route) ────────

describe("routes/worlds.js `emitWorldEvent` helper — Godot mirror fix", () => {
  const samplePayload = Object.freeze({
    worldId: "concordia-hub",
    attackerId: "u1",
    targetId: "npc1",
    targetKind: "npc",
    severity: "rocked",
    impactMomentum: 130,
    element: "fire",
    damage: 42.7,
    isKill: false,
    targetPosition: { x: 1, y: 0, z: 2 },
    attackerPosition: { x: 0, y: 0, z: 0 },
    feel: { targetPauseMs: 80, knockback: 4 },
    vfx: { descriptor: "grandmaster-fire" },
    skillKey: "fire.punch.t3",
  });

  it("legacy fallback (no emitToWorld injected): web client gets the exact same event/payload as before the fix", () => {
    const emissions = [];
    const io = { to: (ch) => ({ emit: (event, payload) => emissions.push({ ch, event, payload }) }) };

    const result = emitWorldEvent({ io, emitToWorld: undefined, worldId: "concordia-hub", event: "combat:impact", payload: samplePayload });

    assert.equal(result, "io");
    assert.equal(emissions.length, 1);
    assert.equal(emissions[0].ch, "world:concordia-hub");
    assert.equal(emissions[0].event, "combat:impact");
    // Byte-identical payload — the exact same object, untouched.
    assert.deepEqual(emissions[0].payload, samplePayload);
  });

  it("emitToWorld injected: web client STILL gets the same event/payload (via the gateway's own room emit), AND the Godot mirror now fires", () => {
    const gw = makeGatewayHarness();
    const legacyEmissions = [];
    const legacyIo = { to: () => ({ emit: (...a) => legacyEmissions.push(a) }) };

    const result = emitWorldEvent({ io: legacyIo, emitToWorld: gw.emitToWorld, worldId: "concordia-hub", event: "combat:impact", payload: samplePayload });

    assert.equal(result, "gateway");
    // The raw io passed alongside emitToWorld must NOT be used directly —
    // emitToWorld owns the room emit (it does its own io.to() internally).
    assert.equal(legacyEmissions.length, 0, "the bare io fallback must not fire when emitToWorld is present");

    // 1) Web client: same event name; every domain field from the original
    //    payload is present with the same value (enrichment only ADDS
    //    ts/_seq/_evt, never changes/removes an existing domain field).
    assert.equal(gw.roomEmissions.length, 1);
    const room = gw.roomEmissions[0];
    assert.equal(room.channel, "world:concordia-hub");
    assert.equal(room.event, "combat:impact");
    for (const [key, value] of Object.entries(samplePayload)) {
      assert.deepEqual(room.payload[key], value, `domain field '${key}' must be unchanged`);
    }

    // 2) NEW: a connected Godot client now ALSO receives the identical frame.
    assert.equal(gw.godotEmissions.length, 1, "Godot mirror must fire exactly once");
    const godot = gw.godotEmissions[0];
    assert.equal(godot.room, "world:concordia-hub");
    assert.equal(godot.event, "combat:impact");
    for (const [key, value] of Object.entries(samplePayload)) {
      assert.deepEqual(godot.payload[key], value, `Godot-mirrored field '${key}' must match the web payload`);
    }
    assert.deepEqual(godot.payload, room.payload, "web and Godot receive the identical enriched frame");
  });

  it("neither io nor emitToWorld supplied: no-op, never throws", () => {
    const result = emitWorldEvent({ io: undefined, emitToWorld: undefined, worldId: "concordia-hub", event: "combat:impact", payload: samplePayload });
    assert.equal(result, "none");
  });
});
