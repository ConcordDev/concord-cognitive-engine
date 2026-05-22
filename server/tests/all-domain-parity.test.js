// Contract tests for the "all" lens — the launcher / command-palette
// substrate in server/domains/all.js: recency + frequency tracking,
// pinned lenses, last-activity badges, and the fuzzy command index.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAllActions from "../domains/all.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`all.${name}`);
  assert.ok(fn, `all.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAllActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  delete globalThis._concordMACROS;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Seed a DTU into the live store.
function seedDtu(domain, id, createdAt) {
  globalThis._concordSTATE.dtus.set(id, {
    id, domain, title: `${domain} dtu ${id}`,
    createdAt, human: { summary: `summary for ${id}` },
  });
}

// ─── [S] Recently-used / frequently-used lens ordering ────────────────
describe("all.record-open + usage-list", () => {
  it("records a lens open and surfaces it in usage-list", () => {
    const r = call("record-open", ctxA, { lensId: "code" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    const list = call("usage-list", ctxA, {});
    assert.equal(list.result.totalTracked, 1);
    assert.equal(list.result.recent[0].lensId, "code");
  });
  it("rejects record-open without a lensId", () => {
    assert.equal(call("record-open", ctxA, {}).ok, false);
  });
  it("scopes usage per user", () => {
    call("record-open", ctxA, { lensId: "music" });
    assert.equal(call("usage-list", ctxA, {}).result.totalTracked, 1);
    assert.equal(call("usage-list", ctxB, {}).result.totalTracked, 0);
  });
  it("orders by frequency in frequent mode", () => {
    call("record-open", ctxA, { lensId: "code" });
    call("record-open", ctxA, { lensId: "code" });
    call("record-open", ctxA, { lensId: "code" });
    call("record-open", ctxA, { lensId: "music" });
    const freq = call("usage-list", ctxA, { mode: "frequent" });
    assert.equal(freq.result.frequent[0].lensId, "code");
    assert.equal(freq.result.frequent[0].count, 3);
  });
  it("orders by recency in recent mode", () => {
    call("record-open", ctxA, { lensId: "code" });
    call("record-open", ctxA, { lensId: "music" });
    const recent = call("usage-list", ctxA, { mode: "recent" });
    assert.equal(recent.result.recent[0].lensId, "music");
  });
});

// ─── [S] Pin / favorite lenses to a top shelf ─────────────────────────
describe("all.pin-toggle + pin-list + pin-reorder", () => {
  it("pins and unpins a lens", () => {
    const p = call("pin-toggle", ctxA, { lensId: "chat" });
    assert.equal(p.ok, true);
    assert.equal(p.result.pinned, true);
    assert.deepEqual(p.result.pins, ["chat"]);
    const u = call("pin-toggle", ctxA, { lensId: "chat" });
    assert.equal(u.result.pinned, false);
    assert.deepEqual(u.result.pins, []);
  });
  it("rejects pin-toggle without a lensId", () => {
    assert.equal(call("pin-toggle", ctxA, {}).ok, false);
  });
  it("pin-list returns the ordered shelf", () => {
    call("pin-toggle", ctxA, { lensId: "code" });
    call("pin-toggle", ctxA, { lensId: "music" });
    const list = call("pin-list", ctxA, {});
    assert.equal(list.result.count, 2);
    assert.deepEqual(list.result.pins, ["code", "music"]);
  });
  it("pin-reorder rearranges the shelf", () => {
    call("pin-toggle", ctxA, { lensId: "code" });
    call("pin-toggle", ctxA, { lensId: "music" });
    call("pin-toggle", ctxA, { lensId: "chat" });
    const r = call("pin-reorder", ctxA, { pins: ["chat", "code", "music"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.pins, ["chat", "code", "music"]);
  });
  it("pin-reorder keeps forgotten pins appended", () => {
    call("pin-toggle", ctxA, { lensId: "code" });
    call("pin-toggle", ctxA, { lensId: "music" });
    const r = call("pin-reorder", ctxA, { pins: ["music"] });
    assert.deepEqual(r.result.pins, ["music", "code"]);
  });
  it("rejects pin-reorder without a pins array", () => {
    assert.equal(call("pin-reorder", ctxA, {}).ok, false);
  });
});

// ─── [S] Per-lens last-activity badge ─────────────────────────────────
describe("all.lens-badges", () => {
  it("counts all DTUs for a never-opened lens", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    seedDtu("code", "d2", "2026-05-02T10:00:00.000Z");
    const b = call("lens-badges", ctxA, { lensIds: ["code"] });
    assert.equal(b.ok, true);
    assert.equal(b.result.badges.code.count, 2);
  });
  it("only counts DTUs created after the last open", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    call("record-open", ctxA, { lensId: "code" });
    seedDtu("code", "d2", new Date(Date.now() + 60000).toISOString());
    const b = call("lens-badges", ctxA, { lensIds: ["code"] });
    assert.equal(b.result.badges.code.count, 1);
  });
  it("omits lenses with no fresh activity", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    call("record-open", ctxA, { lensId: "code" });
    const b = call("lens-badges", ctxA, { lensIds: ["code"] });
    assert.equal(b.result.badges.code, undefined);
  });
  it("returns empty badges when no lensIds given", () => {
    assert.deepEqual(call("lens-badges", ctxA, {}).result.badges, {});
  });
});

// ─── [M] Fuzzy command-palette index (jump to action, not just lens) ──
describe("all.command-index", () => {
  it("indexes registered macro actions from a nested registry", () => {
    const inner = new Map();
    inner.set("holdings-list", { fn: () => {} });
    inner.set("trade", { fn: () => {} });
    globalThis._concordMACROS = new Map([["crypto", inner]]);
    const r = call("command-index", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indexed, 2);
    assert.ok(r.result.commands.some((c) => c.id === "crypto.trade"));
  });
  it("fuzzy-filters commands by query", () => {
    const inner = new Map();
    inner.set("holdings-list", { fn: () => {} });
    inner.set("trade", { fn: () => {} });
    globalThis._concordMACROS = new Map([["crypto", inner]]);
    const r = call("command-index", ctxA, { query: "cryptotrade" });
    assert.equal(r.result.total, 1);
    assert.equal(r.result.commands[0].id, "crypto.trade");
  });
  it("handles a flat registry shape via STATE.macros", () => {
    globalThis._concordSTATE.macros = new Map([
      ["music.session-start", { fn: () => {} }],
    ]);
    const r = call("command-index", ctxA, {});
    assert.ok(r.result.commands.some((c) => c.id === "music.session-start"));
  });
  it("returns an empty index when no registry is present", () => {
    const r = call("command-index", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.indexed, 0);
  });
});

// ─── Legacy macros still respond ──────────────────────────────────────
describe("all legacy macros", () => {
  it("crossDomainSearch matches seeded DTUs", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    const r = call("crossDomainSearch", ctxA, { query: "summary" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
  });
  it("domainStats aggregates by domain", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    seedDtu("music", "d2", "2026-05-02T10:00:00.000Z");
    const r = call("domainStats", ctxA, {});
    assert.equal(r.result.totalDtus, 2);
    assert.equal(r.result.domains, 2);
  });
  it("recentActivity returns a newest-first feed", () => {
    seedDtu("code", "d1", "2026-05-01T10:00:00.000Z");
    seedDtu("music", "d2", "2026-05-02T10:00:00.000Z");
    const r = call("recentActivity", ctxA, {});
    assert.equal(r.result.feed[0].dtuId, "d2");
  });
});
