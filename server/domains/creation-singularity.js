// server/domains/creation-singularity.js
//
// P-D — Creation Singularity: the macro surface for the NON-MONETARY
// fork-vs-fork tournament arena (server/lib/creation-singularity.js).
//
// Entrants are `fork_objects` (lib/lattice-fork.js, mig 351) — bounded,
// confined clones of a user's own DTU corpus. Every score is computed by
// instantiating that SAME confined sandbox (instantiateForkSandbox) and
// reading DTUs ONLY through its bounded accessor; this domain file never
// widens that confinement and never touches money — there is no
// prize_pool_cc, no escrow, no mintCoins, no wallet field ANYWHERE below.
// The only reward on completion is a ranking + a citable result DTU, minted
// through the ordinary `dtu.create` macro (the same host-context call
// `fork.js`'s "feed" macro already uses) — NOT from inside a confined
// sandbox, because a confined sandbox structurally cannot reach dtu.create
// (default-deny manifest) and was never meant to; the arena orchestrator
// itself runs in the normal (unconfined) macro context, and only the
// per-fork SCORING step dips into confinement.
//
// Distinct from server/domains/tournaments.js (PvP bracket toolkit with
// prize_pool_cc/payoutSplit) — studied for its bracket SHAPE (single-elim +
// byes + round advancement), shares none of its money surface.

import {
  createArena,
  loadArena,
  listArenasForOwner,
  runArenaRound,
  runArenaToCompletion,
  rankingFromBracket,
  MAX_ARENA_FORKS,
} from "../lib/creation-singularity.js";

const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";

function publicArena(arena) {
  if (!arena) return null;
  return {
    id: arena.id,
    title: arena.title,
    forkIds: arena.forkIds,
    forkCount: arena.forkIds.length,
    bracket: arena.bracket,
    roundCount: arena.bracket.length,
    status: arena.status,
    championForkId: arena.championForkId,
    resultDtuId: arena.resultDtuId,
    log: arena.log.slice(0, 100),
    createdAt: arena.createdAt,
    completedAt: arena.completedAt,
  };
}

function renderResultCreti(arena, ranking) {
  const lines = [];
  lines.push(`Creation Singularity Arena: ${arena.title}`);
  lines.push(`Entrants: ${arena.forkIds.length} confined lattice-fork sandbox(es)`);
  lines.push(`Rounds: ${arena.bracket.length}`);
  lines.push("");
  lines.push("Final ranking (deterministic, scored via each fork's own confined DTU set):");
  ranking.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.forkObjectId}${r.eliminatedInRound ? ` — eliminated round ${r.eliminatedInRound}` : " — CHAMPION"}`,
    );
  });
  lines.push("");
  lines.push("Round-by-round results:");
  for (const round of arena.bracket) {
    for (const m of round) {
      if (m.status === "bye") {
        lines.push(`  R${m.round} slot ${m.slot}: bye → ${m.winnerId}`);
      } else if (m.status === "complete") {
        lines.push(
          `  R${m.round} slot ${m.slot}: ${m.forkAId} (score ${m.scoreA}) vs ${m.forkBId} (score ${m.scoreB}) → ${m.winnerId}${m.tiebreak ? " [tiebreak]" : ""}`,
        );
      }
    }
  }
  lines.push("");
  lines.push("Non-monetary by construction: no prize pool, no escrow, no coin was minted or transferred to produce this result.");
  return lines.join("\n");
}

export default function registerCreationSingularityActions(registerLensAction) {
  /**
   * arena_create — seed a bracket of >=2 fork objects you own.
   * params: { title?, forkObjectIds: string[] }
   */
  registerLensAction("creation_singularity", "arena_create", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      const userId = actor(ctx);
      if (!db) return { ok: false, error: "no_db" };
      if (!userId || userId === "anon") return { ok: false, error: "auth_required" };

      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const result = createArena(db, {
        ownerUserId: userId,
        title: p.title,
        forkObjectIds: p.forkObjectIds,
      });
      if (!result.ok) return result;
      return { ok: true, result: { arena: publicArena(result.arena), maxArenaForks: MAX_ARENA_FORKS } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  /**
   * arena_run_round — resolve exactly the current pending round and advance
   * the bracket if that round is now fully resolved. Returns the updated
   * arena; `finished` marks whether the arena just completed.
   * params: { arenaId }
   */
  registerLensAction("creation_singularity", "arena_run_round", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      const userId = actor(ctx);
      if (!db) return { ok: false, error: "no_db" };
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const existing = loadArena(db, p.arenaId);
      if (!existing) return { ok: false, error: "arena_not_found" };
      if (existing.ownerUserId !== userId) return { ok: false, error: "forbidden" };

      const r = runArenaRound(db, p.arenaId);
      if (!r.ok) return { ok: false, error: r.error, forkId: r.forkId, arena: publicArena(r.arena) };
      return { ok: true, result: { arena: publicArena(r.arena), finished: !!r.finished } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  /**
   * arena_run — run every remaining round to completion in one call. On
   * first completion, mints the ONE reward: a citable result DTU (ranking +
   * round-by-round scores). Idempotent — re-calling after completion just
   * returns the existing arena + resultDtuId without re-minting.
   * params: { arenaId }
   */
  registerLensAction("creation_singularity", "arena_run", async (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      const userId = actor(ctx);
      if (!db) return { ok: false, error: "no_db" };
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const existing = loadArena(db, p.arenaId);
      if (!existing) return { ok: false, error: "arena_not_found" };
      if (existing.ownerUserId !== userId) return { ok: false, error: "forbidden" };

      if (existing.status === "completed" && existing.resultDtuId) {
        return {
          ok: true,
          result: {
            arena: publicArena(existing),
            ranking: rankingFromBracket(existing),
            resultDtuId: existing.resultDtuId,
            alreadyCompleted: true,
          },
        };
      }

      const r = runArenaToCompletion(db, p.arenaId);
      if (!r.ok) return { ok: false, error: r.error, forkId: r.forkId, arena: publicArena(r.arena) };

      let arena = r.arena;
      const ranking = rankingFromBracket(arena);

      // Mint the ONE reward — a citable result DTU — through the ordinary,
      // unconfined `dtu.create` macro. This call happens in the HOST macro
      // context (ctx here is NOT a confined sandbox ctx), which is the only
      // context that can reach dtu.create at all.
      if (!arena.resultDtuId && typeof ctx?.macro?.run === "function") {
        const dtuRes = await ctx.macro.run("dtu", "create", {
          title: `Creation Singularity result: ${arena.title}`,
          creti: renderResultCreti(arena, ranking),
          tags: ["creation-singularity", "fork-arena", "non-monetary", "tournament-result"],
          source: "creation-singularity-arena",
          meta: {
            arenaId: arena.id,
            championForkId: arena.championForkId,
            forkCount: arena.forkIds.length,
            roundCount: arena.bracket.length,
            ranking,
          },
        });
        if (dtuRes?.ok && dtuRes.dtu?.id) {
          // Persist the resultDtuId onto the arena row via a second,
          // targeted createArena-style save. runArenaToCompletion already
          // persisted the completed bracket; here we only need to stamp the
          // result_dtu_id column, so re-run the same upsert path via
          // runArenaRound's persistArena is not exposed — instead we
          // reload+patch+resave through the lib's own arena shape by
          // calling loadArena again is unnecessary: mutate + persist here
          // using the same table directly is avoided by design (single
          // persistence owner = lib/creation-singularity.js). Re-use the
          // lib's persistence by round-tripping through runArenaRound is
          // not applicable post-completion, so we fall back to a narrow,
          // explicit column update scoped to this one field.
          db.prepare(
            "UPDATE creation_singularity_arenas SET result_dtu_id = ? WHERE id = ?",
          ).run(dtuRes.dtu.id, arena.id);
          arena = { ...arena, resultDtuId: dtuRes.dtu.id };
        }
      }

      return {
        ok: true,
        result: {
          arena: publicArena(arena),
          ranking,
          resultDtuId: arena.resultDtuId || null,
          finished: true,
        },
      };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  /** arena_get — { arenaId } */
  registerLensAction("creation_singularity", "arena_get", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      const userId = actor(ctx);
      if (!db) return { ok: false, error: "no_db" };
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const arena = loadArena(db, p.arenaId);
      if (!arena) return { ok: false, error: "arena_not_found" };
      if (arena.ownerUserId !== userId) return { ok: false, error: "forbidden" };
      return {
        ok: true,
        result: { arena: publicArena(arena), ranking: arena.status === "completed" ? rankingFromBracket(arena) : [] },
      };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  /** arena_list — every arena you own. */
  registerLensAction("creation_singularity", "arena_list", (ctx, _artifact, _params) => {
    try {
      const db = ctx?.db;
      const userId = actor(ctx);
      if (!db) return { ok: false, error: "no_db" };
      const arenas = listArenasForOwner(db, userId).map(publicArena);
      return { ok: true, result: { arenas, count: arenas.length } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });
}
