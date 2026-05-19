// server/tests/music-rebuild-sprint-b.test.js
//
// Tier-2 contract tests for music Sprint B (AI surface).
// Research-grounded: tests verify the Apple-Music-aligned library-
// add weighting + SoundCloud-Musiio-aligned independence boost.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMusicRebuildMacros from "../domains/music-rebuild.js";
import registerMusicAiMacros, { classifyDeterministic, scoreTrack, INVERSE_X_MUSIC_WEIGHTS } from "../domains/music-ai.js";
import {
  createArtist, createTrack, likeTrack, recordListen,
} from "../lib/music/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["237_music_rebuild", "238_music_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerMusicRebuildMacros(register);
  registerMusicAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, llm = null) { return { db, actor: { userId }, llm }; }

// ─── Deterministic classifier ───────────────────────────

describe("classifyDeterministic", () => {
  it("low BPM + minor key + ambient genre → low energy + low valence", () => {
    const c = classifyDeterministic({ bpm: 60, key_signature: "A minor", duration_ms: 480_000, genres: ["ambient", "drone"] });
    assert.ok(c.energy <= 0.3);
    assert.ok(c.valence <= 0.4);
    assert.ok(c.depth >= 0.7, `expected depth>=0.7 (long+ambient), got ${c.depth}`);
  });

  it("short trap pop track → high hook_density + low depth", () => {
    const c = classifyDeterministic({ bpm: 140, key_signature: "F major", duration_ms: 100_000, genres: ["trap pop", "hyperpop"] });
    assert.ok(c.hook_density >= 0.7, `expected hook_density>=0.7, got ${c.hook_density}`);
    assert.ok(c.depth <= 0.35, `expected depth<=0.35, got ${c.depth}`);
  });

  it("long classical instrumental → very high depth, low hook_density", () => {
    const c = classifyDeterministic({ bpm: 80, key_signature: "D minor", duration_ms: 480_000, genres: ["classical"] });
    assert.ok(c.depth >= 0.7);
    assert.ok(c.hook_density <= 0.3);
    assert.ok(c.instrumentalness >= 0.85);
  });

  it("electronic dance track → high danceability + low acousticness", () => {
    const c = classifyDeterministic({ bpm: 128, genres: ["house", "edm"] });
    assert.ok(c.danceability >= 0.7);
    assert.ok(c.acousticness <= 0.2);
  });

  it("era inference from genre", () => {
    assert.equal(classifyDeterministic({ genres: ["grunge", "alt-rock"] }).era, "90s");
    assert.equal(classifyDeterministic({ genres: ["synth-pop"] }).era, "80s");
    assert.equal(classifyDeterministic({ genres: ["disco"] }).era, "70s");
  });
});

// ─── Inverse-X scorer ─────────────────────────────────

describe("INVERSE_X scoreTrack (research-grounded)", () => {
  it("Apple-Music-style library_add_ratio boosts MUCH stronger than passive listens", () => {
    const now = Math.floor(Date.now() / 1000);
    // Track A: 100 listens, 80 likes (library_add_ratio = 0.8)
    // Track B: 100 listens, 5 likes (library_add_ratio = 0.05)
    const trackA = { listen_count: 100, like_count: 80, skip_count: 5, avg_listen_pct: 0.8, published_at: now, duration_ms: 240_000 };
    const trackB = { listen_count: 100, like_count: 5, skip_count: 5, avg_listen_pct: 0.8, published_at: now, duration_ms: 240_000 };
    const cls = { depth: 0.5, hook_density: 0.5, acousticness: 0.5, instrumentalness: 0.5 };
    const a = scoreTrack(trackA, cls, { artistFollowerCount: 500 });
    const b = scoreTrack(trackB, cls, { artistFollowerCount: 500 });
    assert.ok(a.score > b.score, `library_add bonus should outweigh: A=${a.score} vs B=${b.score}`);
    assert.ok(a.breakdown.library_add_ratio > b.breakdown.library_add_ratio);
    assert.ok(a.reasons.some((r) => r.includes("library_add_ratio")));
  });

  it("SoundCloud-style independence boost — small artist scores higher than mega-artist (all else equal)", () => {
    const now = Math.floor(Date.now() / 1000);
    const track = { listen_count: 50, like_count: 5, skip_count: 5, avg_listen_pct: 0.6, published_at: now, duration_ms: 240_000 };
    const cls = { depth: 0.5, hook_density: 0.5, acousticness: 0.5, instrumentalness: 0.5 };
    const small = scoreTrack(track, cls, { artistFollowerCount: 50 });    // independence = 0.9
    const huge = scoreTrack(track, cls, { artistFollowerCount: 500_000 }); // independence = 0.2
    assert.ok(small.score > huge.score, `small artist should rank higher: small=${small.score} huge=${huge.score}`);
    assert.equal(small.independence, 0.9);
    assert.equal(huge.independence, 0.2);
  });

  it("depth boosts vs hook_density tanks (inverse-X core)", () => {
    const now = Math.floor(Date.now() / 1000);
    const t = { listen_count: 100, like_count: 10, skip_count: 10, avg_listen_pct: 0.5, published_at: now, duration_ms: 240_000 };
    const deepCls = { depth: 0.9, hook_density: 0.2, acousticness: 0.5, instrumentalness: 0.5 };
    const popCls = { depth: 0.2, hook_density: 0.9, acousticness: 0.5, instrumentalness: 0.5 };
    const deep = scoreTrack(t, deepCls, { artistFollowerCount: 1000 });
    const pop = scoreTrack(t, popCls, { artistFollowerCount: 1000 });
    assert.ok(deep.score > pop.score, `deep should beat pop: ${deep.score} vs ${pop.score}`);
    assert.ok(deep.reasons.some((r) => r.includes("depth")));
    assert.ok(pop.reasons.some((r) => r.includes("hook_density") && r.includes("tanked")));
  });

  it("high skip_ratio is tanked", () => {
    const now = Math.floor(Date.now() / 1000);
    const lots = { listen_count: 10, like_count: 5, skip_count: 90, avg_listen_pct: 0.3, published_at: now, duration_ms: 240_000 };
    const few = { listen_count: 100, like_count: 5, skip_count: 5, avg_listen_pct: 0.6, published_at: now, duration_ms: 240_000 };
    const cls = { depth: 0.5, hook_density: 0.5, acousticness: 0.5, instrumentalness: 0.5 };
    const lotsScored = scoreTrack(lots, cls, { artistFollowerCount: 100 });
    const fewScored = scoreTrack(few, cls, { artistFollowerCount: 100 });
    assert.ok(fewScored.score > lotsScored.score);
    assert.ok(lotsScored.skipRatio > 0.7);
  });

  it("session_seed_quality bonus when caller passes high score", () => {
    const now = Math.floor(Date.now() / 1000);
    const t = { listen_count: 50, like_count: 10, skip_count: 5, avg_listen_pct: 0.7, published_at: now, duration_ms: 240_000 };
    const cls = { depth: 0.6, hook_density: 0.3, acousticness: 0.5, instrumentalness: 0.5 };
    const seed = scoreTrack(t, cls, { artistFollowerCount: 500, sessionSeedScore: 0.9 });
    const nonseed = scoreTrack(t, cls, { artistFollowerCount: 500, sessionSeedScore: 0.1 });
    assert.ok(seed.score > nonseed.score);
    assert.ok(seed.breakdown.session_seed_quality > nonseed.breakdown.session_seed_quality);
  });

  it("INVERSE_X_MUSIC_WEIGHTS shape — every key has a number", () => {
    for (const [k, v] of Object.entries(INVERSE_X_MUSIC_WEIGHTS)) {
      assert.ok(typeof v === "number", `${k} should be number, got ${typeof v}`);
    }
    // Library add must be POSITIVE and STRONGER than passive listen
    assert.ok(INVERSE_X_MUSIC_WEIGHTS.library_add_ratio > INVERSE_X_MUSIC_WEIGHTS.avg_listen_pct,
      "library_add weight should be > avg_listen_pct (Apple-Music alignment)");
    // Hook density must be NEGATIVE
    assert.ok(INVERSE_X_MUSIC_WEIGHTS.hook_density < 0);
    // Independence positive (SoundCloud alignment)
    assert.ok(INVERSE_X_MUSIC_WEIGHTS.independence > 0);
  });
});

// ─── classify_track macro ────────────────────────────

describe("classify_track macro", () => {
  it("falls back to deterministic when no LLM available + persists", async () => {
    const a = createArtist(db, { ownerUserId: "u_cls", name: "ClsArt" });
    const t = createTrack(db, { artistId: a.id, title: "Test", bpm: 60, durationMs: 480_000, genres: ["ambient"], keySignature: "A minor" });
    const r = await MACROS.get("classify_track")(ctx("u_cls"), { trackId: t.id });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic");
    assert.ok(r.classification.depth >= 0.7);
    const stored = await MACROS.get("classification_get")(ctx("u_cls"), { trackId: t.id });
    assert.ok(stored.classification != null);
    assert.equal(stored.classification.source, "deterministic");
  });

  it("LLM path merges baseline + LLM (negative axes take MAX for safety)", async () => {
    const a = createArtist(db, { ownerUserId: "u_llm", name: "LLMArt" });
    const t = createTrack(db, { artistId: a.id, title: "Hook", bpm: 140, durationMs: 90_000, genres: ["trap"] });
    // Deterministic will give high hook_density. LLM says low. Should take MAX → keep high.
    const llm = { chat: async () => ({ content: '{"energy":0.9,"valence":0.7,"depth":0.4,"hook_density":0.2,"reasoning":"high energy"}' }) };
    const r = await MACROS.get("classify_track")({ db, actor: { userId: "u_llm" }, llm }, { trackId: t.id });
    assert.equal(r.source, "llm");
    assert.ok(r.classification.hook_density >= 0.7, `hook_density should be max(baseline, llm); got ${r.classification.hook_density}`);
  });
});

// ─── recommend macro ────────────────────────────────

describe("recommend macro (inverse-X end-to-end)", () => {
  it("ranks depth+independence higher than hook-density+mega-artist (all else equal)", async () => {
    // Indie deep
    const indieA = createArtist(db, { ownerUserId: "u_indie_owner", name: "IndieArt" });
    const indieT = createTrack(db, { artistId: indieA.id, title: "Long Form", bpm: 70, durationMs: 480_000, genres: ["ambient","classical"], visibility: "public" });
    // Mega pop
    const megaA = createArtist(db, { ownerUserId: "u_mega_owner", name: "MegaArt" });
    db.prepare(`UPDATE music_artists SET follower_count = 500000 WHERE id = ?`).run(megaA.id);
    const megaT = createTrack(db, { artistId: megaA.id, title: "Hit Single", bpm: 140, durationMs: 90_000, genres: ["trap pop","hyperpop"], visibility: "public" });

    // Classify both
    await MACROS.get("classify_track")(ctx("u_listener"), { trackId: indieT.id });
    await MACROS.get("classify_track")(ctx("u_listener"), { trackId: megaT.id });

    const r = await MACROS.get("recommend")(ctx("u_listener"), { limit: 50 });
    assert.equal(r.ok, true);
    const indiePos = r.recommendations.findIndex((x) => x.trackId === indieT.id);
    const megaPos = r.recommendations.findIndex((x) => x.trackId === megaT.id);
    assert.ok(indiePos >= 0 && megaPos >= 0, "both should be in results");
    assert.ok(indiePos < megaPos, `indie should rank above mega: indie=${indiePos} mega=${megaPos}`);
  });

  it("persists to music_recommendations + audit tables", async () => {
    await MACROS.get("recommend")(ctx("u_persist"));
    const rec = db.prepare(`SELECT COUNT(*) AS n FROM music_recommendations WHERE user_id = 'u_persist'`).get();
    const aud = db.prepare(`SELECT COUNT(*) AS n FROM music_recommendation_audit WHERE user_id = 'u_persist'`).get();
    assert.ok(rec.n >= 1);
    assert.equal(rec.n, aud.n);
  });
});

// ─── recommendation_explain (transparency) ──────────

describe("recommendation_explain (why am I hearing this?)", () => {
  it("returns full classification + score + breakdown + reasons for a track", async () => {
    const a = createArtist(db, { ownerUserId: "u_exp", name: "ExpArt" });
    const t = createTrack(db, { artistId: a.id, title: "Explained", bpm: 80, durationMs: 360_000, genres: ["folk"], visibility: "public" });
    await MACROS.get("classify_track")(ctx("u_exp_user"), { trackId: t.id });
    const r = await MACROS.get("recommendation_explain")(ctx("u_exp_user"), { trackId: t.id });
    assert.equal(r.ok, true);
    assert.ok(typeof r.score === "number");
    assert.ok(r.classification);
    assert.ok(typeof r.breakdown === "object");
    assert.ok(Array.isArray(r.reasons));
  });
});

// ─── recommendation_ack (engagement loop) ───────────

describe("recommendation_ack", () => {
  it("records action on a rec + sets surfaced_at if null", async () => {
    const a = createArtist(db, { ownerUserId: "u_ack_owner", name: "AckArt" });
    const t = createTrack(db, { artistId: a.id, title: "Ack", visibility: "public" });
    await MACROS.get("classify_track")(ctx("u_ack_user"), { trackId: t.id });
    const r = await MACROS.get("recommend")(ctx("u_ack_user"));
    const rec = db.prepare(`SELECT id FROM music_recommendations WHERE user_id = ? LIMIT 1`).get("u_ack_user");
    const ack = await MACROS.get("recommendation_ack")(ctx("u_ack_user"), { id: rec.id, action: "liked" });
    assert.equal(ack.ok, true);
    const after = db.prepare(`SELECT acted_on, surfaced_at FROM music_recommendations WHERE id = ?`).get(rec.id);
    assert.equal(after.acted_on, "liked");
    assert.ok(after.surfaced_at != null);
  });

  it("rejects invalid action", async () => {
    const r = await MACROS.get("recommendation_ack")(ctx("u_bad"), { id: 1, action: "weird" });
    assert.equal(r.reason, "id_and_action_required");
  });
});
