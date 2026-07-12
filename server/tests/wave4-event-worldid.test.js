// Wave 4 — closes the "Honest residual" gap documented in
// docs/lens-specs/spectate-capability-map.md: combat:hit, dtu:promoted,
// world:event:scheduled, and the three faction:* strategy events used to
// broadcast platform-wide with no worldId field, so a spectator watching one
// world (or any per-world consumer) saw every world's traffic indiscriminately.
//
// world:event:scheduled and the faction:* events have their own dedicated
// coverage (tests/world-event-scheduler.test.js's tick() describe block, and
// tests/contract/heartbeat-emits.test.js's new "Wave 4 worldId stamping"
// describe block, respectively) because both delegate to real, directly
// importable functions (tick(), applyMove()) that can be exercised end to end.
//
// combat:hit and dtu:promoted's worldId derivation is written INLINE in
// server.js's giant combat:attack socket handler and scope.promote macro —
// there's no separate importable function to call. This file:
//   1. Behaviorally tests the REAL dependency combat:hit's fix relies on —
//      lib/city-presence.js's getUserPosition(userId).worldId — proving the
//      mechanism actually reflects a user's current world (not the dead
//      cityPresence.getPlayerWorld accessor the code used to call, which
//      doesn't exist on this module's exports and always resolved to
//      undefined → the hardcoded "concordia-hub" fallback regardless of the
//      player's real world).
//   2. Mirrors the exact dtu:promoted worldId-derivation expression from
//      server.js (quoted verbatim in a comment) against representative DTU
//      shapes, the same "pin the exact handler-constructed shape" pattern
//      already used by tests/conkay-macro-lifecycle.test.js for other inline
//      server.js emit logic that can't be unit-invoked directly.
//   3. Confirms event-shapes.js's updated combat:hit / dtu:promoted schemas
//      accept payloads both with and without worldId (optional, not forced).
//
// Run: node --test tests/wave4-event-worldid.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  getUserPosition,
  removeUser,
} from "../lib/city-presence.js";
import { validateEvent } from "../lib/event-shapes.js";

describe("combat:hit worldId — real dependency (lib/city-presence.js)", () => {
  beforeEach(() => configurePresence({ db: null, fireTrigger: null }));
  afterEach(() => { removeUser("atk_w4"); removeUser("def_w4"); });

  it("getPlayerWorld does NOT exist on city-presence's exports (the bug this pass fixed)", async () => {
    const cityPresence = await import("../lib/city-presence.js");
    assert.equal(
      cityPresence.getPlayerWorld, undefined,
      "cityPresence.getPlayerWorld must not silently reappear — server.js's " +
      "other 3 call sites (8830/8855/9232) still rely on it being undefined " +
      "and falling back to concordia-hub; if this ever starts resolving, " +
      "those call sites' behavior changes silently",
    );
  });

  it("getUserPosition(userId).worldId reflects the real world a player travelled to", () => {
    updateUserPosition("atk_w4", { cityId: "tunya", x: 0, y: 0, z: 0, worldId: "tunya" });
    const pos = getUserPosition("atk_w4");
    assert.equal(pos.worldId, "tunya", "this is the exact field server.js's combat:hit fix now reads");
  });

  it("worldId falls back to cityId when the caller never set an explicit worldId (Concordia: city id IS world id)", () => {
    updateUserPosition("def_w4", { cityId: "sovereign-ruins", x: 1, y: 0, z: 1 });
    const pos = getUserPosition("def_w4");
    assert.equal(pos.worldId, "sovereign-ruins");
  });

  it("a never-seen user has no presence entry — the combat:hit handler's ?? \"concordia-hub\" fallback is what covers this, not city-presence itself", () => {
    assert.equal(getUserPosition("nobody_w4"), undefined);
  });
});

describe("event-shapes.js — combat:hit accepts worldId as optional", () => {
  it("validates a combat:hit payload WITH worldId (the socket combat:attack path, post-fix)", () => {
    const v = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2", damage: 10, worldId: "tunya",
    });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("still validates a combat:hit payload WITHOUT worldId (lib/combat-netcode.js's separate, already-room-scoped emitter)", () => {
    const v = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2", damage: 10,
    });
    assert.equal(v.ok, true, JSON.stringify(v));
  });
});

describe("dtu:promoted worldId — derivation mirror (server.js scope.promote, ~line 37760)", () => {
  // Mirrors, verbatim, the expression server.js now uses:
  //   const _promotedWorldId = dtu.world_id ?? dtu.worldId
  //     ?? dtu.meta?.world_id ?? dtu.meta?.worldId ?? null;
  //   realtimeEmit("dtu:promoted", {
  //     dtuId: dtu.id, targetScope, votes: reviewResult.votes,
  //     ...(_promotedWorldId ? { worldId: _promotedWorldId } : {}),
  //   });
  // DTUs are cross-world by design (server.js's in-memory dtu object built by
  // the dtu.create macro has no formal world_id field — see CLAUDE.md's DTU
  // substrate notes) — this derivation is best-effort and honestly omits the
  // field rather than inventing "concordia-hub" for a DTU that was never
  // scoped to any particular world.
  function deriveWorldId(dtu) {
    return dtu.world_id ?? dtu.worldId ?? dtu.meta?.world_id ?? dtu.meta?.worldId ?? null;
  }
  function buildPayload(dtu, targetScope, votes) {
    const worldId = deriveWorldId(dtu);
    return {
      dtuId: dtu.id, targetScope, votes,
      ...(worldId ? { worldId } : {}),
    };
  }

  it("uses meta.world_id when the DTU was created with one (the common real-world case)", () => {
    const dtu = { id: "dtu_1", meta: { world_id: "concordia-hub" } };
    const payload = buildPayload(dtu, "global", { approve: 1, reject: 0, total: 1 });
    assert.equal(payload.worldId, "concordia-hub");
  });

  it("uses meta.worldId (camelCase) as a fallback", () => {
    const dtu = { id: "dtu_2", meta: { worldId: "tunya" } };
    const payload = buildPayload(dtu, "global", { approve: 1, reject: 0, total: 1 });
    assert.equal(payload.worldId, "tunya");
  });

  it("prefers a top-level world_id over meta when both are present", () => {
    const dtu = { id: "dtu_3", world_id: "sovereign-ruins", meta: { world_id: "tunya" } };
    const payload = buildPayload(dtu, "global", { approve: 1, reject: 0, total: 1 });
    assert.equal(payload.worldId, "sovereign-ruins");
  });

  it("omits worldId entirely (never fabricates one) for a DTU with no world scope — the common case, since DTUs are cross-world by design", () => {
    const dtu = { id: "dtu_4", meta: {} };
    const payload = buildPayload(dtu, "global", { approve: 1, reject: 0, total: 1 });
    assert.equal("worldId" in payload, false, "an ungrounded worldId must be omitted, not defaulted to concordia-hub");
    // Everything else the real emit sends is still present.
    assert.equal(payload.dtuId, "dtu_4");
    assert.equal(payload.targetScope, "global");
  });

  it("event-shapes.js validates dtu:promoted both with and without worldId", () => {
    const withWorld = validateEvent("dtu:promoted", { dtuId: "d1", tier: "regular", worldId: "tunya" });
    assert.equal(withWorld.ok, true, JSON.stringify(withWorld));
    const withoutWorld = validateEvent("dtu:promoted", { dtuId: "d1", tier: "regular" });
    assert.equal(withoutWorld.ok, true, JSON.stringify(withoutWorld));
  });
});
