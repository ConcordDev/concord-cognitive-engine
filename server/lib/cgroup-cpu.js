// server/lib/cgroup-cpu.js
//
// GPU/CPU pinning audit (2026-07-20) — Node's `os.cpus().length` reports the
// HOST's full visible core count, not the process's real cgroup-restricted
// slice. On a shared box (RunPod pod, any cgroup-limited container/VM),
// `nproc`/`os.cpus()` "lies" — scripts/pin-processes.sh and
// scripts/runpod-cognition.sh already document and work around this exact
// problem at the shell level (both read /proc/self/status's
// `Cpus_allowed_list`, per github.com/moby/moby/issues/43205), but nothing
// in the Node process itself used the same signal — server/workers/
// macro-pool.js and server/workers/heartbeat-pool.js both size their worker
// pool off raw os.cpus().length, and so did the world-shard concurrency cap
// added in this same audit pass. On a 9-vCPU RunPod pod where nproc/os.cpus()
// reports the host's real (100+) core count, every one of those would size
// itself far past what the pod can actually schedule — internal
// oversubscription that wastes memory/thread-management overhead without
// any real parallelism benefit, since the OS only lets the process use its
// actual cgroup-allotted cores regardless of how many worker threads it
// spawns.
//
// This mirrors the shell scripts' own detection exactly so all three
// callers get a consistent, correct core count.
//
// @sync-fs-ok: the readFileSync below is memoized (`_cached`) and every
// current caller (workers/macro-pool.js, workers/heartbeat-pool.js,
// lib/world-shard-manager.js) invokes getRealCpuCount() exactly once, at
// module-load time, to size a top-level pool-size constant — never from
// inside a per-request handler or heartbeat tick. It's the same "read once
// at boot" shape the performance-hotspot detector already exempts for
// persistence/bootstrap/seed/init/migration paths; this file just isn't
// under one of those directory names. If a future caller ever invokes this
// from a hot per-request path, revisit — but the cache means even that
// would only pay the syscall cost once per process, not per call.

import fs from "node:fs";
import os from "node:os";

let _cached = null;

/**
 * Real usable CPU core count for this process — the cgroup-restricted
 * slice on Linux (via /proc/self/status Cpus_allowed_list), falling back to
 * os.cpus().length wherever that file isn't available (non-Linux, or a
 * non-cgroup-limited environment where os.cpus() is already correct).
 * Cached — a process's cgroup cpuset doesn't change at runtime.
 */
/** Count CPUs in a cpuset list like "0-3,8,10-11". Returns 0 when unparseable. */
function countCpuset(spec) {
  let count = 0;
  for (const part of String(spec || "").split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] != null ? Number(m[2]) : lo;
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) count += (hi - lo + 1);
  }
  return count;
}

/**
 * Pure core of getRealCpuCount. A container can be limited two ways and
 * RunPod uses the second: a cpuset (Cpus_allowed_list) and/or a CFS quota
 * (cgroup v2 `cpu.max`, e.g. "680000 100000" = 6.8 CPUs over a 128-thread
 * host's full cpuset). The usable count is the smallest of every signal
 * present. (2026-09-27: a quota-only pod reported 128 here, so ONNX and the
 * worker pools sized themselves for 128 cores inside 6.8.)
 * @param {{cpusetSpec?:string|null, cpuMax?:string|null, availableParallelism?:number|null, hostCpus:number}} s
 */
export function computeCpuCount({ cpusetSpec = null, cpuMax = null, availableParallelism = null, hostCpus }) {
  const limits = [];
  const set = countCpuset(cpusetSpec);
  if (set > 0) limits.push(set);
  const m = String(cpuMax || "").trim().match(/^(\d+)\s+(\d+)$/); // "max 100000" = unlimited
  if (m && Number(m[2]) > 0) limits.push(Math.max(1, Math.ceil(Number(m[1]) / Number(m[2]))));
  if (Number.isInteger(availableParallelism) && availableParallelism > 0) limits.push(availableParallelism);
  return Math.max(1, limits.length ? Math.min(...limits) : hostCpus);
}

function readOr(path) {
  try { return fs.readFileSync(path, "utf8"); } catch { return null; }
}

export function getRealCpuCount() {
  if (_cached != null) return _cached;
  let cpusetSpec = null;
  const status = readOr("/proc/self/status");
  if (status) {
    const line = status.split("\n").find((l) => l.toLowerCase().startsWith("cpus_allowed_list:"));
    cpusetSpec = line?.split(/:\s*/)[1]?.trim() || null;
  }
  let ap = null;
  try { ap = typeof os.availableParallelism === "function" ? os.availableParallelism() : null; } catch { /* old node */ }
  _cached = computeCpuCount({
    cpusetSpec,
    cpuMax: readOr("/sys/fs/cgroup/cpu.max"),
    availableParallelism: ap,
    hostCpus: Math.max(1, os.cpus().length),
  });
  return _cached;
}

/** Test-only: clear the cache so a test can simulate a different environment. */
export function _resetCpuCountCacheForTest() {
  _cached = null;
}
