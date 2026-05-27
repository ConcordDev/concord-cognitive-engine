// server/tests/wave-a-consequence-scheduler.test.js
//
// Wave A / A1 — pins the scheduled-consequence ledger contract:
//   - schedule() writes a row with a future fires_at
//   - due() returns only unfired rows whose fires_at <= now
//   - markFired() flips fired_at + writes result
//   - listForTarget / listForSource index correctly
//   - cancel() short-circuits a pending row
//   - dispatcher cycle drains, marks unhandled kinds, never throws
//   - kill switch disables

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  schedule, due, markFired, listForTarget, listForSource, cancel, _internal,
} from "../lib/scheduled-consequences.js";
import { runConsequenceDispatcherCycle } from "../emergent/consequence-dispatcher-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE scheduled_consequences (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL,
      fires_at      INTEGER NOT NULL,
      source_kind   TEXT,
      source_id     TEXT,
      target_kind   TEXT,
      target_id     TEXT,
      world_id      TEXT,
      payload_json  TEXT,
      fired_at      INTEGER,
      fire_result   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

after(() => { db?.close(); });

describe("schedule / due / markFired", () => {
  it("schedule writes a row in the future", () => {
    const r = schedule(db, { kind: "royal_kill_radicalize", fireInS: 60, payload: { reason: "queen-slain" } });
    assert.equal(r.ok, true);
    assert.ok(r.id);
    assert.ok(r.firesAt > Math.floor(Date.now() / 1000));
  });

  it("rejects invalid input", () => {
    assert.equal(schedule(db, {}).ok, false);
    assert.equal(schedule(db, { kind: "x" }).ok, false);
    assert.equal(schedule(db, { kind: "x", fireInS: -1 }).ok, false);
    assert.equal(schedule(db, { kind: "x", fireInS: _internal.MAX_HORIZON_S + 1 }).ok, false);
  });

  it("due returns only past-fires rows", () => {
    schedule(db, { kind: "x", fireInS: 0 });             // due immediately
    schedule(db, { kind: "x", fireInS: 24 * 3600 });     // far future
    const rows = due(db);
    // We scheduled multiple in this suite; pick the immediate-fire ones.
    const immediate = rows.filter((r) => r.kind === "x");
    assert.ok(immediate.length >= 1, "at least one immediate-due row");
    for (const r of rows) {
      assert.ok(r.firesAt <= Math.floor(Date.now() / 1000) + 1, "all due rows are past-now");
      assert.equal(r.firedAt, null, "unfired only");
    }
  });

  it("markFired flips fired_at + stores result", () => {
    const r = schedule(db, { kind: "y", fireInS: 0 });
    const m = markFired(db, r.id, { handled: true });
    assert.equal(m.ok, true);
    assert.equal(m.updated, 1);
    // Second markFired no-ops because the row is already fired.
    const m2 = markFired(db, r.id, { handled: true });
    assert.equal(m2.updated, 0);
  });
});

describe("listForTarget / listForSource", () => {
  it("filters by target", () => {
    schedule(db, { kind: "k1", fireInS: 0, target: { kind: "user", id: "U1" } });
    schedule(db, { kind: "k2", fireInS: 0, target: { kind: "user", id: "U1" } });
    schedule(db, { kind: "k3", fireInS: 0, target: { kind: "user", id: "U2" } });
    const u1 = listForTarget(db, "user", "U1");
    const u2 = listForTarget(db, "user", "U2");
    assert.ok(u1.length >= 2);
    assert.ok(u2.length >= 1);
    assert.ok(u1.every((r) => r.target.id === "U1"));
  });

  it("filters by source", () => {
    schedule(db, { kind: "src1", fireInS: 0, source: { kind: "npc_death", id: "npc_q" } });
    schedule(db, { kind: "src2", fireInS: 0, source: { kind: "npc_death", id: "npc_q" } });
    const rows = listForSource(db, "npc_death", "npc_q");
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.source.id === "npc_q"));
  });
});

describe("cancel", () => {
  it("cancels pending consequences", () => {
    const r = schedule(db, { kind: "scheme:reveal", fireInS: 3600 });
    const c = cancel(db, r.id, "player_completed_redemption");
    assert.equal(c.ok, true);
    assert.equal(c.cancelled, true);
    // Now fired_at is set; should not appear in due().
    const dueRows = due(db);
    assert.ok(!dueRows.some((row) => row.id === r.id));
  });

  it("no-op on already-fired rows", () => {
    const r = schedule(db, { kind: "z", fireInS: 0 });
    markFired(db, r.id);
    const c = cancel(db, r.id);
    assert.equal(c.cancelled, false);
  });
});

describe("dispatcher cycle", () => {
  it("drains due rows + marks unhandled kinds without throwing", async () => {
    // All handlers ship in later waves, so EVERYTHING is currently
    // unhandled. The dispatcher must mark them fired with
    // {unhandled:true} rather than retrying forever.
    schedule(db, { kind: "scheme:reveal", fireInS: 0, target: { kind: "world", id: "w1" } });
    schedule(db, { kind: "royal_kill_attack", fireInS: 0 });
    const r = await runConsequenceDispatcherCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.evaluated >= 2);
    assert.ok(r.unhandled >= 2, `${r.unhandled} unhandled (handlers ship later)`);
  });

  it("respects kill switch", async () => {
    const prev = process.env.CONCORD_CONSEQUENCE_DISPATCHER;
    process.env.CONCORD_CONSEQUENCE_DISPATCHER = "0";
    try {
      const r = await runConsequenceDispatcherCycle({ db });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev == null) delete process.env.CONCORD_CONSEQUENCE_DISPATCHER;
      else process.env.CONCORD_CONSEQUENCE_DISPATCHER = prev;
    }
  });

  it("returns empty-cycle gracefully when no rows due", async () => {
    // Wait — all prior rows are fired. Schedule one far-future.
    schedule(db, { kind: "far_future", fireInS: 3600 });
    const r = await runConsequenceDispatcherCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.drained, 0);
  });
});
