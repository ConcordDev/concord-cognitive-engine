// Read-your-write floor for critical state saves (FIX-veterinary-012).
//
// The platform's state snapshot is written by three paths: the debounced
// coalesce (ordinary mutations; up to STATE_SAVE_COALESCE_MS behind), the
// sync save, and the critical save (rate-limited — inside its window the
// durable write lands at window end, not immediately). Any read served
// from a persisted snapshot — a serving process booting or restarting, a
// read replica sharing DATA_DIR — hydrates whatever snapshot is newest on
// disk. Before this module, nothing let such a reader tell that the
// snapshot predated a critical write that had already been accepted: a
// record deleted through a critical save could be served again by a
// snapshot read landing inside the window (the veterinary-012
// resurrection, priced platform-wide by B4/B9 — CB-0617 Desk Residual 1).
//
// The discipline is deliberately small:
//   - Every snapshot self-describes the mutation sequence it serialized
//     (`saveSeq`, stamped by _serializeState in server.js).
//   - saveStateCritical durably stamps a FLOOR — {seq, at} in a tiny
//     sidecar next to the state file — BEFORE its rate-window decision,
//     so the floor exists even while the full save is still pending.
//   - A snapshot reader (loadStateFromDisk) serves a snapshot only when
//     it satisfies the floor; otherwise it waits, bounded, for the
//     writer's pending save, and degrades loudly (never silently) if the
//     wait expires.
// Ordinary (debounced) saves never write a floor, so the ordinary path's
// behaviour is unchanged by construction. The topology assumption is the
// platform's own: ONE writer process owns state persistence; replicas
// are read-only and share DATA_DIR, so the sidecar is visible to every
// reader it protects.

import fs from "node:fs";
import { writeFileAtomicSync } from "./state-file-write.js";

/** The floor-stamp sidecar path for a given state file path. */
export function criticalStampPathFor(statePath) {
  return `${statePath}.critical.json`;
}

/**
 * Durably record that a critical write exists at mutation sequence
 * `seq` (wall time `at`, ISO). Bytes, not megabytes — an atomic rename
 * of a tiny JSON document, safe to do synchronously on the critical
 * path. Throws on I/O failure; the caller decides the fail-soft policy.
 */
export function writeCriticalStamp(stampPath, { seq, at }) {
  writeFileAtomicSync(stampPath, JSON.stringify({ seq, at }));
}

/**
 * Read the current floor stamp, or null when none exists (no critical
 * write has ever been stamped, or the stamp is unreadable — an
 * unreadable stamp must not block state loading on its own).
 */
export function readCriticalStamp(stampPath) {
  try {
    const obj = JSON.parse(fs.readFileSync(stampPath, "utf-8"));
    if (obj && Number.isFinite(obj.seq)) {
      return { seq: obj.seq, at: typeof obj.at === "string" ? obj.at : "" };
    }
  } catch (_e) { /* absent or corrupt stamp = no floor */ }
  return null;
}

/**
 * May a reader serve this snapshot under this floor?
 * snapshot: { saveSeq?: number|null, savedAt?: string|null } — the
 * stamp fields _serializeState writes (saveSeq absent on snapshots
 * serialized before the field existed).
 * stamp: { seq, at } | null — null means no critical write is pending
 * or outstanding, so every snapshot is servable (the ordinary path).
 *
 * A snapshot satisfies the floor when BOTH orderings it can prove agree
 * it is not older than the critical write: its saveSeq reaches the
 * floor's seq (when it carries one) AND its savedAt is not before the
 * stamp's time (when both carry one). A pre-seq snapshot must prove
 * freshness by savedAt alone; a snapshot that can prove nothing is not
 * servable under a floor — the reader waits, bounded, rather than
 * risking serving pre-write state as current.
 */
export function snapshotSatisfiesFloor(snapshot, stamp) {
  if (!stamp) return true;
  if (!snapshot) return false;
  const hasSeq = Number.isFinite(snapshot.saveSeq);
  if (hasSeq && snapshot.saveSeq < stamp.seq) return false;
  const hasAt = typeof snapshot.savedAt === "string" && snapshot.savedAt !== "";
  const stampHasAt = typeof stamp.at === "string" && stamp.at !== "";
  if (hasAt && stampHasAt && snapshot.savedAt < stamp.at) return false;
  if (!hasSeq && !hasAt) return false;
  return true;
}
