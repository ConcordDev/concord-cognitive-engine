/**
 * Tier-2 contract tests for Concordia Phase 10 — Tunyan jobs + rations.
 *
 * Pins:
 *   - 7 jobs seeded with correct names (fisherman, vendor, captain,
 *     miner, clerk, midwife, alchemist)
 *   - 5 ration entitlements (unemployed=25, pregnant=100, child=40,
 *     elderly=50, employed_baseline=0)
 *   - applyForJob switches demographic to employed_baseline
 *   - completeShift requires employment + cooldown + wage payment
 *   - resign clears job + sets demographic to unemployed
 *   - mintRationsForEligible mints once per 30 days
 *   - setDemographicKind validates against entitlement table
 *
 * Run: node --test tests/tunyan-jobs.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  listOpenJobs,
  applyForJob,
  resign,
  completeShift,
  getMyEmployment,
  setDemographicKind,
  mintRationsForEligible,
  listRationEntitlements,
} from "../lib/tunyan-jobs.js";
import { up as up179 } from "../migrations/179_tunyan_jobs.js";

function setupDb() {
  const db = new Database(":memory:");
  up179(db);
  return db;
}

describe("Phase 10 / tunyan-jobs — catalog", () => {
  it("seeds 7 named jobs", () => {
    const db = setupDb();
    const jobs = listOpenJobs(db);
    assert.equal(jobs.length, 7);
    const ids = jobs.map(j => j.id);
    for (const required of ["job_fisherman", "job_vendor", "job_captain", "job_miner", "job_clerk", "job_midwife", "job_alchemist"]) {
      assert.ok(ids.includes(required), `missing ${required}`);
    }
  });

  it("seeds 5 ration entitlements", () => {
    const db = setupDb();
    const r = listRationEntitlements(db);
    assert.equal(r.length, 5);
    const m = Object.fromEntries(r.map(x => [x.demographic_kind, x.monthly_sparks]));
    assert.equal(m.unemployed, 25);
    assert.equal(m.pregnant, 100);
    assert.equal(m.child, 40);
    assert.equal(m.elderly, 50);
    assert.equal(m.employed_baseline, 0);
  });
});

describe("Phase 10 / tunyan-jobs — applyForJob", () => {
  it("upserts employment with demographic_kind=employed_baseline", async () => {
    const db = setupDb();
    const r = applyForJob(db, "user_1", "concordia-hub", "job_fisherman");
    assert.equal(r.action, "hired");
    const emp = getMyEmployment(db, "user_1");
    assert.equal(emp.job_id, "job_fisherman");
    assert.equal(emp.demographic_kind, "employed_baseline");
  });

  it("rejects unknown job", () => {
    const db = setupDb();
    const r = applyForJob(db, "user_1", "concordia-hub", "job_astronaut");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "job_not_found");
  });
});

describe("Phase 10 / tunyan-jobs — completeShift", () => {
  it("requires employment", async () => {
    const db = setupDb();
    const r = await completeShift(db, "user_1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_employed");
  });

  it("pays the wage and bumps counter", async () => {
    const db = setupDb();
    applyForJob(db, "user_1", "concordia-hub", "job_fisherman");
    const r = await completeShift(db, "user_1");
    assert.equal(r.action, "shift_paid");
    assert.equal(r.paid_sparks, 18); // seeded fisherman wage
    assert.equal(r.shifts_completed, 1);
  });

  it("enforces cooldown", async () => {
    const db = setupDb();
    applyForJob(db, "user_1", "concordia-hub", "job_fisherman");
    await completeShift(db, "user_1");
    const second = await completeShift(db, "user_1");
    assert.equal(second.ok, false);
    assert.equal(second.reason, "shift_cooldown");
  });
});

describe("Phase 10 / tunyan-jobs — resign", () => {
  it("clears job + sets unemployed", () => {
    const db = setupDb();
    applyForJob(db, "user_1", "concordia-hub", "job_fisherman");
    resign(db, "user_1", "concordia-hub");
    const emp = getMyEmployment(db, "user_1");
    assert.equal(emp.job_id, null);
    assert.equal(emp.demographic_kind, "unemployed");
  });
});

describe("Phase 10 / tunyan-jobs — setDemographicKind", () => {
  it("rejects unknown demographic", () => {
    const db = setupDb();
    const r = setDemographicKind(db, "user_1", "concordia-hub", "alien");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_demographic");
  });

  it("upserts known demographic", () => {
    const db = setupDb();
    setDemographicKind(db, "user_1", "concordia-hub", "pregnant");
    const emp = getMyEmployment(db, "user_1");
    assert.equal(emp.demographic_kind, "pregnant");
  });
});

describe("Phase 10 / tunyan-jobs — mintRationsForEligible", () => {
  it("mints exactly once per eligible user", async () => {
    const db = setupDb();
    setDemographicKind(db, "user_unemployed", "concordia-hub", "unemployed");
    setDemographicKind(db, "user_pregnant", "concordia-hub", "pregnant");
    setDemographicKind(db, "user_employed", "concordia-hub", "employed_baseline");
    let mintCalls = 0;
    const mintFn = async () => { mintCalls++; return { ok: true }; };
    const r1 = await mintRationsForEligible(db, { mintFn });
    assert.equal(r1.minted, 2);  // employed_baseline has 0 sparks → skipped at query
    assert.equal(mintCalls, 2);
    // Re-run within 30 days — should skip all.
    const r2 = await mintRationsForEligible(db, { mintFn });
    assert.equal(r2.minted, 0);
    assert.equal(r2.skipped, 2);
  });
});
