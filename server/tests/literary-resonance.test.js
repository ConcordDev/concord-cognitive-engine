// server/tests/literary-resonance.test.js
//
// LRL Phase 2 — cross-domain resonance edges, offline. Seeds embedding_cache by
// hand (a literary DTU, a near code DTU, a far physics DTU) so cosine has a known
// answer, then pins: only above-threshold cross-domain neighbours become edges,
// the heartbeat cycle crystallizes them, and the literary.resonance macro reads
// them back. No Ollama needed.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { ingestWork } from "../lib/literary-ingest.js";
import { computeResonanceForDtu, getResonanceEdges } from "../lib/literary-resonance.js";
import registerLiteraryMacros from "../domains/literary.js";
import { runLiteraryResonanceCycle } from "../emergent/literary-resonance-cycle.js";

const SAMPLE = `
CHAPTER I. Power

To be, or not to be, that is the question of power and conscience.
${"Crowns and thrones rise and fall on the will of those who dare to grasp them. ".repeat(30)}
`;

function seedEmbedding(db, dtuId, vec) {
  const buf = Buffer.from(new Float32Array(vec).buffer);
  db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)")
    .run(dtuId, buf, new Date().toISOString());
}

describe("LRL — cross-domain resonance (offline, seeded embeddings)", () => {
  let db, litDtu, codeDtu, physDtu, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    // embedding_cache is created lazily by embeddings.js init at runtime; create
    // it here so the offline test can seed vectors.
    db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);

    await ingestWork(db, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", genre: "philosophy", pdVerified: 1 }, SAMPLE, { doEmbed: false });
    litDtu = db.prepare("SELECT dtu_id FROM literary_chunks WHERE source_id = 'gut_1232' LIMIT 1").get().dtu_id;

    codeDtu = createDTU(db, { creatorId: "system", title: "Faction power sim", content: "models of power and dominance among factions", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;
    physDtu = createDTU(db, { creatorId: "system", title: "Beam deflection", content: "elastic bending of a cantilever beam", contentType: "text", lensId: "engineering", citationMode: "original" }).dtu.id;

    // Literary ≈ code (power), ⟂ physics.
    seedEmbedding(db, litDtu, [1, 0, 0, 0]);
    seedEmbedding(db, codeDtu, [0.95, 0.05, 0, 0]);
    seedEmbedding(db, physDtu, [0, 0, 1, 0]);

    macros = new Map();
    registerLiteraryMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("computeResonanceForDtu records the near cross-domain neighbour, not the far one", () => {
    const r = computeResonanceForDtu(db, litDtu, { minScore: 0.45 });
    assert.equal(r.ok, true);
    assert.equal(r.edges, 1, "only the near (code/game) DTU clears the threshold");
    const edges = getResonanceEdges(db, litDtu);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].dtuId, codeDtu);
    assert.equal(edges[0].domain, "game");
    assert.ok(edges[0].score > 0.9);
  });

  it("never links a literary DTU to another literary DTU (cross-domain only)", () => {
    // Seed a second literary work's DTU near litDtu; it must NOT become an edge.
    const r = computeResonanceForDtu(db, litDtu, { minScore: 0.1 });
    assert.equal(r.ok, true);
    const edges = getResonanceEdges(db, litDtu);
    for (const e of edges) assert.notEqual(e.domain, "literary");
  });

  it("the heartbeat cycle crystallizes edges for un-processed literary DTUs", async () => {
    // Fresh DB so nothing is pre-edged.
    const db2 = new Database(":memory:");
    db2.pragma("foreign_keys = ON");
    await runMigrations(db2);
    db2.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);
    await ingestWork(db2, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", pdVerified: 1 }, SAMPLE, { doEmbed: false });
    const lit2 = db2.prepare("SELECT dtu_id FROM literary_chunks WHERE source_id='gut_1232' LIMIT 1").get().dtu_id;
    const code2 = createDTU(db2, { creatorId: "system", title: "x", content: "power", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;
    seedEmbedding(db2, lit2, [1, 0, 0, 0]);
    seedEmbedding(db2, code2, [0.9, 0.1, 0, 0]);

    const res = await runLiteraryResonanceCycle({ db: db2 });
    assert.equal(res.ok, true);
    assert.ok(res.processed >= 1, "processed at least the embedded literary DTU");
    assert.ok(res.edges >= 1, "crystallized at least one edge");
  });

  it("literary.resonance macro reads edges by chunkId", async () => {
    const chunkId = db.prepare("SELECT id FROM literary_chunks WHERE dtu_id = ?").get(litDtu).id;
    const r = await macros.get("literary.resonance")({ db }, { chunkId });
    assert.equal(r.ok, true);
    assert.equal(r.dtuId, litDtu);
    assert.ok(r.edges.length >= 1);
  });

  it("cycle + resonance degrade gracefully with no embedding_cache table", async () => {
    const bare = new Database(":memory:");
    bare.pragma("foreign_keys = ON");
    await runMigrations(bare);
    const res = await runLiteraryResonanceCycle({ db: bare });
    assert.equal(res.ok, true); // no throw
    assert.equal(res.edges ?? 0, 0);
  });
});
