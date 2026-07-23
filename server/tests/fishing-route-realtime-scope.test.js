/**
 * Pinning test for a realtime-emit-signature finding (DET-C batch 5):
 * server/routes/fishing.js#POST /cast emitted 'fishing:cast' and (in the
 * bite setTimeout) 'fishing:bite' with only (event, payload) — no 3rd
 * options argument. server.js#realtimeEmit only room-scopes delivery to
 * `user:<id>` when it receives `userId` via that 3rd argument; a bare
 * 2-arg call falls through to a GLOBAL io.emit() broadcast, leaking every
 * player's sessionId + biteAtEpochMs to every connected socket instead of
 * just the casting player.
 *
 * Same signature-bug shape as the 'arena:match:found' fix pinned in
 * arena-match-found-emit.test.js — this is the 4th confirmed instance
 * this session.
 *
 * Run: node --test server/tests/fishing-route-realtime-scope.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import createFishingRouter from "../routes/fishing.js";

function buildApp(emitted) {
  const requireAuth = (req, _res, next) => next();
  const realtimeEmit = (event, payload, options) => emitted.push({ event, payload, options });
  return { router: createFishingRouter({ requireAuth, db: null, realtimeEmit }), emitted };
}

function layerFor(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("fishing.js — 'fishing:cast' / 'fishing:bite' are room-scoped to the casting user", () => {
  it("passes userId via the 3rd realtimeEmit options argument on cast", async () => {
    const emitted = [];
    const { router } = buildApp(emitted);
    const castPost = layerFor(router, "post", "/cast");

    let castRes = null;
    await castPost(
      { user: { id: "angler-1" }, body: { worldId: "concordia-hub", x: 0, z: 0 } },
      { json: (b) => { castRes = b; }, status() { return this; } },
    );
    assert.equal(castRes.ok, true);

    const castEmit = emitted.find((e) => e.event === "fishing:cast");
    assert.ok(castEmit, "fishing:cast must be emitted");
    // The real bug: userId must arrive via the options arg (3rd param),
    // which is what realtimeEmit's { userId = "" } destructure — and its
    // io.to(`user:${userId}`) room-scoping — actually reads. A bare 2-arg
    // call silently falls through to a global broadcast instead.
    assert.ok(
      castEmit.options && typeof castEmit.options.userId === "string" && castEmit.options.userId.length > 0,
      "userId must be passed as the 3rd realtimeEmit argument (options), not payload alone",
    );
    assert.equal(castEmit.options.userId, "angler-1");
    // event-shapes.js still requires userId IN the payload too (unlike the
    // arena fix, which dropped it) — both fishing:cast and fishing:bite
    // declare userId as a required payload field, so it must stay there
    // as well as in options.
    assert.equal(castEmit.payload.userId, "angler-1");
    assert.equal(typeof castEmit.payload.sessionId, "string");
  });

  it("scopes fishing:bite the same way once the bite timer fires", async () => {
    const emitted = [];
    const { router } = buildApp(emitted);
    const castPost = layerFor(router, "post", "/cast");

    // The route schedules the bite emit via a real setTimeout (3-8s bite
    // window — see BITE_MIN_MS/BITE_MAX_MS in lib/fishing.js). Fire it
    // synchronously instead of waiting out the real window: the route
    // only reads `resolve`/callback identity, not any timing behavior,
    // so this doesn't weaken what the test proves.
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return 0; };
    let castRes = null;
    try {
      await castPost(
        { user: { id: "angler-2" }, body: { worldId: "concordia-hub", x: 0, z: 0 } },
        { json: (b) => { castRes = b; }, status() { return this; } },
      );
    } finally {
      global.setTimeout = originalSetTimeout;
    }
    assert.equal(castRes.ok, true);

    const biteEmit = emitted.find((e) => e.event === "fishing:bite");
    assert.ok(biteEmit, "fishing:bite must be emitted once the bite timer fires");
    assert.ok(
      biteEmit.options && biteEmit.options.userId === "angler-2",
      "fishing:bite must also be scoped to the casting user via options.userId",
    );
    assert.equal(biteEmit.payload.userId, "angler-2");
  });
});
