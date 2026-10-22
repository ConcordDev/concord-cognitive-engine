// economy/marketplace-service.js
// Marketplace Service: Listings, purchases, hash-based duplicate detection,
// rights transfer, and tiered preview engine.
//
// Concord operates as a marketplace FACILITATOR — not a vendor.
// The platform does not hold inventory, does not set prices, and does not sell directly.

import { createHash, randomUUID } from "crypto";
import { executeMarketplacePurchase } from "./transfer.js";
import { distributeRoyalties } from "./royalty-cascade.js";
import { createPurchase, transitionPurchase, recordSettlement } from "./purchases.js";
import { economyAudit } from "./audit.js";
import { isEmergentAccount } from "./emergent-accounts.js";
import logger from '../logger.js';
import { canListOnMarketplace } from "../lib/source-attribution.js";

function uid(prefix = "lst") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Content types and their preview strategies
const PREVIEW_STRATEGIES = {
  dtu: "structural_summary",
  mega_dtu: "topology_map",
  hyper_dtu: "topology_map",
  music: "sample_clip",
  art: "low_res_thumbnail",
  document: "abstract_only",
  artifact: "structural_summary",
  film: "first_5_min",        // Film Studio: first 5 minutes free, no auth
  video: "first_5_min",       // Video content also gets time-based preview
};

/**
 * Create a new marketplace listing.
 * Content is hashed at upload — duplicates are rejected.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.sellerId — user or emergent ID
 * @param {string} opts.contentId — ID of the content being listed
 * @param {string} opts.contentType — type of content
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {number} opts.price — in Concord Coins. 0 is a free listing.
 * @param {string} opts.contentData — raw content for hashing
 * @param {string} [opts.licenseType='standard']
 * @param {Array} [opts.royaltyChain=[]] — citation chain for royalty tracking
 * @param {object|string|null} [opts.previewData] — stored in preview_data when that column exists
 */
export function createListing(db, {
  sellerId, contentId, contentType, title, description,
  price, contentData, licenseType = "standard", royaltyChain = [],
  previewData = null,
}) {
  if (!sellerId) return { ok: false, error: "missing_seller_id" };
  if (!contentId) return { ok: false, error: "missing_content_id" };
  if (!contentType || !PREVIEW_STRATEGIES[contentType]) {
    return { ok: false, error: "invalid_content_type", validTypes: Object.keys(PREVIEW_STRATEGIES) };
  }
  if (!title) return { ok: false, error: "missing_title" };
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0) return { ok: false, error: "invalid_price" };
  const roundedPrice = Math.round(priceNum * 100) / 100;
  if (priceNum > 0 && roundedPrice === 0) return { ok: false, error: "invalid_price" };
  if (!contentData) return { ok: false, error: "missing_content_data" };

  // ── License Compliance Gate ──
  // Block listings for content derived from non-commercial or all-rights-reserved sources
  try {
    const dtuRow = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(contentId);
    if (dtuRow) {
      const dtu = JSON.parse(dtuRow.data);
      const licenseCheck = canListOnMarketplace(dtu);
      if (!licenseCheck.allowed) {
        return { ok: false, error: "license_blocked", reason: licenseCheck.reason };
      }
    }
  } catch (_e) { /* dtu_store may not exist or source-attribution may fail; allow listing */ }

  // SHA-256 hash for duplicate detection
  const contentHash = hashContent(contentData);

  // Check for duplicate content
  const existingHash = db.prepare(
    "SELECT id, seller_id, title FROM marketplace_economy_listings WHERE content_hash = ? AND status = 'active'"
  ).get(contentHash);

  if (existingHash) {
    return {
      ok: false,
      error: "duplicate_content",
      existingListing: {
        id: existingHash.id,
        sellerId: existingHash.seller_id,
        title: existingHash.title,
      },
    };
  }

  const id = uid("lst");
  const previewType = PREVIEW_STRATEGIES[contentType];
  const now = nowISO();

  try {
    const columns = listingColumns(db);
    const previewJson = previewData == null ? null : (typeof previewData === "string" ? previewData : JSON.stringify(previewData));
    if (columns.has("preview_data")) {
      db.prepare(`
        INSERT INTO marketplace_economy_listings
          (id, seller_id, content_id, content_type, title, description, price,
           content_hash, status, preview_type, preview_data, license_type, royalty_chain_json,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
      `).run(
        id, sellerId, contentId, contentType, title,
        description || null, roundedPrice, contentHash, previewType, previewJson,
        licenseType, JSON.stringify(royaltyChain), now, now,
      );
    } else {
      db.prepare(`
        INSERT INTO marketplace_economy_listings
          (id, seller_id, content_id, content_type, title, description, price,
           content_hash, status, preview_type, license_type, royalty_chain_json,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
      `).run(
        id, sellerId, contentId, contentType, title,
        description || null, roundedPrice, contentHash, previewType,
        licenseType, JSON.stringify(royaltyChain), now, now,
      );
    }

    return {
      ok: true,
      listing: {
        id,
        sellerId,
        contentId,
        contentType,
        title,
        price: roundedPrice,
        contentHash,
        previewType,
        licenseType,
        status: "active",
        createdAt: now,
      },
    };
  } catch (err) {
    console.error("[economy] listing_creation_failed:", err.message);
    return { ok: false, error: "listing_creation_failed" };
  }
}

/**
 * Execute a marketplace purchase with full royalty cascade.
 * Handles the complete flow: validate → debit buyer → credit seller → distribute royalties.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.buyerId
 * @param {string} opts.listingId
 * @param {string} [opts.refId]
 */
export function purchaseListing(db, { buyerId, listingId, refId, requestId, ip }) {
  if (!buyerId) return { ok: false, error: "missing_buyer_id" };
  if (!listingId) return { ok: false, error: "missing_listing_id" };

  // Get listing
  const listing = db.prepare(
    "SELECT * FROM marketplace_economy_listings WHERE id = ? AND status = 'active'"
  ).get(listingId);

  if (!listing) return { ok: false, error: "listing_not_found_or_inactive" };

  // Can't buy your own listing
  if (listing.seller_id === buyerId) return { ok: false, error: "cannot_buy_own_listing" };

  const purchaseId = uid("pur");
  const purchaseRefId = refId || `marketplace:${purchaseId}`;

  // Free listings never touch the ledger. economy_ledger rejects amount/net <= 0,
  // and a zero-price sale has nothing to debit. The purchase row still moves
  // CREATED → PAID → SETTLED → FULFILLED so the buyer has a real entitlement.
  if (Number(listing.price) === 0) {
    return fulfillFreeListing(db, { buyerId, listing, purchaseId, requestId, ip });
  }

  // 1. Create purchase record
  createPurchase(db, {
    purchaseId,
    buyerId,
    sellerId: listing.seller_id,
    listingId: listing.id,
    listingType: listing.content_type,
    licenseType: listing.license_type,
    amount: listing.price,
    source: "marketplace",
  });

  // 2. Execute the marketplace purchase (applies fees, debits buyer, credits seller)
  const txResult = executeMarketplacePurchase(db, {
    buyerId,
    sellerId: listing.seller_id,
    amount: listing.price,
    listingId: listing.id,
    metadata: { purchaseId, contentType: listing.content_type },
    refId: purchaseRefId,
    requestId,
    ip,
  });

  if (!txResult.ok) {
    transitionPurchase(db, purchaseId, "FAILED", {
      reason: `Transaction failed: ${txResult.error}`,
      actor: "marketplace_service",
      errorMessage: txResult.error,
    });
    return txResult;
  }

  // 3. Transition to PAID
  transitionPurchase(db, purchaseId, "PAID", {
    reason: "Payment processed via marketplace",
    actor: "marketplace_service",
  });

  // 4. Distribute royalties to ancestor creators
  let royaltyResult = { ok: true, totalRoyalties: 0, payouts: [] };
  const royaltyChain = safeJsonParse(listing.royalty_chain_json);
  if (royaltyChain.length > 0) {
    royaltyResult = distributeRoyalties(db, {
      contentId: listing.content_id,
      transactionAmount: listing.price,
      sourceTxId: txResult.batchId,
      buyerId,
      sellerId: listing.seller_id,
      refId: `royalty:${purchaseRefId}`,
      requestId,
      ip,
    });
  }

  // 5. Record settlement details
  recordSettlement(db, purchaseId, {
    settlementBatchId: txResult.batchId,
    marketplaceFee: txResult.fee,
    sellerNet: txResult.net,
    totalRoyalties: royaltyResult.totalRoyalties || 0,
    royaltyDetails: royaltyResult.payouts || [],
  });

  // 6. Transition to SETTLED then FULFILLED
  transitionPurchase(db, purchaseId, "SETTLED", {
    reason: "Settlement complete",
    actor: "marketplace_service",
  });
  transitionPurchase(db, purchaseId, "FULFILLED", {
    reason: "Purchase fulfilled",
    actor: "marketplace_service",
  });

  // 7. Update listing stats
  const now = nowISO();
  db.prepare(`
    UPDATE marketplace_economy_listings
    SET purchase_count = purchase_count + 1,
        total_revenue = total_revenue + ?,
        updated_at = ?
    WHERE id = ?
  `).run(listing.price, now, listingId);
  if (listing.license_type === "exclusive") {
    db.prepare(`UPDATE marketplace_economy_listings SET status = 'sold', updated_at = ? WHERE id = ?`).run(now, listingId);
  }

  economyAudit(db, {
    action: "marketplace_purchase_complete",
    userId: buyerId,
    amount: listing.price,
    txId: txResult.batchId,
    details: {
      purchaseId,
      listingId,
      sellerId: listing.seller_id,
      fee: txResult.fee,
      sellerNet: txResult.net,
      totalRoyalties: royaltyResult.totalRoyalties || 0,
      royaltyPayouts: (royaltyResult.payouts || []).length,
    },
    requestId,
    ip,
  });

  return {
    ok: true,
    purchaseId,
    listingId,
    buyerId,
    sellerId: listing.seller_id,
    amount: listing.price,
    fee: txResult.fee,
    sellerNet: txResult.net,
    royalties: {
      total: royaltyResult.totalRoyalties || 0,
      payouts: royaltyResult.payouts || [],
    },
    batchId: txResult.batchId,
  };
}

/**
 * Get a listing by ID.
 */
export function getListing(db, listingId) {
  const row = db.prepare("SELECT * FROM marketplace_economy_listings WHERE id = ?").get(listingId);
  if (!row) return null;
  return formatListing(row);
}

/**
 * Search/browse marketplace listings.
 */
export function searchListings(db, { contentType, sellerId, status = "active", minPrice, maxPrice, limit = 50, offset = 0 } = {}) {
  let sql = "SELECT * FROM marketplace_economy_listings WHERE 1=1";
  const params = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (contentType) {
    sql += " AND content_type = ?";
    params.push(contentType);
  }
  if (sellerId) {
    sql += " AND seller_id = ?";
    params.push(sellerId);
  }
  if (minPrice != null) {
    sql += " AND price >= ?";
    params.push(minPrice);
  }
  if (maxPrice != null) {
    sql += " AND price <= ?";
    params.push(maxPrice);
  }

  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(formatListing);

  return { items, total, limit, offset };
}

/**
 * Delist a marketplace listing (seller action).
 */
export function delistListing(db, { listingId, sellerId }) {
  const listing = db.prepare(
    "SELECT * FROM marketplace_economy_listings WHERE id = ? AND seller_id = ?"
  ).get(listingId, sellerId);

  if (!listing) return { ok: false, error: "listing_not_found_or_not_owner" };
  if (listing.status !== "active") return { ok: false, error: "listing_not_active", status: listing.status };

  db.prepare(
    "UPDATE marketplace_economy_listings SET status = 'delisted', updated_at = ? WHERE id = ?"
  ).run(nowISO(), listingId);

  return { ok: true, listingId, status: "delisted" };
}

/**
 * Update listing price (seller action).
 */
export function updateListingPrice(db, { listingId, sellerId, newPrice }) {
  if (!newPrice || newPrice <= 0) return { ok: false, error: "invalid_price" };

  const listing = db.prepare(
    "SELECT * FROM marketplace_economy_listings WHERE id = ? AND seller_id = ?"
  ).get(listingId, sellerId);

  if (!listing) return { ok: false, error: "listing_not_found_or_not_owner" };
  if (listing.status !== "active") return { ok: false, error: "listing_not_active" };

  db.prepare(
    "UPDATE marketplace_economy_listings SET price = ?, updated_at = ? WHERE id = ?"
  ).run(newPrice, nowISO(), listingId);

  return { ok: true, listingId, oldPrice: listing.price, newPrice };
}

/**
 * Generate a preview for a listing based on content type.
 * Auto-detects content type and applies the appropriate preview method.
 */
export function generatePreview(contentType, contentData) {
  const strategy = PREVIEW_STRATEGIES[contentType];
  if (!strategy) return { type: "none", data: null };

  switch (strategy) {
    case "structural_summary":
      return {
        type: "structural_summary",
        data: {
          contentType,
          characterCount: contentData?.length || 0,
          hasStructure: true,
        },
      };

    case "topology_map":
      return {
        type: "topology_map",
        data: {
          contentType,
          complexity: "compound",
          encrypted: true,
        },
      };

    case "sample_clip":
      return {
        type: "sample_clip",
        data: {
          contentType: "audio",
          samplePercentage: 0.15,
          watermarked: true,
        },
      };

    case "low_res_thumbnail":
      return {
        type: "low_res_thumbnail",
        data: {
          contentType: "image",
          watermarked: true,
          fullResOnPurchase: true,
        },
      };

    case "abstract_only":
      return {
        type: "abstract_only",
        data: {
          contentType: "document",
          sectionsHidden: true,
        },
      };

    default:
      return { type: "none", data: null };
  }
}

/**
 * Hash content using SHA-256 with canonical normalization.
 */
export function hashContent(content) {
  if (!content) return null;
  // Normalize: trim, lowercase for text content, sort keys for objects
  let normalized = content;
  if (typeof content === "string") {
    normalized = content.trim();
  } else if (typeof content === "object") {
    normalized = JSON.stringify(content, Object.keys(content).sort());
  }
  return createHash("sha256").update(String(normalized)).digest("hex");
}

/**
 * Check for wash trading: same two accounts trading same content repeatedly.
 */
export function checkWashTrading(db, { accountA, accountB, contentId }) {
  // Count recent trades between these two accounts for this content
  const recentTrades = db.prepare(`
    SELECT COUNT(*) as c FROM economy_ledger
    WHERE type = 'MARKETPLACE_PURCHASE'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
      AND created_at > datetime('now', '-24 hours')
      AND metadata_json LIKE ?
  `).get(accountA, accountB, accountB, accountA, `%${contentId}%`)?.c || 0;

  if (recentTrades >= 3) {
    // Flag for review
    try {
      db.prepare(`
        INSERT INTO wash_trade_flags (id, account_a, account_b, content_id, trade_count, flagged_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uid("wtf"), accountA, accountB, contentId, recentTrades, nowISO());
    } catch (_e) { logger.debug('marketplace-service', 'ignore duplicate flags', { error: _e?.message }); }

    return { flagged: true, tradeCount: recentTrades };
  }

  return { flagged: false, tradeCount: recentTrades };
}

// Helpers

function formatListing(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    contentId: row.content_id,
    contentType: row.content_type,
    title: row.title,
    description: row.description,
    price: row.price,
    contentHash: row.content_hash,
    status: row.status,
    previewType: row.preview_type,
    licenseType: row.license_type,
    royaltyChain: safeJsonParse(row.royalty_chain_json),
    preview: parsePreview(row.preview_data),
    purchaseCount: row.purchase_count,
    totalRevenue: row.total_revenue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (err) { console.debug('[marketplace-service] JSON parse failed', err?.message); return []; }
}

function parsePreview(str) {
  if (str == null || str === "") return null;
  try {
    const value = JSON.parse(str);
    return value && typeof value === "object" ? value : null;
  } catch (err) {
    console.debug("[marketplace-service] preview JSON parse failed", err?.message);
    return null;
  }
}

function listingColumns(db) {
  try {
    return new Set(db.prepare("PRAGMA table_info(marketplace_economy_listings)").all().map((c) => c.name));
  } catch {
    return new Set();
  }
}

function fulfillFreeListing(db, { buyerId, listing, purchaseId, requestId, ip }) {
  createPurchase(db, {
    purchaseId,
    buyerId,
    sellerId: listing.seller_id,
    listingId: listing.id,
    listingType: listing.content_type,
    licenseType: listing.license_type,
    amount: 0,
    source: "marketplace",
  });
  const paid = transitionPurchase(db, purchaseId, "PAID", {
    reason: "Free listing — no Concord balance debit",
    actor: "marketplace_service",
  });
  if (!paid.ok) return paid;
  recordSettlement(db, purchaseId, {
    settlementBatchId: null,
    marketplaceFee: 0,
    sellerNet: 0,
    totalRoyalties: 0,
    royaltyDetails: [],
  });
  const settled = transitionPurchase(db, purchaseId, "SETTLED", {
    reason: "Free listing settled",
    actor: "marketplace_service",
  });
  if (!settled.ok) return settled;
  const fulfilled = transitionPurchase(db, purchaseId, "FULFILLED", {
    reason: "Free listing fulfilled",
    actor: "marketplace_service",
  });
  if (!fulfilled.ok) return fulfilled;
  const now = nowISO();
  db.prepare(`
    UPDATE marketplace_economy_listings
    SET purchase_count = purchase_count + 1, updated_at = ?
    WHERE id = ?
  `).run(now, listing.id);
  if (listing.license_type === "exclusive") {
    db.prepare(`UPDATE marketplace_economy_listings SET status = 'sold', updated_at = ? WHERE id = ?`).run(now, listing.id);
  }
  economyAudit(db, {
    action: "marketplace_purchase_complete",
    userId: buyerId,
    amount: 0,
    details: { purchaseId, listingId: listing.id, sellerId: listing.seller_id, fee: 0, sellerNet: 0, free: true },
    requestId,
    ip,
  });
  return {
    ok: true,
    purchaseId,
    listingId: listing.id,
    buyerId,
    sellerId: listing.seller_id,
    amount: 0,
    fee: 0,
    sellerNet: 0,
    royalties: { total: 0, payouts: [] },
    batchId: null,
    free: true,
  };
}

export { PREVIEW_STRATEGIES };
