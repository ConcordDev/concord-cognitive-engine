/**
 * T3.4 — mahjong reward-tracks-rarity guard.
 *
 * The G3.3 frequency sim (audit/balance/mahjong-yaku.json) measures pure
 * tile-combinatorics — scoring can't move that distribution. So the real
 * balance lever is: an over-common yaku must NOT out-pay a rare one. This pins
 * the three re-weighted outliers (iipeiko over-common, pinfu/ittsuu rare) so a
 * future edit can't silently reintroduce "the most common hand pays the most".
 *
 * Run: node --test tests/integration/mahjong-value-balance.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(HERE, "../../lib/minigame-resolvers.js"), "utf8");

function valueOf(yaku) {
  const m = SRC.match(new RegExp(`\\b${yaku}\\s*:\\s*(\\d+)`));
  assert.ok(m, `${yaku} not found in MAHJONG_HAND_VALUES`);
  return Number(m[1]);
}

describe("T3.4 — mahjong reward tracks rarity", () => {
  it("the over-common iipeiko no longer out-pays the rare pinfu/ittsuu", () => {
    const iipeiko = valueOf("iipeiko"); // 0.337 freq — most common
    const pinfu = valueOf("pinfu");     // 0.046 freq — rare
    const ittsuu = valueOf("ittsuu");   // 0.006 freq — rarest
    assert.ok(pinfu > iipeiko, `pinfu (${pinfu}) should out-pay common iipeiko (${iipeiko})`);
    assert.ok(ittsuu > pinfu, `rarest ittsuu (${ittsuu}) should out-pay pinfu (${pinfu})`);
  });

  it("iipeiko is priced like the other common cheap yaku (tanyao)", () => {
    assert.equal(valueOf("iipeiko"), valueOf("tanyao"),
      "iipeiko is as common as tanyao, so it should pay the same cheap rate");
  });
});
