// Boot race: the local embedder starts a backfill before initEmbeddings()
// loads stored vectors, so the backfill's snapshot lists every DTU. Vectors
// that land in the cache while it runs must be skipped, not re-embedded
// (each restart used to re-embed all ~2,000 DTUs on both backends).
import { test } from "node:test";
import assert from "node:assert/strict";
import emb from "../embeddings.js";

test("backfill skips DTUs whose vectors appear in the cache mid-run", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `dtu-${i}`);
  const local = {
    model: "Xenova/all-MiniLM-L6-v2",
    dimension: 384,
    calls: 0,
    async embed() {
      this.calls++;
      if (this.calls === 1) {
        // Stored vectors arrive (initEmbeddings reloads them from SQLite).
        for (const id of ids.slice(1)) { const v = new Float32Array(384); v[0] = 1; emb.storeEmbedding(id, v); }
      }
      const v = new Float32Array(384); v[1] = 1; return v;
    },
  };
  assert.equal(emb.setLocalEmbedder(local), true);
  const dtus = new Map(ids.map((id) => [id, { id, title: `title ${id}` }]));
  const r = await emb.backfillEmbeddings(dtus, { governed: false });
  assert.equal(local.calls, 1, "only the DTU without a stored vector is embedded");
  assert.equal(r.embedded, 1);
  assert.equal(r.alreadyCached, 29);
  assert.equal(r.errors, 0);
});
