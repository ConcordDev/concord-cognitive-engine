// server/tests/dtu-bridge-wiring.test.js
//
// Wiring slice: the bridge service the server actually runs. Slices
// 0–5 shipped the bridge as a library with no caller (nothing in the
// server referenced it); these tests pin the caller:
//
//   PAYLOAD — packs carry content-layer projections, never whole live
//     records: relations / lineage / meta / authority / timestamps
//     are excluded by construction, so a relations-only change does
//     NOT move the version hash, while a substantive change does
//     (the wiring forward note on #1764, B5).
//   CAPTURE — a sweep enqueues each changed DTU once; re-sweeping an
//     unchanged corpus enqueues nothing (idempotent capture).
//   CHAIN   — a substantive edit enqueues a new version whose
//     parentHash is the previous version's hash.
//   DELIVER — drain applies through the conflict rule into the
//     target; the outbox reports the row delivered, and the target's
//     chain holds root → head.
//   SQLITE  — the production composition (SQLite outbox + SQLite
//     target) runs the same lifecycle against a real database
//     (skipped where better-sqlite3 is unavailable, per house
//     pattern — it runs on the Mac/production runtime).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryBridgeService,
  createSqliteBridgeService,
  dtuContentPayload,
} from "../lib/dtu-bridge/service.js";
import { computeContentHash } from "../lib/dtu-bridge/provenance.js";

function liveDtu(overrides = {}) {
  return {
    id: "dtu-wiring-1",
    title: "Wiring test DTU",
    tier: "regular",
    tags: ["bridge"],
    human: { summary: "a human layer" },
    core: { facts: [1, 2, 3] },
    machine: { kind: "note" },
    content: "the body",
    source: "test",
    // Bookkeeping a whole-record pack would wrongly carry:
    relations: [{ to: "dtu-other", kind: "cites" }],
    lineage: { parents: ["dtu-parent"] },
    meta: { userId: "user-1" },
    authority: { level: 1 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("payload: content-layer projection excludes relations/lineage/meta/authority/timestamps", () => {
  const p = dtuContentPayload(liveDtu());
  for (const k of ["relations", "lineage", "meta", "authority", "createdAt", "updatedAt"]) {
    assert.equal(k in p, false, `payload must not carry ${k}`);
  }
  assert.equal(p.title, "Wiring test DTU");
  assert.deepEqual(p.core, { facts: [1, 2, 3] });
  assert.equal(p.body, "the body");
});

test("payload: a relations-only change does not move the hash; a substantive change does", () => {
  const base = computeContentHash(dtuContentPayload(liveDtu()));
  const relOnly = computeContentHash(
    dtuContentPayload(liveDtu({ relations: [{ to: "dtu-x", kind: "derived" }], updatedAt: "2027-01-01T00:00:00.000Z" }))
  );
  assert.equal(relOnly, base);
  const edited = computeContentHash(dtuContentPayload(liveDtu({ title: "Edited title" })));
  assert.notEqual(edited, base);
});

test("capture + deliver (memory): sweep enqueues once, re-sweep dedupes, drain applies", () => {
  const svc = createMemoryBridgeService();
  const dtu = liveDtu();
  const first = svc.sweep([dtu]);
  assert.deepEqual(first, { scanned: 1, enqueued: 1, deduped: 0, skipped: 0, cursor: 0 });
  const second = svc.sweep([dtu]);
  assert.equal(second.enqueued, 0);
  assert.equal(svc.stats().outbox.pending, 1);

  const drained = svc.drain();
  assert.equal(drained.applied, 1);
  assert.equal(svc.stats().outbox.delivered, 1);
  assert.equal(svc.stats().chains, 1);
  const chain = svc.target.getChain("dtus", dtu.id);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].provenance.parentHash, null);
  assert.equal(chain[0].payload.title, "Wiring test DTU");
});

test("chain: a substantive edit enqueues a child version; drain extends the chain root → head", () => {
  const svc = createMemoryBridgeService();
  const v1 = liveDtu();
  svc.sweep([v1]);
  svc.drain();
  const head1 = svc.target.getChain("dtus", v1.id)[0].provenance.contentHash;

  const v2 = liveDtu({ core: { facts: [1, 2, 3, 4] } });
  const swept = svc.sweep([v2]);
  assert.equal(swept.enqueued, 1);
  svc.drain();

  const chain = svc.target.getChain("dtus", v1.id);
  assert.equal(chain.length, 2);
  assert.equal(chain[1].provenance.parentHash, head1);
  assert.equal(chain[1].payload.core.facts.length, 4);
  // And a relations-only edit after that enqueues nothing new.
  const relOnly = svc.sweep([liveDtu({ core: { facts: [1, 2, 3, 4] }, relations: [] })]);
  assert.equal(relOnly.enqueued, 0);
});

test("capture: DTUs without a usable id are skipped, never packed", () => {
  const svc = createMemoryBridgeService();
  const r = svc.sweep([{ title: "no id" }, { id: "" }, null, liveDtu({ id: "dtu-ok" })]);
  assert.equal(r.skipped, 3);
  assert.equal(r.enqueued, 1);
});

test("capture: a rotating cursor reaches every DTU past the per-sweep limit", () => {
  const svc = createMemoryBridgeService();
  const dtus = Array.from({ length: 450 }, (_, i) => liveDtu({ id: `dtu-rot-${i}`, title: `T${i}` }));
  const totals = [];
  for (let k = 0; k < 3; k++) totals.push(svc.sweep(dtus, { limit: 200 }));
  assert.deepEqual(totals.map((c) => c.enqueued), [200, 200, 50]);
  assert.deepEqual(totals.map((c) => c.scanned), [200, 200, 200]);
  // The third sweep wraps: 50 new DTUs, then 150 already-captured ones dedupe.
  assert.equal(totals[2].deduped, 150);
  assert.equal(totals[2].cursor, 600 % 450);
  assert.equal(svc.stats().cursor, 150);
  // Every id is in the outbox exactly once.
  assert.equal(svc.stats().outbox.pending, 450);
  // A fourth sweep finds nothing new.
  const fourth = svc.sweep(dtus, { limit: 200 });
  assert.equal(fourth.enqueued, 0);
  assert.equal(fourth.deduped, 200);
});

test("capture: cursor survives a shrinking corpus and an empty one", () => {
  const svc = createMemoryBridgeService();
  const big = Array.from({ length: 10 }, (_, i) => liveDtu({ id: `dtu-s-${i}` }));
  svc.sweep(big, { limit: 8 });
  assert.equal(svc.stats().cursor, 8);
  const small = big.slice(0, 3);
  const c = svc.sweep(small, { limit: 8 });
  assert.equal(c.scanned, 3);
  assert.equal(svc.sweep([], {}).scanned, 0);
  assert.equal(svc.stats().cursor, 0);
});

test("sqlite composition: full lifecycle against a real database", async (t) => {
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    t.skip("better-sqlite3 not installed in this environment — run on the Mac/production runtime");
    return;
  }
  const db = new Database(":memory:");
  const svc = createSqliteBridgeService({ db, sourceNode: "test-node" });
  const dtu = liveDtu({ id: "dtu-sqlite-1" });
  assert.equal(svc.sweep([dtu]).enqueued, 1);
  assert.equal(svc.drain().applied, 1);
  const rows = db.prepare("SELECT * FROM dtu_bridge_records WHERE dtu_id = ?").all("dtu-sqlite-1");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].payload_json).title, "Wiring test DTU");
  const outboxRow = db.prepare("SELECT status FROM dtu_bridge_outbox").get();
  assert.equal(outboxRow.status, "delivered");
  assert.deepEqual(svc.stats().chains, 1);
  db.close();
});
