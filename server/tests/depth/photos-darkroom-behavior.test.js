// tests/depth/photos-darkroom-behavior.test.js — Photos as the Darkroom.
// A real photo file is imported as it is (camera facts read from its EXIF),
// culled with stars / flags / labels / keywords, edited with a develop recipe
// whose history and snapshots can be walked back, styled in bulk with presets
// and pasted settings, gathered into smart albums, exported through the same
// pipeline the editor previews with, and released free or sold in CC. Every
// path refuses another person's photo.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { importPhoto, view } from "../../lib/darkroom/store.js";
import { renderPhoto, shutdownRenderPool } from "../../lib/darkroom/render.js";
import { develop } from "../../lib/darkroom/develop.js";
import { releaseFile, canDownload, getRelease } from "../../lib/darkroom/releases.js";
import { deletePhoto } from "../../lib/photo-gallery.js";

let STATE;
const run = (a, p, ctx) => lensRun("photos", a, { params: p }, ctx);
const wallet = (id) => getBalance(STATE.db, id).balance;

async function cameraJpeg({ w = 640, h = 420, make = "Fujifilm", model = "X-T5", iso = "400", gps = true } = {}) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = (x * 255) / w; raw[i + 1] = (y * 255) / h; raw[i + 2] = 110; }
  const exif = { IFD0: { Make: make, Model: model }, IFD2: { ExposureTime: "1/125", FNumber: "28/10", ISOSpeedRatings: iso, DateTimeOriginal: "2026:09:14 18:22:05", FocalLength: "23/1", LensModel: "XF23mmF2" } };
  if (gps) exif.IFD3 = { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 3/1" };
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).withExif(exif).toBuffer();
}
async function imported(userId, opts = {}, filename = "DSCF0412.JPG") {
  const r = await importPhoto(STATE.db, userId, await cameraJpeg(opts), { filename });
  assert.equal(r.ok, true, r.error);
  return r.photo;
}

before(async () => { ({ STATE } = await load()); });
after(async () => { await shutdownRenderPool(); });

describe("importing a photo", () => {
  it("keeps the file as it is and reads the camera facts", async () => {
    const p = await imported("dr-ada");
    assert.deepEqual([p.width, p.height, p.camera, p.lens, p.exif.iso, p.exif.fNumber, p.source, p.caption], [640, 420, "Fujifilm X-T5", "XF23mmF2", 400, 2.8, "import", "DSCF0412"]);
    assert.equal(p.capturedAt, Date.UTC(2026, 8, 14, 18, 22, 5) / 1000);
    const row = STATE.db.prepare("SELECT * FROM user_photos WHERE id = ?").get(p.id);
    assert.ok(fs.existsSync(row.preview_path) && fs.existsSync(row.thumb_path));
    assert.equal(row.visibility, "private");
  });
  it("refuses what it can't read, and says why", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    assert.match((await importPhoto(STATE.db, "dr-ada", heic)).error, /HEIC/);
    assert.match((await importPhoto(STATE.db, "dr-ada", Buffer.from("this is a text file pretending to be a photo"))).error, /isn't a photo/);
    assert.match((await importPhoto(STATE.db, "dr-ada", Buffer.alloc(41 * 1024 * 1024, 1))).error, /limit is 40 MB/);
    assert.match((await importPhoto(STATE.db, null, await cameraJpeg())).error, /sign in/);
  });
});

describe("culling the library", () => {
  let ada, ben, a1, a2, a3;
  before(async () => {
    ada = await depthCtx("dr-cull-ada"); ben = await depthCtx("dr-cull-ben");
    a1 = await imported("dr-cull-ada", {}, "harbour.jpg");
    a2 = await imported("dr-cull-ada", { make: "Canon", model: "EOS R6" }, "market.jpg");
    a3 = await imported("dr-cull-ada", {}, "dunes.jpg");
  });
  it("rates, flags, labels and keywords one photo or many at once", async () => {
    let r = await run("catalog-set", { ids: [a1.id, a2.id], rating: 4, flag: "pick" }, ada);
    assert.equal(r.ok, true, r.error);
    r = await run("catalog-set", { id: a3.id, flag: "reject", label: "red", addTags: ["Dunes", "sand"] }, ada);
    assert.deepEqual([r.result.photos[0].flag, r.result.photos[0].label, r.result.photos[0].tags], ["reject", "red", ["dunes", "sand"]]);
    r = await run("catalog-set", { id: a3.id, removeTags: ["sand"] }, ada);
    assert.deepEqual(r.result.photos[0].tags, ["dunes"]);
  });
  it("filters the way a photographer culls", async () => {
    const lib = async (filter, sort) => (await run("library", { filter, sort }, ada)).result;
    assert.deepEqual((await lib({ minRating: 4 })).photos.map((p) => p.caption).sort(), ["harbour", "market"]);
    assert.deepEqual((await lib({ flag: "reject" })).photos.map((p) => p.caption), ["dunes"]);
    assert.deepEqual((await lib({ camera: "canon" })).photos.map((p) => p.caption), ["market"]);
    assert.deepEqual((await lib({ keyword: "dunes" })).photos.map((p) => p.caption), ["dunes"]);
    assert.deepEqual((await lib({}, "name")).photos.map((p) => p.caption), ["dunes", "harbour", "market"]);
    const f = (await lib({})).facets;
    assert.deepEqual([f.total, f.picks, f.rejects, f.labels.red, f.cameras["Canon EOS R6"]], [3, 2, 1, 1, 1]);
  });
  it("refuses bad values and another person's photos", async () => {
    assert.match((await run("catalog-set", { id: a1.id, rating: 6 }, ada)).error, /0 to 5/);
    assert.match((await run("catalog-set", { id: a1.id, flag: "maybe" }, ada)).error, /pick, reject or none/);
    assert.match((await run("catalog-set", { id: a1.id, rating: 1 }, ben)).error, /photo not found/);
    assert.match((await run("catalog-set", { ids: [a1.id, "ph_nope"], rating: 1 }, ada)).error, /photo not found/);
    assert.equal((await run("library", {}, ben)).result.total, 0);
    assert.match((await run("photo", { id: a1.id }, ben)).error, /photo not found/);
    assert.equal(STATE.db.prepare("SELECT rating FROM user_photos WHERE id = ?").get(a1.id).rating, 4);
  });
});

describe("developing", () => {
  let ada, ben, photo;
  before(async () => { ada = await depthCtx("dr-dev-ada"); ben = await depthCtx("dr-dev-ben"); photo = await imported("dr-dev-ada"); });

  it("saves a recipe, never the pixels, and keeps a history to walk back through", async () => {
    const before = fs.readFileSync(STATE.db.prepare("SELECT blob_path FROM user_photos WHERE id = ?").get(photo.id).blob_path);
    let r = await run("edit-save", { id: photo.id, edit: { basic: { exposure: 0.7 } }, label: "Exposure +0.70" }, ada);
    assert.equal(r.ok, true, r.error); assert.equal(r.result.edited, true);
    r = await run("edit-save", { id: photo.id, edit: { basic: { exposure: 0.7, contrast: 25 } }, label: "Contrast +25" }, ada);
    const snap = await run("snapshot-create", { id: photo.id, name: "Warm version" }, ada);
    assert.equal(snap.ok, true, snap.error);
    r = await run("edit-save", { id: photo.id, edit: { basic: { exposure: 99 } }, label: "Exposure huge" }, ada);
    assert.equal(r.result.edit.basic.exposure, 5, "clamped, not trusted");
    let detail = (await run("photo", { id: photo.id }, ada)).result;
    assert.deepEqual(detail.history.slice(0, 4).map((h) => [h.label, h.snapshot]), [["Exposure huge", false], ["Warm version", true], ["Contrast +25", false], ["Exposure +0.70", false]]);
    r = await run("edit-revert", { id: photo.id, historyId: detail.history.find((h) => h.label === "Warm version").id }, ada);
    assert.deepEqual([r.result.edit.basic.exposure, r.result.edit.basic.contrast], [0.7, 25]);
    detail = (await run("photo", { id: photo.id }, ada)).result;
    assert.equal(detail.history[0].label, "Back to: Warm version");
    assert.ok(fs.readFileSync(STATE.db.prepare("SELECT blob_path FROM user_photos WHERE id = ?").get(photo.id).blob_path).equals(before), "the original is never rewritten");
  });
  it("resetting to nothing marks it unedited", async () => {
    const r = await run("edit-save", { id: photo.id, edit: {}, label: "Reset" }, ada);
    assert.equal(r.result.edited, false);
    assert.equal((await run("library", { filter: { edited: true } }, ada)).result.total, 0);
  });
  it("another person can't edit, snapshot or revert it", async () => {
    assert.match((await run("edit-save", { id: photo.id, edit: { basic: { exposure: 1 } } }, ben)).error, /photo not found/);
    assert.match((await run("snapshot-create", { id: photo.id, name: "mine now" }, ben)).error, /photo not found/);
    const hid = STATE.db.prepare("SELECT id FROM photo_edit_history WHERE photo_id = ? LIMIT 1").get(photo.id).id;
    assert.match((await run("edit-revert", { id: photo.id, historyId: hid }, ben)).error, /photo not found/);
    assert.match((await run("edit-save", { id: photo.id, edit: { masks: Array(9000).fill({ kind: "brush", brush: { strokes: [{ pts: Array(50).fill([0.5, 0.5]) }] } }) } }, ada)).error, /too large/);
  });
});

describe("presets and pasted settings", () => {
  let ada, ben, a, b, c;
  before(async () => {
    ada = await depthCtx("dr-pre-ada"); ben = await depthCtx("dr-pre-ben");
    a = await imported("dr-pre-ada"); b = await imported("dr-pre-ada"); c = await imported("dr-pre-ada");
    await run("edit-save", { id: a.id, edit: { basic: { exposure: 0.5, vibrance: 30 }, geometry: { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, spots: [{ x: 0.4, y: 0.4, r: 0.02, sx: 0.5, sy: 0.4 }] } }, ada);
  });
  it("a preset is the look only: never the crop or the retouching", async () => {
    const r = await run("preset-create", { name: "Golden hour", edit: (await run("photo", { id: a.id }, ada)).result.edit }, ada);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.result.preset.edit.basic.exposure, r.result.preset.edit.geometry.crop.w, r.result.preset.edit.spots.length], [0.5, 1, 0]);
    assert.match((await run("preset-create", { name: "Nothing", edit: {} }, ada)).error, /change nothing/);
    const applied = await run("preset-apply", { ids: [b.id, c.id], presetId: r.result.preset.id }, ada);
    assert.equal(applied.result.applied, 2);
    const eb = (await run("photo", { id: b.id }, ada)).result;
    assert.deepEqual([eb.edit.basic.vibrance, eb.history[0].label], [30, "Preset: Golden hour"]);
    assert.equal((await run("preset-list", {}, ben)).result.presets.length, 0);
    assert.match((await run("preset-apply", { ids: [b.id], presetId: r.result.preset.id }, ben)).error, /preset not found/);
    assert.match((await run("preset-delete", { id: r.result.preset.id }, ben)).error, /preset not found/);
  });
  it("pastes just the parts you choose from one photo onto others", async () => {
    const r = await run("settings-paste", { ids: [c.id], fromPhotoId: a.id, parts: ["geometry"] }, ada);
    assert.equal(r.ok, true, r.error);
    const ec = (await run("photo", { id: c.id }, ada)).result.edit;
    assert.deepEqual([ec.geometry.crop.w, ec.basic.vibrance], [0.5, 30]);
    const theirs = await imported("dr-pre-ben");
    assert.match((await run("settings-paste", { ids: [c.id], fromPhotoId: theirs.id }, ada)).error, /photo not found/);
    assert.match((await run("settings-paste", { ids: [theirs.id], fromPhotoId: a.id }, ada)).error, /photo not found/);
  });
});

describe("smart albums", () => {
  it("are a saved filter that keeps itself up to date", async () => {
    const ada = await depthCtx("dr-alb-ada");
    const p1 = await imported("dr-alb-ada"); await imported("dr-alb-ada");
    await run("catalog-set", { id: p1.id, rating: 5 }, ada);
    const made = await run("album-smart-create", { name: "Five stars", rule: { minRating: 5 } }, ada);
    assert.equal(made.ok, true, made.error);
    assert.match((await run("album-smart-create", { name: "Empty", rule: { junk: 1 } }, ada)).error, /at least one rule/);
    let open = await run("album-open", { albumId: made.result.album.id }, ada);
    assert.deepEqual(open.result.photos.map((p) => p.id), [p1.id]);
    const p3 = await imported("dr-alb-ada"); await run("catalog-set", { id: p3.id, rating: 5 }, ada);
    open = await run("album-open", { albumId: made.result.album.id }, ada);
    assert.equal(open.result.photos.length, 2);
    const idx = (await run("album-index", {}, ada)).result.albums.find((x) => x.id === made.result.album.id);
    assert.deepEqual([idx.smart, idx.count], [true, 2]);
    assert.match((await run("album-open", { albumId: made.result.album.id }, await depthCtx("dr-alb-ben"))).error, /album not found/);
  });
});

describe("exporting", () => {
  it("renders the original through the same pipeline the editor previews with", async () => {
    const p = await imported("dr-exp-ada");
    const row = STATE.db.prepare("SELECT * FROM user_photos WHERE id = ?").get(p.id);
    const edit = { basic: { exposure: 0.6, contrast: 20, temperature: 25, saturation: -15 }, geometry: { orient: 90, crop: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 } } };
    const out = await renderPhoto({ path: row.blob_path, edit, format: "png" });
    assert.equal(out.ok, true, out.error);
    const { data, info } = await sharp(row.blob_path).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const direct = develop({ data, width: info.width, height: info.height }, edit);
    const got = await sharp(out.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([got.info.width, got.info.height], [direct.width, direct.height]);
    let maxd = 0;
    for (let i = 0; i < got.data.length; i++) maxd = Math.max(maxd, Math.abs(got.data[i] - direct.data[i]));
    assert.equal(maxd, 0, "a lossless export is exactly the pipeline's pixels");
  });
  it("keeps the camera facts, and the location only when asked", async () => {
    const { exportExif } = await import("../../lib/darkroom/store.js");
    const { parseExif } = await import("../../lib/darkroom/exif.js");
    const p = await imported("dr-exp-ben");
    const row = STATE.db.prepare("SELECT * FROM user_photos WHERE id = ?").get(p.id);
    const read = async (o) => parseExif((await sharp((await renderPhoto({ path: row.blob_path, edit: {}, format: "jpeg", longEdge: 320, exif: exportExif(row, o) })).buf).metadata()).exif);
    const kept = await read({ keepExif: true, keepLocation: false });
    assert.deepEqual([kept.make, kept.model, kept.iso, kept.lens, kept.software, kept.gps], ["Fujifilm", "X-T5", 400, "XF23mmF2", "Concord Darkroom", undefined]);
    const located = await read({ keepExif: true, keepLocation: true });
    assert.ok(Math.abs(located.gps.lat - 48.856667) < 1e-4 && Math.abs(located.gps.lon - 2.350833) < 1e-4);
    const stripped = await read({ keepExif: false });
    assert.deepEqual([stripped.make, stripped.gps], [undefined, undefined]);
  });
});

describe("releasing and selling", () => {
  let maker, fan, other, photo, rel;
  before(async () => {
    maker = await depthCtx("dr-sell-maker"); fan = await depthCtx("dr-sell-fan"); other = await depthCtx("dr-sell-other");
    photo = await imported("dr-sell-maker");
    await run("edit-save", { id: photo.id, edit: { basic: { exposure: 0.3 }, geometry: { crop: { x: 0, y: 0, w: 0.5, h: 1 } } } }, maker);
  });
  it("validates the release, and freezes the edit at publish time", async () => {
    assert.match((await run("release-create", { photoId: photo.id, title: "x", priceCC: 0.1 }, maker)).error, /0\.5 to 1000/);
    assert.match((await run("release-create", { photoId: photo.id, title: "x", priceCC: 2, longEdge: 100 }, maker)).error, /640 to 16384/);
    assert.match((await run("release-create", { photoId: photo.id, title: "x", priceCC: 2 }, other)).error, /photo not found/);
    const r = await run("release-create", { photoId: photo.id, title: "Low tide", description: "Morning, after the storm.", priceCC: 3 }, maker);
    assert.equal(r.ok, true, r.error);
    rel = r.result.release;
    assert.deepEqual([rel.priceCC, rel.width, rel.height, rel.canDownload, rel.photographer.isMe], [3, 320, 420, true, true]);
    assert.match((await run("release-create", { photoId: photo.id, title: "again", priceCC: 3 }, maker)).error, /already released/);
    await run("edit-save", { id: photo.id, edit: { basic: { exposure: -2 } } }, maker);
    assert.equal(JSON.parse(getRelease(STATE.db, rel.id).edit_json).basic.exposure, 0.3, "later edits don't change what was sold");
  });
  it("shows everyone a watermarked proof; the full file goes only to buyers", async () => {
    const view_ = (await run("release-get", { id: rel.id }, other)).result.release;
    assert.deepEqual([view_.canDownload, view_.owned, view_.photoId], [false, false, undefined], "a stranger never sees the private photo id");
    const proof = await releaseFile(STATE.db, getRelease(STATE.db, rel.id), "proof");
    assert.equal(proof.ok, true, proof.error);
    const pm = await sharp(proof.file).metadata();
    assert.ok(Math.max(pm.width, pm.height) <= 1200);
    assert.equal(canDownload(STATE.db, getRelease(STATE.db, rel.id), "dr-sell-other"), false);
  });
  it("sells through the marketplace: the buyer pays, the photographer is paid, and the file is theirs", async () => {
    setLedgerBalance(STATE.db, "dr-sell-fan", 1);
    const poor = await run("release-buy", { id: rel.id }, fan);
    assert.match(poor.error, /not enough Concord Coin: this photo is 3 CC and you have 1 CC/);
    setLedgerBalance(STATE.db, "dr-sell-fan", 10); setLedgerBalance(STATE.db, "dr-sell-maker", 0);
    const r = await run("release-buy", { id: rel.id }, fan);
    assert.equal(r.ok, true, r.error);
    assert.equal(wallet("dr-sell-fan"), 7);
    assert.ok(wallet("dr-sell-maker") >= 2.85 - 1e-9, `maker got ${wallet("dr-sell-maker")}`);
    assert.deepEqual([r.result.release.owned, r.result.release.canDownload], [true, true]);
    assert.match((await run("release-buy", { id: rel.id }, fan)).error, /already in your library/);
    assert.match((await run("release-buy", { id: rel.id }, maker)).error, /your own photo/);
    const full = await releaseFile(STATE.db, getRelease(STATE.db, rel.id), "full");
    const fm = await sharp(full.file).metadata();
    assert.deepEqual([fm.width, fm.height], [320, 420]);
    assert.ok((await run("release-list", { owned: true }, fan)).result.releases.some((x) => x.id === rel.id));
  });
  it("withdrawing takes it off sale; buyers keep theirs; the photo can't be deleted out from under them", async () => {
    assert.equal(deletePhoto(STATE.db, "dr-sell-maker", photo.id).error, "release_live");
    assert.match((await run("release-withdraw", { id: rel.id }, other)).error, /photo not found/);
    const w = await run("release-withdraw", { id: rel.id }, maker);
    assert.equal(w.result.release.status, "withdrawn");
    assert.match((await run("release-get", { id: rel.id }, other)).error, /photo not found/);
    assert.equal((await run("release-get", { id: rel.id }, fan)).result.release.canDownload, true);
    assert.equal(deletePhoto(STATE.db, "dr-sell-maker", photo.id).error, "release_owned");
    assert.match((await run("release-buy", { id: rel.id }, other)).error, /photo not found/);
  });
  it("a free release is anyone's to download", async () => {
    const p = await imported("dr-sell-maker");
    const r = await run("release-create", { photoId: p.id, title: "Gift", priceCC: 0, longEdge: 640, format: "webp" }, maker);
    assert.equal(r.ok, true, r.error);
    assert.equal(canDownload(STATE.db, getRelease(STATE.db, r.result.release.id), null), true);
    assert.match((await run("release-buy", { id: r.result.release.id }, fan)).error, /free/);
    assert.match((await run("release-update", { id: r.result.release.id, priceCC: 5 }, maker)).error, /stays free/);
    const f = await releaseFile(STATE.db, getRelease(STATE.db, r.result.release.id), "full");
    assert.equal((await sharp(f.file).metadata()).format, "webp");
  });
});

describe("Concordia's photo mode still lands here", () => {
  it("an in-game capture shows up as from Concordia, gets previews, and can be developed", async () => {
    const { savePhoto } = await import("../../lib/photo-gallery.js");
    const png = await sharp({ create: { width: 160, height: 90, channels: 3, background: "#3a6" } }).png().toBuffer();
    const saved = await savePhoto(STATE.db, "dr-game", { worldId: "concordia-hub", dataUrl: `data:image/png;base64,${png.toString("base64")}` });
    assert.equal(saved.ok, true, saved.error);
    const ctx = await depthCtx("dr-game");
    const lib = (await run("library", { filter: { source: "concordia" } }, ctx)).result;
    assert.equal(lib.photos[0].id, saved.id);
    const { ensureDerivatives } = await import("../../lib/darkroom/store.js");
    const row = await ensureDerivatives(STATE.db, STATE.db.prepare("SELECT * FROM user_photos WHERE id = ?").get(saved.id));
    assert.ok(fs.existsSync(row.preview_path));
    assert.equal(view(STATE.db.prepare("SELECT * FROM user_photos WHERE id = ?").get(saved.id)).width, 160);
    assert.equal((await run("edit-save", { id: saved.id, edit: { basic: { exposure: 0.5 } } }, ctx)).ok, true);
  });
});
