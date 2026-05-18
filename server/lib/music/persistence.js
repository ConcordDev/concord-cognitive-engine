// server/lib/music/persistence.js
//
// Music lens rebuild Sprint A — durable CRUD on top of migration 237.

import { randomUUID } from "node:crypto";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _slug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || randomUUID().slice(0, 8);
}

// ─── Artists ────────────────────────────────────────────────

export function createArtist(db, { ownerUserId = null, name, bio = null, genres = [], coverUrl = null, website = null }) {
  if (!db || !name) return { ok: false, reason: "missing_args" };
  const id = `art:${randomUUID()}`;
  let slug = _slug(name);
  // Disambiguate slug if collision
  for (let i = 1; i < 100; i++) {
    const existing = db.prepare(`SELECT 1 FROM music_artists WHERE slug = ?`).get(slug);
    if (!existing) break;
    slug = `${_slug(name)}-${i}`;
  }
  try {
    db.prepare(`
      INSERT INTO music_artists (id, owner_user_id, name, slug, bio, genres_json, cover_url, website, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerUserId, String(name).slice(0, 200), slug, bio,
      JSON.stringify(Array.isArray(genres) ? genres.slice(0, 20) : []),
      coverUrl, website, _now(), _now());
    return { ok: true, id, slug };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getArtist(db, id) {
  if (!db || !id) return null;
  const r = db.prepare(`SELECT * FROM music_artists WHERE id = ? OR slug = ?`).get(id, id);
  if (!r) return null;
  return { ...r, genres: _safeJson(r.genres_json, []) };
}

export function listArtists(db, { ownerId = null, limit = 50 } = {}) {
  if (!db) return [];
  const sql = ownerId
    ? `SELECT * FROM music_artists WHERE owner_user_id = ? ORDER BY follower_count DESC, name ASC LIMIT ?`
    : `SELECT * FROM music_artists ORDER BY follower_count DESC, name ASC LIMIT ?`;
  const rows = ownerId ? db.prepare(sql).all(ownerId, limit) : db.prepare(sql).all(limit);
  return rows.map((r) => ({ ...r, genres: _safeJson(r.genres_json, []) }));
}

export function updateArtist(db, id, ownerUserId, patch = {}) {
  if (!db || !id) return { ok: false };
  const cur = db.prepare(`SELECT owner_user_id FROM music_artists WHERE id = ?`).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  const sets = []; const args = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(String(patch.name).slice(0, 200)); }
  if (patch.bio !== undefined) { sets.push("bio = ?"); args.push(patch.bio); }
  if (patch.coverUrl !== undefined) { sets.push("cover_url = ?"); args.push(patch.coverUrl); }
  if (patch.bannerUrl !== undefined) { sets.push("banner_url = ?"); args.push(patch.bannerUrl); }
  if (patch.website !== undefined) { sets.push("website = ?"); args.push(patch.website); }
  if (Array.isArray(patch.genres)) { sets.push("genres_json = ?"); args.push(JSON.stringify(patch.genres.slice(0, 20))); }
  if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };
  sets.push("updated_at = ?"); args.push(_now()); args.push(id);
  db.prepare(`UPDATE music_artists SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

// ─── Albums ─────────────────────────────────────────────────

export function createAlbum(db, { artistId, title, kind = "album", coverUrl = null, releasedAt = null, label = null, visibility = "public" }) {
  if (!db || !artistId || !title) return { ok: false, reason: "missing_args" };
  const id = `alb:${randomUUID()}`;
  const k = ["album","ep","single","compilation","live","remix","soundtrack"].includes(kind) ? kind : "album";
  const v = ["private","workspace","public","published","global"].includes(visibility) ? visibility : "public";
  try {
    db.prepare(`
      INSERT INTO music_albums (id, artist_id, title, kind, cover_url, released_at, label, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, artistId, String(title).slice(0, 200), k, coverUrl, releasedAt, label, v, _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getAlbum(db, id) {
  if (!db || !id) return null;
  const r = db.prepare(`SELECT * FROM music_albums WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!r) return null;
  const tracks = db.prepare(`SELECT * FROM music_tracks WHERE album_id = ? AND deleted_at IS NULL ORDER BY disc_number, track_number`).all(id);
  return { ...r, tracks: tracks.map((t) => ({ ...t, genres: _safeJson(t.genres_json, []), mood_tags: _safeJson(t.mood_tags_json, []) })) };
}

export function listAlbumsByArtist(db, artistId) {
  if (!db || !artistId) return [];
  return db.prepare(`SELECT * FROM music_albums WHERE artist_id = ? AND deleted_at IS NULL ORDER BY released_at DESC NULLS LAST`).all(artistId);
}

// ─── Tracks ─────────────────────────────────────────────────

export function createTrack(db, {
  artistId, albumId = null, title,
  trackNumber = null, durationMs = 0,
  audioUrl = null, streamUrl = null, previewUrl = null,
  waveform = null, isrc = null, bpm = null, keySignature = null,
  genres = [], moodTags = [], lyrics = null, explicit = false,
  visibility = "public", license = "all_rights_reserved",
}) {
  if (!db || !artistId || !title) return { ok: false, reason: "missing_args" };
  const id = `trk:${randomUUID()}`;
  const v = ["private","workspace","public","published","global"].includes(visibility) ? visibility : "public";
  const lic = ["all_rights_reserved","cc_by","cc_by_sa","cc_by_nc","cc_by_nc_sa","cc_by_nd","cc0","custom"].includes(license) ? license : "all_rights_reserved";
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, duration_ms, audio_url, stream_url, preview_url, waveform_json, isrc, bpm, key_signature, genres_json, mood_tags_json, lyrics, explicit, visibility, license, created_at, updated_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, artistId, albumId, String(title).slice(0, 200),
        trackNumber, Math.max(0, Math.floor(Number(durationMs) || 0)),
        audioUrl, streamUrl, previewUrl,
        waveform ? JSON.stringify(waveform) : null,
        isrc, bpm ? Number(bpm) : null, keySignature,
        JSON.stringify(Array.isArray(genres) ? genres.slice(0, 20) : []),
        JSON.stringify(Array.isArray(moodTags) ? moodTags.slice(0, 20) : []),
        lyrics, explicit ? 1 : 0, v, lic, _now(), _now(),
        v !== "private" ? _now() : null);
      if (albumId) {
        db.prepare(`UPDATE music_albums SET total_tracks = total_tracks + 1, total_duration_ms = total_duration_ms + ?, updated_at = ? WHERE id = ?`).run(durationMs, _now(), albumId);
      }
    });
    tx();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getTrack(db, id) {
  if (!db || !id) return null;
  const r = db.prepare(`SELECT * FROM music_tracks WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!r) return null;
  return { ...r, genres: _safeJson(r.genres_json, []), mood_tags: _safeJson(r.mood_tags_json, []), waveform: _safeJson(r.waveform_json, null) };
}

export function listTracks(db, { artistId = null, albumId = null, visibility = null, limit = 100, orderBy = "published_at" } = {}) {
  if (!db) return [];
  const filters = ["deleted_at IS NULL"];
  const args = [];
  if (artistId) { filters.push("artist_id = ?"); args.push(artistId); }
  if (albumId) { filters.push("album_id = ?"); args.push(albumId); }
  if (visibility) { filters.push("visibility = ?"); args.push(visibility); }
  const ord = ["published_at","listen_count","like_count","avg_listen_pct"].includes(orderBy) ? orderBy : "published_at";
  args.push(Math.min(Math.max(1, Number(limit) || 100), 500));
  return db.prepare(`SELECT * FROM music_tracks WHERE ${filters.join(" AND ")} ORDER BY ${ord} DESC LIMIT ?`).all(...args)
    .map((r) => ({ ...r, genres: _safeJson(r.genres_json, []), mood_tags: _safeJson(r.mood_tags_json, []) }));
}

export function updateTrack(db, id, ownerUserId, patch = {}) {
  if (!db || !id) return { ok: false };
  const cur = db.prepare(`
    SELECT t.id, t.artist_id, a.owner_user_id FROM music_tracks t
    INNER JOIN music_artists a ON a.id = t.artist_id WHERE t.id = ?
  `).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  const sets = []; const args = [];
  if (patch.title !== undefined) { sets.push("title = ?"); args.push(String(patch.title).slice(0, 200)); }
  if (patch.lyrics !== undefined) { sets.push("lyrics = ?"); args.push(patch.lyrics); }
  if (Array.isArray(patch.genres)) { sets.push("genres_json = ?"); args.push(JSON.stringify(patch.genres.slice(0, 20))); }
  if (Array.isArray(patch.moodTags)) { sets.push("mood_tags_json = ?"); args.push(JSON.stringify(patch.moodTags.slice(0, 20))); }
  if (patch.explicit !== undefined) { sets.push("explicit = ?"); args.push(patch.explicit ? 1 : 0); }
  if (patch.visibility && ["private","workspace","public","published","global"].includes(patch.visibility)) { sets.push("visibility = ?"); args.push(patch.visibility); }
  if (patch.license && ["all_rights_reserved","cc_by","cc_by_sa","cc_by_nc","cc_by_nc_sa","cc_by_nd","cc0","custom"].includes(patch.license)) { sets.push("license = ?"); args.push(patch.license); }
  if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };
  sets.push("updated_at = ?"); args.push(_now()); args.push(id);
  db.prepare(`UPDATE music_tracks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function deleteTrack(db, id, ownerUserId) {
  const cur = db.prepare(`
    SELECT t.id, t.album_id, t.duration_ms, a.owner_user_id FROM music_tracks t
    INNER JOIN music_artists a ON a.id = t.artist_id WHERE t.id = ?
  `).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  const tx = db.transaction(() => {
    db.prepare(`UPDATE music_tracks SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(_now(), _now(), id);
    if (cur.album_id) {
      db.prepare(`UPDATE music_albums SET total_tracks = MAX(0, total_tracks - 1), total_duration_ms = MAX(0, total_duration_ms - ?), updated_at = ? WHERE id = ?`).run(cur.duration_ms, _now(), cur.album_id);
    }
  });
  tx();
  return { ok: true };
}

// ─── Playlists ──────────────────────────────────────────────

export function createPlaylist(db, { ownerId, title, description = null, kind = "curated", visibility = "private" }) {
  if (!db || !ownerId || !title) return { ok: false, reason: "missing_args" };
  const id = `pl:${randomUUID()}`;
  const k = ["curated","smart","liked","listened","radio","collaborative"].includes(kind) ? kind : "curated";
  const v = ["private","workspace","public","published","global"].includes(visibility) ? visibility : "private";
  db.prepare(`
    INSERT INTO music_playlists (id, owner_id, title, description, kind, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, String(title).slice(0, 200), description, k, v, _now(), _now());
  return { ok: true, id };
}

export function addTrackToPlaylist(db, playlistId, trackId, addedBy, position = null) {
  if (!db || !playlistId || !trackId || !addedBy) return { ok: false, reason: "missing_args" };
  const pl = db.prepare(`SELECT owner_id, kind FROM music_playlists WHERE id = ? AND deleted_at IS NULL`).get(playlistId);
  if (!pl) return { ok: false, reason: "not_found" };
  const isCollaborator = pl.owner_id === addedBy || pl.kind === "collaborative";
  if (!isCollaborator) return { ok: false, reason: "forbidden" };
  const track = db.prepare(`SELECT duration_ms FROM music_tracks WHERE id = ? AND deleted_at IS NULL`).get(trackId);
  if (!track) return { ok: false, reason: "track_not_found" };
  const nextPos = position != null ? Number(position) : (db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM music_playlist_tracks WHERE playlist_id = ?`).get(playlistId).p);
  try {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO music_playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)`).run(playlistId, trackId, nextPos, addedBy, _now());
      db.prepare(`UPDATE music_playlists SET track_count = track_count + 1, total_duration_ms = total_duration_ms + ?, updated_at = ? WHERE id = ?`).run(track.duration_ms, _now(), playlistId);
    });
    tx();
    return { ok: true, position: nextPos };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return { ok: false, reason: "position_taken" };
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function removeTrackFromPlaylist(db, playlistId, position, ownerUserId) {
  const pl = db.prepare(`SELECT owner_id FROM music_playlists WHERE id = ?`).get(playlistId);
  if (!pl) return { ok: false, reason: "not_found" };
  if (pl.owner_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  const tr = db.prepare(`
    SELECT t.duration_ms FROM music_playlist_tracks pt
    INNER JOIN music_tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ? AND pt.position = ?
  `).get(playlistId, position);
  if (!tr) return { ok: false, reason: "track_not_in_playlist" };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM music_playlist_tracks WHERE playlist_id = ? AND position = ?`).run(playlistId, position);
    db.prepare(`UPDATE music_playlists SET track_count = MAX(0, track_count - 1), total_duration_ms = MAX(0, total_duration_ms - ?), updated_at = ? WHERE id = ?`).run(tr.duration_ms, _now(), playlistId);
  });
  tx();
  return { ok: true };
}

export function getPlaylist(db, id) {
  if (!db || !id) return null;
  const pl = db.prepare(`SELECT * FROM music_playlists WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!pl) return null;
  const tracks = db.prepare(`
    SELECT pt.position, pt.added_by, pt.added_at, t.*
    FROM music_playlist_tracks pt
    INNER JOIN music_tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ? AND t.deleted_at IS NULL
    ORDER BY pt.position
  `).all(id);
  return { ...pl, smart_rules: _safeJson(pl.smart_rules_json, null), collaborator_user_ids: _safeJson(pl.collaborator_user_ids_json, []), tracks };
}

export function listPlaylists(db, { ownerId = null, visibility = null, limit = 100 } = {}) {
  if (!db) return [];
  const filters = ["deleted_at IS NULL"];
  const args = [];
  if (ownerId) { filters.push("owner_id = ?"); args.push(ownerId); }
  if (visibility) { filters.push("visibility = ?"); args.push(visibility); }
  args.push(Math.min(Math.max(1, Number(limit) || 100), 500));
  return db.prepare(`SELECT * FROM music_playlists WHERE ${filters.join(" AND ")} ORDER BY follower_count DESC, updated_at DESC LIMIT ?`).all(...args);
}

// ─── Listens / likes / follows ───────────────────────────────

export function recordListen(db, { trackId, userId = null, listenedMs = 0, trackDurationMs = null, contextKind = null, contextId = null, device = null, ipCountry = null, skipped = false }) {
  if (!db || !trackId) return { ok: false, reason: "missing_args" };
  const track = db.prepare(`SELECT duration_ms FROM music_tracks WHERE id = ? AND deleted_at IS NULL`).get(trackId);
  if (!track) return { ok: false, reason: "track_not_found" };
  const tdur = trackDurationMs || track.duration_ms;
  const isSkipped = skipped || (listenedMs < Math.min(30000, tdur * 0.1));
  const pct = tdur > 0 ? Math.min(1, listenedMs / tdur) : 0;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO music_listens (track_id, user_id, context_kind, context_id, listened_ms, track_duration_ms, skipped, device, ip_country, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(trackId, userId, contextKind, contextId, listenedMs, tdur, isSkipped ? 1 : 0, device, ipCountry, _now());
    // Counters: only bump listen_count if NOT skipped (else only bump skip_count)
    if (isSkipped) {
      db.prepare(`UPDATE music_tracks SET skip_count = skip_count + 1 WHERE id = ?`).run(trackId);
    } else {
      db.prepare(`UPDATE music_tracks SET listen_count = listen_count + 1 WHERE id = ?`).run(trackId);
    }
    // Recompute avg_listen_pct over last 100 listens via subquery
    db.prepare(`
      UPDATE music_tracks
      SET avg_listen_pct = (
        SELECT COALESCE(AVG(CAST(listened_ms AS REAL) / NULLIF(track_duration_ms, 0)), 0)
        FROM (SELECT listened_ms, track_duration_ms FROM music_listens WHERE track_id = ? ORDER BY started_at DESC LIMIT 100)
      )
      WHERE id = ?
    `).run(trackId, trackId);
  });
  tx();
  return { ok: true, listenedPct: Math.round(pct * 1000) / 1000, skipped: isSkipped };
}

export function likeTrack(db, userId, trackId) {
  if (!db || !userId || !trackId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO music_likes (user_id, track_id, liked_at) VALUES (?, ?, ?)`).run(userId, trackId, _now());
    db.prepare(`UPDATE music_tracks SET like_count = (SELECT COUNT(*) FROM music_likes WHERE track_id = ?) WHERE id = ?`).run(trackId, trackId);
  });
  tx();
  return { ok: true };
}

export function unlikeTrack(db, userId, trackId) {
  if (!db) return { ok: false };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM music_likes WHERE user_id = ? AND track_id = ?`).run(userId, trackId);
    db.prepare(`UPDATE music_tracks SET like_count = (SELECT COUNT(*) FROM music_likes WHERE track_id = ?) WHERE id = ?`).run(trackId, trackId);
  });
  tx();
  return { ok: true };
}

export function listLikes(db, userId, { limit = 100 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT t.*, l.liked_at FROM music_likes l
    INNER JOIN music_tracks t ON t.id = l.track_id
    WHERE l.user_id = ? AND t.deleted_at IS NULL
    ORDER BY l.liked_at DESC LIMIT ?
  `).all(userId, Math.min(limit, 500)).map((r) => ({ ...r, genres: _safeJson(r.genres_json, []) }));
}

export function followArtist(db, followerId, artistId) {
  if (!db || !followerId || !artistId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO music_follows (follower_id, artist_id, followed_at) VALUES (?, ?, ?)`).run(followerId, artistId, _now());
    db.prepare(`UPDATE music_artists SET follower_count = (SELECT COUNT(*) FROM music_follows WHERE artist_id = ?) WHERE id = ?`).run(artistId, artistId);
  });
  tx();
  return { ok: true };
}

export function unfollowArtist(db, followerId, artistId) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM music_follows WHERE follower_id = ? AND artist_id = ?`).run(followerId, artistId);
    db.prepare(`UPDATE music_artists SET follower_count = (SELECT COUNT(*) FROM music_follows WHERE artist_id = ?) WHERE id = ?`).run(artistId, artistId);
  });
  tx();
  return { ok: true };
}

// ─── Stats / reads ──────────────────────────────────────────

export function artistStats(db, artistId, { sinceDays = 30 } = {}) {
  if (!db || !artistId) return null;
  const since = _now() - sinceDays * 86400;
  const tracks = db.prepare(`SELECT id, listen_count, like_count FROM music_tracks WHERE artist_id = ? AND deleted_at IS NULL`).all(artistId);
  const trackIds = tracks.map((t) => t.id);
  const totalListens = tracks.reduce((s, t) => s + t.listen_count, 0);
  const totalLikes = tracks.reduce((s, t) => s + t.like_count, 0);
  let recentListens = 0;
  if (trackIds.length > 0) {
    const ph = trackIds.map(() => "?").join(",");
    const r = db.prepare(`SELECT COUNT(*) AS n FROM music_listens WHERE track_id IN (${ph}) AND started_at >= ? AND skipped = 0`).get(...trackIds, since);
    recentListens = r.n;
  }
  const follower = db.prepare(`SELECT follower_count, monthly_listeners FROM music_artists WHERE id = ?`).get(artistId);
  return {
    artistId,
    trackCount: tracks.length,
    totalListens, totalLikes,
    recentListens,
    sinceDays,
    follower_count: follower?.follower_count || 0,
  };
}
