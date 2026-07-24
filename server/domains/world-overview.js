// server/domains/world-overview.js
//
// V1.2 Wave D (Worlds & Simulation Depth) — read-only aggregation backend
// for a future "observatory" frontend view (a separate, dependent unit
// builds that surface). Concord had no large-scale simulation observability:
// world-health-monitor.js's pathology detection was consumed only
// server-side (repair.js + tests), Layer-11 faction strategy state lived
// behind per-faction/per-realm macros with no per-world roll-up, and
// /lenses/ops-telemetry showed infra health only (heartbeat timing, worker
// pools, brain endpoints) — zero simulation *content*.
//
// This domain adds NO new tables and performs NO mutation. It is pure
// composition of existing real getters:
//   - population   : live in-memory presence count (city-presence.js#getWorldUserCount)
//   - factions     : Layer-11 faction_strategy_state + faction_relations,
//                    scoped to this world via world_npcs.faction (the same
//                    best-effort world-resolution signal
//                    embodied/faction-strategy.js#resolveFactionWorldId uses
//                    elsewhere — never treated as authoritative ownership)
//   - realms       : kingdoms.js#listKingdomsForWorld + #kingdomLoyaltySummary
//                    (real legitimacy/treasury/tax_rate + citizen loyalty)
//   - districts    : scene-export.js#exportScene's districts array (the
//                    canonical real areaM2/buildingCount computation the
//                    district-streaming policy already relies on — reused,
//                    not re-derived, so there is no drift risk)
//   - health       : world-health.js#detectPathologies (a PURE read — no
//                    heal/escalate side effects, unlike runWorldHealthPass),
//                    filtered to the 'liveness' (stuck faction scheduler)
//                    category only. The 'economy' category (negative
//                    balances / dupe citations) is deliberately EXCLUDED —
//                    those findings carry other users' private wallet data
//                    (see server/domains/repair.js's own comment on this
//                    exact leak risk) and are user-scoped, not world-scoped,
//                    so surfacing them here would have no honest per-world
//                    meaning and would leak private financial data through
//                    an otherwise-unauthenticated aggregation surface.
//
// A world with genuinely no faction/realm/district/presence data gets an
// honest empty array / zero count for that section — never a fabricated
// placeholder number.
//
// Macros:
//   worldstate.overview      — { worldIds?: string[] } -> lightweight per-world summary list
//   worldstate.world_detail  — { worldId } -> full per-world deep-dive

import { listWorlds } from "../lib/world-loader.js";
import { listKingdomsForWorld, kingdomLoyaltySummary } from "../lib/kingdoms.js";
import { listDistricts } from "../lib/districts.js";
import { exportScene } from "../lib/scene-export.js";
import { getWorldUserCount } from "../lib/city-presence.js";
import { detectPathologies, classifyDisposition } from "../lib/world-health.js";

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

/**
 * Distinct faction ids with a living NPC presence in this world. Same
 * best-effort posture as embodied/faction-strategy.js#resolveFactionWorldId:
 * factions aren't strictly per-world, but a faction's living NPCs are a
 * reliable-enough signal for this kind of display/filtering aggregation —
 * never treated as authoritative ownership.
 */
function factionIdsForWorld(db, worldId) {
  return safe(() => db.prepare(`
    SELECT DISTINCT faction FROM world_npcs
     WHERE world_id = ? AND faction IS NOT NULL AND faction != 'neutral'
  `).all(worldId).map((r) => r.faction).filter(Boolean), []);
}

function factionSummaryForWorld(db, factionIds) {
  if (!factionIds.length) return { count: 0, states: [], relations: [] };
  const ph = factionIds.map(() => "?").join(",");
  const states = safe(() => db.prepare(`
    SELECT faction_id AS factionId, stance, target_id AS target,
           ROUND(momentum, 3) AS momentum, phase
      FROM faction_strategy_state
     WHERE faction_id IN (${ph})
     ORDER BY factionId
  `).all(...factionIds), []);
  const relations = safe(() => db.prepare(`
    SELECT faction_a AS a, faction_b AS b, ROUND(score, 3) AS score, kind
      FROM faction_relations
     WHERE faction_a IN (${ph}) OR faction_b IN (${ph})
     ORDER BY a, b
  `).all(...factionIds, ...factionIds), []);
  return { count: factionIds.length, states, relations };
}

function realmSummaryForWorld(db, worldId) {
  const realms = safe(() => listKingdomsForWorld(db, worldId), []);
  return realms.map((r) => ({
    id: r.id,
    name: r.name,
    factionId: r.faction_id,
    rulerKind: r.ruler_kind,
    rulerId: r.ruler_id,
    legitimacy: r.legitimacy,
    treasury: r.treasury,
    taxRate: r.tax_rate,
    citizens: safe(() => kingdomLoyaltySummary(db, r.id), { avg: 0, count: 0, low: 0, high: 0 }),
  }));
}

function districtSummaryForWorld(db, worldId) {
  // Reuse the canonical district+buildingCount+areaM2 computation from
  // scene-export.js (the same math the district-streaming policy relies
  // on) instead of re-deriving point-in-polygon math here and risking drift.
  const scene = safe(() => exportScene(db, worldId), null);
  if (scene?.ok && Array.isArray(scene.districts)) {
    return scene.districts.map((d) => ({
      id: d.id, name: d.name, areaM2: d.areaM2, buildingCount: d.buildingCount,
      lightingTag: d.lightingTag,
    }));
  }
  // exportScene failed (e.g. a world_buildings query error) — fall back to
  // the plain district list without density. Honest partial, never
  // fabricated: areaM2/buildingCount are null, not a guessed number.
  return safe(() => listDistricts(db, worldId), []).map((d) => ({
    id: d.id, name: d.name, areaM2: null, buildingCount: null, lightingTag: d.lightingTag,
  }));
}

/**
 * Faction-scheduler liveness findings scoped to this world, derived from an
 * already-computed pathology list (so a caller aggregating many worlds only
 * scans the DB once). `detectPathologies` is a PURE read — it never heals or
 * escalates — so calling it here adds no side effects beyond the existing
 * ~4h heartbeat pass.
 */
function healthForWorld(allFindings, factionIds) {
  const ids = new Set(factionIds);
  const findings = allFindings
    .filter((f) => f.category === "liveness" && ids.has(f.subjectId))
    .map((f) => ({ ...f, disposition: classifyDisposition(f.pathology) }));
  return {
    // Platform-wide total pathology count (all categories, all worlds) —
    // explicitly NOT a per-world number; detectPathologies scans the whole
    // DB. Included for context only.
    platformWideChecked: allFindings.length,
    factionSchedulerFindings: findings,
  };
}

function computeWorldAggregate(db, worldId, { pathologies = null } = {}) {
  const factionIds = factionIdsForWorld(db, worldId);
  const allFindings = pathologies ?? safe(() => detectPathologies(db), []);
  return {
    worldId,
    population: {
      activeUsers: safe(() => getWorldUserCount(worldId), 0),
    },
    factions: factionSummaryForWorld(db, factionIds),
    realms: realmSummaryForWorld(db, worldId),
    districts: districtSummaryForWorld(db, worldId),
    health: healthForWorld(allFindings, factionIds),
  };
}

export default function registerWorldOverviewMacros(register) {
  // world_detail — the full per-world deep-dive.
  register("worldstate", "world_detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return { ok: true, ...computeWorldAggregate(db, worldId) };
  });

  // overview — lightweight per-world summary across every active world (or
  // a caller-supplied worldIds subset). Reuses computeWorldAggregate so the
  // counts here can never drift from world_detail's own numbers.
  register("worldstate", "overview", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const requestedIds = Array.isArray(input?.worldIds)
      ? input.worldIds.map((v) => String(v || "").trim()).filter(Boolean)
      : null;

    let worldRows;
    if (requestedIds && requestedIds.length) {
      const nameById = safe(() => new Map(listWorlds(db).map((w) => [w.id, w.name])), new Map());
      worldRows = requestedIds.map((id) => ({ id, name: nameById.get(id) || id }));
    } else {
      worldRows = safe(() => listWorlds(db).map((w) => ({ id: w.id, name: w.name })), []);
    }

    // One pathology scan shared across every world in this overview — the
    // per-world filtering happens in computeWorldAggregate/healthForWorld.
    const pathologies = safe(() => detectPathologies(db), []);

    const worlds = worldRows.map((w) => {
      const agg = computeWorldAggregate(db, w.id, { pathologies });
      return {
        worldId: w.id,
        name: w.name,
        activeUsers: agg.population.activeUsers,
        factionCount: agg.factions.count,
        realmCount: agg.realms.length,
        districtCount: agg.districts.length,
        stuckFactionSchedulers: agg.health.factionSchedulerFindings.length,
      };
    });

    return { ok: true, worlds };
  });
}
