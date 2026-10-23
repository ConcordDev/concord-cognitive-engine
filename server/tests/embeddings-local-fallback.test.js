// Pins the 2026-10-22 semantic-embeddings fix: with no Ollama embedding model
// reachable (GPU pod down), the layer runs on the registered local CPU
// embedder instead of switching semantic search off; vectors are stored per
// model and never mixed; and a re-probe switches back to the primary model
// (and its stored vectors) when Ollama returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import emb from "../embeddings.js";

const PRIMARY = "mxbai-embed-large";
const logs = [];
const log = (level, event, data) => logs.push({ level, event, data });

let ollamaUp = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("http://fake-ollama")) return realFetch(url, init);
  if (!ollamaUp) throw new TypeError("fetch failed");
  const body = JSON.parse(init.body);
  if (body.model !== PRIMARY) return new Response("{}", { status: 404 });
  const vec = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  return new Response(JSON.stringify(String(url).endsWith("/api/embed") ? { embeddings: [vec] } : { embedding: vec }), { status: 200 });
};

const local = {
  model: "Xenova/all-MiniLM-L6-v2",
  dimension: 384,
  calls: 0,
  async embed(text) { this.calls++; const v = new Float32Array(384); v[text.length % 384] = 1; return v; },
};

const db = new Database(":memory:");
db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT)");
// A pod-era vector already on disk in the primary table.
db.exec("CREATE TABLE embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, hash TEXT, created_at TEXT NOT NULL)");
const podVec = new Float32Array(1024); podVec[5] = 1;
db.prepare("INSERT INTO embedding_cache VALUES (?, ?, NULL, ?)").run("dtu-pod", Buffer.from(podVec.buffer), new Date().toISOString());

test("tableForModel keeps the primary table and slugs others", () => {
  assert.equal(emb.tableForModel(PRIMARY), "embedding_cache");
  assert.equal(emb.tableForModel("Xenova/all-MiniLM-L6-v2"), "embedding_cache__xenova_all_minilm_l6_v2");
  assert.equal(emb.tableForModel("all-minilm"), "embedding_cache__all_minilm");
});

test("no Ollama + no local embedder yet → unavailable with a real reason", async () => {
  await emb.initEmbeddings({ db, ollamaUrls: ["http://fake-ollama:1"], structuredLog: log });
  assert.equal(emb.isEmbeddingAvailable(), false);
  assert.equal(emb.getEmbeddingStatus().reason, "no_ollama_embedding_model");
});

test("registering the local embedder activates it, in its own table", async () => {
  assert.equal(emb.setLocalEmbedder(local), true);
  const st = emb.getEmbeddingStatus();
  assert.equal(st.available, true);
  assert.equal(st.backend, "local");
  assert.equal(st.model, local.model);
  assert.equal(st.table, "embedding_cache__xenova_all_minilm_l6_v2");
  assert.equal(emb.getEmbedding("dtu-pod"), null, "1024-dim pod vectors must not be loaded under MiniLM");

  assert.equal(await emb.embedDTU({ id: "dtu-a", title: "hello world" }), "embedded");
  assert.equal(emb.getEmbedding("dtu-a").length, 384);
  const rows = db.prepare("SELECT dtu_id, length(embedding) AS n FROM embedding_cache__xenova_all_minilm_l6_v2").all();
  assert.deepEqual(rows, [{ dtu_id: "dtu-a", n: 384 * 4 }]);
  assert.equal(db.prepare("SELECT count(*) AS c FROM embedding_cache").get().c, 1, "primary table untouched");

  const q = await emb.embed("hello world", "query");
  const hits = emb.findSimilar(q, [{ id: "dtu-a" }], 5);
  assert.equal(hits[0].id, "dtu-a");
  assert.ok(hits[0].rawSimilarity > 0.99);
});

test("the CPU-embedder backfill runs even when the host counts as idle / low-memory", async () => {
  // No auth or traffic activity in this process, so presence-idle reports
  // idle and shouldRunHeavyMaintenance() is false — the live Mac's state.
  const presenceIdle = await import("../lib/presence-idle.js");
  assert.equal(presenceIdle.shouldRunHeavyMaintenance(), false, "precondition: heavy maintenance is gated off");
  const dtus = new Map([
    ["dtu-b1", { id: "dtu-b1", title: "first backfill target" }],
    ["dtu-b2", { id: "dtu-b2", title: "second backfill target" }],
  ]);
  const r = await emb.backfillEmbeddings(dtus);
  assert.equal(r.skipped === "idle_no_users", false, JSON.stringify(r));
  assert.equal(emb.getEmbedding("dtu-b1").length, 384);
  assert.equal(emb.getEmbedding("dtu-b2").length, 384);
});

test("re-probe does nothing while Ollama is still down", async () => {
  assert.deepEqual(await emb.reprobeEmbeddings(), { changed: false });
  assert.equal(emb.getEmbeddingStatus().backend, "local");
});

test("a vector computed by the previous model is not stored after a switch", () => {
  emb.storeEmbedding("dtu-stale", new Float32Array(384), "some-other-model");
  assert.equal(emb.getEmbedding("dtu-stale"), null);
});

test("when Ollama returns, re-probe switches back to the primary model and its vectors", async () => {
  ollamaUp = true;
  const r = await emb.reprobeEmbeddings();
  assert.deepEqual(r, { changed: true, model: PRIMARY });
  const st = emb.getEmbeddingStatus();
  assert.equal(st.backend, "ollama");
  assert.equal(st.table, "embedding_cache");
  assert.equal(emb.getEmbedding("dtu-pod").length, 1024, "pod-era vectors come back");
  assert.equal(emb.getEmbedding("dtu-a"), null, "MiniLM vectors are not mixed in");
  assert.equal((await emb.embed("x", "query")).length, 1024);
});

test("deleting a DTU removes its vector from every model's table", () => {
  emb.removeEmbedding("dtu-a");
  assert.equal(db.prepare("SELECT count(*) AS c FROM embedding_cache__xenova_all_minilm_l6_v2 WHERE dtu_id = 'dtu-a'").get().c, 0);
  emb.removeEmbedding("dtu-pod");
  assert.equal(db.prepare("SELECT count(*) AS c FROM embedding_cache WHERE dtu_id = 'dtu-pod'").get().c, 0);
});

test.after(() => { globalThis.fetch = realFetch; db.close(); });
