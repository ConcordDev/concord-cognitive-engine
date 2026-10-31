// Names WHY the event loop was blocked when no tracked job explains it.
//
// Live 2026-10-31: after the integrity check was time-sliced, `event_loop_block`
// kept reporting jobs:[] blocks of 2-20 s on a Mac with ~11 of 12 GB swap used,
// the backend holding ~180 MB resident against a ~1 GB heap. A block that is
// swap/page-in (or descheduling) looks identical to a CPU-bound one in the old
// log line. The two differ in one measurable way: a CPU-bound or GC block burns
// the whole wall time as CPU; a waiting block burns almost none of it.
//
// The sampler takes process.resourceUsage() on every drift tick (a cheap
// getrusage call) and, when a block is reported, subtracts the previous tick's
// sample — i.e. the window the loop was stuck. GC pauses come from a
// PerformanceObserver ring (flushed with takeRecords(), since the observer's own
// callback cannot run during the block). Pure of server.js: everything is injected.

import { PerformanceObserver } from "node:perf_hooks";

const GC_KINDS = { 1: "scavenge", 2: "mark-sweep-compact", 4: "incremental", 8: "weak-callbacks" };

/**
 * @param {{ resourceUsage?: () => object, now?: () => number, observeGc?: boolean }} [deps]
 */
export function createLoopBlockSampler({ resourceUsage = () => process.resourceUsage(), now = () => Date.now(), observeGc = true } = {}) {
  let prev = null;
  let prevAt = 0;
  const gc = []; // { at, ms, kind } — wall-clock end times, newest last
  let obs = null;

  const absorb = (list) => {
    const end = now();
    for (const e of list) {
      // entry.startTime is relative to timeOrigin; approximate wall end as now - age.
      const ageMs = Math.max(0, performance.now() - (e.startTime + e.duration));
      gc.push({ at: end - ageMs, ms: e.duration, kind: GC_KINDS[e.detail?.kind ?? e.kind] || "gc" });
    }
    while (gc.length > 64) gc.shift();
  };

  if (observeGc) {
    try {
      obs = new PerformanceObserver((l) => absorb(l.getEntries()));
      obs.observe({ entryTypes: ["gc"] });
      obs.unref?.();
    } catch { obs = null; }
  }

  return {
    /** Call every drift tick (also the tick that reports a block, AFTER describeBlock). */
    tick() {
      try { prev = resourceUsage(); prevAt = now(); } catch { /* informational */ }
    },
    /** Fields describing the window since the previous tick(); null before the first tick. */
    describeBlock(blockedMs) {
      let cur;
      try { cur = resourceUsage(); } catch { return null; }
      if (obs) { try { absorb(obs.takeRecords()); } catch { /* informational */ } }
      if (!prev) return null;
      const since = prevAt;
      const cpuUserMs = Math.round((cur.userCPUTime - prev.userCPUTime) / 1000);
      const cpuSysMs = Math.round((cur.systemCPUTime - prev.systemCPUTime) / 1000);
      const cpuMs = cpuUserMs + cpuSysMs;
      const majorFaults = cur.majorPageFault - prev.majorPageFault;
      const minorFaults = cur.minorPageFault - prev.minorPageFault;
      const invCtx = cur.involuntaryContextSwitches - prev.involuntaryContextSwitches;
      const volCtx = cur.voluntaryContextSwitches - prev.voluntaryContextSwitches;
      const inWin = gc.filter((g) => g.at >= since);
      const gcMs = Math.round(inWin.reduce((a, g) => a + g.ms, 0));
      const gcKinds = [...new Set(inWin.map((g) => g.kind))];
      const share = blockedMs > 0 ? cpuMs / blockedMs : 0;
      // cpu: the thread was running (JS or GC — gcMs says which). waiting: it was
      // not (page-in, swap, descheduled, blocking syscall). mixed: in between.
      const kind = share >= 0.7 ? (gcMs >= 0.5 * cpuMs ? "gc" : "cpu") : share <= 0.3 ? "waiting" : "mixed";
      return { blockKind: kind, cpuMs, cpuUserMs, cpuSysMs, cpuShare: Math.round(share * 100) / 100, majorFaults, minorFaults, volCtx, invCtx, gcMs, gcKinds, windowMs: now() - since };
    },
    close() { try { obs?.disconnect(); } catch { /* ignore */ } },
  };
}
