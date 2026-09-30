// server/lib/cpu-self-pin.js
//
// Best-effort: pin THIS process to CPU cores NOT used by any running Ollama
// process, so the single-threaded Node event loop never lands on the same
// core as an active LLM inference burst.
//
// Real production bug this fixes (2026-08-23, concord-os.org): login and
// register requests were intermittently getting 503-shed by the front-door
// event-loop-lag admission gate (lib/request-admission.js). Root cause
// traced to the live pod: its 5 Ollama brain processes were correctly
// core-pinned by scripts/runpod-cognition.sh (cores 0-82 of a 96-core
// cgroup), but the Node backend itself had NO pinning at all — free to be
// scheduled onto the exact cores an LLM inference burst was saturating.
// scripts/pin-processes.sh already solves this externally, but taskset
// affinity does not survive a process restart, and nothing re-ran it after
// any of pm2's restarts — a live, unpinned backend was the actual state for
// however long since the last manual pin. This module bakes the same fix
// into the app's own boot sequence so it reapplies automatically on every
// restart, with no separate operational step to remember.
//
// Never throws, never blocks boot. Pinning is an optimization, not a boot
// requirement — every failure mode (non-Linux, missing taskset, too few
// cores, exec error) degrades to a no-op with a logged reason.

import { execFileSync } from "node:child_process";
// @sync-fs-ok: procfs affinity reads are boot-time/local diagnostics in a sync boot helper.

import fs from "node:fs";

/** Parse a Linux CPU list spec ("0-3,7,9-11") into a flat array of ints. Pure. */
export function parseRangeList(spec) {
  const ids = [];
  if (!spec) return ids;
  for (const part of String(spec).split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [loStr, hiStr] = trimmed.split("-");
      const lo = Number(loStr);
      const hi = Number(hiStr);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        for (let i = lo; i <= hi; i++) ids.push(i);
      }
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n)) ids.push(n);
    }
  }
  return ids;
}

/** Collapse a flat array of ints back into a compact "0-3,7,9-11" spec. Pure. */
export function toRangeSpec(idsInput) {
  const ids = [...new Set(idsInput)].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  const ranges = [];
  let start = ids[0];
  let prev = ids[0];
  for (let i = 1; i <= ids.length; i++) {
    const cur = ids[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (cur === undefined) break;
    start = cur;
    prev = cur;
  }
  return ranges.join(",");
}

/**
 * Given this process's allowed cgroup cores and the set of cores any
 * running Ollama process is pinned to, compute the cores this process
 * should self-pin to: the free remainder, capped at `reserveCores`. Pure —
 * takes plain data, no I/O, so it's directly unit-testable without a real
 * /proc filesystem or a real Ollama process.
 *
 * @param {number[]} allowedCores
 * @param {Set<number>|number[]} ollamaUsedCores
 * @param {{ minFreeCores?: number, reserveCores?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string, cores?: number[], freeCoreCount?: number }}
 */
export function computeSelfPinCores(allowedCores, ollamaUsedCores, opts = {}) {
  const minFreeCores = opts.minFreeCores ?? 2;
  const reserveCores = opts.reserveCores ?? 8;
  if (!Array.isArray(allowedCores) || allowedCores.length < 4) {
    return { ok: false, reason: "too_few_cores" };
  }
  const used = ollamaUsedCores instanceof Set ? ollamaUsedCores : new Set(ollamaUsedCores || []);
  const free = allowedCores.filter((id) => !used.has(id));
  if (free.length < minFreeCores) {
    return { ok: false, reason: "no_free_cores", freeCoreCount: free.length };
  }
  const cores = free.slice(0, Math.min(reserveCores, free.length));
  return { ok: true, cores, freeCoreCount: free.length };
}

function readCpusAllowedList(procStatusPath) {
  try {
    const status = fs.readFileSync(procStatusPath, "utf8");
    const m = status.match(/^Cpus_allowed_list:\s*(.+)$/m);
    return m ? parseRangeList(m[1].trim()) : null;
  } catch {
    return null;
  }
}

/** Real (impure) discovery: allowed cores for this process + cores every running Ollama process is pinned to. */
function discoverCoreState() {
  const allowed = readCpusAllowedList("/proc/self/status");
  const ollamaUsed = new Set();
  try {
    const pidList = execFileSync("pgrep", ["-f", "ollama serve|llama-server"], {
      encoding: "utf8",
      timeout: 5000,
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pidList) {
      const cores = readCpusAllowedList(`/proc/${pid}/status`);
      if (cores) for (const id of cores) ollamaUsed.add(id);
    }
  } catch {
    // pgrep unavailable, no Ollama processes found, or a read raced a process
    // exit — any of these just means we self-pin with an empty exclusion set.
  }
  return { allowed, ollamaUsed };
}

/**
 * Orchestrator: discover real core state, compute the target, apply it via
 * `taskset -cp`. Call once, early in boot. Safe to call multiple times
 * (idempotent — re-pins to the same or a freshly recomputed target).
 *
 * @param {{ minFreeCores?: number, reserveCores?: number }} [opts]
 * @returns {{ pinned: boolean, reason?: string, cores?: string, freeCoreCount?: number, totalCores?: number, message?: string }}
 */
export function selfPinAwayFromOllama(opts = {}) {
  if (process.env.CONCORD_CPU_SELF_PIN === "0") return { pinned: false, reason: "disabled" };
  if (process.platform !== "linux") return { pinned: false, reason: "not_linux" };
  try {
    const { allowed, ollamaUsed } = discoverCoreState();
    if (!allowed) return { pinned: false, reason: "cpus_allowed_unreadable" };
    const decision = computeSelfPinCores(allowed, ollamaUsed, opts);
    if (!decision.ok) return { pinned: false, reason: decision.reason, freeCoreCount: decision.freeCoreCount };
    const spec = toRangeSpec(decision.cores);
    execFileSync("taskset", ["-cp", spec, String(process.pid)], { stdio: "ignore", timeout: 5000 });
    return {
      pinned: true,
      cores: spec,
      freeCoreCount: decision.freeCoreCount,
      totalCores: allowed.length,
    };
  } catch (err) {
    return { pinned: false, reason: "error", message: String(err?.message || err) };
  }
}
