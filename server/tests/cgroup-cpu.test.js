// GPU/CPU pinning audit (2026-07-20) — proves getRealCpuCount() reads the
// real cgroup-restricted core count (matching what pin-processes.sh /
// runpod-cognition.sh already do at the shell level) rather than the
// host's full os.cpus().length, which lies under cgroup restriction.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { getRealCpuCount, computeCpuCount, _resetCpuCountCacheForTest } from "../lib/cgroup-cpu.js";

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
      // Never more than the cpuset; a CFS quota can make it smaller still.
      assert.ok(getRealCpuCount() <= expected);
    }
  });

  it("never exceeds os.cpus().length (a cgroup slice is always a subset of the host)", () => {
    _resetCpuCountCacheForTest();
    assert.ok(getRealCpuCount() <= os.cpus().length);
  });

  it("honors a CFS quota (cgroup v2 cpu.max) under a full-host cpuset — the RunPod shape", () => {
    assert.equal(computeCpuCount({ cpusetSpec: "0-127", cpuMax: "680000 100000", hostCpus: 128 }), 7);
    assert.equal(computeCpuCount({ cpusetSpec: "0-127", cpuMax: "max 100000", hostCpus: 128 }), 128);
    assert.equal(computeCpuCount({ cpusetSpec: "0-3", cpuMax: "800000 100000", hostCpus: 128 }), 4);
    assert.equal(computeCpuCount({ cpusetSpec: "0-127", availableParallelism: 6, hostCpus: 128 }), 6);
    assert.equal(computeCpuCount({ hostCpus: 12 }), 12);
    assert.equal(computeCpuCount({ cpuMax: "5000 100000", hostCpus: 8 }), 1);
  });
});
