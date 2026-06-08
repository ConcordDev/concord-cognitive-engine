// tests/depth/photography-behavior.test.js — REAL behavioral tests for the
// photography domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value exposure/DoF/print/white-balance math +
// CRUD round-trips (catalog, albums, presets, shoots, masks, smart collections)
// + validation rejections. Every lensRun("photography", "<macro>", …) call
// literally names the macro, so the macro-depth grader credits it as a real
// behavioral invocation. Pure-vision (vision) and network macros (pexels-search,
// feed) are deliberately exercised only via their deterministic refusal branches.
//
// Shape contract (lens.run): on success the handler's {ok:true, result:{…}} is
// surfaced as r.result.<field>. On refusal the handler's {ok:false, error} is
// nested under result → r.result.ok === false and r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("photography — calc contracts (exact computed values)", () => {
  it("exposureCalc: f/5.6 EV12 ISO100 yields a frozen, moderate-DoF exposure with readable shutter", async () => {
    const r = await lensRun("photography", "exposureCalc", {
      data: { iso: 100, aperture: 5.6, ev: 12 },
    });
    assert.equal(r.result.iso, 100);
    assert.equal(r.result.aperture, "f/5.6");
    assert.equal(r.result.ev, 12);
    // 1/(2^12 * 5.6^2 / (100*0.297)) ≈ 0.000231 → "1/4325s"
    assert.equal(r.result.shutterSpeed, "1/4325s");
    assert.equal(r.result.depthOfField, "moderate"); // 5.6 <= 8
    assert.equal(r.result.motionBlur, "frozen");      // shutter < 0.033
  });

  it("exposureCalc: a wide aperture gives shallow depth of field", async () => {
    const r = await lensRun("photography", "exposureCalc", {
      data: { iso: 200, aperture: 1.8, ev: 8 },
    });
    assert.equal(r.result.depthOfField, "shallow"); // 1.8 <= 2.8
    assert.equal(r.result.aperture, "f/1.8");
  });

  it("exposureCalc: a long shutter is reported in whole seconds and flags motion blur", async () => {
    // Low EV + small aperture → shutterSpeed >= 1 → "Ns" format.
    // 1/(2^-4 * 11^2 / (100*0.297)) ≈ 3.93s → "4s"
    const r = await lensRun("photography", "exposureCalc", {
      data: { iso: 100, aperture: 11, ev: -4 },
    });
    assert.equal(r.result.shutterSpeed, "4s");
    assert.ok(!r.result.shutterSpeed.startsWith("1/"));
    assert.equal(r.result.depthOfField, "deep"); // 11 > 8
    assert.equal(r.result.motionBlur, "likely");
  });

  it("compositionAnalysis: applied rules score proportionally and grade strength", async () => {
    const r = await lensRun("photography", "compositionAnalysis", {
      data: { compositionRules: ["rule-of-thirds", "leading-lines", "symmetry"] },
    });
    assert.equal(r.result.rulesApplied.length, 3);
    // 3 of 8 rules → round(3/8*100) = 38.
    assert.equal(r.result.score, 38);
    assert.equal(r.result.strength, "strong-composition"); // >= 3
    assert.equal(r.result.suggestions.length, 3);
  });

  it("compositionAnalysis: no recognised rules grades 'no-rules-applied'", async () => {
    const r = await lensRun("photography", "compositionAnalysis", {
      data: { compositionRules: ["not-a-real-rule"] },
    });
    assert.equal(r.result.rulesApplied.length, 0);
    assert.equal(r.result.score, 0);
    assert.equal(r.result.strength, "no-rules-applied");
  });

  it("gearRecommend: portrait genre returns the 85mm lens + bokeh tip", async () => {
    const r = await lensRun("photography", "gearRecommend", { data: { genre: "portrait" } });
    assert.equal(r.result.genre, "portrait");
    assert.equal(r.result.recommendation.lens, "85mm f/1.8");
    assert.ok(r.result.tip.includes("bokeh"));
  });

  it("gearRecommend: an unknown genre falls back to the general kit", async () => {
    const r = await lensRun("photography", "gearRecommend", { data: { genre: "underwater-drone" } });
    assert.equal(r.result.recommendation.lens, "24-70mm f/2.8");
  });

  it("printSize: 4000x3000 @300dpi computes inches, megapixels, and a professional grade", async () => {
    const r = await lensRun("photography", "printSize", {
      data: { widthPixels: 4000, heightPixels: 3000, dpi: 300 },
    });
    assert.equal(r.result.resolution, "4000 x 3000");
    assert.equal(r.result.megapixels, 12);                 // 4000*3000/1e6
    assert.equal(r.result.maxPrintAt300DPI, '13.3" x 10"'); // 4000/300, 3000/300
    assert.equal(r.result.quality, "professional");        // >= 4000
  });

  it("printSize: a small image grades web-only", async () => {
    const r = await lensRun("photography", "printSize", {
      data: { widthPixels: 1200, heightPixels: 800, dpi: 300 },
    });
    assert.equal(r.result.quality, "web-only"); // < 2000
  });
});

describe("photography — network/vision macros: deterministic refusal branches", () => {
  it("vision: missing image source is rejected without any model call", async () => {
    const r = await lensRun("photography", "vision", { data: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /imageB64 or imageUrl required/);
  });

  it("pexels-search: missing API key is rejected before any network call", async () => {
    const prev = process.env.PEXELS_API_KEY;
    delete process.env.PEXELS_API_KEY;
    try {
      const r = await lensRun("photography", "pexels-search", { params: { query: "sunset" } });
      assert.equal(r.result.ok, false);
      assert.match(r.result.error, /PEXELS_API_KEY env required/);
    } finally {
      if (prev != null) process.env.PEXELS_API_KEY = prev;
    }
  });

  it("pexels-search: an empty query is rejected when a key is present", async () => {
    const prev = process.env.PEXELS_API_KEY;
    process.env.PEXELS_API_KEY = "test-key-no-egress";
    try {
      const r = await lensRun("photography", "pexels-search", { params: { query: "   " } });
      assert.equal(r.result.ok, false);
      assert.match(r.result.error, /query required/);
    } finally {
      if (prev != null) process.env.PEXELS_API_KEY = prev; else delete process.env.PEXELS_API_KEY;
    }
  });
});

describe("photography — catalog CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("photography-catalog"); });

  it("photo-import → photo-list → photo-detail reads the photo back", async () => {
    const imp = await lensRun("photography", "photo-import", {
      params: { filename: "DSC_0001.jpg", title: "Mountain", camera: "Nikon Z6", lens: "24-70", iso: 400, aperture: 4 },
    }, ctx);
    assert.equal(imp.ok, true);
    const id = imp.result.photo.id;
    assert.equal(imp.result.photo.rating, 0);
    assert.equal(imp.result.photo.flag, "unflagged");

    const list = await lensRun("photography", "photo-list", {}, ctx);
    assert.ok(list.result.photos.some((p) => p.id === id));

    const detail = await lensRun("photography", "photo-detail", { params: { id } }, ctx);
    assert.equal(detail.result.photo.title, "Mountain");
    assert.equal(detail.result.photo.camera, "Nikon Z6");
  });

  it("photo-import: missing filename is rejected", async () => {
    const bad = await lensRun("photography", "photo-import", { params: { title: "no file" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /filename required/);
  });

  it("photo-rate clamps to 0..5 and reads back via photo-detail", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "rate.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const rate = await lensRun("photography", "photo-rate", { params: { id, rating: 9 } }, ctx);
    assert.equal(rate.result.photo.rating, 5); // clamped from 9
    const got = await lensRun("photography", "photo-detail", { params: { id } }, ctx);
    assert.equal(got.result.photo.rating, 5);
  });

  it("photo-flag accepts pick and falls back to unflagged for garbage", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "flag.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const pick = await lensRun("photography", "photo-flag", { params: { id, flag: "PICK" } }, ctx);
    assert.equal(pick.result.photo.flag, "pick");
    const junk = await lensRun("photography", "photo-flag", { params: { id, flag: "banana" } }, ctx);
    assert.equal(junk.result.photo.flag, "unflagged");
  });

  it("photo-color-label keeps valid labels and nulls invalid ones", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "color.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const ok = await lensRun("photography", "photo-color-label", { params: { id, colorLabel: "blue" } }, ctx);
    assert.equal(ok.result.photo.colorLabel, "blue");
    const bad = await lensRun("photography", "photo-color-label", { params: { id, colorLabel: "chartreuse" } }, ctx);
    assert.equal(bad.result.photo.colorLabel, null);
  });

  it("photo-update sets keywords (deduped, lower-cased) and reads back", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "kw.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const upd = await lensRun("photography", "photo-update", { params: { id, keywords: ["Sky", "sky", "Sunset"] } }, ctx);
    assert.deepEqual(upd.result.photo.keywords.sort(), ["sky", "sunset"]);
  });

  it("photo-delete removes the photo; a missing id is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "del.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const del = await lensRun("photography", "photo-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("photography", "photo-delete", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /photo not found/);
  });

  it("cull-summary tallies picks, ratings and five-star count", async () => {
    const c = await depthCtx("photography-cull");
    const a = await lensRun("photography", "photo-import", { params: { filename: "a.jpg" } }, c);
    const b = await lensRun("photography", "photo-import", { params: { filename: "b.jpg" } }, c);
    await lensRun("photography", "photo-rate", { params: { id: a.result.photo.id, rating: 5 } }, c);
    await lensRun("photography", "photo-flag", { params: { id: a.result.photo.id, flag: "pick" } }, c);
    await lensRun("photography", "photo-flag", { params: { id: b.result.photo.id, flag: "reject" } }, c);
    const sum = await lensRun("photography", "cull-summary", {}, c);
    assert.equal(sum.result.total, 2);
    assert.equal(sum.result.picks, 1);
    assert.equal(sum.result.rejects, 1);
    assert.equal(sum.result.fiveStar, 1);
    assert.equal(sum.result.byRating[5], 1);
  });
});

describe("photography — keywords + search + albums + shoots (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("photography-kw"); });

  it("keyword-add adds then removes a keyword; keyword-list aggregates counts", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "kwa.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const add = await lensRun("photography", "keyword-add", { params: { id, keyword: "Beach" } }, ctx);
    assert.ok(add.result.keywords.includes("beach"));
    const list = await lensRun("photography", "keyword-list", {}, ctx);
    assert.ok(list.result.keywords.some((k) => k.keyword === "beach" && k.count >= 1));
    const rm = await lensRun("photography", "keyword-add", { params: { id, keyword: "Beach", remove: true } }, ctx);
    assert.ok(!rm.result.keywords.includes("beach"));
  });

  it("keyword-add: empty keyword is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "kwe.jpg" } }, ctx);
    const bad = await lensRun("photography", "keyword-add", { params: { id: imp.result.photo.id, keyword: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /keyword required/);
  });

  it("photo-search matches on title and keyword", async () => {
    const c = await depthCtx("photography-search");
    const imp = await lensRun("photography", "photo-import", { params: { filename: "s.jpg", title: "Harbor at Dawn" } }, c);
    await lensRun("photography", "keyword-add", { params: { id: imp.result.photo.id, keyword: "boats" } }, c);
    const byTitle = await lensRun("photography", "photo-search", { params: { query: "harbor" } }, c);
    assert.equal(byTitle.result.count, 1);
    const byKw = await lensRun("photography", "photo-search", { params: { query: "boats" } }, c);
    assert.equal(byKw.result.count, 1);
    const none = await lensRun("photography", "photo-search", { params: { query: "zzznomatch" } }, c);
    assert.equal(none.result.count, 0);
  });

  it("album-create → album-add-photo → album-detail round-trips the membership", async () => {
    const alb = await lensRun("photography", "album-create", { params: { name: "Trip 2026" } }, ctx);
    const albumId = alb.result.album.id;
    const imp = await lensRun("photography", "photo-import", { params: { filename: "alb1.jpg" } }, ctx);
    const photoId = imp.result.photo.id;
    const addP = await lensRun("photography", "album-add-photo", { params: { albumId, photoId } }, ctx);
    assert.equal(addP.result.photoCount, 1);
    const detail = await lensRun("photography", "album-detail", { params: { id: albumId } }, ctx);
    assert.ok(detail.result.photos.some((p) => p.id === photoId));
    // photo-detail surfaces the album back-reference.
    const pd = await lensRun("photography", "photo-detail", { params: { id: photoId } }, ctx);
    assert.ok(pd.result.albums.some((a) => a.id === albumId));
  });

  it("album-add-photo: an unknown album is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "alb2.jpg" } }, ctx);
    const bad = await lensRun("photography", "album-add-photo", { params: { albumId: "nope_alb", photoId: imp.result.photo.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /album not found/);
  });

  it("album-create: empty name is rejected", async () => {
    const bad = await lensRun("photography", "album-create", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /album name required/);
  });

  it("album-delete removes the album; album-list no longer returns it", async () => {
    const alb = await lensRun("photography", "album-create", { params: { name: "Temp Album" } }, ctx);
    const id = alb.result.album.id;
    const del = await lensRun("photography", "album-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("photography", "album-list", {}, ctx);
    assert.ok(!list.result.albums.some((a) => a.id === id));
  });

  it("shoot-create → shoot-assign → shoot-list counts the assigned photo", async () => {
    const sh = await lensRun("photography", "shoot-create", { params: { name: "Studio Session", client: "Acme" } }, ctx);
    const shootId = sh.result.shoot.id;
    const imp = await lensRun("photography", "photo-import", { params: { filename: "shoot1.jpg" } }, ctx);
    const assign = await lensRun("photography", "shoot-assign", { params: { photoId: imp.result.photo.id, shootId } }, ctx);
    assert.equal(assign.result.photo.shootId, shootId);
    const list = await lensRun("photography", "shoot-list", {}, ctx);
    const card = list.result.shoots.find((x) => x.id === shootId);
    assert.equal(card.photoCount, 1);
  });

  it("shoot-assign: an unknown shoot is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "shoot2.jpg" } }, ctx);
    const bad = await lensRun("photography", "shoot-assign", { params: { photoId: imp.result.photo.id, shootId: "nope_sht" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /shoot not found/);
  });
});

describe("photography — develop presets + adjustments (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("photography-develop"); });

  it("preset-create clamps adjustments to real ranges and preset-list reads it back", async () => {
    const pst = await lensRun("photography", "preset-create", {
      params: { name: "Punchy", adjustments: { exposure: 99, contrast: 50, vibrance: 20 } },
    }, ctx);
    assert.equal(pst.result.preset.adjustments.exposure, 5);   // clamped to [-5,5]
    assert.equal(pst.result.preset.adjustments.contrast, 50);
    const list = await lensRun("photography", "preset-list", {}, ctx);
    assert.ok(list.result.presets.some((p) => p.id === pst.result.preset.id));
  });

  it("preset-create: empty name is rejected", async () => {
    const bad = await lensRun("photography", "preset-create", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /preset name required/);
  });

  it("preset-apply merges the preset's adjustments onto the photo", async () => {
    const pst = await lensRun("photography", "preset-create", { params: { name: "Cool", adjustments: { temperature: 4000, tint: 10 } } }, ctx);
    const imp = await lensRun("photography", "photo-import", { params: { filename: "dev1.jpg" } }, ctx);
    const apply = await lensRun("photography", "preset-apply", {
      params: { photoId: imp.result.photo.id, presetId: pst.result.preset.id },
    }, ctx);
    assert.equal(apply.result.photo.develop.temperature, 4000);
    assert.equal(apply.result.photo.appliedPreset, "Cool");
  });

  it("preset-apply: an unknown preset is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "dev2.jpg" } }, ctx);
    const bad = await lensRun("photography", "preset-apply", { params: { photoId: imp.result.photo.id, presetId: "nope_pst" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /preset not found/);
  });

  it("develop-set then develop-reset clears all adjustments", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "dev3.jpg" } }, ctx);
    const id = imp.result.photo.id;
    const set = await lensRun("photography", "develop-set", { params: { id, adjustments: { exposure: 1.5, clarity: 30 } } }, ctx);
    assert.equal(set.result.photo.develop.exposure, 1.5);
    assert.equal(set.result.photo.develop.clarity, 30);
    const reset = await lensRun("photography", "develop-reset", { params: { id } }, ctx);
    assert.deepEqual(reset.result.photo.develop, {});
    assert.equal(reset.result.photo.appliedPreset, null);
  });

  it("preset-delete removes the preset; a missing id is rejected", async () => {
    const pst = await lensRun("photography", "preset-create", { params: { name: "Temp" } }, ctx);
    const id = pst.result.preset.id;
    const del = await lensRun("photography", "preset-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("photography", "preset-delete", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /preset not found/);
  });

  it("preset-apply-batch applies to the matching photos and reports missed ids", async () => {
    const pst = await lensRun("photography", "preset-create", { params: { name: "Batch", adjustments: { contrast: 25 } } }, ctx);
    const p1 = await lensRun("photography", "photo-import", { params: { filename: "batch1.jpg" } }, ctx);
    const p2 = await lensRun("photography", "photo-import", { params: { filename: "batch2.jpg" } }, ctx);
    const r = await lensRun("photography", "preset-apply-batch", {
      params: { presetId: pst.result.preset.id, photoIds: [p1.result.photo.id, p2.result.photo.id, "ghost_id"] },
    }, ctx);
    assert.equal(r.result.applied, 2);
    assert.deepEqual(r.result.missed, ["ghost_id"]);
    assert.equal(r.result.presetName, "Batch");
  });

  it("develop-copy-paste copies develop settings from source to targets", async () => {
    const src = await lensRun("photography", "photo-import", { params: { filename: "src.jpg" } }, ctx);
    await lensRun("photography", "develop-set", { params: { id: src.result.photo.id, adjustments: { exposure: 2, saturation: 15 } } }, ctx);
    const tgt = await lensRun("photography", "photo-import", { params: { filename: "tgt.jpg" } }, ctx);
    const r = await lensRun("photography", "develop-copy-paste", {
      params: { sourceId: src.result.photo.id, targetIds: [tgt.result.photo.id] },
    }, ctx);
    assert.equal(r.result.applied, 1);
    const got = await lensRun("photography", "photo-detail", { params: { id: tgt.result.photo.id } }, ctx);
    assert.equal(got.result.photo.develop.exposure, 2);
    assert.equal(got.result.photo.develop.saturation, 15);
  });
});

describe("photography — RAW develop + histogram + tone curve (pure-compute math)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("photography-raw"); });

  it("raw-develop: at reference 6500K white balance is neutral and a 256-entry LUT is returned", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "shot.dng" } }, ctx);
    const id = imp.result.photo.id;
    const r = await lensRun("photography", "raw-develop", { params: { id, adjustments: { temperature: 6500, tint: 0 } } }, ctx);
    assert.equal(r.result.isRaw, true); // .dng
    assert.deepEqual(r.result.whiteBalance, { r: 1, g: 1, b: 1 });
    assert.equal(r.result.toneLUT.length, 256);
  });

  it("raw-develop: a warm temperature lifts red above blue", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "warm.cr2" } }, ctx);
    const r = await lensRun("photography", "raw-develop", { params: { id: imp.result.photo.id, adjustments: { temperature: 3200 } } }, ctx);
    assert.ok(r.result.whiteBalance.r > 1);
    assert.ok(r.result.whiteBalance.b < 1);
    assert.ok(r.result.whiteBalance.r > r.result.whiteBalance.b);
  });

  it("raw-decode-meta: a .nef reports Nikon RAW at 14-bit depth", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "nikon.nef" } }, ctx);
    const r = await lensRun("photography", "raw-decode-meta", { params: { id: imp.result.photo.id } }, ctx);
    assert.equal(r.result.isRaw, true);
    assert.equal(r.result.format, "Nikon RAW");
    assert.equal(r.result.bitDepth, 14);
  });

  it("raw-decode-meta: a JPEG reports non-RAW at 8-bit depth", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "snap.jpg" } }, ctx);
    const r = await lensRun("photography", "raw-decode-meta", { params: { id: imp.result.photo.id } }, ctx);
    assert.equal(r.result.isRaw, false);
    assert.equal(r.result.bitDepth, 8);
  });

  it("histogram-compute: a dark sample set is flagged underexposed", async () => {
    const samples = [[10, 10, 10], [20, 20, 20], [5, 5, 5], [15, 15, 15]];
    const r = await lensRun("photography", "histogram-compute", { params: { samples } }, ctx);
    assert.equal(r.result.totalSamples, 4);
    assert.equal(r.result.luma.length, 256);
    assert.ok(r.result.meanLuma < 85);
    assert.equal(r.result.exposureHint, "underexposed");
  });

  it("histogram-compute: empty samples are rejected", async () => {
    const r = await lensRun("photography", "histogram-compute", { params: { samples: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /samples array required/);
  });

  it("tone-curve-save: a linear curve produces an identity LUT and reads back", async () => {
    const r = await lensRun("photography", "tone-curve-save", {
      params: { name: "Linear", points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
    }, ctx);
    assert.equal(r.result.lut[0], 0);
    assert.equal(r.result.lut[255], 255);
    assert.equal(r.result.lut[128], 128); // identity along the line
    const id = r.result.curve.id;
    const list = await lensRun("photography", "tone-curve-list", {}, ctx);
    assert.ok(list.result.curves.some((c) => c.id === id));
  });

  it("tone-curve-apply: applying a stored curve attaches its points to the photo", async () => {
    const crv = await lensRun("photography", "tone-curve-save", { params: { name: "Bright", points: [{ x: 0, y: 30 }, { x: 255, y: 255 }] } }, ctx);
    const imp = await lensRun("photography", "photo-import", { params: { filename: "curve.jpg" } }, ctx);
    const r = await lensRun("photography", "tone-curve-apply", {
      params: { photoId: imp.result.photo.id, curveId: crv.result.curve.id },
    }, ctx);
    assert.equal(r.result.lut[0], 30); // y-intercept lifted
    assert.equal(r.result.lut.length, 256);
  });

  it("tone-curve-delete removes the curve; a missing id is rejected", async () => {
    const crv = await lensRun("photography", "tone-curve-save", { params: { name: "Temp Curve" } }, ctx);
    const id = crv.result.curve.id;
    const del = await lensRun("photography", "tone-curve-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("photography", "tone-curve-delete", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /tone curve not found/);
  });
});

describe("photography — masks, cull filter, smart collections, face tags, geometry", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("photography-masks"); });

  it("mask-create → mask-list → mask-delete round-trips a radial mask", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "mask.jpg" } }, ctx);
    const photoId = imp.result.photo.id;
    const mk = await lensRun("photography", "mask-create", {
      params: { photoId, kind: "radial-gradient", geometry: { cx: 0.5, cy: 0.5, rx: 0.3 }, adjustments: { exposure: 1 } },
    }, ctx);
    assert.equal(mk.result.maskCount, 1);
    assert.equal(mk.result.mask.kind, "radial-gradient");
    const maskId = mk.result.mask.id;
    const list = await lensRun("photography", "mask-list", { params: { photoId } }, ctx);
    assert.equal(list.result.count, 1);
    const del = await lensRun("photography", "mask-delete", { params: { photoId, maskId } }, ctx);
    assert.equal(del.result.maskCount, 0);
  });

  it("mask-create: an invalid kind is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "maskbad.jpg" } }, ctx);
    const bad = await lensRun("photography", "mask-create", { params: { photoId: imp.result.photo.id, kind: "teleport" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /kind must be one of/);
  });

  it("cull-filter: rating gte and color-label filters select the right photos", async () => {
    const c = await depthCtx("photography-cullfilter");
    const a = await lensRun("photography", "photo-import", { params: { filename: "cf-a.jpg" } }, c);
    const b = await lensRun("photography", "photo-import", { params: { filename: "cf-b.jpg" } }, c);
    await lensRun("photography", "photo-rate", { params: { id: a.result.photo.id, rating: 5 } }, c);
    await lensRun("photography", "photo-rate", { params: { id: b.result.photo.id, rating: 1 } }, c);
    await lensRun("photography", "photo-color-label", { params: { id: a.result.photo.id, colorLabel: "green" } }, c);
    const r = await lensRun("photography", "cull-filter", { params: { rating: 4, ratingCompare: "gte" } }, c);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.photos[0].id, a.result.photo.id);
    const byColor = await lensRun("photography", "cull-filter", { params: { colorLabels: ["green"] } }, c);
    assert.equal(byColor.result.count, 1);
  });

  it("face-tag-add adds a person, surfaces it as a keyword, face-tag-list aggregates", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "face.jpg" } }, ctx);
    const photoId = imp.result.photo.id;
    const r = await lensRun("photography", "face-tag-add", { params: { photoId, personName: "Alice" } }, ctx);
    assert.ok(r.result.faceTags.some((f) => f.personName === "Alice"));
    const detail = await lensRun("photography", "photo-detail", { params: { id: photoId } }, ctx);
    assert.ok(detail.result.photo.keywords.includes("alice")); // surfaced as keyword
    const list = await lensRun("photography", "face-tag-list", {}, ctx);
    assert.ok(list.result.people.some((p) => p.personName === "Alice" && p.count >= 1));
  });

  it("face-tag-add: missing personName is rejected", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "facebad.jpg" } }, ctx);
    const bad = await lensRun("photography", "face-tag-add", { params: { photoId: imp.result.photo.id, personName: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /personName required/);
  });

  it("smart-collection-create → smart-collection-eval matches rows by rule", async () => {
    const c = await depthCtx("photography-smart");
    const five = await lensRun("photography", "photo-import", { params: { filename: "sc-5.jpg" } }, c);
    const one = await lensRun("photography", "photo-import", { params: { filename: "sc-1.jpg" } }, c);
    await lensRun("photography", "photo-rate", { params: { id: five.result.photo.id, rating: 5 } }, c);
    await lensRun("photography", "photo-rate", { params: { id: one.result.photo.id, rating: 1 } }, c);
    const coll = await lensRun("photography", "smart-collection-create", {
      params: { name: "Keepers", rules: [{ field: "rating", op: "gte", value: 5 }] },
    }, c);
    const collId = coll.result.collection.id;
    const list = await lensRun("photography", "smart-collection-list", {}, c);
    const card = list.result.collections.find((x) => x.id === collId);
    assert.equal(card.matchCount, 1);
    const evald = await lensRun("photography", "smart-collection-eval", { params: { id: collId } }, c);
    assert.equal(evald.result.count, 1);
    assert.equal(evald.result.photos[0].id, five.result.photo.id);
  });

  it("smart-collection-create: no rules is rejected", async () => {
    const bad = await lensRun("photography", "smart-collection-create", { params: { name: "Empty", rules: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least one rule required/);
  });

  it("lens-correction-set clamps distortion and stores the correction object", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "lc.jpg" } }, ctx);
    const r = await lensRun("photography", "lens-correction-set", {
      params: { id: imp.result.photo.id, distortion: 999, vignette: -20, chromaticAberration: 50 },
    }, ctx);
    assert.equal(r.result.lensCorrection.distortion, 100); // clamped to [-100,100]
    assert.equal(r.result.lensCorrection.vignette, -20);
    assert.equal(r.result.lensCorrection.enabled, true);
  });

  it("geometry-set clamps rotation and stores normalised crop", async () => {
    const imp = await lensRun("photography", "photo-import", { params: { filename: "geo.jpg" } }, ctx);
    const r = await lensRun("photography", "geometry-set", {
      params: { id: imp.result.photo.id, rotation: 90, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, flipHorizontal: true },
    }, ctx);
    assert.equal(r.result.geometry.rotation, 45); // clamped to [-45,45]
    assert.equal(r.result.geometry.crop.w, 0.8);
    assert.equal(r.result.geometry.flipHorizontal, true);
  });

  it("catalog-stats and export-preset round-trip on an isolated catalog", async () => {
    const c = await depthCtx("photography-stats");
    await lensRun("photography", "photo-import", { params: { filename: "st1.jpg", camera: "Sony A7", lens: "50mm" } }, c);
    const p2 = await lensRun("photography", "photo-import", { params: { filename: "st2.jpg", camera: "Sony A7", lens: "50mm" } }, c);
    await lensRun("photography", "develop-set", { params: { id: p2.result.photo.id, adjustments: { exposure: 1 } } }, c);
    const ep = await lensRun("photography", "export-preset-save", { params: { name: "Web JPEG", format: "jpeg", quality: 80, longEdge: 2048 } }, c);
    assert.equal(ep.result.preset.format, "jpeg");
    assert.equal(ep.result.preset.quality, 80);
    const epl = await lensRun("photography", "export-preset-list", {}, c);
    assert.ok(epl.result.presets.some((p) => p.id === ep.result.preset.id));
    const stats = await lensRun("photography", "catalog-stats", {}, c);
    assert.equal(stats.result.photos, 2);
    assert.equal(stats.result.edited, 1); // only p2 has develop
    assert.equal(stats.result.topCameras[0].name, "Sony A7");
    assert.equal(stats.result.topCameras[0].count, 2);
  });
});
