// Maintenance — the repair-telemetry operator surface.
//
// Pins: health_log reads the Homeostasis ledger, escalations reads the pending
// repair inbox, resolve_escalation flips status, memory returns stats.
//
// Run: node --test tests/repair-domain.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as migHealth from "../migrations/304_health_check_log.js";
import registerRepairMacros from "../domains/repair.js";

function registry() {
  const m = new Map();
  registerRepairMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}

let db;
beforeEach(() => {
  db = new Database(":memory:");
  migHealth.up(db);
  db.exec(`CREATE TABLE initiatives (
    id TEXT PRIMARY KEY, user_id TEXT, trigger_type TEXT, message TEXT,
    priority TEXT, status TEXT DEFAULT 'pending', created_at TEXT
  )`);
  db.prepare(`INSERT INTO health_check_log (id, pathology, category, disposition, subject_id, detail_json, checked_at)
              VALUES ('h1','stuck_scheduler','liveness','healed','fX','{"overdue_s":200}',100)`).run();
  db.prepare(`INSERT INTO health_check_log (id, pathology, category, disposition, subject_id, detail_json, checked_at)
              VALUES ('h2','negative_balance','economy','escalated','uBad','{"balance":-50}',101)`).run();
  db.prepare(`INSERT INTO initiatives (id, user_id, trigger_type, message, priority, status, created_at)
              VALUES ('i1','operator','system_repair_escalation','negative_balance on uBad','high','pending','2026-01-01')`).run();
  db.prepare(`INSERT INTO initiatives (id, user_id, trigger_type, message, priority, status, created_at)
              VALUES ('i2','operator','check_in','hello','normal','pending','2026-01-01')`).run();
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("repair telemetry domain", () => {
  it("health_log returns the ledger, filterable by disposition", async () => {
    const reg = registry();
    const all = await reg.get("repair.health_log")({ db }, {});
    assert.equal(all.entries.length, 2);
    assert.equal(all.entries[0].detail.balance ?? all.entries[1].detail.balance, -50);
    const healed = await reg.get("repair.health_log")({ db }, { disposition: "healed" });
    assert.equal(healed.entries.length, 1);
    assert.equal(healed.entries[0].pathology, "stuck_scheduler");
  });

  it("escalations returns ONLY pending repair escalations (not other initiatives)", async () => {
    const reg = registry();
    const out = await reg.get("repair.escalations")({ db }, {});
    assert.equal(out.escalations.length, 1);
    assert.equal(out.escalations[0].id, "i1");
  });

  it("resolve_escalation flips status (approve→acted, dismiss→dismissed)", async () => {
    const reg = registry();
    const out = await reg.get("repair.resolve_escalation")({ db, actor: { userId: "op" } }, { id: "i1", resolution: "dismissed" });
    assert.equal(out.ok, true);
    assert.equal(db.prepare(`SELECT status FROM initiatives WHERE id='i1'`).get().status, "dismissed");
    // a non-existent / non-repair initiative doesn't flip
    const bad = await reg.get("repair.resolve_escalation")({ db, actor: { userId: "op" } }, { id: "i2" });
    assert.equal(bad.ok, false);
  });

  it("memory returns repair-memory stats", async () => {
    const reg = registry();
    const out = await reg.get("repair.memory")({ db }, {});
    assert.equal(out.ok, true);
    assert.equal(typeof out.stats.totalPatterns, "number");
  });
});
