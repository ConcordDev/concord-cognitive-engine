// Contract tests for server/domains/expedition-journal.js — per-world
// expedition progress tracker. Exercises every registered macro and
// asserts the { ok } envelope shape + persistence behaviour.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerExpeditionJournalActions from "../domains/expedition-journal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`expedition-journal.${name}`);
  if (!fn) throw new Error(`expedition-journal.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerExpeditionJournalActions(register); });

beforeEach(() => {
  // Fresh in-process STATE per test for isolation.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "exp_user_a" }, userId: "exp_user_a" };
const ctxB = { actor: { userId: "exp_user_b" }, userId: "exp_user_b" };

describe("expedition-journal.worlds", () => {
  it("returns canon worlds with richer authored stage definitions", () => {
    const r = call("worlds", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.worlds));
    assert.ok(r.result.worlds.length >= 6);
    const hub = r.result.worlds.find((w) => w.worldId === "concordia-hub");
    assert.ok(hub);
    assert.ok(hub.stages.length >= 3);
    assert.ok(hub.stages[0].objective);
    assert.ok(hub.stages[0].xp > 0);
  });
});

describe("expedition-journal.progress", () => {
  it("rejects an unknown world", () => {
    assert.equal(call("progress", ctxA, { worldId: "nope" }).ok, false);
  });

  it("returns a fresh world progress view with 0 completed stages", () => {
    const r = call("progress", ctxA, { worldId: "fantasy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 0);
    assert.equal(r.result.expeditionComplete, false);
    assert.ok(r.result.total > 0);
  });
});

describe("expedition-journal.mark-stage", () => {
  it("rejects unknown world / stage", () => {
    assert.equal(call("mark-stage", ctxA, { worldId: "nope", stageId: "arrive" }).ok, false);
    assert.equal(call("mark-stage", ctxA, { worldId: "fantasy", stageId: "nope" }).ok, false);
  });

  it("marks a stage done and awards stage XP once", () => {
    const r1 = call("mark-stage", ctxA, { worldId: "fantasy", stageId: "arrive", done: true });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.world.completed, 1);
    assert.ok(r1.result.totalXp > 0);
    assert.ok(r1.result.awarded.some((a) => a.kind === "xp"));

    // Re-marking already-done does not double-award XP.
    const xpBefore = r1.result.totalXp;
    const r2 = call("mark-stage", ctxA, { worldId: "fantasy", stageId: "arrive", done: true });
    assert.equal(r2.result.totalXp, xpBefore);

    // Un-marking clears completion.
    const r3 = call("mark-stage", ctxA, { worldId: "fantasy", stageId: "arrive", done: false });
    assert.equal(r3.result.world.completed, 0);
  });

  it("awards an expedition-complete badge when every stage is done", () => {
    const worlds = call("worlds", ctxA, {}).result.worlds;
    const fantasy = worlds.find((w) => w.worldId === "fantasy");
    let last;
    for (const st of fantasy.stages) {
      last = call("mark-stage", ctxA, { worldId: "fantasy", stageId: st.id, done: true });
    }
    assert.equal(last.result.world.expeditionComplete, true);
    assert.ok(last.result.badges.some((b) => b.id === "world-complete"));
  });
});

describe("expedition-journal.entry-add / entry-list / entry-delete", () => {
  it("rejects unknown world and empty text", () => {
    assert.equal(call("entry-add", ctxA, { worldId: "nope", text: "x" }).ok, false);
    assert.equal(call("entry-add", ctxA, { worldId: "fantasy", text: "" }).ok, false);
  });

  it("writes, lists and deletes a journal entry", () => {
    const add = call("entry-add", ctxA, { worldId: "cyber", stageId: "arrive", text: "Jacked in." });
    assert.equal(add.ok, true);
    const id = add.result.entry.id;

    const list = call("entry-list", ctxA, { worldId: "cyber" });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const del = call("entry-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("entry-list", ctxA, { worldId: "cyber" }).result.count, 0);

    assert.equal(call("entry-delete", ctxA, { id: "ghost" }).ok, false);
  });
});

describe("expedition-journal.photo-add / photo-list / photo-delete", () => {
  it("rejects a missing or malformed url", () => {
    assert.equal(call("photo-add", ctxA, { worldId: "cyber" }).ok, false);
    assert.equal(call("photo-add", ctxA, { worldId: "cyber", url: "ftp://x" }).ok, false);
  });

  it("adds, lists and removes a photo", () => {
    const add = call("photo-add", ctxA, { worldId: "cyber", stageId: "arrive", dataUrl: "data:image/png;base64,AAAA", caption: "shot" });
    assert.equal(add.ok, true);
    assert.ok(add.result.photo.id);
    const id = add.result.photo.id;

    const list = call("photo-list", ctxA, { worldId: "cyber" });
    assert.equal(list.result.count, 1);

    const del = call("photo-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("photo-list", ctxA, { worldId: "cyber" }).result.count, 0);

    assert.equal(call("photo-delete", ctxA, { id: "ghost" }).ok, false);
  });
});

describe("expedition-journal.rewards", () => {
  it("returns an XP + badge ledger", () => {
    call("mark-stage", ctxA, { worldId: "fantasy", stageId: "arrive", done: true });
    const r = call("rewards", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.xp > 0);
    assert.ok(Array.isArray(r.result.badges));
    assert.ok(Array.isArray(r.result.log));
  });
});

describe("expedition-journal.summary", () => {
  it("rolls up cross-world progress and is per-user isolated", () => {
    call("mark-stage", ctxA, { worldId: "fantasy", stageId: "arrive", done: true });
    const a = call("summary", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.completedStages, 1);
    assert.ok(a.result.xp > 0);
    assert.ok(a.result.totalWorlds >= 6);

    // user B has independent (empty) progress.
    const b = call("summary", ctxB, {});
    assert.equal(b.result.completedStages, 0);
  });
});
