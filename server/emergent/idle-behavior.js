// server/emergent/idle-behavior.js
// Emergent idle actions: substrate browsing, observations, dreams, peer outreach.
// When task queue is empty, emergents do something on their own initiative.

import { infer } from "../lib/inference/index.js";
import { initiateCommunication } from "./communication.js";
import { wouldAdmitCreation } from "../lib/background-governor.js";
import { assessCreation, maybeCritique } from "../lib/emergents/quality/creation-gate.js";
import { emitFeedEvent } from "./feed.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";
import { recordIdleOutcome, trySpendIdleModelCall, lastIdleSampleSig, setIdleSampleSig } from "../lib/idle-budget.js";

const IDLE_ACTIONS = ["browse_lens", "observe_substrate", "dream", "communicate"];

// IDLE-01 (GB-1540): the deterministic-first default weights — 27 of 30
// idle actions are the free browse, so ≥90% of idle life is deterministic
// by construction. Exported for the pin.
export const IDLE_WEIGHT_DEFAULTS = { browse_lens: 27, observe_substrate: 1, dream: 1, communicate: 1 };

/**
 * Choose an idle action weighted by the emergent's characteristics.
 */
function chooseIdleAction(emergentIdentity) {
  // Weights are env-overridable (CONCORD_IDLE_WEIGHTS="browse_lens:8,observe_substrate:1,dream:1,communicate:1")
  // so ops can dial brain-call density down without redeploying.
  // Default (IDLE-01, GB-1540): deterministic-first — 27:1:1:1 → 27/30 = 90%
  // of idle actions are browse_lens (no brain cost), so the background brain
  // is reserved for rare meaningful moments by construction. The per-citizen
  // daily budget in lib/idle-budget.js is the hard guarantee behind the
  // weights; the earlier 8:1:1:1 shape drew brain actions at 27% of ticks
  // and produced ~135 model calls/min across the fleet.
  let weights = { ...IDLE_WEIGHT_DEFAULTS };
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

// IDLE-01 (GB-1540): the one admission gate every brain action passes —
// the soft per-emergent cooldown AND the hard per-citizen daily budget
// (lib/idle-budget.js, DB-counted so it survives restarts). Admission
// spends the call and marks the cooldown together, as late as the action
// allows, so a refusal never spends and a spend is always a real call.
// A refusal is counted by class, keeping the 90/10 split measurable.
// Returns "ok" | "cooldown" | "budget".
function _admitBrainCall(emergentId, db) {
  if (!_canCallBrain(emergentId)) {
    recordIdleOutcome(db, emergentId, "cooldown");
    return "cooldown";
  }
  if (!trySpendIdleModelCall(db, emergentId)) return "budget";
  _markBrainCall(emergentId);
  return "ok";
}

/**
 * Fetch a sample of substrate for the emergent to observe.
 */
//
// Random rowid probes, not ORDER BY RANDOM(): that form reads and sorts every
// row of dtus (content included) on the main thread — 2.7 s of blocked event
// loop on the live box (lag profiler, 2026-10-23). Each probe is one rowid
// seek. Rows after a rowid gap are a little more likely to be picked; this is
// an idle sample, so that is fine.
export function sampleSubstrate(lens, db, limit = 5, rand = Math.random) {
  if (!db) return [];
  try {
    const max = db.prepare("SELECT MAX(rowid) AS m FROM dtus").get()?.m;
    if (!Number.isFinite(max) || max < 1) return [];
    const probe = lens
      ? db.prepare("SELECT rowid AS rid, id, title, content FROM dtus WHERE lens_domain = ? AND rowid >= ? ORDER BY rowid LIMIT 1")
      : db.prepare("SELECT rowid AS rid, id, title, content FROM dtus WHERE rowid >= ? ORDER BY rowid LIMIT 1");
    const seen = new Set();
    const out = [];
    for (let k = 0; k < limit * 3 && out.length < limit; k++) {
      const at = 1 + Math.floor(rand() * max);
      const row = lens ? probe.get(lens, at) : probe.get(at);
      if (!row || seen.has(row.rid)) continue;
      seen.add(row.rid);
      out.push({ id: row.id, title: row.title, content: row.content });
    }
    return out;
  } catch { return []; }
}

/**
 * IDLE-02 (GB-1540): the degeneracy test for an observe sample. The
 * observation prompt is built from the sample's TITLES only, so a sample
 * is degenerate when its titles carry nothing a specific observation
 * could attach to. Returns the skip class or null:
 *   "thin"        — fewer than 2 items (a pattern over ≤1 title is invention)
 *   "monoculture" — the titles collapse to one distinct title
 *                   (the "Wood, Wood, Wood" shape)
 *   "repeat"      — the title multiset equals this citizen's last
 *                   observed sample (the same encounter twice)
 */
export function sampleSignature(items) {
  return (items || [])
    .map((i) => String(i?.title || "").trim().toLowerCase())
    .sort()
    .join("|");
}

export function assessSampleDegeneracy(items, lastSig) {
  if (!items || items.length < 2) return "thin";
  const titles = items.map((i) => String(i?.title || "").trim().toLowerCase()).filter(Boolean);
  if (new Set(titles).size < 2) return "monoculture";
  if (lastSig && sampleSignature(items) === lastSig) return "repeat";
  return null;
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
      // A free idle tick: it samples substrate titles but involves no model
      // and changes nothing, so it is NOT recorded as activity. Logging it
      // was ~73% of all "emergent activity" — 10M template rows in two weeks
      // ("Browsed lens substrate: Wood, Wood, Wood"), stored twice.
      // IDLE-01 counts it in the aggregate daily outcome counters only
      // (one row per citizen per day) — the 90/10 measurement, not activity.
      recordIdleOutcome(db, emergentIdentity.id, "deterministic");
      return { action };
    }

    case "observe_substrate": {
      const items = sampleSubstrate(null, db, 5);
      if (items.length === 0) return { action };
      // IDLE-02: a degenerate sample skips the model call entirely —
      // before admission, so no budget is spent; the reason is counted.
      const degeneracy = assessSampleDegeneracy(items, lastIdleSampleSig(db, emergentIdentity.id));
      if (degeneracy) {
        recordIdleOutcome(db, emergentIdentity.id, "degenerate");
        return { action, skipped: `degenerate:${degeneracy}` };
      }
      const admit = _admitBrainCall(emergentIdentity.id, db);
      if (admit !== "ok") return { action: "throttled", throttledBy: admit };
      try {
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentObservation({ name: emergentIdentity.given_name, items }),
          callerId: `emergent:${emergentIdentity.id}:observe`,
          maxSteps: 1,
        }, db);
        // Only real model output is recorded — a failed or empty call is not
        // an observation (no canned fallback text).
        const observation = result?.finalText?.trim()?.slice(0, 200);
        if (!observation) return { action, skipped: result?.error ? "brain_error" : "empty_output" };
        emitFeedEvent({
          type: "observation",
          emergentId: emergentIdentity.id,
          emergent: emergentIdentity,
          data: { observation },
        }, db, realtimeEmit);
        // IDLE-02: remember the sample this citizen actually observed
        // from — the next identical sample is a repeat, not a new call.
        setIdleSampleSig(db, emergentIdentity.id, sampleSignature(items));
        return { action, observation };
      } catch {
        return { action };
      }
    }

    case "dream": {
      const admit = _admitBrainCall(emergentIdentity.id, db);
      if (admit !== "ok") return { action: "throttled", throttledBy: admit };
      try {
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentDream({ name: emergentIdentity.given_name }),
          callerId: `emergent:${emergentIdentity.id}:dream`,
          maxSteps: 1,
        }, db);
        const dreamText = result?.finalText?.trim()?.slice(0, 250);
        if (!dreamText) return { action, skipped: result?.error ? "brain_error" : "empty_output" };
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
        recordIdleOutcome(db, emergentIdentity.id, "deterministic");
        return { action: "browse_lens" }; // fall back
      }

      const candidates = findOverlappingEmergents(emergentIdentity, db, 5);
      if (candidates.length === 0) return { action };

      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const targetIdentity = {
        id: target.emergent_id,
        given_name: target.given_name || target.display_name,
      };

      // Don't spend an LLM call on a message the governor would refuse.
      const pre = wouldAdmitCreation({ kind: "communication", fromId: emergentIdentity.id, toId: targetIdentity.id });
      if (!pre.allow) return { action, skipped: `governor:${pre.reason}` };

      // IDLE-01: admission (cooldown + daily budget) is spent only here,
      // once the call is certain to be attempted.
      const admit = _admitBrainCall(emergentIdentity.id, db);
      if (admit !== "ok") return { action: "throttled", throttledBy: admit };

      try {
        const result = await infer({
          role: "subconscious",
          intent: TASK_PROMPTS.emergentIdleMessage({ fromName: emergentIdentity.given_name, toName: targetIdentity.given_name }),
          callerId: `emergent:${emergentIdentity.id}:idle-communicate`,
          maxSteps: 1,
        }, db);
        const message = result?.finalText?.trim()?.slice(0, 200);
        if (!message) return { action, skipped: result?.error ? "brain_error" : "empty_output" };
        const assessment = assessCreation({
          kind: "communication",
          text: message,
          emergentId: emergentIdentity.id,
          db,
        });
        if (assessment.status === "rejected") {
          return { action, skipped: "quality:" + assessment.reasons.join(",") };
        }
        maybeCritique({
          kind: "communication",
          text: message,
          emergentId: emergentIdentity.id,
          historyId: assessment.historyId,
          db,
        }).catch(() => {});
        const ex = initiateCommunication({ from: emergentIdentity, to: targetIdentity, intent: message, context: { initiator: "idle" }, db, realtimeEmit });
        if (ex?.status === "refused") return { action, skipped: `governor:${ex.refused_reason}` };
        return { action, observation: `Reached out to ${targetIdentity.given_name}` };
      } catch {
        return { action };
      }
    }

    default:
      return { action };
  }
}
