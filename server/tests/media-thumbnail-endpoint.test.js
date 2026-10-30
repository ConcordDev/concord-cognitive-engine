import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import createMediaRouter from "../routes/media.js";
import { createMediaDTU } from "../lib/media-dtu.js";

/**
 * Q26 — GET /:id/thumbnail serves real bytes or an honest 404.
 *
 * Pins the contract that replaced the stub (which returned a JSON note
 * saying "In production, this returns an actual image"): the endpoint
 * serves the artifact-store thumbnail recorded on the server-generated
 * artifact descriptor — the original file for images, an ffmpeg poster
 * for video, a waveform file for honest audio — and answers a named
 * 404 (no_thumbnail_available) when no real thumbnail exists. The
 * user-settable DTU `thumbnail` field is never read as a file path.
 */

// ── Mock-router harness (same extraction pattern as routes-media.test.js) ──
function buildRouter(STATE) {
  const realRouter = createMediaRouter({ STATE });
  const routes = {};
  if (realRouter && realRouter.stack) {
    for (const layer of realRouter.stack) {
      if (layer.route) {
        const p = layer.route.path;
        for (const [method, handlers] of Object.entries(layer.route.methods)) {
          if (handlers) {
            const layerHandlers = layer.route.stack
              .filter((s) => s.method === method || !s.method)
              .map((s) => s.handle);
            if (!routes[method]) routes[method] = {};
            routes[method][p] = layerHandlers;
          }
        }
      }
    }
  }

  async function call(method, routePath, opts = {}) {
    const handlers = routes[method]?.[routePath];
    if (!handlers || handlers.length === 0) {
      throw new Error(`No route: ${method.toUpperCase()} ${routePath}`);
    }
    let statusCode = 200;
    let responseBody = null;
    const sentHeaders = {};
    let settle = () => {};
    const req = {
      body: opts.body || {},
      params: opts.params || {},
      query: opts.query || {},
      user: opts.user || null,
      headers: opts.headers || {},
      ip: "127.0.0.1",
    };
    const res = {
      status(code) { statusCode = code; return res; },
      json(data) { responseBody = data; settle(); return res; },
      set(key, val) {
        if (val === undefined && key && typeof key === "object") Object.assign(sentHeaders, key);
        else sentHeaders[key] = val;
        return res;
      },
      send(data) { responseBody = data; settle(); return res; },
      end(data) { if (data !== undefined) responseBody = data; settle(); return res; },
    };
    for (const handler of handlers) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        settle = finish;
        const next = (err) => {
          if (err && err.statusCode) {
            statusCode = err.statusCode;
            responseBody = { ok: false, error: err.message, code: err.code };
          }
          finish();
        };
        try {
          const result = handler(req, res, next);
          if (result && typeof result.then === "function") {
            result.then(() => { if (responseBody !== null) finish(); }).catch((e) => {
              if (e && e.statusCode) {
                statusCode = e.statusCode;
                responseBody = { ok: false, error: e.message, code: e.code };
              }
              finish();
            });
          }
        } catch (e) {
          if (e && e.statusCode) {
            statusCode = e.statusCode;
            responseBody = { ok: false, error: e.message, code: e.code };
          }
          finish();
        }
      });
      if (responseBody !== null) break;
    }
    return { status: statusCode, body: responseBody, headers: sentHeaders };
  }

  return { call };
}

describe("GET /:id/thumbnail (Q26)", () => {
  let STATE;
  let router;
  let dir;
  let imgPath;
  let posterPath;
  let wavePath;
  const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const posterBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
  const waveBytes = Buffer.from(JSON.stringify([0.1, 0.5, 0.9]), "utf-8");

  beforeEach(() => {
    STATE = {};
    router = buildRouter(STATE);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "q26-thumb-"));
    imgPath = path.join(dir, "photo.png");
    posterPath = path.join(dir, "thumbnail.jpg");
    wavePath = path.join(dir, "waveform.json");
    fs.writeFileSync(imgPath, imgBytes);
    fs.writeFileSync(posterPath, posterBytes);
    fs.writeFileSync(wavePath, waveBytes);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(overrides = {}) {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "owner-1",
      title: "Thumb Media",
      mediaType: "image",
      mimeType: "image/png",
      ...overrides,
    });
    return mediaDTU;
  }

  it("serves the original bytes for an image (thumbnail == artifact path)", async () => {
    const mediaDTU = seed({
      artifactRef: { type: "image/png", diskPath: imgPath, thumbnail: imgPath },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
      user: { id: "viewer-9" },
    });
    assert.equal(res.status, 200);
    assert.ok(Buffer.isBuffer(res.body));
    assert.deepEqual(res.body, imgBytes);
    assert.equal(res.headers["Content-Type"], "image/png");
  });

  it("serves the poster frame for a video", async () => {
    const mediaDTU = seed({
      mediaType: "video",
      mimeType: "video/mp4",
      artifactRef: { type: "video/mp4", diskPath: path.join(dir, "clip.mp4"), thumbnail: posterPath },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
      user: { id: "viewer-9" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, posterBytes);
    assert.equal(res.headers["Content-Type"], "image/jpeg");
  });

  it("serves the waveform file for honest audio", async () => {
    const mediaDTU = seed({
      mediaType: "audio",
      mimeType: "audio/wav",
      artifactRef: { type: "audio/wav", diskPath: path.join(dir, "song.wav"), thumbnail: wavePath },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, waveBytes);
    assert.equal(res.headers["Content-Type"], "application/json");
  });

  it("answers a named 404 when artifact-store produced no thumbnail", async () => {
    const mediaDTU = seed({
      mediaType: "audio",
      mimeType: "audio/mpeg",
      artifactRef: { type: "audio/mpeg", diskPath: path.join(dir, "song.mp3"), thumbnail: null },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "no_thumbnail_available");
    assert.equal(res.body.note, undefined);
  });

  it("answers a named 404 for legacy media with no artifact at all", async () => {
    const mediaDTU = seed();
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "no_thumbnail_available");
  });

  it("answers a named 404 when the thumbnail file is gone", async () => {
    const mediaDTU = seed({
      artifactRef: { type: "image/png", diskPath: imgPath, thumbnail: path.join(dir, "vanished.jpg") },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "no_thumbnail_available");
  });

  it("never serves the user-settable thumbnail field as a file path", async () => {
    // dtu.thumbnail is settable through the update whitelist. Even when it
    // names a real file on disk, the endpoint must not read it — only the
    // server-generated artifact descriptor is authoritative.
    const mediaDTU = seed({
      thumbnail: imgPath,
      artifactRef: { type: "image/png", diskPath: imgPath, thumbnail: null },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "no_thumbnail_available");
  });

  it("keeps the viewer gate: private media serves nothing to strangers", async () => {
    const mediaDTU = seed({
      privacy: "private",
      artifactRef: { type: "image/png", diskPath: imgPath, thumbnail: imgPath },
    });
    const anon = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
    });
    assert.equal(anon.status, 401);
    const stranger = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
      user: { id: "stranger-2" },
    });
    assert.equal(stranger.status, 404);
    const owner = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
      user: { id: "owner-1" },
    });
    assert.equal(owner.status, 200);
    assert.deepEqual(owner.body, imgBytes);
  });

  it("honours range requests against the thumbnail bytes", async () => {
    const mediaDTU = seed({
      artifactRef: { type: "image/png", diskPath: imgPath, thumbnail: imgPath },
    });
    const res = await router.call("get", "/:id/thumbnail", {
      params: { id: mediaDTU.id },
      headers: { range: "bytes=0-3" },
    });
    assert.equal(res.status, 206);
    assert.deepEqual(res.body, imgBytes.subarray(0, 4));
    assert.equal(res.headers["Content-Range"], `bytes 0-3/${imgBytes.length}`);
  });
});
