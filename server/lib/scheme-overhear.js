// server/lib/scheme-overhear.js
//
// T2.3 — scheme barge-in ("overhear a scheme").
//
// The CK3-style scheme engine (npc_schemes) runs entirely in the background:
// NPCs plot, gather evidence, and move on targets, and a player could only ever
// learn of a plot by stumbling into the discover-evidence macro. The marquee
// "you walk past two NPCs and overhear them plotting" moment never fired.
//
// This module makes proximity to a plotting NPC surface the plot. When a player
// is within OVERHEAR_RADIUS_M of an NPC plotter mid-scheme, they overhear a
// snippet — which lands as ONE discovered piece of scheme evidence (kind
// 'overheard'). That feeds the existing discovery pipeline: enough evidence
// exposes the scheme (discoverScheme), and an exposed scheme can now fire a
// T2.1 weaponise expose-trigger. One coherent intrigue chain, end to end.
//
// Once-only per (scheme, player): the overheard evidence row is the dedupe key,
// so a player loitering next to a plotter doesn't flood discovery. Deterministic
// snippet (sha1) — no RNG.

import crypto from "node:crypto";

export const OVERHEAR_RADIUS_M = 12;

// Schemes are only overhearable while actively being worked (not terminal, not
// yet exposed). 'planning' is too early (nothing to overhear yet).
export const OVERHEARABLE_PHASES = Object.freeze([
  "recruiting", "gathering_evidence", "moving",
]);

const SNIPPETS = [
  "…keep your voice down. If this gets back to them before we move—",
  "…the evidence is nearly enough. One more piece and we act.",
  "…no one suspects yet. Stay close, say nothing.",
  "…when the moment comes, you'll know your part. Not before.",
  "…it has to look like an accident. Understood?",
  "…they trust the wrong people. That's the opening.",
];

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  } catch { return false; }
}

/** Deterministic overheard snippet for a scheme (stable across re-runs). */
export function composeOverheardSnippet(schemeId, kind = null) {
  const h = crypto.createHash("sha1").update(`${schemeId}|overhear`).digest();
  const base = SNIPPETS[h[0] % SNIPPETS.length];
  const tag = kind ? ` (it has the shape of a ${String(kind).replace(/_/g, " ")} plot)` : "";
  return base + tag;
}

/** Has this player already overheard this scheme? */
export function hasOverheard(db, schemeId, userId) {
  if (!db || !tableExists(db, "npc_scheme_evidence")) return false;
  try {
    const row = db.prepare(`
      SELECT 1 FROM npc_scheme_evidence
      WHERE scheme_id = ? AND evidence_kind = 'overheard' AND discovered_by_user = ? LIMIT 1
    `).get(schemeId, userId);
    return !!row;
  } catch { return false; }
}

/**
 * Record an overheard snippet as one discovered evidence row for this player.
 * Idempotent per (scheme, player). Bumps the scheme's evidence_count and
 * discovery_pct so the existing discover/expose math sees the new evidence.
 * Returns { ok, overheard, snippet?, schemeId, plotterId }.
 */
export function recordOverhear(db, { schemeId, plotterId, userId, kind = null }) {
  if (!db || !schemeId || !userId || !tableExists(db, "npc_scheme_evidence")) {
    return { ok: false, reason: "unavailable" };
  }
  if (hasOverheard(db, schemeId, userId)) return { ok: true, overheard: false, reason: "already_overheard" };

  const snippet = composeOverheardSnippet(schemeId, kind);
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO npc_scheme_evidence
          (id, scheme_id, evidence_kind, detail, discovered_by_user, discovered_at)
        VALUES (?, ?, 'overheard', ?, ?, unixepoch())
      `).run(`ev_${crypto.randomUUID().slice(0, 14)}`, schemeId, snippet, userId);
      // Reflect the new evidence on the scheme row (best-effort columns).
      db.prepare(`
        UPDATE npc_schemes
        SET evidence_count = COALESCE(evidence_count, 0) + 1,
            discovery_pct  = MIN(100, COALESCE(discovery_pct, 0) + 8)
        WHERE id = ?
      `).run(schemeId);
    });
    tx();
    return { ok: true, overheard: true, snippet, schemeId, plotterId };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * For one world: find active, overhearable NPC-plotted schemes whose plotter is
 * within OVERHEAR_RADIUS_M of a player, and record an overhear for each such
 * (scheme, player) pair. `nearbyPairs(plotterId)` is injected so the heartbeat
 * can supply live presence positions without this module importing city-presence
 * (keeps it pure + unit-testable). Returns the list of fired overhears.
 */
export function overhearForWorld(db, worldId, nearbyPlayersForPlotter, { maxPerPass = 40 } = {}) {
  if (!db || !tableExists(db, "npc_schemes")) return { ok: true, fired: [] };
  let schemes = [];
  try {
    const phases = OVERHEARABLE_PHASES.map(() => "?").join(",");
    schemes = db.prepare(`
      SELECT s.id AS scheme_id, s.plotter_id, s.kind
      FROM npc_schemes s
      JOIN world_npcs n ON n.id = s.plotter_id
      WHERE n.world_id = ? AND s.plotter_kind = 'npc'
        AND s.phase IN (${phases})
      ORDER BY s.discovery_pct DESC
      LIMIT ?
    `).all(worldId, ...OVERHEARABLE_PHASES, maxPerPass);
  } catch { return { ok: true, fired: [] }; }

  const fired = [];
  for (const s of schemes) {
    let players = [];
    try { players = nearbyPlayersForPlotter(s.plotter_id) || []; } catch { players = []; }
    for (const userId of players) {
      const r = recordOverhear(db, { schemeId: s.scheme_id, plotterId: s.plotter_id, userId, kind: s.kind });
      if (r.ok && r.overheard) {
        fired.push({ schemeId: s.scheme_id, plotterId: s.plotter_id, userId, snippet: r.snippet });
      }
    }
  }
  return { ok: true, fired };
}
