// server/domains/music-ai.js
//
// Music lens rebuild Sprint B — AI surface.
//
// RESEARCH GROUNDING (May 2026):
//   - Spotify's Audio Features API was deprecated November 2024.
//     The 13-field feature vector (energy/valence/danceability/etc) is
//     no longer accessible via the official API. The CONCEPTS remain
//     useful for content-based classification but Concord does NOT
//     claim Spotify parity — these axes are content-derived from
//     bpm/key/duration/genre metadata + optional LLM enhancement.
//   - Apple Music's 7 signals (2026): Shazam tag volume, library add
//     rate, replay completion rate, "discovered listeners" metric,
//     "Now Playing" auto-radio session length, geographic listening
//     pattern, Apple Music Classical's separate signals. Library adds
//     + "Love" hearts are weighted MUCH stronger than passive streams.
//   - SoundCloud's Musiio explicitly trains on SOUND not popularity —
//     direct precedent for Concord's depth-over-engagement positioning.
//     SoundCloud's "Liked By" playlists drive 3x engagement (social-
//     graph signal). First Fans algorithm rewards scene participation
//     (reposts / comments / collaboration) over algorithmic discovery.
//   - Academic SOTA (2024-2025): hybrid (content + behavioral +
//     social) with GNN edge. Concord's hybrid deterministic + LLM +
//     behavioral signal mix is on-trend; future sprint can add the
//     GNN social-graph layer.
//
// CONCORD'S MOAT: no ad business → can structurally favor depth over
// engagement without conflict of interest. Apple Music has the same
// freedom (Apple's revenue model isn't ad-driven) and explicitly
// weights library-adds over passive streams; Concord matches.

import { randomUUID } from "node:crypto";
import { getTrack, listTracks } from "../lib/music/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const TIMEOUT_MS = 12_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) { const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/); return m ? m[1] : s; }
function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// ─── Deterministic classification ─────────────────────────
//
// Derive coarse mood/energy/depth signals from track metadata (bpm,
// key, duration, genres) when no audio analysis is available. The
// LLM path enhances + adds nuanced tags from lyrics/description.

export function classifyDeterministic(track) {
  if (!track) return null;
  const bpm = Number(track.bpm) || 0;
  const durationMs = Number(track.duration_ms) || 0;
  const isMinor = String(track.key_signature || "").toLowerCase().includes("minor");
  const isMajor = String(track.key_signature || "").toLowerCase().includes("major");
  const genres = Array.isArray(track.genres) ? track.genres.map((g) => String(g).toLowerCase()) : [];
  const hasGenre = (...needles) => genres.some((g) => needles.some((n) => g.includes(n)));

  // Energy: BPM-driven (60-180 maps to 0-1 with peak around 130)
  let energy = 0.5;
  if (bpm > 0) {
    if (bpm < 70) energy = 0.15;
    else if (bpm < 95) energy = 0.35;
    else if (bpm < 115) energy = 0.55;
    else if (bpm < 135) energy = 0.75;
    else if (bpm < 165) energy = 0.85;
    else energy = 0.95;
  }
  if (hasGenre("ambient", "drone", "downtempo", "lullaby")) energy = Math.min(energy, 0.3);
  if (hasGenre("metal", "punk", "hardcore", "edm", "techno", "trance")) energy = Math.max(energy, 0.7);

  // Valence: major = positive lean, minor = negative lean, genre overrides
  let valence = isMinor ? 0.35 : isMajor ? 0.7 : 0.5;
  if (hasGenre("blues", "doom", "funeral", "dirge")) valence = Math.min(valence, 0.25);
  if (hasGenre("disco", "pop", "happy", "summer", "tropical")) valence = Math.max(valence, 0.75);

  // Danceability: BPM 95-135 + electronic/funk/dance genres
  let danceability = 0.4;
  if (bpm >= 95 && bpm <= 140) danceability = 0.7;
  if (hasGenre("dance", "house", "disco", "funk", "afro", "latin")) danceability = Math.max(danceability, 0.85);
  if (hasGenre("ambient", "classical", "shoegaze")) danceability = Math.min(danceability, 0.25);

  // Acousticness: opposite of electronic/synth/produced
  let acousticness = 0.5;
  if (hasGenre("acoustic", "folk", "classical", "singer-songwriter", "unplugged")) acousticness = 0.85;
  if (hasGenre("electronic", "edm", "synth", "techno", "trance", "dubstep", "trap")) acousticness = 0.15;

  // Instrumentalness: classical/jazz instrumental / post-rock / lo-fi
  let instrumentalness = 0.3;
  if (hasGenre("instrumental", "post-rock", "math-rock", "jazz fusion", "lo-fi")) instrumentalness = 0.85;
  if (hasGenre("classical")) instrumentalness = 0.95;

  // Era: best guess from genre tags (rough)
  let era = null;
  if (hasGenre("vaporwave", "future-funk", "trap")) era = "2010s";
  if (hasGenre("hyperpop", "drill")) era = "2020s";
  if (hasGenre("grunge", "alt-rock")) era = "90s";
  if (hasGenre("synth-pop", "new-wave")) era = "80s";
  if (hasGenre("disco")) era = "70s";

  // DEPTH — inverse-X load-bearing axis. Higher = more artistic
  // substance. Tracks with rich harmony (minor + complex genres),
  // longer duration (>4 min favored), instrumental complexity score
  // higher.
  let depth = 0.5;
  if (durationMs > 240_000) depth += 0.15;          // long-form bias
  if (durationMs > 360_000) depth += 0.1;
  if (durationMs < 90_000) depth -= 0.2;            // sub-90s likely a hook loop
  if (hasGenre("classical", "jazz", "prog", "post-rock", "experimental", "ambient", "folk", "drone")) depth += 0.2;
  if (hasGenre("hyperpop", "trap pop")) depth -= 0.15;
  if (instrumentalness > 0.7) depth += 0.05;
  depth = Math.max(0, Math.min(1, depth));

  // Hook density — negative signal for inverse-X. Short tracks +
  // pop/trap-pop = high hook density (manufactured engagement).
  let hookDensity = 0.5;
  if (durationMs < 180_000) hookDensity += 0.2;
  if (durationMs < 120_000) hookDensity += 0.15;
  if (hasGenre("pop", "trap", "hyperpop", "drill")) hookDensity += 0.15;
  if (hasGenre("classical", "ambient", "drone", "post-rock")) hookDensity -= 0.3;
  hookDensity = Math.max(0, Math.min(1, hookDensity));

  // Inferred genre scores: just echo the input genres as 0.8 each
  const genresOut = {};
  for (const g of (Array.isArray(track.genres) ? track.genres : []).slice(0, 5)) {
    genresOut[g] = 0.85;
  }

  return {
    genres: genresOut,
    energy: Math.round(energy * 100) / 100,
    valence: Math.round(valence * 100) / 100,
    danceability: Math.round(danceability * 100) / 100,
    acousticness: Math.round(acousticness * 100) / 100,
    instrumentalness: Math.round(instrumentalness * 100) / 100,
    live_recording: 0,
    speechiness: hasGenre("rap", "spoken-word", "audiobook") ? 0.8 : 0.1,
    era,
    depth: Math.round(depth * 100) / 100,
    hook_density: Math.round(hookDensity * 100) / 100,
  };
}

// ─── Inverse-X scorer ─────────────────────────────────────
//
// Hybrid scorer mirroring SoundCloud's Musiio (sound-not-popularity)
// + Apple Music's library-add-over-passive-stream weighting. Higher
// score = recommend more.
//
// Content axes (from classification):
//   depth                 +1.6    long-form, harmonically complex
//   acousticness          +0.4    away-from-electronic-bait bias
//   instrumentalness      +0.5
//   hook_density          -1.4    short-loop manufactured-pop tank
//
// Behavioral axes (Apple-Music-aligned weighting):
//   library_add_ratio     +1.8    INTENT signal — adds-to-library
//                                  treated as stronger than passive
//                                  streams (per Apple Music 2026
//                                  algorithm). This is the load-
//                                  bearing "discovered listeners"
//                                  signal.
//   avg_listen_pct        +1.2    replay completion (Apple)
//   skip_ratio            -1.8
//   session_seed_quality  +0.6    tracks that often start long
//                                  listening sessions (>=3 plays in
//                                  same hour-context bucket)
//
// Social-graph axes (SoundCloud "Liked By" precedent):
//   independence          +0.8    small-artist boost (SoundCloud's
//                                  explicit positioning for emerging
//                                  artists). Concord matches.
//
// Recency:
//   freshness             +0.3    gentle tilt

export const INVERSE_X_MUSIC_WEIGHTS = {
  depth:                  1.6,
  acousticness:           0.4,
  instrumentalness:       0.5,
  hook_density:          -1.4,
  // Behavioral
  library_add_ratio:      1.8,
  avg_listen_pct:         1.2,
  skip_ratio:            -1.8,
  session_seed_quality:   0.6,
  // Social-graph + creator
  independence:           0.8,
  freshness:              0.3,
};

export function scoreTrack(track, classification, opts = {}) {
  const w = opts.weights || INVERSE_X_MUSIC_WEIGHTS;
  const breakdown = {};
  let score = 0;
  const reasons = [];

  for (const axis of ["depth", "acousticness", "instrumentalness", "hook_density"]) {
    const v = Number(classification?.[axis]) || 0;
    const ww = w[axis] || 0;
    if (!ww) { breakdown[axis] = 0; continue; }
    const contrib = ww * v;
    breakdown[axis] = Math.round(contrib * 100) / 100;
    score += contrib;
    if (Math.abs(contrib) >= 0.4) {
      reasons.push(contrib > 0
        ? `boosted because ${axis}=${v.toFixed(2)} (weight +${ww})`
        : `tanked because ${axis}=${v.toFixed(2)} (weight ${ww})`);
    }
  }

  // Behavioral (Apple Music alignment: library_add intent > passive stream)
  const avgPct = Number(track.avg_listen_pct) || 0;
  const listenCount = Number(track.listen_count) || 0;
  const skipCount = Number(track.skip_count) || 0;
  const likeCount = Number(track.like_count) || 0;  // library-add proxy
  const skipRatio = (listenCount + skipCount) > 0 ? skipCount / (listenCount + skipCount) : 0;
  // library_add_ratio = likes / total listens. Apple Music's stated
  // signal: an intentional library add is multiple times stronger than
  // a passive stream. Likes are Concord's closest analog today; future
  // sprint could add explicit "save to library" distinct from "like".
  const libraryAddRatio = listenCount > 0 ? Math.min(1, likeCount / listenCount) : 0;
  const libraryContrib = w.library_add_ratio * libraryAddRatio;
  const avgContrib = w.avg_listen_pct * avgPct;
  const skipContrib = w.skip_ratio * skipRatio;
  // Session seed quality: tracks that are often a session starter (the
  // first track in a listening burst) score higher. Approximated via
  // opts.sessionSeedScore if caller passes one (computed elsewhere from
  // music_listens.started_at clustering); otherwise neutral 0.5.
  const sessionSeed = Number(opts.sessionSeedScore) || 0.5;
  const sessionContrib = w.session_seed_quality * sessionSeed;

  breakdown.library_add_ratio = Math.round(libraryContrib * 100) / 100;
  breakdown.avg_listen_pct = Math.round(avgContrib * 100) / 100;
  breakdown.skip_ratio = Math.round(skipContrib * 100) / 100;
  breakdown.session_seed_quality = Math.round(sessionContrib * 100) / 100;
  score += libraryContrib + avgContrib + skipContrib + sessionContrib;

  if (libraryContrib >= 0.4) reasons.push(`boosted because library_add_ratio=${libraryAddRatio.toFixed(2)} (Apple-Music-style intent signal)`);
  if (avgContrib >= 0.4) reasons.push(`boosted because avg_listen_pct=${avgPct.toFixed(2)} (deep listens / replay completion)`);
  if (skipContrib <= -0.4) reasons.push(`tanked because skip_ratio=${skipRatio.toFixed(2)}`);
  if (sessionContrib >= 0.3) reasons.push(`boosted because session_seed_quality=${sessionSeed.toFixed(2)} (often starts long sessions)`);

  // Independence: small artists (< 1000 followers) get a boost. Big
  // artists (> 100k) get neutral. This is the anti-algorithmic-monopoly
  // axis — concord deliberately surfaces independents.
  const followers = Number(opts.artistFollowerCount) || 0;
  let independence = 0.5;
  if (followers < 100) independence = 0.9;
  else if (followers < 1000) independence = 0.75;
  else if (followers < 10000) independence = 0.55;
  else if (followers < 100000) independence = 0.4;
  else independence = 0.2;
  const indContrib = w.independence * independence;
  breakdown.independence = Math.round(indContrib * 100) / 100;
  score += indContrib;
  if (indContrib >= 0.4) reasons.push(`boosted because independence=${independence.toFixed(2)} (small artist)`);

  // Freshness — gentle recency tilt (full strength within last 30d → 0 after 1y)
  const now = Math.floor(Date.now() / 1000);
  const ageDays = ((now - (track.published_at || track.created_at || now)) / 86400);
  const freshness = ageDays < 30 ? 1 : ageDays < 365 ? Math.max(0.2, 1 - ageDays / 365) : 0.1;
  const freshContrib = w.freshness * freshness;
  breakdown.freshness = Math.round(freshContrib * 100) / 100;
  score += freshContrib;

  return {
    score: Math.round(score * 100) / 100,
    breakdown,
    reasons,
    independence,
    skipRatio: Math.round(skipRatio * 100) / 100,
    freshness: Math.round(freshness * 100) / 100,
  };
}

function _saveClassification(db, trackId, cls, { source = "deterministic", reasoning = null, version = "v1" } = {}) {
  if (!db || !trackId) return;
  try {
    db.prepare(`
      INSERT INTO music_track_classifications (
        track_id, classifier_version, genres_json, energy, valence,
        danceability, acousticness, instrumentalness, live_recording,
        speechiness, era, depth, hook_density, source, reasoning, classified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        classifier_version = excluded.classifier_version,
        genres_json = excluded.genres_json,
        energy = excluded.energy, valence = excluded.valence,
        danceability = excluded.danceability, acousticness = excluded.acousticness,
        instrumentalness = excluded.instrumentalness, live_recording = excluded.live_recording,
        speechiness = excluded.speechiness, era = excluded.era,
        depth = excluded.depth, hook_density = excluded.hook_density,
        source = excluded.source, reasoning = excluded.reasoning,
        classified_at = excluded.classified_at
    `).run(trackId, version,
      JSON.stringify(cls.genres || {}),
      cls.energy ?? 0.5, cls.valence ?? 0.5, cls.danceability ?? 0.5,
      cls.acousticness ?? 0.5, cls.instrumentalness ?? 0.5,
      cls.live_recording ?? 0, cls.speechiness ?? 0,
      cls.era || null, cls.depth ?? 0.5, cls.hook_density ?? 0.5,
      source, reasoning ? String(reasoning).slice(0, 600) : null,
      _now());
  } catch { /* best effort */ }
}

function _getClassification(db, trackId) {
  const r = db.prepare(`SELECT * FROM music_track_classifications WHERE track_id = ?`).get(trackId);
  if (!r) return null;
  return { ...r, genres: _safeJson(r.genres_json, {}) };
}

function _recordAiRun(db, { userId, trackId, kind, inputText, outputText, source = "fallback", tokens = 0, latencyMs = null }) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO music_ai_runs (user_id, track_id, kind, input_text, output_text, source, tokens, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, trackId || null, kind,
      inputText ? String(inputText).slice(0, 2000) : null,
      String(outputText || "").slice(0, 4000),
      source, tokens || 0, latencyMs, _now());
  } catch { /* best effort */ }
}

export default function registerMusicAiMacros(register) {

  // ─── Classification ────────────────────────────────────

  register("music", "classify_track", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const trackId = String(input.trackId || input.id || "");
    if (!trackId) return { ok: false, reason: "trackId_required" };
    const track = getTrack(db, trackId);
    if (!track) return { ok: false, reason: "track_not_found" };
    const t0 = Date.now();

    const baseline = classifyDeterministic(track);
    if (!ctx?.llm?.chat) {
      _saveClassification(db, trackId, baseline, { source: "deterministic" });
      _recordAiRun(db, { userId: _actor(ctx), trackId, kind: "classify", inputText: track.title, outputText: JSON.stringify(baseline), source: "deterministic", latencyMs: Date.now() - t0 });
      return { ok: true, classification: baseline, source: "deterministic" };
    }

    const sys = `You are a music classifier. Given track metadata, output JSON with these keys:
{
  "genres": {"<genre>": confidence_0_to_1, ...},
  "energy": 0-1,
  "valence": 0-1 (happy↔sad),
  "danceability": 0-1,
  "acousticness": 0-1,
  "instrumentalness": 0-1,
  "live_recording": 0-1,
  "speechiness": 0-1,
  "era": "60s"|"70s"|"80s"|"90s"|"2000s"|"2010s"|"2020s"|null,
  "depth": 0-1 (artistic substance / complexity),
  "hook_density": 0-1 (manufactured-pop signal — short hooks repeated),
  "reasoning": "one sentence"
}
Output ONLY JSON.`;
    const userMsg = `Title: ${track.title}\nDuration: ${Math.round(track.duration_ms / 1000)}s\nBPM: ${track.bpm || "unknown"}\nKey: ${track.key_signature || "unknown"}\nGenres: ${(track.genres || []).join(", ") || "unknown"}\nLyrics excerpt: ${(track.lyrics || "").slice(0, 800)}`;
    try {
      const r = await _withTimeout(ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.2, maxTokens: 500, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      if (!parsed) {
        _saveClassification(db, trackId, baseline, { source: "deterministic" });
        return { ok: true, classification: baseline, source: "deterministic", reason: "parse_failed" };
      }
      // Take LLM values for positive axes, MAX for negative axes (conservative)
      const merged = { ...baseline };
      for (const k of ["energy", "valence", "danceability", "acousticness", "instrumentalness", "live_recording", "speechiness", "depth"]) {
        if (parsed[k] != null) merged[k] = Math.max(0, Math.min(1, Number(parsed[k])));
      }
      if (parsed.hook_density != null) {
        merged.hook_density = Math.max(merged.hook_density, Number(parsed.hook_density) || 0);
      }
      if (parsed.era) merged.era = parsed.era;
      if (parsed.genres && typeof parsed.genres === "object") merged.genres = parsed.genres;
      _saveClassification(db, trackId, merged, { source: "llm", reasoning: parsed.reasoning });
      _recordAiRun(db, { userId: _actor(ctx), trackId, kind: "classify", inputText: userMsg, outputText: JSON.stringify(merged), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, classification: merged, reasoning: parsed.reasoning, source: "llm" };
    } catch (err) {
      _saveClassification(db, trackId, baseline, { source: "deterministic" });
      return { ok: true, classification: baseline, source: "deterministic", reason: "llm_error", error: err?.message };
    }
  }, { destructive: true, note: "Classify a track on 11 axes (LLM with deterministic fallback). Negative axes (hook_density) take MAX of baseline+LLM for safety." });

  register("music", "classification_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const c = _getClassification(db, String(input.trackId || input.id || ""));
    return { ok: true, classification: c };
  }, { note: "Get a track's stored classification" });

  // ─── Recommendations ───────────────────────────────────

  register("music", "recommend", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 25), 100);
    const seedKind = ["inverse_x_default","similar_to_liked","mood_match","genre_explore","depth_dive","rediscover"].includes(input.seedKind) ? input.seedKind : "inverse_x_default";

    // Candidate set: public/published tracks the user hasn't listened to recently
    const candidates = db.prepare(`
      SELECT t.*, a.follower_count AS artist_followers
      FROM music_tracks t
      INNER JOIN music_artists a ON a.id = t.artist_id
      WHERE t.deleted_at IS NULL AND t.visibility IN ('public','published','global')
      ORDER BY t.published_at DESC
      LIMIT 500
    `).all();

    if (candidates.length === 0) {
      return { ok: true, recommendations: [], reason: "no_candidates" };
    }

    // Hydrate classifications + score
    const ids = candidates.map((c) => c.id);
    const ph = ids.map(() => "?").join(", ");
    const clsRows = db.prepare(`SELECT * FROM music_track_classifications WHERE track_id IN (${ph})`).all(...ids);
    const clsMap = new Map(clsRows.map((r) => [r.track_id, { ...r, genres: _safeJson(r.genres_json, {}) }]));

    const ranked = candidates.map((t) => {
      const cls = clsMap.get(t.id) || classifyDeterministic({ ...t, genres: _safeJson(t.genres_json, []) });
      const scored = scoreTrack(t, cls, { artistFollowerCount: t.artist_followers });
      return { track: t, classification: cls, ...scored };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    // Persist (best-effort)
    const ins = db.prepare(`INSERT INTO music_recommendations (user_id, track_id, seed_kind, score, generated_at) VALUES (?, ?, ?, ?, ?)`);
    const auditIns = db.prepare(`INSERT INTO music_recommendation_audit (user_id, track_id, score, breakdown_json, reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction(() => {
      for (const r of ranked) {
        ins.run(userId, r.track.id, seedKind, r.score, _now());
        auditIns.run(userId, r.track.id, r.score, JSON.stringify(r.breakdown), JSON.stringify(r.reasons), _now());
      }
    });
    tx();
    _recordAiRun(db, { userId, kind: "recommend", inputText: seedKind, outputText: `${ranked.length} recs`, source: "deterministic" });

    return {
      ok: true,
      seedKind,
      recommendations: ranked.map((r) => ({
        trackId: r.track.id,
        title: r.track.title,
        artistId: r.track.artist_id,
        score: r.score,
        breakdown: r.breakdown,
        reasons: r.reasons,
      })),
      count: ranked.length,
    };
  }, { destructive: true, note: "Generate recommendations using the inverse-X music scorer. Boost depth + avg_listen_pct + independence; tank hook_density + skip_ratio. Persists to music_recommendations + audit." });

  register("music", "recommendation_explain", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const trackId = String(input.trackId || "");
    if (!trackId) return { ok: false, reason: "trackId_required" };
    const track = getTrack(db, trackId);
    if (!track) return { ok: false, reason: "track_not_found" };
    const artist = db.prepare(`SELECT follower_count FROM music_artists WHERE id = ?`).get(track.artist_id);
    const cls = _getClassification(db, trackId) || classifyDeterministic(track);
    const scored = scoreTrack(track, cls, { artistFollowerCount: artist?.follower_count || 0 });
    return {
      ok: true,
      trackId,
      title: track.title,
      classification: cls,
      score: scored.score,
      breakdown: scored.breakdown,
      reasons: scored.reasons,
      independence: scored.independence,
      skipRatio: scored.skipRatio,
    };
  }, { note: "Why am I hearing this? Returns full classification + per-axis breakdown + human-readable reasons for one track." });

  register("music", "recommendations_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 200);
    const rows = db.prepare(`SELECT id, track_id, seed_kind, score, generated_at, surfaced_at, acted_on, acted_at FROM music_recommendations WHERE user_id = ? ORDER BY generated_at DESC LIMIT ?`).all(userId, limit);
    return { ok: true, recommendations: rows };
  }, { note: "List recent generated recommendations" });

  register("music", "recommendation_ack", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = Number(input.id);
    const action = ["listened","liked","skipped","saved","dismissed"].includes(input.action) ? input.action : null;
    if (!id || !action) return { ok: false, reason: "id_and_action_required" };
    const r = db.prepare(`UPDATE music_recommendations SET acted_on = ?, acted_at = ?, surfaced_at = COALESCE(surfaced_at, ?) WHERE id = ? AND user_id = ?`).run(action, _now(), _now(), id, userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Record action taken on a surfaced recommendation (listened/liked/skipped/saved/dismissed)" });

  register("music", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, runs: db.prepare(`SELECT * FROM music_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(userId) };
  }, { note: "Recent music AI invocations (provenance trail)" });
}
