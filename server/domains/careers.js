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

import { CATEGORIES, TRACKS, ladderFor, activityFor, isTrack, tierInfo } from "../lib/professions.js";
import { resolveSession, fidelityPayMultiplier, fidelityXpMultiplier } from "../lib/career-fidelity.js";
import { shiftPay, promotionXp } from "../lib/career-engine.js";
import { resolveMinigame, isMinigame } from "../lib/sport-minigames.js";
import { creditSparks } from "../lib/sparks-service.js";
import { offerContract, counterContract, acceptContract, rejectContract, listContractsFor } from "../lib/career-contracts.js";

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
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const b = badNumericField(input, ["tier", "attribute", "skillInput"]);
    if (b) return { ok: false, reason: `invalid_${b}` };
    const trackId = input.trackId;
    if (!isTrack(trackId)) return { ok: false, reason: "unknown_track" };
    const tier = Math.max(1, Math.min(10, Number(input.tier) || 1));
    const attribute = clamp01(input.attribute ?? 0.5);

    // performance: a sport-minigame attempt if one is named, else a play session.
    let performanceScore;
    if (input.minigame && isMinigame(input.minigame)) {
      performanceScore = resolveMinigame(input.minigame, { attribute, raw: input.raw || {} }).performanceScore;
    } else {
      performanceScore = resolveSession("play", { attribute, skillInput: clamp01(input.skillInput ?? 0.5) }).performanceScore;
    }
    const wage = Math.round(shiftPay(performanceScore, trackId, tier) * fidelityPayMultiplier("play"));
    const xp = Math.round(promotionXp(performanceScore) * fidelityXpMultiplier("play"));
    let paid = false;
    if (wage > 0) {
      const refId = `career:${uid}:${trackId}:${Date.now()}`;
      const c = creditSparks(ctx.db, { holderKind: "player", holderId: uid, amount: wage, refId, reason: "career_play_shift", worldId: input.worldId || "concordia-hub" });
      paid = !!c?.ok;
    }
    return { ok: true, trackId, tier, performanceScore, wage, xp, paid, fidelity: "play" };
  }, { note: "careers: play a shift (skill-input → sparks + XP)" });

  register("careers", "contracts", async (ctx) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return { ok: true, contracts: listContractsFor(ctx.db, "player", uid) };
  }, { note: "careers: my contracts" });

  register("careers", "offer", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const b = badNumericField(input, ["tier", "baseWage", "durationDays", "signingBonus", "workerReputation"]);
    if (b) return { ok: false, reason: `invalid_${b}` };
    // the player is one party; the other is supplied. offeredBy = the player.
    return offerContract(ctx.db, {
      worldId: input.worldId || "concordia-hub",
      employerKind: input.employerKind || "player", employerId: input.employerId || uid,
      workerKind: input.workerKind || "npc", workerId: input.workerId,
      trackId: input.trackId, tier: input.tier || 1, role: input.role,
      baseWage: input.baseWage || 0, payModel: input.payModel, durationDays: input.durationDays,
      signingBonus: input.signingBonus || 0, bonuses: input.bonuses, clauses: input.clauses,
      offeredByKind: "player", offeredById: uid, workerReputation: input.workerReputation,
    });
  }, { note: "careers: offer a contract" });

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
