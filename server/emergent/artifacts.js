// server/emergent/artifacts.js
// Attributed artifact creation for emergent outputs.
// Emergent-produced DTUs start as shadows and promote through governance.

import crypto from "node:crypto";

/**
 * Determine whether a task result should produce a visible artifact.
 * @param {{task_type: string, task_data: object}} task
 * @param {{metadata?: object}} result
 * @returns {boolean}
 */
export function shouldProduceArtifact(task, result) {
  switch (task.task_type) {
    case "synthesis":    return true;
    case "governance":   return true;
    case "dream":        return (result.metadata?.novelty || 0) > 0.5;
    case "observation":  return (result.metadata?.significance || 0) > 0.7;
    case "communication": return result.metadata?.consequential === true;
    default:             return false;
  }
}

/**
 * Classify the artifact type from task type.
 * @param {{task_type: string}} task
 * @returns {string}
 */
export function classifyArtifactType(task) {
  const MAP = {
    synthesis:     "synthesis_dtu",
    observation:   "observation_dtu",
    governance:    "deliberation_dtu",
    dream:         "dream_dtu",
    communication: "message_dtu",
  };
  return MAP[task.task_type] || "emergent_dtu";
}

/**
 * Generate a concise artifact title from task + result.
 */
function generateArtifactTitle(task, result) {
  const prefix = task.task_data?.lens ? `[${task.task_data.lens}] ` : "";
  if (result.finalText) {
    const firstLine = result.finalText.split(/[\n.!?]/)[0].trim().slice(0, 80);
    if (firstLine) return prefix + firstLine;
  }
  return `${prefix}${task.task_type} artifact`;
}

/**
 * Extract DTU IDs from inference result (contributor list or explicit refs).
 */
function extractLineage(task, result) {
  const refs = new Set();
  (task.task_data?.sourceDTUs || []).forEach(id => refs.add(id));
  (result.dtuContributors || []).forEach(c => refs.add(c.dtuId || c.id));
  return [...refs].filter(Boolean);
}

/**
 * Create an attributed artifact DTU record.
 * Stores to personal_dtus or dtus table depending on scope.
 *
 * @param {object} emergentIdentity - { id, given_name, dominantLens }
 * @param {{id: string, task_type: string, task_data: object}} task
 * @param {{finalText?: string, steps?: object[], dtuContributors?: object[], brainUsed?: string, tokensIn?: number, tokensOut?: number, metadata?: object}} result
 * @param {object} db
 * @returns {object|null} artifact record
 */
export function createAttributedArtifact(emergentIdentity, task, result, db) {
  if (!db) return null;

  const id = `edtu_${crypto.randomBytes(8).toString("hex")}`;
  const type = classifyArtifactType(task);
  const lineage = extractLineage(task, result);
  const title = generateArtifactTitle(task, result);
  const body = result.finalText || "";
  const lens = task.task_data?.lens || emergentIdentity.dominantLens || "general";
  const now = Date.now();

  const artifact = {
    id,
    type,
    creator_emergent_id: emergentIdentity.id,
    created_by: emergentIdentity.given_name || emergentIdentity.id,
    created_by_type: "emergent",
    title,
    body,
    lineage: JSON.stringify(lineage),
    lens,
    tier: "shadow",
    task_id: task.id,
    task_type: task.task_type,
    brain_used: result.brainUsed || "subconscious",
    tokens_used: (result.tokensIn || 0) + (result.tokensOut || 0),
    created_at: now,
  };

  try {
    db.prepare(`
      INSERT INTO emergent_observations
        (id, emergent_id, observation, context, related_dtu_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      emergentIdentity.id,
      `[artifact:${type}] ${title}`,
      JSON.stringify({ task_id: task.id, task_type: task.task_type }),
      JSON.stringify([id, ...lineage]),
      now
    );
  } catch (e) {
    console.error("[artifacts] observation insert failed:", e?.message);
  }

  // Persist the real artifact body into `dtus` so MCP dtu_get/dtu_search
  // can recover content. owner_user_id stays NULL (FK → users); attribution
  // lives on creator_id = emergent id. Lineage stays in body_json only —
  // dtu_citations population is a separate bridge slice.
  const bodyJson = {
    type,
    title,
    body,
    lineage,
    lens,
    task_id: task.id,
    task_type: task.task_type,
    created_by_type: "emergent",
    creator_emergent_id: emergentIdentity.id,
    created_by: artifact.created_by,
    brain_used: artifact.brain_used,
    tokens_used: artifact.tokens_used,
  };
  const createdAt = new Date(now).toISOString();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO dtus
        (id, owner_user_id, title, body_json, tags_json, visibility, tier,
         type, creator_id, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      null,
      title,
      JSON.stringify(bodyJson),
      JSON.stringify(["emergent", "artifact", type, lens].filter(Boolean)),
      "private",
      "shadow",
      type,
      emergentIdentity.id,
      body,
      "active",
      createdAt,
      createdAt
    );
  } catch (e) {
    console.error("[artifacts] dtu insert failed:", e?.message);
  }

  return artifact;
}

/**
 * List artifacts for an emergent (reads from observations table for now).
 */
export function listEmergentArtifacts(emergentId, db, limit = 50) {
  if (!emergentId || !db) return [];
  try {
    return db.prepare(`
      SELECT * FROM emergent_observations
      WHERE emergent_id = ? AND observation LIKE '[artifact:%'
      ORDER BY created_at DESC LIMIT ?
    `).all(emergentId, limit);
  } catch { return []; }
}
