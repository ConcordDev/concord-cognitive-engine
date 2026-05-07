/**
 * Concord — Media DTU Architecture
 *
 * Extends the DTU system with media-specific fields and helpers for
 * audio, video, image, document, and live stream content types.
 *
 * Media DTUs wrap standard DTUs with additional metadata:
 *   - mediaType, duration, resolution, codec, bitrate
 *   - thumbnail generation and storage
 *   - HLS manifest references for streaming
 *   - Transcode pipeline status tracking
 *   - Storage tier management (hot/warm/cold)
 *   - Engagement tracking (views, likes, comments)
 */

import { randomUUID } from "node:crypto";

// ── Constants ─────────────────────────────────────────────────────────────

export const MEDIA_TYPES = ["audio", "video", "image", "document", "stream"];

export const TRANSCODE_STATUSES = ["pending", "processing", "ready", "failed"];

export const STORAGE_TIERS = ["hot", "warm", "cold"];

export const MEDIA_MIME_MAP = {
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/aac", "audio/webm"],
  video: ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"],
  image: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif"],
  document: ["application/pdf", "text/plain", "text/markdown", "application/epub+zip"],
  stream: ["application/x-mpegURL", "application/vnd.apple.mpegurl"],
};

export const QUALITY_PRESETS = {
  audio: {
    low: { bitrate: 64000, codec: "aac", sampleRate: 22050 },
    medium: { bitrate: 128000, codec: "aac", sampleRate: 44100 },
    high: { bitrate: 256000, codec: "aac", sampleRate: 48000 },
    lossless: { bitrate: 1411000, codec: "flac", sampleRate: 96000 },
  },
  video: {
    "360p": { width: 640, height: 360, bitrate: 800000, codec: "h264" },
    "480p": { width: 854, height: 480, bitrate: 1500000, codec: "h264" },
    "720p": { width: 1280, height: 720, bitrate: 3000000, codec: "h264" },
    "1080p": { width: 1920, height: 1080, bitrate: 6000000, codec: "h264" },
    "4k": { width: 3840, height: 2160, bitrate: 15000000, codec: "h265" },
  },
};

export const MAX_FILE_SIZES = {
  audio: 500 * 1024 * 1024,     // 500MB
  video: 5 * 1024 * 1024 * 1024, // 5GB
  image: 50 * 1024 * 1024,      // 50MB
  document: 100 * 1024 * 1024,  // 100MB
  stream: 0, // streams are unbounded
};

// ── Media State ───────────────────────────────────────────────────────────

function getMediaState(STATE) {
  if (!STATE._media) {
    STATE._media = {
      mediaDTUs: new Map(),        // mediaId -> media DTU object
      mediaBlobs: new Map(),       // mediaId -> Buffer (actual file binary data)
      views: new Map(),            // mediaId -> Set<userId>
      likes: new Map(),            // mediaId -> Set<userId>
      comments: new Map(),         // mediaId -> comment[]
      transcodeJobs: new Map(),    // jobId -> { mediaId, status, progress, quality }
      storageStats: {
        totalSize: 0,
        hotTierSize: 0,
        warmTierSize: 0,
        coldTierSize: 0,
      },
      metrics: {
        totalUploads: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalTranscodes: 0,
        activeStreams: 0,
      },
    };
  }
  return STATE._media;
}

// ── Media DTU CRUD ────────────────────────────────────────────────────────

/**
 * Create a new media DTU with media-specific metadata.
 *
 * @param {object} STATE - Global application state
 * @param {object} params - Media creation parameters
 * @param {string} params.authorId - ID of the uploading user
 * @param {string} params.title - Content title
 * @param {string} params.description - Content description
 * @param {string} params.mediaType - One of MEDIA_TYPES
 * @param {string} params.mimeType - MIME type of the uploaded file
 * @param {number} [params.duration] - Duration in seconds (audio/video)
 * @param {object} [params.resolution] - { width, height } (video/image)
 * @param {string} [params.codec] - Media codec
 * @param {number} [params.bitrate] - Bitrate in bps
 * @param {number} [params.fileSize] - File size in bytes
 * @param {string} [params.originalFilename] - Original uploaded filename
 * @param {string[]} [params.tags] - Content tags
 * @param {string} [params.privacy] - 'public' | 'private' | 'followers-only'
 * @param {string} [params.tier] - DTU tier
 * @returns {{ ok: boolean, mediaDTU?: object, error?: string }}
 */
export function createMediaDTU(STATE, params) {
  const media = getMediaState(STATE);

  const {
    authorId,
    title,
    description = "",
    mediaType,
    mimeType,
    duration,
    resolution,
    codec,
    bitrate,
    fileSize = 0,
    originalFilename = "",
    tags = [],
    privacy = "public",
    tier = "regular",
  } = params;

  // Validate
  if (!authorId) return { ok: false, error: "authorId is required" };
  if (!title) return { ok: false, error: "title is required" };
  if (!mediaType || !MEDIA_TYPES.includes(mediaType)) {
    return { ok: false, error: `Invalid mediaType. Must be one of: ${MEDIA_TYPES.join(", ")}` };
  }

  // Validate file size
  const maxSize = MAX_FILE_SIZES[mediaType];
  if (maxSize && fileSize > maxSize) {
    return { ok: false, error: `File exceeds maximum size of ${formatBytes(maxSize)} for ${mediaType}` };
  }

  const now = new Date().toISOString();
  const mediaId = `media-${randomUUID()}`;

  // Scope mirrors privacy. A private upload is NEVER tagged "global" — that
  // was previously a latent leak waiting for any future code that read
  // `scope` to treat private media as world-visible.
  const resolvedScope = privacy === "public" ? "global" : "user";

  const mediaDTU = {
    id: mediaId,
    type: "media",
    title,
    description,
    author: authorId,
    tags,
    tier,
    scope: resolvedScope,
    createdAt: now,
    updatedAt: now,

    // Media-specific fields
    mediaType,
    mimeType: mimeType || "application/octet-stream",
    duration: duration || null,
    resolution: resolution || null,
    codec: codec || null,
    bitrate: bitrate || null,
    fileSize,
    originalFilename,
    privacy,

    // Thumbnail
    thumbnail: null,

    // HLS streaming
    hlsManifest: null,
    hlsSegments: [],

    // Transcode
    transcodeStatus: mediaType === "image" || mediaType === "document" ? "ready" : "pending",
    transcodeVariants: [],

    // Storage reference
    storageRef: {
      tier: "hot",
      path: `media/${mediaType}/${mediaId}`,
      size: fileSize,
    },

    // Engagement
    engagement: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    },

    // Stream-specific (only for live streams)
    stream: mediaType === "stream" ? {
      isLive: false,
      viewerCount: 0,
      startedAt: null,
      endedAt: null,
    } : null,

    // Waveform data (audio)
    waveform: mediaType === "audio" ? generateWaveform(64) : null,
  };

  // Store in media state
  media.mediaDTUs.set(mediaId, mediaDTU);
  media.views.set(mediaId, new Set());
  media.likes.set(mediaId, new Set());
  media.comments.set(mediaId, []);

  // Also store as a DTU in the main DTU store if available
  if (STATE.dtus) {
    STATE.dtus.set(mediaId, mediaDTU);
  }

  // Update storage stats
  media.storageStats.totalSize += fileSize;
  media.storageStats.hotTierSize += fileSize;
  media.metrics.totalUploads++;

  return { ok: true, mediaDTU };
}

/**
 * Get a media DTU by ID.
 */
export function getMediaDTU(STATE, mediaId) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };

  // Update engagement counts
  dtu.engagement.views = (media.views.get(mediaId) || new Set()).size;
  dtu.engagement.likes = (media.likes.get(mediaId) || new Set()).size;
  dtu.engagement.comments = (media.comments.get(mediaId) || []).length;

  return { ok: true, mediaDTU: dtu };
}

/**
 * Store binary data for a media DTU.
 * @param {object} STATE
 * @param {string} mediaId
 * @param {Buffer} buffer - The raw file bytes
 */
export function storeMediaBlob(STATE, mediaId, buffer) {
  const media = getMediaState(STATE);
  if (!media.mediaDTUs.has(mediaId)) return { ok: false, error: "Media not found" };
  media.mediaBlobs.set(mediaId, buffer);
  // Update fileSize on the DTU
  const dtu = media.mediaDTUs.get(mediaId);
  if (dtu) {
    dtu.fileSize = buffer.length;
    dtu.transcodeStatus = "ready"; // mark as ready since we have the actual data
  }
  media.storageStats.totalSize += buffer.length;
  media.storageStats.hotTierSize += buffer.length;
  return { ok: true, size: buffer.length };
}

/**
 * Retrieve binary data for a media DTU.
 * @param {object} STATE
 * @param {string} mediaId
 * @returns {{ ok: boolean, buffer?: Buffer, mimeType?: string }}
 */
export function getMediaBlob(STATE, mediaId) {
  const media = getMediaState(STATE);
  const buffer = media.mediaBlobs.get(mediaId);
  if (!buffer) return { ok: false, error: "Media binary data not found" };
  const dtu = media.mediaDTUs.get(mediaId);
  return { ok: true, buffer, mimeType: dtu?.mimeType || "application/octet-stream", fileSize: buffer.length };
}

/**
 * Decide whether `viewerId` is allowed to see `mediaDTU`.
 *
 * Rules (must match getMediaFeed's privacy filter exactly so feed
 * visibility and direct-access checks can't diverge):
 *   • public           → anyone (including anonymous)
 *   • private          → author only
 *   • followers-only   → author or users in the author's follower set
 *
 * Returned as a structured result so route handlers can surface a
 * reason in the error response.
 *
 * @param {object} STATE
 * @param {object} mediaDTU
 * @param {string|null} viewerId
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAccessMediaDTU(STATE, mediaDTU, viewerId) {
  if (!mediaDTU) return { allowed: false, reason: "Media not found" };

  const privacy = mediaDTU.privacy || "public";
  if (privacy === "public") return { allowed: true };

  if (!viewerId) return { allowed: false, reason: "Authentication required" };
  if (mediaDTU.author === viewerId) return { allowed: true };

  if (privacy === "followers-only") {
    const social = STATE._social;
    if (social && typeof social.follows?.get === "function") {
      const followSet = social.follows.get(viewerId) || new Set();
      if (followSet.has(mediaDTU.author)) return { allowed: true };
    }
    return { allowed: false, reason: "Followers-only content" };
  }

  // private (or anything else) → owner-only
  return { allowed: false, reason: "Private content" };
}

/**
 * Get a media DTU AND enforce viewer access in one call. Preferred
 * entry point for route handlers — returns 404 / 403 shaped results
 * so the caller can't accidentally forget the access check.
 *
 * @param {object} STATE
 * @param {string} mediaId
 * @param {string|null} viewerId
 * @returns {{ ok: boolean, mediaDTU?: object, status?: number, error?: string }}
 */
export function getMediaDTUForViewer(STATE, mediaId, viewerId) {
  const result = getMediaDTU(STATE, mediaId);
  if (!result.ok) return { ok: false, status: 404, error: "Media not found" };

  const access = canAccessMediaDTU(STATE, result.mediaDTU, viewerId);
  if (!access.allowed) {
    // Return 404 for unauthenticated/unauthorized users so we don't
    // leak the existence of private content via a 403.
    const status = !viewerId ? 401 : 404;
    return { ok: false, status, error: access.reason || "Not found" };
  }

  return { ok: true, mediaDTU: result.mediaDTU };
}

/**
 * Get binary data for a media DTU with viewer access enforcement.
 *
 * @param {object} STATE
 * @param {string} mediaId
 * @param {string|null} viewerId
 * @returns {{ ok: boolean, buffer?: Buffer, mimeType?: string, status?: number, error?: string }}
 */
export function getMediaBlobForViewer(STATE, mediaId, viewerId) {
  const gated = getMediaDTUForViewer(STATE, mediaId, viewerId);
  if (!gated.ok) return gated;
  const blob = getMediaBlob(STATE, mediaId);
  if (!blob.ok) return { ok: false, status: 404, error: blob.error };
  return blob;
}

/**
 * Update a media DTU.
 */
export function updateMediaDTU(STATE, mediaId, authorId, updates) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };
  if (dtu.author !== authorId) return { ok: false, error: "Not authorized to update this media" };

  const allowed = ["title", "description", "tags", "privacy", "tier", "thumbnail"];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      dtu[key] = updates[key];
    }
  }
  // Keep scope in lock-step with privacy so it can't drift back to "global"
  // when a user toggles an upload private.
  if (updates.privacy !== undefined) {
    dtu.scope = dtu.privacy === "public" ? "global" : "user";
  }
  dtu.updatedAt = new Date().toISOString();

  // Update in main DTU store
  if (STATE.dtus) {
    STATE.dtus.set(mediaId, dtu);
  }

  return { ok: true, mediaDTU: dtu };
}

/**
 * Delete a media DTU.
 */
export function deleteMediaDTU(STATE, mediaId, authorId) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };
  if (dtu.author !== authorId) return { ok: false, error: "Not authorized to delete this media" };

  // Clean up storage stats
  const size = dtu.storageRef?.size || 0;
  const storageTier = dtu.storageRef?.tier || "hot";
  media.storageStats.totalSize -= size;
  if (storageTier === "hot") media.storageStats.hotTierSize -= size;
  else if (storageTier === "warm") media.storageStats.warmTierSize -= size;
  else if (storageTier === "cold") media.storageStats.coldTierSize -= size;

  // Remove from all maps
  media.mediaDTUs.delete(mediaId);
  media.views.delete(mediaId);
  media.likes.delete(mediaId);
  media.comments.delete(mediaId);

  // Remove from main DTU store
  if (STATE.dtus) {
    STATE.dtus.delete(mediaId);
  }

  return { ok: true, mediaId };
}

// ── Engagement ────────────────────────────────────────────────────────────

/**
 * Record a view on a media DTU.
 */
export function recordView(STATE, mediaId, userId) {
  const media = getMediaState(STATE);
  if (!media.mediaDTUs.has(mediaId)) return { ok: false, error: "Media not found" };

  const viewSet = media.views.get(mediaId);
  const isNew = !viewSet.has(userId);
  viewSet.add(userId);

  if (isNew) {
    media.metrics.totalViews++;
    const dtu = media.mediaDTUs.get(mediaId);
    if (dtu) dtu.engagement.views = viewSet.size;
  }

  return { ok: true, mediaId, views: viewSet.size, isNew };
}

/**
 * Toggle like on a media DTU.
 */
export function toggleLike(STATE, mediaId, userId) {
  const media = getMediaState(STATE);
  if (!media.mediaDTUs.has(mediaId)) return { ok: false, error: "Media not found" };

  const likeSet = media.likes.get(mediaId);
  const wasLiked = likeSet.has(userId);

  if (wasLiked) {
    likeSet.delete(userId);
    media.metrics.totalLikes = Math.max(0, media.metrics.totalLikes - 1);
  } else {
    likeSet.add(userId);
    media.metrics.totalLikes++;
  }

  const dtu = media.mediaDTUs.get(mediaId);
  if (dtu) dtu.engagement.likes = likeSet.size;

  return { ok: true, mediaId, liked: !wasLiked, likes: likeSet.size };
}

/**
 * Add a comment to a media DTU.
 */
export function addComment(STATE, mediaId, userId, text) {
  const media = getMediaState(STATE);
  if (!media.mediaDTUs.has(mediaId)) return { ok: false, error: "Media not found" };
  if (!text || !text.trim()) return { ok: false, error: "Comment text is required" };

  const comment = {
    id: `comment-${randomUUID()}`,
    mediaId,
    userId,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    likes: 0,
  };

  media.comments.get(mediaId).push(comment);
  media.metrics.totalComments++;

  const dtu = media.mediaDTUs.get(mediaId);
  if (dtu) dtu.engagement.comments = media.comments.get(mediaId).length;

  return { ok: true, comment };
}

/**
 * Get comments for a media DTU.
 */
export function getComments(STATE, mediaId, options = {}) {
  const media = getMediaState(STATE);
  if (!media.mediaDTUs.has(mediaId)) return { ok: false, error: "Media not found" };

  const comments = media.comments.get(mediaId) || [];
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  // Sort by newest first
  const sorted = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    ok: true,
    comments: sorted.slice(offset, offset + limit),
    total: comments.length,
  };
}

// ── Transcode Pipeline ────────────────────────────────────────────────────

/**
 * Initiate a transcode job for a media DTU.
 * In production this would dispatch to ffmpeg workers;
 * here we simulate the pipeline with status tracking.
 */
export function initiateTranscode(STATE, mediaId, targetQuality) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };

  if (dtu.mediaType !== "audio" && dtu.mediaType !== "video") {
    return { ok: false, error: "Transcode only supported for audio and video" };
  }

  const presets = QUALITY_PRESETS[dtu.mediaType];
  if (!presets || !presets[targetQuality]) {
    return { ok: false, error: `Invalid quality preset: ${targetQuality}. Available: ${Object.keys(presets).join(", ")}` };
  }

  const preset = presets[targetQuality];
  const jobId = `transcode-${randomUUID()}`;

  const job = {
    jobId,
    mediaId,
    targetQuality,
    preset,
    status: "processing",
    progress: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  media.transcodeJobs.set(jobId, job);
  dtu.transcodeStatus = "processing";
  media.metrics.totalTranscodes++;

  // Simulate transcode completion (in production this would be async worker)
  simulateTranscodeProgress(media, dtu, job);

  return { ok: true, job };
}

/**
 * Simulate transcode progress updates.
 * In production, this would be replaced by actual ffmpeg worker callbacks.
 */
function simulateTranscodeProgress(media, dtu, job) {
  const steps = [25, 50, 75, 100];
  let stepIdx = 0;

  const interval = setInterval(() => {
    if (stepIdx >= steps.length) {
      clearInterval(interval);
      return;
    }

    job.progress = steps[stepIdx];
    if (steps[stepIdx] === 100) {
      job.status = "ready";
      job.completedAt = new Date().toISOString();

      // Add transcode variant to the DTU
      const variant = {
        quality: job.targetQuality,
        ...job.preset,
        jobId: job.jobId,
        ready: true,
        path: `${dtu.storageRef.path}/${job.targetQuality}`,
      };
      dtu.transcodeVariants.push(variant);

      // Generate HLS manifest reference
      if (dtu.mediaType === "video") {
        dtu.hlsManifest = `/api/media/${dtu.id}/manifest.m3u8`;
        dtu.hlsSegments.push({
          quality: job.targetQuality,
          segmentCount: Math.ceil((dtu.duration || 60) / 10),
          segmentDuration: 10,
        });
      }

      // If all expected transcodes are done, mark as ready
      dtu.transcodeStatus = "ready";
    }

    stepIdx++;
  }, 500);
}

/**
 * Get transcode job status.
 */
export function getTranscodeStatus(STATE, jobId) {
  const media = getMediaState(STATE);
  const job = media.transcodeJobs.get(jobId);
  if (!job) return { ok: false, error: "Transcode job not found" };
  return { ok: true, job };
}

// ── Thumbnail Generation ──────────────────────────────────────────────────

/**
 * Generate a thumbnail for a media DTU.
 * In production this would extract a frame (video) or resize (image).
 * Here we store a reference and mark it as generated.
 */
export function generateThumbnail(STATE, mediaId) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };

  const thumbnailPath = `thumbnails/${dtu.mediaType}/${mediaId}.jpg`;
  dtu.thumbnail = thumbnailPath;
  dtu.updatedAt = new Date().toISOString();

  return { ok: true, mediaId, thumbnail: thumbnailPath };
}

// ── HLS Manifest ──────────────────────────────────────────────────────────

/**
 * Generate an HLS manifest for a video media DTU.
 * Returns a valid M3U8 playlist referencing available quality variants.
 */
export function generateHLSManifest(STATE, mediaId) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };
  if (dtu.mediaType !== "video" && dtu.mediaType !== "stream") {
    return { ok: false, error: "HLS manifest only available for video and stream types" };
  }

  const variants = dtu.transcodeVariants.filter(v => v.ready);
  if (variants.length === 0 && dtu.transcodeStatus !== "ready") {
    return { ok: false, error: "No transcoded variants available yet" };
  }

  // Build master playlist
  let manifest = "#EXTM3U\n#EXT-X-VERSION:3\n";

  if (variants.length === 0) {
    // Provide a single-quality fallback
    const dur = dtu.duration || 60;
    const segCount = Math.ceil(dur / 10);
    manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${dtu.bitrate || 3000000},RESOLUTION=${dtu.resolution?.width || 1920}x${dtu.resolution?.height || 1080}\n`;
    manifest += `/api/media/${mediaId}/stream?quality=original\n`;
  } else {
    for (const variant of variants) {
      const bw = variant.bitrate || 3000000;
      const res = variant.width && variant.height ? `,RESOLUTION=${variant.width}x${variant.height}` : "";
      manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bw}${res}\n`;
      manifest += `/api/media/${mediaId}/stream?quality=${variant.quality}\n`;
    }
  }

  return { ok: true, manifest, contentType: "application/vnd.apple.mpegurl" };
}

// ── Storage Tier Management ───────────────────────────────────────────────

/**
 * Move a media DTU to a different storage tier.
 * Hot = fast access (SSD), Warm = standard (HDD), Cold = archive (object store).
 */
export function moveStorageTier(STATE, mediaId, targetTier) {
  const media = getMediaState(STATE);
  const dtu = media.mediaDTUs.get(mediaId);
  if (!dtu) return { ok: false, error: "Media not found" };
  if (!STORAGE_TIERS.includes(targetTier)) {
    return { ok: false, error: `Invalid tier. Must be one of: ${STORAGE_TIERS.join(", ")}` };
  }

  const currentTier = dtu.storageRef.tier;
  if (currentTier === targetTier) return { ok: true, mediaId, tier: targetTier, changed: false };

  const size = dtu.storageRef.size;

  // Update tier size stats
  if (currentTier === "hot") media.storageStats.hotTierSize -= size;
  else if (currentTier === "warm") media.storageStats.warmTierSize -= size;
  else if (currentTier === "cold") media.storageStats.coldTierSize -= size;

  if (targetTier === "hot") media.storageStats.hotTierSize += size;
  else if (targetTier === "warm") media.storageStats.warmTierSize += size;
  else if (targetTier === "cold") media.storageStats.coldTierSize += size;

  dtu.storageRef.tier = targetTier;
  dtu.storageRef.path = `media/${targetTier}/${dtu.mediaType}/${mediaId}`;
  dtu.updatedAt = new Date().toISOString();

  return { ok: true, mediaId, tier: targetTier, changed: true };
}

// ── Feed & Discovery ──────────────────────────────────────────────────────

/**
 * Get a media feed — supports for-you, following, and trending modes.
 */
export function getMediaFeed(STATE, userId, options = {}) {
  const media = getMediaState(STATE);
  const tab = options.tab || "for-you";
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const mediaType = options.mediaType;

  let items = Array.from(media.mediaDTUs.values());

  // Filter by privacy
  items = items.filter(dtu => {
    if (dtu.privacy === "public") return true;
    if (dtu.privacy === "private" && dtu.author === userId) return true;
    if (dtu.privacy === "followers-only") {
      // Check if user follows the author
      const social = STATE._social;
      if (!social) return dtu.author === userId;
      const followSet = social.follows.get(userId) || new Set();
      return followSet.has(dtu.author) || dtu.author === userId;
    }
    return false;
  });

  // Filter by media type
  if (mediaType) {
    items = items.filter(dtu => dtu.mediaType === mediaType);
  }

  // Tab-specific filtering and sorting
  if (tab === "following") {
    const social = STATE._social;
    if (social) {
      const followSet = social.follows.get(userId) || new Set();
      items = items.filter(dtu => followSet.has(dtu.author));
    } else {
      items = [];
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (tab === "trending") {
    // Score by engagement + recency
    const now = Date.now();
    items.sort((a, b) => {
      const scoreA = computeEngagementScore(a, now);
      const scoreB = computeEngagementScore(b, now);
      return scoreB - scoreA;
    });
  } else {
    // "for-you" — mix of recent + engaging content
    const now = Date.now();
    items.sort((a, b) => {
      const recencyA = 1 / (1 + (now - new Date(a.createdAt).getTime()) / 86400000);
      const recencyB = 1 / (1 + (now - new Date(b.createdAt).getTime()) / 86400000);
      const engA = computeEngagementScore(a, now);
      const engB = computeEngagementScore(b, now);
      return (engB * 0.6 + recencyB * 0.4) - (engA * 0.6 + recencyA * 0.4);
    });
  }

  const feedItems = items.slice(offset, offset + limit).map(dtu => ({
    id: dtu.id,
    title: dtu.title,
    description: dtu.description,
    mediaType: dtu.mediaType,
    thumbnail: dtu.thumbnail,
    duration: dtu.duration,
    resolution: dtu.resolution,
    author: dtu.author,
    authorName: getAuthorName(STATE, dtu.author),
    engagement: { ...dtu.engagement },
    createdAt: dtu.createdAt,
    privacy: dtu.privacy,
    tags: dtu.tags,
    transcodeStatus: dtu.transcodeStatus,
    liked: (media.likes.get(dtu.id) || new Set()).has(userId),
    waveform: dtu.waveform,
    stream: dtu.stream,
  }));

  return {
    ok: true,
    feed: feedItems,
    total: items.length,
    tab,
  };
}

/**
 * List all media by a specific author.
 */
export function getMediaByAuthor(STATE, authorId, options = {}) {
  const media = getMediaState(STATE);
  const limit = options.limit || 20;
  const offset = options.offset || 0;

  let items = Array.from(media.mediaDTUs.values())
    .filter(dtu => dtu.author === authorId);

  // If not the owner, filter out private content
  if (options.viewerId && options.viewerId !== authorId) {
    items = items.filter(dtu => dtu.privacy === "public" || dtu.privacy === "followers-only");
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    ok: true,
    media: items.slice(offset, offset + limit),
    total: items.length,
  };
}

// ── Media Metrics ─────────────────────────────────────────────────────────

/**
 * Get media system metrics.
 */
export function getMediaMetrics(STATE) {
  const media = getMediaState(STATE);
  return {
    ok: true,
    ...media.metrics,
    storage: { ...media.storageStats },
    totalMedia: media.mediaDTUs.size,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compute an engagement score for ranking.
 */
function computeEngagementScore(dtu, now) {
  const views = dtu.engagement?.views || 0;
  const likes = dtu.engagement?.likes || 0;
  const comments = dtu.engagement?.comments || 0;
  const ageDays = (now - new Date(dtu.createdAt).getTime()) / 86400000;
  const recencyDecay = Math.max(0, 1 - ageDays * 0.03);

  return (likes * 3 + comments * 5 + views * 0.5) * recencyDecay;
}

/**
 * Get author display name from social profiles.
 */
function getAuthorName(STATE, authorId) {
  const social = STATE._social;
  if (social && social.profiles.has(authorId)) {
    return social.profiles.get(authorId).displayName;
  }
  return authorId;
}

/**
 * Generate a synthetic waveform for audio visualization.
 * In production, this would be computed from actual audio samples.
 */
function generateWaveform(length = 64) {
  return Array.from({ length }, (_, i) => {
    const base = Math.sin(i * 0.3) * 0.3 + 0.5;
    const noise = Math.random() * 0.3;
    return Math.round(Math.min(1, Math.max(0.05, base + noise - 0.15)) * 100);
  });
}

/**
 * Format bytes for display.
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Detect media type from MIME type.
 */
export function detectMediaType(mimeType) {
  for (const [type, mimes] of Object.entries(MEDIA_MIME_MAP)) {
    if (mimes.includes(mimeType)) return type;
  }
  // Fallback by prefix
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return "document";
}
