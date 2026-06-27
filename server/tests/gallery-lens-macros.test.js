// Behavioral macro tests for server/domains/gallery.js — the multi-museum
// gallery substrate (Cleveland Museum + Smithsonian + Art Institute of Chicago
// Open-Access browsing, saved collections, view history, recommendations,
// curated exhibits, side-by-side compare, deep-zoom, and AR-style virtual rooms).
//
// LIGHTWEIGHT + HERMETIC: no server boot, no network, no LLM. The harness
// mirrors the REAL LENS_ACTIONS dispatch (server.js:39150) — handler is invoked
// as `(ctx, virtualArtifact, input)`, the same 3-arg shape gallery.js registers
// with. The domain persists into the in-memory globalThis._concordSTATE.galleryLens
// store (Map per user), so the pure-STATE macros are fully deterministic and
// drivable offline.
//
// These are NOT shape-only assertions: each test asserts ACTUAL values +
// multi-step round-trips (create collection → save artwork → dashboard → remove;
// create exhibit → add panels → reorder → publish → delete; create room →
// place → remove; record-view → history → dedupe), per-user isolation, and the
// fail-CLOSED numeric guards the macro-assassin's V2 vector probes.
//
// The external-IO macros (cma-search, si-search, cma-artwork, deep-zoom,
// visual-search, recommendations, artist, compare, feed) make real outbound HTTP
// calls to live museum APIs, so we drive ONLY their validation-rejection paths
// (which fail-fast BEFORE any fetch) — keeping the suite offline + deterministic.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGalleryActions from "../domains/gallery.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "gallery", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the real 3-arg LENS_ACTIONS dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`gallery.${name} not registered`);
  return fn(ctx, null, input);
}

before(() => { registerGalleryActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("gallery — registration", () => {
  it("registers every macro the lens + its child components call", () => {
    for (const m of [
      // external-IO museum browsing
      "cma-search", "cma-artwork", "si-search", "cma-departments",
      "visual-search", "visual-search-styles", "deep-zoom", "compare",
      "artist", "recommendations", "feed",
      // pure-STATE collections + history
      "collection-create", "collection-list", "collection-detail", "collection-delete",
      "artwork-save", "artwork-remove", "gallery-dashboard",
      "record-view", "view-history",
      // curated exhibits
      "exhibit-create", "exhibit-list", "exhibit-detail", "exhibit-add-panel",
      "exhibit-reorder-panels", "exhibit-remove-panel", "exhibit-publish", "exhibit-delete",
      // virtual rooms
      "virtual-room-create", "virtual-room-list", "virtual-room-detail",
      "virtual-room-place", "virtual-room-remove-placement", "virtual-room-delete",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing gallery.${m}`);
    }
  });
});

describe("gallery — saved-collections round-trip (create → save → dashboard → remove → delete)", () => {
  it("creates a collection, saves real artwork metadata into it, and counts it", () => {
    const created = call("collection-create", ctxA, { name: "Dutch Masters" });
    assert.equal(created.ok, true);
    const colId = created.result.collection.id;
    assert.equal(created.result.collection.name, "Dutch Masters");
    assert.deepEqual(created.result.collection.artworks, []);

    // collection-list auto-seeds the default "Favorites" + shows the new one.
    let listed = call("collection-list", ctxA, {});
    assert.equal(listed.ok, true);
    const names = listed.result.collections.map((c) => c.name).sort();
    assert.deepEqual(names, ["Dutch Masters", "Favorites"]);
    assert.equal(listed.result.count, 2);

    // save an artwork (real CMA-shaped metadata) into the new collection.
    const saved = call("artwork-save", ctxA, {
      collectionId: colId, title: "The Night Watch", artist: "Rembrandt",
      refId: "cma:1", museum: "Cleveland Museum of Art", image: "https://x/img.jpg",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.artworkCount, 1);
    assert.equal(saved.result.artwork.artist, "Rembrandt");
    const artId = saved.result.artwork.id;

    // dedupe: same refId into the same collection is rejected.
    const dup = call("artwork-save", ctxA, { collectionId: colId, title: "The Night Watch", refId: "cma:1" });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already/i);

    // detail reflects the saved artwork.
    const detail = call("collection-detail", ctxA, { id: colId });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.collection.artworks.length, 1);

    // dashboard aggregates across all collections.
    const dash = call("gallery-dashboard", ctxA, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.savedArtworks, 1);
    assert.equal(dash.result.byMuseum["Cleveland Museum of Art"], 1);
    assert.equal(dash.result.artists, 1);

    // remove the artwork → count drops, collection persists.
    const removed = call("artwork-remove", ctxA, { collectionId: colId, artworkId: artId });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.artworkCount, 0);

    // delete the collection itself.
    const del = call("collection-delete", ctxA, { id: colId });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, colId);
    listed = call("collection-list", ctxA, {});
    assert.equal(listed.result.collections.some((c) => c.id === colId), false);
  });

  it("rejects a blank collection name and an empty-title save", () => {
    assert.equal(call("collection-create", ctxA, { name: "   " }).ok, false);
    assert.equal(call("artwork-save", ctxA, { title: "" }).ok, false);
  });

  it("isolates collections per user", () => {
    call("collection-create", ctxA, { name: "Private A" });
    const listB = call("collection-list", ctxB, {});
    // user_b sees only their auto-seeded Favorites, never user_a's "Private A".
    assert.equal(listB.result.collections.some((c) => c.name === "Private A"), false);
  });
});

describe("gallery — view history feeds recommendations basis (record → history → dedupe)", () => {
  it("records views newest-first, dedupes by refId, and caps to the requested limit", () => {
    const r1 = call("record-view", ctxA, { title: "Starry Night", artist: "Van Gogh", refId: "v1", department: "Modern" });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.historySize, 1);
    call("record-view", ctxA, { title: "Sunflowers", artist: "Van Gogh", refId: "v2" });
    // re-viewing v1 bumps it to front, does NOT duplicate.
    const again = call("record-view", ctxA, { title: "Starry Night", refId: "v1" });
    assert.equal(again.result.historySize, 2);

    const hist = call("view-history", ctxA, { limit: 1 });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.history.length, 1);
    assert.equal(hist.result.count, 2);
    assert.equal(hist.result.history[0].refId, "v1"); // most recently viewed first
  });

  it("rejects an empty-title view", () => {
    assert.equal(call("record-view", ctxA, {}).ok, false);
  });
});

describe("gallery — curated exhibit lifecycle (create → add panels → reorder → publish → delete)", () => {
  it("assembles a narrated exhibit, reorders its panels, and publishes only when non-empty", () => {
    const exh = call("exhibit-create", ctxA, { title: "Light & Shadow", theme: "chiaroscuro" });
    assert.equal(exh.ok, true);
    const exhId = exh.result.exhibit.id;
    assert.equal(exh.result.exhibit.published, false);

    // cannot publish an empty exhibit.
    assert.equal(call("exhibit-publish", ctxA, { id: exhId }).ok, false);

    const p1 = call("exhibit-add-panel", ctxA, { exhibitId: exhId, title: "Panel One", refId: "p1", wallText: "intro" });
    assert.equal(p1.ok, true);
    assert.equal(p1.result.panelCount, 1);
    const p2 = call("exhibit-add-panel", ctxA, { exhibitId: exhId, title: "Panel Two", refId: "p2" });
    const id1 = p1.result.panel.id;
    const id2 = p2.result.panel.id;

    // reorder requires every panel id exactly once.
    assert.equal(call("exhibit-reorder-panels", ctxA, { exhibitId: exhId, order: [id1] }).ok, false);
    const reorder = call("exhibit-reorder-panels", ctxA, { exhibitId: exhId, order: [id2, id1] });
    assert.equal(reorder.ok, true);
    assert.deepEqual(reorder.result.order, [id2, id1]);

    // publish now succeeds (2 panels).
    const pub = call("exhibit-publish", ctxA, { id: exhId });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.published, true);

    // list reflects the published exhibit + panel count.
    const list = call("exhibit-list", ctxA, {});
    const row = list.result.exhibits.find((e) => e.id === exhId);
    assert.equal(row.published, true);
    assert.equal(row.panelCount, 2);

    // remove a panel, then delete the exhibit.
    const rem = call("exhibit-remove-panel", ctxA, { exhibitId: exhId, panelId: id2 });
    assert.equal(rem.result.panelCount, 1);
    assert.equal(call("exhibit-delete", ctxA, { id: exhId }).ok, true);
    assert.equal(call("exhibit-detail", ctxA, { id: exhId }).ok, false);
  });
});

describe("gallery — virtual room round-trip + fail-CLOSED numeric placement", () => {
  it("creates a room from a preset, places an artwork at-scale, then removes it", () => {
    const room = call("virtual-room-create", ctxA, { name: "Den", preset: "gallery_hall" });
    assert.equal(room.ok, true);
    const roomId = room.result.room.id;
    assert.equal(room.result.room.preset, "gallery_hall");
    assert.equal(room.result.room.wallWidthM, 8.0);

    const place = call("virtual-room-place", ctxA, {
      roomId, title: "Mona Lisa", artist: "da Vinci", x: 0.25, widthM: 1.2,
    });
    assert.equal(place.ok, true);
    assert.equal(place.result.placement.x, 0.25);
    // y defaults to 0.42, widthM clamps within the wall.
    assert.equal(place.result.placement.y, 0.42);
    const plcId = place.result.placement.id;

    const rem = call("virtual-room-remove-placement", ctxA, { roomId, placementId: plcId });
    assert.equal(rem.ok, true);
    assert.equal(rem.result.placementCount, 0);

    assert.equal(call("virtual-room-delete", ctxA, { id: roomId }).ok, true);
  });

  it("fail-CLOSES omitted/NaN placement coordinates to finite defaults (never NaN/null)", () => {
    const room = call("virtual-room-create", ctxA, { name: "Studio", preset: "studio" });
    const roomId = room.result.room.id;
    // x omitted entirely — must NOT become NaN (which JSON-serializes to null
    // and breaks the wall layout). Defect-fix: defaults to centered 0.5.
    const place = call("virtual-room-place", ctxA, { roomId, title: "Untitled" });
    assert.equal(place.ok, true);
    assert.equal(Number.isFinite(place.result.placement.x), true);
    assert.equal(place.result.placement.x, 0.5);
    assert.equal(Number.isFinite(place.result.placement.y), true);

    // adversarial non-finite x is clamped, not propagated.
    const place2 = call("virtual-room-place", ctxA, { roomId, title: "Two", x: Number.NaN });
    assert.equal(Number.isFinite(place2.result.placement.x), true);
    const place3 = call("virtual-room-place", ctxA, { roomId, title: "Three", x: 1e308 });
    assert.equal(Number.isFinite(place3.result.placement.x), true);
    assert.equal(place3.result.placement.x <= 1, true);
  });

  it("clamps an oversized wall and rejects a missing room", () => {
    const room = call("virtual-room-create", ctxA, { name: "Huge", wallWidthM: 999 });
    assert.equal(room.result.room.wallWidthM, 20); // clamped to max 20m
    assert.equal(call("virtual-room-place", ctxA, { roomId: "nope", title: "X" }).ok, false);
  });
});

describe("gallery — static + validation paths of external-IO macros (no network)", () => {
  it("cma-departments + visual-search-styles return real static catalogs", () => {
    const depts = call("cma-departments", ctxA, {});
    assert.equal(depts.ok, true);
    assert.equal(depts.result.departments.includes("Japanese Art"), true);
    assert.equal(depts.result.departments.length >= 15, true);

    const styles = call("visual-search-styles", ctxA, {});
    assert.equal(styles.ok, true);
    assert.equal(styles.result.styles.includes("impressionism"), true);
  });

  it("network macros fail-fast on missing/invalid input BEFORE any fetch", async () => {
    // cma-artwork / deep-zoom require a positive numeric id.
    assert.equal((await call("cma-artwork", ctxA, {})).ok, false);
    assert.equal((await call("cma-artwork", ctxA, { id: -1 })).ok, false);
    assert.equal((await call("deep-zoom", ctxA, { id: 0 })).ok, false);
    // visual-search needs at least one of color/style/query.
    assert.equal((await call("visual-search", ctxA, {})).ok, false);
    // compare needs 2–4 ids.
    assert.equal((await call("compare", ctxA, { ids: [1] })).ok, false);
    assert.equal((await call("compare", ctxA, { ids: [1, 2, 3, 4, 5] })).ok, false);
    // artist needs a name.
    assert.equal((await call("artist", ctxA, {})).ok, false);
    // si-search requires the DATA_GOV_API_KEY env (absent in test) or a query.
    const prevKey = process.env.DATA_GOV_API_KEY;
    delete process.env.DATA_GOV_API_KEY;
    assert.equal((await call("si-search", ctxA, { query: "x" })).ok, false);
    if (prevKey !== undefined) process.env.DATA_GOV_API_KEY = prevKey;
  });

  it("recommendations returns an empty, network-free result with no history", async () => {
    // With zero history/saves the pool is empty → early return, never fetches.
    const rec = await call("recommendations", ctxA, {});
    assert.equal(rec.ok, true);
    assert.equal(rec.result.reason, "no_history");
    assert.deepEqual(rec.result.recommendations, []);
  });

  it("rejects access when STATE is unavailable", () => {
    globalThis._concordSTATE = undefined;
    assert.equal(call("collection-list", ctxA, {}).ok, false);
    assert.equal(call("exhibit-list", ctxA, {}).ok, false);
    assert.equal(call("virtual-room-list", ctxA, {}).ok, false);
  });
});
