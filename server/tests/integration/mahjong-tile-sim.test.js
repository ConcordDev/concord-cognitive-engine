// Phase E4 — mahjong tile sim integration test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMahjong } from "../../migrations/260_mahjong_sessions.js";
import { buildFreshDeck, ALL_DISTINCT_TILES, COPIES_PER_TILE } from "../../lib/mahjong/tiles.js";
import { newWall, dealInitialHands, SEAT_COUNT } from "../../lib/mahjong/wall.js";
import { isWinningHand, isStandardWinningHand, isKokushiHand } from "../../lib/mahjong/hand.js";
import { detectYaku } from "../../lib/mahjong/yaku-detect.js";
import { discardByStyle } from "../../lib/mahjong/npc-discard.js";
import { startSession, discardTile, getState } from "../../lib/mahjong/session.js";

function bootDb() {
  const db = new Database(":memory:");
  upMahjong(db);
  return db;
}

describe("Phase E4 — mahjong tile sim", () => {
  describe("tiles", () => {
    it("fresh deck has 136 tiles (34 distinct × 4 copies)", () => {
      const deck = buildFreshDeck();
      assert.equal(deck.length, 136);
      assert.equal(ALL_DISTINCT_TILES.length, 34);
      assert.equal(COPIES_PER_TILE, 4);
      // Each distinct tile appears exactly 4 times.
      const counts = {};
      for (const t of deck) counts[t] = (counts[t] || 0) + 1;
      for (const t of ALL_DISTINCT_TILES) {
        assert.equal(counts[t], 4, `tile ${t} appears ${counts[t]} times`);
      }
    });
  });

  describe("wall", () => {
    it("newWall + dealInitialHands gives 13 tiles to each of 4 seats", () => {
      const w = newWall(42);
      const d = dealInitialHands(w.wall);
      assert.equal(d.hands.length, SEAT_COUNT);
      for (const h of d.hands) assert.equal(h.length, 13);
      // 14-tile dead wall, 122-tile live wall, 4*13 = 52 dealt → 70 left.
      assert.equal(d.wallRemaining, 122 - 52);
    });
  });

  describe("hand recognition", () => {
    it("standard winning hand: 4 sequences + 1 pair (pinfu-shape)", () => {
      const h = ["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s8", "s9", "p7", "p7"];
      assert.equal(isStandardWinningHand(h), true);
      assert.equal(isWinningHand(h), true);
    });

    it("standard winning hand: 4 triplets + 1 pair (toitoi-shape)", () => {
      const h = ["m1", "m1", "m1", "p3", "p3", "p3", "s5", "s5", "s5", "wE", "wE", "wE", "dR", "dR"];
      assert.equal(isStandardWinningHand(h), true);
    });

    it("not a winning hand", () => {
      const h = ["m1", "m2", "m4", "p1", "p3", "p5", "s7", "s8", "s9", "wE", "wS", "wW", "wN", "dR"];
      assert.equal(isWinningHand(h), false);
    });

    it("kokushi musou", () => {
      const h = ["m1", "m9", "p1", "p9", "s1", "s9", "wE", "wS", "wW", "wN", "dR", "dG", "dW", "m1"];
      assert.equal(isKokushiHand(h), true);
      assert.equal(isWinningHand(h), true);
    });
  });

  describe("yaku detection", () => {
    it("tanyao (all simples)", () => {
      const h = ["m2", "m3", "m4", "p3", "p4", "p5", "s5", "s6", "s7", "p2", "p3", "p4", "m6", "m6"];
      const y = detectYaku(h, { roundWind: "east", seatWind: "east", opened: false });
      assert.ok(y.includes("tanyao"));
    });

    it("yakuhai — dragon triplet", () => {
      const h = ["m1", "m2", "m3", "p2", "p3", "p4", "s5", "s6", "s7", "dR", "dR", "dR", "p7", "p7"];
      const y = detectYaku(h, { roundWind: "east", seatWind: "east", opened: false });
      assert.ok(y.includes("yakuhai"));
    });

    it("chinitsu (single suit, no honors)", () => {
      const h = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m2", "m3", "m4", "m5", "m5"];
      const y = detectYaku(h, { roundWind: "east", seatWind: "east", opened: false });
      assert.ok(y.includes("chinitsu"));
    });

    it("ittsuu — 1-9 in one suit", () => {
      const h = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "p2", "p3", "p4", "s5", "s5"];
      const y = detectYaku(h, { roundWind: "east", seatWind: "east", opened: false });
      assert.ok(y.includes("ittsuu"));
    });
  });

  describe("NPC discard heuristics", () => {
    it("safe discards a previously-seen tile when available", () => {
      const hand = ["m1", "m9", "p3", "s7", "wE", "wE", "dR", "p5", "p6", "p7", "s2", "s2", "s2", "m5"];
      const allDiscards = [["m1", "m1"], [], [], []]; // m1 already discarded
      const idx = discardByStyle("safe", hand, { allDiscards });
      assert.equal(hand[idx], "m1");
    });

    it("tempai discards an isolated honor before useful number tiles", () => {
      const hand = ["m1", "m2", "m3", "p2", "p3", "p4", "s5", "s6", "s7", "p5", "p6", "p7", "wE", "m9"];
      const idx = discardByStyle("tempai", hand);
      // Isolated honor wE has no triplet potential.
      assert.equal(hand[idx], "wE");
    });

    it("yakuhunt discards off-suit number tiles when chasing honitsu", () => {
      const hand = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "p4", "s5", "wE", "dR", "m5"];
      const idx = discardByStyle("yakuhunt", hand);
      // Dominant suit is m (9 tiles). p4 or s5 should be discarded.
      assert.ok(["p4", "s5"].includes(hand[idx]));
    });
  });

  describe("session orchestration", () => {
    it("startSession creates 4 seats + deals 13 tiles + dealer starts with 14", () => {
      const db = bootDb();
      const r = startSession(db, { worldId: "test", playerUserId: "u1", seed: 12345 });
      assert.equal(r.ok, true);
      const s = getState(db, r.sessionId);
      assert.equal(s.seats.length, 4);
      // After dealer's auto-draw, player has 14.
      const playerHand = JSON.parse(s.seats[0].hand_json);
      assert.equal(playerHand.length, 14);
      // Other seats have 13.
      for (let i = 1; i < 4; i++) {
        const h = JSON.parse(s.seats[i].hand_json);
        assert.equal(h.length, 13);
      }
      // Turn is on the player (dealer).
      assert.equal(s.turn_seat, 0);
    });

    it("discardTile advances through NPC turns back to the player", () => {
      const db = bootDb();
      const r = startSession(db, { worldId: "test", playerUserId: "u1", seed: 99 });
      const s1 = getState(db, r.sessionId);
      const hand = JSON.parse(s1.seats[0].hand_json);
      const result = discardTile(db, r.sessionId, hand[0]);
      assert.equal(result.ok, true);
      const s2 = getState(db, r.sessionId);
      if (!result.ended) {
        // Player should have 14 again (drew at end of round).
        const playerHand = JSON.parse(s2.seats[0].hand_json);
        assert.equal(playerHand.length, 14);
        assert.equal(s2.turn_seat, 0);
      }
    });

    it("discardTile rejects a tile not in hand", () => {
      const db = bootDb();
      const r = startSession(db, { worldId: "test", playerUserId: "u1", seed: 7 });
      const result = discardTile(db, r.sessionId, "not_a_tile");
      assert.equal(result.ok, false);
      assert.equal(result.error, "tile_not_in_hand");
    });
  });
});
