// server/domains/arc.js — Sere main-arc payoff macros. The final quest beat
// ("heal the Twin Pact") triggers the mechanical consequence: cut the Tessera's
// managed-parity funding so the war can finally resolve and the Open Table can
// cohere. arc.open_table_status reports whether the funding still holds.

import { healTwinPact, activeFunding } from "../lib/tessera-parity.js";

export default function registerArcMacros(register) {
  register("arc", "heal_twin_pact", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return healTwinPact(db, { worldId: input.worldId || "sere" });
  }, { note: "Sere arc payoff: cut the managed-parity funding + flip Dovrane/Keshar toward truce." });

  register("arc", "open_table_status", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const funded = activeFunding(db, input.worldId || "sere").length;
    // The Open Table can cohere once the anchors' war is no longer kept lit.
    return { ok: true, managedWarsActive: funded, openTableCanCohere: funded === 0 };
  }, { note: "Whether the Tessera's managed parity still holds (blocks the Open Table) or has been cut." });
}
