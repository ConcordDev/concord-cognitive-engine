// server/lib/council-petition-effects.js
//
// Wires `council_petitions.resolution` (server/lib/council-engine.js,
// migration 183) into a real effect on the world.
//
// Before this module, `closeSession` stamped a petition's resolution
// (approved/rejected/tabled) and nothing else in the codebase ever read
// that column — a council could tally votes and "approve" a petition
// with zero mechanical consequence. That's the gap this closes, but
// only for petitions whose `topic` names a real, decree-issuable kind.
//
// Reuse, not reinvention: an approved petition is routed through
// kingdom-decrees.js's EXISTING decree pipeline —
//   proposeDecree(db, kingdomId, { kind, body, issuedByKind: "system" })
//   → issueDecree(db, decreeId)
// — the exact same two calls a player-ruler or the NPC-ruler cycle uses
// to enact a tax change, festival, pardon, etc. `issuedByKind: "system"`
// is the same bypass `proposeDecree` already grants automated/heartbeat
// callers (see kingdom-decrees.js's authority check) — a council vote is
// a collective decision, not a specific ruler's, so it fits that lane
// rather than the player/npc-ruler-authority lane.
//
// A petition topic that does NOT name a known decree kind is honestly
// reported as `{ ok:false, reason:'no_mapped_effect' }` — not every
// petition needs a mechanical effect (grievances, roleplay-only asks,
// etc. are legitimate), and an honest "this one was advisory" beats a
// silent, untraceable no-op or a fabricated effect.

import logger from "../logger.js";
import { proposeDecree, issueDecree, DECREE_CONSTANTS } from "./kingdom-decrees.js";

/**
 * Apply the real-world effect of an APPROVED council petition.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, session_id: string, topic: string, body?: string|null }} petition
 * @returns {{ ok: boolean, reason?: string, decreeId?: string, kind?: string, kingdomId?: string }}
 */
export function applyPetitionEffect(db, petition) {
  if (!db || !petition?.id || !petition?.session_id || !petition?.topic) {
    return { ok: false, reason: "missing_inputs" };
  }

  const topic = String(petition.topic).trim();

  // Honest-mapping gate: only topics that name a real decree kind get a
  // mechanical effect. KIND_DEFAULTS is kingdom-decrees.js's own
  // source-of-truth vocabulary — we don't maintain a parallel list.
  if (!DECREE_CONSTANTS.KIND_DEFAULTS[topic]) {
    return { ok: false, reason: "no_mapped_effect", topic };
  }

  let session;
  try {
    session = db.prepare(`SELECT realm_id FROM council_sessions WHERE id = ?`).get(petition.session_id);
  } catch (err) {
    return { ok: false, reason: "session_lookup_failed", error: err?.message };
  }
  if (!session?.realm_id) return { ok: false, reason: "session_not_found" };

  let body = {};
  if (petition.body) {
    try { body = JSON.parse(petition.body); } catch { body = {}; }
  }

  let proposed;
  try {
    proposed = proposeDecree(db, session.realm_id, {
      kind: topic,
      body,
      issuedByKind: "system",
      issuedById: null,
    });
  } catch (err) {
    try { logger.warn?.("petition_effect_propose_failed", { petitionId: petition.id, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "propose_failed", error: err?.message };
  }
  if (!proposed?.ok) return { ok: false, reason: proposed?.reason || "propose_failed" };

  let issued;
  try {
    issued = issueDecree(db, proposed.id, { source: "council_petition", petitionId: petition.id });
  } catch (err) {
    try { logger.warn?.("petition_effect_issue_failed", { petitionId: petition.id, decreeId: proposed.id, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "issue_failed", error: err?.message };
  }
  if (!issued?.ok) return { ok: false, reason: issued?.reason || "issue_failed" };

  return { ok: true, decreeId: proposed.id, kind: topic, kingdomId: session.realm_id };
}
