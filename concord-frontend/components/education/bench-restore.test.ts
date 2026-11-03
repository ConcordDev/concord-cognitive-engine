import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { restoreBench } from "./bench-restore.ts";

describe("bench restore", () => {
  it("keeps a real grade, progress, and mint id", () => {
    const row = restoreBench({
      grade: { studentsGraded: 1, classStats: { average: 90 }, students: [] },
      prog: { overallCompletionPct: 40, totalRequirements: 1, completedRequirements: 0, remainingRequirements: 1 },
      mintedDtuId: "dtu_2aeb",
    });
    assert.equal(row.grade?.classStats?.average, 90);
    assert.equal(row.prog?.overallCompletionPct, 40);
    assert.equal(row.mintedDtuId, "dtu_2aeb");
  });

  it("drops a row that is not a grade or a progress report", () => {
    const row = restoreBench({ grade: { nope: true }, prog: null, mintedDtuId: "  " });
    assert.equal(row.grade, null);
    assert.equal(row.prog, null);
    assert.equal(row.mintedDtuId, null);
  });
});
