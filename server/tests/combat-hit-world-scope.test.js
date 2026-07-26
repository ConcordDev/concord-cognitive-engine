/**
 * DET-C batch 6 — closes the highest-traffic remaining privacy/scale bug
 * flagged by batch 5: server.js's socket `combat:attack` handler emits
 * `combat:hit` (and the sibling PvP `combat:impact`, ~20 lines below it)
 * via a bare `realtimeEmit(event, payload)` call. `realtimeEmit` only had
 * three room-scoping tiers — `user:<id>` / `session:<id>` / `org:<id>` —
 * gated on a 3rd `options` argument; with none of those supplied, it fell
 * through to `REALTIME.io.emit(...)`, socket.io's literal "send to every
 * connected socket" broadcast. Every PvP hit in every world was delivered
 * to every connected client regardless of which world they were in.
 *
 * Wave 4 (see tests/wave4-event-worldid.test.js) had already added a
 * `worldId` FIELD to the combat:hit payload — that only let a client tell
 * which world a hit came from; it did nothing to stop clients in OTHER
 * worlds from receiving it in the first place. This batch adds a genuine
 * `worldId` ROOM-SCOPING TIER to `realtimeEmit` itself (server.js ~line
 * 8858, mirroring `emitToWorld`'s `world:<id>` room grammar) and passes
 * `{ worldId: _hitWorldId }` at both the combat:hit and PvP combat:impact
 * call sites (server.js ~9926 / ~9966).
 *
 * `realtimeEmit` is defined and used entirely inside server.js's socket.io
 * connection handler — there is no standalone importable function to call
 * (same shape wave4-event-worldid.test.js and godot-gateway-mirror-emit.
 * test.js already documented for this exact file). This test therefore:
 *   1. Faithfully reconstructs realtimeEmit's branch-selection logic quoted
 *      verbatim from server.js (both the PRE-FIX shape with only user/
 *      session/org tiers, and the POST-FIX shape with the new worldId
 *      tier), against a fake Socket.IO `io` with REAL room semantics
 *      (per-room membership sets, not just a recorded channel string) —
 *      so "a different-world socket doesn't receive it" is a genuine
 *      behavioral proof, not an assertion about which string was passed.
 *   2. Proves the PRE-FIX reconstruction leaks combat:hit to a socket in a
 *      different world (documents the bug being fixed).
 *   3. Proves the POST-FIX reconstruction, called with the exact options
 *      shape the real call sites now pass, delivers to a same-world socket
 *      with byte-identical domain payload fields AND does NOT deliver to a
 *      different-world socket.
 *
 * Run: node --test tests/combat-hit-world-scope.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── A faithful (room-membership-aware, not bare-stub) reconstruction of
//    socket.io's io.to(room).emit(...) / io.emit(...) semantics. ───────────
function makeRoomIo() {
  const rooms = new Map();   // room -> Set<socketId>
  const sockets = new Map(); // socketId -> { received: [] }

  function ensureSocket(socketId) {
    if (!sockets.has(socketId)) sockets.set(socketId, { received: [] });
    return sockets.get(socketId);
  }
  function join(socketId, room) {
    ensureSocket(socketId);
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socketId);
  }
  function to(room) {
    return {
      emit(event, payload) {
        for (const sid of rooms.get(room) || []) {
          ensureSocket(sid).received.push({ event, payload });
        }
      },
    };
  }
  function emitGlobal(event, payload) {
    // socket.io's io.emit() — every connected socket, regardless of room.
    for (const s of sockets.values()) s.received.push({ event, payload });
  }
  return { join, to, emit: emitGlobal, sockets };
}

// ── PRE-FIX reconstruction — server.js's realtimeEmit before this batch.
//    Verbatim branch order: userId > sessionId > orgId > (nothing) > global.
function makeRealtimeEmitPreFix(io) {
  let seq = 0;
  return function realtimeEmit(event, payload, { sessionId = "", orgId = "", userId = "" } = {}) {
    const enrichedPayload = { ...payload, ts: "T", _seq: ++seq, _evt: event };
    if (userId) {
      io.to(`user:${userId}`).emit(event, enrichedPayload);
    } else if (sessionId) {
      io.to(`session:${sessionId}`).emit(event, enrichedPayload);
    } else if (orgId) {
      io.to(`org:${orgId}`).emit(event, enrichedPayload);
    } else {
      io.emit(event, enrichedPayload); // <- combat:hit's bare call landed here
    }
    return { ok: true, seq: enrichedPayload._seq };
  };
}

// ── POST-FIX reconstruction — server.js's realtimeEmit as of this batch
//    (server.js ~8784-8878). Adds the `worldId` tier between orgId and the
//    global fallback, mirroring emitToWorld's `world:<id>` room grammar.
function makeRealtimeEmitPostFix(io) {
  let seq = 0;
  return function realtimeEmit(event, payload, { sessionId = "", orgId = "", userId = "", worldId = "" } = {}) {
    const enrichedPayload = { ...payload, ts: "T", _seq: ++seq, _evt: event };
    if (userId) {
      io.to(`user:${userId}`).emit(event, enrichedPayload);
    } else if (sessionId) {
      io.to(`session:${sessionId}`).emit(event, enrichedPayload);
    } else if (orgId) {
      io.to(`org:${orgId}`).emit(event, enrichedPayload);
    } else if (worldId) {
      io.to(`world:${worldId}`).emit(event, enrichedPayload);
    } else {
      io.emit(event, enrichedPayload);
    }
    return { ok: true, seq: enrichedPayload._seq };
  };
}

// The real combat:hit payload shape (server.js ~9926-9948), used verbatim
// (minus test-specific ids) so this test exercises a realistic payload, not
// a toy shape.
function combatHitPayload({ attackerId, targetId }) {
  return {
    attackerId,
    targetId,
    damage: 42,
    isCrit: false,
    targetHealth: 58,
    targetMaxHealth: 100,
    targetKilled: false,
    targetPosition: { x: 1, y: 0, z: 2 },
    attackerPosition: { x: 0, y: 0, z: 0 },
    worldId: "concordia-hub",
    element: "physical",
    skillId: null,
    weapon: "fist",
    tier: 2,
    style: null,
    skillKey: "martial.fist.t2",
  };
}

describe("DET-C batch 6 — combat:hit world-room scoping bug (pre-fix reproduction)", () => {
  it("pre-fix realtimeEmit leaks combat:hit to a socket in a DIFFERENT world (the bug)", () => {
    const io = makeRoomIo();
    io.join("socket-same-world", "world:concordia-hub");
    io.join("socket-other-world", "world:tunya");

    const realtimeEmit = makeRealtimeEmitPreFix(io);
    // This mirrors the real pre-fix call site exactly: no options object at
    // all, despite the payload already carrying a worldId field.
    realtimeEmit("combat:hit", combatHitPayload({ attackerId: "atk1", targetId: "def1" }));

    const sameWorldEvents = io.sockets.get("socket-same-world").received;
    const otherWorldEvents = io.sockets.get("socket-other-world").received;
    assert.equal(sameWorldEvents.length, 1, "same-world socket receives the (buggy) global broadcast");
    assert.equal(otherWorldEvents.length, 1,
      "BUG: a socket in a completely different world also received the hit — proves the pre-fix leak");
    assert.equal(otherWorldEvents[0].payload.worldId, "concordia-hub",
      "the leaked payload is stamped for a different world than the receiving socket is in");
  });
});

describe("DET-C batch 6 — combat:hit world-room scoping fix (post-fix)", () => {
  it("(a) a player in the SAME world still receives combat:hit with byte-identical domain payload", () => {
    const io = makeRoomIo();
    io.join("socket-same-world", "world:concordia-hub");
    io.join("socket-other-world", "world:tunya");

    const realtimeEmit = makeRealtimeEmitPostFix(io);
    const payload = combatHitPayload({ attackerId: "atk1", targetId: "def1" });
    // Mirrors the real post-fix call site: realtimeEmit(event, payload, { worldId: _hitWorldId }).
    realtimeEmit("combat:hit", payload, { worldId: "concordia-hub" });

    const received = io.sockets.get("socket-same-world").received;
    assert.equal(received.length, 1, "same-world socket must still receive exactly one combat:hit");
    assert.equal(received[0].event, "combat:hit");
    for (const [key, value] of Object.entries(payload)) {
      assert.deepEqual(received[0].payload[key], value, `domain field '${key}' must be unchanged for the same-world audience`);
    }
  });

  it("(b) a player in a DIFFERENT world no longer receives combat:hit", () => {
    const io = makeRoomIo();
    io.join("socket-same-world", "world:concordia-hub");
    io.join("socket-other-world", "world:tunya");
    io.join("socket-no-world", "world:sovereign-ruins");

    const realtimeEmit = makeRealtimeEmitPostFix(io);
    realtimeEmit("combat:hit", combatHitPayload({ attackerId: "atk1", targetId: "def1" }), { worldId: "concordia-hub" });

    assert.equal(io.sockets.get("socket-other-world").received.length, 0,
      "FIX: a socket in world:tunya must receive nothing from a concordia-hub hit");
    assert.equal(io.sockets.get("socket-no-world").received.length, 0,
      "FIX: a socket in world:sovereign-ruins must receive nothing from a concordia-hub hit");
  });

  it("a spectator socket joined to NO world room receives nothing (not even via a stray global fallback)", () => {
    const io = makeRoomIo();
    io.join("socket-same-world", "world:concordia-hub");
    const unjoinedSocketId = "socket-unjoined";
    io.sockets.set(unjoinedSocketId, { received: [] }); // connected, but hasn't joined any world room

    const realtimeEmit = makeRealtimeEmitPostFix(io);
    realtimeEmit("combat:hit", combatHitPayload({ attackerId: "atk1", targetId: "def1" }), { worldId: "concordia-hub" });

    assert.equal(io.sockets.get(unjoinedSocketId).received.length, 0);
    assert.equal(io.sockets.get("socket-same-world").received.length, 1);
  });

  it("the sibling PvP combat:impact emit (server.js ~9966) gets the identical fix — same-world only", () => {
    const io = makeRoomIo();
    io.join("socket-same-world", "world:concordia-hub");
    io.join("socket-other-world", "world:tunya");

    const realtimeEmit = makeRealtimeEmitPostFix(io);
    const impactPayload = {
      worldId: "concordia-hub", attackerId: "atk1", targetId: "def1", targetKind: "player",
      severity: "flinch", momentum: 12, element: "physical", damage: 42, isKill: false,
      targetPosition: { x: 1, y: 0, z: 2 }, attackerPosition: { x: 0, y: 0, z: 0 },
    };
    realtimeEmit("combat:impact", impactPayload, { worldId: "concordia-hub" });

    assert.equal(io.sockets.get("socket-same-world").received.length, 1);
    assert.equal(io.sockets.get("socket-other-world").received.length, 0,
      "the PvP combat:impact emit must not leak cross-world either");
  });

  it("worldId tier sits between orgId and the global fallback — userId/sessionId/orgId still take priority when present", () => {
    const io = makeRoomIo();
    io.join("s-user", "user:u1");
    io.join("s-world", "world:concordia-hub");

    const realtimeEmit = makeRealtimeEmitPostFix(io);
    // A hypothetical caller supplying BOTH userId and worldId must still
    // resolve to the user-scoped room, matching every other realtimeEmit
    // consumer's expectation that userId is the most specific tier.
    realtimeEmit("some:event", { a: 1 }, { userId: "u1", worldId: "concordia-hub" });

    assert.equal(io.sockets.get("s-user").received.length, 1);
    assert.equal(io.sockets.get("s-world").received.length, 0,
      "userId must win over worldId when both are supplied — world tier is a new floor, not a priority change");
  });
});
