// C16 — ambient aerial traffic. Pins both the pure route/position math in
// server/lib/aerial-traffic.js and the heartbeat wrapper in
// server/emergent/aerial-traffic-cycle.js: never-throw invariant, honest
// empty-route handling (no fabricated geometry for a world with no real
// landing pads or districts), spawn/despawn lifecycle, MAX_ACTIVE_PER_WORLD
// cap, and world-scoped (never global) broadcast via both the legacy `io`
// fallback and the Godot-mirror `_concordEmitToWorld` hook — the same
// dual-path contract server/tests/godot-gateway-mirror-emit.test.js pins
// for combat:polish / combat:impact.

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  centroidOfPolygon,
  buildRouteFromLandingPads,
  buildRouteFromDistrictCentroids,
  routeForWorld,
  routeLength,
  positionAtTime,
  spawnEntity,
  shouldSpawnMore,
  shouldDespawn,
  computeSnapshot,
  MAX_ACTIVE_PER_WORLD,
  MAX_LIFETIME_MS,
} from "../lib/aerial-traffic.js";

import { runAerialTrafficCycle, SPAWN_CHECK_INTERVAL_MS } from "../emergent/aerial-traffic-cycle.js";

// ── Fake landing pads / districts (same shape real data would have) ────────

const REAL_HUB_PADS = [
  { id: "landing-pad-plaza-north", district_id: "concordia-hub:plaza", position: { x: 0, z: 280 }, radius_m: 14, elevation_m: 0 },
  { id: "landing-pad-riverside", district_id: "concordia-hub:riverside", position: { x: 0, z: -300 }, radius_m: 14, elevation_m: 0 },
  { id: "landing-pad-industrial", district_id: "concordia-hub:industrial", position: { x: 300, z: -190 }, radius_m: 16, elevation_m: 0 },
];

const FAKE_DISTRICTS = [
  { id: "d1", boundary: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }], elevationHint: 0 },
  { id: "d2", boundary: [{ x: 90, z: 90 }, { x: 110, z: 90 }, { x: 110, z: 110 }, { x: 90, z: 110 }], elevationHint: 2 },
];

// ── Pure lib tests ───────────────────────────────────────────────────────

describe("aerial-traffic.js (pure route + position math)", () => {
  test("centroidOfPolygon averages vertices; honest null for <3 vertices", () => {
    assert.deepEqual(centroidOfPolygon([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]), { x: 5, z: 5 });
    assert.equal(centroidOfPolygon([{ x: 0, z: 0 }]), null);
    assert.equal(centroidOfPolygon(null), null);
  });

  test("buildRouteFromLandingPads returns a real waypoint per pad, offset by real elevation + the cruise dial", () => {
    const route = buildRouteFromLandingPads(REAL_HUB_PADS);
    assert.equal(route.length, 3);
    assert.equal(route[0].x, 0);
    assert.equal(route[0].z, 280);
    assert.ok(route[0].y > 0, "y must be lifted above ground level");
  });

  test("buildRouteFromLandingPads is honestly empty for <2 usable pads", () => {
    assert.deepEqual(buildRouteFromLandingPads([]), []);
    assert.deepEqual(buildRouteFromLandingPads([REAL_HUB_PADS[0]]), []);
    assert.deepEqual(buildRouteFromLandingPads(null), []);
  });

  test("buildRouteFromDistrictCentroids works as the fallback source", () => {
    const route = buildRouteFromDistrictCentroids(FAKE_DISTRICTS);
    assert.equal(route.length, 2);
    assert.equal(route[0].x, 0);
    assert.equal(route[0].z, 0);
  });

  test("routeForWorld prefers landing pads, falls back to district centroids, else honest 'none'", () => {
    assert.equal(routeForWorld({ landingPads: REAL_HUB_PADS, districts: FAKE_DISTRICTS }).source, "landing_pads");
    assert.equal(routeForWorld({ landingPads: [], districts: FAKE_DISTRICTS }).source, "district_centroids");
    const none = routeForWorld({ landingPads: [], districts: [] });
    assert.equal(none.source, "none");
    assert.deepEqual(none.waypoints, []);
  });

  test("routeLength sums the CLOSED loop (wraps last back to first)", () => {
    const square = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 0, y: 0, z: 10 }];
    assert.equal(routeLength(square), 40);
    assert.equal(routeLength([{ x: 0, y: 0, z: 0 }]), 0);
  });

  test("positionAtTime walks the loop deterministically and wraps back to the start", () => {
    const route = buildRouteFromLandingPads(REAL_HUB_PADS);
    const len = routeLength(route);
    const speed = 10;
    const start = 0;

    const atStart = positionAtTime({ waypoints: route, speedMps: speed, startedAtMs: start, nowMs: 0 });
    assert.deepEqual([atStart.x, atStart.y, atStart.z], [route[0].x, route[0].y, route[0].z]);

    // A full loop later, position must return to the exact start (deterministic looping).
    const afterFullLoop = positionAtTime({ waypoints: route, speedMps: speed, startedAtMs: start, nowMs: (len / speed) * 1000 });
    assert.ok(Math.abs(afterFullLoop.x - route[0].x) < 1e-6);
    assert.ok(Math.abs(afterFullLoop.z - route[0].z) < 1e-6);

    // Two independent calls at the same (route, speed, startedAt, now) must
    // agree byte-for-byte — pure function, no hidden state/randomness.
    const again = positionAtTime({ waypoints: route, speedMps: speed, startedAtMs: start, nowMs: 12345 });
    const repeat = positionAtTime({ waypoints: route, speedMps: speed, startedAtMs: start, nowMs: 12345 });
    assert.deepEqual(again, repeat);
  });

  test("positionAtTime is honestly null for a degenerate (<2 waypoint) route", () => {
    assert.equal(positionAtTime({ waypoints: [], speedMps: 9, startedAtMs: 0, nowMs: 0 }), null);
    assert.equal(positionAtTime({ waypoints: [{ x: 0, y: 0, z: 0 }], speedMps: 9, startedAtMs: 0, nowMs: 0 }), null);
  });

  test("shouldSpawnMore / shouldDespawn are pure boolean gates", () => {
    assert.equal(shouldSpawnMore({ activeCount: 0 }), true);
    assert.equal(shouldSpawnMore({ activeCount: MAX_ACTIVE_PER_WORLD }), false);
    assert.equal(shouldDespawn({ entity: { startedAtMs: 0 }, nowMs: MAX_LIFETIME_MS + 1 }), true);
    assert.equal(shouldDespawn({ entity: { startedAtMs: 0 }, nowMs: 1000 }), false);
    assert.equal(shouldDespawn({ entity: null, nowMs: 0 }), true, "malformed entity must never be kept alive silently");
  });

  test("spawnEntity + computeSnapshot round-trip to a broadcast-ready shape", () => {
    const route = buildRouteFromLandingPads(REAL_HUB_PADS);
    const entity = spawnEntity({ worldId: "concordia-hub", waypoints: route, nowMs: 0, index: 0 });
    assert.equal(entity.worldId, "concordia-hub");
    assert.equal(entity.kind, "crosswind-courier");
    const snap = computeSnapshot(entity, 1000);
    assert.equal(snap.id, entity.id);
    assert.equal(snap.kind, "crosswind-courier");
    assert.equal(typeof snap.x, "number");
    assert.equal(typeof snap.heading, "number");
  });
});

// ── Heartbeat cycle tests ───────────────────────────────────────────────

function fakeDb({ worlds = ["concordia-hub"], districtRows = [] } = {}) {
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        all: () => {
          if (s.startsWith("SELECT DISTINCT world_id FROM world_visits")) {
            return worlds.map((w) => ({ world_id: w }));
          }
          if (s.startsWith("SELECT DISTINCT world_id FROM world_npcs")) {
            return [];
          }
          if (s.startsWith("SELECT * FROM districts")) {
            return districtRows;
          }
          return [];
        },
        get: () => null,
        run: () => ({ changes: 0 }),
      };
    },
  };
}

function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return { emit: (event, payload) => emitted.push({ room, event, payload }) };
    },
  };
}

beforeEach(() => {
  delete process.env.CONCORD_AERIAL_TRAFFIC;
  delete globalThis._concordEmitToWorld;
});
afterEach(() => {
  delete process.env.CONCORD_AERIAL_TRAFFIC;
  delete globalThis._concordEmitToWorld;
});

describe("aerial-traffic-cycle (heartbeat)", () => {
  test("never throws — missing db", async () => {
    const r = await runAerialTrafficCycle({ state: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  test("never throws — missing state", async () => {
    const r = await runAerialTrafficCycle({ db: fakeDb() });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_state");
  });

  test("kill-switch: CONCORD_AERIAL_TRAFFIC=0 disables the cycle", async () => {
    process.env.CONCORD_AERIAL_TRAFFIC = "0";
    const r = await runAerialTrafficCycle({ db: fakeDb(), state: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  test("no active worlds — honest no-op, never fabricates traffic", async () => {
    const r = await runAerialTrafficCycle({ db: fakeDb({ worlds: [] }), state: {} });
    assert.equal(r.ok, true);
    assert.equal(r.worldsTouched, 0);
    assert.equal(r.reason, "no_active_worlds");
  });

  test("a world with no real route (no pads, no districts) never spawns or broadcasts", async () => {
    const state = {};
    const io = fakeIo();
    const r = await runAerialTrafficCycle({ db: fakeDb({ worlds: ["no-route-world"] }), state, io });
    assert.equal(r.ok, true);
    assert.equal(r.spawned, 0);
    assert.equal(r.worldsBroadcast, 0);
    assert.equal(io.emitted.length, 0);
    assert.deepEqual(state.aerialTraffic.get("no-route-world").entities, []);
  });

  test("concordia-hub spawns one entity on first pass and broadcasts a world-scoped snapshot", async () => {
    const state = {};
    const io = fakeIo();
    const r = await runAerialTrafficCycle({ db: fakeDb({ worlds: ["concordia-hub"] }), state, io });
    assert.equal(r.ok, true);
    assert.equal(r.spawned, 1);
    assert.equal(r.worldsBroadcast, 1);
    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, "world:concordia-hub");
    assert.equal(io.emitted[0].event, "world:aerial-traffic");
    assert.equal(io.emitted[0].payload.worldId, "concordia-hub");
    assert.equal(io.emitted[0].payload.routeSource, "landing_pads");
    assert.equal(io.emitted[0].payload.entities.length, 1);
    assert.equal(io.emitted[0].payload.entities[0].kind, "crosswind-courier");
  });

  test("district-centroid fallback world spawns + broadcasts too", async () => {
    const rows = FAKE_DISTRICTS.map((d) => ({
      id: d.id,
      world_id: "district-only-world",
      name: d.id,
      boundary_json: JSON.stringify(d.boundary),
      palette_json: "{}",
      lighting_tag: null,
      elevation_hint: d.elevationHint,
    }));
    const state = {};
    const io = fakeIo();
    const r = await runAerialTrafficCycle({ db: fakeDb({ worlds: ["district-only-world"], districtRows: rows }), state, io });
    assert.equal(r.spawned, 1);
    assert.equal(io.emitted[0].payload.routeSource, "district_centroids");
  });

  test("spawn cadence is gated — a second call inside SPAWN_CHECK_INTERVAL_MS does not spawn a duplicate, but still re-broadcasts positions", async () => {
    const state = {};
    const io = fakeIo();
    const first = await runAerialTrafficCycle({ db: fakeDb(), state, io });
    assert.equal(first.spawned, 1);
    const second = await runAerialTrafficCycle({ db: fakeDb(), state, io });
    assert.equal(second.spawned, 0, "spawn gate must hold within the interval");
    assert.equal(second.worldsBroadcast, 1, "position broadcast must still happen every due tick");
    assert.equal(state.aerialTraffic.get("concordia-hub").entities.length, 1);
  });

  test("MAX_ACTIVE_PER_WORLD is respected across repeated due spawn checks", async () => {
    const state = {};
    const io = fakeIo();
    for (let i = 0; i < MAX_ACTIVE_PER_WORLD + 3; i++) {
      // Force the spawn gate open every call by rewinding lastSpawnAttemptAt,
      // exactly like production code would see once SPAWN_CHECK_INTERVAL_MS
      // has really elapsed — avoids faking Date.now() while still exercising
      // real repeated-spawn behavior deterministically.
      const w = state.aerialTraffic?.get("concordia-hub");
      if (w) w.lastSpawnAttemptAt = 0;
      // Sequential by design: mirrors real tick-by-tick calls.
      await runAerialTrafficCycle({ db: fakeDb(), state, io });
    }
    assert.equal(state.aerialTraffic.get("concordia-hub").entities.length, MAX_ACTIVE_PER_WORLD);
  });

  test("stale entities are despawned and the slot can be refilled", async () => {
    const state = {};
    const io = fakeIo();
    await runAerialTrafficCycle({ db: fakeDb(), state, io });
    const w = state.aerialTraffic.get("concordia-hub");
    assert.equal(w.entities.length, 1);
    // Force it stale (older than MAX_LIFETIME_MS) and force the spawn gate open.
    w.entities[0].startedAtMs = Date.now() - (MAX_LIFETIME_MS + 5000);
    w.lastSpawnAttemptAt = 0;
    const r = await runAerialTrafficCycle({ db: fakeDb(), state, io });
    assert.equal(r.despawned, 1);
    assert.equal(r.spawned, 1);
    assert.equal(state.aerialTraffic.get("concordia-hub").entities.length, 1);
  });

  test("multiple active worlds each get their OWN world-scoped event — never a single global broadcast", async () => {
    const state = {};
    const io = fakeIo();
    const r = await runAerialTrafficCycle({ db: fakeDb({ worlds: ["concordia-hub", "no-route-world"] }), state, io });
    assert.equal(r.worldsTouched, 2);
    assert.equal(io.emitted.length, 1, "only the world with a real route broadcasts");
    assert.equal(io.emitted[0].room, "world:concordia-hub");
  });

  test("Godot mirror hook (_concordEmitToWorld) is preferred over the raw io fallback when present", async () => {
    const state = {};
    const io = fakeIo(); // must NOT be used once the hook is set
    const mirrorCalls = [];
    globalThis._concordEmitToWorld = (worldId, event, payload) => {
      mirrorCalls.push({ worldId, event, payload });
      return { ok: true };
    };
    const r = await runAerialTrafficCycle({ db: fakeDb(), state, io });
    assert.equal(r.worldsBroadcast, 1);
    assert.equal(io.emitted.length, 0, "raw io must not fire once the gateway hook is present");
    assert.equal(mirrorCalls.length, 1);
    assert.equal(mirrorCalls[0].worldId, "concordia-hub");
    assert.equal(mirrorCalls[0].event, "world:aerial-traffic");
  });

  test("realtime emit failure (thrown io.to) never fails the cycle", async () => {
    const state = {};
    const throwingIo = { to() { throw new Error("boom"); } };
    const r = await runAerialTrafficCycle({ db: fakeDb(), state, io: throwingIo });
    assert.equal(r.ok, true);
    assert.equal(r.worldsBroadcast, 0);
  });

  test("no io and no gateway hook — still advances state, just skips the broadcast", async () => {
    const state = {};
    const r = await runAerialTrafficCycle({ db: fakeDb(), state });
    assert.equal(r.ok, true);
    assert.equal(r.spawned, 1);
    assert.equal(r.worldsBroadcast, 0);
  });

  test("a throwing districts query never stops the pass (defense-in-depth: listDistricts' own catch, plus the cycle's per-world catch)", async () => {
    // Rigging db.prepare to throw only for the districts query proves two
    // independent layers hold: listDistricts() itself degrades to [] on a
    // query error (districts.js's own try/catch), AND concordia-hub's route
    // resolves from real landing pads regardless (pads alone satisfy
    // MIN_WAYPOINTS, so the districts fallback is never even needed here).
    const worlds = ["concordia-hub", "throws-world"];
    const db = {
      prepare(sql) {
        const s = sql.replace(/\s+/g, " ").trim();
        if (s.startsWith("SELECT * FROM districts")) {
          return { all: () => { throw new Error("boom"); } };
        }
        return {
          all: () => (s.startsWith("SELECT DISTINCT world_id FROM world_visits") ? worlds.map((w) => ({ world_id: w })) : []),
          get: () => null,
          run: () => ({ changes: 0 }),
        };
      },
    };
    const state = {};
    const io = fakeIo();
    const r = await runAerialTrafficCycle({ db, state, io });
    assert.equal(r.ok, true);
    // concordia-hub still resolves via landing pads (no districts query needed
    // on the happy path since pads alone satisfy MIN_WAYPOINTS) and broadcasts.
    assert.equal(io.emitted.some((e) => e.room === "world:concordia-hub"), true);
  });
});
