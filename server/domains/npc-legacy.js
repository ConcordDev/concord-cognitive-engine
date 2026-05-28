// server/domains/npc-legacy.js
//
// Sprint B Phase 11.1 — surfaces the npc-legacy substrate (Phase 5b
// migration 133 + lib/npc-legacy.js) to the frontend so death produces
// a player-visible tomb + last-words + inheritance log.
//
// Distinct from server/domains/legacy.js (which handles technical-debt
// analysis on code artifacts). This domain is NPC-death narrative.
// Domain key: 'npc_legacy'.
//
// Read-only — the actual onNpcDeath fires from the combat / consequence
// path. We just expose lookups for the renderer.

import {
  getLegacy,
  getTombsForWorld,
  getInheritanceForHeir,
  getInheritanceFromDeceased,
} from "../lib/npc-legacy.js";

export default function registerNpcLegacyMacros(register) {
  // npc_legacy.tombs_for_world — list tombs (bounded) for the active world.
  // Frontend TombMarker reads this on world load + on `entity:death`
  // socket events to refresh.
  register("npc_legacy", "tombs_for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "missing_world_id" };
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 200));
    const tombs = getTombsForWorld(db, input.worldId, limit);
    return { ok: true, tombs, count: tombs.length };
  });

  // npc_legacy.get — full legacy record for a single NPC. Returns last
  // words + heirs + inheritance bundle (grudges/preoccupations/desires/
  // recipes/wealth carried forward).
  register("npc_legacy", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.npcId) return { ok: false, reason: "missing_npc_id" };
    const legacy = getLegacy(db, input.npcId);
    if (!legacy) return { ok: false, reason: "no_legacy" };
    return { ok: true, legacy };
  });

  // npc_legacy.inheritance_for_heir — used by the InheritanceLog UI when
  // an NPC the player knows is named as an heir to a deceased NPC the
  // player witnessed. Surfaces the cross-time narrative thread.
  register("npc_legacy", "inheritance_for_heir", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.heirNpcId) return { ok: false, reason: "missing_heir_npc_id" };
    const links = getInheritanceForHeir(db, input.heirNpcId);
    return { ok: true, links, count: links.length };
  });

  // npc_legacy.inheritance_from_deceased — T2.2: outgoing thread from a tomb.
  // The InheritanceLog UI reads this when a player opens a tomb: "this NPC's
  // grudges/recipes/wealth passed to these heirs". Heir names joined when
  // world_npcs is available.
  register("npc_legacy", "inheritance_from_deceased", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.deceasedNpcId) return { ok: false, reason: "missing_deceased_npc_id" };
    const links = getInheritanceFromDeceased(db, input.deceasedNpcId);
    return { ok: true, links, count: links.length };
  });
}
