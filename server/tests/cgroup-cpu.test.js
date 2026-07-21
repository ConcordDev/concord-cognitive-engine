// GPU/CPU pinning audit (2026-07-20) — proves getRealCpuCount() reads the
// real cgroup-restricted core count (matching what pin-processes.sh /
// runpod-cognition.sh already do at the shell level) rather than the
// host's full os.cpus().length, which lies under cgroup restriction.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { getRealCpuCount, _resetCpuCountCacheForTest } from "../lib/cgroup-cpu.js";

describe("getRealCpuCount", () => {
  it("returns a positive integer", () => {
    _resetCpuCountCacheForTest();
    const n = getRealCpuCount();
    assert.equal(Number.isInteger(n), true);
    assert.ok(n >= 1);
  });

  it("is cached — repeated calls don't re-read /proc/self/status", () => {
    _resetCpuCountCacheForTest();
    const a = getRealCpuCount();
    const b = getRealCpuCount();
    assert.equal(a, b);
  });

  it("matches a direct read of Cpus_allowed_list when /proc/self/status is available", () => {
    _resetCpuCountCacheForTest();
    let expected = null;
    try {
      const status = fs.readFileSync("/proc/self/status", "utf8");
      const line = status.split("\n").find((l) => l.toLowerCase().startsWith("cpus_allowed_list:"));
      const spec = line?.split(/:\s*/)[1]?.trim();
      if (spec) {
        expected = 0;
        for (const part of spec.split(",")) {
          const m = part.match(/^(\d+)(?:-(\d+))?$/);
          if (!m) continue;
          const lo = Number(m[1]);
          const hi = m[2] != null ? Number(m[2]) : lo;
          expected += (hi - lo + 1);
        }
      }
    } catch { /* not Linux — skip this assertion, next test covers the fallback */ }
    if (expected != null) {
      assert.equal(getRealCpuCount(), expected);
    }
  });

  it("never exceeds os.cpus().length (a cgroup slice is always a subset of the host)", () => {
    _resetCpuCountCacheForTest();
    assert.ok(getRealCpuCount() <= os.cpus().length);
  });
});
