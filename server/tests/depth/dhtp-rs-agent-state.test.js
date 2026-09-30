// server/tests/depth/dhtp-rs-agent-state.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAgentState,
  saveAgentState,
  markStep,
  findNextStep,
  formatAgentStatus,
  EXECUTION_ORDER,
} from "../../lib/runtime/dhtp-rs-agent-state.js";

describe("dhtp-rs-agent-state", () => {
  it("defaults STEP_1 complete and STEP_2 pending", () => {
    const state = loadAgentState("/nonexistent/path");
    assert.equal(state.steps.STEP_1_analyze_phase1.status, "complete");
    assert.equal(state.steps.STEP_2_phase2_generalization.status, "pending");
  });

  it("findNextStep returns STEP_2 after defaults", () => {
    const state = loadAgentState("/nonexistent/path");
    const next = findNextStep(state);
    assert.equal(next.stepId, "STEP_2_phase2_generalization");
    assert.equal(next.step.command, "phase2");
  });

  it("persists state to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "dhtp-rs-"));
    try {
      let state = loadAgentState(dir);
      state = markStep(state, "STEP_2_phase2_generalization", {
        status: "complete",
        runId: "rsb_test123",
      });
      saveAgentState(state, dir);
      const loaded = loadAgentState(dir);
      assert.equal(loaded.steps.STEP_2_phase2_generalization.status, "complete");
      assert.equal(loaded.steps.STEP_2_phase2_generalization.runId, "rsb_test123");
      const next = findNextStep(loaded);
      assert.equal(next.stepId, "STEP_3_selection_ablations");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formatAgentStatus includes all execution steps", () => {
    const text = formatAgentStatus(loadAgentState("/nonexistent"), { configuredProviders: [] });
    for (const step of EXECUTION_ORDER) {
      assert.ok(text.includes(step), `missing ${step}`);
    }
  });
});
