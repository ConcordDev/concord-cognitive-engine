// server/emergent/cognitive-fingerprint-cycle.js
//
// Cognitive Fingerprint (#5) — bounded, try/catch-isolated heartbeat that
// snapshots each active author's thinking-style profile so cognition.
// fingerprint_history shows real trends over time. Kill-switch
// CONCORD_COGNITIVE_FINGERPRINT=0.

import { snapshotFingerprint } from "../lib/cognitive-fingerprint.js";

const PER_PASS = Number(process.env.CONCORD_COGFP_PER_PASS || 25);

export async function runCognitiveFingerprintCycle({ db } = {}) {
  if (process.env.CONCORD_COGNITIVE_FINGERPRINT === "0") return { ok: true, skipped: "disabled" };
  if (!db) return { ok: true, skipped: "no_db" };
  let snapshotted = 0;
  let users = [];
  try {
    users = db.prepare(
      "SELECT DISTINCT creator_id AS uid FROM dtus WHERE creator_id IS NOT NULL AND creator_id != 'system' LIMIT ?"
    ).all(PER_PASS);
  } catch {
    return { ok: true, snapshotted: 0 };
  }
  for (const u of users) {
    if (snapshotFingerprint(db, u.uid)) snapshotted += 1; // each call is bounded, no inner loop
  }
  return { ok: true, snapshotted };
}

export default runCognitiveFingerprintCycle;
