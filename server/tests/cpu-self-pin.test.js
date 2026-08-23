// Pins for lib/cpu-self-pin.js — see that file's header for the real
// production bug this closes (2026-08-23: auth 503s under event-loop lag
// traced to the Node backend sharing cores with an active Ollama inference
// burst). These tests exercise the PURE functions only (parseRangeList,
// toRangeSpec, computeSelfPinCores) — no real /proc reads, no real taskset
// exec, matching the pure/impure split lib/request-admission.js already
// uses for the same reason: deterministic, no-I/O, mutation-verifiable.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRangeList, toRangeSpec, computeSelfPinCores, selfPinAwayFromOllama } from "../lib/cpu-self-pin.js";

describe("cpu-self-pin — parseRangeList", () => {
  it("parses a mix of singles and ranges", () => {
    assert.deepEqual(parseRangeList("0-3,7,9-11"), [0, 1, 2, 3, 7, 9, 10, 11]);
  });
  it("handles a single range", () => {
    assert.deepEqual(parseRangeList("83-90"), [83, 84, 85, 86, 87, 88, 89, 90]);
  });
  it("handles a single core", () => {
    assert.deepEqual(parseRangeList("5"), [5]);
  });
  it("returns [] for empty/undefined input", () => {
    assert.deepEqual(parseRangeList(""), []);
    assert.deepEqual(parseRangeList(undefined), []);
  });
});

describe("cpu-self-pin — toRangeSpec", () => {
  it("collapses contiguous runs into ranges", () => {
    assert.equal(toRangeSpec([83, 84, 85, 86, 87, 88, 89, 90]), "83-90");
  });
  it("keeps non-contiguous ids separate", () => {
    assert.equal(toRangeSpec([0, 1, 2, 7, 9, 10]), "0-2,7,9-10");
  });
  it("dedupes and sorts unordered input", () => {
    assert.equal(toRangeSpec([5, 3, 4, 3]), "3-5");
  });
  it("returns null for an empty set", () => {
    assert.equal(toRangeSpec([]), null);
  });
  it("round-trips through parseRangeList", () => {
    const spec = "0-41,50,60-62";
    assert.equal(toRangeSpec(parseRangeList(spec)), spec);
  });
});

describe("cpu-self-pin — computeSelfPinCores (the real bug's exact scenario)", () => {
  it("reproduces the live pod finding: 96 cores, Ollama on 0-82, backend gets 83-90", () => {
    const allowed = Array.from({ length: 96 }, (_, i) => i);
    const ollamaUsed = new Set(parseRangeList("0-82"));
    const decision = computeSelfPinCores(allowed, ollamaUsed, { reserveCores: 8 });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.cores, [83, 84, 85, 86, 87, 88, 89, 90]);
    assert.equal(decision.freeCoreCount, 13); // 83-95
  });

  it("caps at reserveCores even when more is free", () => {
    const allowed = Array.from({ length: 20 }, (_, i) => i);
    const decision = computeSelfPinCores(allowed, new Set(), { reserveCores: 4 });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.cores, [0, 1, 2, 3]);
  });

  it("uses whatever is free when less than reserveCores is available", () => {
    const allowed = Array.from({ length: 10 }, (_, i) => i);
    const ollamaUsed = new Set(parseRangeList("0-6"));
    const decision = computeSelfPinCores(allowed, ollamaUsed, { reserveCores: 8 });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.cores, [7, 8, 9]);
  });

  it("fails honestly when fewer than minFreeCores remain (fully saturated box)", () => {
    const allowed = Array.from({ length: 9 }, (_, i) => i); // the doc-assumed 9 vCPU box
    const ollamaUsed = new Set(parseRangeList("0-8")); // Ollama pinned to every core
    const decision = computeSelfPinCores(allowed, ollamaUsed, { minFreeCores: 2 });
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "no_free_cores");
    assert.equal(decision.freeCoreCount, 0);
  });

  it("fails honestly on a cgroup with too few total cores to bother splitting", () => {
    const decision = computeSelfPinCores([0, 1, 2], new Set());
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "too_few_cores");
  });

  it("ignores cores Ollama isn't actually using (no over-exclusion)", () => {
    const allowed = [0, 1, 2, 3, 4, 5];
    const decision = computeSelfPinCores(allowed, new Set([0, 1]), { reserveCores: 4 });
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.cores, [2, 3, 4, 5]);
  });
});

describe("cpu-self-pin — selfPinAwayFromOllama (impure orchestrator, safety rails only)", () => {
  it("no-ops honestly on a non-Linux platform without touching the real process", () => {
    if (process.platform === "linux") return; // this rail only fires off-Linux; skip silently on CI's Linux runners
    const result = selfPinAwayFromOllama();
    assert.equal(result.pinned, false);
    assert.equal(result.reason, "not_linux");
  });

  it("respects the CONCORD_CPU_SELF_PIN=0 kill switch even on Linux", () => {
    const prior = process.env.CONCORD_CPU_SELF_PIN;
    process.env.CONCORD_CPU_SELF_PIN = "0";
    try {
      const result = selfPinAwayFromOllama();
      assert.equal(result.pinned, false);
      assert.equal(result.reason, "disabled");
    } finally {
      if (prior === undefined) delete process.env.CONCORD_CPU_SELF_PIN;
      else process.env.CONCORD_CPU_SELF_PIN = prior;
    }
  });

  it("never throws regardless of platform/environment", () => {
    assert.doesNotThrow(() => selfPinAwayFromOllama());
  });
});
