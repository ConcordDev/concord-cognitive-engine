// server/tests/literary-phase34.test.js
//
// LRL Phase 3 (lexical rerank, license audit) + Phase 4 (annotation
// crystallization, crystallize candidates), all offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { ingestWork } from "../lib/literary-ingest.js";
import { computeResonanceForDtu } from "../lib/literary-resonance.js";
import { rerankHits, lexicalScore } from "../lib/literary-rerank.js";
import { runLiteraryLicenseAuditCycle } from "../emergent/literary-license-audit-cycle.js";
import registerLiteraryMacros from "../domains/literary.js";

const SAMPLE = `
CHAPTER I. Power

To be, or not to be, that is the question of power and conscience.
${"Crowns and thrones rise and fall on the will of those who dare to grasp them. ".repeat(30)}
`;

function macrosFor() {
  const m = new Map();
  registerLiteraryMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}
function seedEmbedding(db, dtuId, vec) {
  db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)")
    .run(dtuId, Buffer.from(new Float32Array(vec).buffer), new Date().toISOString());
}

describe("LRL Phase 3 — lexical rerank", () => {
  it("scores term coverage + exact phrase", () => {
    assert.ok(lexicalScore("power", "the power of kings") > lexicalScore("power", "soft white clouds"));
    assert.ok(lexicalScore("power conscience", "power and conscience") > lexicalScore("power conscience", "power alone"));
  });

  it("re-orders fused ties by lexical overlap, stable + non-destructive", () => {
    const hits = [
      { chunkId: "a", score: 0.01, title: "Of clouds", snippet: "the weather is fair" },
      { chunkId: "b", score: 0.01, title: "Of power", snippet: "power and conscience and crowns" },
    ];
    const r = rerankHits("power conscience", hits);
    assert.equal(r.length, 2, "never drops hits");
    assert.equal(r[0].chunkId, "b", "higher lexical overlap wins the tie");
  });

  it("kill-switch LRL_RERANK=0 leaves order untouched", () => {
    const hits = [{ chunkId: "a", score: 0.01 }, { chunkId: "b", score: 0.02 }];
    const prev = process.env.LRL_RERANK;
    process.env.LRL_RERANK = "0";
    try {
      assert.deepEqual(rerankHits("x", hits).map((h) => h.chunkId), ["a", "b"]);
    } finally { if (prev === undefined) delete process.env.LRL_RERANK; else process.env.LRL_RERANK = prev; }
  });
});

describe("LRL Phase 3 — license audit cycle", () => {
  it("flags a non-PD unverified source, leaves PD sources alone", async () => {
    const db = new Database(":memory:");
    await runMigrations(db);
    db.prepare("INSERT INTO literary_sources (id,title,license,pd_verified) VALUES ('s_bad','X','all_rights_reserved',0)").run();
    db.prepare("INSERT INTO literary_sources (id,title,license,pd_verified) VALUES ('s_ok','Y','public_domain',0)").run();
    const r = await runLiteraryLicenseAuditCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.checked, 2);
    assert.equal(r.flagged, 1);
    assert.equal(db.prepare("SELECT pd_verified FROM literary_sources WHERE id='s_bad'").get().pd_verified, -1);
    assert.equal(db.prepare("SELECT pd_verified FROM literary_sources WHERE id='s_ok'").get().pd_verified, 0);
  });
});

describe("LRL Phase 4 — annotation + crystallize", () => {
  let db, macros, chunkId, litDtu;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);
    await ingestWork(db, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", pdVerified: 1 }, SAMPLE, { doEmbed: false });
    const row = db.prepare("SELECT id, dtu_id FROM literary_chunks WHERE source_id='gut_1232' LIMIT 1").get();
    chunkId = row.id; litDtu = row.dtu_id;
    macros = macrosFor();
  });

  it("ingest makes the chunk DTU public (citable + discoverable)", () => {
    const vis = db.prepare("SELECT visibility FROM dtus WHERE id = ?").get(litDtu).visibility;
    assert.equal(vis, "public");
  });

  it("annotate creates a derivative DTU citing the source passage", async () => {
    const r = await macros.get("literary.annotate")(
      { db, actor: { userId: "u1" } },
      { chunkId, note: "Power and conscience in tension — a Machiavellian read.", quote: "to be or not to be" },
    );
    assert.equal(r.ok, true, `annotate failed: ${r.reason}`);
    assert.ok(r.dtuId, "new annotation DTU id returned");
    const dtu = db.prepare("SELECT lens_id, content FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.lens_id, "literary");
    assert.match(dtu.content, /Machiavellian read/);
  });

  it("crystallize surfaces the most-bridged passages", async () => {
    // Give litDtu two cross-domain edges so it ranks as a crystal.
    const codeDtu = createDTU(db, { creatorId: "system", title: "sim", content: "power", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;
    const engDtu = createDTU(db, { creatorId: "system", title: "beam", content: "force", contentType: "text", lensId: "engineering", citationMode: "original" }).dtu.id;
    seedEmbedding(db, litDtu, [1, 0, 0, 0]);
    seedEmbedding(db, codeDtu, [0.95, 0.05, 0, 0]);
    seedEmbedding(db, engDtu, [0.9, 0.1, 0, 0]);
    computeResonanceForDtu(db, litDtu, { minScore: 0.5 });

    const r = await macros.get("literary.crystallize")({ db }, { limit: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.crystals.length >= 1);
    assert.equal(r.crystals[0].dtuId, litDtu);
    assert.ok(r.crystals[0].edgeCount >= 2);
  });
});
