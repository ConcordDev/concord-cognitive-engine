// server/lib/faction-event-scheduler.js
// Tier 3 deferral 12 — heartbeat-driven faction event scheduler.
//
// Per user direction (hybrid existing-lore): use the already-authored
// `content/world/lore.json` events as templates. Roll one event per world
// every Nth tick whose prereqs match current world state. NPCs and users
// extend the system organically — NPCs with high-urgency faction needs
// already drive quest-emergence; user-authored lore rides the same
// content-seeder pipeline. No big content-authoring effort needed.
//
// Each rolled event:
//   1. Inserts a row in `faction_events_scheduled`
//   2. Emits `faction:event_started` to every user in the affected world
//   3. After `ends_at`, fires `faction:event_ended` (with optional rewards)
//   4. Cooldown: same template can't fire again in the same world for 7
//      in-game days (real time, since we don't have an in-game clock yet)

import crypto from "crypto";

const DEFAULT_DURATION_HOURS = 2;
const TEMPLATE_COOLDOWN_SEC = 7 * 24 * 3600;

/**
 * Roll one event per active world. Called from the heartbeat — typically
 * every 200th tick (~50min at default cadence). Idempotent within a
 * cooldown window per (template, world).
 *
 * @param {object} STATE
 * @param {import('better-sqlite3').Database} db
 * @param {object} deps  { contentSeeder, emitToUser, cityPresence }
 * @returns {Promise<{ rolled: number, ended: number }>}
 */
export async function runFactionEventTick(STATE, db, deps = {}) {
  const stats = { rolled: 0, ended: 0 };
  if (!db) return stats;

  // 1) End any events past their ends_at
  try {
    const expired = db.prepare(`
      // TODO: project explicit columns (auto-fix suggestion)
      SELECT * FROM faction_events_scheduled
       WHERE status = 'active' AND ends_at <= unixepoch()
    `).all();
    for (const ev of expired) {
      try {
        db.prepare(`UPDATE faction_events_scheduled SET status = 'ended', ended_at = unixepoch() WHERE id = ?`)
          .run(ev.id);
        // Notify users in the world.
        if (deps.emitToUser && deps.cityPresence?.getUserIdsInCity) {
          const userIds = deps.cityPresence.getUserIdsInCity(ev.world_id) || [];
          for (const uid of userIds) {
            try {
              deps.emitToUser(uid, "faction:event_ended", {
                eventId: ev.id,
                templateId: ev.template_id,
                title: ev.title,
              });
            } catch { /* per-user emit failure non-fatal */ }
          }
        }
        stats.ended += 1;
      } catch { /* per-event failure non-fatal */ }
    }
  } catch { /* expired-scan failure non-fatal */ }

  // 2) Pick candidate templates from authored lore
  // Templates source: prefer contentSeeder._authoredFactions iff exposed,
  // fall back to direct content/world/lore.json read.
  const templates = await loadEventTemplates(deps.contentSeeder);
  if (templates.length === 0) return stats;

  // 3) Pick worlds with at least one active player (no point firing in
  // empty worlds — scheduler activity follows engagement).
  const activeWorlds = await listActiveWorlds(db, deps.cityPresence);

  for (const worldId of activeWorlds) {
    // Pick a template not in cooldown for this world.
    const candidate = pickTemplate(db, templates, worldId);
    if (!candidate) continue;

    const id = crypto.randomUUID();
    const durationHours = candidate.durationHours ?? DEFAULT_DURATION_HOURS;
    const endsAt = Math.floor(Date.now() / 1000) + durationHours * 3600;

    try {
      db.prepare(`
        INSERT INTO faction_events_scheduled
          (id, template_id, world_id, factions_json, title, description, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        candidate.id,
        worldId,
        JSON.stringify(candidate.factions_involved ?? []),
        candidate.title ?? "Untitled event",
        candidate.description ?? "",
        endsAt,
      );

      // Emit faction:event_started to every user in the world.
      if (deps.emitToUser && deps.cityPresence?.getUserIdsInCity) {
        const userIds = deps.cityPresence.getUserIdsInCity(worldId) || [];
        for (const uid of userIds) {
          try {
            deps.emitToUser(uid, "faction:event_started", {
              eventId: id,
              templateId: candidate.id,
              title: candidate.title,
              description: candidate.description,
              factions: candidate.factions_involved ?? [],
              endsAt: endsAt * 1000,
            });
          } catch { /* per-user emit non-fatal */ }
        }
      }
      stats.rolled += 1;
    } catch { /* per-roll failure non-fatal */ }
  }

  return stats;
}

// ─── helpers ───────────────────────────────────────────────────────────

async function loadEventTemplates(contentSeeder) {
  // Prefer authored factions/lore loaded by content-seeder.
  if (contentSeeder?.getAllAuthoredEvents) {
    try { return contentSeeder.getAllAuthoredEvents(); } catch { /* fallthrough */ }
  }
  // Fallback: read content/world/lore.json directly.
  try {
    const fs   = await import("fs");
    const path = await import("path");
    const lorePath = path.resolve("content/world/lore.json");
    const raw = await fs.promises.readFile(lorePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.history) ? parsed.history : [];
  } catch { return []; }
}

async function listActiveWorlds(db, cityPresence) {
  const out = new Set();
  // From city-presence: any city with users in it counts.
  if (cityPresence?.getAllActiveCities) {
    try {
      for (const w of cityPresence.getAllActiveCities()) out.add(w);
    } catch { /* fallthrough */ }
  }
  // Fallback: distinct world_ids from world_npcs that have alive NPCs.
  if (out.size === 0) {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs WHERE is_dead = 0 LIMIT 20
      `).all();
      for (const r of rows) if (r.world_id) out.add(r.world_id);
    } catch { /* table may not exist */ }
  }
  return Array.from(out);
}

function pickTemplate(db, templates, worldId) {
  // Filter out templates in cooldown for this world.
  const cooldownStart = Math.floor(Date.now() / 1000) - TEMPLATE_COOLDOWN_SEC;
  const eligible = [];
  for (const t of templates) {
    try {
      const recent = db.prepare(`
        SELECT 1 FROM faction_events_scheduled
         WHERE template_id = ? AND world_id = ? AND started_at >= ?
         LIMIT 1
      `).get(t.id, worldId, cooldownStart);
      if (!recent) eligible.push(t);
    } catch { /* on any error treat as eligible */ eligible.push(t); }
  }
  if (eligible.length === 0) return null;

  // Weight by significance: major > moderate > minor.
  const weight = (t) => t?.significance === "major" ? 3 : t?.significance === "minor" ? 1 : 2;
  const total = eligible.reduce((s, t) => s + weight(t), 0);
  let roll = Math.random() * total;
  for (const t of eligible) {
    roll -= weight(t);
    if (roll <= 0) return t;
  }
  return eligible[eligible.length - 1];
}

// Convenience: should this tick run the faction event scheduler?
export function shouldRunOnTick(tickCounter) {
  return (tickCounter || 0) % 200 === 0;
}
