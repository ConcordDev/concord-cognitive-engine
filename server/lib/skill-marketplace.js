// server/lib/skill-marketplace.js
// Cross-world skill marketplace: list, browse, purchase with royalty cascade.

import crypto from "crypto";
import { calculateFee } from "../economy/fees.js";

/**
 * List a skill DTU for sale in the marketplace.
 * @param {string} sellerId
 * @param {string} dtuId
 * @param {number} priceCC  Concordia Credits
 * @param {string} description
 * @param {import('better-sqlite3').Database} db
 * @returns {object}  listing row
 */
export function listSkillForSale(sellerId, dtuId, priceCC, description, db, licenseMode = "single") {
  const skill = db.prepare("SELECT * FROM dtus WHERE id = ? AND creator_id = ?").get(dtuId, sellerId);
  if (!skill) throw Object.assign(new Error("Skill not found or not owned by seller"), { status: 403 });

  const existingActive = db.prepare(
    "SELECT id FROM skill_listings WHERE skill_dtu_id = ? AND status = 'active'"
  ).get(dtuId);
  if (existingActive) throw Object.assign(new Error("Skill already listed"), { status: 409 });

  const mode = licenseMode === "multi" ? "multi" : "single";
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO skill_listings (id, seller_id, skill_dtu_id, origin_world_id, price_cc, description, license_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sellerId,
    dtuId,
    skill.world_id || "concordia-hub",
    priceCC,
    description || skill.title || "",
    mode,
  );


  return db.prepare("SELECT * FROM skill_listings WHERE id = ?").get(id);
}

/**
 * Purchase a skill listing.
 * SB-20/SB-21: the debit, the seller's credit (the platform fee split
 * from economy/fees.js, never a hardcoded fraction) and the purchase
 * record settle in one transaction; the grant runs after commit
 * against the pending purchase row and a grant failure refunds in
 * full. A caller-supplied idempotency key returns the original
 * purchase's receipt instead of charging again.
 *
 * @param {string} buyerId
 * @param {string} listingId
 * @param {object} worldContext  { worldId, worldName }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<{ listing: object, newSkill: object }>}
 */
export async function purchaseSkill(buyerId, listingId, worldContext, db, selectBrain, opts = {}) {
  const idempotencyKey =
    typeof opts.idempotencyKey === "string" && opts.idempotencyKey ? opts.idempotencyKey : null;

  // SB-21 — an idempotency key names ONE purchase. A repeat call with
  // the same key returns the original purchase's receipt: no second
  // charge, no second grant, whatever state that purchase is in.
  if (idempotencyKey) {
    const prior = db.prepare("SELECT * FROM skill_purchases WHERE idempotency_key = ?").get(idempotencyKey);
    if (prior) return purchaseReceipt(db, prior, true);
  }

  const listing = db.prepare("SELECT * FROM skill_listings WHERE id = ? AND status = 'active'").get(listingId);
  if (!listing) throw Object.assign(new Error("Listing not found or no longer active"), { status: 404 });

  if (listing.seller_id === buyerId) throw Object.assign(new Error("Cannot buy your own skill"), { status: 400 });

  // The split is the platform's own fee calculation for a marketplace
  // purchase (economy/fees.js) — never a hardcoded fraction.
  const price = listing.price_cc;
  const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", price);
  const purchaseId = crypto.randomUUID();

  // SB-20 — the money legs and the purchase record settle in ONE
  // transaction. The debit is guarded and its result checked: a buyer
  // who cannot pay is refused, and no credit, grant or sold-mark can
  // exist without the debit. Any failure inside rolls every leg back.
  const settle = db.transaction(() => {
    const fresh = db.prepare("SELECT * FROM skill_listings WHERE id = ?").get(listingId);
    if (!fresh || fresh.status !== "active") {
      throw Object.assign(new Error("Listing not found or no longer active"), { status: 409 });
    }
    const debit = db.prepare(
      "UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ? AND concordia_credits >= ?"
    ).run(price, buyerId, price);
    if (debit.changes !== 1) throw Object.assign(new Error("insufficient_funds"), { status: 402 });

    const credit = db.prepare(
      "UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?"
    ).run(net, listing.seller_id);
    if (credit.changes !== 1) throw Object.assign(new Error("seller_account_unavailable"), { status: 422 });

    db.prepare(`
      INSERT INTO skill_purchases
        (id, buyer_id, seller_id, listing_id, skill_dtu_id, price_cc, fee_cc, seller_net_cc, idempotency_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(purchaseId, buyerId, listing.seller_id, listingId, listing.skill_dtu_id, price, fee, net, idempotencyKey);

    // A multi-license listing stays active across sales; anything else
    // is sold by this purchase.
    if (fresh.license_mode !== "multi") {
      db.prepare("UPDATE skill_listings SET status = 'sold' WHERE id = ?").run(listingId);
    }
  });
  settle();

  // SB-21 — the grant is async (a brain call, then the student-DTU
  // insert), so it runs after the money commits, against the pending
  // purchase row. If the grant fails, a compensating transaction
  // refunds the buyer in full, reverses the seller's credit, restores
  // the listing and marks the purchase refunded — the buyer is never
  // left charged for a skill they did not receive.
  let newSkill;
  try {
    const { teachSkillToPlayer } = await import("./skill-effectiveness.js");
    newSkill = await teachSkillToPlayer(
      listing.seller_id,
      buyerId,
      listing.skill_dtu_id,
      worldContext,
      db,
      selectBrain,
    );
  } catch (teachErr) {
    const refund = db.transaction(() => {
      db.prepare("UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?").run(price, buyerId);
      db.prepare("UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ?").run(net, listing.seller_id);
      db.prepare("UPDATE skill_purchases SET status = 'refunded' WHERE id = ?").run(purchaseId);
      if (listing.license_mode !== "multi") {
        db.prepare("UPDATE skill_listings SET status = 'active' WHERE id = ? AND status = 'sold'").run(listingId);
      }
    });
    refund();
    throw teachErr;
  }

  // The purchase completes only once the grant exists.
  db.prepare(
    "UPDATE skill_purchases SET status = 'completed', new_skill_dtu_id = ?, completed_at = unixepoch() WHERE id = ?"
  ).run(newSkill.id, purchaseId);

  const purchase = db.prepare("SELECT * FROM skill_purchases WHERE id = ?").get(purchaseId);
  return purchaseReceipt(db, purchase, false);
}

/**
 * The receipt for a settled purchase row: the listing's current state,
 * the granted skill (once it exists), and the purchase record itself.
 */
function purchaseReceipt(db, purchase, idempotent) {
  const listing = db.prepare("SELECT * FROM skill_listings WHERE id = ?").get(purchase.listing_id);
  const newSkill = purchase.new_skill_dtu_id
    ? db.prepare("SELECT * FROM dtus WHERE id = ?").get(purchase.new_skill_dtu_id)
    : null;
  const receipt = { listing, newSkill, purchase };
  if (idempotent) receipt.idempotent = true;
  return receipt;
}

/**
 * Paginated listing query.
 * @param {{ worldId?: string, skillType?: string, maxPrice?: number, page?: number, limit?: number }} filters
 * @param {import('better-sqlite3').Database} db
 * @returns {{ listings: object[], total: number }}
 */
export function getListings(filters, db) {
  const { worldId, maxPrice, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  let where = "status = 'active'";
  const params = [];

  if (worldId) {
    where += " AND origin_world_id = ?";
    params.push(worldId);
  }
  if (maxPrice !== undefined) {
    where += " AND price_cc <= ?";
    params.push(maxPrice);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM skill_listings WHERE ${where}`).get(...params)?.c || 0;
  const listings = db.prepare(
    `SELECT sl.*, d.title as skill_title, d.content as skill_content, d.skill_level
     FROM skill_listings sl
     LEFT JOIN dtus d ON sl.skill_dtu_id = d.id
     WHERE ${where}
     ORDER BY sl.listed_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { listings, total };
}
