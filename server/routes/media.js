/**
 * Concord — Media Upload & Transcode Pipeline Routes
 *
 * Provides:
 *   POST /api/media/upload          - Multipart file upload, create media DTU
 *   POST /api/media/upload/url      - Remote URL ingest
 *   GET  /api/media/:id             - Get media DTU with streaming URLs
 *   GET  /api/media/:id/stream      - Stream media content (range requests)
 *   GET  /api/media/:id/thumbnail   - Get thumbnail
 *   GET  /api/media/:id/manifest.m3u8 - HLS manifest
 *   POST /api/media/:id/transcode   - Trigger transcode to different quality
 *   GET  /api/media/feed            - Media feed (for-you, following, trending)
 *   POST /api/media/:id/view        - Record view
 *   POST /api/media/:id/like        - Like/unlike
 *   POST /api/media/:id/comment     - Add comment
 *   GET  /api/media/:id/comments    - Get comments
 *   DELETE /api/media/:id           - Delete media
 */

import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ValidationError, NotFoundError } from "../lib/errors.js";
import { validateSafeFetchUrl } from "../lib/ssrf-guard.js";
import {
  createMediaDTU,
  getMediaDTU,
  getMediaDTUForViewer,
  canAccessMediaDTU,
  updateMediaDTU,
  deleteMediaDTU,
  recordView,
  toggleLike,
  addComment,
  getComments,
  initiateTranscode,
  generateThumbnail,
  generateHLSManifest,
  getMediaFeed,
  getMediaByAuthor,
  getMediaMetrics,
  detectMediaType,
  MEDIA_TYPES,
  QUALITY_PRESETS,
  MAX_FILE_SIZES,
} from "../lib/media-dtu.js";

/**
 * Create the media routes router.
 * Follows the same pattern as film-studio and connective-tissue routes.
 *
 * @param {{ STATE: object }} deps - Dependencies injected from server.js
 * @returns {Router}
 */
// ── MIME Allowlist & Magic Bytes Validation ─────────────────────────────────
// Category 1 (Adversarial): Reject disallowed file types and detect MIME spoofing
// by comparing declared Content-Type against actual file magic bytes.

const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac',
  'video/mp4', 'video/webm',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/json',
  'application/octet-stream', // fallback for unknown binary
]);

const MAGIC_BYTE_SIGNATURES = {
  'image/jpeg':  [[0xFF, 0xD8, 0xFF]],
  'image/png':   [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif':   [[0x47, 0x49, 0x46, 0x38]],
  'image/webp':  [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  'audio/mpeg':  [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]], // MP3 + ID3
  'audio/ogg':   [[0x4F, 0x67, 0x67, 0x53]],
  'audio/flac':  [[0x66, 0x4C, 0x61, 0x43]],
  'video/mp4':   [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]], // ftyp
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

/**
 * Validate a MIME type against the allowlist and optionally check magic bytes.
 * @param {string} mimeType - Declared MIME type
 * @param {string|Buffer|null} dataOrBuffer - Base64 string or Buffer of file data (first bytes suffice)
 * @returns {{ ok: boolean, error?: string }}
 */
function validateMediaMimeType(mimeType, dataOrBuffer) {
  if (!ALLOWED_UPLOAD_MIMES.has(mimeType)) {
    return { ok: false, error: `File type not allowed: ${mimeType}` };
  }
  const rules = MAGIC_BYTE_SIGNATURES[mimeType];
  if (rules && dataOrBuffer) {
    const buf = typeof dataOrBuffer === 'string'
      ? Buffer.from(dataOrBuffer.slice(0, 100), 'base64')
      : (Buffer.isBuffer(dataOrBuffer) ? dataOrBuffer.slice(0, 100) : null);
    if (buf && buf.length >= 2) {
      const matches = rules.some(magic =>
        magic.every((byte, i) => i < buf.length && buf[i] === byte)
      );
      if (!matches) {
        return { ok: false, error: 'File content does not match declared MIME type (magic bytes mismatch)' };
      }
    }
  }
  return { ok: true };
}

/**
 * Validate a URL to prevent SSRF attacks.
 * Thin wrapper around the shared ssrf-guard module — rejects private IPs,
 * CGNAT, IPv4-mapped IPv6, cloud metadata, decimal-encoded IPs, and
 * non-http(s) schemes. Also resolves DNS and rejects the URL if any
 * resolution lands in a reserved range.
 *
 * NOTE: this function is async now. Legacy callers that used it
 * synchronously must `await` the result.
 */
async function validateUrl(urlString) {
  const result = await validateSafeFetchUrl(urlString);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export default function createMediaRouter({ STATE }) {
  const router = Router();

  // ── Upload ────────────────────────────────────────────────────────────

  /**
   * POST /upload — Accept multipart file upload and create a media DTU.
   *
   * Since multer may not be installed, we accept JSON-based uploads with
   * base64-encoded data or file metadata. In production, this would use
   * multer for proper multipart handling.
   *
   * Body (JSON):
   *   - title: string (required)
   *   - description: string
   *   - mediaType: 'audio' | 'video' | 'image' | 'document' | 'stream'
   *   - mimeType: string
   *   - fileSize: number (bytes)
   *   - originalFilename: string
   *   - duration: number (seconds, for audio/video)
   *   - resolution: { width, height } (for video/image)
   *   - codec: string
   *   - bitrate: number
   *   - tags: string[]
   *   - privacy: 'public' | 'private' | 'followers-only'
   *   - tier: string
   *   - data: string (base64-encoded file data, optional)
   */
  router.post("/upload", asyncHandler(async (req, res) => {
    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ ok: false, error: "Authentication required" });

    const {
      title,
      description,
      mediaType,
      mimeType,
      fileSize = 0,
      originalFilename,
      duration,
      resolution,
      codec,
      bitrate,
      tags,
      privacy,
      tier,
      data,
    } = req.body;

    if (!title) throw new ValidationError("title is required");

    // ── MIME allowlist + magic bytes validation ──────────────────────────
    if (mimeType) {
      const mimeCheck = validateMediaMimeType(mimeType, data || null);
      if (!mimeCheck.ok) throw new ValidationError(mimeCheck.error);
    }

    // Auto-detect media type from MIME if not specified
    const resolvedMediaType = mediaType || (mimeType ? detectMediaType(mimeType) : null);
    if (!resolvedMediaType) {
      throw new ValidationError("mediaType or mimeType is required");
    }

    const result = createMediaDTU(STATE, {
      authorId,
      title,
      description,
      mediaType: resolvedMediaType,
      mimeType,
      fileSize,
      originalFilename,
      duration,
      resolution,
      codec,
      bitrate,
      tags,
      privacy,
      tier,
    });

    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    // Auto-generate thumbnail
    generateThumbnail(STATE, result.mediaDTU.id);

    // Auto-initiate transcode for audio/video
    if (resolvedMediaType === "audio" || resolvedMediaType === "video") {
      const defaultQualities = resolvedMediaType === "audio"
        ? ["medium", "high"]
        : ["720p", "1080p"];

      for (const quality of defaultQualities) {
        initiateTranscode(STATE, result.mediaDTU.id, quality);
      }
    }

    res.status(201).json({
      ok: true,
      mediaDTU: result.mediaDTU,
    });
  }));

  // ── Upload via URL ────────────────────────────────────────────────────

  /**
   * POST /upload/url — Ingest media from a remote URL.
   *
   * Body:
   *   - url: string (required) — URL of the media to ingest
   *   - title: string (required)
   *   - description: string
   *   - mediaType: string
   *   - tags: string[]
   *   - privacy: string
   */
  router.post("/upload/url", asyncHandler(async (req, res) => {
    // SECURITY: authorId comes ONLY from the authenticated session.
    // Previously we accepted `req.body.authorId` as a fallback, which let
    // unauthenticated callers forge attribution onto any user.
    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ ok: false, error: "Authentication required" });

    const { url, title, description, mediaType, tags, privacy, tier } = req.body;

    if (!url) throw new ValidationError("url is required");
    if (!title) throw new ValidationError("title is required");

    // SSRF protection: resolve DNS, reject private ranges. Async.
    const urlCheck = await validateUrl(url);
    if (!urlCheck.ok) throw new ValidationError(urlCheck.error);

    // In production, we would fetch the URL, determine MIME type, file size, etc.
    // Here we create the media DTU with the URL as a storage reference.
    const resolvedMediaType = mediaType || "video";

    const result = createMediaDTU(STATE, {
      authorId,
      title,
      description,
      mediaType: resolvedMediaType,
      mimeType: resolvedMediaType === "video" ? "video/mp4" : `${resolvedMediaType}/unknown`,
      originalFilename: url.split("/").pop() || "remote-media",
      tags,
      privacy,
      tier,
    });

    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    // Update storage ref to point to the remote URL
    result.mediaDTU.storageRef.remoteUrl = url;
    result.mediaDTU.storageRef.ingestStatus = "pending";

    // Generate thumbnail
    generateThumbnail(STATE, result.mediaDTU.id);

    res.status(201).json({
      ok: true,
      mediaDTU: result.mediaDTU,
      ingestStatus: "pending",
    });
  }));

  // ── Get Media DTU ─────────────────────────────────────────────────────

  /**
   * GET /:id — Get a media DTU with streaming URLs and engagement data.
   *
   * Enforces privacy: private uploads are only readable by their author,
   * followers-only uploads by the author or an active follower.
   */
  router.get("/:id", asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || null;
    const gated = getMediaDTUForViewer(STATE, req.params.id, viewerId);
    if (!gated.ok) {
      if (gated.status === 401) return res.status(401).json({ ok: false, error: gated.error });
      // 404 for both "not found" and "no access" to avoid leaking existence
      throw new NotFoundError("Media", req.params.id);
    }

    const mediaDTU = gated.mediaDTU;
    const userId = viewerId;

    // Build streaming URLs
    const streamingUrls = {
      stream: `/api/media/${mediaDTU.id}/stream`,
      thumbnail: mediaDTU.thumbnail ? `/api/media/${mediaDTU.id}/thumbnail` : null,
    };

    if (mediaDTU.mediaType === "video" || mediaDTU.mediaType === "stream") {
      streamingUrls.hlsManifest = `/api/media/${mediaDTU.id}/manifest.m3u8`;
    }

    // Check if user has liked
    const media = STATE._media;
    const liked = userId && media ? (media.likes.get(mediaDTU.id) || new Set()).has(userId) : false;

    res.json({
      ok: true,
      mediaDTU,
      streamingUrls,
      liked,
      availableQualities: mediaDTU.transcodeVariants
        .filter(v => v.ready)
        .map(v => v.quality),
    });
  }));

  // ── Stream ────────────────────────────────────────────────────────────

  /**
   * GET /:id/stream — Stream media content with range request support.
   *
   * In production, this would serve actual file bytes.
   * Here we return metadata about the stream and simulate range support.
   */
  router.get("/:id/stream", asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || null;
    const gated = getMediaDTUForViewer(STATE, req.params.id, viewerId);
    if (!gated.ok) {
      if (gated.status === 401) return res.status(401).json({ ok: false, error: gated.error });
      throw new NotFoundError("Media", req.params.id);
    }

    const mediaDTU = gated.mediaDTU;
    const quality = req.query.quality || "original";

    // In production: serve actual file bytes with range support
    // Here we return stream metadata
    const fileSize = mediaDTU.fileSize || 1024 * 1024; // 1MB default
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206).json({
        ok: true,
        streaming: true,
        mediaId: mediaDTU.id,
        quality,
        range: { start, end, total: fileSize },
        chunkSize,
        contentType: mediaDTU.mimeType,
        note: "In production, this returns actual binary data with Content-Range headers",
      });
    } else {
      res.json({
        ok: true,
        streaming: true,
        mediaId: mediaDTU.id,
        quality,
        fileSize,
        contentType: mediaDTU.mimeType,
        duration: mediaDTU.duration,
        note: "In production, this returns actual binary data",
      });
    }
  }));

  // ── Thumbnail ─────────────────────────────────────────────────────────

  /**
   * GET /:id/thumbnail — Get thumbnail for a media DTU.
   */
  router.get("/:id/thumbnail", asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || null;
    const gated = getMediaDTUForViewer(STATE, req.params.id, viewerId);
    if (!gated.ok) {
      if (gated.status === 401) return res.status(401).json({ ok: false, error: gated.error });
      throw new NotFoundError("Media", req.params.id);
    }

    const mediaDTU = gated.mediaDTU;
    if (!mediaDTU.thumbnail) {
      // Generate on the fly
      generateThumbnail(STATE, mediaDTU.id);
    }

    // In production, serve the actual image file
    res.json({
      ok: true,
      mediaId: mediaDTU.id,
      thumbnail: mediaDTU.thumbnail,
      note: "In production, this returns an actual image with proper Content-Type",
    });
  }));

  // ── HLS Manifest ─────────────────────────────────────────────────────

  /**
   * GET /:id/manifest.m3u8 — Get HLS master playlist.
   */
  router.get("/:id/manifest.m3u8", asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || null;
    const gated = getMediaDTUForViewer(STATE, req.params.id, viewerId);
    if (!gated.ok) {
      if (gated.status === 401) return res.status(401).json({ ok: false, error: gated.error });
      throw new NotFoundError("Media", req.params.id);
    }

    const result = generateHLSManifest(STATE, req.params.id);
    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    res.set("Content-Type", result.contentType);
    res.send(result.manifest);
  }));

  // ── Transcode ─────────────────────────────────────────────────────────

  /**
   * POST /:id/transcode — Trigger transcode to a specific quality preset.
   *
   * Body:
   *   - quality: string (e.g., '720p', '1080p', 'high', 'medium')
   */
  router.post("/:id/transcode", asyncHandler(async (req, res) => {
    const { quality } = req.body;
    if (!quality) throw new ValidationError("quality is required");

    const result = initiateTranscode(STATE, req.params.id, quality);
    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.status(202).json({
      ok: true,
      job: result.job,
    });
  }));

  // ── Media Feed ────────────────────────────────────────────────────────

  /**
   * GET /feed — Get media feed.
   *
   * Query params:
   *   - tab: 'for-you' | 'following' | 'trending' (default: 'for-you')
   *   - mediaType: filter by type
   *   - limit: number (default: 20)
   *   - offset: number (default: 0)
   */
  router.get("/feed", asyncHandler(async (req, res) => {
    // eslint-disable-next-line no-restricted-syntax
    // eslint-disable-next-line no-restricted-syntax
    const userId = req.user?.id || req.query.userId || "anonymous"; // safe: public-filter
    const { tab, mediaType, limit, offset } = req.query;

    const result = getMediaFeed(STATE, userId, {
      tab,
      mediaType,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });

    res.json(result);
  }));

  // ── Views ─────────────────────────────────────────────────────────────

  /**
   * POST /:id/view — Record a view on media.
   */
  router.post("/:id/view", asyncHandler(async (req, res) => {
    // SECURITY: identity from authenticated session only. Anonymous views
    // are bucketed per-IP so a caller can't forge someone else's userId
    // by sending it in the body.
    const userId = req.user?.id || `anon-${req.ip}`;

    const result = recordView(STATE, req.params.id, userId);
    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.json(result);
  }));

  // ── Likes ─────────────────────────────────────────────────────────────

  /**
   * POST /:id/like — Toggle like on media.
   */
  router.post("/:id/like", asyncHandler(async (req, res) => {
    // SECURITY: userId always comes from the authenticated session.
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });

    const result = toggleLike(STATE, req.params.id, userId);
    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.json(result);
  }));

  // ── Comments ──────────────────────────────────────────────────────────

  /**
   * POST /:id/comment — Add a comment.
   *
   * Body:
   *   - text: string (required)
   */
  router.post("/:id/comment", asyncHandler(async (req, res) => {
    // SECURITY: userId always comes from the authenticated session.
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });

    const { text } = req.body;
    if (!text) throw new ValidationError("Comment text is required");

    const result = addComment(STATE, req.params.id, userId, text);
    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.status(201).json(result);
  }));

  /**
   * GET /:id/comments — Get comments on media.
   *
   * Query params:
   *   - limit: number (default: 50)
   *   - offset: number (default: 0)
   */
  router.get("/:id/comments", asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;

    const result = getComments(STATE, req.params.id, {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.json(result);
  }));

  // ── Delete ────────────────────────────────────────────────────────────

  /**
   * DELETE /:id — Delete a media DTU.
   */
  router.delete("/:id", asyncHandler(async (req, res) => {
    // SECURITY: authorId from authenticated session — never from body.
    // The caller's ability to delete is enforced inside deleteMediaDTU()
    // which checks `dtu.author === authorId`.
    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ ok: false, error: "Authentication required" });

    const result = deleteMediaDTU(STATE, req.params.id, authorId);
    if (!result.ok) {
      if (result.error === "Media not found") throw new NotFoundError("Media", req.params.id);
      throw new ValidationError(result.error);
    }

    res.json(result);
  }));

  // ── Author Media ──────────────────────────────────────────────────────

  /**
   * GET /author/:authorId — Get all media by a specific author.
   */
  router.get("/author/:authorId", asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || req.query.viewerId;
    const { limit, offset } = req.query;

    const result = getMediaByAuthor(STATE, req.params.authorId, {
      viewerId,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });

    res.json(result);
  }));

  // ── Metrics ───────────────────────────────────────────────────────────

  /**
   * GET /metrics — Get media system metrics.
   */
  router.get("/metrics", asyncHandler(async (_req, res) => {
    const result = getMediaMetrics(STATE);
    res.json(result);
  }));

  // ── Constants ─────────────────────────────────────────────────────────

  /**
   * GET /constants — Get media system constants.
   */
  router.get("/constants", (_req, res) => {
    res.json({
      mediaTypes: MEDIA_TYPES,
      qualityPresets: QUALITY_PRESETS,
      maxFileSizes: MAX_FILE_SIZES,
    });
  });

  return router;
}
