// server/domains/cross-world-schemes.js
//
// Macro surface for `server/lib/cross-world-schemes.js` — a fully-built,
// tested NPC-and-player-plottable cross-world scheme engine (6 kinds:
// assassinate / seduce / fabricate_secret / claim_inheritance / blackmail /
// sabotage_decree) that previously had zero macro/route/frontend consumer.
// The `cross-world-scheme-cycle` heartbeat advances scheme phases on its
// own cadence; this domain adds the read + player-action surface.
//
// Full plotter/target parity by explicit design decision: a real player
// can propose a scheme (any of the six kinds) targeting either an NPC or
// ANOTHER REAL PLAYER, exactly like an NPC-plotted scheme — the lib
// function already supports this (`plotterKind`/`targetKind` are free-form
// 'npc' | 'player'). This domain does not add narrower restrictions than
// the lib already enforces (same_world check, duplicate-scheme check,
// npc-relationship-required-for-npc-plotters check, kill switch).
//
// Security note: when `plotterKind === 'player'`, `plotterId` is ALWAYS
// taken from `ctx.actor.userId`, never from client input — a caller
// cannot spoof another player as the plotter. NPC-plotted schemes (used
// by internal/admin tooling, not the standard player flow) pass through
// the supplied `plotterId` unchanged.

import {
  proposeCrossWorldScheme,
  discoverCrossWorldScheme,
  listActiveCrossWorldSchemes,
  listConsequencesForScheme,
  listConsequencesForWorld,
} from "../lib/cross-world-schemes.js";

const VALID_KINDS = new Set([
  "assassinate", "seduce", "fabricate_secret",
  "claim_inheritance", "blackmail", "sabotage_decree",
]);

export default function registerCrossWorldSchemesMacros(register) {
  /**
   * crossworld.schemes_active — active (non-terminal, due) cross-world
   * schemes. Honest empty array when there are none or the table is
   * missing (the lib degrades gracefully via try/catch).
   * input: { limit? }
   */
  register("crossworld", "schemes_active", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input?.limit) || 100, 1), 500);
    return { ok: true, schemes: listActiveCrossWorldSchemes(db, { limit }) };
  }, { note: "active cross-world schemes due for advancement; honest empty list when none" });

  /**
   * crossworld.scheme_detail — single scheme lookup by id. There is no
   * dedicated single-get in the lib, so this reads the row directly
   * (explicit column set is unnecessary here — cross_world_schemes has
   * no secret/solution columns, unlike hacking.getPuzzle).
   * input: { schemeId }
   */
  register("crossworld", "scheme_detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const schemeId = String(input?.schemeId || "").trim();
    if (!schemeId) return { ok: false, reason: "missing_inputs" };
    let scheme = null;
    try {
      scheme = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(schemeId) || null;
    } catch {
      return { ok: false, reason: "table_unavailable" };
    }
    if (!scheme) return { ok: false, reason: "scheme_not_found" };
    return { ok: true, scheme };
  }, { note: "single cross-world scheme lookup by id" });

  /**
   * crossworld.consequences_for_world — every recorded consequence that
   * affected the requested world (either the plotter- or target-side,
   * whichever this world was for a given scheme). Server-side re-filter
   * on `affected_world_id` is defense-in-depth on top of the lib's own
   * SQL filter — a cross-world leak here would be a real privacy bug,
   * not a cosmetic one.
   * input: { worldId, limit? }
   */
  register("crossworld", "consequences_for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_inputs" };
    const limit = Math.min(Math.max(Number(input?.limit) || 50, 1), 200);
    const rows = listConsequencesForWorld(db, worldId, { limit });
    const consequences = rows.filter((r) => r.affected_world_id === worldId);
    return { ok: true, consequences };
  }, { note: "consequences scoped to one world; re-filters server-side against cross-world leak" });

  /**
   * crossworld.consequences_for_scheme — full consequence ledger (both
   * affected worlds) for one scheme.
   * input: { schemeId }
   */
  register("crossworld", "consequences_for_scheme", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const schemeId = String(input?.schemeId || "").trim();
    if (!schemeId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, consequences: listConsequencesForScheme(db, schemeId) };
  }, { note: "full consequence ledger (both affected worlds) for one scheme" });

  /**
   * crossworld.discover — player-driven counter-play: the caller carries
   * evidence of a cross-world plot between worlds, exposing it. Raises
   * discovery_pct to 100 and flips phase to 'exposed' (lib behavior,
   * unchanged here).
   * input: { schemeId, evidenceKind? }
   */
  register("crossworld", "discover", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const schemeId = String(input?.schemeId || "").trim();
    if (!schemeId) return { ok: false, reason: "missing_inputs" };
    const evidenceKind = input?.evidenceKind ? String(input.evidenceKind) : "observed";
    return discoverCrossWorldScheme(db, userId, schemeId, evidenceKind);
  }, { note: "player exposes a cross-world plot; raises discovery_pct and flips phase to exposed" });

  /**
   * crossworld.propose — open a new cross-world scheme. Full plotter/
   * target parity: plotterKind and targetKind may each independently be
   * 'npc' or 'player' (target may also be 'faction' | 'kingdom' per the
   * lib's CHECK constraint). When plotterKind is 'player', plotterId is
   * always the calling user (ctx.actor.userId) — never client-supplied,
   * to prevent spoofing another player as the plotter.
   * input: { plotterWorld, plotterId?, plotterKind?, targetWorld, targetKind?, targetId, kind }
   */
  register("crossworld", "propose", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const plotterKind = input?.plotterKind === "npc" ? "npc" : "player";
    let plotterId;
    if (plotterKind === "player") {
      plotterId = ctx?.actor?.userId;
      if (!plotterId) return { ok: false, reason: "no_user" };
    } else {
      plotterId = String(input?.plotterId || "").trim();
    }

    const plotterWorld = String(input?.plotterWorld || "").trim();
    const targetWorld = String(input?.targetWorld || "").trim();
    const targetKind = ["npc", "player", "faction", "kingdom"].includes(input?.targetKind)
      ? input.targetKind
      : "npc";
    const targetId = String(input?.targetId || "").trim();
    const kind = String(input?.kind || "").trim();

    if (!plotterWorld || !plotterId || !targetWorld || !targetId || !kind) {
      return { ok: false, reason: "missing_inputs" };
    }
    if (!VALID_KINDS.has(kind)) return { ok: false, reason: "bad_kind" };

    return proposeCrossWorldScheme(db, {
      plotterWorld, plotterId, plotterKind,
      targetWorld, targetKind, targetId,
      kind,
    });
  }, { note: "propose a cross-world scheme; plotterKind/targetKind support full npc-or-player parity" });
}
