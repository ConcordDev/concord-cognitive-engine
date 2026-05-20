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
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

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
