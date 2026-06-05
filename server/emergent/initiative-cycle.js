// server/emergent/initiative-cycle.js
//
// "Living chat" — Layer 2 (THE PULSE) + the start of Layer 3 (a path to the surface).
// The initiative-engine (lib/initiative-engine.js, 850 LOC: 7 trigger types, rate
// limits, quiet hours, backoff) was fully built but only fired on a MANUAL
// /api/initiative/trigger call — nothing clocked it. This heartbeat gives it a pulse,
// SALIENCE-GATED: for each recently-active user it gathers a real "thought" worth
// surfacing (an unsurfaced morning brief from the dream-cycle, or a notably-lit
// assistant felt state) and only then asks the engine to fire. So the assistant reaches
// out because something genuinely crossed threshold — never on a dumb timer. The
// engine's own rate-limits / quiet-hours / backoff are the second gate.
//
// Heartbeat contract: always returns { ok, ... }; never throws. scope:'global'. Slow
// cadence. Kill-switch CONCORD_INITIATIVE_CYCLE=0.

import { createInitiativeEngine } from "../lib/initiative-engine.js";
import { readChatMood } from "../lib/chat-self.js";

const MAX_USERS_PER_PASS = 10;
const ACTIVE_WINDOW_S = 12 * 3600; // a user who chatted in the last 12h is "active"

// the engine holds in-memory rate-limit state, so reuse one instance across passes.
let _engine = null;
function engineFor(db) {
  if (!_engine) { try { _engine = createInitiativeEngine(db); } catch { _engine = null; } }
  return _engine;
}
export function _resetInitiativeEngine() { _engine = null; }

function enabled() { return process.env.CONCORD_INITIATIVE_CYCLE !== "0"; }

// recently-active users = the assistant:<uid> felt-self rows (Layer 1) touched recently.
function recentlyActiveUsers(db) {
  try {
    const rows = db.prepare(`
      SELECT entity_id, last_tick_at FROM affect_state
      WHERE entity_id LIKE 'assistant:%' AND last_tick_at >= (unixepoch() - ?)
      ORDER BY last_tick_at DESC LIMIT ?
    `).all(ACTIVE_WINDOW_S, MAX_USERS_PER_PASS);
    return rows.map((r) => String(r.entity_id).slice("assistant:".length)).filter(Boolean);
  } catch { return []; }
}

// Gather the highest-salience "thought" worth surfacing for a user (the path-to-surface).
// Returns { triggerType, salience, message, dtuId? } or null (nothing worth saying).
function gatherSignal(db, userId) {
  // 1. an unsurfaced MORNING BRIEF (the dream-cycle's compose phase actually ran)
  try {
    const brief = db.prepare(`
      SELECT id, title FROM dtus
      WHERE creator_id = ? AND kind = 'morning_brief'
      ORDER BY created_at DESC LIMIT 1
    `).get(userId);
    if (brief) {
      return {
        triggerType: "morning_context", salience: 0.75, dtuId: brief.id,
        message: `I put a few threads together for you overnight${brief.title ? ` — ${brief.title}` : ""}. Want them?`,
      };
    }
  } catch { /* dtus optional */ }

  // 2. the assistant's OWN felt state — a notably-lit mood is a genuine reason to reflect.
  try {
    const mood = readChatMood(db, userId);
    if (mood.lit && Math.abs(mood.valence) >= 0.3) {
      const message = mood.valence > 0
        ? `I've kept turning over our last conversation — it stuck with me. I had a thought.`
        : `I've been sitting with where we left off; I think I can do better on it.`;
      return { triggerType: "reflective_followup", salience: Math.abs(mood.valence), message };
    }
  } catch { /* mood optional */ }

  return null; // the salience gate: silence unless there's a real thought
}

export function runInitiativeCycle({ db, io, engine } = {}) {
  if (!enabled()) return { ok: true, reason: "disabled", evaluated: 0, fired: 0 };
  if (!db) return { ok: true, reason: "no_db", evaluated: 0, fired: 0 };

  let evaluated = 0;
  let fired = 0;
  try {
    const eng = engine || engineFor(db);
    if (!eng) return { ok: true, reason: "no_engine", evaluated: 0, fired: 0 };
    const users = recentlyActiveUsers(db);
    for (const userId of users) {
      try {
        const signal = gatherSignal(db, userId);
        if (!signal) continue;                 // salience gate — only on a real thought
        evaluated++;
        const ev = eng.evaluateTrigger(userId, signal.triggerType, {
          priority: signal.salience >= 0.7 ? "high" : "normal",
        });
        if (!ev || !ev.shouldFire) continue;   // the engine's rate-limit/quiet-hours/backoff
        eng.createInitiative(userId, signal.triggerType, signal.message, {
          priority: ev.suggestedPriority || "normal",
          metadata: { source: "initiative-cycle", dtuId: signal.dtuId || null },
        });
        fired++;
        try {
          const emit = io?.emit ? io.emit.bind(io) : globalThis.realtimeEmit;
          emit?.("initiative:new", { userId, triggerType: signal.triggerType, message: signal.message });
        } catch { /* realtime optional */ }
      } catch { /* per-user skip */ }
    }
  } catch (err) {
    return { ok: true, reason: `error:${err?.message || "unknown"}`, evaluated, fired };
  }
  return { ok: true, evaluated, fired };
}

export const _internal = { gatherSignal, recentlyActiveUsers, ACTIVE_WINDOW_S };
