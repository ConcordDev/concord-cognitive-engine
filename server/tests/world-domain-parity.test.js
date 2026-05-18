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

describe("world — faction overlay data (real data only)", () => {
  it("returns empty + setup hint when simulation isn't seeded", () => {
    const r = call("faction-overlay-data", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "empty");
    assert.equal(r.result.factions.length, 0);
    assert.equal(r.result.relations.length, 0);
    assert.match(r.result.notes, /content\/world\/concordia-hub\/factions\.json/);
  });

  it("returns live data when STATE.factionStrategy seeded", () => {
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
    await new Promise((r) => { setTimeout(r, 2); });
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

describe("world — marketplace summary (real DTU corpus only)", () => {
  it("returns empty + setup hint when no listings exist", () => {
    const r = call("marketplace-summary", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "empty");
    assert.equal(r.result.listings.length, 0);
    assert.match(r.result.notes, /No listings/);
  });

  it("defaults to all when no kind provided", () => {
    const r = call("marketplace-summary", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.result.kind, "all");
  });

  it("returns per-world marketplace when STATE.marketplace seeded", () => {
    globalThis._concordSTATE.marketplace = {
      "world_test": {
        listings: [{
          id: "x", kind: "dtu", title: "Live", price: 100, currency: "cc",
          sellerName: "Live seller", rarity: "rare",
        }],
      },
    };
    const r = call("marketplace-summary", ctxA, { worldId: "world_test" });
    assert.equal(r.result.source, "marketplace-per-world");
    assert.equal(r.result.listings[0].title, "Live");
  });

  it("pulls from STATE.dtus when no marketplace state but DTUs exist", () => {
    globalThis._concordSTATE.dtus = new Map([
      ["dtu_1", { id: "dtu_1", kind: "spell_recipe", human: { title: "Frostbolt recipe" }, machine: { price: 50, rarity: "uncommon" }, creatorName: "Mage Anya", worldId: "concordia-hub" }],
      ["dtu_2", { id: "dtu_2", kind: "blueprint", human: { title: "Tower blueprint" }, machine: { price: 200 }, creatorName: "Builder Greg" }],
    ]);
    const r = call("marketplace-summary", ctxA, { worldId: "concordia-hub" });
    assert.equal(r.result.source, "dtu-corpus");
    assert.equal(r.result.listings.length, 2);
  });

  it("filters by kind across all real sources", () => {
    globalThis._concordSTATE.dtus = new Map([
      ["d1", { id: "d1", kind: "spell_recipe", human: { title: "Spell" }, machine: { price: 1 } }],
      ["d2", { id: "d2", kind: "blueprint", human: { title: "Blueprint" }, machine: { price: 2 } }],
    ]);
    const r = call("marketplace-summary", ctxA, { worldId: "concordia-hub", kind: "spell_recipe" });
    assert.equal(r.result.listings.length, 1);
    assert.equal(r.result.listings[0].kind, "spell_recipe");
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

describe("world — spatial voice chat (WebRTC + 50m cells)", () => {
  function captureRealtimeEmits() {
    const events = [];
    globalThis._concordREALTIME = {
      io: { to: (room) => ({ emit: (name, payload) => events.push({ room, name, payload }) }) },
    };
    return events;
  }

  it("voice-join-cell rejects missing worldId or position", () => {
    assert.equal(call("voice-join-cell", ctxA, {}).ok, false);
    assert.equal(call("voice-join-cell", ctxA, { worldId: "w1" }).ok, false);
    assert.equal(call("voice-join-cell", ctxA, { worldId: "w1", x: "nope" }).ok, false);
  });

  it("voice-join-cell returns existing peers + emits peer-joined to cell room", () => {
    const events = captureRealtimeEmits();
    // userB joins first
    const r1 = call("voice-join-cell", ctxB, { worldId: "w1", x: 10, y: 0, z: 20 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.peerCount, 0);
    const cellKey = r1.result.cellKey;
    // userA joins same cell — should see userB in peer list
    const r2 = call("voice-join-cell", ctxA, { worldId: "w1", x: 12, y: 0, z: 22 });
    assert.equal(r2.result.cellKey, cellKey);
    assert.deepEqual(r2.result.peers, ["user_b"]);
    assert.equal(r2.result.peerCount, 1);
    // userB received a peer-joined emit for userA
    const joined = events.filter((e) => e.name === "voice:peer-joined");
    assert.equal(joined.length, 2);  // self (userB join) + userA join
    assert.equal(joined[1].payload.userId, "user_a");
    assert.equal(joined[1].room, `voice:w1:${cellKey}`);
  });

  it("voice-update-position triggers room rotation when cell changes", () => {
    const events = captureRealtimeEmits();
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    // Move 100m → crosses 50m cell boundary
    const r = call("voice-update-position", ctxA, { x: 100, y: 0, z: 0 });
    assert.equal(r.result.cellChanged, true);
    const leftEvents = events.filter((e) => e.name === "voice:peer-left");
    const joinedEvents = events.filter((e) => e.name === "voice:peer-joined");
    // 1 join on original cell + 1 leave + 1 join on new cell
    assert.equal(leftEvents.length, 1);
    assert.equal(joinedEvents.length, 2);
  });

  it("voice-update-position is a no-op when staying in same cell", () => {
    const events = captureRealtimeEmits();
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    events.length = 0;  // clear after join
    const r = call("voice-update-position", ctxA, { x: 25, y: 0, z: 49 });
    assert.equal(r.result.cellChanged, false);
    // No peer-joined / peer-left fired
    assert.equal(events.filter((e) => e.name.startsWith("voice:peer")).length, 0);
  });

  it("voice-update-position rejects when not joined", () => {
    const r = call("voice-update-position", ctxA, { x: 0, y: 0, z: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /voice-join-cell first/);
  });

  it("voice-leave-cell emits peer-left + removes from voicePeers", () => {
    const events = captureRealtimeEmits();
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    events.length = 0;
    const r = call("voice-leave-cell", ctxA, {});
    assert.equal(r.ok, true);
    const left = events.find((e) => e.name === "voice:peer-left");
    assert.ok(left);
    assert.equal(left.payload.userId, "user_a");
    // Peers query now empty
    const q = call("voice-peers-in-cell", ctxA, {});
    assert.equal(q.result.cellKey, null);
  });

  it("voice-peers-in-cell lists co-cell peers excluding self", () => {
    call("voice-join-cell", ctxA, { worldId: "w1", x: 10, y: 0, z: 20 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 12, y: 0, z: 22 });
    const qA = call("voice-peers-in-cell", ctxA, {});
    assert.deepEqual(qA.result.peers, ["user_b"]);
    const qB = call("voice-peers-in-cell", ctxB, {});
    assert.deepEqual(qB.result.peers, ["user_a"]);
  });

  it("voice-signal relays payload to target's user:room", () => {
    const events = captureRealtimeEmits();
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 5, y: 0, z: 5 });
    events.length = 0;
    const r = call("voice-signal", ctxA, {
      target: "user_b", kind: "offer",
      payload: { type: "offer", sdp: "v=0..." },
    });
    assert.equal(r.ok, true);
    const sig = events.find((e) => e.name === "voice:signal");
    assert.ok(sig);
    assert.equal(sig.room, "user:user_b");
    assert.equal(sig.payload.from, "user_a");
    assert.equal(sig.payload.to, "user_b");
    assert.equal(sig.payload.kind, "offer");
    assert.equal(sig.payload.payload.sdp, "v=0...");
  });

  it("voice-signal rejects unknown kinds", () => {
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 5, y: 0, z: 5 });
    const r = call("voice-signal", ctxA, { target: "user_b", kind: "trojan", payload: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /kind must be one of/);
  });

  it("voice-signal refuses when peer is not in same cell (anti-abuse)", () => {
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 500, y: 0, z: 500 });  // far cell
    const r = call("voice-signal", ctxA, {
      target: "user_b", kind: "offer", payload: { type: "offer", sdp: "x" },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not in the same voice cell/);
  });

  it("voice-signal refuses when target hasn't joined", () => {
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    const r = call("voice-signal", ctxA, {
      target: "ghost", kind: "offer", payload: {},
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /both peers must be in/);
  });

  it("voice-signal does NOT inspect payload (audio privacy invariant)", () => {
    const events = captureRealtimeEmits();
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 5, y: 0, z: 5 });
    events.length = 0;
    const opaquePayload = { sdp: "v=0...", weird: "anything goes", binary: [1, 2, 3] };
    const r = call("voice-signal", ctxA, {
      target: "user_b", kind: "answer", payload: opaquePayload,
    });
    assert.equal(r.ok, true);
    const sig = events.find((e) => e.name === "voice:signal");
    // Payload comes through verbatim — no inspection or filtering
    assert.deepEqual(sig.payload.payload, opaquePayload);
  });

  it("voice-sweep-stale drops peers older than VOICE_PEER_STALE_MS", () => {
    call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    call("voice-join-cell", ctxB, { worldId: "w1", x: 5, y: 0, z: 5 });
    // Backdate userA's lastSeen
    const s = globalThis._concordSTATE.worldLens;
    const aInfo = s.voicePeers.get("user_a");
    aInfo.lastSeenMs = Date.now() - 120_000;
    const r = call("voice-sweep-stale", ctxA, {});
    assert.equal(r.result.swept, 1);
    // userA is gone, userB still here
    assert.equal(s.voicePeers.has("user_a"), false);
    assert.equal(s.voicePeers.has("user_b"), true);
  });

  it("INVARIANT: cells are 50m on each axis (env override CONCORD_VOICE_CELL_M is read once at module init)", () => {
    // Two players 49m apart — same cell
    const r1 = call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    const r2 = call("voice-join-cell", ctxB, { worldId: "w1", x: 49, y: 0, z: 0 });
    assert.equal(r1.result.cellKey, r2.result.cellKey);
    // 50m+ apart — different cell
    call("voice-leave-cell", ctxB, {});
    const r3 = call("voice-join-cell", ctxB, { worldId: "w1", x: 51, y: 0, z: 0 });
    assert.notEqual(r1.result.cellKey, r3.result.cellKey);
  });

  it("INVARIANT: realtime emit failure does not throw (audio path is best-effort)", () => {
    globalThis._concordREALTIME = {
      io: { to: () => ({ emit: () => { throw new Error("socket dead"); } }) },
    };
    const r = call("voice-join-cell", ctxA, { worldId: "w1", x: 0, y: 0, z: 0 });
    assert.equal(r.ok, true);  // didn't throw
  });
});
