// server/domains/careers.js
//
// WAVE JOBS — the careers macro surface (the client's door into the living-career
// system). Composes the shipped server cores (professions / career-engine /
// career-fidelity / sport-minigames / career-contracts). Gated
// CONCORD_LIVING_CAREER. Sparks economy. Via POST /api/lens/run.
//
//   careers.tracks   — the profession taxonomy (categories → tracks → activity)
//   careers.ladder   — a track's 10-tier ladder
//   careers.work     — PLAY a shift (skill-input → performance → sparks + XP)
//   careers.contracts— my contracts
//   careers.offer / accept / counter / reject — negotiation
//   careers.employers   — NPC employer directory (which NPCs hire, at what
//                          track/tier), read-only against world_npcs
//   careers.myReputation — my reputation + which tiers it gates me out of

import { CATEGORIES, TRACKS, ladderFor, activityFor, isTrack, tierInfo } from "../lib/professions.js";
import { resolveSession, fidelityPayMultiplier, fidelityXpMultiplier } from "../lib/career-fidelity.js";
import { shiftPay, promotionXp, promotionReady, promotionReward } from "../lib/career-engine.js";
import { resolveMinigame, isMinigame } from "../lib/sport-minigames.js";
import { creditSparks } from "../lib/sparks-service.js";
import {
  offerContract, counterContract, acceptContract, rejectContract, listContractsFor,
  reputationGateTier, reputationWageMultiplier, deriveWorkerReputation,
} from "../lib/career-contracts.js";
import { findEmployers } from "../lib/career-employers.js";

function enabled() { return process.env.CONCORD_LIVING_CAREER !== "0"; }
function gate(ctx) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!ctx?.db) return { ok: false, reason: "no_db" };
  return null;
}
function authed(ctx) { const u = ctx?.actor?.userId; return u ? String(u) : null; }
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// Fail-CLOSED numeric guard: any present numeric field must be finite + in a
// sane range. An absent field is fine (the macro uses its default). Poisoned
// values (NaN/Infinity/1e308/negative) are rejected up-front so they can never
// reach the clamp helpers or the DB layer. Returns the offending key, or null.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// Per-track progression. The tier a shift pays at is read from here, never
// taken from the client. skillLevel = cumulative promotion XP / 10, so the
// engine's skill gate (tier × 10) means tier × 100 XP.
const BASE_ATTRIBUTE = 0.5;

function readProgress(db, uid, trackId) {
  try {
    const row = db.prepare(`SELECT tier, xp, highest_tier, shifts, last_shift_day FROM player_career_progress WHERE user_id = ? AND track_id = ?`).get(uid, trackId);
    if (row) return { tier: row.tier, xp: row.xp, highestTier: row.highest_tier, shifts: row.shifts, lastShiftDay: row.last_shift_day, persisted: true };
  } catch { /* table absent → fresh progress, not persisted */ }
  return { tier: 1, xp: 0, highestTier: 1, shifts: 0, lastShiftDay: null, persisted: false };
}

function writeProgress(db, uid, trackId, p) {
  try {
    db.prepare(`
      INSERT INTO player_career_progress (user_id, track_id, tier, xp, highest_tier, shifts, last_shift_day, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, track_id) DO UPDATE SET
        tier = excluded.tier, xp = excluded.xp, highest_tier = excluded.highest_tier,
        shifts = excluded.shifts, last_shift_day = excluded.last_shift_day, updated_at = unixepoch()
    `).run(uid, trackId, p.tier, p.xp, p.highestTier, p.shifts, p.lastShiftDay);
    return true;
  } catch { return false; }
}

export default function registerCareerMacros(register) {
  register("careers", "tracks", async (ctx) => {
    const g = gate(ctx); if (g) return g;
    const tracks = Object.keys(TRACKS).map((id) => ({ id, category: TRACKS[id].category, activity: activityFor(id), branch: TRACKS[id].branchAt5 }));
    return { ok: true, categories: CATEGORIES, tracks };
  }, { note: "careers: profession taxonomy" });

  register("careers", "ladder", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    if (!isTrack(input.trackId)) return { ok: false, reason: "unknown_track" };
    return { ok: true, trackId: input.trackId, ladder: ladderFor(input.trackId) };
  }, { note: "careers: a track's tier ladder" });

  // PLAY a shift: skill-input drives the floor-gated resolver → performance →
  // sparks (credited now) + promotion XP. tier-scaled wage; play fidelity.
  register("careers", "work", async (ctx, input = {}) => {
  try {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const b = badNumericField(input, ["tier", "attribute", "skillInput"]);
    if (b) return { ok: false, reason: `invalid_${b}` };
    const trackId = input.trackId;
    if (!isTrack(trackId)) return { ok: false, reason: "unknown_track" };
    // Tier, mastery and attribute are server-owned; a client-sent tier or
    // attribute is ignored so a request can't claim a higher wage.
    const progress = readProgress(ctx.db, uid, trackId);
    const tier = progress.tier;
    const attribute = BASE_ATTRIBUTE;

    // performance: a sport-minigame attempt if one is named, else a play session.
    let performanceScore;
    if (input.minigame && isMinigame(input.minigame)) {
      performanceScore = resolveMinigame(input.minigame, { attribute, raw: input.raw || {} }).performanceScore;
    } else {
      performanceScore = resolveSession("play", { attribute, skillInput: clamp01(input.skillInput ?? 0.5) }).performanceScore;
    }
    const wage = Math.round(shiftPay(performanceScore, trackId, tier, { masteryTierReached: progress.highestTier }) * fidelityPayMultiplier("play"));
    const xp = Math.round(promotionXp(performanceScore) * fidelityXpMultiplier("play"));
    const today = new Date().toISOString().slice(0, 10);
    const next = { ...progress, xp: progress.xp + xp, shifts: progress.shifts + 1, lastShiftDay: today };
    const promo = promotionReady({
      skillLevel: Math.floor(next.xp / 10),
      dailyTaskDone: true,
      performanceScore,
      reputation: 0,
    }, trackId, tier);
    let promotion = null;
    if (promo.ready) {
      next.tier = promo.nextTier;
      next.highestTier = Math.max(next.highestTier, next.tier);
      promotion = promotionReward(trackId, next.tier);
    }
    const saved = writeProgress(ctx.db, uid, trackId, next);
    let paid = false;
    if (wage > 0) {
      const refId = `career:${uid}:${trackId}:${Date.now()}`;
      const c = creditSparks(ctx.db, { holderKind: "player", holderId: uid, amount: wage, refId, reason: "career_play_shift", worldId: input.worldId || "concordia-hub" });
      paid = !!c?.ok;
    }
    return {
      ok: true, trackId, tier, performanceScore, wage, xp, paid, fidelity: "play",
      progress: { tier: next.tier, xp: next.xp, highestTier: next.highestTier, shifts: next.shifts, saved },
      promotion, gates: promo.gates,
      nextTierXp: next.tier < 10 ? next.tier * 100 : null,
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "careers: play a shift (skill-input → sparks + XP)" });

  register("careers", "progress", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    if (input.trackId !== undefined) {
      if (!isTrack(input.trackId)) return { ok: false, reason: "unknown_track" };
      const p = readProgress(ctx.db, uid, input.trackId);
      return { ok: true, trackId: input.trackId, progress: p, nextTierXp: p.tier < 10 ? p.tier * 100 : null };
    }
    let rows = [];
    try {
      rows = ctx.db.prepare(`SELECT track_id, tier, xp, highest_tier, shifts, last_shift_day FROM player_career_progress WHERE user_id = ? ORDER BY updated_at DESC`).all(uid);
    } catch { rows = []; }
    return { ok: true, tracks: rows.map((r) => ({ trackId: r.track_id, tier: r.tier, xp: r.xp, highestTier: r.highest_tier, shifts: r.shifts, lastShiftDay: r.last_shift_day })) };
  }, { note: "careers: my per-track tier, XP and mastery" });

  register("careers", "contracts", async (ctx) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return { ok: true, contracts: listContractsFor(ctx.db, "player", uid) };
  }, { note: "careers: my contracts" });

  register("careers", "offer", async (ctx, input = {}) => {
  try {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const b = badNumericField(input, ["tier", "baseWage", "durationDays", "signingBonus", "workerReputation"]);
    if (b) return { ok: false, reason: `invalid_${b}` };
    // the player is one party; the other is supplied. offeredBy = the player.
    const workerKind = input.workerKind || "npc";
    const workerId = input.workerId;
    // When the player IS the worker — the flow this lens drives: browse
    // careers.employers, then offer YOURSELF to a discovered NPC employer —
    // the reputation gate MUST be computed server-side from real history via
    // the same deriveWorkerReputation/reputationGateTier offerContract uses
    // internally. Trusting a client-supplied workerReputation here would let
    // any client pass 100 and bypass the gate entirely. Any other worker (an
    // NPC being hired, or a different player) has no equivalent
    // server-computed source yet, so a caller-supplied workerReputation is
    // still honored there (unchanged pre-existing behavior).
    const workerReputation = (workerKind === "player" && workerId === uid)
      ? deriveWorkerReputation(ctx.db, "player", uid, input.trackId)
      : input.workerReputation;
    return offerContract(ctx.db, {
      worldId: input.worldId || "concordia-hub",
      employerKind: input.employerKind || "player", employerId: input.employerId || uid,
      workerKind, workerId,
      trackId: input.trackId, tier: input.tier || 1, role: input.role,
      baseWage: input.baseWage || 0, payModel: input.payModel, durationDays: input.durationDays,
      signingBonus: input.signingBonus || 0, bonuses: input.bonuses, clauses: input.clauses,
      offeredByKind: "player", offeredById: uid, workerReputation,
    });
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "careers: offer a contract" });

  // Employer discovery — which NPCs are hiring, at what track/tier, right
  // now. Read-only against world_npcs; see lib/career-employers.js for the
  // archetype → track derivation and why an unmapped archetype is honestly
  // excluded rather than guessed.
  register("careers", "employers", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    if (input.trackId != null && !isTrack(input.trackId)) return { ok: false, reason: "unknown_track" };
    const worldId = input.worldId || "concordia-hub";
    const employers = findEmployers(ctx.db, { worldId, trackId: input.trackId || null, limit: input.limit });
    return { ok: true, worldId, trackId: input.trackId || null, employers };
  }, { note: "careers: NPC employer directory (which NPCs hire for which track/tier)" });

  // My reputation — the same reputationGateTier/reputationWageMultiplier the
  // server enforces during offerContract, surfaced so a player can SEE the
  // number and its tier-gate consequence before offering, instead of only
  // discovering it after a rejected 'reputation_too_low' offer.
  register("careers", "myReputation", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    if (input.trackId != null && !isTrack(input.trackId)) return { ok: false, reason: "unknown_track" };
    const trackId = input.trackId || null;
    const reputation = deriveWorkerReputation(ctx.db, "player", uid, trackId);
    const gateTier = reputationGateTier(reputation);
    const wageMultiplier = reputationWageMultiplier(reputation);
    const gatedTiers = [];
    for (let t = gateTier + 1; t <= 10; t++) gatedTiers.push(t);
    return { ok: true, trackId, reputation, gateTier, wageMultiplier, gatedTiers };
  }, { note: "careers: my reputation + which tiers it gates me out of" });

  register("careers", "accept", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return acceptContract(ctx.db, input.contractId, "player", uid);
  }, { note: "careers: accept a contract" });

  register("careers", "counter", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return counterContract(ctx.db, input.contractId, "player", uid, input.terms || {});
  }, { note: "careers: counter a contract" });

  register("careers", "reject", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return rejectContract(ctx.db, input.contractId, "player", uid);
  }, { note: "careers: reject a contract" });
}
