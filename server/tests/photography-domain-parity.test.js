// Contract tests for the photography Lightroom 2026-parity macros
// (catalog, culling, keywords, develop presets, shoots, albums,
// export presets). Pure-compute + Pexels macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhotographyActions from "../domains/photography.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`photography.${name}`);
  assert.ok(fn, `photography.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPhotographyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function importPhoto(ctx = ctxA, over = {}) {
  return call("photo-import", ctx, { filename: "DSC_0001.RAW", camera: "Sony A7IV", lens: "24-70 GM", iso: 400, ...over }).result.photo;
}

describe("photography.photo-* catalog", () => {
  it("import requires a filename, scoped per user", () => {
    assert.equal(call("photo-import", ctxA, {}).ok, false);
    importPhoto();
    assert.equal(call("photo-list", ctxA, {}).result.count, 1);
    assert.equal(call("photo-list", ctxB, {}).result.count, 0);
  });

  it("update keywords + detail + delete", () => {
    const p = importPhoto();
    call("photo-update", ctxA, { id: p.id, keywords: ["landscape", "Sunset", "sunset"] });
    assert.deepEqual(call("photo-detail", ctxA, { id: p.id }).result.photo.keywords, ["landscape", "sunset"]);
    assert.equal(call("photo-delete", ctxA, { id: p.id }).ok, true);
    assert.equal(call("photo-list", ctxA, {}).result.count, 0);
  });
});

describe("photography.culling", () => {
  it("rate clamps 0–5, flag + colour, cull summary", () => {
    const p1 = importPhoto();
    const p2 = importPhoto();
    call("photo-rate", ctxA, { id: p1.id, rating: 9 });   // clamps to 5
    call("photo-flag", ctxA, { id: p1.id, flag: "pick" });
    call("photo-flag", ctxA, { id: p2.id, flag: "reject" });
    call("photo-color-label", ctxA, { id: p1.id, colorLabel: "green" });
    const cull = call("cull-summary", ctxA, {});
    assert.equal(cull.result.picks, 1);
    assert.equal(cull.result.rejects, 1);
    assert.equal(cull.result.fiveStar, 1);
    assert.equal(call("photo-list", ctxA, { flag: "pick" }).result.count, 1);
    assert.equal(call("photo-list", ctxA, { minRating: 5 }).result.count, 1);
  });
});

describe("photography.keywords + search", () => {
  it("keyword add/remove and aggregate counts", () => {
    const p1 = importPhoto();
    const p2 = importPhoto();
    call("keyword-add", ctxA, { id: p1.id, keyword: "portrait" });
    call("keyword-add", ctxA, { id: p2.id, keyword: "portrait" });
    call("keyword-add", ctxA, { id: p1.id, keyword: "studio" });
    const kw = call("keyword-list", ctxA, {});
    assert.equal(kw.result.keywords[0].keyword, "portrait");
    assert.equal(kw.result.keywords[0].count, 2);
    call("keyword-add", ctxA, { id: p1.id, keyword: "studio", remove: true });
    assert.equal(call("keyword-list", ctxA, {}).result.keywords.find((k) => k.keyword === "studio"), undefined);
  });

  it("search matches camera and keyword", () => {
    importPhoto(ctxA, { camera: "Canon R5" });
    importPhoto(ctxA, { camera: "Sony A7IV" });
    assert.equal(call("photo-search", ctxA, { query: "canon" }).result.count, 1);
  });
});

describe("photography.develop presets", () => {
  it("preset create normalizes + clamps adjustments", () => {
    const r = call("preset-create", ctxA, { name: "Punchy", adjustments: { exposure: 99, contrast: 40, bogus: 5 } });
    assert.equal(r.result.preset.adjustments.exposure, 5);   // clamped to range max
    assert.equal(r.result.preset.adjustments.contrast, 40);
    assert.equal(r.result.preset.adjustments.bogus, undefined);
  });

  it("apply a preset writes adjustments onto the photo", () => {
    const photo = importPhoto();
    const preset = call("preset-create", ctxA, { name: "Warm", adjustments: { temperature: 6500, vibrance: 20 } }).result.preset;
    call("preset-apply", ctxA, { photoId: photo.id, presetId: preset.id });
    const d = call("photo-detail", ctxA, { id: photo.id }).result.photo;
    assert.equal(d.develop.temperature, 6500);
    assert.equal(d.appliedPreset, "Warm");
  });

  it("develop-set then develop-reset", () => {
    const photo = importPhoto();
    call("develop-set", ctxA, { id: photo.id, adjustments: { clarity: 30 } });
    assert.equal(call("photo-detail", ctxA, { id: photo.id }).result.photo.develop.clarity, 30);
    call("develop-reset", ctxA, { id: photo.id });
    assert.deepEqual(call("photo-detail", ctxA, { id: photo.id }).result.photo.develop, {});
  });
});

describe("photography.shoots + albums", () => {
  it("assign a photo to a shoot, counts update", () => {
    const photo = importPhoto();
    const shoot = call("shoot-create", ctxA, { name: "Beach session", date: "2026-06-01" }).result.shoot;
    call("shoot-assign", ctxA, { photoId: photo.id, shootId: shoot.id });
    assert.equal(call("shoot-list", ctxA, {}).result.shoots[0].photoCount, 1);
    assert.equal(call("photo-list", ctxA, { shootId: shoot.id }).result.count, 1);
  });

  it("album add/remove photos + detail", () => {
    const p1 = importPhoto();
    const p2 = importPhoto();
    const album = call("album-create", ctxA, { name: "Best of 2026" }).result.album;
    call("album-add-photo", ctxA, { albumId: album.id, photoId: p1.id });
    call("album-add-photo", ctxA, { albumId: album.id, photoId: p2.id });
    assert.equal(call("album-detail", ctxA, { id: album.id }).result.photos.length, 2);
    call("album-add-photo", ctxA, { albumId: album.id, photoId: p1.id, remove: true });
    assert.equal(call("album-detail", ctxA, { id: album.id }).result.photos.length, 1);
    assert.equal(call("album-delete", ctxA, { id: album.id }).ok, true);
  });
});

describe("photography.export presets + stats", () => {
  it("export preset save + list", () => {
    call("export-preset-save", ctxA, { name: "Web JPEG", format: "jpeg", quality: 80, longEdge: 2048 });
    assert.equal(call("export-preset-list", ctxA, {}).result.presets.length, 1);
    assert.equal(call("export-preset-save", ctxA, {}).ok, false);
  });

  it("catalog-stats aggregates cameras and edits", () => {
    const p1 = importPhoto(ctxA, { camera: "Sony A7IV" });
    importPhoto(ctxA, { camera: "Sony A7IV" });
    call("develop-set", ctxA, { id: p1.id, adjustments: { exposure: 1 } });
    call("photo-flag", ctxA, { id: p1.id, flag: "pick" });
    const stats = call("catalog-stats", ctxA, {});
    assert.equal(stats.result.photos, 2);
    assert.equal(stats.result.edited, 1);
    assert.equal(stats.result.picks, 1);
    assert.equal(stats.result.topCameras[0].name, "Sony A7IV");
    assert.equal(stats.result.topCameras[0].count, 2);
  });
});
