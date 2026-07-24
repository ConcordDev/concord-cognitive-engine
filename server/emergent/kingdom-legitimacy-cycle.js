// server/emergent/kingdom-legitimacy-cycle.js
//
// Wire-the-unwired (Layer-12 pattern) — `server/lib/kingdom-takeover.js`
// exports a fully-built `tickLegitimacy(db)` (decree-popularity-driven
// legitimacy regen/decay across every realm) but had ZERO callers anywhere
// in the codebase. Without a heartbeat, a realm's legitimacy never
// organically drifts and nothing autonomously forces a succession crisis
// when a ruler-less realm just sits in `interregnum` forever.
//
// This module does two things per pass:
//
//   1. Calls the real `tickLegitimacy(db)` — unmodified, imported lazily —
//      which walks every realm and nudges `legitimacy` toward the most
//      recent decree's popularity (the function's own logic; this module
//      never reimplements it).
//   2. Auto-succession sweep: any realm that has BOTH (a) legitimacy at the
//      real floor `tickLegitimacy`/the `realms.legitimacy` CHECK constraint
//      already use (0 — `MAX(0, MIN(100, ...))` in tickLegitimacy, `CHECK
//      (legitimacy BETWEEN 0 AND 100)` in migration 158) AND (b) is
//      currently `ruler_kind = 'interregnum'` gets a new NPC ruler assigned
//      via the same heir-finding logic `npc-legacy.js#onNpcDeath` uses
//      elsewhere (`findHeirs`), landing at the legitimacy value the game's
//      OWN inheritance takeover path already uses
//      (`TAKEOVER_CONSTANTS.INHERITANCE_LEGITIMACY`, from
//      `kingdom-takeover.js`) — no new legitimacy constant invented here.
//
// Safety-critical guard (explicitly required, not incidental): a realm the
// player currently holds, or is actively contesting, is NEVER touched by
// the auto-succession sweep. The SQL only selects `ruler_kind =
// 'interregnum'` rows in the first place, and the loop re-checks
// `realm.ruler_kind === 'player'` defensively before ever calling
// `assignRuler`, so a future change to the SELECT can't silently reintroduce
// the bug. `takeoverByConquest` / `takeoverByInheritance` /
// `takeoverByElection` (the PLAYER-facing takeover paths) are the only
// legitimate way a player becomes ruler — this cycle only ever assigns an
// NPC.
//
// Every DB access is best-effort + try/catch-isolated per realm — a
// missing table, a malformed row, or a downstream throw never stops the
// tick and never blocks other realms in the same pass (heartbeat
// invariant: a module crash must never stop the tick).
//
// Kill-switch: CONCORD_KINGDOM_LEGITIMACY=0.

import logger from "../logger.js";

// The real floor `tickLegitimacy`'s own `MAX(0, ...)` clamp and the
// `realms.legitimacy CHECK (... BETWEEN 0 AND 100)` constraint (migration
// 158) both already use — not a value invented for this module.
const LEGITIMACY_COLLAPSE_FLOOR = 0;

function enabled() {
  return process.env.CONCORD_KINGDOM_LEGITIMACY !== "0";
}

/**
 * Auto-resolve a single collapsed, ruler-less realm. Isolated so a bad
 * row (missing faction_id, findHeirs throwing, assignRuler failing) never
 * takes out the rest of the sweep.
 */
function tryAutoResolveRealm(db, realm, { findHeirs, assignRuler, inheritanceLegitimacy }) {
  // Safety-critical guard, defensive even though the caller's SELECT
  // already filters to `ruler_kind = 'interregnum'`: never touch a realm a
  // player currently holds or is actively contesting.
  if (!realm || realm.ruler_kind === "player") return null;
  if (realm.ruler_kind !== "interregnum") return null;

  // findHeirs() wants an NPC-shaped object (id/faction/archetype). A realm
  // in interregnum has ruler_id = null (deposeRuler nulls it), so there's
  // no literal "deceased ruler" row to hand it — synthesize a reference
  // keyed to the realm's faction so the same-faction heir lookup inside
  // findHeirs still has something real to match against. The synthetic id
  // deliberately can't collide with a real world_npcs row (findHeirs'
  // children lookup on it is a harmless no-op; the faction-mate lookup is
  // the path that actually matters here).
  const deceasedRef = {
    id: realm.ruler_id || `vacant-throne:${realm.id}`,
    faction: realm.faction_id || null,
    archetype: null,
  };

  const heirs = findHeirs(db, deceasedRef);
  if (!Array.isArray(heirs) || heirs.length === 0) return { ok: false, reason: "no_heirs" };
  const heir = heirs[0];
  if (!heir?.id) return { ok: false, reason: "malformed_heir" };

  const assign = assignRuler(db, realm.id, {
    rulerKind: "npc",
    rulerId: heir.id,
    legitimacy: inheritanceLegitimacy,
  });
  if (!assign?.ok) return { ok: false, reason: assign?.reason || "assign_failed" };
  if (!assign.changes) return { ok: false, reason: "no_change" };
  return { ok: true, heirId: heir.id };
}

export async function runKingdomLegitimacyCycle({ db, io: _io, state: _state, tickCount: _tickCount } = {}) {
  if (!enabled()) return { ok: true, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let kingdomTakeover, npcLegacy, kingdoms;
  try {
    [kingdomTakeover, npcLegacy, kingdoms] = await Promise.all([
      import("../lib/kingdom-takeover.js"),
      import("../lib/npc-legacy.js"),
      import("../lib/kingdoms.js"),
    ]);
  } catch (err) {
    try { logger.warn("kingdom-legitimacy-cycle", "modules_unavailable", { error: err?.message }); } catch { /* ignore */ }
    return { ok: false, reason: "modules_unavailable", error: err?.message };
  }

  const { tickLegitimacy, TAKEOVER_CONSTANTS } = kingdomTakeover;
  const { findHeirs } = npcLegacy;
  const { assignRuler } = kingdoms;
  if (typeof tickLegitimacy !== "function" || typeof findHeirs !== "function" || typeof assignRuler !== "function") {
    return { ok: false, reason: "missing_exports" };
  }

  let tickResult;
  try {
    tickResult = tickLegitimacy(db);
  } catch (err) {
    try { logger.warn("kingdom-legitimacy-cycle", "tick_failed", { error: err?.message }); } catch { /* ignore */ }
    tickResult = { ok: false, reason: "tick_threw", error: err?.message };
  }

  // Auto-succession sweep — only realms sitting at the real legitimacy
  // floor AND currently ruler-less (interregnum). A player-held realm is
  // structurally excluded by the WHERE clause itself, then re-checked
  // per-row below (belt-and-suspenders on the safety-critical path).
  let autoResolved = 0;
  const autoResolvedIds = [];
  try {
    const collapsed = db.prepare(`
      SELECT * FROM realms WHERE legitimacy <= ? AND ruler_kind = 'interregnum'
    `).all(LEGITIMACY_COLLAPSE_FLOOR);

    for (const realm of collapsed) {
      try {
        const result = tryAutoResolveRealm(db, realm, {
          findHeirs,
          assignRuler,
          inheritanceLegitimacy: TAKEOVER_CONSTANTS?.INHERITANCE_LEGITIMACY ?? 60,
        });
        if (result?.ok) {
          autoResolved++;
          autoResolvedIds.push(realm.id);
          try {
            logger.info?.("kingdom-legitimacy-cycle", "auto_succession", {
              kingdomId: realm.id, heirId: result.heirId,
            });
          } catch { /* ignore */ }
        }
      } catch (err) {
        try { logger.warn("kingdom-legitimacy-cycle", "realm_succession_failed", { kingdomId: realm?.id, error: err?.message }); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    // realms table missing / query failed — honest degrade, never throw.
    try { logger.debug?.("kingdom-legitimacy-cycle", "collapse_sweep_unavailable", { error: err?.message }); } catch { /* ignore */ }
    return {
      ok: true,
      tick: tickResult,
      autoResolved: 0,
      autoResolvedIds: [],
      reason: "collapse_sweep_unavailable",
    };
  }

  return {
    ok: true,
    tick: tickResult,
    autoResolved,
    autoResolvedIds,
  };
}

// test seam
export const _internal = { tryAutoResolveRealm, LEGITIMACY_COLLAPSE_FLOOR };
