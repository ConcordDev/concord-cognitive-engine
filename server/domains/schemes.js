// server/domains/schemes.js
//
// Sprint C / Track A4 + Concordia Phase 1 — macro surface for NPC +
// player schemes, plus hooks-as-artifacts.
//
// The scheme state machine lives in `server/lib/npc-schemes.js` and is
// shared with NPC-plotted schemes (npc-scheme-cycle heartbeat). This
// domain exposes:
//   - Player-side scheme initiation (proposePlayerScheme with motive gate)
//   - Player-driven evidence gathering (drops a hook artifact)
//   - List / abandon / discover
//   - Hook lifecycle (hooks.*)
//
// Motive gate (Phase 1): a player can only propose a scheme against an
// NPC who either (a) hates them back (opinion ≤ -50) OR (b) is high-
// stress (stress ≥ 60). This mirrors the NPC-side proposeScheme gate
// so the same emotional-causation rule applies symmetrically and
// players can't griefspam.

import crypto from "node:crypto";
import {
  proposePlayerScheme,
  advanceScheme,
  discoverScheme,
  listSchemesForUser,
  listSchemesAgainstUser,
} from "../lib/npc-schemes.js";
import { getStress } from "../lib/npc-stress.js";
import {
  dropHook,
  pickupHook,
  dropFromSatchel,
  destroyHook,
  listHooksForPlayer,
  listHooksInWorld,
} from "../lib/hook-artifacts.js";

const ELIGIBLE_KINDS = new Set([
  "assassinate", "seduce", "fabricate_secret",
  "claim_inheritance", "blackmail", "sabotage_decree",
]);

function loadOwnedActiveScheme(db, schemeId, userId) {
  const sch = db.prepare(`
    SELECT id, plotter_kind, plotter_id, kind, phase, target_kind, target_id
    FROM npc_schemes WHERE id = ?
  `).get(schemeId);
  if (!sch) return { ok: false, reason: "scheme_not_found" };
  if (sch.plotter_kind !== "player" || sch.plotter_id !== userId) return { ok: false, reason: "not_yours" };
  if (["complete", "abandoned", "exposed"].includes(sch.phase)) return { ok: false, reason: "scheme_terminal" };
  return { ok: true, scheme: sch };
}

function hasMotive(db, userId, targetKind, targetId) {
  if (targetKind !== "npc") return true;
  const op = db.prepare(`
    SELECT score FROM character_opinions
    WHERE npc_id = ? AND target_kind = 'player' AND target_id = ?
  `).get(targetId, userId);
  if (op && op.score <= -50) return true;
  const stress = getStress(db, targetId);
  if (stress && (stress.stress ?? 0) >= 60) return true;
  return false;
}

export default function registerSchemesMacros(register) {
  // ─── existing macros (preserved for back-compat) ─────────────────

  /**
   * schemes.list_for_user — schemes the caller is plotting.
   */
  register("schemes", "list_for_user", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, schemes: listSchemesForUser(db, userId) };
  });

  /**
   * schemes.list_against_user — schemes the caller is targeted by (suspected).
   */
  register("schemes", "list_against_user", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, schemes: listSchemesAgainstUser(db, userId) };
  });

  /**
   * schemes.propose_player_scheme — open a player-driven scheme.
   * Phase 1 adds the motive gate: target NPC must hate the player back
   * (opinion ≤ -50) OR be high-stress (≥ 60). Non-NPC targets are
   * always allowed.
   * input: { targetKind, targetId, kind }
   */
  register("schemes", "propose_player_scheme", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const targetKind = String(input?.targetKind || "").trim();
    const targetId = String(input?.targetId || "").trim();
    const kind = String(input?.kind || "").trim();
    if (!targetKind || !targetId || !kind) return { ok: false, reason: "missing_inputs" };
    if (!ELIGIBLE_KINDS.has(kind)) return { ok: false, reason: "bad_kind" };
    if (!hasMotive(db, userId, targetKind, targetId)) return { ok: false, reason: "no_motive" };
    return proposePlayerScheme(db, userId, { targetKind, targetId, kind });
  });

  /**
   * schemes.discover_evidence — caller marks scheme evidence as discovered.
   * input: { schemeId, evidenceKind? }
   */
  register("schemes", "discover_evidence", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.schemeId) return { ok: false, reason: "missing_inputs" };
    return discoverScheme(db, userId, input.schemeId, input.evidenceKind);
  });

  /**
   * schemes.overheard — T2.3 schemes the player has overheard (barge-in). Each
   * carries the snippet + current discovery progress so the UI can offer an
   * "investigate / expose" action that calls discover_evidence.
   */
  register("schemes", "overheard", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT e.scheme_id, e.detail AS snippet, e.discovered_at,
               s.plotter_id, s.kind, s.phase, s.discovery_pct, s.evidence_count
        FROM npc_scheme_evidence e
        JOIN npc_schemes s ON s.id = e.scheme_id
        WHERE e.evidence_kind = 'overheard' AND e.discovered_by_user = ?
          AND s.phase NOT IN ('complete','abandoned')
        ORDER BY e.discovered_at DESC LIMIT 30
      `).all(userId);
    } catch { rows = []; }
    return { ok: true, overheard: rows };
  });

  // ─── new Phase 1 macros ──────────────────────────────────────────

  /**
   * schemes.list_targets — NPCs eligible as scheme targets.
   * Two buckets: opinion ≤ -50 OR stress ≥ 60. Deduped by npcId.
   */
  register("schemes", "list_targets", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input?.limit) || 30, 1), 100);
    const lowOp = db.prepare(`
      SELECT npc_id AS id, score FROM character_opinions
      WHERE target_kind = 'player' AND target_id = ? AND score <= -50
      ORDER BY score ASC LIMIT ?
    `).all(userId, limit);
    const highStress = db.prepare(`
      SELECT npc_id AS id, stress, coping_trait FROM npc_stress
      WHERE stress >= 60
      ORDER BY stress DESC LIMIT ?
    `).all(limit);
    const seen = new Set();
    const targets = [];
    for (const row of lowOp) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      targets.push({ npcId: row.id, reason: "low_opinion", opinion: row.score });
    }
    for (const row of highStress) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      targets.push({ npcId: row.id, reason: "high_stress", stress: row.stress, coping: row.coping_trait });
    }
    return { ok: true, targets };
  });

  /**
   * schemes.gather_evidence — player-driven evidence collection.
   * Adds one evidence row, drops a hook artifact at the player's
   * position so they can carry / hide / destroy it.
   * input: { schemeId, worldId, location?: {x,y,z} }
   */
  register("schemes", "gather_evidence", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const schemeId = String(input?.schemeId || "").trim();
    const worldId = String(input?.worldId || "").trim();
    if (!schemeId || !worldId) return { ok: false, reason: "missing_inputs" };

    const own = loadOwnedActiveScheme(db, schemeId, userId);
    if (!own.ok) return own;
    const scheme = own.scheme;
    if (!["recruiting", "gathering_evidence"].includes(scheme.phase)) {
      return { ok: false, reason: "wrong_phase", phase: scheme.phase };
    }

    const evidenceId = `ev_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare(`
      INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind, detail)
      VALUES (?, ?, ?, ?)
    `).run(evidenceId, schemeId, scheme.kind, `gathered by ${userId} for ${scheme.kind}`);

    db.prepare(`
      UPDATE npc_schemes
      SET evidence_count = evidence_count + 1,
          discovery_pct = MIN(100, discovery_pct + 5)
      WHERE id = ?
    `).run(schemeId);

    const hookRes = dropHook(db, {
      worldId,
      evidenceId,
      holderKind: "world",
      holderId: "",
      location: input?.location || null,
      label: `${scheme.kind} evidence`,
    });

    return {
      ok: true,
      action: "evidence_added",
      schemeId,
      evidenceId,
      hookId: hookRes.ok ? hookRes.hookId : null,
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * schemes.move — force-advance a player scheme one phase.
   * Resolution is identical to NPC schemes (advanceScheme reuses applyResolution).
   */
  register("schemes", "move", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const schemeId = String(input?.schemeId || "").trim();
    if (!schemeId) return { ok: false, reason: "missing_inputs" };
    const own = loadOwnedActiveScheme(db, schemeId, userId);
    if (!own.ok) return own;
    return advanceScheme(db, schemeId, { io: ctx?.io || null });
  });

  /**
   * schemes.abandon — abandon a player scheme.
   */
  register("schemes", "abandon", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const schemeId = String(input?.schemeId || "").trim();
    if (!schemeId) return { ok: false, reason: "missing_inputs" };
    const own = loadOwnedActiveScheme(db, schemeId, userId);
    if (!own.ok) return own;
    db.prepare(`
      UPDATE npc_schemes SET phase = 'abandoned', resolved_at = unixepoch() WHERE id = ?
    `).run(schemeId);
    return { ok: true, action: "abandoned", schemeId };
  });

  // ─── hooks.* macros ──────────────────────────────────────────────

  /**
   * hooks.list — hooks in player's satchel. Optional worldId scopes to one world.
   */
  register("hooks", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = input?.worldId ? String(input.worldId) : null;
    return { ok: true, hooks: listHooksForPlayer(db, userId, { worldId }) };
  });

  /**
   * hooks.list_in_world — hooks lying around a world.
   */
  register("hooks", "list_in_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_world" };
    return { ok: true, hooks: listHooksInWorld(db, worldId) };
  });

  /**
   * hooks.pickup — player picks up a hook from the world.
   */
  register("hooks", "pickup", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const hookId = String(input?.hookId || "").trim();
    if (!hookId) return { ok: false, reason: "missing_inputs" };
    return pickupHook(db, userId, hookId);
  });

  /**
   * hooks.drop — drop a satchel hook into the world at a position.
   */
  register("hooks", "drop", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const hookId = String(input?.hookId || "").trim();
    if (!hookId) return { ok: false, reason: "missing_inputs" };
    return dropFromSatchel(db, userId, hookId, input?.location || null);
  });

  /**
   * hooks.destroy — destroy a satchel hook. Final state.
   */
  register("hooks", "destroy", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const hookId = String(input?.hookId || "").trim();
    if (!hookId) return { ok: false, reason: "missing_inputs" };
    return destroyHook(db, userId, hookId);
  });
}
