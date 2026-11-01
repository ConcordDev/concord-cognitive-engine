import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLoopBlockSampler } from "../lib/loop-block-attribution.js";

function fake() {
  let ru = { userCPUTime: 0, systemCPUTime: 0, majorPageFault: 0, minorPageFault: 0, involuntaryContextSwitches: 0, voluntaryContextSwitches: 0 };
  let t = 1000;
  const s = createLoopBlockSampler({ resourceUsage: () => ({ ...ru }), now: () => t, observeGc: false });
  return { s, set: (patch, dt) => { ru = { ...ru, ...patch }; t += dt; } };
}

describe("loop block attribution", () => {
  it("no sample yet -> null", () => {
    assert.equal(fake().s.describeBlock(5000), null);
  });

  it("a block that burned its wall time as CPU is cpu", () => {
    const { s, set } = fake();
    s.tick();
    set({ userCPUTime: 4_800_000, systemCPUTime: 100_000, minorPageFault: 40 }, 5000);
    const d = s.describeBlock(5000);
    assert.equal(d.blockKind, "cpu");
    assert.equal(d.cpuMs, 4900);
    assert.equal(d.majorFaults, 0);
  });

  it("a 9 s block with almost no CPU and page faults is waiting (swap/page-in signature)", () => {
    const { s, set } = fake();
    s.tick();
    set({ userCPUTime: 300_000, systemCPUTime: 700_000, majorPageFault: 52_000, involuntaryContextSwitches: 3 }, 9000);
    const d = s.describeBlock(9000);
    assert.equal(d.blockKind, "waiting");
    assert.equal(d.majorFaults, 52_000);
    assert.equal(d.cpuShare, 0.11);
  });

  it("in-between CPU share is mixed", () => {
    const { s, set } = fake();
    s.tick();
    set({ userCPUTime: 5_000_000 }, 10000);
    assert.equal(s.describeBlock(10000).blockKind, "mixed");
  });

  it("windows are measured from the previous tick, not from process start", () => {
    const { s, set } = fake();
    set({ userCPUTime: 90_000_000 }, 0); // a long CPU-heavy history before the window
    s.tick();
    set({ userCPUTime: 90_050_000 }, 3000);
    const d = s.describeBlock(3000);
    assert.equal(d.cpuMs, 50);
    assert.equal(d.blockKind, "waiting");
  });

  it("real process.resourceUsage works end to end (no injection)", () => {
    const s = createLoopBlockSampler();
    s.tick();
    const d = s.describeBlock(100);
    assert.ok(d && typeof d.cpuMs === "number" && typeof d.majorFaults === "number");
    s.close();
  });
});
