// Wave 4 backlog — craft-chains content-seeding wiring integration test.
//
// docs/concordia-specs/crafting-economy-housing-capability-map.md found the
// 4 authored multi-step craft chains under
// content/world/concordia-hub/recipes/chains.json (Cactem Textile,
// Foodstuffs Annual Cycle, Herbalist Tonic, Forged Blade) were dead content:
// migration 180's own header comment said the seeder was deferred to "Phase
// 14 territory" and nothing ever called server/lib/craft-chains.js's
// registerChain() at boot. The ENGINE itself (registerChain / startChain /
// advanceStep) was already real and fully tested (server/tests/craft-chains.test.js)
// — only the boot-time load from JSON into the craft_chains table was
// missing. This test proves both halves end-to-end against a real (if
// minimal) migrated DB, using the actual content-seeder + the actual engine
// — not a mock of either.
//
// content-seeder caches `_seeded = true` at module level so it can't be
// re-run inside one test process — everything lives in one `before` boot +
// separate `it`s asserting against the same seeded db, matching the pattern
// used by z2-seeders.test.js and world-boss-heartbeat-wire.test.js.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up180 } from "../../migrations/180_multi_step_crafts.js";
import { up as up279 } from "../../migrations/279_craft_chain_inputs.js";
import { startChain, advanceStep, listJobsForUser } from "../../lib/craft-chains.js";

const AUTHORED_CHAIN_IDS = [
  "textile_cactem",
  "annual_foodstuff_cycle",
  "alchemy_herb_tonic",
  "forging_blade",
];

function bootDb() {
  const db = new Database(":memory:");
  up180(db);
  up279(db);
  return db;
}

describe("Wave 4 — craft-chains content seeding", () => {
  let db;
  let seedResult;

  before(async () => {
    db = bootDb();
    const { seedContent } = await import("../../lib/content-seeder.js");
    seedResult = await seedContent({ db });
  });

  it("seedContent() reports ok and a non-zero craftChainsSeeded count", () => {
    assert.equal(seedResult.ok, true);
    assert.ok(
      (seedResult.counts?.craftChainsSeeded || 0) >= AUTHORED_CHAIN_IDS.length,
      `expected >= ${AUTHORED_CHAIN_IDS.length} craftChainsSeeded, got ${seedResult.counts?.craftChainsSeeded}`,
    );
  });

  it("all 4 authored chains from chains.json are real rows in craft_chains", () => {
    const rows = db.prepare(`SELECT id, name, world_id, output_item, author_faction, steps_json FROM craft_chains`).all();
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const id of AUTHORED_CHAIN_IDS) {
      assert.ok(byId.has(id), `expected craft_chains row for authored chain "${id}"`);
    }

    const blade = byId.get("forging_blade");
    assert.equal(blade.world_id, "concordia-hub");
    assert.equal(blade.output_item, "forged_blade");
    assert.equal(blade.author_faction, "iron_warden");
    const bladeSteps = JSON.parse(blade.steps_json);
    assert.equal(bladeSteps.length, 3);
    assert.deepEqual(bladeSteps.map((s) => s.kind), ["gather", "assemble", "finish"]);

    const textile = byId.get("textile_cactem");
    const textileSteps = JSON.parse(textile.steps_json);
    assert.equal(textileSteps.length, 6);
    assert.equal(textile.output_item, "cactem_bolt");
  });

  it("the real engine (startChain + advanceStep) runs a seeded chain to completion end-to-end", () => {
    // Use the shortest authored chain (forging_blade — 3 steps, all
    // duration_s > 0) so we exercise the real duration-gate path, not a
    // zero-duration shortcut. Sanity-check the durations first from the
    // seeded row (they came from JSON, not from us).
    const chainRow = db.prepare(`SELECT steps_json FROM craft_chains WHERE id = 'forging_blade'`).get();
    const steps = JSON.parse(chainRow.steps_json);
    assert.deepEqual(steps.map((s) => s.duration_s), [1800, 3600, 1800]);

    const start = startChain(db, "wave4_test_user", "concordia-hub", "forging_blade");
    assert.equal(start.ok, true, `startChain failed: ${JSON.stringify(start)}`);
    assert.equal(start.totalSteps, 3);

    let jobs = listJobsForUser(db, "wave4_test_user");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].current_step, 0);
    assert.equal(jobs[0].status, "active");

    // Step 0 -> 1 ("smelt ingot", 1800s). Not yet elapsed refuses.
    let r = advanceStep(db, "wave4_test_user", start.jobId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yet");

    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 1900 WHERE id = ?`).run(start.jobId);
    r = advanceStep(db, "wave4_test_user", start.jobId);
    assert.equal(r.ok, true);
    assert.equal(r.advanced, true);
    assert.equal(r.nextStep, 1);

    // Step 1 -> 2 ("hammer to shape", 3600s).
    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 3700 WHERE id = ?`).run(start.jobId);
    r = advanceStep(db, "wave4_test_user", start.jobId);
    assert.equal(r.ok, true);
    assert.equal(r.nextStep, 2);

    // Step 2 -> finished ("quench + grind", 1800s).
    db.prepare(`UPDATE player_craft_jobs SET step_started_at = unixepoch() - 1900 WHERE id = ?`).run(start.jobId);
    r = advanceStep(db, "wave4_test_user", start.jobId);
    assert.equal(r.ok, true);
    assert.equal(r.finished, true);
    assert.equal(r.output, "forged_blade");

    jobs = listJobsForUser(db, "wave4_test_user");
    assert.equal(jobs[0].status, "complete");
    assert.equal(jobs[0].current_step, 3);
  });

  it("registerChain's upsert is idempotent — re-seeding the same chain does not duplicate or corrupt it", async () => {
    const { registerChain } = await import("../../lib/craft-chains.js");
    const before_ = db.prepare(`SELECT COUNT(*) AS n FROM craft_chains`).get().n;
    const chainsJson = JSON.parse(
      (await import("node:fs")).readFileSync(
        new URL("../../../content/world/concordia-hub/recipes/chains.json", import.meta.url),
        "utf8",
      ),
    );
    for (const chain of chainsJson.chains) {
      registerChain(db, { world_id: "concordia-hub", ...chain });
    }
    const after = db.prepare(`SELECT COUNT(*) AS n FROM craft_chains`).get().n;
    assert.equal(after, before_, "re-registering the same authored chains must not create duplicate rows");
  });
});
