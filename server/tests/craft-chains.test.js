/**
 * Tier-2 contract tests for Concordia Phase 11 — craft-chains.
 *
 * Pins:
 *   - registerChain validates step kinds + non-negative duration
 *   - startChain creates an active player_craft_jobs row at step 0
 *   - advanceStep refuses when duration not yet elapsed
 *   - advanceStep advances when duration elapsed
 *   - advanceStep finishes the chain on last step
 *   - season_gate blocks advance + sets status='blocked_by_season'
 *   - abandonJob transitions active → abandoned
 *
 * Run: node --test tests/craft-chains.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  registerChain,
  listChains,
  startChain,
  advanceStep,
  listJobsForUser,
  abandonJob,
} from "../lib/craft-chains.js";
import { up as up180 } from "../migrations/180_multi_step_crafts.js";

function setupDb() {
  const db = new Database(":memory:");
  up180(db);
  return db;
}

const TWO_STEP = {
  id: "test_chain",
  name: "Test Chain",
  output_item: "test_item",
  steps: [
    { kind: "gather",  name: "step1", duration_s: 60 },
    { kind: "finish",  name: "step2", duration_s: 30 },
  ],
};

describe("Phase 11 / craft-chains — registerChain", () => {
  it("inserts and is listable", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const list = listChains(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "test_chain");
    assert.equal(list[0].steps.length, 2);
  });

  it("rejects bad step kind", () => {
    const db = setupDb();
    const r = registerChain(db, {
      id: "x", name: "x", output_item: "x",
      steps: [{ kind: "incinerate", duration_s: 100 }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_step_kind");
  });

  it("rejects negative duration", () => {
    const db = setupDb();
    const r = registerChain(db, {
      id: "x", name: "x", output_item: "x",
      steps: [{ kind: "gather", duration_s: -1 }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_duration");
  });

  it("rejects empty steps", () => {
    const db = setupDb();
    const r = registerChain(db, { id: "x", name: "x", output_item: "x", steps: [] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_steps");
  });

  it("upserts on id", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    registerChain(db, { ...TWO_STEP, name: "Updated" });
    const list = listChains(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Updated");
  });
});

describe("Phase 11 / craft-chains — startChain + advanceStep", () => {
  it("creates active job at step 0", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const r = startChain(db, "user_1", "concordia-hub", "test_chain");
    assert.equal(r.ok, true);
    assert.ok(r.jobId);
    const jobs = listJobsForUser(db, "user_1");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].current_step, 0);
    assert.equal(jobs[0].status, "active");
  });

  it("rejects unknown chain", () => {
    const db = setupDb();
    const r = startChain(db, "user_1", "concordia-hub", "ghost_chain");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "chain_not_found");
  });

  it("refuses advance when duration not elapsed", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const start = startChain(db, "user_1", "concordia-hub", "test_chain");
    const r = advanceStep(db, "user_1", start.jobId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yet");
  });

  it("advances when duration elapsed", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const start = startChain(db, "user_1", "concordia-hub", "test_chain");
    // Backdate step_started_at by 70s.
    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 70 WHERE id = ?`).run(start.jobId);
    const r = advanceStep(db, "user_1", start.jobId);
    assert.equal(r.advanced, true);
    assert.equal(r.nextStep, 1);
  });

  it("finishes the chain on last step", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const start = startChain(db, "user_1", "concordia-hub", "test_chain");
    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 70, current_step = 1 WHERE id = ?`).run(start.jobId);
    // 30s duration for step 2; back-date 40 → eligible.
    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 40 WHERE id = ?`).run(start.jobId);
    const r = advanceStep(db, "user_1", start.jobId);
    assert.equal(r.finished, true);
    assert.equal(r.output, "test_item");
  });
});

describe("Phase 11 / craft-chains — season gates", () => {
  it("blocks advance when season mismatched + sets blocked_by_season", () => {
    const db = setupDb();
    registerChain(db, {
      id: "seasonal",
      name: "Seasonal",
      output_item: "harvest",
      steps: [
        { kind: "gather", name: "plant", duration_s: 0, season_gate: "prail" },
      ],
    });
    const start = startChain(db, "user_1", "concordia-hub", "seasonal");
    const r = advanceStep(db, "user_1", start.jobId, { currentSeason: "wound" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "blocked_by_season");
    const job = listJobsForUser(db, "user_1")[0];
    assert.equal(job.status, "blocked_by_season");
  });

  it("advances when season matches", () => {
    const db = setupDb();
    registerChain(db, {
      id: "seasonal2",
      name: "Seasonal2",
      output_item: "harvest",
      steps: [
        { kind: "gather", name: "plant", duration_s: 0, season_gate: "prail" },
      ],
    });
    const start = startChain(db, "user_1", "concordia-hub", "seasonal2");
    const r = advanceStep(db, "user_1", start.jobId, { currentSeason: "prail" });
    assert.equal(r.finished, true);
  });
});

describe("Phase 11 / craft-chains — abandonJob", () => {
  it("transitions active → abandoned", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const start = startChain(db, "user_1", "concordia-hub", "test_chain");
    const r = abandonJob(db, "user_1", start.jobId);
    assert.equal(r.action, "abandoned");
    const job = listJobsForUser(db, "user_1")[0];
    assert.equal(job.status, "abandoned");
  });

  it("refuses to abandon non-active job", () => {
    const db = setupDb();
    registerChain(db, TWO_STEP);
    const start = startChain(db, "user_1", "concordia-hub", "test_chain");
    abandonJob(db, "user_1", start.jobId);
    const r = abandonJob(db, "user_1", start.jobId);
    assert.equal(r.ok, false);
  });
});
