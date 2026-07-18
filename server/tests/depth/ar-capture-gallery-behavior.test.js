// tests/depth/ar-capture-gallery-behavior.test.js
//
// Behavioral coverage for the AR capture gallery (Wave-4 gap closure,
// docs/lens-specs/ar-capability-map.md item 13 / docs/WAVE4_INVENTORY.md row
// 96 — "No AR capture/screenshot/recording gallery"). The client
// (SceneStudio's capture pipeline) posts a REAL `canvas.toDataURL()`
// screenshot or a REAL `canvas.captureStream()` + MediaRecorder video/webm
// recording as a base64 `data:` URL; these macros only validate + persist it
// — never fabricate placeholder capture data.
//
// lens.run unwraps a handler's {ok,result}: handler success {ok:true,result:X}
// surfaces as r.ok===true / r.result.X; a handler refusal {ok:false,error}
// (no `result` key) surfaces nested as r.result.ok===false / r.result.error.
//
// captureStore has no backing migration (no `ar_captures` table exists), so
// dbStore's try/catch always falls back to the in-memory per-user bucket —
// the same graceful-degrade path already proven for scenes/targets/publishes
// in tests/ar-scene-persistence.test.js's "falls back to in-memory" case.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

// A real, tiny, valid 1x1 transparent PNG (67 bytes decoded) — genuine image
// bytes, not a placeholder string standing in for pixel data.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

const MAX_CAPTURE_IMAGE_BYTES = 5 * 1024 * 1024; // mirrors server/domains/ar.js
const MAX_CAPTURE_VIDEO_BYTES = 25 * 1024 * 1024;

function bigDataUrl(mimeType, byteSize) {
  const b64 = Buffer.alloc(byteSize, 1).toString("base64");
  return `data:${mimeType};base64,${b64}`;
}

describe("ar.captureUpload — real capture round-trip", () => {
  it("persists a real screenshot capture; captureGet returns the full data", async () => {
    const ctx = await depthCtx("depth:ar:cap-roundtrip");
    const up = await lensRun("ar", "captureUpload", {
      params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png", label: "test shot" },
    }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.uploaded, true);
    assert.ok(up.result.capture.id);
    assert.equal(up.result.capture.mimeType, "image/png");
    assert.equal(up.result.capture.label, "test shot");
    assert.equal(up.result.capture.sceneId, null);
    assert.ok(up.result.capture.byteSize > 0);
    // captureUpload's own response is metadata-only, same contract as captureList.
    assert.equal(up.result.capture.dataUrl, undefined);

    const got = await lensRun("ar", "captureGet", { params: { captureId: up.result.capture.id } }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.result.capture.dataUrl, TINY_PNG_DATA_URL, "full blob data returned by captureGet");
    assert.equal(got.result.capture.mimeType, "image/png");
    assert.equal(got.result.capture.byteSize, Buffer.from(TINY_PNG_B64, "base64").byteLength);
  });

  it("rejects a missing dataUrl / missing mimeType / non image-or-video mimeType", async () => {
    const ctx = await depthCtx("depth:ar:cap-validate");
    const noUrl = await lensRun("ar", "captureUpload", { params: { mimeType: "image/png" } }, ctx);
    assert.equal(noUrl.result.ok, false);
    assert.match(noUrl.result.error, /dataUrl/);

    const noMime = await lensRun("ar", "captureUpload", { params: { dataUrl: TINY_PNG_DATA_URL } }, ctx);
    assert.equal(noMime.result.ok, false);
    assert.match(noMime.result.error, /mimeType/);

    const badMime = await lensRun("ar", "captureUpload", {
      params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "text/plain" },
    }, ctx);
    assert.equal(badMime.result.ok, false);
    assert.match(badMime.result.error, /image|video/);
  });

  it("rejects a malformed data: URL and an empty payload — never silently accepts garbage", async () => {
    const ctx = await depthCtx("depth:ar:cap-malformed");
    const notADataUrl = await lensRun("ar", "captureUpload", {
      params: { dataUrl: "not-a-data-url", mimeType: "image/png" },
    }, ctx);
    assert.equal(notADataUrl.result.ok, false);
    assert.equal(notADataUrl.result.error, "invalid_data_url");

    const empty = await lensRun("ar", "captureUpload", {
      params: { dataUrl: "data:image/png;base64,", mimeType: "image/png" },
    }, ctx);
    assert.equal(empty.result.ok, false);
  });

  it("honestly rejects an oversized image payload instead of truncating it", async () => {
    const ctx = await depthCtx("depth:ar:cap-oversize");
    const oversized = bigDataUrl("image/png", MAX_CAPTURE_IMAGE_BYTES + 1024);
    const r = await lensRun("ar", "captureUpload", {
      params: { dataUrl: oversized, mimeType: "image/png" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "capture_too_large");
    assert.equal(r.result.maxBytes, MAX_CAPTURE_IMAGE_BYTES);
    assert.ok(r.result.actualBytes > MAX_CAPTURE_IMAGE_BYTES);
  });

  it("video captures get a larger cap than images (same bytes: video ok, image rejected)", async () => {
    const ctx = await depthCtx("depth:ar:cap-video-cap");
    const midSize = 10 * 1024 * 1024; // > image cap (5MB), < video cap (25MB)
    assert.ok(midSize > MAX_CAPTURE_IMAGE_BYTES && midSize < MAX_CAPTURE_VIDEO_BYTES);

    const asImage = await lensRun("ar", "captureUpload", {
      params: { dataUrl: bigDataUrl("image/png", midSize), mimeType: "image/png" },
    }, ctx);
    assert.equal(asImage.result.ok, false);
    assert.equal(asImage.result.error, "capture_too_large");

    const asVideo = await lensRun("ar", "captureUpload", {
      params: { dataUrl: bigDataUrl("video/webm", midSize), mimeType: "video/webm", durationMs: 4200 },
    }, ctx);
    assert.equal(asVideo.ok, true);
    assert.equal(asVideo.result.capture.mimeType, "video/webm");
    assert.equal(asVideo.result.capture.durationMs, 4200);
  });

  it("a capture linked to a real sceneId works; an invalid sceneId is honestly rejected", async () => {
    const ctx = await depthCtx("depth:ar:cap-scene-link");
    const sceneSave = await lensRun("ar", "sceneSave", {
      params: { scene: { name: "Capture Test Scene" } },
    }, ctx);
    assert.equal(sceneSave.ok, true);
    const sceneId = sceneSave.result.scene.id;

    const linked = await lensRun("ar", "captureUpload", {
      params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png", sceneId },
    }, ctx);
    assert.equal(linked.ok, true);
    assert.equal(linked.result.capture.sceneId, sceneId);

    const bogus = await lensRun("ar", "captureUpload", {
      params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png", sceneId: "not-a-real-scene" },
    }, ctx);
    assert.equal(bogus.result.ok, false);
    assert.equal(bogus.result.error, "scene not found");
  });

  it("a capture with no sceneId works fine (sceneId is optional)", async () => {
    const ctx = await depthCtx("depth:ar:cap-no-scene");
    const r = await lensRun("ar", "captureUpload", {
      params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.capture.sceneId, null);
  });
});

describe("ar.captureList — metadata only, never the blob", () => {
  it("lists the caller's captures without any dataUrl field", async () => {
    const ctx = await depthCtx("depth:ar:cap-list");
    await lensRun("ar", "captureUpload", { params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png", label: "one" } }, ctx);
    await lensRun("ar", "captureUpload", { params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png", label: "two" } }, ctx);

    const list = await lensRun("ar", "captureList", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 2);
    assert.equal(list.result.captures.length, 2);
    for (const c of list.result.captures) {
      assert.equal(Object.prototype.hasOwnProperty.call(c, "dataUrl"), false, "list entries must not carry the blob");
      assert.ok(c.id);
      assert.ok(c.mimeType);
      assert.ok(c.createdAt);
      assert.ok(c.byteSize > 0);
    }
  });

  it("returns an honest empty list for a user with no captures", async () => {
    const ctx = await depthCtx("depth:ar:cap-empty");
    const list = await lensRun("ar", "captureList", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 0);
    assert.deepEqual(list.result.captures, []);
  });
});

describe("ar.captureGet / ar.captureDelete — honest not-found + real deletion", () => {
  it("captureGet on a bogus id is honestly rejected", async () => {
    const ctx = await depthCtx("depth:ar:cap-get-bogus");
    const r = await lensRun("ar", "captureGet", { params: { captureId: "cap_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "capture not found");
  });

  it("captureGet without a captureId is rejected", async () => {
    const ctx = await depthCtx("depth:ar:cap-get-missing-id");
    const r = await lensRun("ar", "captureGet", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /captureId/);
  });

  it("captureDelete on a bogus id is honestly rejected (not a silent no-op success)", async () => {
    const ctx = await depthCtx("depth:ar:cap-delete-bogus");
    const r = await lensRun("ar", "captureDelete", { params: { captureId: "cap_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "capture not found");
  });

  it("really deletes: listed before, gone after, captureGet 404s after delete", async () => {
    const ctx = await depthCtx("depth:ar:cap-delete-real");
    const up = await lensRun("ar", "captureUpload", { params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png" } }, ctx);
    const id = up.result.capture.id;

    const before = await lensRun("ar", "captureList", {}, ctx);
    assert.equal(before.result.count, 1);

    const del = await lensRun("ar", "captureDelete", { params: { captureId: id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(del.result.captureId, id);

    const after = await lensRun("ar", "captureList", {}, ctx);
    assert.equal(after.result.count, 0);

    const got = await lensRun("ar", "captureGet", { params: { captureId: id } }, ctx);
    assert.equal(got.result.ok, false);
    assert.equal(got.result.error, "capture not found");
  });
});

describe("ar captures — per-user isolation", () => {
  it("user B cannot list, get, or delete user A's captures", async () => {
    const ctxA = await depthCtx("depth:ar:cap-user-a");
    const ctxB = await depthCtx("depth:ar:cap-user-b");

    const up = await lensRun("ar", "captureUpload", { params: { dataUrl: TINY_PNG_DATA_URL, mimeType: "image/png" } }, ctxA);
    const id = up.result.capture.id;

    const bList = await lensRun("ar", "captureList", {}, ctxB);
    assert.equal(bList.result.count, 0);

    const bGet = await lensRun("ar", "captureGet", { params: { captureId: id } }, ctxB);
    assert.equal(bGet.result.ok, false);
    assert.equal(bGet.result.error, "capture not found");

    const bDelete = await lensRun("ar", "captureDelete", { params: { captureId: id } }, ctxB);
    assert.equal(bDelete.result.ok, false);

    // Still there for the owner.
    const aList = await lensRun("ar", "captureList", {}, ctxA);
    assert.equal(aList.result.count, 1);
  });
});
