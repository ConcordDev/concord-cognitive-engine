// WAVE JOBS — career heartbeat (delegate-fidelity SIM pay loop). Pins that an
// active contract pays the worker per pay-period in sparks, is idempotent within
// a period (no double-pay on re-run), and no-ops when the kill-switch is off.
//
// Run: node --test tests/career-cycle.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { getSparks } from "../lib/sparks-service.js";
import { runCareerCycle } from "../emergent/career-cycle.js";

function activeContract(db, { tier = 5 } = {}) {
  const id = `ctr_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO career_contracts
    (id, world_id, employer_kind, employer_id, worker_kind, worker_id, track_id, tier, base_wage_sparks, status, last_offer_by)
    VALUES (?, 'w', 'npc','emp', 'npc','wkr', 'chef', ?, 20, 'active', 'npc:emp')`).run(id, tier);
  return id;
}

describe("career-cycle pay loop", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare("INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('emp','w',1000)").run();
    db.prepare("INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('wkr','w',0)").run();
  });
  afterEach(() => { delete process.env.CONCORD_LIVING_CAREER; try { db.close(); } catch { /* noop */ } });

  it("no-ops when the kill-switch is off (=0)", async () => {
    process.env.CONCORD_LIVING_CAREER = "0";
    activeContract(db);
    const r = await runCareerCycle({ db });
    assert.equal(r.reason, "disabled");
    assert.equal(getSparks(db, "npc", "wkr"), 0);
  });

  it("pays an active contract worker in sparks when enabled", async () => {
    process.env.CONCORD_LIVING_CAREER = "1";
    activeContract(db);
    const r = await runCareerCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.paid, 1);
    const wkr = getSparks(db, "npc", "wkr");
    assert.ok(wkr > 0, `worker paid ${wkr}`);
    assert.equal(getSparks(db, "npc", "emp"), 1000 - wkr); // employer paid exactly that
  });

  it("is idempotent within a pay-period (re-run doesn't double-pay)", async () => {
    process.env.CONCORD_LIVING_CAREER = "1";
    activeContract(db);
    await runCareerCycle({ db });
    const afterFirst = getSparks(db, "npc", "wkr");
    const r2 = await runCareerCycle({ db });   // same real-second → same period
    assert.equal(r2.paid, 0);                  // already paid this period
    assert.equal(getSparks(db, "npc", "wkr"), afterFirst);
  });

  it("only pays ACTIVE contracts (offered/rejected are skipped)", async () => {
    process.env.CONCORD_LIVING_CAREER = "1";
    const id = activeContract(db);
    db.prepare("UPDATE career_contracts SET status='rejected' WHERE id=?").run(id);
    const r = await runCareerCycle({ db });
    assert.equal(r.active, 0);
    assert.equal(getSparks(db, "npc", "wkr"), 0);
  });
});
