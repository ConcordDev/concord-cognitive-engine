// server/emergent/npc-perception-snapshot.js
//
// Sprint B Phase 9 — NPC visible sentience pass.
//
// The asymmetry substrate (Phase 2: lib/npc-asymmetry.js + migration 128)
// writes per-NPC grudges, preoccupations, and player-specific desires
// to disk. Players couldn't FEEL any of it — until now.
//
// This heartbeat (frequency 8, ~2min cadence) takes a per-world
// snapshot of NPC ↔ player perception state and emits
// `npc:perception-update` socket events. The frontend hook (in
// AvatarSystem3D) drives:
//   - head-look toward player when grudge severity ≥ 6 within 30m
//   - avoid-eye-contact when ecosystem_score < 0.3
//   - mood bias for gait synthesis (hostile / wary / friendly / neutral)
//   - faction-phase aware posture (allied = mirror; war = tense)
//
// No new data — only rendering existing fields. The substrate stays
// the source of truth; this module is a per-frame perception bridge.
//
// Heartbeat-safe: every per-NPC computation is wrapped in try/catch so
// one bad row never starves the cycle. Returns { ok, emitted, scanned,
// errors } so the registry-level metrics record cycle health.

// composeAsymmetryContext narrows to narrative strings; for the
// perception heartbeat we need raw rows (severity, target_id) so we
// query npc_grudges directly rather than going through the helper.
import { getRelation } from "../lib/embodied/faction-strategy.js";
import logger from "../logger.js";

// Hard-coded knobs. Tuned to feel responsive without spamming sockets.
const GRUDGE_LOOK_AT_DISTANCE_M = 30;       // grudge ≥ 6 + within this radius → head turn
const GRUDGE_LOOK_AT_SEVERITY  = 6;
const ECOSYSTEM_AVOID_THRESHOLD = 0.30;     // score below this → avoid eye contact
const ALLIED_FACTION_REL_THRESHOLD = 0.30;  // relation > this → mirror posture
const MAX_NPCS_PER_PASS = 200;              // bounded scan; large worlds spread cost across cycles

/** Heartbeat handler — registered as `npc-perception-snapshot @ 8`. */
export async function runNpcPerceptionSnapshot({ db }) {
  if (!db) return { ok: false, reason: "no_db" };
  const REALTIME = globalThis.__CONCORD_REALTIME__ || globalThis._concordREALTIME;
  if (!REALTIME?.io) return { ok: false, reason: "no_realtime" };

  let scanned = 0;
  let emitted = 0;
  let errors = 0;

  // Per-world: only compute for worlds with at least one player
  // currently online. Reuses the same active-world heuristic the
  // npc-routine-cycle uses.
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits WHERE departed_at IS NULL
    `).all().map(r => r.world_id).filter(Boolean);
  } catch {
    // city_presence may not exist in some test builds — fall back to
    // checking the worlds table.
    try {
      worlds = db.prepare(`SELECT id FROM worlds`).all().map(r => r.id);
    } catch { return { ok: false, reason: "no_worlds_table" }; }
  }

  if (worlds.length === 0) return { ok: true, scanned: 0, emitted: 0, reason: "no_active_worlds" };

  for (const worldId of worlds) {
    // Active players in this world (with positions for proximity check).
    let players = [];
    try {
      players = db.prepare(`
        SELECT user_id,
               json_extract(last_position, '$.x') AS x,
               json_extract(last_position, '$.z') AS z
        FROM world_visits
        WHERE world_id = ? AND departed_at IS NULL
      `).all(worldId);
    } catch { /* table may be absent in minimal builds */ }

    if (players.length === 0) continue;

    // Visible NPCs in this world. Bounded so a world with thousands of
    // NPCs doesn't dominate one cycle. Future improvement: rotate
    // through NPC ids across cycles using `(updated_at + offset) % N`.
    let npcs = [];
    try {
      npcs = db.prepare(`
        SELECT id, faction_id, x, z FROM authored_npcs
        WHERE world_id = ?
        LIMIT ?
      `).all(worldId, MAX_NPCS_PER_PASS);
    } catch {
      // Fallback: the live world_npcs table (faction column, real x/z).
      try {
        npcs = db.prepare(`
          SELECT id, faction AS faction_id, x, z FROM world_npcs WHERE world_id = ? LIMIT ?
        `).all(worldId, MAX_NPCS_PER_PASS);
      } catch { /* no npc table — skip world */ }
    }

    if (npcs.length === 0) continue;

    for (const npc of npcs) {
      scanned += 1;
      try {
        let bestGrudge = null;     // { severity, targetUserId }
        let allyHint = null;        // { allyNpcId, intensity }
        let moodBias = "neutral";   // 'hostile' | 'wary' | 'neutral' | 'friendly'

        // Pull all unresolved grudges this NPC holds against any
        // active player. One direct query per NPC is cheaper than
        // calling composeAsymmetryContext per-(npc, player). The
        // helper narrows to narrative strings; we need raw rows.
        let grudges = [];
        try {
          grudges = db.prepare(`
            SELECT severity, target_id
              FROM npc_grudges
             WHERE npc_id = ?
               AND target_kind = 'player'
               AND resolved_at IS NULL
               AND severity >= ?
          `).all(npc.id, GRUDGE_LOOK_AT_SEVERITY);
        } catch { /* table may be missing on minimal seed */ }

        for (const g of grudges) {
          const severity = Number(g.severity || 0);
          if (severity < GRUDGE_LOOK_AT_SEVERITY) continue;
          // Match the grudge target to an active player.
          const player = players.find(p => p.user_id === g.target_id);
          if (!player) continue;

          const dx = (npc.x ?? 0) - (player.x ?? 0);
          const dz = (npc.z ?? 0) - (player.z ?? 0);
          const distSq = dx * dx + dz * dz;
          // NPCs without positions react unconditionally; positioned
          // NPCs gate by 30m radius.
          const inRange = (npc.x == null || npc.z == null
            || distSq <= GRUDGE_LOOK_AT_DISTANCE_M * GRUDGE_LOOK_AT_DISTANCE_M);
          if (inRange && (!bestGrudge || severity > bestGrudge.severity)) {
            bestGrudge = { severity, targetUserId: player.user_id };
            moodBias = "hostile";
          }
        }

        // Faction-strategy phase → posture. Mirror an allied NPC's
        // posture when this NPC's faction has a positive relation
        // (> 0.30) with another NPC's faction in the same world.
        // Look at one nearby NPC per pass; cheap.
        if (npc.faction_id) {
          try {
            const ally = npcs.find(other =>
              other.id !== npc.id &&
              other.faction_id &&
              other.faction_id !== npc.faction_id
            );
            if (ally?.faction_id) {
              const rel = getRelation(db, npc.faction_id, ally.faction_id);
              if (rel && rel.score > ALLIED_FACTION_REL_THRESHOLD) {
                allyHint = { allyNpcId: ally.id, intensity: Math.min(1.0, Math.max(0, rel.score)) };
                if (moodBias === "neutral") moodBias = "friendly";
              }
            }
          } catch { /* faction_relations may be absent */ }
        }

        // Skip emit when there's nothing to render — keeps socket
        // traffic proportional to actual perception signals.
        if (!bestGrudge && !allyHint) continue;

        const payload = {
          npcId: npc.id,
          worldId,
          shouldLookAtPlayer: bestGrudge ? bestGrudge.targetUserId : null,
          activeGrudgeSeverity: bestGrudge?.severity || 0,
          shouldMirrorPosture: allyHint,
          moodBias,
        };

        try {
          REALTIME.io.to(`world:${worldId}`).emit("npc:perception-update", payload);
          emitted += 1;
        } catch (err) {
          errors += 1;
          try { logger.debug?.("npc-perception", "emit_failed", { npcId: npc.id, err: err?.message }); }
          catch { /* */ }
        }
      } catch (err) {
        errors += 1;
        try { logger.warn?.("npc-perception", "npc_failed", { npcId: npc.id, err: err?.message }); }
        catch { /* */ }
      }
    }
  }

  return { ok: true, scanned, emitted, errors };
}
