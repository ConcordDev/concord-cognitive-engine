// server/lib/minigame-resolvers.js
//
// Phase II Wave 19 — life-sim side activities.
//
// Each minigame is a pure-compute outcome resolver: frontend drives
// the UI (rod-cast physics, photo composition camera, karaoke pitch
// detection, mahjong tile clicks), client posts the outcome inputs,
// server scores the result + awards XP into the existing skill substrate.
//
// All four minigames share the same shape:
//   resolveX(input) → { ok, score, xpGained, payload }
//
// Skill XP is recorded into pain_signals-like ledger (a generic
// 'skill_award' event row) when wired; v1 returns the xpGained
// number so the caller can drop it into whichever skill ledger the
// world uses (skill-evolution.js or starter-content.js).

/* ───────── Fishing ─────────────────────────────────────────────────── */

const FISH_CATALOG = Object.freeze([
  { id: "minnow",      rarity: 0.45, value: 8,   xp: 4 },
  { id: "trout",       rarity: 0.25, value: 24,  xp: 10 },
  { id: "carp",        rarity: 0.15, value: 40,  xp: 18 },
  { id: "salmon",      rarity: 0.10, value: 75,  xp: 32 },
  { id: "marlin",      rarity: 0.04, value: 240, xp: 88 },
  { id: "leviathan",   rarity: 0.01, value: 900, xp: 220 },
]);

export function resolveFishing(input = {}) {
  // input: { castStrength 0..1, lineTension 0..1, biome ('lake'|'river'|'sea'),
  //          fishingSkill 0..100, rollOverride? }
  const cast = Math.max(0, Math.min(1, Number(input.castStrength) || 0.5));
  const tension = Math.max(0, Math.min(1, Number(input.lineTension) || 0.5));
  const skill = Math.max(0, Math.min(100, Number(input.fishingSkill) || 30));
  const roll = Number.isFinite(input.rollOverride) ? Number(input.rollOverride) : Math.random();
  // Catch chance: 0.4 base + skill/200 + cast×0.15 - tension distance from 0.5
  const tensionPenalty = Math.abs(tension - 0.5) * 0.4;
  const catchChance = Math.max(0.05, Math.min(0.95, 0.4 + skill / 200 + cast * 0.15 - tensionPenalty));
  if (roll > catchChance) {
    return { ok: true, caught: false, score: 0, xpGained: 1, payload: { reason: "got_away" } };
  }
  // Pick fish by rarity weighted to the player's skill
  const cumulative = [];
  let acc = 0;
  for (const f of FISH_CATALOG) {
    acc += f.rarity + (skill / 200) * (1 - f.rarity);
    cumulative.push({ ...f, cum: acc });
  }
  const max = cumulative[cumulative.length - 1].cum;
  const pick = roll * max;
  const fish = cumulative.find((f) => pick < f.cum) || cumulative[0];
  const score = fish.value + Math.floor(skill / 5);
  return {
    ok: true,
    caught: true,
    score,
    xpGained: fish.xp,
    payload: { fishId: fish.id, valueCents: fish.value, rarity: fish.rarity, biome: input.biome ?? "lake" },
  };
}

/* ───────── Photography ─────────────────────────────────────────────── */

export function resolvePhotograph(input = {}) {
  // input: { composition 0..1, lighting 0..1, subject 0..1,
  //          photographySkill 0..100 }
  const composition = Math.max(0, Math.min(1, Number(input.composition) || 0.5));
  const lighting    = Math.max(0, Math.min(1, Number(input.lighting)    || 0.5));
  const subject     = Math.max(0, Math.min(1, Number(input.subject)     || 0.5));
  const skill = Math.max(0, Math.min(100, Number(input.photographySkill) || 30));
  // Composite score: weighted mean of inputs scaled by skill multiplier
  const skillMult = 1 + skill / 200;
  const composite = (composition * 0.4 + lighting * 0.3 + subject * 0.3) * skillMult * 100;
  const score = Math.max(0, Math.round(composite));
  const xpGained = Math.max(2, Math.round(composite / 10));
  const rating = score >= 110 ? "gallery_quality" :
                 score >= 85  ? "publishable" :
                 score >= 60  ? "decent" :
                 score >= 30  ? "ok" : "blurry";
  return {
    ok: true,
    score, xpGained,
    payload: { composition, lighting, subject, rating, skillMult },
  };
}

/* ───────── Karaoke ─────────────────────────────────────────────────── */

export function resolveKaraoke(input = {}) {
  // input: { pitchAccuracyHz, rhythmTimingMs, durationSec, songDifficulty 0..1,
  //          singingSkill 0..100 }
  const pitchHz = Math.max(0, Math.min(50, Number(input.pitchAccuracyHz) ?? 12)); // lower is better
  const rhythmMs = Math.max(0, Math.min(500, Number(input.rhythmTimingMs) ?? 60)); // lower is better
  const duration = Math.max(1, Math.min(600, Number(input.durationSec) || 60));
  const difficulty = Math.max(0, Math.min(1, Number(input.songDifficulty) || 0.5));
  const skill = Math.max(0, Math.min(100, Number(input.singingSkill) || 30));
  // Score: invert pitch + rhythm errors, weight by skill, scale by difficulty
  const pitchScore  = (1 - pitchHz / 50)  * 100;
  const rhythmScore = (1 - rhythmMs / 500) * 100;
  const composite = (pitchScore * 0.6 + rhythmScore * 0.4) * (1 + difficulty * 0.5) * (1 + skill / 200);
  const score = Math.round(Math.max(0, Math.min(200, composite)));
  const xpGained = Math.max(2, Math.round((score / 5) * (1 + difficulty)));
  const grade = score >= 160 ? "S" :
                score >= 130 ? "A" :
                score >= 100 ? "B" :
                score >= 70  ? "C" : "D";
  return {
    ok: true,
    score, xpGained,
    payload: { pitchScore, rhythmScore, durationSec: duration, songDifficulty: difficulty, grade },
  };
}

/* ───────── Mahjong ─────────────────────────────────────────────────── */

// Score per hand kind (Riichi-style simplified).
// T3.4 — re-weighted so reward tracks rarity. The G3.3 frequency sim
// (audit/balance/mahjong-yaku.json) is pure tile-combinatorics — the
// distribution can't be moved by scoring — so the balance lever is to pay the
// over-common yaku less and the rare ones more. Outliers addressed:
//   iipeiko (0.337, 2.06× mean — most common) 200 → 100
//   pinfu   (0.046, 0.28× mean — rare)        100 → 250
//   ittsuu  (0.006, 0.04× mean — rarest)      500 → 700
const MAHJONG_HAND_VALUES = Object.freeze({
  pinfu:        250,
  tanyao:       100,
  yakuhai:      200,
  iipeiko:      100,
  riichi:       300,
  tsumo:        300,
  sanshoku:     500,
  ittsuu:       700,
  toitoi:       600,
  honitsu:      800,
  chinitsu:    1200,
  kokushi:     3000,
  suuankou:    4000,
});

export function resolveMahjongHand(input = {}) {
  // input: { winningHand: [strings], opponents: number, wind: 'east'|'south'|...,
  //          mahjongSkill 0..100, tsumo: bool, riichi: bool }
  const hand = Array.isArray(input.winningHand) ? input.winningHand : [];
  const opponents = Math.max(1, Math.min(3, Number(input.opponents) || 3));
  const skill = Math.max(0, Math.min(100, Number(input.mahjongSkill) || 30));
  let score = 0;
  for (const yaku of hand) {
    if (MAHJONG_HAND_VALUES[yaku]) score += MAHJONG_HAND_VALUES[yaku];
  }
  if (input.tsumo)  score += MAHJONG_HAND_VALUES.tsumo;
  if (input.riichi) score += MAHJONG_HAND_VALUES.riichi;
  // Dealer bonus: east wind gets 1.5x
  const dealerMult = String(input.wind || "south").toLowerCase() === "east" ? 1.5 : 1.0;
  score = Math.round(score * dealerMult * (1 + skill / 300));
  const xpGained = Math.max(4, Math.round(score / 20));
  return {
    ok: true,
    score, xpGained,
    payload: { yakuList: hand, opponents, dealerMult, recognised: hand.filter((y) => MAHJONG_HAND_VALUES[y]).length },
  };
}

export const MINIGAME_CONSTANTS = Object.freeze({
  FISH_CATALOG,
  MAHJONG_HAND_VALUES,
});
