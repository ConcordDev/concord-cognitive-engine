// server/lib/skill-marketplace.js
// Cross-world skill marketplace: list, browse, purchase with royalty cascade.

import crypto from "crypto";

/**
 * List a skill DTU for sale in the marketplace.
 * @param {string} sellerId
 * @param {string} dtuId
 * @param {number} priceCC  Concordia Credits
 * @param {string} description
 * @param {import('better-sqlite3').Database} db
 * @returns {object}  listing row
 */
export function listSkillForSale(sellerId, dtuId, priceCC, description, db) {
  const skill = db.prepare("SELECT * FROM dtus WHERE id = ? AND creator_id = ?").get(dtuId, sellerId);
  if (!skill) throw Object.assign(new Error("Skill not found or not owned by seller"), { status: 403 });

  const existingActive = db.prepare(
    "SELECT id FROM skill_listings WHERE skill_dtu_id = ? AND status = 'active'"
  ).get(dtuId);
  if (existingActive) throw Object.assign(new Error("Skill already listed"), { status: 409 });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO skill_listings (id, seller_id, skill_dtu_id, origin_world_id, price_cc, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sellerId,
    dtuId,
    skill.world_id || "concordia-hub",
    priceCC,
    description || skill.title || "",
  );


  return db.prepare("SELECT * FROM skill_listings WHERE id = ?").get(id);
}

/**
 * Purchase a skill listing.
 * Debits buyer, credits seller, creates student DTU with lineage, fires royalty cascade.
 *
 * @param {string} buyerId
 * @param {string} listingId
 * @param {object} worldContext  { worldId, worldName }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<{ listing: object, newSkill: object }>}
 */
export async function purchaseSkill(buyerId, listingId, worldContext, db, selectBrain) {
  const listing = db.prepare("SELECT * FROM skill_listings WHERE id = ? AND status = 'active'").get(listingId);
  if (!listing) throw Object.assign(new Error("Listing not found or no longer active"), { status: 404 });

  if (listing.seller_id === buyerId) throw Object.assign(new Error("Cannot buy your own skill"), { status: 400 });

  // Debit buyer (concordia_credits ledger — best-effort, non-fatal if table absent)
  try {
    db.prepare(
      "UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ? AND concordia_credits >= ?"
    ).run(listing.price_cc, buyerId, listing.price_cc);

    // Credit seller
    db.prepare(
      "UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?"
    ).run(listing.price_cc * 0.8, listing.seller_id); // 80% to seller
  } catch (_e) {
    // concordia_credits column may not exist; skip ledger
  }

  // Create student skill DTU via teachSkillToPlayer
  const { teachSkillToPlayer } = await import("./skill-effectiveness.js");
  const newSkill = await teachSkillToPlayer(
    listing.seller_id,
    buyerId,
    listing.skill_dtu_id,
    worldContext,
    db,
    selectBrain,
  );

  // Mark listing as sold
  db.prepare("UPDATE skill_listings SET status = 'sold' WHERE id = ?").run(listingId);

  return { listing, newSkill };
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
