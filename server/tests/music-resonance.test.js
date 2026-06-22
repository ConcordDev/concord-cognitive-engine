// server/tests/music-resonance.test.js
//
// Music Resonance (#43) — the second corpus on the Literary Resonance Lattice.
// Offline-honest: with no Ollama, embed() returns null so search degrades to
// BM25 keyword retrieval with semantic:false — never faked. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { ingestTrack, searchMusic, bridgeToLiterary, musicCorpusStats } from "../lib/music-resonance.js";
import registerMusicResMacros from "../domains/musicres.js";

describe("Music Resonance (#43)", () => {
  let db, macros, trackChunks;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerMusicResMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
    const r = ingestTrack(db, { title: "River of Stars", artist: "Aria", genre: "folk", mood: ["wistful", "nocturnal"] }, [
      { kind: "verse", heading: "Verse 1", content: "the river carries silver light beneath a sleepless moon" },
      { kind: "chorus", content: "we drift along the water, dreaming of the distant shore" },
    ], { creatorId: "u1" });
    assert.equal(r.ok, true);
    trackChunks = r.chunks;
  });

  it("ingests a track, minting a DTU per section and indexing FTS", () => {
    assert.equal(trackChunks.length, 2);
    assert.ok(trackChunks[0].dtuId, "section minted a DTU");
    const stats = musicCorpusStats(db);
    assert.equal(stats.tracks, 1);
    assert.equal(stats.chunks, 2);
    // The DTU is a real lattice citizen.
    const dtu = db.prepare("SELECT lens_id, creator_id FROM dtus WHERE id = ?").get(trackChunks[0].dtuId);
    assert.equal(dtu.creator_id, "u1");
  });

  it("BM25 keyword search finds the right section (semantic:false offline)", async () => {
    const r = await searchMusic(db, { query: "moon river silver light" });
    assert.equal(r.ok, true);
    assert.equal(r.semantic, false, "no embeddings offline → honest semantic flag");
    assert.ok(r.results.length >= 1);
    assert.ok(r.results[0].snippet.includes("silver light"), "matched the verse");
    assert.equal(r.results[0].artist, "Aria");
  });

  it("an empty query returns an empty result, not an error", async () => {
    const r = await searchMusic(db, { query: "" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
  });

  it("bridges a lyric to resonant literary passages (cross-domain)", async () => {
    // Seed a tiny literary corpus so the bridge has something to find.
    const { ingestWork } = await import("../lib/literary-ingest.js");
    await ingestWork(db, { title: "Moon Verses", author: "Anon", license: "public_domain" },
      "The moon rose over the silver river and the water carried its light to the distant shore.");
    const r = await bridgeToLiterary(db, { chunkId: trackChunks[0].id, keyword: true });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.bridges));
    assert.ok(r.bridges.length >= 1, "found a resonant public-domain passage");
  });

  it("musicres macros round-trip", async () => {
    const ing = await macros.get("musicres.ingest")({ db, actor: { userId: "u2" } }, {
      meta: { title: "Second Song" }, sections: ["a quiet melody in the dark"],
    });
    assert.equal(ing.ok, true);
    const s = await macros.get("musicres.search")({ db }, { query: "quiet melody", keyword: true });
    assert.equal(s.ok, true);
    assert.ok(s.results.length >= 1);
    const stats = await macros.get("musicres.stats")({ db });
    assert.equal(stats.tracks, 2);
  });
});
