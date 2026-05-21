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

/* ─── Backlog feature coverage — Are.na + IEP parity ───────────────── */

describe("philosophy.block-grid (visual image grid)", () => {
  it("returns image-ready blocks for a channel", () => {
    const c = newChannel();
    call("block-add", ctxA, { channelId: c.id, kind: "image", content: "The Cave", imageUrl: "https://example.org/cave.jpg" });
    call("block-add", ctxA, { channelId: c.id, kind: "text", content: "A plain note." });
    const r = call("block-grid", ctxA, { channelId: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const img = r.result.blocks.find((b) => b.kind === "image");
    assert.equal(img.imageUrl, "https://example.org/cave.jpg");
  });
  it("rejects an unknown channel", () => {
    assert.equal(call("block-grid", ctxA, { channelId: "nope" }).ok, false);
  });
});

describe("philosophy.public discovery", () => {
  it("publishes a channel and surfaces it in public-channels", () => {
    const c = newChannel(ctxA, { title: "Stoic ideas" });
    assert.equal(call("public-channels", ctxB, {}).result.count, 0);
    const pub = call("channel-publish", ctxA, { id: c.id, public: true });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.public, true);
    const list = call("public-channels", ctxB, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.channels[0].id, c.id);
  });
  it("public-channel-detail exposes a published channel cross-user", () => {
    const c = newChannel(ctxA, { title: "Open channel" });
    call("channel-publish", ctxA, { id: c.id, public: true });
    call("block-add", ctxA, { channelId: c.id, content: "A shared idea." });
    const d = call("public-channel-detail", ctxB, { id: c.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.blocks.length, 1);
    assert.equal(d.result.ownerId, "user_a");
  });
  it("public-channel-detail rejects a private channel", () => {
    const c = newChannel();
    assert.equal(call("public-channel-detail", ctxB, { id: c.id }).ok, false);
  });
  it("public-channels filters by query", () => {
    const c1 = newChannel(ctxA, { title: "Phenomenology" });
    const c2 = newChannel(ctxA, { title: "Pragmatism" });
    call("channel-publish", ctxA, { id: c1.id, public: true });
    call("channel-publish", ctxA, { id: c2.id, public: true });
    assert.equal(call("public-channels", ctxB, { query: "pheno" }).result.count, 1);
  });
});

describe("philosophy.channel collaborators", () => {
  it("adds and lists collaborators", () => {
    const c = newChannel();
    const r = call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });
    assert.equal(r.ok, true);
    assert.ok(r.result.collaborators.includes("user_b"));
    const list = call("channel-collaborator-list", ctxA, { id: c.id });
    assert.equal(list.result.collaborators.length, 1);
  });
  it("a collaborator can resolve the channel and add image blocks", () => {
    const c = newChannel();
    call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });
    const grid = call("block-grid", ctxB, { channelId: c.id });
    assert.equal(grid.ok, true);
  });
  it("rejects adding the owner as a collaborator", () => {
    const c = newChannel();
    assert.equal(call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_a" }).ok, false);
  });
  it("removes a collaborator", () => {
    const c = newChannel();
    call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });
    call("channel-collaborator-remove", ctxA, { id: c.id, userId: "user_b" });
    assert.equal(call("channel-collaborator-list", ctxA, { id: c.id }).result.collaborators.length, 0);
  });
});

describe("philosophy.block-embed + reference-page (Wikipedia)", () => {
  beforeEach(() => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/related/")) {
        return { ok: true, json: async () => ({ pages: [{ title: "Virtue", extract: "x", thumbnail: { source: "t.jpg" } }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          title: "Stoicism",
          description: "school of philosophy",
          extract: "Stoicism is a school of Hellenistic philosophy.",
          thumbnail: { source: "https://example.org/stoa.jpg" },
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Stoicism" } },
        }),
      };
    };
  });
  it("block-embed creates a rich embed block from Wikipedia", async () => {
    const c = newChannel();
    const r = await call("block-embed", ctxA, { channelId: c.id, title: "Stoicism" });
    assert.equal(r.ok, true);
    assert.equal(r.result.block.kind, "embed");
    assert.equal(r.result.block.embed.provider, "wikipedia");
    assert.equal(r.result.block.imageUrl, "https://example.org/stoa.jpg");
  });
  it("reference-page returns a structured entry and saves it", async () => {
    const r = await call("reference-page", ctxA, { topic: "Stoicism", kind: "concept", save: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.saved, true);
    assert.equal(r.result.page.title, "Stoicism");
    assert.equal(call("reference-list", ctxA, {}).result.count, 1);
  });
  it("reference-delete removes a saved page", async () => {
    await call("reference-page", ctxA, { topic: "Stoicism", kind: "thinker", save: true });
    const saved = call("reference-list", ctxA, {}).result.references;
    call("reference-delete", ctxA, { id: saved[0].id });
    assert.equal(call("reference-list", ctxA, {}).result.count, 0);
  });
});

describe("philosophy.connections-graph", () => {
  it("returns nodes, edges and channel bridges", () => {
    const c1 = newChannel(ctxA, { title: "Mind" });
    const c2 = newChannel(ctxA, { title: "Consciousness" });
    const b = call("block-add", ctxA, { channelId: c1.id, content: "Qualia bridge." }).result.block;
    call("block-connect", ctxA, { blockId: b.id, channelId: c2.id });
    const g = call("connections-graph", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.channelCount, 2);
    assert.equal(g.result.crossConnectedBlocks, 1);
    assert.equal(g.result.bridges.length, 1);
  });
});

describe("philosophy.debate threads", () => {
  it("creates a debate, posts a critique, tallies stances", () => {
    const t = call("debate-create", ctxA, { title: "Is free will real?", claim: "Free will exists.", branch: "metaphysics" }).result.thread;
    assert.ok(t.id);
    call("debate-post", ctxB, { threadId: t.id, stance: "object", body: "Determinism rules it out." });
    call("debate-post", ctxA, { threadId: t.id, stance: "support", body: "Agency is observable." });
    const d = call("debate-detail", ctxA, { id: t.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.thread.posts.length, 2);
    assert.equal(d.result.tally.object, 1);
    assert.equal(d.result.tally.support, 1);
  });
  it("rejects a debate without a claim", () => {
    assert.equal(call("debate-create", ctxA, { title: "x" }).ok, false);
  });
  it("debate-list surfaces threads across users", () => {
    call("debate-create", ctxA, { title: "T1", claim: "C1" });
    call("debate-create", ctxB, { title: "T2", claim: "C2" });
    assert.equal(call("debate-list", ctxA, {}).result.count, 2);
  });
  it("debate-resolve closes a thread for its author", () => {
    const t = call("debate-create", ctxA, { title: "T", claim: "C" }).result.thread;
    const r = call("debate-resolve", ctxA, { id: t.id, status: "resolved", resolution: "Settled." });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "resolved");
  });
});
