// Behavioral tests for the artistry project-image blob-storage macros
// (project-image-upload / -list / -download / -delete) and their wiring
// into projectCreate/projectUpdate's images[].url slot.
//
// Closes docs/WAVE4_INVENTORY.md line 101 / artistry-capability-map.md
// item 12: "No native image upload/blob-storage pipeline for project
// images (URL-only)". These macros are a structural clone of
// server/domains/travel.js's "Travel document binary attachments" trio
// (travel-doc-attachment-upload / -list / -download / -delete,
// ~travel.js:945-1016), NOT the misfiled apiHelpers.artistry.blobs DAW
// facility in server.js (~lines 73021-73145), which is a different,
// cross-lens audio-blob system this task deliberately does not touch.
//
// Covers: upload success + size/base64 validation, ownership isolation
// (another user can't download/delete your image), a byte-identical
// upload -> download round trip, and the artistry-img:<id> reference
// scheme's wiring into projectCreate/projectUpdate (accepted when it
// points at the caller's own upload, silently dropped otherwise — same
// as an empty/missing url already is) alongside plain external URLs.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtistryActions from "../../domains/artistry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`artistry.${name}`);
  assert.ok(fn, `artistry.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerArtistryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "artist_a" }, userId: "artist_a" };
const ctxB = { actor: { userId: "artist_b" }, userId: "artist_b" };

const SMALL_B64 = Buffer.from("hello concord artist", "utf8").toString("base64");

describe("artistry.project-image-upload", () => {
  it("uploads successfully, strips the data blob from the response, and returns a stable ref", () => {
    const r = call("project-image-upload", ctxA, { fileName: "sketch.png", mimeType: "image/png", data: SMALL_B64 });
    assert.equal(r.ok, true);
    assert.equal(r.result.image.fileName, "sketch.png");
    assert.equal(r.result.image.mimeType, "image/png");
    assert.ok(Number.isInteger(r.result.image.bytes) && r.result.image.bytes > 0);
    assert.equal("data" in r.result.image, false, "upload response must never carry the raw blob");
    assert.equal(r.result.image.ref, `artistry-img:${r.result.image.id}`);
  });

  it("accepts a data: URI prefix and strips it before validating", () => {
    const r = call("project-image-upload", ctxA, {
      fileName: "photo.jpg", mimeType: "image/jpeg", data: `data:image/jpeg;base64,${SMALL_B64}`,
    });
    assert.equal(r.ok, true);
  });

  it("defaults mimeType to application/octet-stream when omitted", () => {
    const r = call("project-image-upload", ctxA, { fileName: "scan.bin", data: SMALL_B64 });
    assert.equal(r.ok, true);
    assert.equal(r.result.image.mimeType, "application/octet-stream");
  });

  it("rejects a missing fileName", () => {
    const r = call("project-image-upload", ctxA, { data: SMALL_B64 });
    assert.equal(r.ok, false);
  });

  it("rejects missing file data", () => {
    const r = call("project-image-upload", ctxA, { fileName: "x.png" });
    assert.equal(r.ok, false);
    assert.match(r.error, /data/);
  });

  it("rejects malformed base64 (illegal charset) — honest failure, never a silent garbage store", () => {
    const r = call("project-image-upload", ctxA, { fileName: "evil.png", data: "not-valid-base64!!! <<script>>" });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64/);
    assert.equal(call("project-image-list", ctxA).result.count, 0);
  });

  it("rejects a file over the 8 MB cap", () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 65).toString("base64");
    const r = call("project-image-upload", ctxA, { fileName: "huge.png", data: big });
    assert.equal(r.ok, false);
    assert.match(r.error, /8 MB/);
    assert.equal(call("project-image-list", ctxA).result.count, 0);
  });

  it("accepts a file right at the boundary just under the cap", () => {
    const okSize = Buffer.alloc(Math.floor(7.9 * 1024 * 1024), 65).toString("base64");
    const r = call("project-image-upload", ctxA, { fileName: "ok.png", data: okSize });
    assert.equal(r.ok, true);
  });
});

describe("artistry.project-image-list", () => {
  it("lists metadata only, scoped to the caller", () => {
    call("project-image-upload", ctxA, { fileName: "a.png", data: SMALL_B64 });
    call("project-image-upload", ctxA, { fileName: "b.png", data: SMALL_B64 });
    call("project-image-upload", ctxB, { fileName: "c.png", data: SMALL_B64 });

    const listA = call("project-image-list", ctxA);
    assert.equal(listA.ok, true);
    assert.equal(listA.result.count, 2);
    assert.deepEqual(listA.result.images.map((i) => i.fileName).sort(), ["a.png", "b.png"]);
    assert.ok(listA.result.images.every((i) => !("data" in i)));

    const listB = call("project-image-list", ctxB);
    assert.equal(listB.result.count, 1);
  });
});

describe("artistry.project-image-download — round trip + ownership isolation", () => {
  it("downloads byte-identical data to what was uploaded", () => {
    const up = call("project-image-upload", ctxA, { fileName: "cover.png", mimeType: "image/png", data: SMALL_B64 });
    const dl = call("project-image-download", ctxA, { id: up.result.image.id });
    assert.equal(dl.ok, true);
    assert.equal(dl.result.fileName, "cover.png");
    assert.equal(dl.result.mimeType, "image/png");
    const original = Buffer.from(SMALL_B64, "base64");
    const roundTripped = Buffer.from(dl.result.data, "base64");
    assert.ok(original.equals(roundTripped), "downloaded bytes must exactly match the uploaded bytes");
  });

  it("also accepts the full artistry-img:<id> reference string, not just the bare id", () => {
    const up = call("project-image-upload", ctxA, { fileName: "cover.png", data: SMALL_B64 });
    const dl = call("project-image-download", ctxA, { id: up.result.image.ref });
    assert.equal(dl.ok, true);
    assert.equal(dl.result.fileName, "cover.png");
  });

  it("rejects downloading an unknown image id", () => {
    const r = call("project-image-download", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
  });

  it("a different user cannot download another user's image", () => {
    const up = call("project-image-upload", ctxA, { fileName: "secret.png", data: SMALL_B64 });
    const r = call("project-image-download", ctxB, { id: up.result.image.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("a different user cannot delete another user's image, owner can", () => {
    const up = call("project-image-upload", ctxA, { fileName: "secret.png", data: SMALL_B64 });
    const imgId = up.result.image.id;

    const foreignDelete = call("project-image-delete", ctxB, { id: imgId });
    assert.equal(foreignDelete.ok, false);
    assert.equal(call("project-image-download", ctxA, { id: imgId }).ok, true);

    const ownerDelete = call("project-image-delete", ctxA, { id: imgId });
    assert.equal(ownerDelete.ok, true);
    assert.equal(call("project-image-download", ctxA, { id: imgId }).ok, false);
    assert.equal(call("project-image-list", ctxA).result.count, 0);
  });
});

describe("artistry-img: reference wiring into projectCreate / projectUpdate", () => {
  it("projectCreate accepts an artistry-img: ref the caller owns, alongside a plain external URL", () => {
    const up = call("project-image-upload", ctxA, { fileName: "hero.png", data: SMALL_B64 });
    const ref = up.result.image.ref;
    const r = call("projectCreate", ctxA, {
      title: "Native Upload Demo",
      images: [
        { url: ref, caption: "uploaded" },
        { url: "https://example.com/external.png", caption: "external" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.images.length, 2);
    assert.equal(r.result.project.images[0].url, ref);
    assert.equal(r.result.project.images[1].url, "https://example.com/external.png");
  });

  it("projectCreate silently drops an artistry-img: ref the caller does NOT own (not a fabricated success)", () => {
    const up = call("project-image-upload", ctxB, { fileName: "not-yours.png", data: SMALL_B64 });
    const foreignRef = up.result.image.ref;
    const r = call("projectCreate", ctxA, {
      title: "Should Drop Foreign Ref",
      images: [{ url: foreignRef, caption: "stolen" }, { url: "https://example.com/ok.png" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.images.length, 1);
    assert.equal(r.result.project.images[0].url, "https://example.com/ok.png");
  });

  it("projectCreate drops an artistry-img: ref that was never uploaded at all", () => {
    const r = call("projectCreate", ctxA, {
      title: "Bogus Ref",
      images: [{ url: "artistry-img:totally-made-up" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.images.length, 0);
  });

  it("projectUpdate accepts a newly uploaded ref when replacing images[]", () => {
    const created = call("projectCreate", ctxA, { title: "Editable", images: [] }).result.project;
    const up = call("project-image-upload", ctxA, { fileName: "revision.png", data: SMALL_B64 });
    const r = call("projectUpdate", ctxA, { projectId: created.id, images: [{ url: up.result.image.ref }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.images.length, 1);
    assert.equal(r.result.project.images[0].url, up.result.image.ref);
  });

  it("projectView resolves the download macro round trip end-to-end for an uploaded image reference", () => {
    const up = call("project-image-upload", ctxA, { fileName: "e2e.png", mimeType: "image/png", data: SMALL_B64 });
    const created = call("projectCreate", ctxA, { title: "E2E", images: [{ url: up.result.image.ref }] }).result.project;
    const view = call("projectView", ctxA, { projectId: created.id });
    assert.equal(view.ok, true);
    const ref = view.result.project.images[0].url;
    assert.equal(ref, up.result.image.ref);
    const dl = call("project-image-download", ctxA, { id: ref });
    assert.equal(dl.ok, true);
    assert.ok(Buffer.from(SMALL_B64, "base64").equals(Buffer.from(dl.result.data, "base64")));
  });
});
