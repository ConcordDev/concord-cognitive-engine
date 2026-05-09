// @sql-loop-ok: curation pass with conditional per-row archive logic
// server/lib/agentic/learnings-curation.js
// Daily/weekly curation: each emergent reviews observations from shadow DTUs,
// identifies recurring patterns, and promotes them to learning DTUs.

import { spawnSubCognition } from "./sub-cognition.js";

const LEARNING_CONTENT_TYPE = "learning";
const MIN_OBSERVATIONS_TO_CURATE = 5;

/**
 * Parse structured patterns from the sub-cognition's distilled output.
 * Expects numbered or bulleted list format.
 */
function parsePatterns(text) {
  const lines = (text || "").split("\n").filter(l => l.trim());
  const patterns = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[\d\-•*]+\.?\s*/, "").trim();
    if (cleaned.length > 20) {
      patterns.push({ description: cleaned, supportingObservations: [] });
    }
  }
  return patterns;
}

/**
 * Get recent observations for an emergent from their shadow DTU substrate.
 * @param {string} emergentId
 * @param {number} days
 * @param {object} db
 * @returns {object[]}
 */
function getRecentObservations(emergentId, days, db) {
  if (!db || !emergentId) return [];
  try {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`
      SELECT id, title, created_at FROM personal_dtus
      WHERE user_id = ? AND content_type = 'shadow' AND created_at >= ?
      ORDER BY created_at DESC LIMIT 100
    `).all(emergentId, cutoff);
  } catch { return []; }
}

/**
 * Create a learning DTU from a pattern.
 * Stored as an encrypted personal DTU with content_type='learning'.
 */
function createLearningDTU({ emergentId, pattern, curatorInferenceId, db }) {
  if (!db || !emergentId) return null;
  try {
    const id = `learn_${Math.random().toString(36).slice(2)}`;
    db.prepare(`
      INSERT INTO personal_dtus (id, user_id, lens_domain, content_type, title, encrypted_content, iv, auth_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, emergentId, "learnings", LEARNING_CONTENT_TYPE,
      pattern.description.slice(0, 100),
      Buffer.from(JSON.stringify({ pattern, curatorInferenceId, createdAt: new Date().toISOString() })),
      Buffer.alloc(12, 0), // placeholder IV — learning DTUs use unencrypted storage
      Buffer.alloc(16, 0)  // placeholder auth tag
    );
    return id;
  } catch { return null; }
}

/**
 * Curate learnings for a single emergent.
 * Identifies patterns in recent shadow DTUs and promotes them to learning DTUs.
 *
 * @param {string} emergentId
 * @param {object} db
 * @param {{ cycleId?: string, db?: object }} [opts]
 * @returns {Promise<{emergentId: string, patternsFound: number, learningsCreated: number}>}
 */
export async function curateForEmergent(emergentId, db, opts = {}) {
  const cycleId = opts.cycleId || `curate_${emergentId}_${Date.now()}`;

  const observations = getRecentObservations(emergentId, 7, db);
  if (observations.length < MIN_OBSERVATIONS_TO_CURATE) {
    return { emergentId, patternsFound: 0, learningsCreated: 0, skipped: true };
  }

  const observationsList = observations
    .map(o => `- "${o.title}" (${o.created_at})`)
    .join("\n");

  const result = await spawnSubCognition({
    task: `Review these recent observations for emergent ${emergentId} and identify recurring patterns that represent durable learnings worth promoting:\n\n${observationsList}\n\nList each pattern as a concise bullet point (one per line). Focus on behavioral patterns, recurring preferences, consistent strategies, or repeated insights.`,
    parentInferenceId: cycleId,
    brainRole: "subconscious",
    maxSteps: 3,
    timeoutMs: 60000,
    db,
  });

  const patterns = parsePatterns(result.distilledOutput);
  let created = 0;

  for (const pattern of patterns) {
    const id = createLearningDTU({ emergentId, pattern, curatorInferenceId: cycleId, db });
    if (id) created++;
  }

  // Keep only 100 most recent shadow observations (archive older ones)
  try {
    if (db && observations.length > 100) {
      const toArchive = observations.slice(100).map(o => o.id);
      for (const id of toArchive) {
        db.prepare("DELETE FROM personal_dtus WHERE id = ? AND content_type = 'shadow'").run(id);
      }
    }
  } catch { /* non-fatal */ }

  return {
    emergentId,
    patternsFound: patterns.length,
    learningsCreated: created,
    observationsProcessed: observations.length,
  };
}

/**
 * Run curation for all active emergents.
 * Called by the daily cron (4am) in server startup.
 *
 * @param {string[]} emergentIds
 * @param {object} db
 * @returns {Promise<object[]>}
 */
export async function curateAllEmergents(emergentIds, db) {
  const results = [];
  for (const id of emergentIds) {
    try {
      const r = await curateForEmergent(id, db, { cycleId: `daily_${Date.now()}` });
      results.push(r);
    } catch (err) {
      results.push({ emergentId: id, error: err?.message });
    }
  }
  return results;
}
