// server/emergent/movement-recruitment-cycle.js
//
// Living Society — Phase 5: the movement heartbeat. Each cadence, per world:
//   1. seed movements from grievance clusters,
//   2. recruit a fellow grudge-holder into each recruiting movement (growth),
//   3. tick each movement (threshold → acting),
//   4. let an enforcer/loyalist overhear (counter-intel → visibility/suppress).
// Deterministic candidate pick; never throws. scope:'world'.
// Kill-switch CONCORD_MOVEMENTS=0.

import {
  seedMovementFromGrievance, recruit, tickMovement, exposeMovement,
  listMovements, memberCount, getMovement,
} from "../lib/movements.js";
import { eruptUprising } from "../lib/uprising.js";

const MAX_RECRUIT_PER_PASS = Number(process.env.CONCORD_MOVEMENT_RECRUIT_PER_PASS) || 2;

export function runMovementRecruitmentCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_MOVEMENTS === "0") return { ok: false, reason: "disabled" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs WHERE COALESCE(is_dead,0)=0`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; }

  let seeded = 0, recruited = 0, acted = 0, suppressed = 0;
  for (const w of worlds) {
    try {
      const s = seedMovementFromGrievance(db, w);
      seeded += s.seeded?.length || 0;

      for (const m of listMovements(db, w, "recruiting").concat(listMovements(db, w, "organized"))) {
        // Recruit fellow grudge-holders against the same target who aren't members yet.
        let candidates = [];
        try {
          candidates = db.prepare(`
            SELECT DISTINCT g.npc_id FROM npc_grudges g
            JOIN world_npcs n ON n.id = g.npc_id
            WHERE g.resolved_at IS NULL AND n.world_id = ? AND g.target_kind = ? AND g.target_id = ?
              AND g.npc_id NOT IN (SELECT member_id FROM movement_members WHERE movement_id = ? AND member_kind='npc' AND left_at IS NULL)
            LIMIT ?
          `).all(w, m.target_kind, m.target_id, m.id, MAX_RECRUIT_PER_PASS);
        } catch { candidates = []; }
        for (const c of candidates) {
          const r = recruit(db, m.id, "npc", c.npc_id, { role: "soldier" });
          if (r.ok) recruited++;
        }

        // Counter-intel: high visibility risks an overhear that can suppress.
        if ((m.visibility_level || 0) >= 60 && memberCount(db, m.id) > 0) {
          const e = exposeMovement(db, m.id, { method: "loyalist_overhear", amount: 12 });
          if (e.suppressed) suppressed++;
        }

        const t = tickMovement(db, m.id);
        if (t.acted) {
          acted++;
          // Phase 6 — the movement erupts into a rebellion (faction-strategy
          // move + world event). Idempotent on movement_id.
          try { eruptUprising(db, getMovement(db, m.id) || m); } catch { /* isolation */ }
        }
      }
    } catch { /* per-world isolation */ }
  }
  return { ok: true, worlds: worlds.length, seeded, recruited, acted, suppressed };
}
