// Phase AA-AG end-to-end smoke test.
//
// Walks the depth-sprint surfaces through a single user journey,
// confirming the pieces interoperate without exception. Each phase's
// substrate primitive is exercised on a fresh in-memory DB so the
// test is hermetic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upRelationships } from "../../migrations/226_npc_relationships.js";
import { up as upBuyOrders } from "../../migrations/227_auction_buy_orders.js";
import { up as upRealism } from "../../migrations/228_disease_realism.js";
import { up as upDialogue } from "../../migrations/229_lattice_quest_dialogue.js";
import { up as upAmbient } from "../../migrations/231_ambient_chat.js";

import { formRelationship, listInWorld } from "../../lib/npc-relationships.js";
import { placeBuyOrder, fillBuyOrder, cancelBuyOrder } from "../../lib/auctions.js";
import {
  getTransmissionProbability,
  contaminateWaterSource,
  waterContaminationAt,
} from "../../lib/disease-engine.js";
import { getHygiene, improveHygiene } from "../../lib/medical-profession.js";
import { composeDeterministicDialogue } from "../../lib/quest-dialogue-composer.js";
import { getSkillFrameData } from "../../lib/combat-frame-data.js";
import { postAmbientMessage, listRecentInDistrict } from "../../lib/ambient-chat.js";

function bootDb() {
  const db = new Database(":memory:");
  upRelationships(db);
  upBuyOrders(db);
  upRealism(db);
  upDialogue(db);
  upAmbient(db);
  // CC lives in users.concordia_credits (mig 045); wallet primitives log to
  // reward_ledger (mig 296) so the buy-order escrow works end-to-end.
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT
    );
  `);
  return db;
}

describe("Phase AA-AG — depth sprint end-to-end smoke", () => {
  it("walks the full user journey without exception", () => {
    const db = bootDb();

    // ── AB — form a nemesis edge in tunya ────────────────────────────
    formRelationship(db, "kin-1", "kin-2", "family_enemy", 0.3, { worldId: "tunya" });
    formRelationship(db, "elder", "apprentice", "mentor", 0.5, { worldId: "tunya" });
    assert.equal(listInWorld(db, "tunya").length, 2);

    // ── AD — drink from a contaminated water source, contract disease ─
    contaminateWaterSource(db, {
      worldId: "tunya", x: 100, z: 100, radiusM: 30,
      diseaseId: "river-fever", level: 0.8,
    });
    const water = waterContaminationAt(db, "tunya", 110, 110);
    assert.ok(water, "player at (110,110) is inside the contaminated radius");

    // Hygiene check: dirty player has higher contraction chance than clean.
    const player = "player-1";
    improveHygiene(db, player, 1.0);
    assert.equal(getHygiene(db, player), 1.0);

    const fluLike = {
      id: "river-fever", contagionRadiusM: 5,
      transmissionProbabilities: { airborne: 0.3 },
    };
    const dirtyChance = getTransmissionProbability(fluLike, "airborne", { distanceM: 0, hygiene: 0 });
    const cleanChance = getTransmissionProbability(fluLike, "airborne", { distanceM: 0, hygiene: 1 });
    assert.ok(cleanChance < dirtyChance, "hygiene reduces contraction");

    // ── AC — place buy order, sell into it ────────────────────────────
    db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)`).run(player, 500);
    // The seller must have a wallet row: fillBuyOrder's G8 checked-credit guard
    // rolls the fill back (ok:false, seller_wallet_missing) if the seller can't be
    // credited. The test previously omitted the seller, so the fill silently failed.
    db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)`).run("healer-npc", 0);
    const buyOrder = placeBuyOrder(db, player, {
      worldId: "tunya", itemDescriptor: "willowbark_tea",
      unitPriceCc: 10, quantity: 20,
    });
    assert.equal(buyOrder.ok, true);
    assert.equal(buyOrder.escrowCc, 200);

    const fill = fillBuyOrder(db, buyOrder.buyOrderId, "healer-npc", 12);
    assert.equal(fill.ok, true);
    assert.equal(fill.newStatus, "partial");

    const cancel = cancelBuyOrder(db, buyOrder.buyOrderId, player);
    assert.equal(cancel.ok, true);
    assert.equal(cancel.refundCc, 80, "8 unfilled × 10 = 80 refund");

    // ── AE — procgen quest gets dialogue voiced ───────────────────────
    const quest = { id: "lbq-1", title: "Find the contaminated spring", summary: "Trace it upstream." };
    const dialogue = composeDeterministicDialogue(quest, { preoccupation: "grief", desire: "a moment of quiet" });
    assert.ok(dialogue.opener.length > 0);
    assert.ok(dialogue.opener.includes("Find the contaminated spring") ||
              dialogue.opener.includes("quiet"),
              "quest title or NPC desire surfaces in opener");

    // ── AF — combat frame data surfaces from a skill ─────────────────
    const sword = getSkillFrameData({ id: "iron-slash", kind: "sword", level: 5 });
    assert.ok(sword.startup_ms > 0);
    assert.ok(sword.parry_window_ms > 0);

    // ── AG — district ambient chat ────────────────────────────────────
    const post = postAmbientMessage(db, {
      userId: player, worldId: "tunya", districtId: "marketplace",
      body: "I found the bad water — stay away from the north spring",
    });
    assert.equal(post.ok, true);
    const feed = listRecentInDistrict(db, "tunya", "marketplace");
    assert.equal(feed.length, 1);
    assert.equal(feed[0].user_id, player);
  });
});
