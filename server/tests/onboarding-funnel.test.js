// FTUE3 — the first-10-minutes funnel instrument. Pins: first-reach recording
// with elapsed time, idempotency per (user,step), time-to-step, and the report's
// reach + median + drop-off (the number the cold-open tightening is measured
// against).
//
// Run: node --test tests/onboarding-funnel.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { recordFunnelStep, funnelReport, timeToStep, FUNNEL_STEPS } from "../lib/onboarding-funnel.js";

describe("onboarding funnel", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("records elapsed ms from the user's first funnel event", () => {
    const t0 = 1_000_000;
    recordFunnelStep(db, "u1", "account_created", { nowMs: t0 });
    recordFunnelStep(db, "u1", "first_action", { nowMs: t0 + 45_000 }); // 45s
    recordFunnelStep(db, "u1", "first_win", { nowMs: t0 + 150_000 });   // 2.5min
    assert.equal(timeToStep(db, "u1", "account_created"), 0);
    assert.equal(timeToStep(db, "u1", "first_action"), 45_000);
    assert.equal(timeToStep(db, "u1", "first_win"), 150_000);
  });

  it("is idempotent per (user, step) — funnel = first reach", () => {
    recordFunnelStep(db, "u1", "first_action", { nowMs: 1000 });
    const dup = recordFunnelStep(db, "u1", "first_action", { nowMs: 9999 });
    assert.equal(dup.duplicate, true);
    assert.equal(timeToStep(db, "u1", "first_action"), 0); // unchanged
  });

  it("report gives reach + median time-to-step + drop-off, spine-ordered", () => {
    const t = 1_000_000;
    // 3 users reach first_action; only 1 reaches first_win (drop-off 2)
    for (const u of ["a", "b", "c"]) {
      recordFunnelStep(db, u, "account_created", { nowMs: t });
      recordFunnelStep(db, u, "first_action", { nowMs: t + 30_000 });
    }
    recordFunnelStep(db, "a", "first_win", { nowMs: t + 120_000 });

    const rep = funnelReport(db);
    assert.equal(rep.totalUsers, 3);
    const fa = rep.steps.find((s) => s.step === "first_action");
    assert.equal(fa.reach, 3);
    assert.equal(fa.medianMs, 30_000);
    // steps come back in the canonical spine order
    assert.deepEqual(rep.steps.map((s) => s.step), ["account_created", "first_action", "first_win"]);
    // drop-off first_action → first_win = 3 - 1 = 2 (the stall the research warns about)
    const d = rep.dropOff.find((x) => x.from === "first_action" && x.to === "first_win");
    assert.equal(d.lost, 2);
  });

  it("orders custom steps after the canonical spine", () => {
    recordFunnelStep(db, "u", "account_created", { nowMs: 0 });
    recordFunnelStep(db, "u", "opened_crafting", { nowMs: 5000 });
    const rep = funnelReport(db);
    assert.equal(rep.steps[0].step, "account_created");
    assert.ok(rep.steps.some((s) => s.step === "opened_crafting"));
  });

  it("FUNNEL_STEPS has the early-beat spine", () => {
    assert.ok(FUNNEL_STEPS.includes("first_action"));
    assert.ok(FUNNEL_STEPS.includes("first_win"));
  });
});
