// server/domains/music-rebuild.js
//
// Music lens rebuild Sprint A — register()-pattern macros sitting
// alongside the legacy registerLensAction macros in server/domains/music.js
// (which cover the audio analysis surface: bpm, key, chords, render,
// stems). This file adds the durable creator-economy substrate:
// artists / albums / tracks / playlists / listens / likes / follows.

import {
  createArtist, getArtist, listArtists, updateArtist,
  createAlbum, getAlbum, listAlbumsByArtist,
  createTrack, getTrack, listTracks, updateTrack, deleteTrack,
  createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist, getPlaylist, listPlaylists,
  recordListen, likeTrack, unlikeTrack, listLikes,
  followArtist, unfollowArtist,
  artistStats,
} from "../lib/music/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.emit(event, payload); } catch { /* best */ }
}

export default function registerMusicRebuildMacros(register) {

  // ─── Artists ────────────────────────────────────────────

  register("music", "artist_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createArtist(db, { ownerUserId: userId, ...input });
  }, { destructive: true, note: "Create an artist profile (owner = current user)" });

  register("music", "artist_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const a = getArtist(db, String(input.id || input.slug || ""));
    if (!a) return { ok: false, reason: "not_found" };
    return { ok: true, artist: a };
  }, { note: "Get artist by id or slug" });

  register("music", "artist_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, artists: listArtists(db, { ownerId: input.ownerId, limit: input.limit }) };
  }, { note: "List artists (optionally filter by owner)" });

  register("music", "artist_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return updateArtist(db, String(input.id || ""), userId, input);
  }, { destructive: true, note: "Update artist (name/bio/genres/cover/banner/website)" });

  register("music", "artist_stats", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const s = artistStats(db, String(input.id || input.artistId || ""), { sinceDays: input.sinceDays });
    return { ok: true, stats: s };
  }, { note: "Artist analytics: total/recent listens + likes + followers" });

  // ─── Albums ─────────────────────────────────────────────

  register("music", "album_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Verify artist ownership
    const artist = getArtist(db, String(input.artistId || ""));
    if (!artist) return { ok: false, reason: "artist_not_found" };
    if (artist.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    return createAlbum(db, input);
  }, { destructive: true, note: "Create an album/EP/single/etc on one of my artists" });

  register("music", "album_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const a = getAlbum(db, String(input.id || ""));
    if (!a) return { ok: false, reason: "not_found" };
    return { ok: true, album: a };
  }, { note: "Get album with its tracks" });

  register("music", "album_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const artistId = String(input.artistId || "");
    if (!artistId) return { ok: false, reason: "artistId_required" };
    return { ok: true, albums: listAlbumsByArtist(db, artistId) };
  }, { note: "List albums by artist" });

  // ─── Tracks ─────────────────────────────────────────────

  register("music", "track_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const artist = getArtist(db, String(input.artistId || ""));
    if (!artist) return { ok: false, reason: "artist_not_found" };
    if (artist.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    const r = createTrack(db, input);
    if (r.ok) _emit("music:track-published", { trackId: r.id, artistId: input.artistId });
    return r;
  }, { destructive: true, note: "Create a track on one of my artists (audio_url + duration + genres/mood/license)" });

  register("music", "track_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const t = getTrack(db, String(input.id || ""));
    if (!t) return { ok: false, reason: "not_found" };
    return { ok: true, track: t };
  }, { note: "Get track by id" });

  register("music", "track_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, tracks: listTracks(db, input) };
  }, { note: "List tracks filterable by artist / album / visibility / orderBy" });

  register("music", "track_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return updateTrack(db, String(input.id || ""), userId, input);
  }, { destructive: true, note: "Update track metadata (title/lyrics/genres/mood/visibility/license)" });

  register("music", "track_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deleteTrack(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Soft-delete a track" });

  // ─── Playlists ─────────────────────────────────────────

  register("music", "playlist_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createPlaylist(db, { ownerId: userId, ...input });
  }, { destructive: true, note: "Create a playlist (curated/smart/liked/listened/radio/collaborative)" });

  register("music", "playlist_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const pl = getPlaylist(db, String(input.id || ""));
    if (!pl) return { ok: false, reason: "not_found" };
    return { ok: true, playlist: pl };
  }, { note: "Get playlist with track list" });

  register("music", "playlist_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, playlists: listPlaylists(db, { ownerId: input.ownerId === "me" ? userId : input.ownerId, visibility: input.visibility, limit: input.limit }) };
  }, { note: "List playlists (use ownerId='me' for mine)" });

  register("music", "playlist_add_track", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addTrackToPlaylist(db, String(input.playlistId || ""), String(input.trackId || ""), userId, input.position);
  }, { destructive: true, note: "Add a track to my playlist (or a collaborative one)" });

  register("music", "playlist_remove_track", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return removeTrackFromPlaylist(db, String(input.playlistId || ""), Number(input.position), userId);
  }, { destructive: true, note: "Remove a track from a playlist (owner only)" });

  // ─── Listens / likes / follows ─────────────────────────

  register("music", "listen", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return recordListen(db, { ...input, userId });
  }, { destructive: true, note: "Record a listen event. Skipped if listened_ms < 30s or < 10% of track. Updates listen_count + skip_count + avg_listen_pct." });

  register("music", "like", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return likeTrack(db, userId, String(input.trackId || input.id || ""));
  }, { destructive: true, note: "Like a track" });

  register("music", "unlike", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unlikeTrack(db, userId, String(input.trackId || input.id || ""));
  }, { destructive: true, note: "Unlike a track" });

  register("music", "likes_mine", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, tracks: listLikes(db, userId, { limit: input.limit }) };
  }, { note: "My liked tracks" });

  register("music", "follow_artist", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return followArtist(db, userId, String(input.artistId || ""));
  }, { destructive: true, note: "Follow an artist" });

  register("music", "unfollow_artist", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unfollowArtist(db, userId, String(input.artistId || ""));
  }, { destructive: true, note: "Unfollow an artist" });
}
