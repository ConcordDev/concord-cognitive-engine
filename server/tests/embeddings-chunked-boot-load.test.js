// GB-0482: the boot read of embedding_cache was one synchronous `.all()` over the whole table (13 s on the live Mac).
// It now reads rowid-ordered chunks and yields to the event loop between them. Vectors must still all come up by the
// time initEmbeddings resolves.
process.env.CONCORD_EMBEDDING_LOAD_CHUNK = "100";
process.env.CONCORD_EMBEDDING_CACHE_MAX = "1000";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("http://chunk-ollama")) return realFetch(url, init);
  const vec = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));
  return new Response(JSON.stringify(String(url).endsWith("/api/embed") ? { embeddings: [vec] } : { embedding: vec }), { status: 200 });
};

const emb = await import("../embeddings.js");

function seed(n, { gapEvery = 0 } = {}) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, hash TEXT, created_at TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO embedding_cache VALUES (?, ?, NULL, ?)");
  db.transaction(() => {
    for (let i = 0; i < n; i++) ins.run(`dtu-${i}`, Buffer.from(new Float32Array([i, 1, 2, 3]).buffer), "t");
  })();
  if (gapEvery) db.prepare("DELETE FROM embedding_cache WHERE rowid % ? = 0").run(gapEvery);
  return db;
}

test("loads every row through chunked reads and yields to the event loop between chunks", async () => {
  const db = seed(450);
  let ticks = 0;
  let running = true;
  const spin = () => { if (running) { ticks++; setImmediate(spin); } };
  setImmediate(spin);
  const logs = [];
  const r = await emb.initEmbeddings({ db, ollamaUrls: ["http://chunk-ollama"], structuredLog: (l, e, d) => logs.push([e, d]) });
  running = false;
  assert.equal(r.available, true);
  assert.equal(emb.getEmbedding("dtu-0").length, 4);
  assert.equal(emb.getEmbedding("dtu-449")[0], 449);
  const loaded = logs.find(([e]) => e === "embeddings_loaded_from_db")[1];
  assert.equal(loaded.count, 450);
  assert.equal(loaded.chunks, 5, "450 rows at 100 per chunk");
  assert.ok(ticks >= 4, `loop ran other work between chunks (ticks=${ticks})`);
});

test("rowid gaps (deleted rows) do not drop or repeat rows", async () => {
  const db = seed(300, { gapEvery: 3 });
  const expected = db.prepare("SELECT count(*) AS c FROM embedding_cache").get().c;
  const logs = [];
  await emb.initEmbeddings({ db, ollamaUrls: ["http://chunk-ollama"], structuredLog: (l, e, d) => logs.push([e, d]) });
  assert.equal(logs.find(([e]) => e === "embeddings_loaded_from_db")[1].count, expected);
  assert.equal(emb.getEmbedding("dtu-2"), null, "rowid 3 was deleted");
  assert.equal(emb.getEmbedding("dtu-0")[0], 0);
});

test("the in-memory cap still bounds the load", async () => {
  const db = seed(1500);
  const logs = [];
  await emb.initEmbeddings({ db, ollamaUrls: ["http://chunk-ollama"], structuredLog: (l, e, d) => logs.push([e, d]) });
  assert.equal(logs.find(([e]) => e === "embeddings_loaded_from_db")[1].count, 1000);
});

test("source pin: the loader pages by rowid and never reads the whole table in one .all()", () => {
  const src = fs.readFileSync(new URL("../embeddings.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function _loadEmbeddingsFromDb"), src.indexOf("// Migration: also check legacy"));
  assert.match(fn, /WHERE rowid > \? ORDER BY rowid LIMIT \?/);
  assert.match(fn, /await new Promise\(\(resolve\) => \{ setImmediate\(resolve\); \}\)/);
  assert.doesNotMatch(fn, /SELECT dtu_id, embedding FROM \$\{embeddingState\.table\}`\)\.all\(\)/);
});
