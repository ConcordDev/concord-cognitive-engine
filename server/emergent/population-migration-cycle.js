// server/emergent/population-migration-cycle.js
//
// Heartbeat that processes due population_flow_events. Frequency 30
// ticks (~7.5 in-game minutes). Per-event try/catch so a single failure
// can never stop the loop.
//
// Boundary discipline: only operates on population_flow_events. Does
// not initiate migrations itself — callers (kingdom decree, refugee
// flow, NPC voluntary migration) call initiateMigration directly.
//
// Kill switch: every cross-world arrival gates on the kill switch.
// When paused, due events stay in_transit (their NPC stays in flux
// until the kill switch flips back to live).

import {
  findArrivalsDue, arriveAtDestination,
  findOverdue, markLost,
} from "../lib/population-migration.js";
import { getKillSwitchMode } from "../lib/cross-world-economy.js";

const MAX_ARRIVALS_PER_PASS = 100;
const MAX_OVERDUE_PER_PASS = 25;

export async function runPopulationMigrationCycle({ db }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (getKillSwitchMode(db) !== "live") {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }

  let arrived = 0;
  let lost = 0;
  let errors = 0;

  try {
    const due = findArrivalsDue(db);
    for (const event of due.slice(0, MAX_ARRIVALS_PER_PASS)) {
      try {
        const r = arriveAtDestination(db, event.id);
        if (r.ok) arrived++;
      } catch {
        errors++;
      }
    }

    const overdue = findOverdue(db);
    for (const event of overdue.slice(0, MAX_OVERDUE_PER_PASS)) {
      try {
        const r = markLost(db, event.id, "transit_timeout_7d");
        if (r.ok) lost++;
      } catch {
        errors++;
      }
    }

    return { ok: true, arrivalsProcessed: arrived, lost, errors };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
