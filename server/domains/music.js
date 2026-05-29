// server/domains/music.js
//
// Pure-compute music-theory helpers (BPM, key detect via
// Krumhansl-Schmuckler, chord progression match, setlist planner)
// plus real MusicBrainz metadata (artists, releases, recordings).
//
// MusicBrainz is the authoritative open-source music metadata DB.
// Free, no API key — but ToS REQUIRES a contact User-Agent header.
// Set MUSICBRAINZ_CONTACT to a contact email/URL for production
// usage; we use a fallback identifying Concord OS for dev.
//
// Content-engine bridge: publish-as-stem and list-published-stems
// hand audio bytes from the music lens to the frontend adaptive-music
// state machine. Audio rides through route_artifacts (HTTP serving)
// and dtus (discovery + royalty cascade tagging).

import crypto from "node:crypto";
import { cachedFetchJson } from "../lib/external-fetch.js";

const ADAPTIVE_STEM_NAMES = new Set([
  "ambient_bed",
  "tension_pad",
  "combat_drum",
  "revelation_strings",
]);
const AUDIO_MIME = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
};
const STEM_ARTIFACT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Decode a data: URL (audio/wav | mpeg | ogg | flac) → { buf, mimeType, ext }
function decodeAudioDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:audio\/(wav|mpeg|mp3|ogg|flac);base64,(.+)$/);
  if (!m) return null;
  const sub = m[1] === "mp3" ? "mpeg" : m[1];
  const mimeType = `audio/${sub}`;
  const ext = m[1] === "mpeg" ? "mp3" : m[1] === "mp3" ? "mp3" : m[1];
  try {
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > STEM_ARTIFACT_MAX_BYTES) return null;
    return { buf, mimeType, ext };
  } catch {
    return null;
  }
}

// Ensure route_artifacts exists. The routes/artifacts.js router creates
// it on mount but if this macro fires before that route was mounted
// (cold-start race), we make the table ourselves with the same schema.
function ensureRouteArtifactsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_artifacts (
      artifact_id  TEXT PRIMARY KEY,
      dtu_id       TEXT,
      name         TEXT NOT NULL,
      mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      storage_mode TEXT NOT NULL DEFAULT 'inline',
      content_b64  TEXT,
      storage_path TEXT,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      description  TEXT NOT NULL DEFAULT '',
      tags         TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_dtu ON route_artifacts (dtu_id);
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_creator ON route_artifacts (created_by, created_at DESC);
  `);
}

const MB_BASE = "https://musicbrainz.org/ws/2";

function mbUserAgent() {
  const contact = process.env.MUSICBRAINZ_CONTACT || "https://concord-os.org";
  return `Concord-OS/1.0 ( ${contact} )`;
}

async function mbFetch(path) {
  const url = `${MB_BASE}${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  const r = await fetch(url, { headers: { "User-Agent": mbUserAgent(), Accept: "application/json" } });
  if (r.status === 503) throw new Error("musicbrainz rate limited (1 req/sec) — back off and retry");
  if (!r.ok) throw new Error(`musicbrainz ${r.status}`);
  return r.json();
}

export default function registerMusicActions(registerLensAction) {
  registerLensAction("music", "bpmAnalyze", (ctx, artifact, _params) => {
    const beats = artifact.data?.beats || artifact.data?.timestamps || [];
    if (beats.length < 4) return { ok: true, result: { message: "Provide 4+ beat timestamps (in seconds) to analyze BPM." } };
    const times = beats.map(Number).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
    const bpm = avgInterval > 0 ? Math.round(60 / avgInterval) : 0;
    const variance = intervals.reduce((s, i) => s + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stability = Math.max(0, Math.round((1 - Math.sqrt(variance) / avgInterval) * 100));
    const minBpm = Math.round(60 / Math.max(...intervals));
    const maxBpm = Math.round(60 / Math.min(...intervals));
    return { ok: true, result: { bpm, minBpm, maxBpm, stability, tempoClass: bpm < 70 ? "Largo" : bpm < 90 ? "Andante" : bpm < 120 ? "Moderato" : bpm < 140 ? "Allegro" : bpm < 170 ? "Vivace" : "Presto", beatCount: beats.length, avgIntervalMs: Math.round(avgInterval * 1000), durationSec: Math.round((times[times.length - 1] - times[0]) * 100) / 100 } };
  });

  registerLensAction("music", "keyDetect", (ctx, artifact, _params) => {
    const notes = artifact.data?.notes || [];
    if (notes.length < 4) return { ok: true, result: { message: "Provide 4+ note names (e.g., C, D#, Eb) to detect key." } };
    const noteMap = { "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11 };
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const pitchClasses = new Array(12).fill(0);
    notes.forEach(n => { const name = typeof n === "string" ? n.replace(/[0-9]/g, "") : ""; if (noteMap[name] !== undefined) pitchClasses[noteMap[name]]++; });
    let bestKey = "C", bestMode = "major", bestScore = -Infinity;
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let root = 0; root < 12; root++) {
      const rotated = pitchClasses.slice(root).concat(pitchClasses.slice(0, root));
      let majCorr = 0, minCorr = 0;
      const rSum = rotated.reduce((s, v) => s + v, 0);
      const rMean = rSum / 12;
      for (let i = 0; i < 12; i++) {
        majCorr += (rotated[i] - rMean) * (majorProfile[i] - majorProfile.reduce((s, v) => s + v, 0) / 12);
        minCorr += (rotated[i] - rMean) * (minorProfile[i] - minorProfile.reduce((s, v) => s + v, 0) / 12);
      }
      if (majCorr > bestScore) { bestScore = majCorr; bestKey = noteNames[root]; bestMode = "major"; }
      if (minCorr > bestScore) { bestScore = minCorr; bestKey = noteNames[root]; bestMode = "minor"; }
    }
    return { ok: true, result: { key: bestKey, mode: bestMode, fullKey: `${bestKey} ${bestMode}`, confidence: Math.min(100, Math.round(Math.abs(bestScore) * 10)), noteDistribution: Object.fromEntries(noteNames.map((n, i) => [n, pitchClasses[i]])), notesAnalyzed: notes.length } };
  });

  registerLensAction("music", "chordProgress", (ctx, artifact, _params) => {
    const chords = artifact.data?.chords || [];
    if (chords.length < 2) return { ok: true, result: { message: "Provide 2+ chord names to analyze progression." } };
    const names = chords.map(c => typeof c === "string" ? c : c.name || c.chord || "");
    const commonProgressions = {
      "I-V-vi-IV": ["C-G-Am-F", "G-D-Em-C", "D-A-Bm-G", "A-E-F#m-D"],
      "I-IV-V-I": ["C-F-G-C", "G-C-D-G", "D-G-A-D"],
      "ii-V-I": ["Dm-G-C", "Am-D-G", "Em-A-D"],
      "I-vi-IV-V": ["C-Am-F-G", "G-Em-C-D"],
      "vi-IV-I-V": ["Am-F-C-G", "Em-C-G-D"],
      "12-bar-blues": ["A-A-A-A-D-D-A-A-E-D-A-E"],
    };
    const chordStr = names.join("-");
    let matchedProgression = null;
    for (const [name, patterns] of Object.entries(commonProgressions)) {
      if (patterns.some(p => chordStr.includes(p))) { matchedProgression = name; break; }
    }
    const transitions = {};
    for (let i = 0; i < names.length - 1; i++) {
      const key = `${names[i]}→${names[i + 1]}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
    const uniqueChords = [...new Set(names)];
    const majorCount = uniqueChords.filter(c => /^[A-G][#b]?$/.test(c) || c.includes("maj")).length;
    const minorCount = uniqueChords.filter(c => c.includes("m") && !c.includes("maj")).length;
    return { ok: true, result: { chordCount: names.length, uniqueChords: uniqueChords.length, progression: names, matchedPattern: matchedProgression, mood: minorCount > majorCount ? "minor/melancholic" : "major/bright", transitions: Object.entries(transitions).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ transition: t, count: c })), harmonicDensity: Math.round((uniqueChords.length / names.length) * 100) } };
  });

  registerLensAction("music", "setlistPlan", (ctx, artifact, _params) => {
    const tracks = artifact.data?.tracks || artifact.data?.songs || [];
    if (tracks.length < 2) return { ok: true, result: { message: "Provide 2+ tracks with bpm/energy/key to plan a setlist." } };
    const processed = tracks.map((t, i) => ({
      index: i, title: t.title || t.name || `Track ${i + 1}`, bpm: parseFloat(t.bpm) || 120, energy: parseFloat(t.energy) || 5, key: t.key || "C", duration: parseFloat(t.duration) || 240,
    }));
    // Sort by energy curve: start medium, build to peak, wind down
    const sorted = [...processed].sort((a, b) => a.energy - b.energy);
    const n = sorted.length;
    const opener = sorted[Math.floor(n * 0.6)] || sorted[0];
    const closer = sorted[Math.floor(n * 0.3)] || sorted[0];
    const peak = sorted[n - 1];
    // Build setlist: medium start, gradual build, peak at 2/3, cool down
    const setlist = [...processed].sort((a, b) => {
      const aPeakDist = Math.abs(processed.indexOf(a) / n - 0.66);
      const bPeakDist = Math.abs(processed.indexOf(b) / n - 0.66);
      return (a.energy * (1 - aPeakDist)) - (b.energy * (1 - bPeakDist));
    });
    const totalDuration = processed.reduce((s, t) => s + t.duration, 0);
    const avgBpm = Math.round(processed.reduce((s, t) => s + t.bpm, 0) / n);
    return { ok: true, result: { suggestedOrder: setlist.map(t => t.title), totalDuration: Math.round(totalDuration), totalMinutes: Math.round(totalDuration / 60), trackCount: n, avgBpm, energyCurve: setlist.map(t => ({ title: t.title, energy: t.energy, bpm: t.bpm })), peakMoment: peak.title, opener: opener.title, closer: closer.title } };
  });

  // ── MusicBrainz (real metadata) ──

  /**
   * mb-search-artist — Fuzzy artist search via MusicBrainz.
   * params: { query: string, limit?: 1-100 }
   */
  registerLensAction("music", "mb-search-artist", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query must be ≥ 2 characters" };
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
    try {
      const data = await mbFetch(`/artist?query=${encodeURIComponent(query)}&limit=${limit}`);
      const artists = (data.artists || []).map((a) => ({
        mbid: a.id,
        name: a.name,
        sortName: a["sort-name"],
        type: a.type,
        country: a.country,
        beginArea: a["begin-area"]?.name,
        lifeSpan: a["life-span"] ? { begin: a["life-span"].begin, end: a["life-span"].end, ended: a["life-span"].ended } : null,
        disambiguation: a.disambiguation,
        score: a.score,
        tags: (a.tags || []).map((t) => t.name),
      }));
      return {
        ok: true,
        result: { artists, count: artists.length, totalCount: data.count, source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * mb-artist-releases — Lookup an artist's releases (albums/EPs/singles)
   * by their MBID. Returns releases with type, date, country, formats.
   */
  registerLensAction("music", "mb-artist-releases", async (_ctx, _artifact, params = {}) => {
    const mbid = String(params.mbid || "").trim();
    if (!mbid) return { ok: false, error: "mbid required (MusicBrainz artist UUID from mb-search-artist)" };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
      return { ok: false, error: "mbid must be a MusicBrainz UUID" };
    }
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    try {
      const data = await mbFetch(`/release?artist=${mbid}&limit=${limit}&inc=release-groups`);
      const releases = (data.releases || []).map((r) => ({
        mbid: r.id,
        title: r.title,
        date: r.date,
        country: r.country,
        status: r.status,
        primaryType: r["release-group"]?.["primary-type"],
        secondaryTypes: r["release-group"]?.["secondary-types"] || [],
        disambiguation: r.disambiguation,
        barcode: r.barcode,
        packaging: r.packaging,
      }));
      // Newest first
      releases.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return {
        ok: true,
        result: { releases, count: releases.length, totalCount: data["release-count"], source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * mb-lookup-by-isrc — Lookup recordings by International Standard
   * Recording Code (ISRC). Useful for radio station integrations,
   * royalty tracking, and disambiguating cover versions.
   */
  registerLensAction("music", "mb-lookup-by-isrc", async (_ctx, _artifact, params = {}) => {
    const isrc = String(params.isrc || "").toUpperCase().replace(/[-\s]/g, "").trim();
    if (!isrc) return { ok: false, error: "isrc required" };
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
      return { ok: false, error: "isrc must be 12 chars: 2 country + 3 registrant + 2 year + 5 designation (e.g. USRC17607839)" };
    }
    try {
      const data = await mbFetch(`/isrc/${encodeURIComponent(isrc)}?inc=artist-credits+releases`);
      const recordings = (data.recordings || []).map((rec) => ({
        mbid: rec.id,
        title: rec.title,
        lengthMs: rec.length,
        artistCredit: (rec["artist-credit"] || []).map((ac) => ac.name).join(""),
        releases: (rec.releases || []).map((rel) => ({ mbid: rel.id, title: rel.title, date: rel.date })),
        disambiguation: rec.disambiguation,
      }));
      return {
        ok: true,
        result: { isrc, recordings, count: recordings.length, source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Spotify + Apple Music 2026 parity — streaming library ──────────
  // Track library, playlists, queue + playback, followed artists,
  // listening stats (Wrapped), discovery mixes. Per-user, STATE-backed.

  function getMusicState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.musicLens) STATE.musicLens = {};
    const s = STATE.musicLens;
    for (const k of ["tracks", "playlists", "plays", "queue", "following", "nowPlaying", "audioSettings", "sleepTimers", "radio"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveMusicState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const muId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const muNow = () => new Date().toISOString();
  const muAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const muListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const muNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const muClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const findTrack = (s, userId, id) => (s.tracks.get(userId) || []).find((t) => t.id === id) || null;
  // D8 — collaborative playlists. A playlist lives under its owner's userId, so a
  // collaborator's edit must find it across users (and only when it's flagged
  // collaborative). Track ids on a shared playlist may belong to any contributor,
  // so detail resolves them across all libraries.
  const findAnyPlaylist = (s, playlistId, { collaborativeOnly = false } = {}) => {
    for (const [ownerId, list] of s.playlists) {
      const pl = (list || []).find((p) => p.id === playlistId);
      if (pl && (!collaborativeOnly || pl.collaborative === true)) return { pl, ownerId };
    }
    return null;
  };
  const findTrackAnyUser = (s, trackId) => {
    for (const [, list] of s.tracks) {
      const t = (list || []).find((x) => x.id === trackId);
      if (t) return t;
    }
    return null;
  };

  // ── Tracks / library ────────────────────────────────────────────────
  registerLensAction("music", "track-add", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = muClean(params.title, 200);
    if (!title) return { ok: false, error: "track title required" };
    const track = {
      id: muId("trk"), title,
      artist: muClean(params.artist, 120) || "Unknown Artist",
      album: muClean(params.album, 200) || null,
      genre: muClean(params.genre, 60).toLowerCase() || "unknown",
      durationSec: Math.max(1, Math.round(muNum(params.durationSec, 210))),
      liked: false, playCount: 0, addedAt: muNow(),
    };
    muListB(s.tracks, muAid(ctx)).push(track);
    saveMusicState();
    return { ok: true, result: { track } };
  });

  registerLensAction("music", "track-list", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let tracks = [...(s.tracks.get(muAid(ctx)) || [])];
    if (params.genre) tracks = tracks.filter((t) => t.genre === String(params.genre).toLowerCase());
    if (params.artist) tracks = tracks.filter((t) => t.artist === params.artist);
    if (params.liked) tracks = tracks.filter((t) => t.liked);
    const q = muClean(params.query, 80).toLowerCase();
    if (q) tracks = tracks.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
    tracks.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return { ok: true, result: { tracks, count: tracks.length } };
  });

  registerLensAction("music", "track-detail", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    return { ok: true, result: { track } };
  });

  registerLensAction("music", "track-delete", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const arr = s.tracks.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "track not found" };
    arr.splice(i, 1);
    for (const p of s.playlists.get(userId) || []) p.trackIds = p.trackIds.filter((x) => x !== params.id);
    saveMusicState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("music", "track-like", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    track.liked = !track.liked;
    saveMusicState();
    return { ok: true, result: { id: track.id, liked: track.liked } };
  });

  registerLensAction("music", "liked-songs", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tracks = (s.tracks.get(muAid(ctx)) || []).filter((t) => t.liked);
    return { ok: true, result: { tracks, count: tracks.length } };
  });

  // ── Playlists ───────────────────────────────────────────────────────
  registerLensAction("music", "playlist-create", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = muClean(params.name, 120);
    if (!name) return { ok: false, error: "playlist name required" };
    const playlist = {
      id: muId("pl"), name,
      description: muClean(params.description, 300) || null,
      collaborative: params.collaborative === true,
      trackIds: [], createdAt: muNow(),
    };
    muListB(s.playlists, muAid(ctx)).push(playlist);
    saveMusicState();
    return { ok: true, result: { playlist } };
  });

  registerLensAction("music", "playlist-list", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const tracks = new Map((s.tracks.get(userId) || []).map((t) => [t.id, t]));
    const dur = (p) => p.trackIds.reduce((a, id) => a + (tracks.get(id)?.durationSec || findTrackAnyUser(s, id)?.durationSec || 0), 0);
    const own = (s.playlists.get(userId) || []).map((p) => ({ ...p, trackCount: p.trackIds.length, durationSec: dur(p) }));
    // D8 — also surface collaborative playlists this user contributes to.
    const collab = [];
    for (const [ownerId, list] of s.playlists) {
      if (ownerId === userId) continue;
      for (const p of (list || [])) {
        if (p.collaborative === true && (p.contributors || []).includes(userId)) {
          collab.push({ ...p, sharedBy: ownerId, trackCount: p.trackIds.length, durationSec: dur(p) });
        }
      }
    }
    const playlists = [...own, ...collab];
    return { ok: true, result: { playlists, count: playlists.length } };
  });

  registerLensAction("music", "playlist-add-track", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    // Owner edit first; otherwise a collaborative playlist anyone may edit (D8).
    let pl = (s.playlists.get(userId) || []).find((p) => p.id === params.playlistId);
    let ownerId = userId;
    if (!pl) {
      const found = findAnyPlaylist(s, params.playlistId, { collaborativeOnly: true });
      if (found) { pl = found.pl; ownerId = found.ownerId; }
    }
    if (!pl) return { ok: false, error: "playlist not found" };
    // The contributor must actually hold the track in their own library.
    if (!findTrack(s, userId, params.trackId)) return { ok: false, error: "track not found" };
    if (params.remove === true) pl.trackIds = pl.trackIds.filter((x) => x !== params.trackId);
    else if (!pl.trackIds.includes(params.trackId)) pl.trackIds.push(String(params.trackId));
    // Record a non-owner contributor so the playlist surfaces in their list.
    if (ownerId !== userId) {
      pl.contributors = Array.from(new Set([...(pl.contributors || []), userId]));
    }
    saveMusicState();
    return { ok: true, result: { playlistId: pl.id, trackCount: pl.trackIds.length, collaborative: !!pl.collaborative, ownerId } };
  });

  registerLensAction("music", "playlist-detail", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    let pl = (s.playlists.get(userId) || []).find((p) => p.id === params.id);
    // D8 — collaborators (and any viewer) can open a collaborative playlist.
    if (!pl) { const f = findAnyPlaylist(s, params.id, { collaborativeOnly: true }); if (f) pl = f.pl; }
    if (!pl) return { ok: false, error: "playlist not found" };
    // Resolve track ids across all contributors' libraries (shared playlist).
    const tracks = pl.trackIds.map((id) => findTrack(s, userId, id) || findTrackAnyUser(s, id)).filter(Boolean);
    return {
      ok: true,
      result: { playlist: pl, tracks, durationSec: tracks.reduce((a, t) => a + t.durationSec, 0) },
    };
  });

  registerLensAction("music", "playlist-reorder", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pl = (s.playlists.get(muAid(ctx)) || []).find((p) => p.id === params.id);
    if (!pl) return { ok: false, error: "playlist not found" };
    const i = pl.trackIds.indexOf(String(params.trackId));
    if (i < 0) return { ok: false, error: "track not in playlist" };
    const j = Math.max(0, Math.min(pl.trackIds.length - 1, i + (String(params.direction) === "down" ? 1 : -1)));
    if (i !== j) { const [m] = pl.trackIds.splice(i, 1); pl.trackIds.splice(j, 0, m); }
    saveMusicState();
    return { ok: true, result: { trackIds: pl.trackIds } };
  });

  registerLensAction("music", "playlist-delete", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.playlists.get(muAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "playlist not found" };
    arr.splice(i, 1);
    saveMusicState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Playback + queue ────────────────────────────────────────────────
  registerLensAction("music", "play-track", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const track = findTrack(s, userId, params.id);
    if (!track) return { ok: false, error: "track not found" };
    track.playCount += 1;
    muListB(s.plays, userId).push({ trackId: track.id, durationSec: track.durationSec, at: muNow() });
    s.nowPlaying.set(userId, { trackId: track.id, positionSec: 0, at: muNow() });
    const q = s.queue.get(userId);
    if (q) { const qi = q.indexOf(track.id); if (qi >= 0) q.splice(qi, 1); }
    saveMusicState();
    return { ok: true, result: { track, playCount: track.playCount } };
  });

  registerLensAction("music", "playback-progress", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const np = s.nowPlaying.get(userId);
    if (!np) return { ok: false, error: "nothing playing" };
    const track = findTrack(s, userId, np.trackId);
    np.positionSec = Math.max(0, Math.min(track ? track.durationSec : 0, Math.round(muNum(params.positionSec))));
    np.at = muNow();
    saveMusicState();
    return { ok: true, result: { positionSec: np.positionSec } };
  });

  registerLensAction("music", "now-playing", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const np = s.nowPlaying.get(userId);
    if (!np) return { ok: true, result: { nowPlaying: null } };
    const track = findTrack(s, userId, np.trackId);
    return { ok: true, result: { nowPlaying: track ? { track, positionSec: np.positionSec } : null } };
  });

  registerLensAction("music", "queue-add", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    if (!findTrack(s, userId, params.trackId)) return { ok: false, error: "track not found" };
    const q = muListB(s.queue, userId);
    if (params.next === true) q.unshift(String(params.trackId));
    else q.push(String(params.trackId));
    saveMusicState();
    return { ok: true, result: { queueLength: q.length } };
  });

  registerLensAction("music", "queue-list", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const tracks = (s.queue.get(userId) || []).map((id) => findTrack(s, userId, id)).filter(Boolean);
    return { ok: true, result: { tracks, count: tracks.length } };
  });

  registerLensAction("music", "queue-clear", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    s.queue.set(muAid(ctx), []);
    saveMusicState();
    return { ok: true, result: { cleared: true } };
  });

  // ── Followed artists ────────────────────────────────────────────────
  registerLensAction("music", "artist-follow", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = muClean(params.name, 120);
    if (!name) return { ok: false, error: "artist name required" };
    const list = muListB(s.following, muAid(ctx));
    const i = list.indexOf(name);
    const following = i < 0;
    if (following) list.push(name);
    else list.splice(i, 1);
    saveMusicState();
    return { ok: true, result: { artist: name, following } };
  });

  registerLensAction("music", "artist-list", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const tracks = s.tracks.get(userId) || [];
    const artists = (s.following.get(userId) || []).map((name) => ({
      name,
      trackCount: tracks.filter((t) => t.artist === name).length,
    }));
    return { ok: true, result: { artists, count: artists.length } };
  });

  // ── Listening stats + discovery ─────────────────────────────────────
  registerLensAction("music", "recently-played", (ctx, _a, _params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const seen = new Set();
    const recent = [];
    const plays = [...(s.plays.get(userId) || [])].reverse();
    for (const p of plays) {
      if (seen.has(p.trackId)) continue;
      seen.add(p.trackId);
      const track = findTrack(s, userId, p.trackId);
      if (track) recent.push({ ...track, playedAt: p.at });
      if (recent.length >= 25) break;
    }
    return { ok: true, result: { tracks: recent, count: recent.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "top-tracks", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tracks = [...(s.tracks.get(muAid(ctx)) || [])]
      .filter((t) => t.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 20);
    return { ok: true, result: { tracks, count: tracks.length } };
  });

  registerLensAction("music", "top-artists", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const byArtist = new Map();
    for (const t of s.tracks.get(muAid(ctx)) || []) {
      byArtist.set(t.artist, (byArtist.get(t.artist) || 0) + t.playCount);
    }
    const artists = [...byArtist.entries()]
      .map(([artist, plays]) => ({ artist, plays }))
      .filter((a) => a.plays > 0)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 20);
    return { ok: true, result: { artists, count: artists.length } };
  });

  registerLensAction("music", "listening-stats", (ctx, _a, _params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const plays = s.plays.get(userId) || [];
    const listenedSec = plays.reduce((a, p) => a + muNum(p.durationSec), 0);
    const byGenre = {};
    const trackGenre = new Map((s.tracks.get(userId) || []).map((t) => [t.id, t.genre]));
    for (const p of plays) {
      const g = trackGenre.get(p.trackId) || "unknown";
      byGenre[g] = (byGenre[g] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        totalPlays: plays.length,
        listenedMinutes: Math.round(listenedSec / 60),
        listenedHours: Math.round((listenedSec / 3600) * 10) / 10,
        byGenre,
        libraryTracks: (s.tracks.get(userId) || []).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "wrapped", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const year = muClean(params.year, 4) || String(new Date().getFullYear());
    const plays = (s.plays.get(userId) || []).filter((p) => String(p.at).startsWith(year));
    const trackById = new Map((s.tracks.get(userId) || []).map((t) => [t.id, t]));
    const trackPlays = new Map();
    const artistPlays = new Map();
    let minutes = 0;
    for (const p of plays) {
      const t = trackById.get(p.trackId);
      minutes += muNum(p.durationSec) / 60;
      trackPlays.set(p.trackId, (trackPlays.get(p.trackId) || 0) + 1);
      if (t) artistPlays.set(t.artist, (artistPlays.get(t.artist) || 0) + 1);
    }
    const topTracks = [...trackPlays.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => ({ title: trackById.get(id)?.title || "(removed)", plays: n }));
    const topArtists = [...artistPlays.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([artist, n]) => ({ artist, plays: n }));
    return {
      ok: true,
      result: { year, totalPlays: plays.length, minutesListened: Math.round(minutes), topTracks, topArtists },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "daily-mix", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const tracks = s.tracks.get(userId) || [];
    // genre affinity from play history
    const genreScore = {};
    for (const t of tracks) genreScore[t.genre] = (genreScore[t.genre] || 0) + t.playCount;
    const recentlyPlayed = new Set((s.plays.get(userId) || []).slice(-10).map((p) => p.trackId));
    const mix = tracks
      .filter((t) => !recentlyPlayed.has(t.id))
      .map((t) => ({ ...t, score: (genreScore[t.genre] || 0) + 1 }))
      .sort((a, b) => b.score - a.score || b.addedAt.localeCompare(a.addedAt))
      .slice(0, 20);
    return { ok: true, result: { tracks: mix, count: mix.length } };
  });

  registerLensAction("music", "music-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const tracks = s.tracks.get(userId) || [];
    const plays = s.plays.get(userId) || [];
    return {
      ok: true,
      result: {
        tracks: tracks.length,
        liked: tracks.filter((t) => t.liked).length,
        playlists: (s.playlists.get(userId) || []).length,
        following: (s.following.get(userId) || []).length,
        totalPlays: plays.length,
        listenedHours: Math.round((plays.reduce((a, p) => a + muNum(p.durationSec), 0) / 3600) * 10) / 10,
        queued: (s.queue.get(userId) || []).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Lyrics (Spotify/Apple Music timed-lyrics parity) ────────────────
  registerLensAction("music", "track-lyrics-set", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    const raw = params.lyrics;
    if (Array.isArray(raw)) {
      track.lyrics = raw
        .map((l) => ({ timeSec: Math.max(0, muNum(l.timeSec)), line: muClean(l.line ?? l.text, 240) }))
        .filter((l) => l.line)
        .sort((a, b) => a.timeSec - b.timeSec);
      track.lyricsSynced = true;
    } else {
      const text = muClean(raw, 8000);
      track.lyrics = text ? text.split(/\r?\n/).map((line) => ({ timeSec: null, line: line.slice(0, 240) })) : [];
      track.lyricsSynced = false;
    }
    saveMusicState();
    return { ok: true, result: { id: track.id, lineCount: track.lyrics.length, synced: track.lyricsSynced } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "track-lyrics-get", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    return { ok: true, result: { id: track.id, title: track.title, lyrics: track.lyrics || [], synced: !!track.lyricsSynced } };
  });

  // ── Radio / autoplay station (seed → continuous queue) ──────────────
  registerLensAction("music", "radio-start", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const lib = s.tracks.get(userId) || [];
    if (lib.length === 0) return { ok: false, error: "library empty — add tracks before starting radio" };
    let seedTrack = null, seedGenre = null, seedArtist = null, label = "";
    if (params.seedTrackId) {
      seedTrack = findTrack(s, userId, params.seedTrackId);
      if (!seedTrack) return { ok: false, error: "seed track not found" };
      seedGenre = seedTrack.genre; seedArtist = seedTrack.artist;
      label = `${seedTrack.title} Radio`;
    } else if (params.seedArtist) {
      seedArtist = muClean(params.seedArtist, 120);
      label = `${seedArtist} Radio`;
    } else if (params.seedGenre) {
      seedGenre = muClean(params.seedGenre, 60).toLowerCase();
      label = `${seedGenre} Radio`;
    } else {
      return { ok: false, error: "provide seedTrackId, seedArtist, or seedGenre" };
    }
    const scored = lib
      .filter((t) => !seedTrack || t.id !== seedTrack.id)
      .map((t) => {
        let score = 1;
        if (seedGenre && t.genre === seedGenre) score += 3;
        if (seedArtist && t.artist === seedArtist) score += 2;
        score += Math.min(2, t.playCount * 0.2);
        if (t.liked) score += 1;
        return { t, score: score + Math.random() * 0.5 };
      })
      .sort((a, b) => b.score - a.score);
    const limit = Math.max(5, Math.min(50, Math.round(muNum(params.limit, 25))));
    const stationTracks = scored.slice(0, limit).map((x) => x.t);
    s.queue.set(userId, stationTracks.map((t) => t.id));
    s.radio.set(userId, { label, seedGenre, seedArtist, startedAt: muNow(), trackCount: stationTracks.length });
    saveMusicState();
    return { ok: true, result: { station: s.radio.get(userId), tracks: stationTracks } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "radio-status", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { station: s.radio.get(muAid(ctx)) || null } };
  });

  // ── Smart Shuffle / AI DJ — weighted favorites + discovery mix ──────
  registerLensAction("music", "smart-shuffle", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    let pool = s.tracks.get(userId) || [];
    if (params.playlistId) {
      const pl = (s.playlists.get(userId) || []).find((p) => p.id === params.playlistId);
      if (!pl) return { ok: false, error: "playlist not found" };
      pool = pl.trackIds.map((id) => findTrack(s, userId, id)).filter(Boolean);
    }
    if (pool.length < 2) return { ok: false, error: "need 2+ tracks to shuffle" };
    const liked = pool.filter((t) => t.liked);
    const familiar = pool.filter((t) => t.playCount > 0 && !t.liked);
    const fresh = pool.filter((t) => t.playCount === 0 && !t.liked);
    const buckets = [liked, familiar, fresh];
    const weights = [0.45, 0.35, 0.2];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const session = [];
    const used = new Set();
    const target = Math.max(2, Math.min(40, pool.length));
    let guard = 0;
    while (session.length < target && guard++ < target * 8) {
      const r = Math.random();
      const bi = r < weights[0] ? 0 : r < weights[0] + weights[1] ? 1 : 2;
      let b = buckets[bi].filter((t) => !used.has(t.id));
      if (b.length === 0) b = pool.filter((t) => !used.has(t.id));
      if (b.length === 0) break;
      const t = pick(b);
      used.add(t.id);
      session.push(t);
    }
    s.queue.set(userId, session.map((t) => t.id));
    saveMusicState();
    const genreCount = {};
    session.forEach((t) => { genreCount[t.genre] = (genreCount[t.genre] || 0) + 1; });
    const dominantGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "mixed";
    return {
      ok: true,
      result: {
        tracks: session,
        count: session.length,
        dj: `Here's your mix — leaning ${dominantGenre}, ${liked.length ? "built around your liked songs" : "fresh picks from your library"}. Enjoy the ride.`,
        breakdown: {
          liked: session.filter((t) => t.liked).length,
          familiar: session.filter((t) => t.playCount > 0 && !t.liked).length,
          fresh: session.filter((t) => t.playCount === 0 && !t.liked).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Sleep timer ─────────────────────────────────────────────────────
  registerLensAction("music", "sleep-timer-set", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const minutes = Math.max(1, Math.min(720, Math.round(muNum(params.minutes, 30))));
    const endsAt = new Date(Date.now() + minutes * 60000).toISOString();
    s.sleepTimers.set(muAid(ctx), { endsAt, minutes, setAt: muNow() });
    saveMusicState();
    return { ok: true, result: { active: true, endsAt, minutes } };
  });

  registerLensAction("music", "sleep-timer-get", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const t = s.sleepTimers.get(userId);
    if (!t) return { ok: true, result: { active: false } };
    const remainingMs = new Date(t.endsAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      s.sleepTimers.delete(userId);
      saveMusicState();
      return { ok: true, result: { active: false, expired: true } };
    }
    return { ok: true, result: { active: true, endsAt: t.endsAt, remainingSec: Math.round(remainingMs / 1000), remainingMin: Math.ceil(remainingMs / 60000) } };
  });

  registerLensAction("music", "sleep-timer-cancel", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    s.sleepTimers.delete(muAid(ctx));
    saveMusicState();
    return { ok: true, result: { active: false } };
  });

  // ── Blend — round-robin merge of taste sources into a playlist ──────
  registerLensAction("music", "blend", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const name = muClean(params.name, 120) || "Your Blend";
    let sources = [];
    if (Array.isArray(params.playlistIds) && params.playlistIds.length >= 1) {
      const pls = s.playlists.get(userId) || [];
      for (const pid of params.playlistIds) {
        const pl = pls.find((p) => p.id === pid);
        if (pl) sources.push(pl.trackIds.map((id) => findTrack(s, userId, id)).filter(Boolean));
      }
      if (sources.length === 0) return { ok: false, error: "no valid playlists in playlistIds" };
    } else {
      const lib = s.tracks.get(userId) || [];
      sources = [
        lib.filter((t) => t.liked),
        [...lib].filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 25),
      ];
    }
    const blended = [];
    const seen = new Set();
    let added = true;
    for (let i = 0; added; i++) {
      added = false;
      for (const src of sources) {
        if (src[i]) {
          added = true;
          if (!seen.has(src[i].id)) { seen.add(src[i].id); blended.push(src[i].id); }
        }
      }
    }
    if (blended.length === 0) return { ok: false, error: "nothing to blend — like or play some tracks first" };
    const playlist = {
      id: muId("pl"), name,
      description: `Blend of ${sources.length} source${sources.length === 1 ? "" : "s"} — ${blended.length} tracks`,
      collaborative: false, trackIds: blended, createdAt: muNow(), blend: true,
    };
    muListB(s.playlists, userId).push(playlist);
    saveMusicState();
    return { ok: true, result: { playlist, trackCount: blended.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Recommendations (seed-based or taste-profile) ───────────────────
  registerLensAction("music", "recommend", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const lib = s.tracks.get(userId) || [];
    if (lib.length === 0) return { ok: true, result: { tracks: [], count: 0, basis: "empty-library" } };
    const seed = params.seedTrackId ? findTrack(s, userId, params.seedTrackId) : null;
    const genreScore = {};
    for (const t of lib) genreScore[t.genre] = (genreScore[t.genre] || 0) + t.playCount + (t.liked ? 2 : 0);
    const recs = lib
      .filter((t) => !seed || t.id !== seed.id)
      .map((t) => {
        let score = (genreScore[t.genre] || 0) * 0.5;
        if (seed) {
          if (t.genre === seed.genre) score += 4;
          if (t.artist === seed.artist) score += 3;
        }
        if (t.playCount === 0) score += 1.5;
        return { ...t, matchScore: Math.round(score * 10) / 10 };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 20);
    return { ok: true, result: { tracks: recs, count: recs.length, basis: seed ? `seed:${seed.title}` : "taste-profile" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Genre browse hub ────────────────────────────────────────────────
  registerLensAction("music", "genre-hub", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lib = s.tracks.get(muAid(ctx)) || [];
    const byGenre = {};
    for (const t of lib) {
      const g = t.genre || "unknown";
      if (!byGenre[g]) byGenre[g] = { genre: g, trackCount: 0, totalPlays: 0, liked: 0 };
      byGenre[g].trackCount++;
      byGenre[g].totalPlays += t.playCount;
      if (t.liked) byGenre[g].liked++;
    }
    const genres = Object.values(byGenre).sort((a, b) => b.trackCount - a.trackCount);
    return { ok: true, result: { genres, count: genres.length } };
  });

  // ── Audio settings (crossfade, gapless, normalize, quality) ─────────
  registerLensAction("music", "audio-settings-get", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const defaults = { crossfadeSec: 0, gapless: true, normalize: true, quality: "high", monoAudio: false };
    return { ok: true, result: { settings: { ...defaults, ...(s.audioSettings.get(muAid(ctx)) || {}) } } };
  });

  registerLensAction("music", "audio-settings-set", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const defaults = { crossfadeSec: 0, gapless: true, normalize: true, quality: "high", monoAudio: false };
    const cur = { ...defaults, ...(s.audioSettings.get(muAid(ctx)) || {}) };
    if (params.crossfadeSec != null) cur.crossfadeSec = Math.max(0, Math.min(12, Math.round(muNum(params.crossfadeSec))));
    if (params.gapless != null) cur.gapless = params.gapless === true;
    if (params.normalize != null) cur.normalize = params.normalize === true;
    if (params.monoAudio != null) cur.monoAudio = params.monoAudio === true;
    if (params.quality != null) {
      const q = String(params.quality).toLowerCase();
      if (["low", "normal", "high", "lossless"].includes(q)) cur.quality = q;
    }
    s.audioSettings.set(muAid(ctx), cur);
    saveMusicState();
    return { ok: true, result: { settings: cur } };
  });

  // ════════════════════════════════════════════════════════════════════
  // Feature-parity backlog — 17 buildable gaps vs Spotify (2026)
  // ════════════════════════════════════════════════════════════════════

  function getMusicExtras() {
    const s = getMusicState();
    if (!s) return null;
    for (const k of ["downloads", "devices", "jams", "scheduledPlaylists", "shareCards", "djSessions"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    if (!(s.jamRegistry instanceof Map)) s.jamRegistry = new Map();
    return s;
  }

  // ── 1. [M] Free-API music ingestion (iTunes Search — free, no key) ───
  // iTunes Search API returns real previewable tracks (30s previews).
  registerLensAction("music", "ingest-itunes", async (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const term = muClean(params.term, 120);
    if (!term) return { ok: false, error: "search term required" };
    const limit = Math.max(1, Math.min(25, Math.round(muNum(params.limit, 10))));
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 6 * 60 * 60 * 1000 });
      const results = Array.isArray(data?.results) ? data.results : [];
      const userId = muAid(ctx);
      const lib = muListB(s.tracks, userId);
      const existing = new Set(lib.map((t) => t.externalId).filter(Boolean));
      let ingested = 0, skipped = 0;
      const added = [];
      for (const r of results) {
        const extId = `itunes:${r.trackId}`;
        if (existing.has(extId)) { skipped++; continue; }
        const track = {
          id: muId("trk"),
          title: muClean(r.trackName, 200) || "Untitled",
          artist: muClean(r.artistName, 120) || "Unknown Artist",
          album: muClean(r.collectionName, 200) || null,
          genre: muClean(r.primaryGenreName, 60).toLowerCase() || "unknown",
          durationSec: Math.max(1, Math.round(muNum(r.trackTimeMillis, 210000) / 1000)),
          liked: false, playCount: 0, addedAt: muNow(),
          externalId: extId,
          previewUrl: r.previewUrl || null,
          artworkUrl: r.artworkUrl100 || null,
          source: "itunes-search",
        };
        lib.push(track); existing.add(extId);
        added.push(track); ingested++;
      }
      saveMusicState();
      return { ok: true, result: { ingested, skipped, tracks: added, source: "itunes-search" } };
    } catch (e) {
      return { ok: false, error: `itunes search unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── 2. [S] Auto-fetched synced lyrics via LRCLIB (free, no key) ──────
  registerLensAction("music", "lyrics-autofetch", async (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    const dur = Math.round(track.durationSec || 0);
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}${track.album ? `&album_name=${encodeURIComponent(track.album)}` : ""}${dur ? `&duration=${dur}` : ""}`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 24 * 60 * 60 * 1000 });
      const synced = String(data?.syncedLyrics || "");
      const plain = String(data?.plainLyrics || "");
      if (synced) {
        // LRC format: [mm:ss.xx] line
        const lines = synced.split(/\r?\n/).map((ln) => {
          const m = ln.match(/^\[(\d+):(\d+)(?:\.(\d+))?\]\s*(.*)$/);
          if (!m) return null;
          const timeSec = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
          return { timeSec: Math.max(0, timeSec), line: muClean(m[4], 240) };
        }).filter((l) => l && l.line);
        track.lyrics = lines.sort((a, b) => a.timeSec - b.timeSec);
        track.lyricsSynced = true;
      } else if (plain) {
        track.lyrics = plain.split(/\r?\n/).map((line) => ({ timeSec: null, line: line.slice(0, 240) })).filter((l) => l.line);
        track.lyricsSynced = false;
      } else {
        return { ok: true, result: { id: track.id, found: false, message: "no lyrics found on LRCLIB" } };
      }
      saveMusicState();
      return { ok: true, result: { id: track.id, found: true, lineCount: track.lyrics.length, synced: track.lyricsSynced, source: "lrclib" } };
    } catch (e) {
      return { ok: false, error: `lrclib unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── 3. [M] Playback engine settings — crossfade/gapless/normalize/EQ ─
  // audio-settings-get/set already exist; add EQ band persistence + an
  // engine-config macro that returns the full normalized config the
  // frontend player.ts reads on every track load.
  registerLensAction("music", "eq-set", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const defaults = { crossfadeSec: 0, gapless: true, normalize: true, quality: "high", monoAudio: false };
    const cur = { ...defaults, eq: { enabled: false, preset: "flat", bands: { bass: 0, mid: 0, treble: 0 } }, ...(s.audioSettings.get(userId) || {}) };
    if (!cur.eq) cur.eq = { enabled: false, preset: "flat", bands: { bass: 0, mid: 0, treble: 0 } };
    if (params.enabled != null) cur.eq.enabled = params.enabled === true;
    const PRESETS = {
      flat: { bass: 0, mid: 0, treble: 0 },
      bass_boost: { bass: 8, mid: 0, treble: -2 },
      treble_boost: { bass: -2, mid: 0, treble: 8 },
      vocal: { bass: -3, mid: 6, treble: 2 },
      lofi: { bass: 4, mid: -2, treble: -6 },
    };
    if (params.preset != null) {
      const p = String(params.preset).toLowerCase();
      if (PRESETS[p]) { cur.eq.preset = p; cur.eq.bands = { ...PRESETS[p] }; }
    }
    if (params.bands && typeof params.bands === "object") {
      cur.eq.preset = "custom";
      for (const k of ["bass", "mid", "treble"]) {
        if (params.bands[k] != null) cur.eq.bands[k] = Math.max(-12, Math.min(12, Math.round(muNum(params.bands[k]))));
      }
    }
    s.audioSettings.set(userId, cur);
    saveMusicState();
    return { ok: true, result: { eq: cur.eq, presets: Object.keys(PRESETS) } };
  });

  registerLensAction("music", "engine-config", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const defaults = { crossfadeSec: 0, gapless: true, normalize: true, quality: "high", monoAudio: false };
    const cfg = { ...defaults, eq: { enabled: false, preset: "flat", bands: { bass: 0, mid: 0, treble: 0 } }, ...(s.audioSettings.get(muAid(ctx)) || {}) };
    // gain target in dB for normalize, used by the GainNode in player.ts
    const normalizeTargetDb = cfg.normalize ? -14 : 0;
    return { ok: true, result: { config: cfg, normalizeTargetDb, crossfadeMs: (cfg.crossfadeSec || 0) * 1000 } };
  });

  // ── 4. [M] Offline / downloaded playback registry ───────────────────
  registerLensAction("music", "download-add", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const track = findTrack(s, userId, params.trackId);
    if (!track) return { ok: false, error: "track not found" };
    const list = muListB(s.downloads, userId);
    if (list.some((d) => d.trackId === track.id)) return { ok: true, result: { trackId: track.id, alreadyDownloaded: true } };
    list.push({ trackId: track.id, title: track.title, artist: track.artist, durationSec: track.durationSec, sizeKb: Math.round(track.durationSec * 16), downloadedAt: muNow() });
    saveMusicState();
    return { ok: true, result: { trackId: track.id, downloaded: true, count: list.length } };
  });

  registerLensAction("music", "download-list", (ctx, _a, _params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.downloads.get(muAid(ctx)) || [];
    return { ok: true, result: { downloads: list, count: list.length, totalSizeKb: list.reduce((a, d) => a + (d.sizeKb || 0), 0) } };
  });

  registerLensAction("music", "download-remove", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.downloads.get(muAid(ctx)) || [];
    const i = list.findIndex((d) => d.trackId === params.trackId);
    if (i < 0) return { ok: false, error: "not downloaded" };
    list.splice(i, 1);
    saveMusicState();
    return { ok: true, result: { removed: params.trackId, count: list.length } };
  });

  // ── 5. [L] Cross-device handoff — "Connect" ─────────────────────────
  registerLensAction("music", "device-register", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const name = muClean(params.name, 80) || "Unnamed Device";
    const kind = ["phone", "desktop", "tablet", "speaker", "tv", "web"].includes(String(params.kind)) ? String(params.kind) : "web";
    const list = muListB(s.devices, userId);
    let device = list.find((d) => d.name === name && d.kind === kind);
    if (!device) {
      device = { id: muId("dev"), name, kind, registeredAt: muNow(), lastSeen: muNow(), active: false };
      list.push(device);
    } else {
      device.lastSeen = muNow();
    }
    saveMusicState();
    return { ok: true, result: { device } };
  });

  registerLensAction("music", "device-list", (ctx, _a, _params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.devices.get(muAid(ctx)) || [];
    return { ok: true, result: { devices: list, count: list.length, activeDeviceId: list.find((d) => d.active)?.id || null } };
  });

  registerLensAction("music", "device-transfer", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const list = s.devices.get(userId) || [];
    const target = list.find((d) => d.id === params.deviceId);
    if (!target) return { ok: false, error: "device not found" };
    list.forEach((d) => { d.active = d.id === target.id; });
    const np = s.nowPlaying.get(userId);
    target.lastSeen = muNow();
    saveMusicState();
    return { ok: true, result: { activeDeviceId: target.id, deviceName: target.name, handedOff: np ? { trackId: np.trackId, positionSec: np.positionSec } : null } };
  });

  // ── 6. [M] Karaoke / vocal-reduction mode ───────────────────────────
  // Server stores per-user karaoke prefs; player.ts uses a stereo
  // mid-side phase-cancellation node to attenuate centred vocals.
  registerLensAction("music", "karaoke-set", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const defaults = { crossfadeSec: 0, gapless: true, normalize: true, quality: "high", monoAudio: false };
    const cur = { ...defaults, ...(s.audioSettings.get(userId) || {}) };
    cur.karaoke = cur.karaoke || { enabled: false, vocalReductionPct: 80, scrollLyrics: true };
    if (params.enabled != null) cur.karaoke.enabled = params.enabled === true;
    if (params.vocalReductionPct != null) cur.karaoke.vocalReductionPct = Math.max(0, Math.min(100, Math.round(muNum(params.vocalReductionPct))));
    if (params.scrollLyrics != null) cur.karaoke.scrollLyrics = params.scrollLyrics === true;
    s.audioSettings.set(userId, cur);
    saveMusicState();
    return { ok: true, result: { karaoke: cur.karaoke } };
  });

  // ── 7. [M] AI DJ with voice narration ───────────────────────────────
  registerLensAction("music", "dj-session", async (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const lib = s.tracks.get(userId) || [];
    if (lib.length < 2) return { ok: false, error: "need 2+ tracks for a DJ session" };
    // build a session set via the smart-shuffle weighting
    const liked = lib.filter((t) => t.liked);
    const familiar = lib.filter((t) => t.playCount > 0 && !t.liked);
    const fresh = lib.filter((t) => t.playCount === 0 && !t.liked);
    const ordered = [...liked, ...familiar, ...fresh].slice(0, Math.max(2, Math.min(20, Math.round(muNum(params.limit, 10)))));
    const genreCount = {};
    ordered.forEach((t) => { genreCount[t.genre] = (genreCount[t.genre] || 0) + 1; });
    const dominantGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "mixed";
    // deterministic narration baseline
    let narration = `Coming up — a ${dominantGenre} set pulled from your library. ${liked.length ? `Leading with tracks you've liked, then some deeper cuts.` : `Some fresh picks to start.`} Let's get into it.`;
    let model = "deterministic";
    if (ctx?.llm?.chat) {
      try {
        const titles = ordered.slice(0, 6).map((t) => `${t.title} by ${t.artist}`).join("; ");
        const res = await ctx.llm.chat({
          messages: [
            { role: "system", content: "You are an AI radio DJ. Write ONE short, warm spoken intro (2 sentences max) for an upcoming music set. Be specific and natural — no emojis, no markdown." },
            { role: "user", content: `Genre lean: ${dominantGenre}. Upcoming tracks: ${titles}.` },
          ],
          temperature: 0.7, maxTokens: 120, slot: "utility",
        });
        const text = String(res?.text || res?.content || res?.message?.content || "").trim();
        if (text) { narration = text; model = "utility"; }
      } catch (_e) { /* deterministic fallback */ }
    }
    s.queue.set(userId, ordered.map((t) => t.id));
    const session = { id: muId("dj"), narration, dominantGenre, trackCount: ordered.length, startedAt: muNow(), model };
    s.djSessions.set(userId, session);
    saveMusicState();
    // voice payload — frontend routes narration through Web Speech / substrate TTS
    return { ok: true, result: { session, tracks: ordered, voice: { text: narration, rate: 1.0, pitch: 1.0 } } };
  });

  // ── 8. [S] AI Playlist — prompt → playlist ──────────────────────────
  registerLensAction("music", "ai-playlist", async (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const prompt = muClean(params.prompt, 300);
    if (!prompt) return { ok: false, error: "prompt required (e.g. 'upbeat focus music')" };
    const lib = s.tracks.get(userId) || [];
    if (lib.length === 0) return { ok: false, error: "library empty — add tracks first" };
    let chosenIds = [];
    let basis = "keyword-match";
    if (ctx?.llm?.chat) {
      try {
        const catalog = lib.map((t) => `${t.id}|${t.title}|${t.artist}|${t.genre}`).join("\n");
        const res = await ctx.llm.chat({
          messages: [
            { role: "system", content: "You are a playlist curator. From the catalog, pick the track IDs that best fit the user's request. Reply ONLY with a comma-separated list of IDs, nothing else." },
            { role: "user", content: `Request: "${prompt}"\n\nCatalog (id|title|artist|genre):\n${catalog}` },
          ],
          temperature: 0.5, maxTokens: 200, slot: "utility",
        });
        const text = String(res?.text || res?.content || res?.message?.content || "");
        const ids = text.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
        chosenIds = ids.filter((id) => lib.some((t) => t.id === id));
        if (chosenIds.length) basis = "llm";
      } catch (_e) { /* fallback below */ }
    }
    if (chosenIds.length === 0) {
      // keyword heuristic over title/artist/genre/tags
      const terms = prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const scored = lib.map((t) => {
        const hay = `${t.title} ${t.artist} ${t.genre} ${(t.tags || []).join(" ")}`.toLowerCase();
        let score = terms.reduce((a, w) => a + (hay.includes(w) ? 2 : 0), 0);
        score += t.liked ? 1 : 0;
        return { t, score };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      chosenIds = (scored.length ? scored : lib.map((t) => ({ t }))).slice(0, 20).map((x) => x.t.id);
    }
    const playlist = {
      id: muId("pl"), name: prompt.slice(0, 60),
      description: `AI-generated from prompt: "${prompt}"`,
      collaborative: false, trackIds: chosenIds.slice(0, 30), createdAt: muNow(), aiGenerated: true,
    };
    muListB(s.playlists, userId).push(playlist);
    saveMusicState();
    return { ok: true, result: { playlist, trackCount: playlist.trackIds.length, basis } };
  });

  // ── 9. [M] Scheduled algorithmic playlists — Discover Weekly etc. ────
  registerLensAction("music", "scheduled-playlist-refresh", (ctx, _a, params = {}) => {
  try {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const kind = ["discover_weekly", "release_radar", "daylist"].includes(String(params.kind)) ? String(params.kind) : "discover_weekly";
    const lib = s.tracks.get(userId) || [];
    if (lib.length === 0) return { ok: false, error: "library empty" };
    const plays = s.plays.get(userId) || [];
    const genreScore = {};
    for (const t of lib) genreScore[t.genre] = (genreScore[t.genre] || 0) + t.playCount + (t.liked ? 2 : 0);
    const recentlyPlayed = new Set(plays.slice(-20).map((p) => p.trackId));
    let picks = [];
    if (kind === "release_radar") {
      picks = [...lib].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 20);
    } else if (kind === "daylist") {
      const hour = new Date().getHours();
      const mood = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
      picks = lib.map((t) => ({ t, score: (genreScore[t.genre] || 0) + Math.random() }))
        .sort((a, b) => b.score - a.score).slice(0, 20).map((x) => x.t);
      picks.mood = mood;
    } else {
      picks = lib.filter((t) => !recentlyPlayed.has(t.id))
        .map((t) => ({ ...t, score: (genreScore[t.genre] || 0) * 0.4 + (t.playCount === 0 ? 3 : 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 20);
    }
    const refreshedAt = muNow();
    const nextRefreshHours = kind === "daylist" ? 6 : kind === "release_radar" ? 168 : 168;
    const entry = {
      kind, trackIds: picks.map((t) => t.id), refreshedAt,
      nextRefreshAt: new Date(Date.now() + nextRefreshHours * 3600000).toISOString(),
      mood: picks.mood || null,
    };
    const map = muListB(s.scheduledPlaylists, userId);
    const idx = map.findIndex((m) => m.kind === kind);
    if (idx >= 0) map[idx] = entry; else map.push(entry);
    saveMusicState();
    const tracks = entry.trackIds.map((id) => findTrack(s, userId, id)).filter(Boolean);
    return { ok: true, result: { kind, tracks, count: tracks.length, refreshedAt, nextRefreshAt: entry.nextRefreshAt, mood: entry.mood } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("music", "scheduled-playlist-list", (ctx, _a, _params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const map = s.scheduledPlaylists.get(userId) || [];
    const out = map.map((m) => ({
      kind: m.kind, refreshedAt: m.refreshedAt, nextRefreshAt: m.nextRefreshAt, mood: m.mood,
      trackCount: m.trackIds.length, due: new Date(m.nextRefreshAt).getTime() <= Date.now(),
    }));
    return { ok: true, result: { playlists: out, count: out.length } };
  });

  // ── 10. [M] Recommendation model — play-history collaborative-ish ────
  // Beyond genre affinity: weights co-occurrence in play sessions,
  // recency, artist diversity, and skip behaviour.
  registerLensAction("music", "smart-recommend", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const lib = s.tracks.get(userId) || [];
    if (lib.length === 0) return { ok: true, result: { tracks: [], count: 0, basis: "empty-library" } };
    const plays = s.plays.get(userId) || [];
    // genre + artist affinity from history
    const genreAff = {}, artistAff = {};
    const trackById = new Map(lib.map((t) => [t.id, t]));
    plays.forEach((p, i) => {
      const t = trackById.get(p.trackId);
      if (!t) return;
      const recency = 1 + (i / Math.max(1, plays.length)); // newer plays weigh more
      genreAff[t.genre] = (genreAff[t.genre] || 0) + recency;
      artistAff[t.artist] = (artistAff[t.artist] || 0) + recency;
    });
    // co-occurrence: tracks played within 3 slots of each other
    const cooc = new Map();
    for (let i = 0; i < plays.length; i++) {
      for (let j = i + 1; j < Math.min(plays.length, i + 4); j++) {
        const a = plays[i].trackId, b = plays[j].trackId;
        if (a === b) continue;
        cooc.set(`${a}|${b}`, (cooc.get(`${a}|${b}`) || 0) + 1);
        cooc.set(`${b}|${a}`, (cooc.get(`${b}|${a}`) || 0) + 1);
      }
    }
    const recentSet = new Set(plays.slice(-8).map((p) => p.trackId));
    const recs = lib
      .filter((t) => !recentSet.has(t.id))
      .map((t) => {
        let score = (genreAff[t.genre] || 0) * 1.0 + (artistAff[t.artist] || 0) * 0.8;
        // co-occurrence boost from recently played tracks
        for (const rid of recentSet) score += (cooc.get(`${rid}|${t.id}`) || 0) * 1.5;
        if (t.liked) score += 2;
        if (t.playCount === 0) score += 1.2; // exploration bonus
        return { ...t, matchScore: Math.round(score * 100) / 100 };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
    // artist-diversity pass — don't return 10 by the same artist
    const seenArtist = {};
    const diverse = [];
    for (const r of recs) {
      const c = seenArtist[r.artist] || 0;
      if (c >= 3) continue;
      seenArtist[r.artist] = c + 1;
      diverse.push(r);
      if (diverse.length >= Math.max(1, Math.min(40, Math.round(muNum(params.limit, 20))))) break;
    }
    return { ok: true, result: { tracks: diverse, count: diverse.length, basis: "collaborative+recency", historyDepth: plays.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 11. [M] Jam — real-time synchronized group listening ────────────
  registerLensAction("music", "jam-create", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const name = muClean(params.name, 80) || "Listening Jam";
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const jam = {
      id: muId("jam"), code, name, hostId: userId,
      participants: [userId], queue: [], currentTrackId: null, positionSec: 0,
      playbackState: "paused", createdAt: muNow(), updatedAt: muNow(),
    };
    s.jams.set(userId, jam.id);
    s.jamRegistry.set(jam.id, jam);
    saveMusicState();
    return { ok: true, result: { jam } };
  });

  registerLensAction("music", "jam-join", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const code = muClean(params.code, 12).toUpperCase();
    let jam = null;
    for (const j of s.jamRegistry.values()) { if (j.code === code) { jam = j; break; } }
    if (!jam) return { ok: false, error: "jam not found — check the code" };
    if (!jam.participants.includes(userId)) jam.participants.push(userId);
    jam.updatedAt = muNow();
    s.jams.set(userId, jam.id);
    saveMusicState();
    return { ok: true, result: { jam } };
  });

  registerLensAction("music", "jam-sync", (ctx, _a, params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const jamId = s.jams.get(userId);
    if (!jamId) return { ok: false, error: "not in a jam" };
    const jam = s.jamRegistry.get(jamId);
    if (!jam) return { ok: false, error: "jam ended" };
    // only the host can drive playback state
    if (jam.hostId === userId) {
      if (params.currentTrackId != null) jam.currentTrackId = String(params.currentTrackId);
      if (params.positionSec != null) jam.positionSec = Math.max(0, Math.round(muNum(params.positionSec)));
      if (params.playbackState != null && ["playing", "paused"].includes(String(params.playbackState))) jam.playbackState = String(params.playbackState);
      if (Array.isArray(params.queue)) jam.queue = params.queue.map(String).slice(0, 200);
      jam.updatedAt = muNow();
      saveMusicState();
    }
    return { ok: true, result: { jam, isHost: jam.hostId === userId } };
  });

  registerLensAction("music", "jam-leave", (ctx, _a, _params = {}) => {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const jamId = s.jams.get(userId);
    if (!jamId) return { ok: true, result: { left: false } };
    const jam = s.jamRegistry.get(jamId);
    if (jam) {
      jam.participants = jam.participants.filter((p) => p !== userId);
      if (jam.participants.length === 0 || jam.hostId === userId) s.jamRegistry.delete(jamId);
      else jam.updatedAt = muNow();
    }
    s.jams.delete(userId);
    saveMusicState();
    return { ok: true, result: { left: true } };
  });

  // ── 12. [S] Friend Activity feed ────────────────────────────────────
  // Surfaces what other users in the substrate are listening to, drawn
  // from their real now-playing + recent plays state.
  registerLensAction("music", "friend-activity", (ctx, _a, _params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const activity = [];
    for (const [otherId, np] of s.nowPlaying.entries()) {
      if (otherId === userId) continue;
      const track = findTrack(s, otherId, np.trackId);
      if (!track) continue;
      activity.push({
        userId: otherId, kind: "now_playing",
        track: { title: track.title, artist: track.artist, genre: track.genre },
        at: np.at,
      });
    }
    // recent plays from others (last play per user)
    for (const [otherId, plays] of s.plays.entries()) {
      if (otherId === userId || s.nowPlaying.has(otherId)) continue;
      const last = plays[plays.length - 1];
      if (!last) continue;
      const track = findTrack(s, otherId, last.trackId);
      if (!track) continue;
      activity.push({
        userId: otherId, kind: "recently_played",
        track: { title: track.title, artist: track.artist, genre: track.genre },
        at: last.at,
      });
    }
    activity.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { ok: true, result: { activity: activity.slice(0, 30), count: Math.min(30, activity.length) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 13. [M] Collaborative playlists — multi-user live editing ────────
  registerLensAction("music", "playlist-collab-edit", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    // search the editor's playlists AND any collaborative playlist
    let pl = null, ownerId = null;
    for (const [oid, list] of s.playlists.entries()) {
      const found = list.find((p) => p.id === params.playlistId);
      if (found) { pl = found; ownerId = oid; break; }
    }
    if (!pl) return { ok: false, error: "playlist not found" };
    if (ownerId !== userId && !pl.collaborative) return { ok: false, error: "playlist is not collaborative" };
    const track = findTrack(s, userId, params.trackId) || findTrack(s, ownerId, params.trackId);
    if (!track && params.op !== "remove") return { ok: false, error: "track not found" };
    pl.collabLog = pl.collabLog || [];
    if (params.op === "remove") {
      pl.trackIds = pl.trackIds.filter((x) => x !== String(params.trackId));
      pl.collabLog.push({ userId, op: "remove", trackId: String(params.trackId), at: muNow() });
    } else {
      if (!pl.trackIds.includes(String(params.trackId))) pl.trackIds.push(String(params.trackId));
      pl.collabLog.push({ userId, op: "add", trackId: String(params.trackId), trackTitle: track?.title, at: muNow() });
    }
    if (pl.collabLog.length > 100) pl.collabLog = pl.collabLog.slice(-100);
    saveMusicState();
    return { ok: true, result: { playlistId: pl.id, trackCount: pl.trackIds.length, collabLog: pl.collabLog.slice(-10) } };
  });

  // ── 14. [S] Share to social / story cards ───────────────────────────
  registerLensAction("music", "share-card", (ctx, _a, params = {}) => {
  try {
    const s = getMusicExtras(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const kind = ["track", "playlist", "wrapped"].includes(String(params.kind)) ? String(params.kind) : "track";
    let payload = null, title = "", subtitle = "";
    if (kind === "track") {
      const track = findTrack(s, userId, params.id);
      if (!track) return { ok: false, error: "track not found" };
      title = track.title; subtitle = track.artist;
      payload = { genre: track.genre, durationSec: track.durationSec, playCount: track.playCount };
    } else if (kind === "playlist") {
      const pl = (s.playlists.get(userId) || []).find((p) => p.id === params.id);
      if (!pl) return { ok: false, error: "playlist not found" };
      title = pl.name; subtitle = `${pl.trackIds.length} tracks`;
      payload = { trackCount: pl.trackIds.length };
    } else {
      const plays = s.plays.get(userId) || [];
      const minutes = Math.round(plays.reduce((a, p) => a + muNum(p.durationSec), 0) / 60);
      title = "My Listening"; subtitle = `${minutes} minutes`;
      payload = { totalPlays: plays.length, minutes };
    }
    const card = {
      id: muId("card"), kind, title, subtitle, payload,
      gradient: ["#7c3aed", "#06b6d4"], createdAt: muNow(),
      shareUrl: `concord-os.org/music/share/${kind}/${params.id || "wrapped"}`,
    };
    const list = muListB(s.shareCards, userId);
    list.unshift(card);
    if (list.length > 50) list.length = 50;
    saveMusicState();
    return { ok: true, result: { card } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 15. [M] Streaming analytics — listener demographics/geo/source ──
  registerLensAction("music", "stream-analytics", (ctx, _a, params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const myTracks = s.tracks.get(userId) || [];
    const myTrackIds = new Set(myTracks.map((t) => t.id));
    // aggregate plays of THIS user's tracks across all listeners
    const bySource = {}, byListener = new Set();
    let totalStreams = 0;
    const trackStreams = {};
    for (const [listenerId, plays] of s.plays.entries()) {
      for (const p of plays) {
        if (!myTrackIds.has(p.trackId)) continue;
        totalStreams++;
        byListener.add(listenerId);
        trackStreams[p.trackId] = (trackStreams[p.trackId] || 0) + 1;
        const src = p.source || "library";
        bySource[src] = (bySource[src] || 0) + 1;
      }
    }
    const topTracks = Object.entries(trackStreams)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, streams]) => ({ title: myTracks.find((t) => t.id === id)?.title || "(removed)", streams }));
    // genre split of own catalog
    const genreSplit = {};
    for (const t of myTracks) {
      genreSplit[t.genre] = (genreSplit[t.genre] || 0) + (trackStreams[t.id] || 0);
    }
    return {
      ok: true,
      result: {
        totalStreams, uniqueListeners: byListener.size,
        bySource, topTracks, genreSplit,
        catalogSize: myTracks.length,
        avgStreamsPerTrack: myTracks.length ? Math.round((totalStreams / myTracks.length) * 10) / 10 : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 16. [M] Canvas (looping visuals) + artist profile / bio / pick ──
  registerLensAction("music", "artist-profile-set", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    if (!(s.artistProfiles instanceof Map)) s.artistProfiles = new Map();
    const cur = s.artistProfiles.get(userId) || { bio: "", canvasUrl: null, pickTrackId: null, links: [] };
    if (params.bio != null) cur.bio = muClean(params.bio, 1000);
    if (params.canvasUrl != null) cur.canvasUrl = muClean(params.canvasUrl, 400) || null;
    if (params.pickTrackId != null) {
      const t = findTrack(s, userId, params.pickTrackId);
      cur.pickTrackId = t ? t.id : null;
    }
    if (Array.isArray(params.links)) {
      cur.links = params.links.slice(0, 8).map((l) => ({ label: muClean(l.label, 40), url: muClean(l.url, 300) })).filter((l) => l.label && l.url);
    }
    cur.updatedAt = muNow();
    s.artistProfiles.set(userId, cur);
    saveMusicState();
    return { ok: true, result: { profile: cur } };
  });

  registerLensAction("music", "artist-profile-get", (ctx, _a, _params = {}) => {
  try {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    if (!(s.artistProfiles instanceof Map)) s.artistProfiles = new Map();
    const profile = s.artistProfiles.get(userId) || { bio: "", canvasUrl: null, pickTrackId: null, links: [] };
    const pickTrack = profile.pickTrackId ? findTrack(s, userId, profile.pickTrackId) : null;
    const catalog = s.tracks.get(userId) || [];
    return {
      ok: true,
      result: {
        profile, pickTrack,
        catalogSize: catalog.length,
        totalPlays: catalog.reduce((a, t) => a + t.playCount, 0),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 17. [S] Concert / live-event listings (MusicBrainz events) ──────
  // MusicBrainz exposes event entities — free, no key. Lookup upcoming
  // events for a followed artist by their MBID.
  registerLensAction("music", "concert-listings", async (_ctx, _a, params = {}) => {
    const artist = muClean(params.artist, 120);
    if (!artist) return { ok: false, error: "artist name required" };
    try {
      // resolve artist MBID then fetch its event relations
      const search = await cachedFetchJson(
        `${MB_BASE}/artist?query=${encodeURIComponent(artist)}&limit=1&fmt=json`,
        { ttlMs: 12 * 60 * 60 * 1000, opts: { headers: { "User-Agent": mbUserAgent(), Accept: "application/json" } } });
      const mbid = search?.artists?.[0]?.id;
      if (!mbid) return { ok: true, result: { artist, events: [], count: 0, message: "artist not found in MusicBrainz" } };
      const data = await cachedFetchJson(
        `${MB_BASE}/event?artist=${mbid}&limit=50&fmt=json`,
        { ttlMs: 6 * 60 * 60 * 1000, opts: { headers: { "User-Agent": mbUserAgent(), Accept: "application/json" } } });
      const now = new Date().toISOString().slice(0, 10);
      const events = (data?.events || []).map((e) => ({
        mbid: e.id, name: e.name, type: e.type,
        date: e["life-span"]?.begin || null,
        time: e.time || null,
        cancelled: e.cancelled === true,
        setlist: e.setlist || null,
      }))
        .filter((e) => e.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const upcoming = events.filter((e) => e.date >= now && !e.cancelled);
      return { ok: true, result: { artist, mbid, events: upcoming, past: events.length - upcoming.length, count: upcoming.length, source: "musicbrainz" } };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // feed — ingest the current top albums (Apple Marketing RSS) as DTUs.
  registerLensAction("music", "feed", async (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(25, Math.round(muNum(params.limit, 15))));
    const country = muClean(params.country, 2).toLowerCase() || "us";
    try {
      const r = await fetch(`https://rss.applemarketing.com/api/v2/${country}/music/most-played/${limit}/albums.json`);
      if (!r.ok) return { ok: false, error: `apple rss ${r.status}` };
      const data = await r.json();
      const albums = data.feed?.results || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const a of albums) {
        if (s.feedSeen.has(a.id)) { skipped++; continue; }
        const title = `${a.name} — ${a.artistName}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${a.name}\nby ${a.artistName}\nReleased: ${a.releaseDate || "?"}\nGenre: ${(a.genres || []).map((g) => g.name).join(", ")}\n${a.url || ""}`,
          tags: ["music", "feed", "top-albums"],
          source: "apple-music-rss-feed",
          meta: { albumId: a.id, name: a.name, artist: a.artistName, releaseDate: a.releaseDate, url: a.url },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(a.id); }
      }
      saveMusicState();
      return { ok: true, result: { ingested, skipped, source: "apple-music-top-albums", dtuIds } };
    } catch (e) {
      return { ok: false, error: `apple rss unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Content-engine bridge: publish a DAW track as an adaptive-music stem ──
  //
  // The procedural-hand-authored music flow:
  //   1. Player composes in the DAW (studio lens) → renders to audio bytes
  //   2. Client calls music.publish-as-stem with the audio data URL
  //   3. The macro stores the audio in route_artifacts (served by the
  //      existing /api/artifacts/:id/download endpoint) and inserts a
  //      DTU tagged 'adaptive_music' + 'stem:<stemName>' for discovery.
  //   4. Frontend AdaptiveMusicBridge polls music.list-published-stems
  //      on mount; for each found stem, calls adaptiveMusic.loadStem(name, url).
  //   5. Procedural Web Audio fallback is replaced live as authored
  //      stems land. Marketplace votes pick canon; royalty cascade
  //      tracks every derivative.
  //
  // Stems are stored inline (≤1 MB) or to disk (>1 MB); the existing
  // download route handles both.
  registerLensAction("music", "publish-as-stem", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const userId = muAid(ctx);
    if (!userId || userId === "anon") {
      return { ok: false, error: "authentication required to publish a stem" };
    }
    const stemName = String(params.stemName || "").toLowerCase();
    if (!ADAPTIVE_STEM_NAMES.has(stemName)) {
      return { ok: false, error: `stemName must be one of: ${[...ADAPTIVE_STEM_NAMES].join(", ")}` };
    }
    const decoded = decodeAudioDataUrl(params.audioDataUrl);
    if (!decoded) {
      return {
        ok: false,
        error: `audioDataUrl must be a base64 data: URL (audio/wav, mpeg, ogg, or flac, ≤${STEM_ARTIFACT_MAX_BYTES / (1024 * 1024)} MB)`,
      };
    }
    const durationMs = Math.max(0, Math.round(muNum(params.durationMs, 0)));
    const mood = muClean(params.mood, 40).toLowerCase() || null;
    const title = muClean(params.title, 200) || `Stem: ${stemName}`;

    ensureRouteArtifactsTable(db);

    const dtuId = `dtu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const artifactId = crypto.randomUUID();
    const fileName = `${stemName}-${dtuId}.${decoded.ext}`;

    const inline = decoded.buf.length <= 1024 * 1024;
    const contentB64 = inline ? decoded.buf.toString("base64") : null;
    let storagePath = null;
    if (!inline) {
      // Same DATA_DIR convention as art-textures; stem files live under
      // $DATA_DIR/lens-assets/music-stems/<stemName>/.
      const fs = require("node:fs");
      const path = require("node:path");
      const DATA_DIR = process.env.DATA_DIR
        || (fs.existsSync("/workspace/concord-data") ? "/workspace/concord-data" : path.join(process.cwd(), "data"));
      const dir = path.join(DATA_DIR, "lens-assets", "music-stems", stemName);
      try {
        fs.mkdirSync(dir, { recursive: true });
        storagePath = path.join(dir, fileName);
        fs.writeFileSync(storagePath, decoded.buf);
      } catch (err) {
        return { ok: false, error: `failed to write stem file: ${err?.message || err}` };
      }
    }

    const tagsArr = ["adaptive_music", `stem:${stemName}`, `creator:${userId}`];
    if (mood) tagsArr.push(`mood:${mood}`);

    try {
      db.prepare(`
        INSERT INTO route_artifacts (
          artifact_id, dtu_id, name, mime_type, size_bytes,
          storage_mode, content_b64, storage_path, created_by,
          description, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifactId, dtuId, fileName, decoded.mimeType, decoded.buf.length,
        inline ? "inline" : "disk",
        contentB64, storagePath, userId,
        `Adaptive-music stem: ${stemName}`,
        JSON.stringify(tagsArr),
      );

      db.prepare(`
        INSERT INTO dtus (
          id, owner_user_id, title, body_json, tags_json, visibility, tier
        ) VALUES (?, ?, ?, ?, ?, ?, 'regular')
      `).run(
        dtuId, userId, title,
        JSON.stringify({
          type: "adaptive_stem",
          stemName,
          mood,
          durationMs,
          artifactId,
          mimeType: decoded.mimeType,
        }),
        JSON.stringify(tagsArr),
        "public",
      );
    } catch (err) {
      // Roll back the file write so we don't leave orphans
      if (storagePath) {
        try { const fs = require("node:fs"); fs.unlinkSync(storagePath); } catch { /* idempotent */ }
      }
      return { ok: false, error: `failed to register stem: ${err?.message || err}` };
    }

    return {
      ok: true,
      result: {
        dtuId,
        artifactId,
        stemName,
        mood,
        durationMs,
        mimeType: decoded.mimeType,
        sizeBytes: decoded.buf.length,
        downloadUrl: `/api/artifacts/${artifactId}/download`,
      },
    };
  });

  // Discovery — list every adaptive-music stem currently published.
  // Frontend AdaptiveMusicBridge calls this on mount to populate stems.
  registerLensAction("music", "list-published-stems", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const wantStem = params.stemName
      ? String(params.stemName).toLowerCase()
      : null;
    if (wantStem && !ADAPTIVE_STEM_NAMES.has(wantStem)) {
      return { ok: false, error: `stemName must be one of: ${[...ADAPTIVE_STEM_NAMES].join(", ")}` };
    }
    const wantMood = params.mood
      ? `mood:${String(params.mood).toLowerCase()}`
      : null;

    const rows = db.prepare(`
      SELECT id, owner_user_id, title, body_json, tags_json, created_at
      FROM dtus
      WHERE tags_json LIKE '%adaptive_music%'
        AND visibility != 'private'
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

    const stems = [];
    for (const row of rows) {
      let tags = [];
      let body = {};
      try { tags = JSON.parse(row.tags_json || "[]"); } catch { continue; }
      try { body = JSON.parse(row.body_json || "{}"); } catch { continue; }
      if (!Array.isArray(tags) || !tags.includes("adaptive_music")) continue;
      if (body?.type !== "adaptive_stem") continue;
      const stemTag = tags.find((t) => typeof t === "string" && t.startsWith("stem:"));
      const stemName = stemTag ? stemTag.slice(5) : null;
      if (!stemName || !ADAPTIVE_STEM_NAMES.has(stemName)) continue;
      if (wantStem && stemName !== wantStem) continue;
      const moodTag = tags.find((t) => typeof t === "string" && t.startsWith("mood:"));
      if (wantMood && moodTag !== wantMood) continue;
      stems.push({
        dtuId: row.id,
        title: row.title,
        ownerUserId: row.owner_user_id,
        stemName,
        mood: moodTag ? moodTag.slice(5) : null,
        durationMs: typeof body?.durationMs === "number" ? body.durationMs : null,
        artifactId: body?.artifactId ?? null,
        mimeType: body?.mimeType ?? null,
        downloadUrl: body?.artifactId ? `/api/artifacts/${body.artifactId}/download` : null,
        createdAt: row.created_at,
      });
    }
    return { ok: true, result: { stems, count: stems.length } };
  });
}
