// tests/depth/dtu-visibility-cache-behavior.test.js
//
// Concurrency Refactor Tier 0 — pins the userVisibleDTUs() cache
// (server.js, 2026-09-08). The cache is version-keyed off STATE.dtus'
// write-through-store getVersion(), which bumps on every set()/delete().
// A stale entry after a mutation would be a real correctness bug: a lens
// showing a deleted DTU, not showing a just-created one, or leaking a
// private DTU across viewers.
//
// The mutations here go straight through STATE.dtus.set()/delete() (the
// harness exposes STATE) rather than the dtu.create macro, so the test
// isn't coupled to the content-quality gate — and set()/delete() IS
// exactly the invalidation signal the cache keys off.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

const idsFor = (r) => new Set((r?.result?.dtus ?? r?.dtus ?? []).map((d) => d.id));

function mkDtu(id, over = {}) {
  return {
    id,
    tier: "regular",
    visibility: "public",
    scope: "global",
    human: { summary: `${id} summary` },
    core: {},
    machine: {},
    title: id,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("userVisibleDTUs cache — invalidation + per-viewer correctness", () => {
  let runMacro, STATE, ctxA;
  const made = [];
  before(async () => { ({ runMacro, STATE, ctx: ctxA } = await macroRuntime("dtu-cache-A")); });

  it("dtu.list is stable across two consecutive identical calls (cache hit path)", async () => {
    const a = idsFor(await runMacro("dtu", "list", { limit: 2000 }, ctxA));
    const b = idsFor(await runMacro("dtu", "list", { limit: 2000 }, ctxA));
    assert.deepEqual(a, b, "same viewer, no writes between → identical id set");
  });

  it("STATE.dtus.set() bumps the version and the next dtu.list shows the new DTU", async () => {
    const v0 = STATE.dtus.getVersion();
    const before = idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA));

    const id = `uvcache-new-${Date.now()}`;
    made.push(id);
    STATE.dtus.set(id, mkDtu(id));
    assert.ok(STATE.dtus.getVersion() > v0, "set() bumped getVersion()");

    const after = idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA));
    assert.ok(!before.has(id) && after.has(id),
      "just-set public DTU is visible immediately — cache did NOT serve a stale list");
  });

  it("STATE.dtus.delete() bumps the version and the next dtu.list drops the DTU", async () => {
    const id = `uvcache-del-${Date.now()}`;
    STATE.dtus.set(id, mkDtu(id));
    assert.ok(idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA)).has(id), "present after set");

    const vBefore = STATE.dtus.getVersion();
    STATE.dtus.delete(id);
    assert.ok(STATE.dtus.getVersion() > vBefore, "delete() bumped getVersion()");

    assert.ok(!idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA)).has(id),
      "deleted DTU is gone from the next list — cache did NOT serve a stale entry");
  });

  it("a private DTU owned by someone else is filtered out AFTER a version bump busts the cache", async () => {
    // warm ctxA's cache
    await runMacro("dtu", "list", { limit: 5000 }, ctxA);

    const privId = `uvcache-priv-${Date.now()}`;
    made.push(privId);
    // owned by a different user, private
    STATE.dtus.set(privId, mkDtu(privId, {
      visibility: "private",
      scope: "user",
      author: "some-other-user-id",
      ownerId: "some-other-user-id",
    }));

    const aSees = idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA));
    assert.ok(!aSees.has(privId),
      "viewer A must NOT see another user's private DTU — the filter still runs when the version bump forces a rebuild");
  });

  it("owner DOES see their own private DTU through the cache (per-viewer keying)", async () => {
    // dtu.list reads the viewer from ctx.actor.id (the harness ctx only carries
    // .userId, so a plain harness ctx lists as anon). Build a real signed-in
    // ctx so this exercises the non-anon cache key.
    const uid = "uvcache-owner-user";
    const ownerCtx = { ...ctxA, actor: { ...ctxA.actor, id: uid, userId: uid } };

    // warm anon + owner cache entries
    await runMacro("dtu", "list", { limit: 5000 }, ctxA);
    await runMacro("dtu", "list", { limit: 5000 }, ownerCtx);

    const ownId = `uvcache-own-${Date.now()}`;
    made.push(ownId);
    STATE.dtus.set(ownId, mkDtu(ownId, {
      visibility: "private", scope: "user", author: uid, ownerId: uid,
    }));

    const ownerSees = idsFor(await runMacro("dtu", "list", { limit: 5000 }, ownerCtx));
    assert.ok(ownerSees.has(ownId), "owner sees their own private DTU (owner cache key rebuilt on the version bump)");

    const anonSees = idsFor(await runMacro("dtu", "list", { limit: 5000 }, ctxA));
    assert.ok(!anonSees.has(ownId), "anon does NOT see it — separate cache key, filtered correctly");
  });
});
