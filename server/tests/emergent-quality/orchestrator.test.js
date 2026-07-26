// server/tests/emergent-quality/orchestrator.test.js
// Structural tests for the quality orchestrator.
// Because self-critique and peer-review call spawnSubCognition (which needs
// live inference), we focus on the deterministic failure paths.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runQualityPipeline } from "../../lib/emergents/quality/orchestrator.js";

function makeDb() {
  const rows = [];
  return {
    prepare: (sql) => ({
      run: (...args) => rows.push({ sql, args }),
      get: () => null,
      all: () => [],
    }),
    _rows: rows,
  };
}

const baseTask = {
  id: "task-1",
  task_type: "synthesis",
  task_data: { lens: "research", sourceDTUs: ["dtu1", "dtu2"] },
};

describe("runQualityPipeline", () => {
  it("does not throw when db is null", async () => {
    const result = await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "Some synthesis output that meets length requirements." },
      db: null,
    });
    assert.ok(typeof result.approved === "boolean");
    assert.ok(typeof result.reason === "string");
  });

  it("returns approved:false when draft body is empty (required fields gate)", async () => {
    const result = await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "" },
      db: makeDb(),
    });
    // Self-critique may fail first, or deterministic gates — either way rejected
    assert.equal(result.approved, false);
    assert.equal(result.finalDraft, null);
  });

  it("always returns a reason string", async () => {
    const result = await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "" },
      db: makeDb(),
    });
    assert.ok(typeof result.reason === "string");
    assert.ok(result.reason.length > 0);
  });

  it("records quality outcome in db on rejection", async () => {
    const db = makeDb();
    await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "" },
      db,
    });
    const inserted = db._rows.filter(r => r.sql.includes("emergent_quality_history"));
    assert.ok(inserted.length > 0, "Expected quality outcome to be recorded in db");
  });

  it("rejected result has finalDraft: null", async () => {
    const result = await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "" },
      db: makeDb(),
    });
    assert.equal(result.finalDraft, null);
  });

  it("stamps the caller's identity.given_name into the recorded stages, not discarding it", async () => {
    const db = makeDb();
    await runQualityPipeline({
      emergentId: "e1",
      identity: { given_name: "Vesper", emergent_id: "e1" },
      task: baseTask,
      result: { finalText: "" },
      db,
    });
    const inserted = db._rows.find((r) => r.sql.includes("emergent_quality_history"));
    assert.ok(inserted, "expected an emergent_quality_history insert");
    // recordQualityOutcome's positional args: id, emergentId, taskId, artifactId,
    // decision, qualityScore, stages_json, created_at — stages_json is index 6.
    const stagesJson = inserted.args[6];
    const stages = JSON.parse(stagesJson);
    assert.equal(stages.identity, "Vesper", "identity.given_name must land in stages, not be dropped");
  });

  it("does not stamp identity when none is supplied (no throw, no bogus field)", async () => {
    const db = makeDb();
    await runQualityPipeline({
      emergentId: "e1",
      task: baseTask,
      result: { finalText: "" },
      db,
    });
    const inserted = db._rows.find((r) => r.sql.includes("emergent_quality_history"));
    const stages = JSON.parse(inserted.args[6]);
    assert.equal(stages.identity, undefined);
  });

  it("handles null task gracefully without throwing", async () => {
    const result = await runQualityPipeline({
      emergentId: "e1",
      task: null,
      result: { finalText: "content" },
      db: makeDb(),
    });
    assert.ok(typeof result.approved === "boolean");
  });
});
