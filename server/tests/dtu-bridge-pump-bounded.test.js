// server/tests/dtu-bridge-pump-bounded.test.js
//
// The dtu-bridge-pump heartbeat runs once a minute for the life of the
// process, so anything it retains must be bounded:
//   HEAD CACHE — the id → head-hash memo is capped (it used to gain one
//     entry per distinct DTU id ever swept); eviction costs a re-read,
//     never a duplicate enqueue.
//   STATUS READ — outbox.stats() counts by status in the store; it must not
//     materialise every outbox row (pack_json included) into the heap.
//   KILL-SWITCH — DTU_BRIDGE_PUMP_DISABLED=1 / DTU_BRIDGE_PUMP=0 skips
//     registering the heartbeat; default unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createDtuBridgeService } from "../lib/dtu-bridge/service.js";
import { createOutbox, createMemoryStore, createSqliteStore } from "../lib/dtu-bridge/outbox.js";
import { createMemoryTarget } from "../lib/dtu-bridge/apply.js";
import { createSqliteTarget } from "../lib/dtu-bridge/sqlite-target.js";

const dtus = (n, tag = "v1") =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i}`, title: `${tag}-${i}`, tier: "regular", tags: ["a"], human: { s: `h${i}` } }));

test("head cache stays at the cap across hundreds of sweep ticks", () => {
  const svc = createDtuBridgeService({ store: createMemoryStore(), target: createMemoryTarget(), headCacheMax: 100 });
  const corpus = dtus(1000);
  for (let t = 0; t < 500; t++) {
    svc.sweep(corpus, { limit: 200 });
    svc.drain(50);
    assert.ok(svc.stats().headCache <= 100, `tick ${t}: headCache ${svc.stats().headCache}`);
  }
  assert.equal(svc.stats().headCache, 100);
});

test("evicting a head never duplicates an outbox row", () => {
  const store = createMemoryStore();
  const svc = createDtuBridgeService({ store, target: createMemoryTarget(), headCacheMax: 10 });
  const corpus = dtus(60);
  for (let t = 0; t < 30; t++) svc.sweep(corpus, { limit: 60 }); // many full passes, cache << corpus
  assert.equal(store.all().length, 60, "one outbox row per distinct version, not per sweep");
});

test("a changed DTU still versions after its head was evicted", () => {
  const svc = createDtuBridgeService({ store: createMemoryStore(), target: createMemoryTarget(), headCacheMax: 5 });
  const corpus = dtus(40);
  for (let i = 0; i < 6; i++) { svc.sweep(corpus, { limit: 40 }); svc.drain(100); }
  corpus[0].title = "edited";
  const r = svc.sweep(corpus, { limit: 40 });
  assert.equal(r.enqueued, 1);
});

test("outbox.stats() counts via the store without reading rows", () => {
  const base = createMemoryStore();
  const store = { ...base, all: () => { throw new Error("stats must not materialise rows"); } };
  const outbox = createOutbox(store);
  const svc = createDtuBridgeService({ store, target: createMemoryTarget() });
  svc.sweep(dtus(7), { limit: 7 });
  assert.deepEqual(outbox.stats(), { pending: 7, in_flight: 0, failed: 0, delivered: 0, abandoned: 0 });
});

test("sqlite: pump ticks keep the head cache bounded and stats exact", async (t) => {
  let Database;
  try { Database = createRequire(import.meta.url)("better-sqlite3"); } catch { return t.skip("better-sqlite3 unavailable"); }
  const db = new Database(":memory:");
  const store = createSqliteStore(db);
  const svc = createDtuBridgeService({ store, target: createSqliteTarget(db), headCacheMax: 50 });
  const corpus = dtus(300);
  for (let k = 0; k < 120; k++) { svc.sweep(corpus, { limit: 200 }); svc.drain(50); }
  const s = svc.stats();
  assert.ok(s.headCache <= 50);
  assert.equal(s.outbox.pending + s.outbox.delivered + s.outbox.failed + s.outbox.abandoned + s.outbox.in_flight, 300);
  assert.equal(s.outbox.delivered, 300);
  assert.equal(s.chains, 300);
  db.close();
});

test("kill-switch: the pump heartbeat is only registered when not disabled", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
  assert.match(src, /const _dtuBridgePumpEnabled = process\.env\.DTU_BRIDGE_PUMP_DISABLED !== "1" && process\.env\.DTU_BRIDGE_PUMP !== "0";/);
  assert.match(src, /if \(_dtuBridgePumpEnabled\) registerHeartbeat\("dtu-bridge-pump"/);
  assert.equal((src.match(/registerHeartbeat\("dtu-bridge-pump"/g) || []).length, 1);
});
