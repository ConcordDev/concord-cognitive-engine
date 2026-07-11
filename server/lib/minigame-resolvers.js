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

// Wave 4 gap-closure (minigames-capability-map.md item 2) — `pitchAccuracyHz`
// alone scores the STD-DEV of the singer's own pitch samples: a consistency/
// flatness measure, not a distance-from-melody measure. A singer who holds a
// single wrong note perfectly steady scored "accurate"; a singer nailing the
// real melody with natural vibrato scored worse. None of the 25 songs in
// content/karaoke-songs.json carry an authored per-note melody contour (that
// would be a CURATION-class follow-up — see the capability-map doc), but
// every song already carries an unused `key` field (e.g. "C minor"). Scoring
// how well the sung notes fit the song's declared diatonic scale is a real,
// much better proxy for melody accuracy than pure self-consistency, and it's
// derived entirely from data that already exists — no new content authoring.
const PITCH_CLASS_BY_LETTER = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const MAJOR_SCALE_STEPS = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
const MINOR_SCALE_STEPS = Object.freeze([0, 2, 3, 5, 7, 8, 10]); // natural minor

/**
 * Parse a song's declared key into { tonic (0-11 pitch class), mode }.
 * Accepts both symbolic ("F# minor", "Bb minor") and spelled-out
 * ("B flat minor") accidentals — content/karaoke-songs.json uses both
 * across its 25 songs (verified: "iron-witness" is authored as
 * "B flat minor").
 */
export function parseSongKey(keyStr) {
  if (!keyStr || typeof keyStr !== "string") return null;
  const m = keyStr.trim().match(/^([A-Ga-g])\s*(#|b|sharp|flat)?\s*(major|minor)?$/i);
  if (!m) return null;
  const base = PITCH_CLASS_BY_LETTER[m[1].toUpperCase()];
  if (base === undefined) return null;
  const acc = (m[2] || "").toLowerCase();
  let semitone = base;
  if (acc === "#" || acc === "sharp") semitone += 1;
  else if (acc === "b" || acc === "flat") semitone -= 1;
  const tonic = ((semitone % 12) + 12) % 12;
  const mode = (m[3] || "major").toLowerCase();
  return { tonic, mode };
}

/** The 7 diatonic pitch classes (0-11) for a parsed key. */
export function scalePitchClasses(key) {
  const steps = key?.mode === "minor" ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;
  return steps.map((s) => (key.tonic + s) % 12);
}

/** Nearest equal-tempered pitch class (0-11, A4=440Hz reference) + cents deviation from it. */
export function hzToPitchClass(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const centsOff = (midi - nearest) * 100;
  const pitchClass = ((nearest % 12) + 12) % 12;
  return { pitchClass, centsOff };
}

/**
 * Score (0-100) of how well a series of sampled pitches (Hz) fits a song's
 * declared musical key. In-scale notes score by closeness to the exact
 * scale tone (tight intonation beats a barely-in-tune note); out-of-scale
 * notes score 0. Returns null when there isn't enough data to score
 * (unknown/unparseable key, or no usable pitch samples) so the caller can
 * fall back to the legacy consistency measure.
 */
export function keyFitScore(pitchesHz, songKey) {
  const key = parseSongKey(songKey);
  if (!key || !Array.isArray(pitchesHz) || pitchesHz.length === 0) return null;
  const scale = new Set(scalePitchClasses(key));
  let counted = 0;
  let fitSum = 0;
  for (const raw of pitchesHz) {
    const hz = Number(raw);
    const p = hzToPitchClass(hz);
    if (!p) continue;
    counted += 1;
    if (scale.has(p.pitchClass)) fitSum += Math.max(0, 1 - Math.abs(p.centsOff) / 50);
  }
  if (counted === 0) return null;
  return Math.max(0, Math.min(100, (fitSum / counted) * 100));
}

export function resolveKaraoke(input = {}) {
  // input: { pitchAccuracyHz, pitchSamplesHz?, songKey?, rhythmTimingMs,
  //          durationSec, songDifficulty 0..1, singingSkill 0..100 }
  const rhythmMs = Math.max(0, Math.min(500, Number(input.rhythmTimingMs ?? 60))); // lower is better
  const duration = Math.max(1, Math.min(600, Number(input.durationSec) || 60));
  const difficulty = Math.max(0, Math.min(1, Number(input.songDifficulty) || 0.5));
  const skill = Math.max(0, Math.min(100, Number(input.singingSkill) || 30));

  // Prefer key-fit scoring (a real proxy for melody accuracy) whenever the
  // caller supplies raw pitch samples + the song's declared key. Fall back
  // to the legacy self-consistency measure (still honest, just weaker)
  // when either is missing — e.g. older clients or a song with no `key`.
  const keyFit = keyFitScore(input.pitchSamplesHz, input.songKey);
  const usedKeyFit = keyFit !== null;
  let pitchScore;
  if (usedKeyFit) {
    pitchScore = keyFit;
  } else {
    const pitchHz = Math.max(0, Math.min(50, Number(input.pitchAccuracyHz ?? 12))); // lower is better
    pitchScore = (1 - pitchHz / 50) * 100;
  }

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
    payload: {
      pitchScore, rhythmScore, durationSec: duration, songDifficulty: difficulty, grade,
      pitchScoreMethod: usedKeyFit ? "key_fit" : "consistency",
    },
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
