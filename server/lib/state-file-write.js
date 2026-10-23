// Atomic state-snapshot file writes that are safe under overlapping saves.
//
// Live bug (2026-10-19..22, `state_save_failed` ×10): four save paths
// (debounced/chunked async, sync, 5-min periodic, shutdown) all wrote the
// SAME `concord_state.json.tmp`. The debounced path yields mid-write, so a
// sync save landing in that gap wrote+renamed the shared tmp file; the async
// save then renamed a file that no longer existed (ENOENT) — or, worse, could
// rename a tmp another writer had half-overwritten. Each write now gets its
// own tmp path, and a monotonic sequence ensures a slower, OLDER snapshot can
// never be renamed over a newer one that already reached disk.

import fs from "node:fs";
import path from "node:path";

let _tmpCounter = 0;

/** A tmp path unique to this process + write: `<target>.<pid>.<n>.tmp`. */
export function uniqueTmpPath(target) {
  _tmpCounter = (_tmpCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${target}.${process.pid}.${_tmpCounter}.tmp`;
}

/**
 * Tracks which mutation sequence is on disk so out-of-order completions are
 * discarded instead of regressing the snapshot.
 */
export function createSnapshotOrdering() {
  let onDiskSeq = -1;
  return {
    /** True if a snapshot taken at `seq` is still the newest worth persisting. */
    isCurrent(seq) { return seq >= onDiskSeq; },
    /** Record that the snapshot taken at `seq` is now on disk. */
    committed(seq) { if (seq > onDiskSeq) onDiskSeq = seq; },
    get onDiskSeq() { return onDiskSeq; },
  };
}

/** Synchronous atomic write: unique tmp → rename. Cleans its tmp on failure. */
export function writeFileAtomicSync(target, data) {
  const tmp = uniqueTmpPath(target);
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* already gone */ }
    throw e;
  }
}

/**
 * Remove tmp files left behind by a crash mid-write (`<target>.tmp` legacy
 * name and `<target>.<pid>.<n>.tmp`). Call once at boot, before any save.
 * @returns {number} files removed
 */
export function sweepStaleStateTmps(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_e) { return 0; }
  for (const n of names) {
    if (n === `${base}.tmp` || (n.startsWith(`${base}.`) && /^\.\d+\.\d+\.tmp$/.test(n.slice(base.length)))) {
      try { fs.unlinkSync(path.join(dir, n)); removed++; } catch (_e) { /* best effort */ }
    }
  }
  return removed;
}
