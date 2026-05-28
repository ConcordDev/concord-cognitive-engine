// server/lib/mahjong/yaku-detect.js
//
// Phase E4 — detect yaku from a winning 14-tile hand.
//
// We support the simpler/most-common yaku, sized to match the existing
// resolveMahjongHand scoring table in lib/minigame-resolvers.js. The
// resolver takes a yaku list as input; we produce that list.
//
// Supported yaku:
//   tanyao    — all simples (no terminals or honors)
//   pinfu     — all sequences + non-yakuhai pair + 2-sided wait (simplified: all-sequences + numeric pair)
//   yakuhai   — triplet of round wind, seat wind, or any dragon
//   iipeiko   — two identical sequences in the same suit (concealed)
//   sanshoku  — same sequence in all three suits
//   ittsuu    — m1-9, p1-9, or s1-9 full run in one suit (1-2-3 + 4-5-6 + 7-8-9)
//   toitoi    — all triplets (no sequences)
//   honitsu   — one suit + honors
//   chinitsu  — single suit, no honors
//   kokushi   — 13 orphans (handled separately)

import { decomposeWinningHand, isKokushiHand, isStandardWinningHand } from "./hand.js";
import { isNumberTile, isHonor, isTerminal, tileSuit, tileValue } from "./tiles.js";

/**
 * Detect all yaku for a winning 14-tile hand. Returns an array of
 * lowercase yaku names matching `resolveMahjongHand`'s scoring table.
 */
export function detectYaku(tiles, ctx = {}) {
  if (!Array.isArray(tiles) || tiles.length !== 14) return [];

  // Kokushi short-circuit.
  if (isKokushiHand(tiles)) return ["kokushi"];

  if (!isStandardWinningHand(tiles)) return [];
  const decomp = decomposeWinningHand(tiles);
  if (!decomp) return [];
  const { pair, melds } = decomp;
  const yaku = [];

  // tanyao — no terminals or honors anywhere in the 14 tiles.
  if (tiles.every((t) => !isTerminal(t) && !isHonor(t))) yaku.push("tanyao");

  // toitoi — all triplets.
  if (melds.every((m) => m.kind === "triplet")) yaku.push("toitoi");

  // pinfu (simplified) — all sequences + numeric pair.
  if (melds.every((m) => m.kind === "sequence") && isNumberTile(pair)) yaku.push("pinfu");

  // yakuhai — triplet of round wind, seat wind, or any dragon.
  const roundWind = windToTile(ctx.roundWind);
  const seatWind = windToTile(ctx.seatWind);
  for (const m of melds) {
    if (m.kind !== "triplet") continue;
    if (m.tile === "dR" || m.tile === "dG" || m.tile === "dW") {
      if (!yaku.includes("yakuhai")) yaku.push("yakuhai");
    }
    if (roundWind && m.tile === roundWind) {
      if (!yaku.includes("yakuhai")) yaku.push("yakuhai");
    }
    if (seatWind && m.tile === seatWind) {
      if (!yaku.includes("yakuhai")) yaku.push("yakuhai");
    }
  }

  // iipeiko — two identical sequences in the same suit (concealed only).
  if (!ctx.opened) {
    const seqKeys = melds.filter((m) => m.kind === "sequence")
      .map((m) => m.tiles.join("-"));
    const seen = new Set();
    const dup = new Set();
    for (const k of seqKeys) {
      if (seen.has(k)) dup.add(k); else seen.add(k);
    }
    if (dup.size >= 1) yaku.push("iipeiko");
  }

  // sanshoku — same numeric sequence in all 3 suits.
  const sequencesByStart = new Map(); // "v" -> Set of suits
  for (const m of melds) {
    if (m.kind !== "sequence") continue;
    const suit = tileSuit(m.tiles[0]);
    const v = tileValue(m.tiles[0]);
    const k = `${v}`;
    const set = sequencesByStart.get(k) || new Set();
    set.add(suit);
    sequencesByStart.set(k, set);
  }
  for (const set of sequencesByStart.values()) {
    if (set.size >= 3) { yaku.push("sanshoku"); break; }
  }

  // ittsuu — 1-2-3, 4-5-6, 7-8-9 all in one suit.
  for (const s of ["m", "p", "s"]) {
    const starts = new Set(
      melds.filter((m) => m.kind === "sequence" && tileSuit(m.tiles[0]) === s)
        .map((m) => tileValue(m.tiles[0]))
    );
    if (starts.has(1) && starts.has(4) && starts.has(7)) {
      yaku.push("ittsuu");
      break;
    }
  }

  // honitsu + chinitsu.
  const suitsUsed = new Set();
  let hasHonor = false;
  for (const t of tiles) {
    if (isHonor(t)) hasHonor = true;
    else suitsUsed.add(tileSuit(t));
  }
  if (suitsUsed.size === 1 && !hasHonor) yaku.push("chinitsu");
  else if (suitsUsed.size === 1 && hasHonor) yaku.push("honitsu");

  return yaku;
}

function windToTile(wind) {
  if (!wind) return null;
  const m = { east: "wE", south: "wS", west: "wW", north: "wN" };
  return m[wind] || null;
}
