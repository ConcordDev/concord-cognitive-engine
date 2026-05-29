// server/emergent/horror-dread-cycle.js
//
// E1 — terror-radius proximity heartbeat for asymmetric horror. For each
// active horror session, read the ghost + investigator live positions, advance
// each investigator's dread/chase state, sweep bleed-outs into the win-check,
// and emit `horror:tension` so the audio engine + role HUD can react.
//
// Frequency 2 (~30s) so dread feels responsive without being a hot loop.
// Heartbeat-compatible: always returns { ok, ... }, never throws.
// Kill-switch: CONCORD_HORROR_DREAD=0.

import * as cityPresence from "../lib/city-presence.js";
import { tickSessionDread, sweepBleedOuts } from "../lib/horror-dread.js";
import { downInvestigator, getSession } from "../lib/horror.js";

export async function runHorrorDreadCycle({ db, io } = {}) {
  if (process.env.CONCORD_HORROR_DREAD === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let sessions = [];
  try {
    sessions = db.prepare(`
      SELECT id, world_id, ghost_user_id, investigators_json, downed_investigators_json
      FROM horror_sessions WHERE ended_at IS NULL
    `).all();
  } catch {
    return { ok: true, ticked: 0, reason: "no_table" };
  }
  if (sessions.length === 0) return { ok: true, ticked: 0 };

  let ticked = 0;
  let tensionEmits = 0;
  for (const s of sessions) {
    let investigators = [];
    let downed = [];
    try { investigators = JSON.parse(s.investigators_json || "[]"); } catch { investigators = []; }
    try { downed = JSON.parse(s.downed_investigators_json || "[]"); } catch { downed = []; }

    const ghostPos = (() => { try { return cityPresence.getUserPosition?.(s.ghost_user_id); } catch { return null; } })();
    if (!ghostPos || !Number.isFinite(ghostPos.x)) continue;

    const investigatorPositions = {};
    for (const userId of investigators) {
      if (downed.includes(userId)) continue;
      const pos = (() => { try { return cityPresence.getUserPosition?.(userId); } catch { return null; } })();
      if (pos && Number.isFinite(pos.x)) investigatorPositions[userId] = pos;
    }

    // Bleed-out sweep first — a downed investigator past their timer is lost,
    // which routes through the same win-check as a ghost down.
    try {
      for (const bledUserId of sweepBleedOuts(db, s.id)) {
        const r = downInvestigator(db, s.id, s.ghost_user_id, bledUserId);
        try { io?.to?.(`world:${s.world_id}`)?.emit?.("horror:bleed-out", { sessionId: s.id, userId: bledUserId, sessionEnded: !!r.sessionEnded }); } catch { /* emit best-effort */ }
      }
    } catch { /* sweep best-effort */ }

    // If the bleed-out sweep ended the session, skip the dread tick.
    if (getSession(db, s.id)?.ended_at) { ticked++; continue; }

    const payloads = tickSessionDread(db, s.id, { ghost: ghostPos, investigators: investigatorPositions });
    for (const p of payloads) {
      try {
        io?.to?.(`user:${p.userId}`)?.emit?.("horror:tension", {
          sessionId: p.sessionId, dread: p.dread, band: p.band,
          inChase: p.inChase, pursuerDistance: p.pursuerDistance, healthTier: p.healthTier,
          // E2 — ghost world position lets the client spatialise (HRTF) the
          // footstep cue. Only sent within the audible band to avoid leaking
          // the ghost's exact position when it's far away.
          ghostPos: (Number.isFinite(p.pursuerDistance) && p.pursuerDistance <= 24)
            ? { x: ghostPos.x, y: ghostPos.y || 0, z: ghostPos.z || 0 } : null,
          ts: Date.now(),
        });
        tensionEmits++;
      } catch { /* emit best-effort */ }
    }
    // Push the converted HorrorRoleHUDs to refresh session state each dread tick
    // (dread/sightings/downs advance autonomously here, not on a player action).
    try { io?.to?.(`world:${s.world_id}`)?.emit?.("horror:state", { sessionId: s.id, ts: Date.now() }); } catch { /* best-effort */ }
    ticked++;
  }
  return { ok: true, ticked, tensionEmits, sessions: sessions.length };
}
