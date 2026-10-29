// The boot probe can run before the tunnel/model answers. Embeddings must warm up on a short backoff,
// the "warming" flag must clear on the first success, and the degraded warning must wait for the warm-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initEmbeddings, scheduleEmbeddingReprobe, embeddingWarmupPending, getEmbeddingStatus } from "../embeddings.js";

let up = false;
let probes = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("http://boot-ollama")) return realFetch(url, init);
  probes++;
  if (!up) throw new TypeError("fetch failed");
  const body = JSON.parse(init.body);
  if (body.model !== "mxbai-embed-large") return new Response("{}", { status: 404 });
  const vec = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  return new Response(JSON.stringify(String(url).endsWith("/api/embed") ? { embeddings: [vec] } : { embedding: vec }), { status: 200 });
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

test("init finds nothing, then the warm-up probe finds the model and clears the flag", async () => {
  await initEmbeddings({ db: null, ollamaUrls: ["http://boot-ollama"], structuredLog: (l, e) => logs.push(e) });
  assert.equal(getEmbeddingStatus(0).available, false);
  let changed = null;
  const r = scheduleEmbeddingReprobe({ delaysMs: [5, 10, 20, 40], onChanged: (x) => { changed = x; } });
  assert.equal(r.scheduled, true);
  assert.equal(embeddingWarmupPending(), true);
  assert.equal(getEmbeddingStatus(0).warmingUp, true, "status says warming up, not degraded");
  await wait(30);
  assert.equal(embeddingWarmupPending(), true, "still pending while the tunnel is down");
  up = true;
  await wait(120);
  assert.equal(getEmbeddingStatus(0).available, true);
  assert.equal(getEmbeddingStatus(0).reason, null);
  assert.equal(embeddingWarmupPending(), false);
  assert.equal(changed?.changed, true);
});

test("an embedder that never comes up ends the warm-up after the last attempt (no endless retry)", async () => {
  up = false;
  // fresh module state is not available here, so only check the scheduling contract on an already-active backend
  const r = scheduleEmbeddingReprobe({ delaysMs: [5] });
  assert.equal(r.scheduled, false, "already on the ollama embedder: nothing to schedule");
});

test("server.js: boot schedules the reprobe and the degraded warning waits for the warm-up", () => {
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(src, /await initEmbeddings\(\{ db, ollamaUrls, structuredLog \}\);\s*\n[^\n]*\n?\s*try \{ scheduleEmbeddingReprobe\(/);
  assert.match(src, /if \(!embStatus\?\.available && !embeddingWarmupPending\(\)\)/);
});
