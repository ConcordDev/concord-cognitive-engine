/**
 * Concord City — Creator Streaming System
 *
 * Lets creators "go live" inside a city. Viewers can follow streams,
 * and DTUs created or sold during the stream are tracked so a summary
 * Stream DTU can be minted when the creator ends the broadcast.
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

// ── State ───────────────────────────────────────────────────────────────────

/** creatorId -> stream config */
const _activeStreams = new Map();

/** streamId -> Set<viewerId> */
const _streamViewers = new Map();

/** streamId -> dtuId[] */
const _streamDTUs = new LruMap();

/** streamId -> { viewerPeak, timeline } (extra bookkeeping) */
const _streamMeta = new LruMap();

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureViewerSet(streamId) {
  let set = _streamViewers.get(streamId);
  if (!set) {
    set = new Set();
    _streamViewers.set(streamId, set);
  }
  return set;
}

function ensureMeta(streamId) {
  let meta = _streamMeta.get(streamId);
  if (!meta) {
    meta = { viewerPeak: 0, timeline: [] };
    _streamMeta.set(streamId, meta);
  }
  return meta;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a live stream for a creator.
 *
 * @param {string} userId - Creator's user ID.
 * @param {{ cityId: string, title: string }} opts
 * @returns {object} The new stream config.
 */
export function startStream(userId, { cityId, title }) {
  if (_activeStreams.has(userId)) {
    throw new Error(`User ${userId} already has an active stream`);
  }

  const stream = {
    id: `stream_${randomUUID()}`,
    creatorId: userId,
    cityId,
    startedAt: new Date().toISOString(),
    viewerCount: 0,
    dtusCreated: 0,
    salesMade: 0,
    ccEarned: 0,
    status: "live",
    title,
  };

  _activeStreams.set(userId, stream);
  _streamViewers.set(stream.id, new Set());
  _streamDTUs.set(stream.id, []);
  _streamMeta.set(stream.id, { viewerPeak: 0, timeline: [] });

  logger.info("city-streaming", `Stream started: ${stream.id} by ${userId} in ${cityId}`, {
    streamId: stream.id,
    cityId,
  });

  return stream;
}

/**
 * End a creator's active stream and produce a summary.
 *
 * @param {string} userId
 * @returns {object} Stream summary including the generated Stream DTU.
 */
export function endStream(userId) {
  const stream = _activeStreams.get(userId);
  if (!stream) {
    throw new Error(`No active stream for user ${userId}`);
  }

  stream.status = "ended";
  stream.endedAt = new Date().toISOString();
  _activeStreams.delete(userId);

  const dtu = createStreamDTU(stream);

  const meta = _streamMeta.get(stream.id) ?? { viewerPeak: 0, timeline: [] };
  const summary = {
    streamId: stream.id,
    creatorId: stream.creatorId,
    cityId: stream.cityId,
    title: stream.title,
    startedAt: stream.startedAt,
    endedAt: stream.endedAt,
    duration: new Date(stream.endedAt) - new Date(stream.startedAt),
    viewerPeak: meta.viewerPeak,
    dtusCreated: stream.dtusCreated,
    salesMade: stream.salesMade,
    ccEarned: stream.ccEarned,
    streamDTU: dtu,
  };

  logger.info("city-streaming", `Stream ended: ${stream.id}`, { summary });

  // Clean up viewer and DTU tracking (keep meta for historical queries via dtu)
  _streamViewers.delete(stream.id);

  return summary;
}

/**
 * Get a creator's active stream, if any.
 * @param {string} userId
 * @returns {object|undefined}
 */
export function getActiveStream(userId) {
  return _activeStreams.get(userId);
}

/**
 * A viewer follows (joins) a stream.
 *
 * @param {string} streamId
 * @param {string} viewerId
 */
export function followStream(streamId, viewerId) {
  const viewers = ensureViewerSet(streamId);
  viewers.add(viewerId);

  // Update viewer count on the stream config
  for (const [, stream] of _activeStreams) {
    if (stream.id === streamId) {
      stream.viewerCount = viewers.size;
      break;
    }
  }

  const meta = ensureMeta(streamId);
  if (viewers.size > meta.viewerPeak) {
    meta.viewerPeak = viewers.size;
  }
  meta.timeline.push({ event: "viewer-joined", viewerId, at: new Date().toISOString() });

  logger.debug("city-streaming", `Viewer ${viewerId} followed stream ${streamId}`);
}

/**
 * A viewer unfollows (leaves) a stream.
 *
 * @param {string} streamId
 * @param {string} viewerId
 */
export function unfollowStream(streamId, viewerId) {
  const viewers = _streamViewers.get(streamId);
  if (viewers) {
    viewers.delete(viewerId);

    for (const [, stream] of _activeStreams) {
      if (stream.id === streamId) {
        stream.viewerCount = viewers.size;
        break;
      }
    }
  }

  const meta = _streamMeta.get(streamId);
  if (meta) {
    meta.timeline.push({ event: "viewer-left", viewerId, at: new Date().toISOString() });
  }

  logger.debug("city-streaming", `Viewer ${viewerId} unfollowed stream ${streamId}`);
}

/**
 * Get the set of viewer IDs for a stream.
 * @param {string} streamId
 * @returns {Set<string>}
 */
export function getStreamViewers(streamId) {
  return _streamViewers.get(streamId) ?? new Set();
}

/**
 * List all active streams, optionally filtered by city.
 *
 * @param {string} [cityId]
 * @returns {object[]}
 */
export function listActiveStreams(cityId) {
  const result = [];
  for (const [, stream] of _activeStreams) {
    if (!cityId || stream.cityId === cityId) {
      result.push(stream);
    }
  }
  return result;
}

/**
 * Record a DTU that was created during a stream.
 *
 * @param {string} streamId
 * @param {string} dtuId
 */
export function recordStreamDTU(streamId, dtuId) {
  const dtus = _streamDTUs.get(streamId);
  if (dtus) {
    dtus.push(dtuId);
  }

  for (const [, stream] of _activeStreams) {
    if (stream.id === streamId) {
      stream.dtusCreated++;
      break;
    }
  }

  const meta = ensureMeta(streamId);
  meta.timeline.push({ event: "dtu-created", dtuId, at: new Date().toISOString() });

  logger.debug("city-streaming", `DTU ${dtuId} recorded for stream ${streamId}`);
}

/**
 * Record a sale that occurred during a stream.
 *
 * @param {string} streamId
 * @param {number} amount - CC earned from this sale.
 */
export function recordStreamSale(streamId, amount) {
  for (const [, stream] of _activeStreams) {
    if (stream.id === streamId) {
      stream.salesMade++;
      stream.ccEarned += amount;
      break;
    }
  }

  const meta = ensureMeta(streamId);
  meta.timeline.push({ event: "sale", amount, at: new Date().toISOString() });

  logger.debug("city-streaming", `Sale of ${amount} CC recorded for stream ${streamId}`);
}

/**
 * Get a full summary for a stream (works for both live and ended streams).
 *
 * @param {string} streamId
 * @returns {object|undefined}
 */
export function getStreamSummary(streamId) {
  // Check active streams first
  for (const [, stream] of _activeStreams) {
    if (stream.id === streamId) {
      const meta = _streamMeta.get(streamId) ?? { viewerPeak: 0, timeline: [] };
      return {
        ...stream,
        viewerPeak: meta.viewerPeak,
        dtus: _streamDTUs.get(streamId) ?? [],
        timeline: meta.timeline,
      };
    }
  }

  // Fall back to meta (stream already ended)
  const meta = _streamMeta.get(streamId);
  if (meta) {
    return {
      streamId,
      status: "ended",
      viewerPeak: meta.viewerPeak,
      dtus: _streamDTUs.get(streamId) ?? [],
      timeline: meta.timeline,
    };
  }

  return undefined;
}

/**
 * Create a Stream DTU summarising the broadcast. The caller is responsible
 * for committing the DTU to the store.
 *
 * @param {object} stream - The stream config (must include endedAt).
 * @returns {object} Stream DTU object.
 */
export function createStreamDTU(stream) {
  const meta = _streamMeta.get(stream.id) ?? { viewerPeak: 0, timeline: [] };
  const startMs = new Date(stream.startedAt).getTime();
  const endMs = new Date(stream.endedAt ?? new Date().toISOString()).getTime();
  const duration = endMs - startMs;

  const dtu = {
    id: `stream_dtu_${randomUUID()}`,
    title: `Stream: ${stream.title} by ${stream.creatorId}`,
    tier: "regular",
    scope: "global",
    tags: ["stream", "live", "creator", stream.cityId],
    meta: {
      via: "city-streaming",
      streamId: stream.id,
      creatorId: stream.creatorId,
      cityId: stream.cityId,
      duration,
      viewerPeak: meta.viewerPeak,
      dtusCreated: stream.dtusCreated,
      salesMade: stream.salesMade,
      ccEarned: stream.ccEarned,
      startedAt: stream.startedAt,
      endedAt: stream.endedAt ?? new Date().toISOString(),
      timeline: meta.timeline,
    },
  };

  logger.info("city-streaming", `Stream DTU created: ${dtu.id} for stream ${stream.id}`);

  return dtu;
}
