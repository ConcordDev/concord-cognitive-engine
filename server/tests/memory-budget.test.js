import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import v8 from "node:v8";
import { checkMemoryBudget } from "../lib/memory-budget.js";

describe("memory-budget", () => {
  it("reports ok when heap ceiling is well under the threshold", () => {
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
    const heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
    const result = checkMemoryBudget({ maxHeapFraction: 1 }); // real ratio always passes with fraction=1
    assert.equal(result.ok, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.totalMemMb, totalMemMb);
    assert.equal(result.heapLimitMb, heapLimitMb);
  });

  it("flags a heap ceiling that exceeds an artificially low threshold", () => {
    // The real process's heap is always > 0% of real total RAM, so a
    // threshold of 0 forces the over-budget branch deterministically —
    // exercises the actual comparison logic, not a mocked fraction.
    const result = checkMemoryBudget({ maxHeapFraction: 0 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /heap ceiling/i);
    assert.match(result.reason, /OOM-kill/i);
  });

  it("computed fraction matches heapLimitMb / totalMemMb within rounding", () => {
    const result = checkMemoryBudget({ maxHeapFraction: 1 });
    const expectedFraction = result.heapLimitMb / result.totalMemMb;
    assert.ok(Math.abs(result.fraction - expectedFraction) < 0.01);
  });

  it("defaults maxHeapFraction to 0.6 when not provided", () => {
    const withDefault = checkMemoryBudget();
    const withExplicit = checkMemoryBudget({ maxHeapFraction: 0.6 });
    assert.equal(withDefault.ok, withExplicit.ok);
  });
});
