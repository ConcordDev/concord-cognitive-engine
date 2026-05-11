// server/emergent/agent-marathon-cycle.js
//
// Sprint 12 — heartbeat that auto-ticks running marathon sessions
// so they make progress even when the user closes the tab.
//
// Frequency: 12 ticks (~3 min). Per pass: find sessions with
// status='running' AND next_tick_at <= now, tick each up to 5 turns.
// Bounded at MAX_PER_PASS to keep tick cost predictable.

import { findDueMarathons, tickMarathon } from "../lib/agent-marathon.js";

const MAX_PER_PASS = 3;

export async function runAgentMarathonCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const runMacro = globalThis.__concordRunMacro;
  const lensActions = globalThis.__concordLensActions || new Map();
  if (!runMacro) return { ok: false, reason: "no_runMacro" };

  let advanced = 0;
  let errors = 0;
  try {
    const due = findDueMarathons(db, { limit: MAX_PER_PASS });
    for (const { id } of due) {
      try {
        const r = await tickMarathon({
          db, sessionId: id, runMacro, lensActions,
          opts: { tickTurns: 3 }, // shorter ticks in heartbeat to share runtime
        });
        if (r.ok) advanced++;
      } catch {
        errors++;
      }
    }
    return { ok: true, processed: due.length, advanced, errors };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
