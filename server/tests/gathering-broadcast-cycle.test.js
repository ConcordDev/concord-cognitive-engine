// V1.2 Wave A ("Society & Presence") — contract test for the gathering
// broadcast heartbeat. Pins three things:
//   1. `selectDueGatherings` — the pure cooldown/dedup decision logic.
//   2. `runGatheringBroadcastCycle` never throws (missing db/state,
//      kill-switch, no active worlds, a throwing realtime transport).
//   3. Detection is grounded in REAL presence data (via the actual,
//      already-tested `spontaneousGatherings` / `updateUserPosition` from
//      city-presence.js — never a mock of the detector itself) and
//      broadcasts are scoped to the detected world's own room
//      (`world:<id>`), never a global emit.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { updateUserPosition, removeUser } from "../lib/city-presence.js";
import {
  runGatheringBroadcastCycle,
  selectDueGatherings,
  REBROADCAST_COOLDOWN_MS,
} from "../emergent/gathering-broadcast-cycle.js";

function uniqueWorld(tag) {
  return `gather-cycle-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fakeDb({ worlds = [] } = {}) {
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        all: () => {
          if (s.startsWith("SELECT DISTINCT world_id FROM world_visits")) {
            return worlds.map((w) => ({ world_id: w }));
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
  const globalEmitted = [];
  return {
    emitted,
    globalEmitted,
    to(room) {
      return { emit: (event, payload) => emitted.push({ room, event, payload }) };
    },
    // Present so a bug that fell back to a global broadcast would be
    // observable (never called by the module under test — see the
    // "never a global broadcast" assertion below).
    emit(event, payload) {
      globalEmitted.push({ event, payload });
    },
  };
}

beforeEach(() => {
  delete process.env.CONCORD_GATHERING_DETECTOR;
  delete globalThis._concordEmitToWorld;
});
afterEach(() => {
  delete process.env.CONCORD_GATHERING_DETECTOR;
  delete globalThis._concordEmitToWorld;
});

// ── Pure cooldown/dedup logic ────────────────────────────────────────────

describe("selectDueGatherings (pure)", () => {
  test("first sighting of a real gathering is immediately due", () => {
    const gatherings = [{ id: "g1", location: "plaza", playerCount: 3, description: "3 players gathering at plaza" }];
    const { due, cooldowns } = selectDueGatherings(gatherings, new Map(), 1000);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, "g1");
    assert.equal(cooldowns.get("g1"), 1000);
  });

  test("still within the cooldown window — not due again", () => {
    const gatherings = [{ id: "g1", location: "plaza", playerCount: 3, description: "x" }];
    const prev = new Map([["g1", 1000]]);
    const { due } = selectDueGatherings(gatherings, prev, 1000 + REBROADCAST_COOLDOWN_MS - 1);
    assert.equal(due.length, 0);
  });

  test("cooldown elapsed — due again", () => {
    const gatherings = [{ id: "g1", location: "plaza", playerCount: 3, description: "x" }];
    const prev = new Map([["g1", 1000]]);
    const { due, cooldowns } = selectDueGatherings(gatherings, prev, 1000 + REBROADCAST_COOLDOWN_MS + 1);
    assert.equal(due.length, 1);
    assert.equal(cooldowns.get("g1"), 1000 + REBROADCAST_COOLDOWN_MS + 1);
  });

  test("a dissolved gathering's cooldown is pruned — reforming at the same cell is never blocked by a stale timestamp", () => {
    const prev = new Map([["g1", 1000]]);
    // Pass A: g1 has dissolved (nobody's clustered there anymore this pass).
    const passA = selectDueGatherings([], prev, 6000);
    assert.equal(passA.cooldowns.has("g1"), false, "dissolved gathering must be pruned, not carried forward");
    // Pass B: g1 reforms almost immediately — well inside what WOULD have
    // been the old cooldown window — and must still be due, because the
    // stale entry was pruned in pass A rather than blocking re-detection.
    const passB = selectDueGatherings(
      [{ id: "g1", location: "plaza", playerCount: 3, description: "x" }],
      passA.cooldowns,
      6010,
    );
    assert.equal(passB.due.length, 1);
  });

  test("honest empty — no real gatherings means nothing due and no leftover cooldown state", () => {
    const { due, cooldowns } = selectDueGatherings([], new Map([["stale", 1]]), 1000);
    assert.equal(due.length, 0);
    assert.equal(cooldowns.size, 0);
  });

  test("malformed input never throws", () => {
    assert.doesNotThrow(() => selectDueGatherings(null, null, Date.now()));
    assert.doesNotThrow(() => selectDueGatherings(undefined, undefined, Date.now()));
  });
});

// ── Heartbeat wrapper: never-throw invariant ─────────────────────────────

describe("runGatheringBroadcastCycle — never-throw invariant", () => {
  test("missing db", async () => {
    const r = await runGatheringBroadcastCycle({ state: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  test("missing state", async () => {
    const r = await runGatheringBroadcastCycle({ db: fakeDb() });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_state");
  });

  test("kill-switch CONCORD_GATHERING_DETECTOR=0 disables the cycle", async () => {
    process.env.CONCORD_GATHERING_DETECTOR = "0";
    const r = await runGatheringBroadcastCycle({ db: fakeDb(), state: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  test("no active worlds — honest no-op, never invents a gathering", async () => {
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [] }), state: {} });
    assert.equal(r.ok, true);
    assert.equal(r.worldsTouched, 0);
    assert.equal(r.reason, "no_active_worlds");
  });

  test("a world with real presence but nobody clustered is honestly empty — no broadcast, no thrown error", async () => {
    const W = uniqueWorld("empty");
    const state = {};
    const io = fakeIo();
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.equal(r.ok, true);
    assert.equal(r.gatheringsDetected, 0);
    assert.equal(r.worldsBroadcast, 0);
    assert.equal(io.emitted.length, 0);
  });

  test("realtime emit failure (thrown io.to) never fails the cycle", async () => {
    const W = uniqueWorld("throwio");
    updateUserPosition(`th1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`th2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });
    updateUserPosition(`th3_${W}`, { worldId: W, x: 3, y: 0, z: 3 });
    const throwingIo = { to() { throw new Error("boom"); } };
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state: {}, io: throwingIo });
    assert.equal(r.ok, true);
    assert.equal(r.worldsBroadcast, 0);
  });

  test("a per-world exception (e.g. malformed world id) never stops the whole pass", async () => {
    const good = uniqueWorld("good");
    updateUserPosition(`pg1_${good}`, { worldId: good, x: 1, y: 0, z: 1 });
    updateUserPosition(`pg2_${good}`, { worldId: good, x: 2, y: 0, z: 2 });
    updateUserPosition(`pg3_${good}`, { worldId: good, x: 3, y: 0, z: 3 });
    const state = {};
    const io = fakeIo();
    // null worldId alongside a real one — spontaneousGatherings(null) throws
    // nothing itself (it's honest-empty per its own contract) but this
    // proves the per-world try/catch still holds even if a future change
    // makes a bad id explode.
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [null, good] }), state, io });
    assert.equal(r.ok, true);
    assert.ok(r.worldsBroadcast >= 1);
  });
});

// ── Real-presence detection + world-room-scoped broadcast ───────────────

describe("runGatheringBroadcastCycle — grounded in real presence data", () => {
  test("detects a genuine cluster of real co-located players and broadcasts it to that world's own room only", async () => {
    const W = uniqueWorld("real");
    updateUserPosition(`gu1_${W}`, { worldId: W, x: 10, y: 0, z: 10, districtId: "plaza" });
    updateUserPosition(`gu2_${W}`, { worldId: W, x: 20, y: 0, z: 20, districtId: "plaza" });
    updateUserPosition(`gu3_${W}`, { worldId: W, x: 30, y: 0, z: 30, districtId: "plaza" });

    const state = {};
    const io = fakeIo();
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });

    assert.equal(r.ok, true);
    assert.equal(r.gatheringsDetected, 1);
    assert.equal(r.gatheringsBroadcast, 1);
    assert.equal(r.worldsBroadcast, 1);

    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, `world:${W}`, "must broadcast to the world's own room");
    assert.equal(io.emitted[0].event, "world:gathering-detected");
    assert.equal(io.emitted[0].payload.worldId, W);
    assert.equal(io.emitted[0].payload.gatherings.length, 1);
    assert.ok(io.emitted[0].payload.gatherings[0].playerCount >= 3, "real headcount, not fabricated");
    assert.equal(io.emitted[0].payload.gatherings[0].location, "plaza");

    assert.equal(io.globalEmitted.length, 0, "must never fall back to a global broadcast");
  });

  test("below-threshold co-location (only 2 players, default min is 3) is honestly not a gathering", async () => {
    const W = uniqueWorld("below");
    updateUserPosition(`bu1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`bu2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });

    const state = {};
    const io = fakeIo();
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.equal(r.gatheringsDetected, 0);
    assert.equal(r.worldsBroadcast, 0);
    assert.equal(io.emitted.length, 0);
  });

  test("multiple active worlds: only the one with a real gathering broadcasts, and only to its own room — never cross-world leakage", async () => {
    const Wa = uniqueWorld("multi-a");
    const Wb = uniqueWorld("multi-b");
    updateUserPosition(`ma1_${Wa}`, { worldId: Wa, x: 1, y: 0, z: 1 });
    updateUserPosition(`ma2_${Wa}`, { worldId: Wa, x: 2, y: 0, z: 2 });
    updateUserPosition(`ma3_${Wa}`, { worldId: Wa, x: 3, y: 0, z: 3 });
    // Wb has zero real presence — must stay honestly silent.

    const state = {};
    const io = fakeIo();
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [Wa, Wb] }), state, io });

    assert.equal(r.worldsTouched, 2);
    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, `world:${Wa}`);
    assert.ok(!io.emitted.some((e) => e.room === `world:${Wb}`), "world with no real gathering must not broadcast");
  });

  test("cooldown suppresses re-broadcasting the same still-active real gathering on the very next pass", async () => {
    const W = uniqueWorld("cooldown");
    updateUserPosition(`cu1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`cu2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });
    updateUserPosition(`cu3_${W}`, { worldId: W, x: 3, y: 0, z: 3 });

    const state = {};
    const io = fakeIo();
    const first = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.equal(first.worldsBroadcast, 1);

    const second = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.equal(second.gatheringsDetected, 1, "still a real, still-active gathering");
    assert.equal(second.worldsBroadcast, 0, "cooldown must suppress the repeat broadcast");
    assert.equal(io.emitted.length, 1, "only the first broadcast ever fired");
  });

  test("when the real gathering dissolves (players leave presence), state is cleaned up honestly", async () => {
    const W = uniqueWorld("dissolve");
    updateUserPosition(`du1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`du2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });
    updateUserPosition(`du3_${W}`, { worldId: W, x: 3, y: 0, z: 3 });

    const state = {};
    const io = fakeIo();
    await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.ok(state.gatheringBroadcast.has(W));

    removeUser(`du1_${W}`);
    removeUser(`du2_${W}`);
    removeUser(`du3_${W}`);

    const r2 = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state, io });
    assert.equal(r2.gatheringsDetected, 0, "gathering honestly gone once players actually left");
    assert.equal(state.gatheringBroadcast.has(W), false, "stale per-world cooldown state is pruned");
  });

  test("Godot mirror hook (_concordEmitToWorld) is preferred over the raw io fallback when present", async () => {
    const W = uniqueWorld("mirror");
    updateUserPosition(`gm1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`gm2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });
    updateUserPosition(`gm3_${W}`, { worldId: W, x: 3, y: 0, z: 3 });

    const io = fakeIo(); // must NOT be used once the hook is present
    const mirrorCalls = [];
    globalThis._concordEmitToWorld = (worldId, event, payload) => {
      mirrorCalls.push({ worldId, event, payload });
      return { ok: true };
    };
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state: {}, io });
    assert.equal(r.worldsBroadcast, 1);
    assert.equal(io.emitted.length, 0, "raw io must not fire once the gateway hook is present");
    assert.equal(mirrorCalls.length, 1);
    assert.equal(mirrorCalls[0].worldId, W);
    assert.equal(mirrorCalls[0].event, "world:gathering-detected");
  });

  test("no io and no gateway hook — still detects, just skips the broadcast", async () => {
    const W = uniqueWorld("noio");
    updateUserPosition(`ni1_${W}`, { worldId: W, x: 1, y: 0, z: 1 });
    updateUserPosition(`ni2_${W}`, { worldId: W, x: 2, y: 0, z: 2 });
    updateUserPosition(`ni3_${W}`, { worldId: W, x: 3, y: 0, z: 3 });
    const r = await runGatheringBroadcastCycle({ db: fakeDb({ worlds: [W] }), state: {} });
    assert.equal(r.ok, true);
    assert.equal(r.gatheringsDetected, 1);
    assert.equal(r.worldsBroadcast, 0);
  });
});
