// server/lib/substrate-diffusion.js
// Track how hybrid skills and creations spread across worlds.
// Detect cross-world patterns via Cipher-tier emergent brain calls.

import crypto from "crypto";
import logger from "../logger.js";

const VALID_EVENTS = ["used_in_new_world", "taught_to_player", "adopted_by_npc", "evolved_further"];

const DAILY_MS = 24 * 60 * 60 * 1000;

/**
 * Record a diffusion event for a hybrid skill DTU.
 * Merges the event into the skill_diffusion.state JSON.
 *
 * @param {string} hybridId
 * @param {{ type: string, worldId?: string, actorId?: string }} event
 * @param {import('better-sqlite3').Database} db
 */
export function recordDiffusionEvent(hybridId, event, db) {
  if (!VALID_EVENTS.includes(event.type)) return;

  const existing = db.prepare("SELECT * FROM skill_diffusion WHERE skill_id = ?").get(hybridId);

  if (!existing) {
    const state = { events: [{ ...event, at: Date.now() }] };
    db.prepare(`
      INSERT INTO skill_diffusion (id, skill_id, state)
      VALUES (?, ?, ?)
    `).run(crypto.randomUUID(), hybridId, JSON.stringify(state));
    return;
  }

  const state = _parseJSON(existing.state, { events: [] });
  state.events = [...(state.events || []), { ...event, at: Date.now() }];

  db.prepare("UPDATE skill_diffusion SET state = ?, updated_at = unixepoch() WHERE id = ?").run(
    JSON.stringify(state), existing.id
  );
}

/**
 * Diffuse a hybrid DTU at creation time — seeds its diffusion record.
 * @param {object} hybridDTU
 * @param {string} originatingWorld
 * @param {import('better-sqlite3').Database} db
 */
export async function diffuseHybrid(hybridDTU, originatingWorld, db) {
  recordDiffusionEvent(hybridDTU.id, { type: "used_in_new_world", worldId: originatingWorld }, db);
}

/**
 * Run pattern detection using Cipher-tier emergents + subconscious brain.
 * Inserts/updates substrate_patterns. Scheduled daily via setInterval.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 */
export async function detectSubstratePatterns(db, selectBrain) {
  // Gather hybrid skills created in the last 30 days
  const hybrids = db.prepare(`
    SELECT d.id, d.title, d.content, d.world_id,
           sd.state as diffusion_state
    FROM dtus d
    LEFT JOIN skill_diffusion sd ON sd.skill_id = d.id
    WHERE d.type = 'skill'
      AND json_extract(d.content, '$.parentSkills') IS NOT NULL
      AND d.created_at > (unixepoch() - 30 * 86400)
    LIMIT 100
  `).all();

  if (hybrids.length === 0) return;

  let patterns = [];

  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "concordia:pattern-detection",
    });

    const prompt = `You are a Cipher-tier cross-world observer analysing skill evolution patterns.

Recent hybrid skills across all worlds:
${hybrids.map(h => `- "${h.title}" (world: ${h.world_id})`).join('\n')}

Identify any emerging patterns. Return JSON:
{
  "patterns": [
    {
      "type": "<skill_family|creation_style|cultural_practice>",
      "description": "<1 sentence>",
      "memberTitles": ["<skill title>", ...],
      "worldsPresent": ["<world_id>", ...],
      "trajectory": "<growing|stable|declining>",
      "strength": <0.0–1.0>
    }
  ]
}`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) patterns = JSON.parse(match[0]).patterns || [];
  } catch (_e) {
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO substrate_patterns
      (id, pattern_type, description, member_dtu_ids, worlds_present, current_strength, trajectory)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      current_strength = excluded.current_strength,
      trajectory       = excluded.trajectory,
      worlds_present   = excluded.worlds_present
  `);

  for (const p of patterns) {
    // Resolve member_dtu_ids from titles
    const memberIds = (p.memberTitles || []).map(title => {
      const row = db.prepare("SELECT id FROM dtus WHERE title = ? AND type = 'skill' LIMIT 1").get(title);
      return row?.id || null;
    }).filter(Boolean);

    upsert.run(
      crypto.randomUUID(),
      p.type || "skill_family",
      p.description || "",
      JSON.stringify(memberIds),
      JSON.stringify(p.worldsPresent || []),
      p.strength ?? 0.5,
      p.trajectory || "stable",
    );
  }
}

/**
 * Query substrate patterns.
 * @param {{ patternType?: string, minStrength?: number, limit?: number }} filters
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getPatterns(filters, db) {
  const { patternType, minStrength = 0, limit = 50 } = filters || {};

  let where = "current_strength >= ?";
  const params = [minStrength];

  if (patternType) {
    where += " AND pattern_type = ?";
    params.push(patternType);
  }

  return db.prepare(`
    SELECT * FROM substrate_patterns
    WHERE ${where}
    ORDER BY current_strength DESC
    LIMIT ?
  `).all(...params, limit).map(p => ({
    ...p,
    member_dtu_ids: _parseJSON(p.member_dtu_ids, []),
    worlds_present: _parseJSON(p.worlds_present, []),
  }));
}

// Schedule daily pattern detection (called from server.js after db is ready)
let _patternTimer = null;

/**
 * Start the daily pattern detection cycle.
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 */
export function startPatternDetection(db, selectBrain) {
  if (_patternTimer) return;
  // Run immediately on start, then daily
  detectSubstratePatterns(db, selectBrain).catch(err => logger?.debug?.('[substrate-diffusion] background op failed', { err: err?.message }));
  _patternTimer = setInterval(() => {
    detectSubstratePatterns(db, selectBrain).catch(err => logger?.debug?.('[substrate-diffusion] background op failed', { err: err?.message }));
  }, DAILY_MS);
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
