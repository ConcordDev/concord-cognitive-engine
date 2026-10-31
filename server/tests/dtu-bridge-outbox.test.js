// server/tests/dtu-bridge-outbox.test.js
//
// Slice 2 (DTU bridge): the bridge outbox. Pins: durable queueing of a
// pack's records, idempotency (the same change enqueued twice is
// delivered once), the claim → ack lifecycle, honest failure handling
// (backoff, then abandonment at the attempt cap — never a fake
// "delivered"), and refusal to queue an invalid pack. The SQLite store
// is exercised for real wherever better-sqlite3 is available (the
// production runtime and the Mac); where it is not installed the test
// reports itself skipped rather than pretending to have run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeProvenance } from "../lib/dtu-bridge/provenance.js";
import { buildPack } from "../lib/dtu-bridge/pack-envelope.js";
import { createMemoryStore, createOutbox, createSqliteStore, outboxKeyFor } from "../lib/dtu-bridge/outbox.js";

let clock = 1_000_000;
const nowFn = () => clock;

function rec(id, content, parentHash = null) {
  const payload = { id, tier: "canonical", scope: "public", content, createdAt: "2026-10-28T00:00:00.000Z" };
  return { table: "dtus", id, payload, provenance: makeProvenance(payload, parentHash) };
}
function packOf(...records) {
  return buildPack({ sourceNode: "node-a", records });
}

test("enqueue records every pending change in a pack, durably keyed", () => {
  const outbox = createOutbox(createMemoryStore(), { now: nowFn });
  const a = rec("dtu-1", "alpha");
  const b = rec("dtu-1", "beta", a.provenance.contentHash);
  const res = outbox.enqueuePack(packOf(a, b));
  assert.equal(res.ok, true);
  assert.equal(res.enqueued, 2);
  assert.equal(res.deduped, 0);
  assert.deepEqual(outbox.stats(), { pending: 2, in_flight: 0, failed: 0, delivered: 0, abandoned: 0 });
});

test("the same change enqueued twice is delivered once (idempotent)", () => {
  const store = createMemoryStore();
  const outbox = createOutbox(store, { now: nowFn });
  const a = rec("dtu-1", "alpha");
  const pack = packOf(a);
  assert.equal(outbox.enqueuePack(pack).enqueued, 1);
  const again = outbox.enqueuePack(pack);
  assert.equal(again.enqueued, 0);
  assert.equal(again.deduped, 1);
  assert.equal(store.all().length, 1);
  // A NEW version of the same DTU is a different change and does queue.
  const b = rec("dtu-1", "beta", a.provenance.contentHash);
  assert.equal(outbox.enqueuePack(packOf(b)).enqueued, 1);
  assert.equal(store.all().length, 2);
});

test("an invalid pack queues nothing", () => {
  const outbox = createOutbox(createMemoryStore(), { now: nowFn });
  const pack = packOf(rec("dtu-1", "alpha"));
  const tampered = JSON.parse(JSON.stringify(pack));
  tampered.records[0].payload.content = "FORGED";
  const res = outbox.enqueuePack(tampered);
  assert.equal(res.ok, false);
  assert.equal(outbox.stats().pending, 0);
});

test("claim → ack moves a row to delivered exactly once", () => {
  const outbox = createOutbox(createMemoryStore(), { now: nowFn });
  const a = rec("dtu-1", "alpha");
  outbox.enqueuePack(packOf(a));
  const claimed = outbox.claim(10);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].key, outboxKeyFor(a));
  assert.equal(outbox.claim(10).length, 0); // in-flight rows are not re-claimed
  assert.equal(outbox.ack(outboxKeyFor(a)), true);
  assert.equal(outbox.stats().delivered, 1);
});

test("failures back off, then abandon at the cap — never fake-delivered", () => {
  const store = createMemoryStore();
  const outbox = createOutbox(store, { now: nowFn, maxAttempts: 3, backoffS: [60, 300, 900] });
  const a = rec("dtu-1", "alpha");
  const key = outboxKeyFor(a);
  outbox.enqueuePack(packOf(a));

  outbox.claim(1);
  outbox.fail(key, "peer unreachable");
  let row = store.get(key);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.equal(outbox.claim(1).length, 0); // backoff window has not elapsed
  clock += 61_000;
  assert.equal(outbox.claim(1).length, 1); // due again after backoff

  outbox.fail(key, "peer unreachable");
  clock += 301_000;
  outbox.claim(1);
  outbox.fail(key, "peer unreachable");
  row = store.get(key);
  assert.equal(row.status, "abandoned");
  assert.equal(row.attempts, 3);
  assert.equal(outbox.stats().delivered, 0);
});

test("sqlite store: schema and column wiring match the state machine", () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/dtu-bridge/outbox.js"),
    "utf8"
  );
  assert.match(src, /CREATE TABLE IF NOT EXISTS dtu_bridge_outbox/);
  for (const col of ["key TEXT PRIMARY KEY", "pack_json", "status", "attempts", "next_due_at", "created_at"]) {
    assert.ok(src.includes(col), `outbox schema is missing ${col}`);
  }
});

test("sqlite store: full lifecycle against a real database", async (t) => {
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    t.skip("better-sqlite3 not installed in this environment — run on the Mac/production runtime");
    return;
  }
  const db = new Database(":memory:");
  const outbox = createOutbox(createSqliteStore(db), { now: nowFn });
  const a = rec("dtu-1", "alpha");
  assert.equal(outbox.enqueuePack(packOf(a)).enqueued, 1);
  assert.equal(outbox.enqueuePack(packOf(a)).deduped, 1);
  const claimed = outbox.claim(5);
  assert.equal(claimed.length, 1);
  outbox.ack(outboxKeyFor(a));
  assert.equal(outbox.stats().delivered, 1);
  db.close();
});
