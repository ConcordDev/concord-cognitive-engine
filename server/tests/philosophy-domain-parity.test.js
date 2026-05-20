// Contract tests for the philosophy lens — Are.na-shape idea-curation
// substrate in server/domains/philosophy.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhilosophyActions from "../domains/philosophy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`philosophy.${name}`);
  assert.ok(fn, `philosophy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPhilosophyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newChannel(ctx = ctxA, over = {}) {
  return call("channel-create", ctx, { title: "Free will", ...over }).result.channel;
}

describe("philosophy.channel CRUD", () => {
  it("creates a channel scoped per user", () => {
    newChannel();
    assert.equal(call("channel-list", ctxA, {}).result.count, 1);
    assert.equal(call("channel-list", ctxB, {}).result.count, 0);
  });
  it("rejects an untitled channel", () => {
    assert.equal(call("channel-create", ctxA, {}).ok, false);
  });
  it("delete detaches blocks and drops orphans", () => {
    const c = newChannel();
    call("block-add", ctxA, { channelId: c.id, content: "An orphan-to-be block." });
    call("channel-delete", ctxA, { id: c.id });
    assert.equal(call("channel-list", ctxA, {}).result.count, 0);
    assert.equal(call("philosophy-dashboard", ctxA, {}).result.blocks, 0);
  });
});

describe("philosophy.blocks", () => {
  it("adds typed blocks to a channel", () => {
    const c = newChannel();
    call("block-add", ctxA, { channelId: c.id, kind: "quote", content: "The unexamined life is not worth living.", source: "Socrates" });
    const d = call("channel-detail", ctxA, { id: c.id });
    assert.equal(d.result.blocks.length, 1);
    assert.equal(d.result.blocks[0].kind, "quote");
  });
  it("unknown kind falls back to text; empty content rejected", () => {
    const c = newChannel();
    assert.equal(call("block-add", ctxA, { channelId: c.id, content: "x", kind: "weird" }).result.block.kind, "text");
    assert.equal(call("block-add", ctxA, { channelId: c.id }).ok, false);
  });
  it("connects a block to a second channel and disconnects it", () => {
    const c1 = newChannel();
    const c2 = newChannel(ctxA, { title: "Determinism" });
    const b = call("block-add", ctxA, { channelId: c1.id, content: "Compatibilism reconciles the two." }).result.block;
    call("block-connect", ctxA, { blockId: b.id, channelId: c2.id });
    assert.equal(call("channel-detail", ctxA, { id: c2.id }).result.blocks.length, 1);
    call("block-connect", ctxA, { blockId: b.id, channelId: c2.id, disconnect: true });
    assert.equal(call("channel-detail", ctxA, { id: c2.id }).result.blocks.length, 0);
  });
  it("deletes a block", () => {
    const c = newChannel();
    const b = call("block-add", ctxA, { channelId: c.id, content: "delete me please" }).result.block;
    call("block-delete", ctxA, { id: b.id });
    assert.equal(call("channel-detail", ctxA, { id: c.id }).result.blocks.length, 0);
  });
});

describe("philosophy.search + dashboard", () => {
  it("search matches channel titles and block content", () => {
    const c = newChannel();
    call("block-add", ctxA, { channelId: c.id, content: "Libertarianism about free will." });
    assert.ok(call("philosophy-search", ctxA, { query: "free will" }).result.count >= 1);
    assert.equal(call("philosophy-search", ctxA, { query: "libertarianism" }).result.blocks.length, 1);
  });
  it("dashboard counts channels, blocks, connected blocks and kinds", () => {
    const c1 = newChannel();
    const c2 = newChannel(ctxA, { title: "Ethics" });
    const b = call("block-add", ctxA, { channelId: c1.id, kind: "quote", content: "A quote here." }).result.block;
    call("block-connect", ctxA, { blockId: b.id, channelId: c2.id });
    const d = call("philosophy-dashboard", ctxA, {});
    assert.equal(d.result.channels, 2);
    assert.equal(d.result.blocks, 1);
    assert.equal(d.result.connectedBlocks, 1);
    assert.equal(d.result.byKind.quote, 1);
  });
});

describe("philosophy — analysis macros still intact", () => {
  it("ethicalFramework returns frameworks", () => {
    const r = call("ethicalFramework", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.frameworks.length >= 4);
  });
});
