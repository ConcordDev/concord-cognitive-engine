// server/domains/musicres.js
//
// Music Resonance (#43) — macros over the music corpus on the Literary
// Resonance Lattice (lib/music-resonance.js, mig 343). "Music as a literary
// corpus": ingest user-authored / PD / CC tracks, hybrid-search them (BM25 +
// dense, same pipeline as the literary lattice), and BRIDGE a lyric to the
// public-domain passage it resonates with — making the lattice cross-domain.
//
// Registered from server.js: registerMusicResMacros(register).

import { ingestTrack, searchMusic, bridgeToLiterary, musicCorpusStats } from "../lib/music-resonance.js";

export default function registerMusicResMacros(register) {
  register("musicres", "ingest", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const creatorId = input.creatorId || ctx?.actor?.userId || "system";
    return ingestTrack(db, input.meta || {}, input.sections || [], { creatorId });
  }, { note: "ingest a track (user-authored/PD/CC) into the music corpus (#43)" });

  register("musicres", "search", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return searchMusic(db, input);
  }, { note: "hybrid search the music corpus (BM25 + dense; semantic flag honest) (#43)" });

  register("musicres", "bridge", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return bridgeToLiterary(db, { chunkId: input.chunkId, query: input.query, limit: input.limit, keyword: input.keyword });
  }, { note: "bridge a lyric to the literary passages it resonates with (#43)" });

  register("musicres", "stats", async (ctx) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return musicCorpusStats(db);
  }, { note: "music corpus stats (#43)" });
}
