import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMediaDTU,
  getMediaDTU,
  updateMediaDTU,
  deleteMediaDTU,
  recordView,
  toggleLike,
  addComment,
  getComments,
  generateThumbnail,
  generateHLSManifest,
  moveStorageTier,
  getMediaFeed,
  getMediaMetrics,
  detectMediaType,
  MEDIA_TYPES,
  STORAGE_TIERS,
  MEDIA_MIME_MAP,
} from "../lib/media-dtu.js";

describe("media-dtu", () => {
  let STATE;

  beforeEach(() => {
    STATE = {};
  });

  function createTestMedia(overrides = {}) {
    return createMediaDTU(STATE, {
      authorId: "user1",
      title: "Test Video",
      mediaType: "video",
      mimeType: "video/mp4",
      duration: 120,
      resolution: { width: 1920, height: 1080 },
      fileSize: 10_000_000,
      ...overrides,
    });
  }

  // ── createMediaDTU ─────────────────────────────────────────────────

  describe("createMediaDTU", () => {
    it("creates a media DTU with all correct fields", () => {
      const result = createTestMedia();
      assert.equal(result.ok, true);

      const dtu = result.mediaDTU;
      assert.ok(dtu.id.startsWith("media-"));
      assert.equal(dtu.type, "media");
      assert.equal(dtu.title, "Test Video");
      assert.equal(dtu.mediaType, "video");
      assert.equal(dtu.mimeType, "video/mp4");
      assert.equal(dtu.duration, 120);
      assert.deepEqual(dtu.resolution, { width: 1920, height: 1080 });
      assert.equal(dtu.fileSize, 10_000_000);
      assert.equal(dtu.author, "user1");
      assert.equal(dtu.scope, "global");
      assert.ok(dtu.createdAt);
      assert.ok(dtu.updatedAt);
    });

    it("sets transcodeStatus to 'pending' for video", () => {
      const result = createTestMedia({ mediaType: "video" });
      assert.equal(result.mediaDTU.transcodeStatus, "pending");
    });

    it("sets transcodeStatus to 'ready' for image", () => {
      const result = createTestMedia({ mediaType: "image", mimeType: "image/png" });
      assert.equal(result.mediaDTU.transcodeStatus, "ready");
    });

    it("sets transcodeStatus to 'ready' for document", () => {
      const result = createTestMedia({
        mediaType: "document",
        mimeType: "application/pdf",
      });
      assert.equal(result.mediaDTU.transcodeStatus, "ready");
    });

    it("assigns hot storage tier by default", () => {
      const result = createTestMedia();
      assert.equal(result.mediaDTU.storageRef.tier, "hot");
    });

    it("initializes engagement counters to zero", () => {
      const result = createTestMedia();
      assert.deepEqual(result.mediaDTU.engagement, {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      });
    });

    it("creates stream metadata for stream type", () => {
      const result = createTestMedia({ mediaType: "stream" });
      assert.ok(result.mediaDTU.stream);
      assert.equal(result.mediaDTU.stream.isLive, false);
      assert.equal(result.mediaDTU.stream.viewerCount, 0);
    });

    it("honestly reports no server-side waveform for audio type (server cannot decode compressed audio)", () => {
      // Was: asserted a fabricated 64-point array (Math.sin + Math.random,
      // no relationship to real audio). The server has no audio decoder, so
      // the honest value is `null` — real peaks are computed client-side
      // from the actual decoded samples (see daily/voice lens upload paths).
      const result = createTestMedia({
        mediaType: "audio",
        mimeType: "audio/mpeg",
      });
      assert.equal(result.mediaDTU.waveform, null);
    });

    it("returns error for missing authorId", () => {
      const result = createMediaDTU(STATE, {
        title: "No Author",
        mediaType: "video",
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("authorId"));
    });

    it("returns error for missing title", () => {
      const result = createMediaDTU(STATE, {
        authorId: "user1",
        mediaType: "video",
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("title"));
    });

    it("returns error for invalid mediaType", () => {
      const result = createMediaDTU(STATE, {
        authorId: "user1",
        title: "Bad Type",
        mediaType: "hologram",
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Invalid mediaType"));
    });

    it("rejects files exceeding max size", () => {
      const result = createMediaDTU(STATE, {
        authorId: "user1",
        title: "Too Big",
        mediaType: "image",
        mimeType: "image/png",
        fileSize: 100 * 1024 * 1024, // 100MB > 50MB limit for images
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("exceeds maximum size"));
    });

    it("updates storage stats on creation", () => {
      createTestMedia({ fileSize: 5000 });
      const metrics = getMediaMetrics(STATE);
      assert.equal(metrics.storage.totalSize, 5000);
      assert.equal(metrics.storage.hotTierSize, 5000);
      assert.equal(metrics.totalUploads, 1);
    });
  });

  // ── detectMediaType ────────────────────────────────────────────────

  describe("detectMediaType", () => {
    it("detects audio from audio/mpeg", () => {
      assert.equal(detectMediaType("audio/mpeg"), "audio");
    });

    it("detects video from video/mp4", () => {
      assert.equal(detectMediaType("video/mp4"), "video");
    });

    it("detects image from image/jpeg", () => {
      assert.equal(detectMediaType("image/jpeg"), "image");
    });

    it("detects document from application/pdf", () => {
      assert.equal(detectMediaType("application/pdf"), "document");
    });

    it("detects stream from HLS MIME type", () => {
      assert.equal(detectMediaType("application/x-mpegURL"), "stream");
    });

    it("falls back to audio for unknown audio/* prefix", () => {
      assert.equal(detectMediaType("audio/x-custom"), "audio");
    });

    it("falls back to document for fully unknown type", () => {
      assert.equal(detectMediaType("application/x-unknown"), "document");
    });
  });

  // ── getMediaDTU ────────────────────────────────────────────────────

  describe("getMediaDTU", () => {
    it("returns a media DTU by ID", () => {
      const { mediaDTU } = createTestMedia();
      const result = getMediaDTU(STATE, mediaDTU.id);
      assert.equal(result.ok, true);
      assert.equal(result.mediaDTU.id, mediaDTU.id);
    });

    it("returns error for non-existent ID", () => {
      const result = getMediaDTU(STATE, "media-nonexistent");
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("not found"));
    });
  });

  // ── generateThumbnail ──────────────────────────────────────────────

  describe("generateThumbnail", () => {
    it("sets thumbnail path on media DTU", () => {
      const { mediaDTU } = createTestMedia();
      const result = generateThumbnail(STATE, mediaDTU.id);

      assert.equal(result.ok, true);
      assert.ok(result.thumbnail.includes(mediaDTU.id));
      assert.ok(result.thumbnail.endsWith(".jpg"));
    });

    it("returns error for non-existent media", () => {
      const result = generateThumbnail(STATE, "media-nope");
      assert.equal(result.ok, false);
    });
  });

  // ── generateHLSManifest ────────────────────────────────────────────

  describe("generateHLSManifest", () => {
    it("generates an M3U8 manifest for video", () => {
      const { mediaDTU } = createTestMedia({ mediaType: "video" });
      // Set transcodeStatus to ready so manifest generation has fallback
      mediaDTU.transcodeStatus = "ready";
      const result = generateHLSManifest(STATE, mediaDTU.id);

      assert.equal(result.ok, true);
      assert.ok(result.manifest.includes("#EXTM3U"));
      assert.equal(result.contentType, "application/vnd.apple.mpegurl");
    });

    it("returns error for audio type", () => {
      const { mediaDTU } = createTestMedia({
        mediaType: "audio",
        mimeType: "audio/mpeg",
      });
      const result = generateHLSManifest(STATE, mediaDTU.id);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("video and stream"));
    });

    it("returns error for non-existent media", () => {
      const result = generateHLSManifest(STATE, "media-ghost");
      assert.equal(result.ok, false);
    });
  });

  // ── moveStorageTier ────────────────────────────────────────────────

  describe("moveStorageTier", () => {
    it("moves media to a different tier", () => {
      const { mediaDTU } = createTestMedia({ fileSize: 1000 });
      const result = moveStorageTier(STATE, mediaDTU.id, "cold");

      assert.equal(result.ok, true);
      assert.equal(result.tier, "cold");
      assert.equal(result.changed, true);
    });

    it("returns changed=false for same tier", () => {
      const { mediaDTU } = createTestMedia();
      const result = moveStorageTier(STATE, mediaDTU.id, "hot");
      assert.equal(result.changed, false);
    });

    it("rejects invalid tier", () => {
      const { mediaDTU } = createTestMedia();
      const result = moveStorageTier(STATE, mediaDTU.id, "freezing");
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Invalid tier"));
    });
  });

  // ── Engagement: views, likes, comments ─────────────────────────────

  describe("recordView", () => {
    it("records a new view", () => {
      const { mediaDTU } = createTestMedia();
      const result = recordView(STATE, mediaDTU.id, "viewer1");
      assert.equal(result.ok, true);
      assert.equal(result.isNew, true);
      assert.equal(result.views, 1);
    });

    it("does not double-count same user", () => {
      const { mediaDTU } = createTestMedia();
      recordView(STATE, mediaDTU.id, "viewer1");
      const result = recordView(STATE, mediaDTU.id, "viewer1");
      assert.equal(result.isNew, false);
      assert.equal(result.views, 1);
    });
  });

  describe("toggleLike", () => {
    it("likes media on first toggle", () => {
      const { mediaDTU } = createTestMedia();
      const result = toggleLike(STATE, mediaDTU.id, "liker1");
      assert.equal(result.ok, true);
      assert.equal(result.liked, true);
      assert.equal(result.likes, 1);
    });

    it("unlikes media on second toggle", () => {
      const { mediaDTU } = createTestMedia();
      toggleLike(STATE, mediaDTU.id, "liker1");
      const result = toggleLike(STATE, mediaDTU.id, "liker1");
      assert.equal(result.liked, false);
      assert.equal(result.likes, 0);
    });

    it("returns error for non-existent media", () => {
      const result = toggleLike(STATE, "media-ghost", "user1");
      assert.equal(result.ok, false);
    });
  });

  describe("addComment", () => {
    it("adds a comment", () => {
      const { mediaDTU } = createTestMedia();
      const result = addComment(STATE, mediaDTU.id, "user1", "Great video!");
      assert.equal(result.ok, true);
      assert.ok(result.comment.id.startsWith("comment-"));
      assert.equal(result.comment.text, "Great video!");
    });

    it("trims whitespace from comment text", () => {
      const { mediaDTU } = createTestMedia();
      const result = addComment(STATE, mediaDTU.id, "user1", "  spaced  ");
      assert.equal(result.comment.text, "spaced");
    });

    it("rejects empty comment text", () => {
      const { mediaDTU } = createTestMedia();
      const result = addComment(STATE, mediaDTU.id, "user1", "");
      assert.equal(result.ok, false);
    });

    it("rejects whitespace-only comment", () => {
      const { mediaDTU } = createTestMedia();
      const result = addComment(STATE, mediaDTU.id, "user1", "   ");
      assert.equal(result.ok, false);
    });
  });

  describe("getComments", () => {
    it("returns all comments", () => {
      const { mediaDTU } = createTestMedia();
      addComment(STATE, mediaDTU.id, "u1", "First");
      addComment(STATE, mediaDTU.id, "u2", "Second");

      const result = getComments(STATE, mediaDTU.id);
      assert.equal(result.ok, true);
      assert.equal(result.total, 2);
      const texts = result.comments.map((c) => c.text);
      assert.ok(texts.includes("First"));
      assert.ok(texts.includes("Second"));
    });

    it("supports pagination with limit and offset", () => {
      const { mediaDTU } = createTestMedia();
      for (let i = 0; i < 5; i++) {
        addComment(STATE, mediaDTU.id, "u1", `Comment ${i}`);
      }

      const result = getComments(STATE, mediaDTU.id, { limit: 2, offset: 0 });
      assert.equal(result.comments.length, 2);
      assert.equal(result.total, 5);
    });
  });

  // ── getMediaFeed ───────────────────────────────────────────────────

  describe("getMediaFeed", () => {
    it("returns public media in feed", () => {
      createTestMedia({ title: "Public 1", privacy: "public" });
      createTestMedia({ title: "Public 2", privacy: "public" });

      const result = getMediaFeed(STATE, "viewer1");
      assert.equal(result.ok, true);
      assert.equal(result.feed.length, 2);
    });

    it("excludes private media from other users", () => {
      createTestMedia({ authorId: "other", title: "Private", privacy: "private" });
      createTestMedia({ title: "Public", privacy: "public" });

      const result = getMediaFeed(STATE, "viewer1");
      assert.equal(result.feed.length, 1);
      assert.equal(result.feed[0].title, "Public");
    });

    it("supports mediaType filter", () => {
      createTestMedia({ mediaType: "video", title: "Vid" });
      createTestMedia({
        mediaType: "audio",
        mimeType: "audio/mpeg",
        title: "Aud",
      });

      const result = getMediaFeed(STATE, "viewer1", { mediaType: "audio" });
      assert.equal(result.feed.length, 1);
      assert.equal(result.feed[0].mediaType, "audio");
    });
  });

  // ── deleteMediaDTU ─────────────────────────────────────────────────

  describe("deleteMediaDTU", () => {
    it("deletes media owned by the author", () => {
      const { mediaDTU } = createTestMedia({ authorId: "owner1" });
      const result = deleteMediaDTU(STATE, mediaDTU.id, "owner1");
      assert.equal(result.ok, true);

      const lookup = getMediaDTU(STATE, mediaDTU.id);
      assert.equal(lookup.ok, false);
    });

    it("denies deletion by non-author", () => {
      const { mediaDTU } = createTestMedia({ authorId: "owner1" });
      const result = deleteMediaDTU(STATE, mediaDTU.id, "not_owner");
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Not authorized"));
    });
  });

  // ── Constants ──────────────────────────────────────────────────────

  describe("constants", () => {
    it("MEDIA_TYPES includes expected types", () => {
      assert.ok(MEDIA_TYPES.includes("audio"));
      assert.ok(MEDIA_TYPES.includes("video"));
      assert.ok(MEDIA_TYPES.includes("image"));
      assert.ok(MEDIA_TYPES.includes("document"));
      assert.ok(MEDIA_TYPES.includes("stream"));
    });

    it("STORAGE_TIERS includes hot, warm, cold", () => {
      assert.ok(STORAGE_TIERS.includes("hot"));
      assert.ok(STORAGE_TIERS.includes("warm"));
      assert.ok(STORAGE_TIERS.includes("cold"));
    });

    it("MEDIA_MIME_MAP has entries for each type", () => {
      for (const type of MEDIA_TYPES) {
        assert.ok(MEDIA_MIME_MAP[type], `Missing MIME map for ${type}`);
        assert.ok(Array.isArray(MEDIA_MIME_MAP[type]));
      }
    });
  });
});
