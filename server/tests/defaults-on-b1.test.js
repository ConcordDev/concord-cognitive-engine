/**
 * PR-8 B1: dream + forward-sim LLM composers default-ON.
 *
 * Pins the env-var resolution seam in both engines:
 *   - env var unset -> composer resolves to 'subconscious_llm'
 *   - env var = 'false' -> composer resolves to 'deterministic'
 *
 * Run: node --test tests/defaults-on-b1.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { resolveDreamComposer } from "../lib/embodied/dream-engine.js";
import { resolveForwardSimComposer } from "../lib/embodied/forward-sim.js";

describe("PR-8 B1 default-on composer resolution", () => {
  let originalDream;
  let originalForward;

  beforeEach(() => {
    originalDream = process.env.CONCORD_DREAM_LLM;
    originalForward = process.env.CONCORD_FORWARD_SIM_LLM;
    delete process.env.CONCORD_DREAM_LLM;
    delete process.env.CONCORD_FORWARD_SIM_LLM;
  });

  afterEach(() => {
    if (originalDream === undefined) delete process.env.CONCORD_DREAM_LLM;
    else process.env.CONCORD_DREAM_LLM = originalDream;
    if (originalForward === undefined) delete process.env.CONCORD_FORWARD_SIM_LLM;
    else process.env.CONCORD_FORWARD_SIM_LLM = originalForward;
  });

  it("dream composer defaults to subconscious_llm when env is unset", () => {
    assert.equal(resolveDreamComposer(), "subconscious_llm");
  });

  it("dream composer resolves to deterministic when env is false", () => {
    process.env.CONCORD_DREAM_LLM = "false";
    assert.equal(resolveDreamComposer(), "deterministic");
  });

  it("forward-sim composer defaults to subconscious_llm when env is unset", () => {
    assert.equal(resolveForwardSimComposer(), "subconscious_llm");
  });

  it("forward-sim composer resolves to deterministic when env is false", () => {
    process.env.CONCORD_FORWARD_SIM_LLM = "false";
    assert.equal(resolveForwardSimComposer(), "deterministic");
  });
});
