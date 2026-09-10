// server/emergent/idle-behavior.js
// Emergent idle actions: substrate browsing, observations, dreams, peer outreach.
// When task queue is empty, emergents do something on their own initiative.

import { infer } from "../lib/inference/index.js";
import { initiateCommunication } from "./communication.js";
import { emitFeedEvent } from "./feed.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

const IDLE_ACTIONS = ["browse_lens", "observe_substrate", "dream", "communicate"];

/**
 * Choose an idle action weighted by the emergent's characteristics.
 */
function chooseIdleAction(emergentIdentity) {
  // Weights are env-overridable (CONCORD_IDLE_WEIGHTS="browse_lens:8,observe_substrate:1,dream:1,communicate:1")
  // so ops can dial brain-call density down without redeploying.
  // Default: heavily favor browse_lens (no brain cost) so 812 emergents × 60s tick
  // doesn't starve the conscious brain used for user-facing chat.
  // 8:1:1:1 → 8/11 = 73% browse_lens (free), 27% brain call (3 actions).
  let weights = { browse_lens: 8, observe_substrate: 1, dream: 1, communicate: 1 };
  const envW = process.env.CONCORD_IDLE_WEIGHTS;
  if (envW) {
    try {
      const parsed = {};
      for (const pair of envW.split(",")) {
        const [k, v] = pair.split(":");
        const n = Number(v);
        if (k && Number.isFinite(n) && n >= 0) parsed[k.trim()] = n;
      }
      if (Object.keys(parsed).length) weights = { ...weights, ...parsed };
    } catch { /* fall back to defaults */ }
  }
  const pool = [];
  for (const [action, weight] of Object.entries(weights)) {
    for (let i = 0; i < weight; i++) pool.push(action);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Per-emergent brain-call cooldown. Default 5 min — prevents any one emergent
// from hitting the brain more than once per 5 min. Tracked in-process; resets
// on backend restart. Good enough as a soft throttle; the reaper handles
// what slips through.
const _lastBrainCall = new Map(); // emergentId -> ts
const BRAIN_COOLDOWN_MS = Number(process.env.CONCORD_IDLE_BRAIN_COOLDOWN_MS) || 5 * 60 * 1000;
function _canCallBrain(emergentId) {
  const last = _lastBrainCall.get(emergentId) || 0;
  return Date.now() - last >= BRAIN_COOLDOWN_MS;
}
function _markBrainCall(emergentId) {
  _lastBrainCall.set(emergentId, Date.now());
}

/**
 * Fetch a sample of substrate for the emergent to observe.
 */
function sampleSubstrate(lens, db, limit = 5) {
  if (!db) return [];
  try {
    const sql = lens
      ? "SELECT id, title, content FROM dtus WHERE lens_domain = ? ORDER BY RANDOM() LIMIT ?"
      : "SELECT id, title, content FROM dtus ORDER BY RANDOM() LIMIT ?";
    return lens ? db.prepare(sql).all(lens, limit) : db.prepare(sql).all(limit);
  } catch { return []; }
}

/**
 * Find other emergents whose lens/domain overlaps with this emergent's.
 */
function findOverlappingEmergents(emergentIdentity, db, limit = 5) {
  if (!db) return [];
  try {
    const lens = emergentIdentity.dominantLens;
    if (!lens) {
      return db.prepare(`
        SELECT ei.*, COALESCE(ei.given_name, ei.emergent_id) AS display_name
        FROM emergent_identity ei
        WHERE ei.emergent_id != ?
        LIMIT ?
      `).all(emergentIdentity.id, limit);
    }
    return db.prepare(`
      SELECT ei.*, COALESCE(ei.given_name, ei.emergent_id) AS display_name
      FROM emergent_identity ei
      WHERE ei.emergent_id != ?
      ORDER BY RANDOM() LIMIT ?
    `).all(emergentIdentity.id, limit);
  } catch { return []; }
}

/**
 * Count how many communications this emergent initiated in the last N ms.
 */
function recentCommunicationCount(emergentId, windowMs, db) {
  if (!db) return 0;
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt FROM emergent_communications
      WHERE from_emergent_id = ? AND initiated_at > ?
    `).get(emergentId, Date.now() - windowMs);
    return row?.cnt || 0;
  } catch { return 0; }
}

/**
 * Execute idle behavior for an emergent.
 *
 * @param {object} emergentIdentity - { id, given_name, dominantLens, ... }
 * @param {object} db
 * @param {Function} [realtimeEmit]
 * @returns {Promise<{action: string, observation?: string}>}
 */
export async function runIdleBehavior(emergentIdentity, db, realtimeEmit) {
  const action = chooseIdleAction(emergentIdentity);

  switch (action) {
    case "browse_lens": {
      const items = sampleSubstrate(emergentIdentity.dominantLens, db, 3);
      if (items.length === 0) return { action };
      const titles = items.map(i => i.title).join(", ");
      const observation = `Browsed lens substrate: ${titles}`;
      emitFeedEvent({
        type: "observation",
        emergentId: emergentIdentity.id,
        emergent: emergentIdentity,
        data: { observation },
      }, db, realtimeEmit);
      return { action, observation };
    }

    case "observe_substrate": {
      if (!_canCallBrain(emergentIdentity.id)) return { action: "throttled" };
      const items = sampleSubstrate(null, db, 5);
      if (items.length === 0) return { action };
      try {
        _markBrainCall(emergentIdentity.id);
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentObservation({ name: emergentIdentity.given_name, items }),
          callerId: `emergent:${emergentIdentity.id}:observe`,
          maxSteps: 1,
        }, db);
        const observation = result?.finalText?.trim()?.slice(0, 200) || "Observed substrate patterns.";
        emitFeedEvent({
          type: "observation",
          emergentId: emergentIdentity.id,
          emergent: emergentIdentity,
          data: { observation },
        }, db, realtimeEmit);
        return { action, observation };
      } catch {
        return { action };
      }
    }

    case "dream": {
      if (!_canCallBrain(emergentIdentity.id)) return { action: "throttled" };
      try {
        _markBrainCall(emergentIdentity.id);
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentDream({ name: emergentIdentity.given_name }),
          callerId: `emergent:${emergentIdentity.id}:dream`,
          maxSteps: 1,
        }, db);
        const dreamText = result?.finalText?.trim()?.slice(0, 250) || "A dream without words.";
        emitFeedEvent({
          type: "dream",
          emergentId: emergentIdentity.id,
          emergent: emergentIdentity,
          data: { dream: dreamText },
        }, db, realtimeEmit);
        return { action, observation: dreamText };
      } catch {
        return { action };
      }
    }

    case "communicate": {
      // Don't communicate too often
      if (recentCommunicationCount(emergentIdentity.id, 60 * 60 * 1000, db) >= 3) {
        return { action: "browse_lens" }; // fall back
      }
      if (!_canCallBrain(emergentIdentity.id)) return { action: "throttled" };

      const candidates = findOverlappingEmergents(emergentIdentity, db, 5);
      if (candidates.length === 0) return { action };

      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const targetIdentity = {
        id: target.emergent_id,
        given_name: target.given_name || target.display_name,
      };

      try {
        _markBrainCall(emergentIdentity.id);
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentIdleMessage({ fromName: emergentIdentity.given_name, toName: targetIdentity.given_name }),
          callerId: `emergent:${emergentIdentity.id}:idle-communicate`,
          maxSteps: 1,
        }, db);
        const message = result?.finalText?.trim()?.slice(0, 200) || "Hello.";
        initiateCommunication({ from: emergentIdentity, to: targetIdentity, intent: message, context: { initiator: "idle" }, db, realtimeEmit });
        return { action, observation: `Reached out to ${targetIdentity.given_name}` };
      } catch {
        return { action };
      }
    }

    default:
      return { action };
  }
}
