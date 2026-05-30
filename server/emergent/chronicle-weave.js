// server/emergent/chronicle-weave.js
//
// Living Society — Phase 7: the Chronicle weave heartbeat. Ingests new beats
// (uprising / decree / recruitment / labor symptoms) into world_chronicle via
// per-source cursors, exactly-once. scope:'world'. Never throws.
// Kill-switch CONCORD_CHRONICLE=0.

import { weaveWorld } from "../lib/chronicle/chronicle.js";

export function runChronicleWeave({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_CHRONICLE === "0") return { ok: false, reason: "disabled" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs WHERE COALESCE(is_dead,0)=0`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; }
  let written = 0;
  for (const w of worlds) {
    try { written += weaveWorld(db, w).written || 0; } catch { /* per-world isolation */ }
  }
  return { ok: true, worlds: worlds.length, written };
}
