import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import createMediaRouter from "../routes/media.js";
import { grantMediaLicense } from "../lib/media-preview-window.js";

/**
 * Mock Express Router + request/response for testing route handlers.
 */
function createMockRouter() {
  const routes = {};
  const methods = ["get", "post", "put", "delete", "patch"];
  const router = {};

  for (const method of methods) {
    router[method] = (path, ...handlers) => {
      if (!routes[method]) routes[method] = {};
      routes[method][path] = handlers;
    };
  }

  router.call = async (method, path, { body, params, query, user, headers } = {}) => {
    const handlers = routes[method]?.[path];
    if (!handlers) throw new Error(`No route: ${method.toUpperCase()} ${path}`);

    let statusCode = 200;
    let responseBody = null;
    const sentHeaders = {};

    const req = {
      body: body || {},
      params: params || {},
      query: query || {},
      user: user || null,
      headers: headers || {},
      ip: "127.0.0.1",
    };

    const res = {
      status(code) { statusCode = code; return res; },
      json(data) { responseBody = data; return res; },
      set(key, val) { sentHeaders[key] = val; return res; },
      send(data) { responseBody = data; return res; },
    };

    for (const handler of handlers) {
      let nextCalled = false;
      let nextError = null;

      await new Promise((resolve, reject) => {
        const next = (err) => {
          nextCalled = true;
          if (err) {
            nextError = err;
            // Handle ConcordError-like errors
            if (err.statusCode) {
              statusCode = err.statusCode;
              responseBody = { ok: false, error: err.message, code: err.code };
            }
          }
          resolve();
        };

        try {
          const result = handler(req, res, next);
          if (result && typeof result.then === "function") {
            result.then(() => { if (!nextCalled) resolve(); }).catch((e) => {
              if (e.statusCode) {
                statusCode = e.statusCode;
                responseBody = { ok: false, error: e.message, code: e.code };
              }
              resolve();
            });
          } else if (!nextCalled) {
            resolve();
          }
        } catch (e) {
          if (e.statusCode) {
            statusCode = e.statusCode;
            responseBody = { ok: false, error: e.message, code: e.code };
          }
          resolve();
        }
      });

      if (responseBody !== null) break;
    }

    return { status: statusCode, body: responseBody, headers: sentHeaders };
  };

  return router;
}

// Patch Router so that createMediaRouter uses our mock
const originalRouter = await import("express").then(m => m.Router).catch(() => null);

describe("routes/media", () => {
  let STATE;
  let router;

  beforeEach(() => {
    STATE = {};
    router = createMockRouter();

    // Manually call the route setup function using our mock router pattern.
    // Since createMediaRouter returns an Express Router, we'll simulate it.
    const realRouter = createMediaRouter({ STATE });

    // Extract route handlers from the real router's stack
    if (realRouter && realRouter.stack) {
      for (const layer of realRouter.stack) {
        if (layer.route) {
          const path = layer.route.path;
          for (const [method, handlers] of Object.entries(layer.route.methods)) {
            if (handlers) {
              const layerHandlers = layer.route.stack
                .filter(s => s.method === method || !s.method)
                .map(s => s.handle);
              if (!router._routes) router._routes = {};
              if (!router._routes[method]) router._routes[method] = {};
              router._routes[method][path] = layerHandlers;
            }
          }
        }
      }
    }

    // Override call to use extracted routes
    router.call = async (method, path, opts = {}) => {
      const routeKey = path;
      const handlers = router._routes?.[method]?.[routeKey];
      if (!handlers || handlers.length === 0) {
        throw new Error(`No route: ${method.toUpperCase()} ${path}`);
      }

      let statusCode = 200;
      let responseBody = null;
      const sentHeaders = {};
      // asyncHandler does not return its promise (errors go to next). Settle
      // when the response is actually written, not when the wrapper returns.
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
            if (responseBody !== null) finish();
            else if (result && typeof result.then === "function") {
              result.then(() => finish()).catch((e) => {
                if (e.statusCode) {
                  statusCode = e.statusCode;
                  responseBody = { ok: false, error: e.message, code: e.code };
                }
                finish();
              });
            }
          } catch (e) {
            if (e.statusCode) {
              statusCode = e.statusCode;
              responseBody = { ok: false, error: e.message, code: e.code };
            }
            finish();
          }
        });

        if (responseBody !== null) break;
      }

      return { status: statusCode, body: responseBody, headers: sentHeaders };
    };
  });

  // ── Upload route validation ────────────────────────────────────────

  describe("POST /upload", () => {
    it("creates a media DTU with valid data", async () => {
      const res = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "My Video",
          mediaType: "video",
          mimeType: "video/mp4",
          fileSize: 1024000,
          duration: 60,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.mediaDTU);
      assert.ok(res.body.mediaDTU.id.startsWith("media-"));
    });

    it("returns 401 when unauthenticated (no req.user)", async () => {
      // SECURITY: authorId comes from authenticated session, never request body.
      // Anonymous uploads must return 401 — see routes/media.js:152.
      const res = await router.call("post", "/upload", {
        body: { title: "No Auth", mediaType: "video" },
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
    });

    it("returns 400 when title is missing", async () => {
      const res = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: { mediaType: "video" },
      });

      assert.equal(res.status, 400);
    });

    it("auto-detects mediaType from mimeType", async () => {
      const res = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Audio",
          mimeType: "audio/mpeg",
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.mediaDTU.mediaType, "audio");
    });

    it("returns 400 when neither mediaType nor mimeType provided", async () => {
      const res = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: { title: "Typeless" },
      });

      assert.equal(res.status, 400);
    });
  });

  // ── Stream endpoint ────────────────────────────────────────────────

  describe("GET /:id/stream", () => {
    it("returns stream metadata", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Streamable",
          mediaType: "video",
          mimeType: "video/mp4",
          duration: 120,
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      const res = await router.call("get", "/:id/stream", {
        params: { id: mediaId },
        query: {},
        headers: {},
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.streaming, true);
    });

    it("handles range header for partial content", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Range",
          mediaType: "video",
          mimeType: "video/mp4",
          fileSize: 2000000,
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      const res = await router.call("get", "/:id/stream", {
        params: { id: mediaId },
        headers: { range: "bytes=0-1023" },
      });

      assert.equal(res.status, 206);
      assert.equal(res.body.range.start, 0);
      assert.equal(res.body.range.end, 1023);
    });

    it("returns 404 for non-existent media", async () => {
      const res = await router.call("get", "/:id/stream", {
        params: { id: "media-nonexistent" },
      });

      assert.equal(res.status, 404);
    });

    it("returns 404 when another account streams a private upload", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "owner-a" },
        body: {
          title: "Private take",
          mediaType: "audio",
          mimeType: "audio/webm",
          privacy: "private",
        },
      });
      assert.equal(upload.status, 201);
      const mediaId = upload.body.mediaDTU.id;

      const other = await router.call("get", "/:id/stream", {
        params: { id: mediaId },
        user: { id: "other-b" },
        query: {},
        headers: {},
      });
      assert.equal(other.status, 404);

      const owner = await router.call("get", "/:id/stream", {
        params: { id: mediaId },
        user: { id: "owner-a" },
        query: {},
        headers: {},
      });
      assert.equal(owner.status, 200);
    });
  });

  // ── Feed endpoint pagination ───────────────────────────────────────

  describe("GET /feed", () => {
    it("returns media feed", async () => {
      await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Feed Item 1",
          mediaType: "video",
          mimeType: "video/mp4",
        },
      });
      await router.call("post", "/upload", {
        user: { id: "user2" },
        body: {
          title: "Feed Item 2",
          mediaType: "audio",
          mimeType: "audio/mpeg",
        },
      });

      const res = await router.call("get", "/feed", {
        query: { limit: "10", offset: "0" },
      });

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.feed));
    });
  });

  // ── Like/unlike toggle ─────────────────────────────────────────────

  describe("POST /:id/like", () => {
    it("likes media", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Likeable",
          mediaType: "image",
          mimeType: "image/jpeg",
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      const res = await router.call("post", "/:id/like", {
        user: { id: "liker1" },
        params: { id: mediaId },
        body: {},
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.liked, true);
      assert.equal(res.body.likes, 1);
    });

    it("unlikes on second toggle", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Unlikeable",
          mediaType: "image",
          mimeType: "image/jpeg",
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      await router.call("post", "/:id/like", {
        user: { id: "liker1" },
        params: { id: mediaId },
        body: {},
      });

      const res = await router.call("post", "/:id/like", {
        user: { id: "liker1" },
        params: { id: mediaId },
        body: {},
      });

      assert.equal(res.body.liked, false);
      assert.equal(res.body.likes, 0);
    });

    it("returns 401 when no authenticated user", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "No Liker",
          mediaType: "image",
          mimeType: "image/jpeg",
        },
      });

      const res = await router.call("post", "/:id/like", {
        params: { id: upload.body.mediaDTU.id },
        body: {},
      });

      assert.equal(res.status, 401);
    });
  });

  // ── Comment creation and retrieval ─────────────────────────────────

  describe("POST /:id/comment and GET /:id/comments", () => {
    it("adds a comment", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Commentable",
          mediaType: "video",
          mimeType: "video/mp4",
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      const res = await router.call("post", "/:id/comment", {
        user: { id: "commenter1" },
        params: { id: mediaId },
        body: { text: "Great video!" },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.comment.text, "Great video!");
    });

    it("returns 400 when comment text is missing", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Empty Comment",
          mediaType: "video",
          mimeType: "video/mp4",
        },
      });

      const res = await router.call("post", "/:id/comment", {
        user: { id: "user1" },
        params: { id: upload.body.mediaDTU.id },
        body: {},
      });

      assert.equal(res.status, 400);
    });

    it("retrieves comments", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user1" },
        body: {
          title: "Comments",
          mediaType: "video",
          mimeType: "video/mp4",
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      await router.call("post", "/:id/comment", {
        user: { id: "u1" },
        params: { id: mediaId },
        body: { text: "First" },
      });
      await router.call("post", "/:id/comment", {
        user: { id: "u2" },
        params: { id: mediaId },
        body: { text: "Second" },
      });

      const res = await router.call("get", "/:id/comments", {
        params: { id: mediaId },
        query: {},
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.total, 2);
    });
  });

  // ── Delete ─────────────────────────────────────────────────────────

  describe("DELETE /:id", () => {
    it("deletes media when authorized", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "owner1" },
        body: {
          title: "Deletable",
          mediaType: "image",
          mimeType: "image/png",
        },
      });

      const res = await router.call("delete", "/:id", {
        user: { id: "owner1" },
        params: { id: upload.body.mediaDTU.id },
      });

      assert.equal(res.body.ok, true);
    });

    it("returns 403 JSON when the caller is not the author", async () => {
      const upload = await router.call("post", "/upload", {
        user: { id: "user-a" },
        body: {
          title: "Owned",
          mediaType: "audio",
          mimeType: "audio/mpeg",
        },
      });
      const mediaId = upload.body.mediaDTU.id;

      const res = await router.call("delete", "/:id", {
        user: { id: "user-b" },
        params: { id: mediaId },
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.equal(typeof res.body.error, "string");
      assert.ok(res.body.error.length > 0);
      assert.equal(res.body.mode, undefined);
      assert.equal(res.body.sessionId, undefined);
      assert.equal(res.body.llmUsed, undefined);

      const still = await router.call("get", "/:id", {
        user: { id: "user-a" },
        params: { id: mediaId },
      });
      assert.equal(still.status, 200);
      assert.equal(still.body.mediaDTU.id, mediaId);
    });
  });

  // ── Priced stream paywall ──────────────────────────────────────────

  describe("GET /:id/stream paywall", () => {
    const pricedTiers = [
      { tier: "listen", enabled: true, price: 0 },
      { tier: "create", enabled: true, price: 9.99 },
      { tier: "commercial", enabled: true, price: 99.99 },
    ];

    function pcmWav(seconds = 3, sampleRate = 8000) {
      const dataSize = seconds * sampleRate;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write("RIFF", 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write("WAVE", 8);
      buf.write("fmt ", 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(sampleRate, 24);
      buf.writeUInt32LE(sampleRate, 28);
      buf.writeUInt16LE(1, 32);
      buf.writeUInt16LE(8, 34);
      buf.write("data", 36);
      buf.writeUInt32LE(dataSize, 40);
      return buf;
    }

    async function uploadPriced(extra = {}) {
      const wav = pcmWav();
      const upload = await router.call("post", "/upload", {
        user: { id: "user-a" },
        body: {
          title: "Priced tone",
          mediaType: "audio",
          mimeType: "audio/wav",
          duration: 3,
          fileSize: wav.length,
          previewStart: 0,
          previewDuration: 1,
          tiers: pricedTiers,
          data: wav.toString("base64"),
          ...extra,
        },
      });
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      return { upload, wav, mediaId: upload.body.mediaDTU.id };
    }

    it("serves the owner the full file even on an oversized Range", async () => {
      const { mediaId, wav } = await uploadPriced();
      const res = await router.call("get", "/:id/stream", {
        user: { id: "user-a" },
        params: { id: mediaId },
        headers: { range: "bytes=0-999999" },
      });
      assert.equal(res.status, 206);
      assert.equal(res.body.length, wav.length);
      assert.equal(res.headers["Content-Range"], `bytes 0-${wav.length - 1}/${wav.length}`);
    });

    it("serves a non-owner only the preview window, including oversized Range", async () => {
      const { mediaId } = await uploadPriced();
      const res = await router.call("get", "/:id/stream", {
        user: { id: "user-b" },
        params: { id: mediaId },
        headers: { range: "bytes=0-999999" },
      });
      assert.equal(res.status, 206);
      assert.ok(Buffer.isBuffer(res.body));
      // 1s of 8 kHz 8-bit mono = 8000 samples + 44-byte PCM header.
      assert.equal(res.body.length, 8044);
      assert.equal(res.body.toString("ascii", 0, 4), "RIFF");
      assert.equal(res.body.toString("ascii", 8, 12), "WAVE");
      assert.equal(res.body.readUInt32LE(40), 8000);
      assert.equal(res.headers["Content-Range"], "bytes 0-8043/8044");
      assert.equal(res.headers["Cache-Control"], "private, no-store");
    });

    it("rejects a Range that starts past the preview window", async () => {
      const { mediaId } = await uploadPriced();
      const res = await router.call("get", "/:id/stream", {
        user: { id: "user-b" },
        params: { id: mediaId },
        headers: { range: "bytes=20000-24043" },
      });
      assert.equal(res.status, 416);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "range_not_satisfiable");
      assert.equal(res.headers["Content-Range"], "bytes */8044");
    });

    it("serves the full file to a license holder", async () => {
      const { mediaId, wav } = await uploadPriced();
      grantMediaLicense(STATE, mediaId, "user-b");
      const res = await router.call("get", "/:id/stream", {
        user: { id: "user-b" },
        params: { id: mediaId },
        headers: { range: "bytes=0-999999" },
      });
      assert.equal(res.status, 206);
      assert.equal(res.body.length, wav.length);
    });

    it("returns 403 when a priced track has no preview window", async () => {
      const { mediaId } = await uploadPriced({ previewDuration: 0 });
      const res = await router.call("get", "/:id/stream", {
        user: { id: "user-b" },
        params: { id: mediaId },
        headers: { range: "bytes=0-999999" },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "license_required");
    });
  });
});
