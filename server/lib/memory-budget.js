// server/lib/memory-budget.js
//
// Stability audit (2026-07-20) — a hand-tuned --max-old-space-size (in
// ecosystem.config.cjs's node_args) can silently drift out of sync with the
// REAL box it's running on: the box gets resized, the file doesn't, and
// nobody notices until an OOM-kill under real load. This checks the actual
// enforced V8 heap ceiling (v8.getHeapStatistics().heap_size_limit — the
// real number in effect, not a re-parsed guess at the CLI flag) against the
// real os.totalmem(), so a mismatch is a loud boot-time warning instead of a
// silent risk. Mirrors lib/cgroup-cpu.js's "trust the runtime, not a
// hardcoded assumption" pattern from the same audit.

import os from "node:os";
import v8 from "node:v8";

// Above this fraction of total system RAM, Node's heap alone could
// starve every other process sharing the box (Ollama, the frontend, SQLite's
// page cache, the OS itself) — see ecosystem.config.cjs's node_args comment
// for the full real-box budget this threshold is checked against.
const DEFAULT_MAX_HEAP_FRACTION = 0.6;

/**
 * @param {{ maxHeapFraction?: number }} [opts]
 * @returns {{ ok: boolean, heapLimitMb: number, totalMemMb: number, fraction: number, reason?: string }}
 */
export function checkMemoryBudget(opts = {}) {
  const maxHeapFraction = opts.maxHeapFraction ?? DEFAULT_MAX_HEAP_FRACTION;
  const heapLimitBytes = v8.getHeapStatistics().heap_size_limit;
  const totalMemBytes = os.totalmem();
  const heapLimitMb = Math.round(heapLimitBytes / 1024 / 1024);
  const totalMemMb = Math.round(totalMemBytes / 1024 / 1024);
  const fraction = totalMemBytes > 0 ? heapLimitBytes / totalMemBytes : 0;
  const ok = fraction <= maxHeapFraction;
  return {
    ok,
    heapLimitMb,
    totalMemMb,
    fraction,
    reason: ok
      ? undefined
      : `Node's heap ceiling (${heapLimitMb}MB) is ${Math.round(fraction * 100)}% of total system RAM ` +
        `(${totalMemMb}MB) — above the ${Math.round(maxHeapFraction * 100)}% safety threshold. On a box ` +
        `shared with Ollama and other processes, this leaves too little headroom and risks an OS-level ` +
        `OOM-kill under real load. Either the box was resized without updating --max-old-space-size, or ` +
        `this really is a Node-only box and the threshold should be raised explicitly.`,
  };
}
