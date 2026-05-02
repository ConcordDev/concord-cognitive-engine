// server/lib/world-crisis.js
// Civilization-level crises: visible to all worlds, last 72h, resolve into chronicle.

import crypto from "crypto";
import logger from "../logger.js";

const CRISIS_DURATION_MS = 72 * 60 * 60 * 1000; // 72 hours

export const CRISIS_TYPES = {
  substrate_corruption:   "A hybrid skill is spreading corrupted patterns across worlds.",
  emergent_uprising:      "A Cipher-tier emergent has declared independence from the substrate.",
  knowledge_extinction:   "An entire skill family is being forgotten — no practitioners remain.",
  faction_war:            "Two factions have escalated to open conflict across all worlds.",
  dark_world:             "A world has gone silent — no emergent activity detected.",
};

export function getActiveCrises(db) {
  const now = Date.now();
  return db.prepare(`SELECT * FROM world_crises WHERE status = 'active' AND ends_at > ? ORDER BY started_at DESC`).all(now);
}

export function triggerCrisis(db, type, worldId, realtimeEmit) {
  if (!CRISIS_TYPES[type]) return { ok: false, error: "unknown_crisis_type" };

  const existing = db.prepare(`SELECT id FROM world_crises WHERE type = ? AND status = 'active'`).get(type);
  if (existing) return { ok: false, error: "crisis_already_active", id: existing.id };

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO world_crises (id, type, description, origin_world_id, started_at, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, type, CRISIS_TYPES[type], worldId, now, now + CRISIS_DURATION_MS);

  realtimeEmit("world:crisis", {
    id, type,
    description: CRISIS_TYPES[type],
    originWorldId: worldId,
    endsAt: now + CRISIS_DURATION_MS,
  });

  return { ok: true, id };
}

export async function resolveCrisis(db, crisisId, resolution, realtimeEmit) {
  const crisis = db.prepare("SELECT * FROM world_crises WHERE id = ?").get(crisisId);
  if (!crisis) return { ok: false, error: "not_found" };

  db.prepare(`UPDATE world_crises SET status = 'resolved', resolved_by = ?, outcome = ? WHERE id = ?`)
    .run(resolution.resolvedBy || null, resolution.outcome || null, crisisId);

  // Award Sparks to all contributing players
  if (resolution.contributorIds?.length > 0) {
    try {
      const { awardSparks } = await import("./currency.js");
      for (const uid of resolution.contributorIds) {
        awardSparks(db, uid, 25, `crisis_resolved:${crisis.type}`, crisis.origin_world_id);
      }
    } catch (err) {
      logger?.debug?.('[world-crisis] optional step skipped', { reason: err?.message });
    }
  }

  try {
    const { recordEvent } = await import("../emergent/history-engine.js");
    recordEvent("era_transition", {
      description: `Crisis resolved: ${crisis.type}. ${resolution.outcome || ""}`.trim(),
      actorId: resolution.resolvedBy,
      significance: "crisis_resolution",
    });
  } catch (err) {
    logger?.debug?.('[world-crisis] optional step skipped', { reason: err?.message });
  }

  realtimeEmit("world:crisis-resolved", { id: crisisId, type: crisis.type, outcome: resolution.outcome });
  return { ok: true };
}

export async function expireOldCrises(db, realtimeEmit) {
  const expired = db.prepare(`SELECT * FROM world_crises WHERE status = 'active' AND ends_at <= ?`).all(Date.now());
  for (const crisis of expired) {
    await resolveCrisis(db, crisis.id, { outcome: "expired without resolution" }, realtimeEmit);
  }
  return expired.length;
}

// Called from server startup. Checks every hour for expired crises + auto-triggers
// knowledge_extinction when a substrate pattern has been declining for 3 cycles.
export function startCrisisWatch(db, realtimeEmit) {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;
  const run = async () => {
    await expireOldCrises(db, realtimeEmit).catch(err => logger?.debug?.('[world-crisis] background op failed', { err: err?.message }));

    // Auto-trigger knowledge_extinction if a pattern has been declining
    const decliningPatterns = db.prepare(`
      SELECT * FROM substrate_patterns WHERE trajectory = 'declining' AND current_strength < 0.2
    `).all();
    if (decliningPatterns.length > 0) {
      const worldId = decliningPatterns[0].worlds_present
        ? JSON.parse(decliningPatterns[0].worlds_present)[0] || "concordia-hub"
        : "concordia-hub";
      triggerCrisis(db, "knowledge_extinction", worldId, realtimeEmit);
    }
  };

  run().catch(err => logger?.debug?.('[world-crisis] background op failed', { err: err?.message }));
  return setInterval(run, CHECK_INTERVAL_MS);
}
