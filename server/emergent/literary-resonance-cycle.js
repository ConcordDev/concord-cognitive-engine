// server/emergent/literary-resonance-cycle.js
//
// LRL Phase 2 — heartbeat that crystallizes cross-domain resonance edges for the
// literary corpus. Each pass picks literary chunk-DTUs that carry an embedding
// but have no resonance edges yet, and computes their nearest cross-domain
// neighbours (lib/literary-resonance.js). Bounded per pass so it never stalls a
// tick; fully try/catch isolated (heartbeat invariant: never throw).
//
// Wire-up in server.js:
//   import { runLiteraryResonanceCycle } from "./emergent/literary-resonance-cycle.js";
//   registerHeartbeat("literary-resonance-cycle", { frequency: 200, scope: "global",
//     handler: () => runLiteraryResonanceCycle({ db }) });
//
// Kill-switch: CONCORD_LITERARY_RESONANCE=0.

import { computeResonanceForDtu } from "../lib/literary-resonance.js";

const PER_PASS = Number(process.env.LRL_RESONANCE_PER_PASS || 25);

export async function runLiteraryResonanceCycle({ db, limit } = {}) {
  if (process.env.CONCORD_LITERARY_RESONANCE === "0") return { ok: true, skipped: "disabled" };
  if (!db) return { ok: true, skipped: "no_db" };

  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT c.dtu_id AS dtuId
      FROM literary_chunks c
      JOIN embedding_cache e ON e.dtu_id = c.dtu_id
      WHERE c.dtu_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM literary_resonance_edges r WHERE r.literary_dtu_id = c.dtu_id
        )
      LIMIT ?
    `).all(Number(limit) || PER_PASS);
  } catch {
    // embedding_cache or literary tables not present yet — nothing to do.
    return { ok: true, processed: 0, edges: 0 };
  }

  let processed = 0;
  let edges = 0;
  for (const c of candidates) {
    try {
      const r = computeResonanceForDtu(db, c.dtuId);
      processed += 1;
      edges += r?.edges || 0;
    } catch {
      // One DTU failing must not abort the pass.
    }
  }

  return { ok: true, processed, edges };
}

export default runLiteraryResonanceCycle;
