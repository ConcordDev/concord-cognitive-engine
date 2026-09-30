// server/lib/creation-singularity.js
//
// P-D — Creation Singularity: a NON-MONETARY fork-vs-fork tournament arena
// built on top of the lattice-fork sandbox primitive (lib/lattice-fork.js).
//
// What this is: seed a single-elimination bracket of `fork_objects`
// (server/migrations/351_fork_objects.js), run deterministic head-to-head
// "rounds" that score each entrant via a real, computable synthesis-quality
// signal derived from the DTUs the fork actually carries — read ONLY through
// the fork's own confined sandbox (instantiateForkSandbox), never a raw
// query — advance the bracket, and record results. The only reward is a
// ranking + a citable result DTU (minted by the caller, see
// domains/creation-singularity.js — this lib never touches ctx/dtu.create
// itself so it stays pure/testable).
//
// What this is NOT (P-D audit constraint, never owner-reviewed, stays out):
//   • no prize_pool_cc, no escrow, no mintCoins, no wallet, no CC anywhere.
//   • not the PvP tournaments toolkit (migrations/103_tournaments.js +
//     domains/tournaments.js) — that's a SEPARATE, money-shaped system for
//     live players. This file studies its bracket SHAPE (single-elim with
//     byes, round advancement) but shares none of its persistence or its
//     escrow.
//
// Confinement: every score is computed by instantiating the SAME confined
// sandbox `fork.instantiate_preview` uses (lib/lattice-fork.js#instantiateForkSandbox)
// and reading DTUs ONLY through its bounded, SELECT-only `readDtu` accessor.
// The sandbox ctx it builds grants ZERO host macros (default-deny manifest,
// no db, no mintCoins — lib/confined-ctx.js) — this module composes that
// primitive and never widens it. `assertConfined` is checked on every score
// computation and surfaced in the result, never merely assumed.
//
// Determinism: EVERY random-looking choice in this file is actually a
// deterministic function of fork identity or fork *content* — bracket
// seeding hashes fork ids (sha256, not Math.random), scoring reads real DTU
// fields (tier/content/tags/structured claims), and the tiebreak is a plain
// lexical compare. Re-running the same bracket over the same DTUs always
// produces the same winner. There is no Math.random() anywhere in this file.

import crypto from "node:crypto";
import { loadForkObject, instantiateForkSandbox } from "./lattice-fork.js";
import { assertConfined } from "./confined-ctx.js";

// Bracket-size cap. Smaller than MAX_FORK_DTUS (500, a per-fork DTU bound) —
// this bounds the number of FORKS in one tournament, a different axis. A
// hard REJECT (never silent truncation), same idiom as lattice-fork.js's
// MAX_FORK_DTUS.
export const MAX_ARENA_FORKS = Number(process.env.CONCORD_MAX_ARENA_FORKS) || 32;

// ── small DB guards (mirrors lattice-fork.js's idiom) ──────────────────────

function tableExists(db, table) {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
  } catch {
    return false;
  }
}

// ── (1) the scoring function ────────────────────────────────────────────
//
// computeForkScore is the ONLY place a fork's "quality" is judged. It is
// deterministic and honest by construction:
//   • Every input comes from a REAL dtus row, read through the fork's own
//     confined sandbox — never fabricated, never invented for a DTU that
//     isn't actually in the fork's bounded clone set.
//   • The formula rewards real structural signals already meaningful
//     elsewhere in this codebase: `tier` (regular/mega/hyper — the DTU
//     consolidation pipeline's own quality ladder, see CLAUDE.md "DTU
//     substrate" — a HYPER DTU is HASH-mode design target (live IR ~1.2×)-compressed synthesized knowledge,
//     objectively a stronger signal than an unconsolidated regular DTU),
//     content depth (log-scaled so one long DTU can't dominate — this is a
//     BREADTH-of-synthesis metric, not a word-count contest), tag diversity
//     (breadth), and structured `core.claims` (the DTU four-layer model's
//     structured-knowledge layer, when a fork actually carries it).
//   • A small temperament-coherence factor reads the fork's OWN recorded
//     `valueDrift` (mig 330, captured at fork-creation time by
//     captureTemperamentSnapshot) — real recorded data, not invented.
//   • Nothing here is `Math.random()`. Nothing here is an LLM guess. Two
//     calls against the same DTUs always return the same score.

const TIER_WEIGHT = Object.freeze({ regular: 1, mega: 3, hyper: 8, shadow: 0.5 });

/** Pure per-DTU signal. `row` is a raw `dtus` table row. */
export function synthesisSignal(row) {
  let body = {};
  let tags = [];
  try { body = JSON.parse(row?.body_json || "{}"); } catch { body = {}; }
  try { tags = JSON.parse(row?.tags_json || "[]"); } catch { tags = []; }

  const tierWeight = TIER_WEIGHT[row?.tier] ?? TIER_WEIGHT.regular;

  const contentLen = typeof body.content === "string" ? body.content.length : 0;
  const summaryLen = typeof body.summary === "string" ? body.summary.length : 0;
  // Diminishing-returns depth: log2, each capped, so one giant DTU cannot
  // dwarf every other entrant's actual synthesis breadth.
  const depthSignal =
    Math.log2(1 + Math.min(contentLen, 20000)) +
    Math.log2(1 + Math.min(summaryLen, 4000)) * 0.5;

  const uniqueTags = Array.isArray(tags) ? new Set(tags.map(String)).size : 0;

  // Structured-claim bonus — the DTU "core" layer's real claims array, when
  // present. Never invented when absent (defaults to 0, not fabricated).
  const claims = Array.isArray(body?.core?.claims) ? body.core.claims.length : 0;

  const raw = tierWeight * depthSignal + uniqueTags * 0.5 + claims * 1.5;
  return {
    raw: Math.round(raw * 1000) / 1000,
    tierWeight,
    depthSignal: Math.round(depthSignal * 1000) / 1000,
    uniqueTags,
    claims,
  };
}

/**
 * Score a single fork by instantiating its confined sandbox and reading
 * EVERY dtu it carries through the sandbox's bounded `readDtu` — never a
 * raw query against `dtus`. Honest failures: fork_not_found,
 * confinement_check_failed (surfaced, never silently swallowed).
 */
export function computeForkScore(db, forkObjectId) {
  const fork = loadForkObject(db, forkObjectId);
  if (!fork) return { ok: false, error: "fork_not_found", forkObjectId };

  const sandbox = instantiateForkSandbox(forkObjectId, db);
  if (!sandbox.ok) return { ok: false, error: sandbox.error || "sandbox_failed", forkObjectId };

  const confined = sandbox.confined || assertConfined(sandbox.ctx);
  if (!confined.ok) {
    return { ok: false, error: "confinement_check_failed", reason: confined.reason, forkObjectId };
  }

  const perDtu = [];
  let sum = 0;
  for (const id of sandbox.dtuIds) {
    const r = sandbox.readDtu(id);
    if (!r.ok || !r.dtu) continue; // honest: skip a since-deleted DTU, never fabricate a score for it
    const sig = synthesisSignal(r.dtu);
    perDtu.push({ dtuId: id, ...sig });
    sum += sig.raw;
  }

  const drift = Number(fork?.temperament?.valueDrift);
  const coherence = Number.isFinite(drift) ? 1 - Math.min(0.5, Math.abs(drift)) : 1;
  const score = Math.round(sum * coherence * 1000) / 1000;

  return {
    ok: true,
    forkObjectId,
    score,
    dtuCount: perDtu.length,
    breakdown: { rawSum: Math.round(sum * 1000) / 1000, coherence, perDtu },
    confined,
  };
}

/**
 * One deterministic head-to-head. A bye (either side null) auto-advances
 * without a score. Otherwise both entrants are scored via computeForkScore
 * (confined runs) and the higher score wins; an exact tie breaks on a plain
 * lexical id compare — deterministic, never a coin flip.
 */
export function runHeadToHead(db, forkAId, forkBId) {
  if (!forkAId && !forkBId) return { ok: false, error: "empty_match" };
  if (!forkAId) return { ok: true, winnerId: forkBId, scoreA: null, scoreB: null, bye: true };
  if (!forkBId) return { ok: true, winnerId: forkAId, scoreA: null, scoreB: null, bye: true };

  const a = computeForkScore(db, forkAId);
  if (!a.ok) return { ok: false, error: a.error, forkId: forkAId };
  const b = computeForkScore(db, forkBId);
  if (!b.ok) return { ok: false, error: b.error, forkId: forkBId };

  let winnerId;
  let tiebreak = false;
  if (a.score > b.score) winnerId = forkAId;
  else if (b.score > a.score) winnerId = forkBId;
  else { winnerId = forkAId < forkBId ? forkAId : forkBId; tiebreak = true; }

  return {
    ok: true,
    winnerId,
    scoreA: a.score,
    scoreB: b.score,
    breakdownA: a.breakdown,
    breakdownB: b.breakdown,
    confinedA: a.confined,
    confinedB: b.confined,
    tiebreak,
  };
}

// ── (2) bracket seeding + generation ────────────────────────────────────
//
// Seeding order is a deterministic function of fork IDENTITY (a sha256 hash
// of the id, not creation order and not Math.random) — reproducible, and
// not trivially biased toward "whoever was entered first."

function seedHash(forkObjectId) {
  const h = crypto.createHash("sha256").update(String(forkObjectId)).digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

export function seedEntrants(forkObjectIds) {
  const deduped = [...new Set((forkObjectIds || []).map(String).filter(Boolean))];
  return deduped
    .map((id) => ({ forkObjectId: id, seedKey: seedHash(id) }))
    .sort((x, y) => x.seedKey - y.seedKey)
    .map((e, i) => ({ forkObjectId: e.forkObjectId, seed: i + 1 }));
}

/** Round 1 of a single-elimination bracket, with byes for a non-power-of-2 entrant count. */
export function genRound1Bracket(seeded) {
  const n = seeded.length;
  let size = 1;
  while (size < n) size *= 2;
  const slots = new Array(size).fill(null);
  seeded.forEach((e, i) => { slots[i] = e.forkObjectId; });

  const matches = [];
  for (let i = 0; i < size; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    matches.push({
      round: 1,
      slot: i / 2,
      forkAId: a,
      forkBId: b,
      winnerId: a && !b ? a : (!a && b ? b : null),
      scoreA: null,
      scoreB: null,
      status: a && b ? "pending" : "bye",
      tiebreak: false,
    });
  }
  return matches;
}

/**
 * Build the next round from a fully-resolved previous round. Returns
 * `{ done: true, championId }` when only one winner remains, otherwise
 * `{ done: false, matches }`.
 */
export function advanceRound(prevMatches, nextRoundNum) {
  const winners = [...prevMatches].sort((x, y) => x.slot - y.slot).map((m) => m.winnerId);
  if (winners.some((w) => !w)) return { done: false, error: "round_not_resolved" };
  if (winners.length <= 1) return { done: true, championId: winners[0] || null };

  const matches = [];
  let slot = 0;
  for (let i = 0; i < winners.length; i += 2) {
    const a = winners[i];
    const b = winners[i + 1] || null;
    matches.push({
      round: nextRoundNum,
      slot: slot++,
      forkAId: a,
      forkBId: b,
      winnerId: a && !b ? a : null,
      scoreA: null,
      scoreB: null,
      status: a && b ? "pending" : "bye",
      tiebreak: false,
    });
  }
  return { done: false, matches };
}

// ── (3) persistence (mig 370 creation_singularity_arenas) ──────────────

function rowToArena(row) {
  let forkIds = [];
  let bracket = [];
  let log = [];
  try { forkIds = JSON.parse(row.fork_ids_json || "[]"); } catch { forkIds = []; }
  try { bracket = JSON.parse(row.bracket_json || "[]"); } catch { bracket = []; }
  try { log = JSON.parse(row.log_json || "[]"); } catch { log = []; }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    forkIds,
    bracket,
    status: row.status,
    championForkId: row.champion_fork_id,
    resultDtuId: row.result_dtu_id,
    log,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function persistArena(db, arena) {
  db.prepare(
    `INSERT INTO creation_singularity_arenas
       (id, owner_user_id, title, fork_ids_json, bracket_json, status,
        champion_fork_id, result_dtu_id, log_json, created_at, completed_at)
     VALUES (@id, @ownerUserId, @title, @forkIdsJson, @bracketJson, @status,
             @championForkId, @resultDtuId, @logJson, @createdAt, @completedAt)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       fork_ids_json = excluded.fork_ids_json,
       bracket_json = excluded.bracket_json,
       status = excluded.status,
       champion_fork_id = excluded.champion_fork_id,
       result_dtu_id = excluded.result_dtu_id,
       log_json = excluded.log_json,
       completed_at = excluded.completed_at`,
  ).run({
    id: arena.id,
    ownerUserId: arena.ownerUserId,
    title: arena.title,
    forkIdsJson: JSON.stringify(arena.forkIds),
    bracketJson: JSON.stringify(arena.bracket),
    status: arena.status,
    championForkId: arena.championForkId || null,
    resultDtuId: arena.resultDtuId || null,
    logJson: JSON.stringify(arena.log),
    createdAt: arena.createdAt,
    completedAt: arena.completedAt ?? null,
  });
}

export function loadArena(db, arenaId) {
  if (!db || !tableExists(db, "creation_singularity_arenas")) return null;
  let row = null;
  try {
    row = db.prepare("SELECT * FROM creation_singularity_arenas WHERE id = ?").get(String(arenaId));
  } catch {
    row = null;
  }
  return row ? rowToArena(row) : null;
}

export function listArenasForOwner(db, ownerUserId) {
  if (!db || !tableExists(db, "creation_singularity_arenas")) return [];
  try {
    return db
      .prepare("SELECT * FROM creation_singularity_arenas WHERE owner_user_id = ? ORDER BY created_at DESC")
      .all(String(ownerUserId))
      .map(rowToArena);
  } catch {
    return [];
  }
}

// ── (4) arena lifecycle ─────────────────────────────────────────────────

/**
 * Seed a bracket of >=2 fork objects, ALL owned by `ownerUserId` (self-fork
 * tournaments only — an arena never reads a stranger's forked corpus; the
 * same "personal surface" boundary `fork.instantiate_preview` enforces).
 * Honest failures: insufficient_forks (<2), arena_bound_exceeded (>MAX),
 * fork_not_found / forbidden (named per offending fork id).
 */
export function createArena(db, { ownerUserId, title, forkObjectIds } = {}) {
  if (!db) throw new Error("createArena: db required");
  if (!ownerUserId) return { ok: false, error: "owner_required" };

  const deduped = Array.isArray(forkObjectIds)
    ? [...new Set(forkObjectIds.map((x) => String(x)).filter(Boolean))]
    : [];
  if (deduped.length < 2) {
    return {
      ok: false,
      error: "insufficient_forks",
      reason: "at least 2 fork objects are required to run a bracket",
      count: deduped.length,
    };
  }
  if (deduped.length > MAX_ARENA_FORKS) {
    return { ok: false, error: "arena_bound_exceeded", maxArenaForks: MAX_ARENA_FORKS, count: deduped.length };
  }

  for (const fid of deduped) {
    const fork = loadForkObject(db, fid);
    if (!fork) return { ok: false, error: "fork_not_found", forkObjectId: fid };
    if (fork.ownerUserId !== ownerUserId) {
      return {
        ok: false,
        error: "forbidden",
        reason: "arena entrants must all be fork objects you own",
        forkObjectId: fid,
      };
    }
  }

  const seeded = seedEntrants(deduped);
  const round1 = genRound1Bracket(seeded);
  const id = `csa_${crypto.randomBytes(9).toString("hex")}`;
  const now = Math.floor(Date.now() / 1000);

  const arena = {
    id,
    ownerUserId,
    title: String(title || "Untitled Creation Singularity Arena").trim().slice(0, 160) || "Untitled Creation Singularity Arena",
    forkIds: deduped,
    bracket: [round1],
    status: "in_progress",
    championForkId: null,
    resultDtuId: null,
    log: [{ at: Date.now(), msg: `Arena seeded with ${deduped.length} fork(s)` }],
    createdAt: now,
    completedAt: null,
  };

  // A round-1 all-byes edge case (a single real entrant plus padding — can't
  // happen with a deduped >=2 count, but guard honestly rather than assume).
  const allByeOrDone = round1.every((m) => m.status === "bye") && round1.length === 1;
  if (allByeOrDone) {
    arena.status = "completed";
    arena.championForkId = round1[0].winnerId;
    arena.completedAt = now;
  }

  persistArena(db, arena);
  return { ok: true, arena };
}

/**
 * Resolve every PENDING match in the arena's CURRENT round via a real
 * confined head-to-head, then advance the bracket if the round is fully
 * resolved. Returns `{ ok:true, arena, finished }` or an honest failure.
 */
export function runArenaRound(db, arenaId) {
  const arena = loadArena(db, arenaId);
  if (!arena) return { ok: false, error: "arena_not_found" };
  if (arena.status === "completed") return { ok: false, error: "arena_already_completed", arena };
  if (arena.status === "cancelled") return { ok: false, error: "arena_cancelled", arena };
  if (!Array.isArray(arena.bracket) || arena.bracket.length === 0) {
    return { ok: false, error: "invalid_bracket" };
  }

  const current = arena.bracket[arena.bracket.length - 1];
  const pending = current.filter((m) => m.status === "pending");

  for (const m of pending) {
    const res = runHeadToHead(db, m.forkAId, m.forkBId);
    if (!res.ok) {
      return { ok: false, error: res.error || "head_to_head_failed", forkId: res.forkId, arena };
    }
    m.winnerId = res.winnerId;
    m.scoreA = res.scoreA;
    m.scoreB = res.scoreB;
    m.tiebreak = !!res.tiebreak;
    m.status = "complete";
    arena.log.push({
      at: Date.now(),
      msg: res.bye
        ? `Round ${m.round} slot ${m.slot}: bye → ${res.winnerId}`
        : `Round ${m.round} slot ${m.slot}: ${m.forkAId} (${res.scoreA}) vs ${m.forkBId} (${res.scoreB}) → winner ${res.winnerId}${res.tiebreak ? " (tiebreak)" : ""}`,
    });
  }

  let finished = false;
  const allDone = current.every((m) => m.winnerId);
  if (allDone) {
    const adv = advanceRound(current, current[0].round + 1);
    if (adv.done) {
      arena.status = "completed";
      arena.championForkId = adv.championId;
      arena.completedAt = Math.floor(Date.now() / 1000);
      arena.log.push({ at: Date.now(), msg: `Arena completed — champion ${adv.championId}` });
      finished = true;
    } else if (adv.matches) {
      arena.bracket.push(adv.matches);
      arena.log.push({ at: Date.now(), msg: `Round ${adv.matches[0].round} paired (${adv.matches.length} match(es))` });
    }
  }

  persistArena(db, arena);
  return { ok: true, arena, finished };
}

/**
 * Run every remaining round until the arena completes (or a round genuinely
 * cannot resolve, e.g. a fork was deleted mid-tournament). Bounded so a
 * logic bug can never spin — a real single-elim bracket over MAX_ARENA_FORKS
 * entrants needs at most ceil(log2(MAX_ARENA_FORKS)) rounds.
 */
export function runArenaToCompletion(db, arenaId, { maxIterations = 12 } = {}) {
  let last = { ok: true, arena: loadArena(db, arenaId), finished: false };
  for (let i = 0; i < maxIterations; i++) {
    if (!last.ok) return last;
    if (last.finished || last.arena?.status === "completed") return last;
    last = runArenaRound(db, arenaId);
  }
  if (!last.finished && last.arena?.status !== "completed") {
    return { ok: false, error: "max_iterations_exceeded", arena: last.arena };
  }
  return last;
}

/**
 * Final standings: champion first, then eliminated entrants ordered by how
 * deep they got (deeper round = better placement), lexical tiebreak.
 */
export function rankingFromBracket(arena) {
  const ranked = [];
  if (arena.championForkId) {
    ranked.push({ forkObjectId: arena.championForkId, finalRound: arena.bracket.length, eliminatedInRound: null });
  }
  const losses = [];
  for (const round of arena.bracket) {
    for (const m of round) {
      if (m.status !== "complete" || !m.winnerId) continue;
      const loserId = m.winnerId === m.forkAId ? m.forkBId : m.forkAId;
      if (loserId && loserId !== arena.championForkId) losses.push({ forkObjectId: loserId, round: m.round });
    }
  }
  losses.sort((a, b) => b.round - a.round || (a.forkObjectId < b.forkObjectId ? -1 : 1));
  for (const l of losses) {
    if (ranked.some((r) => r.forkObjectId === l.forkObjectId)) continue;
    ranked.push({ forkObjectId: l.forkObjectId, finalRound: l.round, eliminatedInRound: l.round });
  }
  return ranked;
}
