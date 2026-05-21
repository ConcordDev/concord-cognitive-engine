// Contract tests for the gallery lens — saved artwork collections
// substrate in server/domains/gallery.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGalleryActions from "../domains/gallery.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`gallery.${name}`);
  assert.ok(fn, `gallery.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGalleryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// CMA search-shape fixture (one artwork).
function cmaWork(id, over = {}) {
  return {
    id,
    accession_number: `A${id}`,
    title: over.title || `Work ${id}`,
    creators: [{ description: over.artist || "Vincent van Gogh" }],
    culture: over.culture || ["Dutch"],
    creation_date: over.date || "1889",
    creation_date_earliest: over.dateEarliest || 1889,
    type: over.type || "Painting",
    technique: over.medium || "Oil on canvas",
    department: over.department || "European Painting and Sculpture",
    measurements: over.measurements || "73 x 93 cm",
    images: { web: { url: `https://img.example/${id}.jpg` }, print: { url: `https://img.example/${id}-print.jpg` } },
    url: `https://clevelandart.org/art/${id}`,
  };
}

describe("gallery.collections", () => {
  it("collection-list auto-seeds a Favorites collection", () => {
    const r = call("collection-list", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.collections[0].name, "Favorites");
  });
  it("creates a collection scoped per user", () => {
    call("collection-create", ctxA, { name: "Impressionism" });
    assert.equal(call("collection-list", ctxA, {}).result.count, 2);
    assert.equal(call("collection-list", ctxB, {}).result.count, 1); // default only
  });
  it("rejects an unnamed collection and deletes one", () => {
    assert.equal(call("collection-create", ctxA, {}).ok, false);
    const c = call("collection-create", ctxA, { name: "Temp" }).result.collection;
    call("collection-delete", ctxA, { id: c.id });
    assert.equal(call("collection-list", ctxA, {}).result.count, 1);
  });
});

describe("gallery.artwork-save", () => {
  it("saves an artwork to the default collection", () => {
    const r = call("artwork-save", ctxA, { title: "The Starry Night", artist: "Van Gogh", museum: "MoMA", refId: "vg-starry" });
    assert.equal(r.ok, true);
    assert.equal(r.result.artworkCount, 1);
  });
  it("rejects a duplicate refId in the same collection", () => {
    call("artwork-save", ctxA, { title: "Water Lilies", refId: "monet-lilies" });
    assert.equal(call("artwork-save", ctxA, { title: "Water Lilies copy", refId: "monet-lilies" }).ok, false);
  });
  it("rejects a titleless artwork", () => {
    assert.equal(call("artwork-save", ctxA, {}).ok, false);
  });
  it("saves into a named collection and removes an artwork", () => {
    const c = call("collection-create", ctxA, { name: "Sculpture" }).result.collection;
    const a = call("artwork-save", ctxA, { collectionId: c.id, title: "David", artist: "Michelangelo" }).result.artwork;
    assert.equal(call("collection-detail", ctxA, { id: c.id }).result.collection.artworks.length, 1);
    call("artwork-remove", ctxA, { collectionId: c.id, artworkId: a.id });
    assert.equal(call("collection-detail", ctxA, { id: c.id }).result.collection.artworks.length, 0);
  });
});

describe("gallery.dashboard", () => {
  it("aggregates collections, artworks, museums and artists", () => {
    call("artwork-save", ctxA, { title: "A", artist: "Artist1", museum: "CMA" });
    call("artwork-save", ctxA, { title: "B", artist: "Artist2", museum: "CMA" });
    const d = call("gallery-dashboard", ctxA, {});
    assert.equal(d.result.savedArtworks, 2);
    assert.equal(d.result.byMuseum.CMA, 2);
    assert.equal(d.result.artists, 2);
  });
});

// ─── View history + recommendations ──────────────────────────────────

describe("gallery.view-history", () => {
  it("records a view and lists newest-first with dedupe", () => {
    const r = call("record-view", ctxA, { title: "Sunflowers", artist: "Van Gogh", refId: "cma:1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.historySize, 1);
    // Re-viewing the same refId bumps, does not duplicate.
    call("record-view", ctxA, { title: "Sunflowers", artist: "Van Gogh", refId: "cma:1" });
    const h = call("view-history", ctxA, {});
    assert.equal(h.result.count, 1);
    assert.equal(h.result.history[0].title, "Sunflowers");
  });
  it("rejects a titleless view", () => {
    assert.equal(call("record-view", ctxA, {}).ok, false);
  });
  it("view-history is scoped per user", () => {
    call("record-view", ctxA, { title: "A", refId: "x:1" });
    assert.equal(call("view-history", ctxB, {}).result.count, 0);
  });
});

describe("gallery.recommendations", () => {
  it("returns no_history when the user has no views or saves", async () => {
    const r = await call("recommendations", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.reason, "no_history");
    assert.equal(r.result.recommendations.length, 0);
  });
  it("builds a taste profile from view history (network degraded)", async () => {
    call("record-view", ctxA, { title: "A", artist: "Claude Monet", department: "Impressionism", refId: "cma:10" });
    call("record-view", ctxA, { title: "B", artist: "Claude Monet", department: "Impressionism", refId: "cma:11" });
    const r = await call("recommendations", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.profile);
    assert.equal(r.result.profile.topArtists[0].name, "Claude Monet");
    // fetch throws in tests → recommendations degrade to [] but profile stands.
    assert.ok(Array.isArray(r.result.recommendations));
  });
});

// ─── Visual / color / style search ───────────────────────────────────

describe("gallery.visual-search", () => {
  it("rejects an empty query", async () => {
    const r = await call("visual-search", {}, {});
    assert.equal(r.ok, false);
  });
  it("surfaces a network error when reaching CMA (fetch disabled)", async () => {
    const r = await call("visual-search", {}, { style: "impressionism" });
    assert.equal(r.ok, false);
    assert.match(r.error, /visual search failed/);
  });
  it("visual-search-styles lists the known style keywords", () => {
    const r = call("visual-search-styles", {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.styles.includes("impressionism"));
    assert.ok(r.result.styles.length >= 10);
  });
});

// ─── Curated thematic exhibits ───────────────────────────────────────

describe("gallery.exhibits", () => {
  it("creates, lists and details an exhibit per user", () => {
    const e = call("exhibit-create", ctxA, { title: "Light in Art", theme: "luminosity" }).result.exhibit;
    assert.ok(e.id);
    assert.equal(call("exhibit-list", ctxA, {}).result.count, 1);
    assert.equal(call("exhibit-list", ctxB, {}).result.count, 0);
    assert.equal(call("exhibit-detail", ctxA, { id: e.id }).result.exhibit.title, "Light in Art");
  });
  it("rejects an untitled exhibit", () => {
    assert.equal(call("exhibit-create", ctxA, {}).ok, false);
  });
  it("adds, reorders and removes narrated panels", () => {
    const e = call("exhibit-create", ctxA, { title: "Seascapes" }).result.exhibit;
    const p1 = call("exhibit-add-panel", ctxA, { exhibitId: e.id, title: "Wave", wallText: "first" }).result.panel;
    const p2 = call("exhibit-add-panel", ctxA, { exhibitId: e.id, title: "Storm", wallText: "second" }).result.panel;
    assert.equal(call("exhibit-detail", ctxA, { id: e.id }).result.exhibit.panels.length, 2);
    const ro = call("exhibit-reorder-panels", ctxA, { exhibitId: e.id, order: [p2.id, p1.id] });
    assert.deepEqual(ro.result.order, [p2.id, p1.id]);
    call("exhibit-remove-panel", ctxA, { exhibitId: e.id, panelId: p1.id });
    assert.equal(call("exhibit-detail", ctxA, { id: e.id }).result.exhibit.panels.length, 1);
  });
  it("rejects publishing an empty exhibit and deletes one", () => {
    const e = call("exhibit-create", ctxA, { title: "Empty" }).result.exhibit;
    assert.equal(call("exhibit-publish", ctxA, { id: e.id }).ok, false);
    call("exhibit-add-panel", ctxA, { exhibitId: e.id, title: "One" });
    assert.equal(call("exhibit-publish", ctxA, { id: e.id }).result.published, true);
    call("exhibit-delete", ctxA, { id: e.id });
    assert.equal(call("exhibit-list", ctxA, {}).result.count, 0);
  });
});

// ─── Artwork comparison ──────────────────────────────────────────────

describe("gallery.compare", () => {
  it("rejects fewer than 2 ids", async () => {
    assert.equal((await call("compare", {}, { ids: [1] })).ok, false);
  });
  it("rejects more than 4 ids", async () => {
    assert.equal((await call("compare", {}, { ids: [1, 2, 3, 4, 5] })).ok, false);
  });
  it("computes a structured diff over CMA records", async () => {
    let n = 0;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ data: cmaWork(++n, { artist: n === 1 ? "Monet" : "Renoir" }) }),
    });
    const r = await call("compare", {}, { ids: [101, 102] });
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 2);
    assert.ok(Array.isArray(r.result.diff));
    assert.ok(r.result.sharedAttributes.includes("type"));
  });
});

// ─── Artist pages ────────────────────────────────────────────────────

describe("gallery.artist", () => {
  it("rejects an empty name", async () => {
    assert.equal((await call("artist", {}, {})).ok, false);
  });
  it("returns no_works_found when both museums are unreachable", async () => {
    const r = await call("artist", {}, { name: "Vincent van Gogh" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reason, "no_works_found");
    assert.equal(r.result.totalWorks, 0);
  });
});

// ─── Deep-zoom viewer ────────────────────────────────────────────────

describe("gallery.deep-zoom", () => {
  it("rejects a missing id", async () => {
    assert.equal((await call("deep-zoom", {}, {})).ok, false);
  });
  it("resolves zoom levels for a CMA artwork", async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ data: cmaWork(7) }),
    });
    const r = await call("deep-zoom", {}, { id: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.deepZoomImage);
    assert.ok(r.result.levels.length >= 1);
  });
});

// ─── Virtual gallery rooms ───────────────────────────────────────────

describe("gallery.virtual-rooms", () => {
  it("creates a room from a preset scoped per user", () => {
    const r = call("virtual-room-create", ctxA, { name: "My Living Room", preset: "living_room" });
    assert.equal(r.ok, true);
    assert.equal(r.result.room.preset, "living_room");
    assert.equal(call("virtual-room-list", ctxA, {}).result.count, 1);
    assert.equal(call("virtual-room-list", ctxB, {}).result.count, 0);
  });
  it("rejects an unnamed room", () => {
    assert.equal(call("virtual-room-create", ctxA, {}).ok, false);
  });
  it("places, lists and removes artworks on a wall", () => {
    const room = call("virtual-room-create", ctxA, { name: "Hall", preset: "gallery_hall" }).result.room;
    const plc = call("virtual-room-place", ctxA, { roomId: room.id, title: "Mona Lisa", x: 0.3, widthM: 0.8 }).result.placement;
    assert.equal(call("virtual-room-detail", ctxA, { id: room.id }).result.room.placements.length, 1);
    call("virtual-room-remove-placement", ctxA, { roomId: room.id, placementId: plc.id });
    assert.equal(call("virtual-room-detail", ctxA, { id: room.id }).result.room.placements.length, 0);
  });
  it("deletes a room", () => {
    const room = call("virtual-room-create", ctxA, { name: "Temp" }).result.room;
    call("virtual-room-delete", ctxA, { id: room.id });
    assert.equal(call("virtual-room-list", ctxA, {}).result.count, 0);
  });
});
