// server/domains/arc.js — Sere main-arc payoff macros. The final quest beat
// ("heal the Twin Pact") triggers the mechanical consequence: cut the Tessera's
// managed-parity funding so the war can finally resolve and the Open Table can
// cohere. arc.open_table_status reports whether the funding still holds.

import { healTwinPact, activeFunding } from "../lib/tessera-parity.js";

// The Twin Pact may only be healed by an authenticated player who has actually
// reached the final arc quest's heal/hold branch. `POST /api/lens/run` is public
// and runMacro bypasses the macro ACL for HTTP, so without this gate an anonymous
// web request could cut the managed-parity funding and flip the world's
// war-ending state globally — skipping the entire investigation payoff.
const HEAL_BRANCH_QUEST = "sere_arc_4_heal_the_pact";
function playerReachedHealBranch(db, userId, worldId) {
  try {
    const row = db.prepare(
      "SELECT status FROM player_quests WHERE user_id = ? AND world_id = ? AND quest_id = ?",
    ).get(userId, worldId, HEAL_BRANCH_QUEST);
    return !!row && (row.status === "active" || row.status === "completed");
  } catch {
    return false; // no player_quests table → fail closed
  }
}

export default function registerArcMacros(register) {
  register("arc", "heal_twin_pact", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || userId === "anon") return { ok: false, reason: "auth_required" };
    const worldId = input.worldId || "sere";
    if (!playerReachedHealBranch(db, userId, worldId)) return { ok: false, reason: "arc_not_reached" };
    return healTwinPact(db, { worldId });
  }, { note: "Sere arc payoff: cut the managed-parity funding + flip Dovrane/Keshar toward truce. Gated on reaching the final arc quest." });

  register("arc", "open_table_status", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const funded = activeFunding(db, input.worldId || "sere").length;
    // The Open Table can cohere once the anchors' war is no longer kept lit.
    return { ok: true, managedWarsActive: funded, openTableCanCohere: funded === 0 };
  }, { note: "Whether the Tessera's managed parity still holds (blocks the Open Table) or has been cut." });
}
