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

// ── Lightroom-parity backlog: items 1–7 ─────────────────────────────

describe("photography.raw-develop (item 1)", () => {
  it("decode-meta reports RAW format + bit depth", () => {
    const p = importPhoto(ctxA, { filename: "shot.CR3" });
    const m = call("raw-decode-meta", ctxA, { id: p.id });
    assert.equal(m.ok, true);
    assert.equal(m.result.isRaw, true);
    assert.equal(m.result.bitDepth, 14);
    assert.equal(m.result.hasRawDevelop, false);
  });

  it("raw-develop computes a 256-entry tone LUT + white balance", () => {
    const p = importPhoto(ctxA, { filename: "shot.NEF" });
    const r = call("raw-develop", ctxA, {
      id: p.id, adjustments: { exposure: 1, contrast: 30, temperature: 5000, tint: 10 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.isRaw, true);
    assert.equal(r.result.toneLUT.length, 256);
    assert.ok(r.result.whiteBalance.r > 0);
    assert.equal(call("raw-decode-meta", ctxA, { id: p.id }).result.hasRawDevelop, true);
  });

  it("rejects an unknown photo id", () => {
    assert.equal(call("raw-develop", ctxA, { id: "nope" }).ok, false);
  });
});

describe("photography.histogram + tone curve (item 2)", () => {
  it("histogram-compute folds RGB samples into 256-bin channels", () => {
    const samples = [[0, 0, 0], [255, 255, 255], [128, 128, 128]];
    const r = call("histogram-compute", ctxA, { samples });
    assert.equal(r.ok, true);
    assert.equal(r.result.luma.length, 256);
    assert.equal(r.result.totalSamples, 3);
    assert.ok(r.result.clippedShadowsPct > 0);
    assert.ok(r.result.clippedHighlightsPct > 0);
  });

  it("histogram-compute rejects an empty samples array", () => {
    assert.equal(call("histogram-compute", ctxA, { samples: [] }).ok, false);
  });

  it("tone curve save / list / apply / delete round-trip", () => {
    const photo = importPhoto(ctxA);
    const points = [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }];
    const saved = call("tone-curve-save", ctxA, { name: "Lift", points });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.lut.length, 256);
    assert.equal(call("tone-curve-list", ctxA, {}).result.count, 1);
    const applied = call("tone-curve-apply", ctxA, { photoId: photo.id, curveId: saved.result.curve.id });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.points.length, 3);
    assert.equal(call("tone-curve-delete", ctxA, { id: saved.result.curve.id }).ok, true);
    assert.equal(call("tone-curve-list", ctxA, {}).result.count, 0);
  });
});

describe("photography.masking (item 3)", () => {
  it("mask create / list / update / delete on a photo", () => {
    const photo = importPhoto(ctxA);
    const created = call("mask-create", ctxA, {
      photoId: photo.id, kind: "radial-gradient", name: "Subject pop",
      adjustments: { exposure: 1, clarity: 20 },
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.maskCount, 1);
    assert.equal(call("mask-list", ctxA, { photoId: photo.id }).result.count, 1);
    const upd = call("mask-update", ctxA, {
      photoId: photo.id, maskId: created.result.mask.id, adjustments: { exposure: 2 },
    });
    assert.equal(upd.result.mask.adjustments.exposure, 2);
    assert.equal(call("mask-delete", ctxA, { photoId: photo.id, maskId: created.result.mask.id }).ok, true);
    assert.equal(call("mask-list", ctxA, { photoId: photo.id }).result.count, 0);
  });

  it("rejects an invalid mask kind", () => {
    const photo = importPhoto(ctxA);
    assert.equal(call("mask-create", ctxA, { photoId: photo.id, kind: "bogus" }).ok, false);
  });
});

describe("photography.cull-filter (item 4)", () => {
  it("filters by rating comparator, flag and colour label", () => {
    const p1 = importPhoto(ctxA);
    const p2 = importPhoto(ctxA);
    call("photo-rate", ctxA, { id: p1.id, rating: 5 });
    call("photo-rate", ctxA, { id: p2.id, rating: 2 });
    call("photo-flag", ctxA, { id: p1.id, flag: "pick" });
    call("photo-color-label", ctxA, { id: p1.id, colorLabel: "green" });
    const hi = call("cull-filter", ctxA, { rating: 4, ratingCompare: "gte" });
    assert.equal(hi.result.count, 1);
    const picks = call("cull-filter", ctxA, { flag: ["pick"] });
    assert.equal(picks.result.count, 1);
    const green = call("cull-filter", ctxA, { colorLabels: ["green"] });
    assert.equal(green.result.count, 1);
  });
});

describe("photography.smart collections + face tags (item 5)", () => {
  it("face-tag-add surfaces a person as a keyword + face-tag-list counts", () => {
    const p1 = importPhoto(ctxA);
    const p2 = importPhoto(ctxA);
    call("face-tag-add", ctxA, { photoId: p1.id, personName: "Ada" });
    call("face-tag-add", ctxA, { photoId: p2.id, personName: "Ada" });
    const people = call("face-tag-list", ctxA, {});
    assert.equal(people.result.people[0].personName, "Ada");
    assert.equal(people.result.people[0].count, 2);
    assert.ok(call("photo-detail", ctxA, { id: p1.id }).result.photo.keywords.includes("ada"));
  });

  it("smart-collection create / list / eval / delete", () => {
    const p1 = importPhoto(ctxA);
    importPhoto(ctxA);
    call("photo-rate", ctxA, { id: p1.id, rating: 5 });
    const coll = call("smart-collection-create", ctxA, {
      name: "Five star", rules: [{ field: "rating", op: "gte", value: 5 }],
    });
    assert.equal(coll.ok, true);
    assert.equal(call("smart-collection-list", ctxA, {}).result.collections[0].matchCount, 1);
    const ev = call("smart-collection-eval", ctxA, { id: coll.result.collection.id });
    assert.equal(ev.result.count, 1);
    assert.equal(call("smart-collection-delete", ctxA, { id: coll.result.collection.id }).ok, true);
    assert.equal(call("smart-collection-list", ctxA, {}).result.count, 0);
  });

  it("smart-collection-create rejects an empty rule set", () => {
    assert.equal(call("smart-collection-create", ctxA, { name: "X", rules: [] }).ok, false);
  });
});

describe("photography.batch sync (item 6)", () => {
  it("preset-apply-batch writes adjustments across many photos", () => {
    const p1 = importPhoto(ctxA);
    const p2 = importPhoto(ctxA);
    const preset = call("preset-create", ctxA, { name: "Punch", adjustments: { contrast: 40 } }).result.preset;
    const r = call("preset-apply-batch", ctxA, { presetId: preset.id, photoIds: [p1.id, p2.id, "missing"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.applied, 2);
    assert.equal(r.result.missed.length, 1);
    assert.equal(call("photo-detail", ctxA, { id: p2.id }).result.photo.develop.contrast, 40);
  });

  it("develop-copy-paste copies settings from a source photo", () => {
    const src = importPhoto(ctxA);
    const dst = importPhoto(ctxA);
    call("develop-set", ctxA, { id: src.id, adjustments: { clarity: 25 } });
    const r = call("develop-copy-paste", ctxA, { sourceId: src.id, targetIds: [dst.id] });
    assert.equal(r.result.applied, 1);
    assert.equal(call("photo-detail", ctxA, { id: dst.id }).result.photo.develop.clarity, 25);
  });
});

describe("photography.lens correction + geometry (item 7)", () => {
  it("lens-correction-set clamps to real ranges", () => {
    const photo = importPhoto(ctxA);
    const r = call("lens-correction-set", ctxA, {
      id: photo.id, distortion: 999, vignette: -40, chromaticAberration: 50,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.lensCorrection.distortion, 100);
    assert.equal(r.result.lensCorrection.vignette, -40);
  });

  it("geometry-set stores crop, rotation and perspective", () => {
    const photo = importPhoto(ctxA);
    const r = call("geometry-set", ctxA, {
      id: photo.id, rotation: 12, straighten: 3, verticalPerspective: 20,
      aspectRatio: "16:9", flipHorizontal: true, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.geometry.rotation, 12);
    assert.equal(r.result.geometry.aspectRatio, "16:9");
    assert.equal(r.result.geometry.flipHorizontal, true);
    assert.equal(r.result.geometry.crop.w, 0.8);
  });
});
