// server/lib/reels.js
//
// Phase 11 (Item 6) — Reels (short-form vertical video) helpers.
//
// Reuses the existing pan-social post substrate for reactions /
// comments / shares / bookmarks — every reel is a post under the
// hood. The reels table just adds the video-specific metadata +
// analytics ledger.
//
// No fake trending boost — `getReelsForUser` ranks by real
// completion rate, real recency, real reactions. When there's
// insufficient signal (cold-start), it degrades to reverse-chrono.

const COMPLETION_THRESHOLD = 0.8;

export function createReel(db, {
  reelId, postId, userId, videoUrl = null, thumbnailUrl = null,
  audioUrl = null, audioDurationSeconds = null,
  durationSeconds, width = null, height = null,
  caption = null, musicAttribution = null,
}) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!reelId || !postId || !userId || !durationSeconds) {
    return { ok: false, reason: 'missing_field' };
  }
  // At least one media URL must be present. Phase 13 migration 201 added
  // audio-only reels — the CHECK at the table level enforces this, but
  // we surface a friendlier reason from here.
  if (!videoUrl && !audioUrl) {
    return { ok: false, reason: 'missing_media', hint: 'videoUrl or audioUrl required' };
  }
  if (durationSeconds <= 0 || durationSeconds > 60) {
    return { ok: false, reason: 'duration_out_of_range', hint: '0 < duration <= 60s' };
  }
  try {
    db.prepare(`
      INSERT INTO reels (id, post_id, user_id, video_url, thumbnail_url, audio_url, audio_duration_s, duration_seconds, width, height, caption, music_attribution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reelId, postId, userId,
      videoUrl, thumbnailUrl,
      audioUrl, audioDurationSeconds != null ? Math.round(audioDurationSeconds) : null,
      durationSeconds, width, height, caption, musicAttribution,
    );
    return { ok: true, reel: getReel(db, reelId)?.reel || null };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export function getReel(db, reelId) {
  if (!db || !reelId) return { ok: false };
  const row = db.prepare(`SELECT * FROM reels WHERE id = ?`).get(reelId);
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, reel: shapeReel(row) };
}

/**
 * Record a watch session. `watchedSeconds` is the actual play time
 * (excluding paused/scrubbed time). Updates `view_count` once per
 * session, and `completion_count` when the viewer crossed the 80%
 * threshold.
 */
export function recordView(db, { reelId, viewerUserId = null, watchedSeconds }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!reelId || watchedSeconds == null || watchedSeconds < 0) {
    return { ok: false, reason: 'bad_input' };
  }
  const reel = db.prepare(`SELECT duration_seconds, view_count, completion_count FROM reels WHERE id = ?`).get(reelId);
  if (!reel) return { ok: false, reason: 'not_found' };
  const completed = watchedSeconds >= reel.duration_seconds * COMPLETION_THRESHOLD ? 1 : 0;
  db.prepare(`
    INSERT INTO reel_views (reel_id, viewer_user_id, watched_seconds, completed)
    VALUES (?, ?, ?, ?)
  `).run(reelId, viewerUserId, watchedSeconds, completed);
  db.prepare(`
    UPDATE reels
    SET view_count = view_count + 1, completion_count = completion_count + ?
    WHERE id = ?
  `).run(completed, reelId);
  return { ok: true, completed: !!completed };
}

/**
 * For-You feed. Ranking score = recency_score + completion_score +
 * engagement_score. Cold-start degrades to reverse-chrono.
 *
 * - recency_score:   exp(-age_hours / 48)   (half-life ~33h)
 * - completion_score:completion_rate * 2    (real per-viewer signal)
 * - engagement_score:log1p(view_count) * 0.5
 */
export function getReelsForUser(db, { viewerUserId = null, limit = 20, offset = 0 } = {}) {
  if (!db) return { ok: false, results: [] };
  // Exclude reels the viewer has already completed (avoid re-recommending).
  const seenIds = viewerUserId
    ? db.prepare(`SELECT DISTINCT reel_id FROM reel_views WHERE viewer_user_id = ? AND completed = 1`).all(viewerUserId).map(r => r.reel_id)
    : [];
  const seenSet = new Set(seenIds);

  // Pull a candidate window — top 200 most recent — then score in JS.
  const candidates = db.prepare(`SELECT * FROM reels ORDER BY created_at DESC LIMIT 200`).all();
  const now = Math.floor(Date.now() / 1000);
  const scored = candidates
    .filter(r => !seenSet.has(r.id))
    .map(r => {
      const ageHours = Math.max(0.001, (now - r.created_at) / 3600);
      const recency = Math.exp(-ageHours / 48);
      const completionRate = r.view_count > 0 ? r.completion_count / r.view_count : 0;
      const engagement = Math.log1p(r.view_count) * 0.5;
      const score = recency + completionRate * 2 + engagement;
      return { ...shapeReel(r), _score: score };
    });
  scored.sort((a, b) => b._score - a._score);
  const slice = scored.slice(offset, offset + limit).map(({ _score, ...rest }) => rest);
  return { ok: true, results: slice, total: scored.length };
}

export function getReelsByUser(db, { userId, limit = 30, offset = 0 } = {}) {
  if (!db) return { ok: false, results: [] };
  if (!userId) return { ok: false, reason: 'no_user' };
  const rows = db.prepare(`
    SELECT * FROM reels WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM reels WHERE user_id = ?`).get(userId).c;
  return { ok: true, results: rows.map(shapeReel), total };
}

function shapeReel(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    audioUrl: row.audio_url,
    audioDurationSeconds: row.audio_duration_s,
    mediaKind: row.video_url ? 'video' : (row.audio_url ? 'audio' : 'unknown'),
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    caption: row.caption,
    musicAttribution: row.music_attribution,
    viewCount: row.view_count,
    completionCount: row.completion_count,
    completionRate: row.view_count > 0 ? row.completion_count / row.view_count : 0,
    createdAt: row.created_at,
  };
}
