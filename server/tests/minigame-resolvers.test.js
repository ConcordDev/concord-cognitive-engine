// Contract test for the minigame resolvers Phase II Wave 19.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveFishing, resolvePhotograph, resolveKaraoke, resolveMahjongHand,
  parseSongKey, scalePitchClasses, hzToPitchClass, keyFitScore,
  MINIGAME_CONSTANTS,
} from "../lib/minigame-resolvers.js";
import registerMinigameMacros from "../domains/minigames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KARAOKE_SONGS = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "content", "karaoke-songs.json"), "utf8")
);

// Equal-tempered frequency for a MIDI note number (A4 = MIDI 69 = 440Hz).
function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerMinigameMacros(register); });

describe("resolveFishing", () => {
  it("low roll → caught + scores positive", () => {
    const r = resolveFishing({ castStrength: 0.8, lineTension: 0.5, fishingSkill: 50, rollOverride: 0.05 });
    assert.equal(r.ok, true);
    assert.equal(r.caught, true);
    assert.ok(r.score > 0);
    assert.ok(r.xpGained > 0);
    assert.ok(r.payload.fishId);
  });

  it("high roll + bad tension → got away", () => {
    const r = resolveFishing({ castStrength: 0.5, lineTension: 0.0, fishingSkill: 20, rollOverride: 0.95 });
    assert.equal(r.caught, false);
    assert.equal(r.score, 0);
  });

  it("rare fish requires lucky roll", () => {
    // High skill makes rare fish more likely, low roll picks the rarest entry weighted
    const r = resolveFishing({ castStrength: 0.9, lineTension: 0.5, fishingSkill: 95, rollOverride: 0.01 });
    assert.equal(r.caught, true);
    assert.ok(MINIGAME_CONSTANTS.FISH_CATALOG.some((f) => f.id === r.payload.fishId));
  });
});

describe("resolvePhotograph", () => {
  it("perfect composition + lighting + subject → gallery_quality", () => {
    const r = resolvePhotograph({ composition: 1, lighting: 1, subject: 1, photographySkill: 100 });
    assert.equal(r.payload.rating, "gallery_quality");
    assert.ok(r.score > 100);
  });

  it("low scores grade lower", () => {
    const r = resolvePhotograph({ composition: 0.1, lighting: 0.1, subject: 0.1, photographySkill: 10 });
    assert.ok(["blurry", "ok"].includes(r.payload.rating));
  });

  it("skill multiplier raises score for same shot inputs", () => {
    const low = resolvePhotograph({ composition: 0.5, lighting: 0.5, subject: 0.5, photographySkill: 10 });
    const high = resolvePhotograph({ composition: 0.5, lighting: 0.5, subject: 0.5, photographySkill: 90 });
    assert.ok(high.score > low.score);
  });
});

describe("resolveKaraoke", () => {
  it("near-perfect performance → S grade", () => {
    const r = resolveKaraoke({ pitchAccuracyHz: 1, rhythmTimingMs: 10, songDifficulty: 1, singingSkill: 100, durationSec: 180 });
    assert.equal(r.payload.grade, "S");
  });

  it("sloppy performance → D grade", () => {
    const r = resolveKaraoke({ pitchAccuracyHz: 45, rhythmTimingMs: 480, songDifficulty: 0.1, singingSkill: 5 });
    assert.equal(r.payload.grade, "D");
  });

  it("difficulty multiplier boosts score", () => {
    const easy = resolveKaraoke({ pitchAccuracyHz: 5, rhythmTimingMs: 30, songDifficulty: 0.2, singingSkill: 50 });
    const hard = resolveKaraoke({ pitchAccuracyHz: 5, rhythmTimingMs: 30, songDifficulty: 0.9, singingSkill: 50 });
    assert.ok(hard.score > easy.score);
  });

  it("without pitchSamplesHz/songKey it falls back to the legacy consistency method", () => {
    const r = resolveKaraoke({ pitchAccuracyHz: 5, rhythmTimingMs: 30, songDifficulty: 0.5, singingSkill: 40 });
    assert.equal(r.payload.pitchScoreMethod, "consistency");
  });
});

// Wave 4 gap-closure (minigames-capability-map.md item 2) — key-fit scoring
// against REAL content/karaoke-songs.json data, not fabricated inputs.
describe("parseSongKey — every real song key in content/karaoke-songs.json parses", () => {
  it("all 25 authored songs produce a valid tonic + mode", () => {
    assert.equal(KARAOKE_SONGS.length, 25);
    for (const s of KARAOKE_SONGS) {
      const k = parseSongKey(s.key);
      assert.ok(k, `${s.id} ("${s.key}") failed to parse`);
      assert.ok(k.tonic >= 0 && k.tonic <= 11);
      assert.ok(k.mode === "major" || k.mode === "minor");
    }
  });

  it("handles the spelled-out-accidental song ('B flat minor')", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "iron-witness");
    assert.equal(song.key, "B flat minor");
    const k = parseSongKey(song.key);
    assert.equal(k.tonic, 10); // Bb = 10
    assert.equal(k.mode, "minor");
  });

  it("C minor (lattice-lullaby) yields the correct 7-note natural minor scale", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby");
    const k = parseSongKey(song.key);
    const scale = new Set(scalePitchClasses(k));
    // C natural minor: C D Eb F G Ab Bb -> pitch classes 0,2,3,5,7,8,10
    assert.deepEqual([...scale].sort((a, b) => a - b), [0, 2, 3, 5, 7, 8, 10]);
  });

  it("G major (warm-tide) yields the correct 7-note major scale", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "warm-tide");
    const k = parseSongKey(song.key);
    const scale = new Set(scalePitchClasses(k));
    // G major: G A B C D E F# -> pitch classes 7,9,11,0,2,4,6
    assert.deepEqual([...scale].sort((a, b) => a - b), [0, 2, 4, 6, 7, 9, 11]);
  });
});

describe("keyFitScore — scores real melody-appropriateness against actual song keys", () => {
  it("singing exact in-scale notes for C minor (lattice-lullaby) scores ~100", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby");
    // C4, Eb4, G4, Bb4 are all members of C natural minor, sung dead-on-pitch.
    const inScaleHz = [midiToHz(60), midiToHz(63), midiToHz(67), midiToHz(70)];
    const score = keyFitScore(inScaleHz, song.key);
    assert.ok(score > 95, `expected near-100, got ${score}`);
  });

  it("singing exact out-of-scale notes for C minor scores 0", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby");
    // C#4, E4, F#4 are all OUTSIDE C natural minor (0,2,3,5,7,8,10).
    const outOfScaleHz = [midiToHz(61), midiToHz(64), midiToHz(66)];
    const score = keyFitScore(outOfScaleHz, song.key);
    assert.equal(score, 0);
  });

  it("a 50/50 mix of in-scale and out-of-scale notes scores in between", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby");
    const mixHz = [midiToHz(60), midiToHz(61)]; // C4 (in) + C#4 (out)
    const score = keyFitScore(mixHz, song.key);
    assert.ok(score > 30 && score < 70, `expected a mid-range score, got ${score}`);
  });

  it("this is a real fix, not just relabeling: a wrong-but-steady note now scores LOW, not high", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "warm-tide"); // G major = {0,2,4,6,7,9,11}
    // C#4 (pitch class 1) held perfectly steady would score "accurate" (100)
    // under the old std-dev metric, since it never wavers. It's not in
    // G major's scale, so key-fit scoring must grade it 0.
    const steadyWrongNote = new Array(20).fill(midiToHz(61)); // C#4, dead steady
    const score = keyFitScore(steadyWrongNote, song.key);
    assert.equal(score, 0, "a steady but out-of-key note must score 0, not 100");
  });

  it("natural vibrato around a correct scale tone still scores well", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby"); // C minor
    // Vibrato: G4 wobbling +/- ~15 cents around dead-on pitch.
    const g4 = midiToHz(67);
    const vibrato = [-15, -8, 0, 8, 15, 8, 0, -8].map((cents) => g4 * Math.pow(2, cents / 1200));
    const score = keyFitScore(vibrato, song.key);
    assert.ok(score > 70, `natural vibrato on a correct note should still score well, got ${score}`);
  });

  it("returns null (triggers fallback) for an unparseable/missing key", () => {
    assert.equal(keyFitScore([midiToHz(60)], "not a real key"), null);
    assert.equal(keyFitScore([midiToHz(60)], undefined), null);
    assert.equal(keyFitScore([], "C minor"), null);
  });

  it("resolveKaraoke prefers key-fit scoring when pitchSamplesHz + songKey are supplied", () => {
    const song = KARAOKE_SONGS.find((s) => s.id === "lattice-lullaby");
    const inScaleHz = [midiToHz(60), midiToHz(63), midiToHz(67)];
    const r = resolveKaraoke({
      pitchSamplesHz: inScaleHz, songKey: song.key,
      pitchAccuracyHz: 0, // legacy field present too — must be ignored when key-fit succeeds
      rhythmTimingMs: 20, songDifficulty: song.difficulty, singingSkill: 40,
    });
    assert.equal(r.payload.pitchScoreMethod, "key_fit");
    assert.ok(r.payload.pitchScore > 90);
  });

  it("hzToPitchClass identifies exact equal-tempered pitch classes with ~0 cents error", () => {
    const p = hzToPitchClass(midiToHz(60)); // C4
    assert.equal(p.pitchClass, 0);
    assert.ok(Math.abs(p.centsOff) < 0.01);
  });
});

describe("resolveMahjongHand", () => {
  it("scores recognised yaku from MAHJONG_HAND_VALUES", () => {
    const r = resolveMahjongHand({ winningHand: ["pinfu", "tanyao"], opponents: 3, wind: "south", mahjongSkill: 50 });
    assert.ok(r.score >= 200);
    assert.equal(r.payload.recognised, 2);
  });

  it("east-wind dealer bonus 1.5x", () => {
    const east = resolveMahjongHand({ winningHand: ["pinfu"], wind: "east", mahjongSkill: 0 });
    const south = resolveMahjongHand({ winningHand: ["pinfu"], wind: "south", mahjongSkill: 0 });
    assert.equal(east.payload.dealerMult, 1.5);
    assert.ok(east.score > south.score);
  });

  it("riichi + tsumo flags add bonus value", () => {
    const plain = resolveMahjongHand({ winningHand: ["pinfu"], wind: "south", mahjongSkill: 50 });
    const decked = resolveMahjongHand({ winningHand: ["pinfu"], wind: "south", mahjongSkill: 50, riichi: true, tsumo: true });
    assert.ok(decked.score > plain.score);
  });

  it("unknown yaku is silently ignored", () => {
    const r = resolveMahjongHand({ winningHand: ["pinfu", "fictional_yaku"], wind: "south", mahjongSkill: 0 });
    assert.equal(r.payload.recognised, 1);
  });
});

describe("minigame domain macros", () => {
  it("fishing.resolve_cast routes through the resolver", async () => {
    const r = await call("fishing", "resolve_cast", {}, { castStrength: 0.6, lineTension: 0.5, fishingSkill: 40, rollOverride: 0.1 });
    assert.equal(r.ok, true);
  });

  it("photography / karaoke / mahjong macros all wired", async () => {
    const photo = await call("photography", "resolve_shot", {}, { composition: 0.8, lighting: 0.8, subject: 0.8, photographySkill: 60 });
    const kara  = await call("karaoke", "resolve_performance", {}, { pitchAccuracyHz: 10, rhythmTimingMs: 40, songDifficulty: 0.5, singingSkill: 40 });
    const mahj  = await call("mahjong", "resolve_hand", {}, { winningHand: ["pinfu"], wind: "east", mahjongSkill: 30 });
    assert.equal(photo.ok, true);
    assert.equal(kara.ok, true);
    assert.equal(mahj.ok, true);
  });

  it("constants macro returns the catalogs", async () => {
    const r = await call("minigames", "constants", {});
    assert.equal(r.ok, true);
    assert.ok(r.constants.FISH_CATALOG.length > 0);
    assert.ok(r.constants.MAHJONG_HAND_VALUES.pinfu);
  });
});
