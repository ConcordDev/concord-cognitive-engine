/**
 * Integration Test: Media Pipeline
 *
 * Tests the full media DTU lifecycle including:
 * - Create media DTU with file metadata
 * - Simulate transcode lifecycle (pending -> processing -> ready)
 * - Generate HLS manifest -> verify structure
 * - Storage tier assignment (hot -> warm -> cold based on access)
 * - View/like/comment lifecycle
 * - Media feed generation
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMediaDTU,
  getMediaDTU,
  recordView,
  toggleLike,
  addComment,
  getComments,
  initiateTranscode,
  getTranscodeStatus,
  generateThumbnail,
  generateHLSManifest,
  moveStorageTier,
  getMediaFeed,
  getMediaByAuthor,
  getMediaMetrics,
  MEDIA_TYPES,
  TRANSCODE_STATUSES,
  STORAGE_TIERS,
} from "../lib/media-dtu.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("Integration: Media Pipeline", () => {
  let STATE;

  beforeEach(() => {
    STATE = { dtus: new Map() };
  });

  // ── Create Media DTU with File Metadata ──────

  it("creates a video media DTU with full metadata", () => {
    const result = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "My Video",
      description: "A test video upload",
      mediaType: "video",
      mimeType: "video/mp4",
      duration: 120,
      resolution: { width: 1920, height: 1080 },
      codec: "h264",
      bitrate: 6000000,
      fileSize: 150 * 1024 * 1024,
      originalFilename: "my-video.mp4",
      tags: ["test", "video"],
      privacy: "public",
    });

    assert.ok(result.ok);
    assert.ok(result.mediaDTU);
    assert.equal(result.mediaDTU.mediaType, "video");
    assert.equal(result.mediaDTU.title, "My Video");
    assert.equal(result.mediaDTU.duration, 120);
    assert.equal(result.mediaDTU.resolution.width, 1920);
    assert.equal(result.mediaDTU.resolution.height, 1080);
    assert.equal(result.mediaDTU.fileSize, 150 * 1024 * 1024);
    assert.equal(result.mediaDTU.transcodeStatus, "pending");
    assert.equal(result.mediaDTU.storageRef.tier, "hot");
    assert.equal(result.mediaDTU.privacy, "public");
  });

  it("creates an audio media DTU with an honest null waveform (server does not decode compressed audio)", () => {
    // Was: asserted a fabricated 64-point waveform array. The server has no
    // audio decoder, so it cannot compute real peaks from mp3/webm/ogg/flac
    // bytes — `null` is the honest value; real peaks are computed
    // client-side from the decoded samples at record/upload time.
    const result = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "My Track",
      mediaType: "audio",
      mimeType: "audio/mpeg",
      duration: 240,
      bitrate: 320000,
      fileSize: 8 * 1024 * 1024,
    });

    assert.ok(result.ok);
    assert.equal(result.mediaDTU.mediaType, "audio");
    assert.equal(result.mediaDTU.waveform, null, "Server has no audio decoder — waveform must be honestly null, not fabricated");
    assert.equal(result.mediaDTU.transcodeStatus, "pending");
  });

  it("creates an image media DTU with ready transcode status", () => {
    const result = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "My Photo",
      mediaType: "image",
      mimeType: "image/jpeg",
      fileSize: 2 * 1024 * 1024,
    });

    assert.ok(result.ok);
    assert.equal(result.mediaDTU.mediaType, "image");
    assert.equal(result.mediaDTU.transcodeStatus, "ready", "Images should be ready immediately");
    assert.equal(result.mediaDTU.waveform, null, "Images should not have waveform");
  });

  it("rejects media DTU with missing required fields", () => {
    const result1 = createMediaDTU(STATE, {
      title: "No Author",
      mediaType: "video",
    });
    assert.ok(!result1.ok);
    assert.equal(result1.error, "authorId is required");

    const result2 = createMediaDTU(STATE, {
      authorId: "user-1",
      mediaType: "video",
    });
    assert.ok(!result2.ok);
    assert.equal(result2.error, "title is required");

    const result3 = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Bad Type",
      mediaType: "hologram",
    });
    assert.ok(!result3.ok);
    assert.ok(result3.error.includes("Invalid mediaType"));
  });

  it("rejects file exceeding maximum size", () => {
    const result = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Huge Image",
      mediaType: "image",
      mimeType: "image/png",
      fileSize: 100 * 1024 * 1024, // 100MB > 50MB limit
    });

    assert.ok(!result.ok);
    assert.ok(result.error.includes("exceeds maximum size"));
  });

  // ── Transcode Lifecycle ──────

  it("simulates transcode lifecycle: pending -> processing -> ready", async () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Transcode Test",
      mediaType: "video",
      mimeType: "video/mp4",
      duration: 60,
      resolution: { width: 1920, height: 1080 },
    });

    assert.equal(mediaDTU.transcodeStatus, "pending");

    // Initiate transcode
    const transcodeResult = initiateTranscode(STATE, mediaDTU.id, "720p");
    assert.ok(transcodeResult.ok);
    assert.equal(transcodeResult.job.status, "processing");
    assert.equal(transcodeResult.job.targetQuality, "720p");

    // Check status immediately (should be processing)
    const statusResult = getTranscodeStatus(STATE, transcodeResult.job.jobId);
    assert.ok(statusResult.ok);
    assert.equal(statusResult.job.status, "processing");

    // Wait for simulated completion
    await new Promise((r) => { setTimeout(r, 2500); });

    // After completion, job should be ready
    const finalStatus = getTranscodeStatus(STATE, transcodeResult.job.jobId);
    assert.ok(finalStatus.ok);
    assert.equal(finalStatus.job.status, "ready");
    assert.equal(finalStatus.job.progress, 100);

    // DTU should have transcode variant
    const dtuResult = getMediaDTU(STATE, mediaDTU.id);
    assert.ok(dtuResult.ok);
    assert.equal(dtuResult.mediaDTU.transcodeStatus, "ready");
    assert.ok(dtuResult.mediaDTU.transcodeVariants.length > 0);
  });

  it("rejects transcode for non-audio/video types", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Image",
      mediaType: "image",
      mimeType: "image/jpeg",
    });

    const result = initiateTranscode(STATE, mediaDTU.id, "720p");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("only supported for audio and video"));
  });

  it("rejects invalid quality preset", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Video",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    const result = initiateTranscode(STATE, mediaDTU.id, "8k");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("Invalid quality preset"));
  });

  // ── HLS Manifest Generation ──────

  it("generates valid HLS manifest for video", async () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "HLS Test",
      mediaType: "video",
      mimeType: "video/mp4",
      duration: 60,
      resolution: { width: 1920, height: 1080 },
      bitrate: 6000000,
    });

    // Initiate transcode and wait for completion
    initiateTranscode(STATE, mediaDTU.id, "720p");
    await new Promise((r) => { setTimeout(r, 2500); });

    const manifestResult = generateHLSManifest(STATE, mediaDTU.id);
    assert.ok(manifestResult.ok);
    assert.ok(manifestResult.manifest);
    assert.ok(manifestResult.manifest.startsWith("#EXTM3U"));
    assert.ok(manifestResult.manifest.includes("#EXT-X-VERSION:3"));
    assert.ok(manifestResult.manifest.includes("#EXT-X-STREAM-INF:"));
    assert.ok(manifestResult.manifest.includes("/api/media/"));
    assert.equal(manifestResult.contentType, "application/vnd.apple.mpegurl");
  });

  it("rejects HLS manifest for image type", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Image",
      mediaType: "image",
      mimeType: "image/jpeg",
    });

    const result = generateHLSManifest(STATE, mediaDTU.id);
    assert.ok(!result.ok);
    assert.ok(result.error.includes("only available for video"));
  });

  // ── Storage Tier Assignment ──────

  it("moves media through storage tiers: hot -> warm -> cold", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Tier Test",
      mediaType: "video",
      mimeType: "video/mp4",
      fileSize: 100 * 1024 * 1024,
    });

    assert.equal(mediaDTU.storageRef.tier, "hot");

    // Move to warm
    const warmResult = moveStorageTier(STATE, mediaDTU.id, "warm");
    assert.ok(warmResult.ok);
    assert.equal(warmResult.tier, "warm");
    assert.ok(warmResult.changed);

    // Verify DTU reflects new tier
    const dtuResult = getMediaDTU(STATE, mediaDTU.id);
    assert.equal(dtuResult.mediaDTU.storageRef.tier, "warm");

    // Move to cold
    const coldResult = moveStorageTier(STATE, mediaDTU.id, "cold");
    assert.ok(coldResult.ok);
    assert.equal(coldResult.tier, "cold");

    // Same tier returns changed: false
    const sameResult = moveStorageTier(STATE, mediaDTU.id, "cold");
    assert.ok(sameResult.ok);
    assert.ok(!sameResult.changed);
  });

  it("rejects invalid storage tier", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Bad Tier",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    const result = moveStorageTier(STATE, mediaDTU.id, "archive");
    assert.ok(!result.ok);
    assert.ok(result.error.includes("Invalid tier"));
  });

  // ── View / Like / Comment Lifecycle ──────

  it("records views on media DTU", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "View Test",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    // First view
    const view1 = recordView(STATE, mediaDTU.id, "viewer-1");
    assert.ok(view1.ok);
    assert.ok(view1.isNew);
    assert.equal(view1.views, 1);

    // Same user viewing again (not a new view)
    const view2 = recordView(STATE, mediaDTU.id, "viewer-1");
    assert.ok(view2.ok);
    assert.ok(!view2.isNew);
    assert.equal(view2.views, 1);

    // Different user
    const view3 = recordView(STATE, mediaDTU.id, "viewer-2");
    assert.ok(view3.ok);
    assert.ok(view3.isNew);
    assert.equal(view3.views, 2);
  });

  it("toggles likes on media DTU", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Like Test",
      mediaType: "audio",
      mimeType: "audio/mpeg",
    });

    // Like
    const like1 = toggleLike(STATE, mediaDTU.id, "user-2");
    assert.ok(like1.ok);
    assert.ok(like1.liked);
    assert.equal(like1.likes, 1);

    // Unlike
    const unlike = toggleLike(STATE, mediaDTU.id, "user-2");
    assert.ok(unlike.ok);
    assert.ok(!unlike.liked);
    assert.equal(unlike.likes, 0);

    // Multiple users liking
    toggleLike(STATE, mediaDTU.id, "user-2");
    toggleLike(STATE, mediaDTU.id, "user-3");
    toggleLike(STATE, mediaDTU.id, "user-4");

    const dtu = getMediaDTU(STATE, mediaDTU.id);
    assert.equal(dtu.mediaDTU.engagement.likes, 3);
  });

  it("adds and retrieves comments on media DTU", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Comment Test",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    // Add comments
    const c1 = addComment(STATE, mediaDTU.id, "user-2", "Great video!");
    assert.ok(c1.ok);
    assert.ok(c1.comment.id);
    assert.equal(c1.comment.text, "Great video!");

    const c2 = addComment(STATE, mediaDTU.id, "user-3", "Love it!");
    assert.ok(c2.ok);

    // Reject empty comment
    const c3 = addComment(STATE, mediaDTU.id, "user-2", "");
    assert.ok(!c3.ok);
    assert.equal(c3.error, "Comment text is required");

    // Retrieve comments
    const commentsResult = getComments(STATE, mediaDTU.id);
    assert.ok(commentsResult.ok);
    assert.equal(commentsResult.total, 2);
    assert.equal(commentsResult.comments.length, 2);

    // Verify engagement count
    const dtu = getMediaDTU(STATE, mediaDTU.id);
    assert.equal(dtu.mediaDTU.engagement.comments, 2);
  });

  // ── Media Feed Generation ──────

  it("generates media feed with multiple items", () => {
    // Create several media items
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Video 1",
      mediaType: "video",
      mimeType: "video/mp4",
      privacy: "public",
    });
    createMediaDTU(STATE, {
      authorId: "user-2",
      title: "Audio Track",
      mediaType: "audio",
      mimeType: "audio/mpeg",
      privacy: "public",
    });
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Photo",
      mediaType: "image",
      mimeType: "image/jpeg",
      privacy: "public",
    });

    const feed = getMediaFeed(STATE, "viewer-1");
    assert.ok(feed.ok);
    assert.equal(feed.feed.length, 3);
    assert.equal(feed.total, 3);
    assert.equal(feed.tab, "for-you");
  });

  it("private media is only visible to the author", () => {
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Private Video",
      mediaType: "video",
      mimeType: "video/mp4",
      privacy: "private",
    });
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Public Video",
      mediaType: "video",
      mimeType: "video/mp4",
      privacy: "public",
    });

    // Author can see both
    const authorFeed = getMediaFeed(STATE, "user-1");
    assert.equal(authorFeed.feed.length, 2);

    // Other user can only see public
    const otherFeed = getMediaFeed(STATE, "user-2");
    assert.equal(otherFeed.feed.length, 1);
    assert.equal(otherFeed.feed[0].title, "Public Video");
  });

  it("gets media by author", () => {
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Video A",
      mediaType: "video",
      mimeType: "video/mp4",
    });
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Video B",
      mediaType: "video",
      mimeType: "video/mp4",
    });
    createMediaDTU(STATE, {
      authorId: "user-2",
      title: "Other Video",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    const result = getMediaByAuthor(STATE, "user-1");
    assert.ok(result.ok);
    assert.equal(result.total, 2);
  });

  it("media metrics track correctly", () => {
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Metric Test",
      mediaType: "video",
      mimeType: "video/mp4",
      fileSize: 50 * 1024 * 1024,
    });

    const metrics = getMediaMetrics(STATE);
    assert.ok(metrics.ok);
    assert.equal(metrics.totalUploads, 1);
    assert.equal(metrics.totalMedia, 1);
    assert.equal(metrics.storage.totalSize, 50 * 1024 * 1024);
  });

  // ── Thumbnail Generation ──────

  it("generates thumbnail for media DTU", () => {
    const { mediaDTU } = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Thumb Test",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    assert.equal(mediaDTU.thumbnail, null);

    const thumbResult = generateThumbnail(STATE, mediaDTU.id);
    assert.ok(thumbResult.ok);
    assert.ok(thumbResult.thumbnail.includes("thumbnails/"));
    assert.ok(thumbResult.thumbnail.includes(mediaDTU.id));

    const dtu = getMediaDTU(STATE, mediaDTU.id);
    assert.equal(dtu.mediaDTU.thumbnail, thumbResult.thumbnail);
  });
});
