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
    const playlists = (s.playlists.get(userId) || []).map((p) => ({
      ...p,
      trackCount: p.trackIds.length,
      durationSec: p.trackIds.reduce((a, id) => a + (tracks.get(id)?.durationSec || 0), 0),
    }));
    return { ok: true, result: { playlists, count: playlists.length } };
  });

  registerLensAction("music", "playlist-add-track", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const pl = (s.playlists.get(userId) || []).find((p) => p.id === params.playlistId);
    if (!pl) return { ok: false, error: "playlist not found" };
    if (!findTrack(s, userId, params.trackId)) return { ok: false, error: "track not found" };
    if (params.remove === true) pl.trackIds = pl.trackIds.filter((x) => x !== params.trackId);
    else if (!pl.trackIds.includes(params.trackId)) pl.trackIds.push(String(params.trackId));
    saveMusicState();
    return { ok: true, result: { playlistId: pl.id, trackCount: pl.trackIds.length } };
  });

  registerLensAction("music", "playlist-detail", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = muAid(ctx);
    const pl = (s.playlists.get(userId) || []).find((p) => p.id === params.id);
    if (!pl) return { ok: false, error: "playlist not found" };
    const tracks = pl.trackIds.map((id) => findTrack(s, userId, id)).filter(Boolean);
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
  });

  registerLensAction("music", "wrapped", (ctx, _a, params = {}) => {
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
  });

  // ── Lyrics (Spotify/Apple Music timed-lyrics parity) ────────────────
  registerLensAction("music", "track-lyrics-set", (ctx, _a, params = {}) => {
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
  });

  registerLensAction("music", "track-lyrics-get", (ctx, _a, params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = findTrack(s, muAid(ctx), params.id);
    if (!track) return { ok: false, error: "track not found" };
    return { ok: true, result: { id: track.id, title: track.title, lyrics: track.lyrics || [], synced: !!track.lyricsSynced } };
  });

  // ── Radio / autoplay station (seed → continuous queue) ──────────────
  registerLensAction("music", "radio-start", (ctx, _a, params = {}) => {
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
  });

  registerLensAction("music", "radio-status", (ctx, _a, _params = {}) => {
    const s = getMusicState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { station: s.radio.get(muAid(ctx)) || null } };
  });

  // ── Smart Shuffle / AI DJ — weighted favorites + discovery mix ──────
  registerLensAction("music", "smart-shuffle", (ctx, _a, params = {}) => {
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
  });

  // ── Recommendations (seed-based or taste-profile) ───────────────────
  registerLensAction("music", "recommend", (ctx, _a, params = {}) => {
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
}
