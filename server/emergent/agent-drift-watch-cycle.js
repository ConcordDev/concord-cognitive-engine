// server/emergent/agent-drift-watch-cycle.js
//
// Wave 7 / Track C3 — the PERIODIC DRIFT-WATCH. The values anchor (B1 core_values) is
// un-driftable, but an agent's CHARACTER (its drive profile) evolves from felt-peaks
// (B5) — and evolution can pull the now-expressed character away from the anchor. This
// heartbeat sweeps active agents, measures how far their expressed values have drifted
// from the anchor (measureValueDrift), writes the score, and FLAGS (does not correct)
// agents past the review threshold for the human-review cadence (C3). Emits
// `agent:value-drift` for the ops surface.
//
// Heartbeat contract: always returns a plain { ok, ... }; never throws. scope:'global'
// (cross-world agent governance). Slow cadence. Kill-switch CONCORD_AGENT_DRIFT_WATCH=0.

import { measureValueDrift } from "../lib/agent-self.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";
import { _internal as autobiog } from "../lib/agent-autobiography.js";

const DRIVE_TO_VALUE = autobiog.DRIVE_TO_VALUE;
const FLAG_THRESHOLD = autobiog.VALUE_DRIFT_FLAG; // same threshold evolveCharacter uses
const MAX_PER_PASS = 25;

function enabled() {
  return process.env.CONCORD_AGENT_DRIFT_WATCH !== "0";
}

// The values the agent's now-dominant drives tend to express (same derivation as B5).
function expressedValues(driveProfile) {
  const drives = driveProfile || {};
  const sorted = DRIVE_KINDS.map((k) => [k, Number(drives[k]) || 0]).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(([k]) => DRIVE_TO_VALUE[k]).filter(Boolean);
}

export function runAgentDriftWatchCycle({ db, io } = {}) {
  if (!enabled()) return { ok: true, reason: "disabled", swept: 0, flagged: 0 };
  if (!db) return { ok: true, reason: "no_db", swept: 0, flagged: 0 };

  let swept = 0;
  let flagged = 0;
  try {
    let agents = [];
    try {
      agents = db.prepare(`
        SELECT agent_id, core_values_json, drive_profile_json
        FROM agent_identities WHERE status = 'active' LIMIT ?
      `).all(MAX_PER_PASS);
    } catch { return { ok: true, reason: "no_table", swept: 0, flagged: 0 }; }

    for (const a of agents) {
      try {
        let coreValues = [], driveProfile = {};
        try { coreValues = JSON.parse(a.core_values_json || "[]"); } catch { /* [] */ }
        try { driveProfile = JSON.parse(a.drive_profile_json || "{}"); } catch { /* {} */ }
        const drift = measureValueDrift({ core_values: coreValues }, expressedValues(driveProfile));
        const isFlagged = drift >= FLAG_THRESHOLD;

        try {
          db.prepare(`UPDATE agent_identities SET value_drift = ?${isFlagged ? ", drift_flagged_at = unixepoch()" : ""} WHERE agent_id = ?`)
            .run(drift, a.agent_id);
        } catch { /* columns optional (mig 330 pending) */ }

        swept++;
        if (isFlagged) {
          flagged++;
          // surface for the human-review cadence (best-effort; never blocks)
          try { io?.emit?.("agent:value-drift", { agentId: a.agent_id, drift, flagged: true }); } catch { /* realtime optional */ }
        }
      } catch { /* per-agent skip */ }
    }
  } catch (err) {
    return { ok: true, reason: `error:${err?.message || "unknown"}`, swept, flagged };
  }
  return { ok: true, swept, flagged };
}

export const _internal = { expressedValues, FLAG_THRESHOLD };
