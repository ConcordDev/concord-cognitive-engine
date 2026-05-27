// Contract test for the minigame resolvers Phase II Wave 19.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFishing, resolvePhotograph, resolveKaraoke, resolveMahjongHand,
  MINIGAME_CONSTANTS,
} from "../lib/minigame-resolvers.js";
import registerMinigameMacros from "../domains/minigames.js";

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
