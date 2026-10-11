// server/lib/host-profile.js
//
// Shared low-memory host profile. A single user on a swapping or small box
// was losing every request to the load shedder while background jobs (city
// presence, the cognitive worker, lattice passes, lore synthesis, LLM
// preload) kept spending the same scarce RAM and event loop.
//
// One helper, every gate. Callers do not re-derive the rule.
//
// The profile is ON when any of these is true:
//   - CONCORD_LOW_MEMORY_HOST=1 (force on; "0" forces off)
//   - total RAM is 16 GiB or less (CONCORD_LOW_MEMORY_RAM_BYTES overrides)
//   - swap used / swap total is at or above CONCORD_SWAP_PRESSURE_RATIO (0.5)
//   - available memory / total is at or below CONCORD_MEM_AVAILABLE_MIN_RATIO (0.15)
//
// NODE_ENV=test, NODE_ENV=ci, and a set CI env var do not auto-detect from
// the runner's hardware. GitHub's tick-SLO job is NODE_ENV=ci on a 16 GB
// runner; treating that box as a low-memory host paused the governor and the
// gate reported a frozen loop. Tests and CI opt in with
// CONCORD_LOW_MEMORY_HOST=1 or by passing an explicit env object.

import os from "node:os";
import fs from "node:fs";

const RAM_16GB = 16 * 1024 * 1024 * 1024;
const CACHE_MS = 5_000;

let _cache = null;
let _cacheAt = 0;

function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Unit tests and GitHub Actions must not inherit the runner's RAM size. */
function _skipHardwareAutoDetect(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "test" || nodeEnv === "ci") return true;
  const ci = String(env.CI ?? "").toLowerCase();
  return ci === "1" || ci === "true";
}

/**
 * Read total RAM, available memory, and swap. /proc/meminfo when present,
 * otherwise os.totalmem/freemem and no swap signal.
 *
 * @param {{ readFileSync?: Function, totalmem?: Function, freemem?: Function }} [io]
 */
export function readHostMemory(io = {}) {
  const readFileSync = io.readFileSync || fs.readFileSync;
  const totalmem = io.totalmem || os.totalmem;
  const freemem = io.freemem || os.freemem;
  const totalBytes = Number(totalmem()) || 0;
  const freeBytes = Number(freemem()) || 0;
  let swapTotalKb = 0;
  let swapFreeKb = 0;
  let memAvailableKb = 0;
  let memTotalKb = 0;
  try {
    const text = readFileSync("/proc/meminfo", "utf8");
    for (const line of String(text).split("\n")) {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (!match) continue;
      const kb = Number(match[2]);
      if (match[1] === "SwapTotal") swapTotalKb = kb;
      else if (match[1] === "SwapFree") swapFreeKb = kb;
      else if (match[1] === "MemAvailable") memAvailableKb = kb;
      else if (match[1] === "MemTotal") memTotalKb = kb;
    }
  } catch {
    // Non-Linux or unreadable procfs — RAM from os.*, swap unknown.
  }
  const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);
  const resolvedTotal = memTotalKb > 0 ? memTotalKb * 1024 : totalBytes;
  const availableBytes = memAvailableKb > 0 ? memAvailableKb * 1024 : freeBytes;
  return {
    totalBytes: resolvedTotal,
    availableBytes,
    swapTotalKb,
    swapUsedKb,
    swapPressure: swapTotalKb > 0 ? swapUsedKb / swapTotalKb : 0,
    availableRatio: resolvedTotal > 0 ? availableBytes / resolvedTotal : 1,
  };
}

/**
 * Pure decision. Pass `snapshot` and `env` in tests; omit both to read the
 * live host (subject to the NODE_ENV=test short-circuit).
 *
 * @param {ReturnType<typeof readHostMemory>} [snapshot]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isLowMemoryHost(snapshot, env = process.env) {
  if (env.CONCORD_LOW_MEMORY_HOST === "0") return false;
  if (env.CONCORD_LOW_MEMORY_HOST === "1") return true;
  if (_skipHardwareAutoDetect(env)) return false;

  const snap = snapshot || readHostMemory();
  const ramCeiling = _num(env.CONCORD_LOW_MEMORY_RAM_BYTES, RAM_16GB);
  if (snap.totalBytes > 0 && snap.totalBytes <= ramCeiling) return true;

  const swapBar = _num(env.CONCORD_SWAP_PRESSURE_RATIO, 0.5);
  if (snap.swapTotalKb > 0 && snap.swapPressure >= swapBar) return true;

  const availableFloor = _num(env.CONCORD_MEM_AVAILABLE_MIN_RATIO, 0.15);
  if (snap.totalBytes > 0 && snap.availableRatio <= availableFloor) return true;

  return false;
}

function _liveProfile() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_MS) return _cache;
  const memory = readHostMemory();
  _cache = { memory, lowMemory: isLowMemoryHost(memory) };
  _cacheAt = now;
  return _cache;
}

/** Pause city presence, cognitive work, lattice passes, and lore synthesis. */
export function shouldPauseHeavyBackground() {
  if (process.env.CONCORD_LOW_MEMORY_HOST === "0") return false;
  if (process.env.CONCORD_LOW_MEMORY_HOST === "1") return true;
  if (_skipHardwareAutoDetect()) return false;
  return _liveProfile().lowMemory;
}

/** LLM model pull/warm stays off on a low-memory host. First request can load on demand. */
export function shouldAutoLoadLlmModels() {
  return !shouldPauseHeavyBackground();
}

/** Diagnostics for /health. Does not affect the liveness status code. */
export function getHostIdentity() {
  let lowMemory = false;
  try { lowMemory = shouldPauseHeavyBackground(); } catch { /* diagnostic only */ }
  return {
    hostname: os.hostname(),
    role: process.env.HOST_ROLE || null,
    lowMemory,
  };
}

export function _resetHostProfileCacheForTest() {
  _cache = null;
  _cacheAt = 0;
}
