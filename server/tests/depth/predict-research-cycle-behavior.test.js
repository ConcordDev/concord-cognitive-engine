// tests/depth/predict-research-cycle-behavior.test.js — REAL behavioral
// tests for the P7 autonomous evidence-stage heartbeat
// (emergent/predict-research-cycle.js). Needs the full harness boot (not
// the lighter fake-STATE pattern tests/lattice-orchestrator.test.js uses)
// because the handler calls the REAL registered predict.authorityStatus
// macro via globalThis.__concordLensActions.
//
// Contract pinned here, matching the lattice-orchestrator precedent:
//   - never throws
//   - ok:false with a reason before init / without a db
//   - ok:true with a per-model result list after init, and a real DTU
//     gets recorded on a genuine stage transition — exercising the actual
//     autonomous OBSERVE -> SYNTHESIZE path, not a mock of it
//   - PROMOTE is structurally unreachable from this file: it never calls
//     predict.promoteAuthority (grepped, not just asserted at runtime)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lensRun, depthCtx, load } from "./_harness.js";
import { initPredictResearchCycle, runPredictResearchCycle } from "../../emergent/predict-research-cycle.js";

describe("predict-research-cycle: lifecycle", () => {
  it("returns ok:false with a reason before init", async () => {
    initPredictResearchCycle(null);
    const r = await runPredictResearchCycle();
    assert.equal(r.ok, false);
    assert.equal(r.reason, "state_not_initialised");
  });

  it("returns ok:false with a reason when STATE has no db", async () => {
    initPredictResearchCycle({});
    const r = await runPredictResearchCycle();
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("after real init: checks every model_id with resolved tickets, records a DTU on a real stage transition", async () => {
    const { STATE } = await load();
    const db = STATE.db;
    const ctx = await depthCtx("predict-research-cycle");
    const modelId = `research-cycle-${Date.now().toString(36)}`;

    const created = await lensRun("predict", "create", {
      params: {
        subject: "RC-USD", eventDefinition: "e", horizonSeconds: 60,
        modelId, forecastDistribution: { prob: 0.5 }, featureSnapshot: {}, decision: "BUY",
      },
    }, ctx);
    await lensRun("predict", "resolve", {
      params: { id: created.result.ticket.id, actualOutcome: true, actualValue: { realized_return_pct: 0.05 } },
    }, ctx);

    initPredictResearchCycle(STATE);
    const r = await runPredictResearchCycle();
    assert.equal(r.ok, true);
    assert.ok(r.checked >= 1);

    const mine = r.results.find((x) => x.modelId === modelId);
    assert.ok(mine, "the freshly-created model must appear in this pass's results");
    assert.equal(mine.stage, "SHADOW"); // n=1, below default minTestedN=20
    assert.equal(mine.transitioned, true); // (new) -> SHADOW is a real transition
    assert.ok(mine.dtuId, "a real stage transition must record a durable DTU finding");

    const dtuRow = db.prepare("SELECT id FROM dtus WHERE id = ?").get(mine.dtuId);
    assert.ok(dtuRow, "the finding must actually exist in the dtus table, not just be claimed");

    const stateRow = db.prepare("SELECT stage FROM predict_authority_state WHERE model_id = ?").get(modelId);
    assert.equal(stateRow.stage, "SHADOW");
  });

  it("a second pass with no new evidence does NOT re-record a DTU (no transition)", async () => {
    const { STATE } = await load();
    const ctx = await depthCtx("predict-research-cycle-notransition");
    const modelId = `research-cycle-stable-${Date.now().toString(36)}`;

    const created = await lensRun("predict", "create", {
      params: { subject: "RC2-USD", eventDefinition: "e", horizonSeconds: 60, modelId, forecastDistribution: { prob: 0.5 }, featureSnapshot: {}, decision: "BUY" },
    }, ctx);
    await lensRun("predict", "resolve", { params: { id: created.result.ticket.id, actualOutcome: true, actualValue: { realized_return_pct: 0.05 } } }, ctx);

    initPredictResearchCycle(STATE);
    const first = await runPredictResearchCycle();
    const firstMine = first.results.find((x) => x.modelId === modelId);
    assert.equal(firstMine.transitioned, true);

    const second = await runPredictResearchCycle();
    const secondMine = second.results.find((x) => x.modelId === modelId);
    assert.equal(secondMine.stage, "SHADOW");
    assert.equal(secondMine.transitioned, false, "no new evidence -> no transition -> no duplicate DTU");
  });

  it("never throws even when a model_id's check fails internally", async () => {
    // Force a failure path: initPredictResearchCycle with a STATE whose db
    // exists but predict_authority_state doesn't (a db with no migrations
    // applied) — the handler must catch and report, not throw.
    initPredictResearchCycle({ db: { prepare: () => { throw new Error("boom"); } } });
    const r = await runPredictResearchCycle();
    assert.equal(typeof r, "object");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "query_failed");
  });
});

describe("predict-research-cycle: structural safety (PROMOTE is unreachable)", () => {
  it("the module source never calls predict.promoteAuthority or writes stage='PROMOTED'", () => {
    // Strip line comments first — the header prose legitimately explains
    // WHY promoteAuthority is never called, by name, which would otherwise
    // false-positive an exact-string check (the same trap CLAUDE.md's
    // GENERIC_TRIO detector note documents for a different file). Check
    // for actual CALL/lookup syntax, not the bare word.
    const path = fileURLToPath(new URL("../../emergent/predict-research-cycle.js", import.meta.url));
    const src = readFileSync(path, "utf8");
    const code = src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /promoteAuthority\s*\(/, "the autonomous loop must never invoke promotion as a function/macro call");
    assert.doesNotMatch(code, /get\(\s*["']predict\.promoteAuthority["']\s*\)/, "the autonomous loop must never look up the promoteAuthority macro handler");
    assert.doesNotMatch(code, /=\s*["']PROMOTED["']/, "the autonomous loop must never assign the PROMOTED stage directly");
  });
});
