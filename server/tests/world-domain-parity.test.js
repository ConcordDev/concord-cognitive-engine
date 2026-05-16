// Tier-2 contract tests for world lens parity polish macros
// (faction-overlay-data / share-link-create / quest-summary / marketplace-summary).
// Pins per-user scoping + share link cache + quest pin toggle + overlay prefs.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldActions from "../domains/world.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`world.${name}`);
  if (!fn) throw new Error(`world.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerWorldActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("world — faction overlay data", () => {
  it("returns sample factions + relations when simulation absent", () => {
    const r = call("faction-overlay-data", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "sample");
    assert.ok(r.result.factions.length >= 3);
    assert.ok(Array.isArray(r.result.relations));
    for (const f of r.result.factions) {
      assert.ok(f.id, "faction id present");
      assert.ok(f.name);
      assert.ok(f.stance);
      assert.ok(Number.isFinite(f.cx));
      assert.ok(Number.isFinite(f.cy));
      assert.ok(Number.isFinite(f.radius));
    }
  });

  it("returns live data when simulation state seeded", () => {
    globalThis._concordSTATE.factionStrategy = {
      "world_test": {
        factions: [{ id: "f1", name: "Live faction", stance: "war", momentum: 0.8, color: "#ff0000", cx: 100, cy: 100, radius: 50 }],
        relations: [],
      },
    };
    const r = call("faction-overlay-data", ctxA, { worldId: "world_test" });
    assert.equal(r.result.source, "live");
    assert.equal(r.result.factions[0].name, "Live faction");
  });
});

describe("world — share link primitive", () => {
  it("creates a link with position params encoded in URL", () => {
    const r = call("share-link-create", ctxA, {
      worldId: "concordia-hub",
      x: 100.5,
      y: 25.0,
      z: -42.7,
      note: "great view of the mountain",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.link.url.includes("world=concordia-hub"));
    assert.ok(r.result.link.url.includes("x=100.5"));
    assert.ok(r.result.link.url.includes("y=25.0"));
    assert.ok(r.result.link.url.includes("z=-42.7"));
  });

  it("rejects missing worldId", () => {
    const r = call("share-link-create", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /worldId required/);
  });

  it("INVARIANT: share-links scoped per-user", () => {
    call("share-link-create", ctxA, { worldId: "w_a" });
    const listB = call("share-links-list", ctxB);
    assert.equal(listB.result.links.length, 0);
  });

  it("share-links-list returns recent links sorted by createdAt desc", async () => {
    call("share-link-create", ctxA, { worldId: "w1" });
    await new Promise((r) => setTimeout(r, 2));
    call("share-link-create", ctxA, { worldId: "w2" });
    const list = call("share-links-list", ctxA);
    assert.equal(list.result.links.length, 2);
    assert.equal(list.result.links[0].worldId, "w2");
  });
});

describe("world — quest summary", () => {
  it("returns chains with active/completed counts", () => {
    const r = call("quest-summary", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.ok(r.result.chains.length > 0);
    for (const chain of r.result.chains) {
      assert.ok(chain.chainId);
      assert.ok(Array.isArray(chain.quests));
      assert.ok(Number.isInteger(chain.activeCount));
      assert.ok(Number.isInteger(chain.completedCount));
    }
  });

  it("quest-pin-toggle toggles pin state", () => {
    const r1 = call("quest-pin-toggle", ctxA, { questId: "q_test_1" });
    assert.equal(r1.result.pinned, true);
    const r2 = call("quest-pin-toggle", ctxA, { questId: "q_test_1" });
    assert.equal(r2.result.pinned, false);
  });

  it("rejects missing questId", () => {
    const r = call("quest-pin-toggle", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /questId required/);
  });

  it("INVARIANT: pinned quests are scoped per-user", () => {
    call("quest-pin-toggle", ctxA, { questId: "q_pinA" });
    const summary = call("quest-summary", ctxB, { worldId: "concordia-hub" });
    const allUserBQuests = summary.result.chains.flatMap((c) => c.quests);
    const pinnedFromB = allUserBQuests.filter((q) => q.pinned);
    assert.equal(pinnedFromB.length, 0);
  });

  it("pinned quests surface in quest-summary for the owning user", () => {
    const sample = call("quest-summary", ctxA, { worldId: "concordia-hub" });
    const someQuestId = sample.result.chains[0].quests[0].id;
    call("quest-pin-toggle", ctxA, { questId: someQuestId });
    const after = call("quest-summary", ctxA, { worldId: "concordia-hub" });
    const allQuests = after.result.chains.flatMap((c) => c.quests);
    const pinned = allQuests.find((q) => q.id === someQuestId);
    assert.equal(pinned.pinned, true);
  });
});

describe("world — marketplace summary", () => {
  it("returns listings filtered by kind", () => {
    const all = call("marketplace-summary", ctxA, { worldId: "concordia-hub", kind: "all" });
    const spells = call("marketplace-summary", ctxA, { worldId: "concordia-hub", kind: "spell_recipe" });
    assert.ok(all.result.listings.length > spells.result.listings.length);
    for (const l of spells.result.listings) {
      assert.equal(l.kind, "spell_recipe");
    }
  });

  it("defaults to all when no kind provided", () => {
    const r = call("marketplace-summary", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.result.kind, "all");
  });

  it("returns live data when STATE.marketplace seeded", () => {
    globalThis._concordSTATE.marketplace = {
      "world_test": {
        listings: [{
          id: "x", kind: "dtu", title: "Live", price: 100, currency: "cc",
          sellerName: "Live seller", rarity: "rare",
        }],
      },
    };
    const r = call("marketplace-summary", ctxA, { worldId: "world_test" });
    assert.equal(r.result.source, "live");
    assert.equal(r.result.listings[0].title, "Live");
  });
});

describe("world — overlay preferences", () => {
  it("returns default prefs when unset", () => {
    const r = call("overlay-prefs-get", ctxA);
    assert.equal(r.result.prefs.factionOverlay, false);
    assert.equal(r.result.prefs.hotbarMode, "auto");
    assert.equal(r.result.prefs.photoTemplate, "concord");
  });

  it("persists prefs across calls", () => {
    call("overlay-prefs-set", ctxA, { factionOverlay: true, hotbarMode: "combat" });
    const r = call("overlay-prefs-get", ctxA);
    assert.equal(r.result.prefs.factionOverlay, true);
    assert.equal(r.result.prefs.hotbarMode, "combat");
  });

  it("INVARIANT: prefs are scoped per-user", () => {
    call("overlay-prefs-set", ctxA, { factionOverlay: true });
    const b = call("overlay-prefs-get", ctxB);
    assert.equal(b.result.prefs.factionOverlay, false);
  });

  it("ignores invalid hotbarMode values", () => {
    call("overlay-prefs-set", ctxA, { hotbarMode: "auto" });
    call("overlay-prefs-set", ctxA, { hotbarMode: "invalid_mode" });
    const r = call("overlay-prefs-get", ctxA);
    assert.equal(r.result.prefs.hotbarMode, "auto");
  });
});

describe("world — STATE unavailable path", () => {
  it("returns error shape when STATE is missing for stateful macros", () => {
    globalThis._concordSTATE = undefined;
    const r = call("share-link-create", ctxA, { worldId: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
