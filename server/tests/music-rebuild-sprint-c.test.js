// server/tests/music-rebuild-sprint-c.test.js
//
// Tier-2 contract tests for music Sprint C (concord moats). Each
// test maps to a specific research-grounded moat (see
// docs/LENS_RESEARCH_NOTES.md).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMusicRebuildMacros from "../domains/music-rebuild.js";
import registerMusicMoatsMacros from "../domains/music-moats.js";
import { createArtist, createTrack, createPlaylist, addTrackToPlaylist } from "../lib/music/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["237_music_rebuild", "238_music_ai", "239_music_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, creator_id TEXT, meta_json TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  registerMusicRebuildMacros(register);
  registerMusicMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Track mint (Sound.xyz / EIP-2981 parity) ─────────────

describe("track_mint (Sound.xyz / EIP-2981 alignment)", () => {
  it("mints track as music_track DTU with EIP-2981 default 10% royalty", async () => {
    const a = createArtist(db, { ownerUserId: "u_mint", name: "MintArt" });
    const t = createTrack(db, { artistId: a.id, title: "Mintable" });
    const r = await MACROS.get("track_mint")(ctx("u_mint"), { trackId: t.id });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("music_track:"));
    assert.equal(r.royaltyRate, 0.10); // Sound.xyz default
    assert.equal(r.allowDerivative, true);
    assert.equal(r.allowAiTraining, false);  // Subvert/Bandcamp consent default
  });

  it("royalty clamped to 30% (Concord ceiling) — try to set 99%", async () => {
    const a = createArtist(db, { ownerUserId: "u_cap", name: "CapArt" });
    const t = createTrack(db, { artistId: a.id, title: "Capped" });
    const r = await MACROS.get("track_mint")(ctx("u_cap"), { trackId: t.id, royaltyRate: 0.99 });
    assert.equal(r.royaltyRate, 0.30);
  });

  it("idempotent — second mint returns existing dtuId", async () => {
    const a = createArtist(db, { ownerUserId: "u_idem", name: "IdemArt" });
    const t = createTrack(db, { artistId: a.id, title: "Idem" });
    const r1 = await MACROS.get("track_mint")(ctx("u_idem"), { trackId: t.id });
    const r2 = await MACROS.get("track_mint")(ctx("u_idem"), { trackId: t.id });
    assert.equal(r2.alreadyMinted, true);
    assert.equal(r2.dtuId, r1.dtuId);
  });

  it("refuses cross-user mint + private tracks", async () => {
    const a = createArtist(db, { ownerUserId: "u_owner", name: "Own" });
    const t = createTrack(db, { artistId: a.id, title: "Mine" });
    const wrong = await MACROS.get("track_mint")(ctx("u_thief"), { trackId: t.id });
    assert.equal(wrong.reason, "forbidden");
    const t2 = createTrack(db, { artistId: a.id, title: "Private", visibility: "private" });
    const priv = await MACROS.get("track_mint")(ctx("u_owner"), { trackId: t2.id });
    assert.equal(priv.reason, "cannot_mint_private_track");
  });

  it("opt-in AI training consent (default off)", async () => {
    const a = createArtist(db, { ownerUserId: "u_ai", name: "AIArt" });
    const t = createTrack(db, { artistId: a.id, title: "OptIn" });
    const r = await MACROS.get("track_mint")(ctx("u_ai"), { trackId: t.id, allowAiTraining: true });
    assert.equal(r.allowAiTraining, true);
    const row = db.prepare(`SELECT allow_ai_training FROM music_track_mints WHERE track_id = ?`).get(t.id);
    assert.equal(row.allow_ai_training, 1);
  });
});

// ─── Derivative attribution (ClearBeats parity) ────────────

describe("track_cite_derivative (ClearBeats parity)", () => {
  it("cover derivative cites parent + fires cascade", async () => {
    // Parent track
    const parentArtist = createArtist(db, { ownerUserId: "u_parent", name: "Original" });
    const parent = createTrack(db, { artistId: parentArtist.id, title: "OG Song" });
    await MACROS.get("track_mint")(ctx("u_parent"), { trackId: parent.id });
    // Derivative cover by different artist
    const coverArtist = createArtist(db, { ownerUserId: "u_cover", name: "Coverer" });
    const cover = createTrack(db, { artistId: coverArtist.id, title: "OG Song (Cover)" });
    await MACROS.get("track_mint")(ctx("u_cover"), { trackId: cover.id });
    const r = await MACROS.get("track_cite_derivative")(ctx("u_cover"), {
      derivativeTrackId: cover.id,
      parentTrackId: parent.id,
      kind: "cover",
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "cover");
    assert.equal(r.attributionPct, 1.0);
    // Verify lineage row written
    const link = db.prepare(`SELECT * FROM music_derivative_links WHERE derivative_track_id = ? AND parent_track_id = ?`).get(cover.id, parent.id);
    assert.equal(link.kind, "cover");
    assert.equal(link.clearance_status, "auto_via_lineage");
    // Parent mint citation_count bumped
    const parentMint = db.prepare(`SELECT citation_count FROM music_track_mints WHERE track_id = ?`).get(parent.id);
    assert.equal(parentMint.citation_count, 1);
  });

  it("refuses derivative if parent blocks derivatives", async () => {
    const a = createArtist(db, { ownerUserId: "u_block", name: "Blocker" });
    const t = createTrack(db, { artistId: a.id, title: "No Derivs" });
    await MACROS.get("track_mint")(ctx("u_block"), { trackId: t.id, allowDerivative: false });
    const a2 = createArtist(db, { ownerUserId: "u_remix", name: "Remixer" });
    const t2 = createTrack(db, { artistId: a2.id, title: "Remix Attempt" });
    await MACROS.get("track_mint")(ctx("u_remix"), { trackId: t2.id });
    const r = await MACROS.get("track_cite_derivative")(ctx("u_remix"), {
      derivativeTrackId: t2.id, parentTrackId: t.id, kind: "remix",
    });
    assert.equal(r.reason, "parent_blocks_derivatives");
  });

  it("ai_generated_from requires parent allow_ai_training=true", async () => {
    const a = createArtist(db, { ownerUserId: "u_ai_block", name: "NoAI" });
    const t = createTrack(db, { artistId: a.id, title: "Human Only" });
    await MACROS.get("track_mint")(ctx("u_ai_block"), { trackId: t.id }); // allowAiTraining defaults false
    const a2 = createArtist(db, { ownerUserId: "u_ai_user", name: "AIUser" });
    const t2 = createTrack(db, { artistId: a2.id, title: "AI Track" });
    await MACROS.get("track_mint")(ctx("u_ai_user"), { trackId: t2.id });
    const r = await MACROS.get("track_cite_derivative")(ctx("u_ai_user"), {
      derivativeTrackId: t2.id, parentTrackId: t.id, kind: "ai_generated_from",
    });
    assert.equal(r.reason, "parent_blocks_ai_training");
  });

  it("track_derivatives returns both children + parents", async () => {
    const a = createArtist(db, { ownerUserId: "u_lin", name: "LinArt" });
    const original = createTrack(db, { artistId: a.id, title: "Source" });
    const derivative = createTrack(db, { artistId: a.id, title: "Sampled" });
    await MACROS.get("track_mint")(ctx("u_lin"), { trackId: original.id });
    await MACROS.get("track_mint")(ctx("u_lin"), { trackId: derivative.id });
    await MACROS.get("track_cite_derivative")(ctx("u_lin"), {
      derivativeTrackId: derivative.id, parentTrackId: original.id, kind: "sample", attributionPct: 0.3,
    });
    const fromParent = await MACROS.get("track_derivatives")(ctx("u_lin"), { trackId: original.id });
    assert.equal(fromParent.derivativeCount, 1);
    assert.equal(fromParent.parentCount, 0);
    const fromDerivative = await MACROS.get("track_derivatives")(ctx("u_lin"), { trackId: derivative.id });
    assert.equal(fromDerivative.derivativeCount, 0);
    assert.equal(fromDerivative.parentCount, 1);
  });
});

// ─── Playlist mint (curator royalty — Concord moat) ───────

describe("playlist_mint (Concord-exclusive curator royalty)", () => {
  it("mints playlist as music_playlist DTU with 5% curator royalty default", async () => {
    const a = createArtist(db, { ownerUserId: "u_pl_owner", name: "PArt" });
    const t = createTrack(db, { artistId: a.id, title: "T", durationMs: 200_000 });
    const pl = createPlaylist(db, { ownerId: "u_curator", title: "Hand-picked", visibility: "public" });
    addTrackToPlaylist(db, pl.id, t.id, "u_curator");
    const r = await MACROS.get("playlist_mint")(ctx("u_curator"), { playlistId: pl.id });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("music_playlist:"));
    assert.equal(r.curatorRoyaltyRate, 0.05);
  });

  it("curator royalty capped at 20%", async () => {
    const pl = createPlaylist(db, { ownerId: "u_cap_c", title: "Greedy", visibility: "public" });
    const r = await MACROS.get("playlist_mint")(ctx("u_cap_c"), { playlistId: pl.id, curatorRoyaltyRate: 0.99 });
    assert.equal(r.curatorRoyaltyRate, 0.20);
  });

  it("refuses private playlist mint", async () => {
    const pl = createPlaylist(db, { ownerId: "u_priv_c", title: "Mine", visibility: "private" });
    const r = await MACROS.get("playlist_mint")(ctx("u_priv_c"), { playlistId: pl.id });
    assert.equal(r.reason, "cannot_mint_private_playlist");
  });
});

// ─── AI training citation (Musical AI parity) ──────────────

describe("ai_training_cite (Musical AI parity)", () => {
  it("cites multiple training-source DTUs + auto-creates derivative_links for music tracks", async () => {
    const a1 = createArtist(db, { ownerUserId: "u_src1", name: "SrcArt1" });
    const a2 = createArtist(db, { ownerUserId: "u_src2", name: "SrcArt2" });
    const src1 = createTrack(db, { artistId: a1.id, title: "Influence A" });
    const src2 = createTrack(db, { artistId: a2.id, title: "Influence B" });
    await MACROS.get("track_mint")(ctx("u_src1"), { trackId: src1.id, allowAiTraining: true });
    await MACROS.get("track_mint")(ctx("u_src2"), { trackId: src2.id, allowAiTraining: true });
    const src1Mint = db.prepare(`SELECT dtu_id FROM music_track_mints WHERE track_id = ?`).get(src1.id);
    const src2Mint = db.prepare(`SELECT dtu_id FROM music_track_mints WHERE track_id = ?`).get(src2.id);

    const aiArtist = createArtist(db, { ownerUserId: "u_ai_gen", name: "AIGen" });
    const aiTrack = createTrack(db, { artistId: aiArtist.id, title: "AI Composition" });
    await MACROS.get("track_mint")(ctx("u_ai_gen"), { trackId: aiTrack.id });
    const r = await MACROS.get("ai_training_cite")(ctx("u_ai_gen"), {
      aiTrackId: aiTrack.id,
      modelName: "musicgen-large",
      sources: [
        { dtuId: src1Mint.dtu_id, contributionWeight: 0.6 },
        { dtuId: src2Mint.dtu_id, contributionWeight: 0.4 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.cited, 2);
    // ai_training_citations rows exist
    const cits = db.prepare(`SELECT * FROM music_ai_training_citations WHERE ai_track_id = ?`).all(aiTrack.id);
    assert.equal(cits.length, 2);
    // derivative_links auto-created
    const links = db.prepare(`SELECT * FROM music_derivative_links WHERE derivative_track_id = ? AND kind = 'ai_generated_from'`).all(aiTrack.id);
    assert.equal(links.length, 2);
  });

  it("ai_training_sources_for returns citations sorted by weight", async () => {
    const aiArtist = createArtist(db, { ownerUserId: "u_ai2", name: "AI2" });
    const aiTrack = createTrack(db, { artistId: aiArtist.id, title: "AI2" });
    await MACROS.get("track_mint")(ctx("u_ai2"), { trackId: aiTrack.id });
    db.prepare(`INSERT INTO music_ai_training_citations (ai_track_id, training_source_dtu_id, contribution_weight) VALUES (?, ?, ?)`).run(aiTrack.id, "dtu:x", 0.3);
    db.prepare(`INSERT INTO music_ai_training_citations (ai_track_id, training_source_dtu_id, contribution_weight) VALUES (?, ?, ?)`).run(aiTrack.id, "dtu:y", 0.7);
    const r = await MACROS.get("ai_training_sources_for")(ctx("u_ai2"), { trackId: aiTrack.id });
    assert.equal(r.count, 2);
    assert.equal(r.sources[0].contribution_weight, 0.7);
  });
});

// ─── Concord Fridays (Bandcamp Fridays clone) ──────────────

describe("concord_friday_status + scheduling", () => {
  it("seeded 8 Concord Fridays for 2026 matching Bandcamp calendar exactly", async () => {
    const r = await MACROS.get("concord_fridays_list")(ctx("u_fri"));
    assert.equal(r.fridays.length, 8);
    const days = r.fridays.map((f) => f.day);
    assert.ok(days.includes("2026-02-06"));
    assert.ok(days.includes("2026-03-06"));
    assert.ok(days.includes("2026-05-01"));
    assert.ok(days.includes("2026-08-07"));
    assert.ok(days.includes("2026-09-04"));
    assert.ok(days.includes("2026-10-02"));
    assert.ok(days.includes("2026-11-06"));
    assert.ok(days.includes("2026-12-04"));
  });

  it("concord_friday_status returns isConcordFriday + upcoming dates", async () => {
    const r = await MACROS.get("concord_friday_status")(ctx("u_fri_status"));
    assert.equal(r.ok, true);
    assert.ok("isConcordFriday" in r);
    assert.ok(Array.isArray(r.upcoming));
    // Today is unlikely to be one of the 8 dates exactly so platformFeeOverride should be null most days
    if (r.isConcordFriday) {
      assert.equal(r.platformFeeOverride, 0);
    } else {
      assert.equal(r.platformFeeOverride, null);
    }
  });

  it("concord_friday_record_payout accumulates analytics", async () => {
    const r = await MACROS.get("concord_friday_record_payout")(ctx("u_pay"), {
      day: "2026-05-01", amountCents: 5000, trackId: "trk:test",
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT total_payouts_cents, participating_tracks FROM music_concord_fridays WHERE day = ?`).get("2026-05-01");
    assert.ok(row.total_payouts_cents >= 5000);
    assert.ok(row.participating_tracks >= 1);
  });
});

// ─── ActivityPub federation (Funkwhale-compatible) ─────────

describe("federation_publish (Funkwhale-compatible)", () => {
  it("composes valid ActivityPub Create→Audio activity with audio enclosure", async () => {
    const a = createArtist(db, { ownerUserId: "u_fed", name: "FedArt" });
    const t = createTrack(db, { artistId: a.id, title: "Federate Me", durationMs: 180_000, audioUrl: "https://example.com/track.mp3", genres: ["indie", "rock"] });
    const r = await MACROS.get("federation_publish")(ctx("u_fed"), { trackId: t.id, baseUrl: "https://test.concord-os.org" });
    assert.equal(r.ok, true);
    assert.ok(r.activity);
    assert.equal(r.activity.type, "Create");
    assert.equal(r.activity.object.type, "Audio");
    assert.equal(r.activity.object.name, "Federate Me");
    assert.equal(r.activity.object.duration, "PT180S");  // ISO 8601 duration
    assert.equal(r.activity.object.url[0].href, "https://example.com/track.mp3");
    assert.equal(r.activity.object.url[0].mediaType, "audio/mpeg");
    // Hashtags from genres
    assert.ok(r.activity.object.tag.find((h) => h.name === "#indie"));
    // Persisted to outbox
    const row = db.prepare(`SELECT status FROM music_federation_publishes WHERE id = ?`).get(r.publishId);
    assert.equal(row.status, "pending");
  });

  it("refuses cross-user federation + private tracks", async () => {
    const a = createArtist(db, { ownerUserId: "u_fed_owner", name: "FedOwn" });
    const t = createTrack(db, { artistId: a.id, title: "Mine Only", visibility: "private" });
    const r1 = await MACROS.get("federation_publish")(ctx("u_fed_thief"), { trackId: t.id });
    assert.equal(r1.reason, "forbidden");
    const r2 = await MACROS.get("federation_publish")(ctx("u_fed_owner"), { trackId: t.id });
    assert.equal(r2.reason, "cannot_federate_private");
  });

  it("federation_outbox_status returns counts", async () => {
    const r = await MACROS.get("federation_outbox_status")(ctx("u_fos"));
    assert.equal(r.ok, true);
    assert.ok(typeof r.pending === "number");
  });
});
