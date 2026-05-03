/**
 * Creative Artifact Marketplace Service — Federation v1.2
 *
 * Core Principle: Creators Keep IP. Always. Only Usage Rights Are Sold.
 *
 * Handles:
 *   - Publishing artifacts (original and derivative)
 *   - Derivative declaration with lineage validation
 *   - Purchase flow with royalty cascade
 *   - Usage license granting
 *   - Artist discovery (local-first)
 *   - Artifact ratings
 *   - Promotion through federation tiers
 *   - Creative XP and quest completion
 */

import { randomUUID, createHash } from "crypto";
import { recordTransactionBatch, generateTxId } from "./ledger.js";
import { PLATFORM_ACCOUNT_ID } from "./fees.js";
import { distributeFee } from "./fee-split.js";
import { economyAudit } from "./audit.js";
import { validateBalance } from "./validators.js";
import { grantLicense as grantDtuLicense } from "./rights-enforcement.js";
import { validatePricing as validateTierPricing, getTier as getLicenseTier } from "./license-tiers.js";
import {
  ARTIFACT_TYPES, CREATIVE_MARKETPLACE, CREATIVE_FEDERATION,
  CREATIVE_QUESTS, CREATIVE_LEADERBOARD, CREATOR_RIGHTS, LICENSE_TYPES,
} from "../lib/creative-marketplace-constants.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function uid(prefix = "ca") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Idempotently ensure the per-tier pricing column exists on
 * creative_artifacts. Called on every write path so older deployments
 * upgrade in place.
 */
function ensureTierPricingColumn(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(creative_artifacts)").all();
    const hasColumn = cols.some((c) => c.name === "tier_prices_json");
    if (!hasColumn) {
      db.exec("ALTER TABLE creative_artifacts ADD COLUMN tier_prices_json TEXT");
    }
  } catch {
    /* table might not exist yet — first-boot safe */
  }
}

/**
 * Map our loose content type strings (music/art/code/...) to the
 * UPPERCASE content type keys the license-tiers module uses.
 */
const CONTENT_TYPE_TO_TIER_KEY = {
  music: "MUSIC",
  art: "ART",
  code: "CODE",
  document: "DOCUMENT",
  "3d_asset": "3D_ASSET",
  "3d": "3D_ASSET",
  film: "FILM",
  video: "FILM",
};
function _tierKeyForType(type) {
  if (!type) return null;
  const normalized = String(type).toLowerCase();
  return CONTENT_TYPE_TO_TIER_KEY[normalized] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLISH ARTIFACT (Original work)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish a creative artifact to the marketplace.
 * Validates type, file constraints, and dedup.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.creatorId
 * @param {string} opts.type — from ARTIFACT_TYPES
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} opts.filePath
 * @param {number} opts.fileSize — bytes
 * @param {string} opts.fileHash — SHA-256 content hash
 * @param {number} opts.price — in Concord Coin
 * @param {object} [opts.creative] — creative metadata
 * @param {object} [opts.license] — license configuration
 * @param {string} [opts.previewPath]
 */
export function publishArtifact(db, {
  creatorId, type, title, description, filePath, fileSize, fileHash,
  price, tierPrices, creative = {}, license = {}, previewPath,
}) {
  ensureTierPricingColumn(db);

  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!type || !ARTIFACT_TYPES[type]) {
    return { ok: false, error: "invalid_artifact_type", validTypes: Object.keys(ARTIFACT_TYPES) };
  }
  if (!title || title.length < 1) return { ok: false, error: "missing_title" };
  // Virtual artifacts (e.g. recipe DTUs) carry their data inside a DTU
  // record, not a filesystem file. The caller still supplies a synthetic
  // dtu:// path + computed size + hash so the rest of the pipeline (royalty
  // cascade citation chains, transaction ledger) is identical.
  const isVirtual = !!ARTIFACT_TYPES[type].virtual;
  if (!filePath) return { ok: false, error: isVirtual ? "missing_dtu_ref" : "missing_file_path" };
  if (!fileSize || fileSize <= 0) return { ok: false, error: "invalid_file_size" };
  if (!fileHash) return { ok: false, error: "missing_file_hash" };

  // Per-tier pricing support. Creators can now set separate prices for
  // each tier (e.g. Music: listen=0, download=3, remix=15, commercial=60).
  // A single `price` is still accepted for backwards compat — it becomes
  // the "headline" price and defaults the highest interactive tier.
  let normalizedTierPrices = null;
  const tierKey = _tierKeyForType(type);
  if (tierPrices && typeof tierPrices === "object" && tierKey) {
    const validation = validateTierPricing(tierKey, tierPrices);
    if (!validation.valid) {
      return { ok: false, error: "invalid_tier_pricing", errors: validation.errors };
    }
    normalizedTierPrices = { ...tierPrices };
  }

  // If only a single `price` was passed, we still require it to be valid
  // so listings have at least one purchase entry point.
  if (!normalizedTierPrices) {
    if (!price || price <= 0) return { ok: false, error: "invalid_price" };
    if (price > 50000) return { ok: false, error: "price_exceeds_maximum", maxPrice: 50000 };
  } else {
    // Headline price = max non-zero tier, or fallback to caller-supplied
    if (!price || price <= 0) {
      const vals = Object.values(normalizedTierPrices).filter((v) => typeof v === "number" && v > 0);
      price = vals.length ? Math.max(...vals) : 0;
    }
    if (price > 50000) return { ok: false, error: "price_exceeds_maximum", maxPrice: 50000 };
  }

  // Validate file size against type limit
  const typeConfig = ARTIFACT_TYPES[type];
  const maxBytes = typeConfig.maxSizeMB * 1024 * 1024;
  if (fileSize > maxBytes) {
    return { ok: false, error: "file_too_large", maxMB: typeConfig.maxSizeMB, actualBytes: fileSize };
  }

  // Description length check for regional listing
  if (description && description.length < CREATIVE_FEDERATION.regional.qualityGate.minDescriptionLength) {
    return { ok: false, error: "description_too_short", minLength: CREATIVE_FEDERATION.regional.qualityGate.minDescriptionLength };
  }

  // Dedup check: same file hash
  const existingHash = db.prepare(
    "SELECT id, creator_id, title FROM creative_artifacts WHERE file_hash = ? AND marketplace_status = 'active'"
  ).get(fileHash);

  if (existingHash) {
    return {
      ok: false,
      error: "duplicate_content",
      existingArtifact: { id: existingHash.id, creatorId: existingHash.creator_id, title: existingHash.title },
    };
  }

  // Get creator location
  const creator = db.prepare("SELECT declared_regional, declared_national FROM users WHERE id = ?").get(creatorId);
  const locationRegional = creator?.declared_regional || null;
  const locationNational = creator?.declared_national || null;

  const licenseType = license.type || "standard";
  if (!["standard", "exclusive", "custom", "personal-use"].includes(licenseType)) {
    return { ok: false, error: "invalid_license_type" };
  }

  const id = uid("ca");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO creative_artifacts (
        id, creator_id, type, title, description, tags_json,
        genre, medium, language, duration_seconds, width, height,
        file_path, file_size, file_hash, preview_path,
        location_regional, location_national, federation_tier,
        license_type, license_json,
        is_derivative, lineage_depth,
        marketplace_status, price, tier_prices_json, dedup_verified,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'regional', ?, ?, 0, 0, 'active', ?, ?, 1, ?, ?)
    `).run(
      id, creatorId, type, title, description || null,
      JSON.stringify(creative.tags || []),
      creative.genre || null, creative.medium || null,
      creative.language || null, creative.duration || null,
      creative.dimensions?.width || null, creative.dimensions?.height || null,
      filePath, fileSize, fileHash, previewPath || null,
      locationRegional, locationNational,
      licenseType, JSON.stringify(license),
      price,
      normalizedTierPrices ? JSON.stringify(normalizedTierPrices) : null,
      now, now,
    );

    return {
      ok: true,
      artifact: {
        id, creatorId, type, title, price,
        tierPrices: normalizedTierPrices,
        federationTier: "regional",
        marketplaceStatus: "active",
        licenseType,
        locationRegional,
        locationNational,
        createdAt: now,
      },
    };
  } catch (err) {
    console.error("[economy] publish_failed:", err.message);
    return { ok: false, error: "publish_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLISH DERIVATIVE ARTIFACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish a derivative artifact. The creator MUST declare all parent artifacts.
 * This is constitutional — undeclared derivatives violate the immutable tier.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.creatorId
 * @param {object} opts.artifact — same fields as publishArtifact
 * @param {Array} opts.parentDeclarations — [{ artifactId, derivativeType }]
 */
export function publishDerivativeArtifact(db, { creatorId, artifact, parentDeclarations }) {
  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!Array.isArray(parentDeclarations) || parentDeclarations.length === 0) {
    return { ok: false, error: "derivative_must_declare_parents" };
  }

  // Validate all declared parents exist and creator has usage rights
  for (const parent of parentDeclarations) {
    const parentArtifact = db.prepare(
      "SELECT id, creator_id, type FROM creative_artifacts WHERE id = ?"
    ).get(parent.artifactId);

    if (!parentArtifact) {
      return { ok: false, error: "parent_artifact_not_found", artifactId: parent.artifactId };
    }

    // Check creator has purchased usage rights to parent
    const hasLicense = db.prepare(
      "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'"
    ).get(parent.artifactId, creatorId);

    // Creator of parent doesn't need a license to their own work
    if (!hasLicense && parentArtifact.creator_id !== creatorId) {
      return {
        ok: false,
        error: "missing_usage_license",
        artifactId: parent.artifactId,
        message: "Creator must purchase usage rights before creating derivative",
      };
    }

    // Validate derivative type is valid for the parent's artifact type
    const parentType = ARTIFACT_TYPES[parentArtifact.type];
    if (parentType && !parentType.derivativeTypes.includes(parent.derivativeType)) {
      return {
        ok: false,
        error: "invalid_derivative_type",
        artifactId: parent.artifactId,
        validTypes: parentType.derivativeTypes,
      };
    }
  }

  // Calculate lineage depth (max depth of any parent + 1)
  const parentDepths = parentDeclarations.map(p => {
    const pa = db.prepare("SELECT lineage_depth FROM creative_artifacts WHERE id = ?").get(p.artifactId);
    return pa?.lineage_depth || 0;
  });
  const maxParentDepth = Math.max(...parentDepths);

  // Check for cycles
  const artifactTempId = uid("ca");
  for (const parent of parentDeclarations) {
    if (wouldCreateCycle(db, artifactTempId, parent.artifactId)) {
      return { ok: false, error: "circular_derivative_chain_detected" };
    }
  }

  // Publish the artifact itself
  const result = publishArtifact(db, {
    creatorId,
    ...artifact,
  });

  if (!result.ok) return result;

  const newArtifactId = result.artifact.id;

  // Mark as derivative and set lineage depth
  db.prepare(`
    UPDATE creative_artifacts
    SET is_derivative = 1, lineage_depth = ?
    WHERE id = ?
  `).run(maxParentDepth + 1, newArtifactId);

  // Record derivative relationships
  for (const parent of parentDeclarations) {
    const pa = db.prepare("SELECT lineage_depth FROM creative_artifacts WHERE id = ?").get(parent.artifactId);
    db.prepare(`
      INSERT INTO creative_artifact_derivatives (id, child_artifact_id, parent_artifact_id, derivative_type, generation, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid("cad"), newArtifactId, parent.artifactId, parent.derivativeType, (pa?.lineage_depth || 0) + 1, nowISO());

    // Increment parent's derivative count
    db.prepare(
      "UPDATE creative_artifacts SET derivative_count = derivative_count + 1, updated_at = ? WHERE id = ?"
    ).run(nowISO(), parent.artifactId);
  }

  result.artifact.isDerivative = true;
  result.artifact.lineageDepth = maxParentDepth + 1;
  result.artifact.parentArtifacts = parentDeclarations;

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE ARTIFACT (with royalty cascade)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process an artifact purchase with full royalty cascade.
 *
 * Fee breakdown:
 *   - Platform fee: 1.46%
 *   - Marketplace fee: 4%
 *   - Total fees: 5.46% (split 80/10/10)
 *   - Remaining 94.54% goes to creator minus cascade royalties
 *
 * Royalty cascade for derivatives:
 *   - Gen 0 (immediate parent): 21%
 *   - Gen 1: 10.5%
 *   - Gen 2: 5.25%
 *   - ... halves each generation, floor 0.05%
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.buyerId
 * @param {string} opts.artifactId
 */
export function purchaseArtifact(db, { buyerId, artifactId, tier, requestId, ip }) {
  ensureTierPricingColumn(db);

  if (!buyerId) return { ok: false, error: "missing_buyer_id" };
  if (!artifactId) return { ok: false, error: "missing_artifact_id" };

  const artifact = db.prepare(
    "SELECT * FROM creative_artifacts WHERE id = ? AND marketplace_status = 'active'"
  ).get(artifactId);

  if (!artifact) return { ok: false, error: "artifact_not_found_or_inactive" };
  if (artifact.creator_id === buyerId) return { ok: false, error: "cannot_buy_own_artifact" };

  // ── Resolve tier + price ────────────────────────────────────────────
  // Buyers pick which right they want at purchase time (download vs
  // usage vs commercial vs exclusive vs stems/source). If the listing
  // has per-tier prices, we look up that tier's price. Otherwise the
  // legacy single `price` applies and we map the listing's license_type
  // to a reasonable default tier.
  let tierPrices = null;
  try {
    if (artifact.tier_prices_json) tierPrices = JSON.parse(artifact.tier_prices_json);
  } catch { tierPrices = null; }

  const tierKey = _tierKeyForType(artifact.type);
  let resolvedTier = tier || null;
  let tierPrice = null;

  if (tierPrices && Object.keys(tierPrices).length > 0) {
    // Per-tier priced listing — buyer MUST pick a tier.
    if (!resolvedTier) {
      return {
        ok: false,
        error: "tier_required",
        message: "This listing offers per-tier pricing — specify which tier you want to buy.",
        availableTiers: Object.keys(tierPrices),
      };
    }
    if (!(resolvedTier in tierPrices)) {
      return {
        ok: false,
        error: "unknown_tier",
        availableTiers: Object.keys(tierPrices),
      };
    }
    if (tierKey && !getLicenseTier(tierKey, resolvedTier)) {
      return { ok: false, error: "invalid_tier_for_content_type", contentType: artifact.type, tier: resolvedTier };
    }
    tierPrice = tierPrices[resolvedTier];
    if (typeof tierPrice !== "number" || tierPrice < 0) {
      return { ok: false, error: "invalid_tier_price" };
    }
  } else {
    // Legacy single-price listing.
    resolvedTier = resolvedTier || artifact.license_type || "standard";
    tierPrice = artifact.price;
  }

  // Check buyer hasn't already purchased THIS SPECIFIC TIER. Same
  // buyer can still upgrade from e.g. `download` to `commercial` by
  // buying the higher tier separately (the rights-enforcement layer
  // already handles hierarchical access).
  const existingLicense = db.prepare(
    "SELECT id, license_type FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ? AND status = 'active' AND license_type = ?"
  ).get(artifactId, buyerId, resolvedTier);
  if (existingLicense) return { ok: false, error: "already_licensed", tier: resolvedTier };

  // Exclusive is still a one-holder-ever constraint
  if (resolvedTier === "exclusive" || artifact.license_type === "exclusive") {
    const exclusiveHolder = db.prepare(
      "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND license_type = 'exclusive' AND status = 'active'"
    ).get(artifactId);
    if (exclusiveHolder) return { ok: false, error: "exclusive_license_already_held" };
  }

  // Wash trade prevention
  const washCheck = checkWashTrade(db, buyerId, artifact.creator_id, artifactId);
  if (!washCheck.ok) return washCheck;

  const price = tierPrice;
  if (!price || price < 0) return { ok: false, error: "invalid_price" };

  // Validate buyer has sufficient balance before proceeding
  const balanceCheck = validateBalance(db, buyerId, price);
  if (!balanceCheck.ok) return balanceCheck;

  const purchaseId = uid("cap");

  // Calculate fees
  const platformFee = Math.round(price * CREATIVE_MARKETPLACE.PLATFORM_FEE_RATE * 100) / 100;
  const marketplaceFee = Math.round(price * CREATIVE_MARKETPLACE.MARKETPLACE_FEE_RATE * 100) / 100;
  const totalFees = Math.round((platformFee + marketplaceFee) * 100) / 100;
  const remainingAfterFees = Math.round((price - totalFees) * 100) / 100;

  // Calculate cascade payments for derivatives
  let cascadePayments = [];
  let totalCascade = 0;

  // Seller protection: royalties never exceed 30% of sale price
  // Seller always keeps at least 64.54% (100% - 5.46% fees - 30% max royalties)
  const MAX_ROYALTY_RATE = 0.30;
  const maxRoyaltyPool = Math.round(price * MAX_ROYALTY_RATE * 100) / 100;

  if (artifact.is_derivative) {
    cascadePayments = calculateCascadePayments(db, artifactId, remainingAfterFees);
    // Anti-gaming: filter out self-citing (creator earning royalties on their own chain)
    cascadePayments = cascadePayments.filter(p => p.recipientId !== artifact.creator_id && p.recipientId !== buyerId);

    // Apply 30% cap — trim payments from deepest generation first
    cascadePayments.sort((a, b) => a.generation - b.generation); // pay closest ancestors first
    let capped = 0;
    cascadePayments = cascadePayments.filter(p => {
      if (capped + p.amount > maxRoyaltyPool) {
        const remaining = Math.round((maxRoyaltyPool - capped) * 100) / 100;
        if (remaining >= 0.01) {
          p.amount = remaining;
          capped += remaining;
          return true;
        }
        return false; // drop this payment
      }
      capped += p.amount;
      return true;
    });

    totalCascade = Math.round(cascadePayments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  }

  // Concord 30/70 split for emergent-created content
  const concordSplit = calculateConcordSplit(db, artifact, remainingAfterFees);
  let concordDeduction = 0;
  if (concordSplit) {
    // Concord split also counts against the 30% cap
    let concordAllowance = Math.round((maxRoyaltyPool - totalCascade) * 100) / 100;
    if (concordAllowance > 0) {
      concordDeduction = Math.min(concordSplit.totalConcordRoyalty, concordAllowance);
      // Proportionally adjust passthrough payments if capped
      const ratio = concordDeduction / (concordSplit.totalConcordRoyalty || 1);
      for (const pp of concordSplit.passthroughPayments) {
        cascadePayments.push({
          recipientId: pp.recipientId,
          recipientArtifactId: pp.contentId,
          amount: Math.round(pp.amount * ratio * 100) / 100,
          generation: 0,
          rate: 0.21,
          reason: "concord_passthrough",
        });
      }
      totalCascade = Math.round((totalCascade + concordDeduction) * 100) / 100;
    }
  }

  const creatorEarnings = Math.round((remainingAfterFees - totalCascade) * 100) / 100;

  // Execute atomically
  const doPurchase = db.transaction(() => {
    // Re-check balance inside transaction to prevent race conditions
    const txBalanceCheck = validateBalance(db, buyerId, price);
    if (!txBalanceCheck.ok) throw new Error(`insufficient_balance:${txBalanceCheck.balance}:${price}`);

    // Re-check exclusive availability inside transaction (race condition guard)
    // Two users clicking "Buy" at the same millisecond: second one gets "already sold"
    if (artifact.license_type === "exclusive") {
      const exclusiveHeld = db.prepare(
        "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND license_type = 'exclusive' AND status = 'active'"
      ).get(artifactId);
      if (exclusiveHeld) throw new Error("exclusive_already_sold");
    }

    const batchId = generateTxId();
    const now = nowISO();
    const entries = [];

    // 1. Buyer pays platform
    entries.push({
      id: generateTxId(),
      type: "MARKETPLACE_PURCHASE",
      from: buyerId,
      to: PLATFORM_ACCOUNT_ID,
      amount: price,
      fee: totalFees,
      net: remainingAfterFees,
      status: "complete",
      refId: `creative:${purchaseId}`,
      metadata: { batchId, role: "creative_purchase", artifactId, purchaseId },
      requestId, ip,
    });

    // 2. Platform credits creator (after fees and cascade)
    entries.push({
      id: generateTxId(),
      type: "MARKETPLACE_PURCHASE",
      from: PLATFORM_ACCOUNT_ID,
      to: artifact.creator_id,
      amount: creatorEarnings,
      fee: 0,
      net: creatorEarnings,
      status: "complete",
      refId: `creative_seller:${purchaseId}`,
      metadata: {
        batchId, role: "creative_seller_credit", artifactId, purchaseId,
        grossPrice: price, fees: totalFees, cascadePaid: totalCascade,
      },
      requestId, ip,
    });

    // 3. Cascade royalty payments
    for (const payment of cascadePayments) {
      entries.push({
        id: generateTxId(),
        type: "ROYALTY",
        from: PLATFORM_ACCOUNT_ID,
        to: payment.recipientId,
        amount: payment.amount,
        fee: 0,
        net: payment.amount,
        status: "complete",
        refId: `creative_royalty:${purchaseId}:${payment.recipientArtifactId}`,
        metadata: {
          batchId, role: "creative_royalty_cascade",
          artifactId, purchaseId,
          generation: payment.generation,
          rate: payment.rate,
          recipientArtifactId: payment.recipientArtifactId,
        },
        requestId, ip,
      });
    }

    // 3b. Concord keeps (9% of sale for emergent-created content)
    if (concordSplit && concordSplit.concordKeeps > 0) {
      entries.push({
        id: generateTxId(),
        type: "CONCORD_ROYALTY",
        from: PLATFORM_ACCOUNT_ID,
        to: "__CONCORD__",
        amount: concordSplit.concordKeeps,
        fee: 0,
        net: concordSplit.concordKeeps,
        status: "complete",
        refId: `concord_royalty:${purchaseId}`,
        metadata: {
          batchId, role: "concord_keeps",
          artifactId, purchaseId,
          totalConcordRoyalty: concordSplit.totalConcordRoyalty,
          passthroughToCreators: concordSplit.passthroughPayments.reduce((s, p) => s + p.amount, 0),
        },
        requestId, ip,
      });
    }

    const results = recordTransactionBatch(db, entries);

    // 4. Record cascade in immutable ledger
    for (const payment of cascadePayments) {
      db.prepare(`
        INSERT INTO creative_royalty_cascade_ledger (
          id, triggering_purchase_id, triggering_artifact_id,
          recipient_id, recipient_artifact_id,
          generation, rate, amount,
          federation_tier, regional, national, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid("crcl"), purchaseId, artifactId,
        payment.recipientId, payment.recipientArtifactId,
        payment.generation, payment.rate, payment.amount,
        artifact.federation_tier,
        artifact.location_regional, artifact.location_national,
        now,
      );
    }

    // 5. Grant usage license — for the specific tier the buyer purchased.
    //    We write to BOTH license tables so every downstream checker
    //    (creative-marketplace derivative gate AND rights-enforcement
    //    checkAccess / downloadGuard / streamingGuard) sees the
    //    entitlement, regardless of which one it queries.
    db.prepare(`
      INSERT INTO creative_usage_licenses (
        id, artifact_id, licensee_id, license_type,
        status, purchase_price, purchase_id, granted_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(uid("cul"), artifactId, buyerId, resolvedTier, price, purchaseId, now);

    // Mirror into dtu_licenses (the rights-enforcement table). Using the
    // creative_artifact id as dtu_id here — they are the same identity
    // in the DTU lattice. content_type is normalized to lowercase to
    // match the TIER_HIERARCHY map in rights-enforcement.js.
    try {
      grantDtuLicense(db, {
        dtuId: artifactId,
        userId: buyerId,
        contentType: String(artifact.type || "").toLowerCase(),
        licenseTier: resolvedTier,
        txId: purchaseId,
        expiresAt: null,
      });
    } catch (e) {
      // Don't roll back the purchase if the mirror write fails —
      // creative_usage_licenses is still authoritative for this flow.
      console.error("[economy] grantDtuLicense mirror failed:", e?.message);
    }

    // 6. Update artifact stats + auto-delist exclusive items
    if (artifact.license_type === "exclusive") {
      db.prepare(`
        UPDATE creative_artifacts
        SET purchase_count = purchase_count + 1, marketplace_status = 'delisted', updated_at = ?
        WHERE id = ?
      `).run(now, artifactId);
    } else {
      db.prepare(`
        UPDATE creative_artifacts
        SET purchase_count = purchase_count + 1, updated_at = ?
        WHERE id = ?
      `).run(now, artifactId);
    }

    // 7. Distribute fees through 80/10/10 split
    distributeFee(db, {
      feeAmount: totalFees,
      sourceTxId: batchId,
      refId: `creative_fee:${purchaseId}`,
      requestId, ip,
    });

    return { batchId, results };
  });

  try {
    const { batchId } = doPurchase();

    economyAudit(db, {
      action: "creative_artifact_purchase",
      userId: buyerId,
      amount: price,
      txId: batchId,
      details: {
        purchaseId, artifactId,
        sellerId: artifact.creator_id,
        fees: totalFees,
        creatorEarnings,
        cascadeTotal: totalCascade,
        cascadePayments: cascadePayments.length,
      },
      requestId, ip,
    });

    return {
      ok: true,
      purchaseId,
      artifactId,
      buyerId,
      sellerId: artifact.creator_id,
      price,
      fees: totalFees,
      creatorEarnings,
      cascade: {
        total: totalCascade,
        payments: cascadePayments,
      },
      batchId,
    };
  } catch (err) {
    // Surface specific race-condition errors to callers
    if (err.message?.startsWith("insufficient_balance:")) {
      return { ok: false, error: "insufficient_balance" };
    }
    if (err.message === "exclusive_already_sold") {
      return { ok: false, error: "exclusive_license_already_held" };
    }
    console.error("[economy] purchase_failed:", err.message);
    return { ok: false, error: "purchase_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WASH TRADE PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Block wash trading patterns between buyer-seller pairs.
 *
 * 1. Ping-pong: Same artifact sold back and forth within 30 days → reject
 * 2. Excessive pair trading: >3 transactions between same pair in 7 days → reject
 */
function checkWashTrade(db, buyerId, sellerId, artifactId) {
  // Ping-pong: has buyer previously sold this exact artifact TO the seller?
  const pingPong = db.prepare(`
    SELECT COUNT(*) AS c FROM economy_ledger
    WHERE type = 'MARKETPLACE_PURCHASE'
      AND from_user_id = ?
      AND to_user_id = ?
      AND metadata_json LIKE ?
      AND created_at > datetime('now', '-30 days')
  `).get(sellerId, buyerId, `%"artifactId":"${artifactId}"%`)?.c || 0;

  if (pingPong > 0) {
    return {
      ok: false,
      error: "wash_trade_detected",
      detail: "This artifact was recently traded between these accounts.",
    };
  }

  // Excessive pair trading: >3 transactions between same pair in 7 days
  const pairCount = db.prepare(`
    SELECT COUNT(*) AS c FROM economy_ledger
    WHERE type = 'MARKETPLACE_PURCHASE'
      AND (
        (from_user_id = ? AND to_user_id = ?)
        OR (from_user_id = ? AND to_user_id = ?)
      )
      AND created_at > datetime('now', '-7 days')
  `).get(buyerId, sellerId, sellerId, buyerId)?.c || 0;

  if (pairCount > 3) {
    return {
      ok: false,
      error: "excessive_pair_trading",
      detail: "Too many transactions between this buyer-seller pair in the last 7 days.",
    };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONCORD 30/70 ROYALTY SPLIT (Emergent-Created Content)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * When a Concord emergent creates a DTU that gets sold:
 * - Concord receives 30% royalty on the sale (from seller's share)
 * - 70% of that (21% of sale) flows to human creators whose work was cited
 * - Concord keeps 30% of that (9% of sale)
 *
 * This is the mechanism that pays creators for feeding the emergents.
 *
 * @param {object} db
 * @param {object} artifact - the artifact being sold
 * @param {number} remainingAfterFees - price minus platform/marketplace fees
 * @returns {{ concordKeeps: number, passthroughPayments: Array, totalConcordRoyalty: number }}
 */
function calculateConcordSplit(db, artifact, remainingAfterFees) {
  const CONCORD_ROYALTY_RATE = 0.30;
  const CONCORD_PASSTHROUGH_RATE = 0.70;

  // Check if creator is an emergent/system entity
  const creatorId = artifact.creator_id || "";
  const isEmergent = creatorId.startsWith("ent_") || creatorId.startsWith("__") || creatorId === "__CONCORD__";

  if (!isEmergent) return null; // Not emergent-created, skip

  const concordRoyalty = Math.round(remainingAfterFees * CONCORD_ROYALTY_RATE * 100) / 100;
  const passthroughTotal = Math.round(concordRoyalty * CONCORD_PASSTHROUGH_RATE * 100) / 100;
  const concordKeeps = Math.round((concordRoyalty - passthroughTotal) * 100) / 100;

  // Find cited human creators from lineage
  const citations = db.prepare(`
    SELECT parent_id, parent_creator FROM royalty_lineage
    WHERE child_id = ? AND parent_creator NOT LIKE 'ent_%' AND parent_creator != '__CONCORD__' AND parent_creator != 'system'
  `).all(artifact.dtu_id || artifact.id);

  if (citations.length === 0) {
    // Emergent with no human citations — Concord keeps full 30%
    return {
      concordKeeps: concordRoyalty,
      passthroughPayments: [],
      totalConcordRoyalty: concordRoyalty,
    };
  }

  // Distribute passthrough proportionally among cited human creators
  const perCreator = Math.round((passthroughTotal / citations.length) * 100) / 100;
  const passthroughPayments = citations.map(c => ({
    recipientId: c.parent_creator,
    contentId: c.parent_id,
    amount: perCreator,
    reason: "concord_passthrough",
  }));

  // Adjust rounding: give any remaining cents to first creator
  const distributed = passthroughPayments.reduce((s, p) => s + p.amount, 0);
  const rounding = Math.round((passthroughTotal - distributed) * 100) / 100;
  if (rounding > 0 && passthroughPayments.length > 0) {
    passthroughPayments[0].amount = Math.round((passthroughPayments[0].amount + rounding) * 100) / 100;
  }

  return {
    concordKeeps,
    passthroughPayments,
    totalConcordRoyalty: concordRoyalty,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROYALTY CASCADE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate cascade payments for all ancestors of a derivative artifact.
 * Walks up the lineage tree, halving royalty rate each generation.
 */
function calculateCascadePayments(db, artifactId, remainingAfterFees) {
  const payments = [];
  const visited = new Set();

  // Get all direct parents
  const parents = db.prepare(
    "SELECT parent_artifact_id, derivative_type FROM creative_artifact_derivatives WHERE child_artifact_id = ?"
  ).all(artifactId);

  for (const parent of parents) {
    walkAncestors(db, parent.parent_artifact_id, 0, remainingAfterFees, payments, visited);
  }

  return payments;
}

/**
 * Recursively walk up the lineage tree, calculating royalties for each ancestor.
 */
function walkAncestors(db, currentArtifactId, generation, remainingAfterFees, payments, visited) {
  if (generation > CREATIVE_MARKETPLACE.MAX_CASCADE_DEPTH) return;
  if (visited.has(currentArtifactId)) return;
  visited.add(currentArtifactId);

  const current = db.prepare(
    "SELECT id, creator_id, is_derivative FROM creative_artifacts WHERE id = ?"
  ).get(currentArtifactId);

  if (!current) return;

  const royaltyRate = Math.max(
    CREATIVE_MARKETPLACE.INITIAL_ROYALTY_RATE / Math.pow(CREATIVE_MARKETPLACE.ROYALTY_HALVING, generation),
    CREATIVE_MARKETPLACE.ROYALTY_FLOOR,
  );
  const royaltyAmount = Math.round(remainingAfterFees * royaltyRate * 100) / 100;

  if (royaltyAmount >= 0.01) {
    payments.push({
      recipientId: current.creator_id,
      recipientArtifactId: current.id,
      amount: royaltyAmount,
      generation,
      rate: royaltyRate,
    });
  }

  // If this ancestor is also a derivative, walk further up
  if (current.is_derivative) {
    const grandparents = db.prepare(
      "SELECT parent_artifact_id FROM creative_artifact_derivatives WHERE child_artifact_id = ?"
    ).all(current.id);

    for (const gp of grandparents) {
      walkAncestors(db, gp.parent_artifact_id, generation + 1, remainingAfterFees, payments, visited);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a single artifact by ID.
 */
export function getArtifact(db, artifactId) {
  const row = db.prepare("SELECT * FROM creative_artifacts WHERE id = ?").get(artifactId);
  if (!row) return null;
  return formatArtifact(row);
}

/**
 * Search/browse creative artifacts on the marketplace.
 */
export function searchArtifacts(db, {
  type, genre, creatorId, federationTier, locationRegional, locationNational,
  minPrice, maxPrice, minRating, status = "active",
  sortBy = "newest", limit = 50, offset = 0,
} = {}) {
  let sql = "SELECT * FROM creative_artifacts WHERE 1=1";
  const params = [];

  if (status) { sql += " AND marketplace_status = ?"; params.push(status); }
  if (type) { sql += " AND type = ?"; params.push(type); }
  if (genre) { sql += " AND genre = ?"; params.push(genre); }
  if (creatorId) { sql += " AND creator_id = ?"; params.push(creatorId); }
  if (federationTier) { sql += " AND federation_tier = ?"; params.push(federationTier); }
  if (locationRegional) { sql += " AND location_regional = ?"; params.push(locationRegional); }
  if (locationNational) { sql += " AND location_national = ?"; params.push(locationNational); }
  if (minPrice != null) { sql += " AND price >= ?"; params.push(minPrice); }
  if (maxPrice != null) { sql += " AND price <= ?"; params.push(maxPrice); }
  if (minRating != null) { sql += " AND rating >= ?"; params.push(minRating); }

  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  const orderMap = {
    newest: "created_at DESC",
    oldest: "created_at ASC",
    most_sold: "purchase_count DESC",
    highest_rated: "rating DESC",
    most_derivatives: "derivative_count DESC",
    price_low: "price ASC",
    price_high: "price DESC",
  };
  sql += ` ORDER BY ${orderMap[sortBy] || "created_at DESC"} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(formatArtifact);
  return { items, total, limit, offset };
}

/**
 * Discover local artists in a region.
 */
export function discoverLocalArtists(db, { userId, artifactType, genre, sortBy = "trending", limit = 20 }) {
  const user = db.prepare("SELECT declared_regional FROM users WHERE id = ?").get(userId);
  if (!user?.declared_regional) return { ok: false, error: "user_has_no_declared_region" };

  let sql = `
    SELECT
      u.id as artist_id,
      u.username as display_name,
      u.declared_regional,
      COUNT(DISTINCT a.id) as total_artifacts,
      COALESCE(SUM(a.purchase_count), 0) as total_sales,
      COALESCE(AVG(CASE WHEN a.rating > 0 THEN a.rating END), 0) as avg_rating,
      COALESCE(SUM(a.derivative_count), 0) as total_derivatives
    FROM users u
    JOIN creative_artifacts a ON a.creator_id = u.id
    WHERE u.declared_regional = ?
      AND a.federation_tier IN ('regional', 'national', 'global')
      AND a.marketplace_status = 'active'
  `;
  const params = [user.declared_regional];

  if (artifactType) { sql += " AND a.type = ?"; params.push(artifactType); }
  if (genre) { sql += " AND a.genre = ?"; params.push(genre); }

  sql += " GROUP BY u.id";

  const sortMap = {
    trending: "total_sales DESC",
    newest: "MAX(a.created_at) DESC",
    most_sold: "total_sales DESC",
    highest_rated: "avg_rating DESC",
  };
  sql += ` ORDER BY ${sortMap[sortBy] || "total_sales DESC"} LIMIT ?`;
  params.push(limit);

  const artists = db.prepare(sql).all(...params);
  return { ok: true, artists, region: user.declared_regional };
}

/**
 * Browse artifacts from a specific region (e.g., leaderboard winner region).
 */
export function browseRegionArt(db, { regionalId, artifactType, sortBy = "most_sold", limit = 50 }) {
  let sql = `
    SELECT a.*, u.username as artist_name, u.declared_regional
    FROM creative_artifacts a
    JOIN users u ON a.creator_id = u.id
    WHERE u.declared_regional = ?
      AND a.marketplace_status = 'active'
      AND a.dedup_verified = 1
  `;
  const params = [regionalId];

  if (artifactType) { sql += " AND a.type = ?"; params.push(artifactType); }

  const sortMap = {
    most_sold: "a.purchase_count DESC",
    newest: "a.created_at DESC",
    highest_rated: "a.rating DESC",
    most_derivatives: "a.derivative_count DESC",
  };
  sql += ` ORDER BY ${sortMap[sortBy] || "a.purchase_count DESC"} LIMIT ?`;
  params.push(limit);

  const items = db.prepare(sql).all(...params).map(formatArtifact);
  return { ok: true, items, regionalId };
}

// ═══════════════════════════════════════════════════════════════════════════
// DERIVATIVE TREE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the full derivative tree for an artifact.
 * Returns both ancestors (parents up) and descendants (children down).
 */
export function getDerivativeTree(db, artifactId) {
  const artifact = db.prepare("SELECT * FROM creative_artifacts WHERE id = ?").get(artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };

  // Ancestors (walk up)
  const ancestors = [];
  const ancestorVisited = new Set();
  walkUp(db, artifactId, 0, ancestors, ancestorVisited);

  // Descendants (walk down)
  const descendants = [];
  const descendantVisited = new Set();
  walkDown(db, artifactId, 0, descendants, descendantVisited);

  return {
    ok: true,
    artifactId,
    ancestors,
    descendants,
    lineageDepth: artifact.lineage_depth,
  };
}

function walkUp(db, currentId, generation, results, visited) {
  if (visited.has(currentId)) return;
  visited.add(currentId);

  const parents = db.prepare(`
    SELECT cad.parent_artifact_id, cad.derivative_type, cad.generation,
           ca.creator_id, ca.title, ca.type
    FROM creative_artifact_derivatives cad
    JOIN creative_artifacts ca ON ca.id = cad.parent_artifact_id
    WHERE cad.child_artifact_id = ?
  `).all(currentId);

  for (const p of parents) {
    results.push({
      artifactId: p.parent_artifact_id,
      creatorId: p.creator_id,
      title: p.title,
      type: p.type,
      derivativeType: p.derivative_type,
      generation: generation + 1,
    });
    walkUp(db, p.parent_artifact_id, generation + 1, results, visited);
  }
}

function walkDown(db, currentId, generation, results, visited) {
  if (visited.has(currentId)) return;
  visited.add(currentId);

  const children = db.prepare(`
    SELECT cad.child_artifact_id, cad.derivative_type,
           ca.creator_id, ca.title, ca.type
    FROM creative_artifact_derivatives cad
    JOIN creative_artifacts ca ON ca.id = cad.child_artifact_id
    WHERE cad.parent_artifact_id = ?
  `).all(currentId);

  for (const c of children) {
    results.push({
      artifactId: c.child_artifact_id,
      creatorId: c.creator_id,
      title: c.title,
      type: c.type,
      derivativeType: c.derivative_type,
      generation: generation + 1,
    });
    walkDown(db, c.child_artifact_id, generation + 1, results, visited);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate an artifact. Only buyers who have a usage license can rate.
 */
export function rateArtifact(db, { artifactId, raterId, rating, review }) {
  if (!artifactId) return { ok: false, error: "missing_artifact_id" };
  if (!raterId) return { ok: false, error: "missing_rater_id" };
  if (!rating || rating < 1 || rating > 5) return { ok: false, error: "invalid_rating", validRange: "1-5" };

  // Check rater has license (purchased the artifact)
  const hasLicense = db.prepare(
    "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ?"
  ).get(artifactId, raterId);

  if (!hasLicense) return { ok: false, error: "must_purchase_before_rating" };

  // Check not already rated
  const existing = db.prepare(
    "SELECT id FROM creative_artifact_ratings WHERE artifact_id = ? AND rater_id = ?"
  ).get(artifactId, raterId);

  if (existing) return { ok: false, error: "already_rated" };

  const now = nowISO();
  db.prepare(`
    INSERT INTO creative_artifact_ratings (id, artifact_id, rater_id, rating, review, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid("car"), artifactId, raterId, rating, review || null, now);

  // Update artifact aggregate rating
  const stats = db.prepare(`
    SELECT AVG(rating) as avg_rating, COUNT(*) as count
    FROM creative_artifact_ratings WHERE artifact_id = ?
  `).get(artifactId);

  db.prepare(`
    UPDATE creative_artifacts SET rating = ?, rating_count = ?, updated_at = ? WHERE id = ?
  `).run(Math.round(stats.avg_rating * 100) / 100, stats.count, now, artifactId);

  return { ok: true, artifactId, rating, avgRating: stats.avg_rating, totalRatings: stats.count };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTION THROUGH TIERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if an artifact is eligible for promotion to the next tier.
 */
export function checkArtifactPromotionEligibility(db, artifactId) {
  const artifact = db.prepare("SELECT * FROM creative_artifacts WHERE id = ?").get(artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };

  const tier = artifact.federation_tier;
  const checks = {};

  if (tier === "regional") {
    const promo = CREATIVE_FEDERATION.regional.promotionToNational;
    checks.minPurchases = { required: promo.minPurchases, actual: artifact.purchase_count, met: artifact.purchase_count >= promo.minPurchases };
    checks.minDerivatives = { required: promo.minDerivatives, actual: artifact.derivative_count, met: artifact.derivative_count >= promo.minDerivatives };
    checks.minRating = { required: promo.minRating, actual: artifact.rating, met: artifact.rating >= promo.minRating };

    const ageHours = (Date.now() - new Date(artifact.created_at).getTime()) / 3600000;
    checks.minAgeHours = { required: promo.minAgeHours, actual: Math.floor(ageHours), met: ageHours >= promo.minAgeHours };
  } else if (tier === "national") {
    const promo = CREATIVE_FEDERATION.national.promotionToGlobal;
    checks.minPurchases = { required: promo.minPurchases, actual: artifact.purchase_count, met: artifact.purchase_count >= promo.minPurchases };
    checks.minDerivatives = { required: promo.minDerivatives, actual: artifact.derivative_count, met: artifact.derivative_count >= promo.minDerivatives };
    checks.minRating = { required: promo.minRating, actual: artifact.rating, met: artifact.rating >= promo.minRating };

    const ageDays = (Date.now() - new Date(artifact.created_at).getTime()) / 86400000;
    checks.minAgeDays = { required: promo.minAgeDays, actual: Math.floor(ageDays), met: ageDays >= promo.minAgeDays };

    // Cross-regional presence check
    const crossRegional = db.prepare(`
      SELECT COUNT(DISTINCT u.declared_regional) as regions
      FROM creative_usage_licenses l
      JOIN users u ON u.id = l.licensee_id
      WHERE l.artifact_id = ?
    `).get(artifactId);
    checks.crossRegionalPresence = {
      required: promo.minCrossRegionalPresence,
      actual: crossRegional?.regions || 0,
      met: (crossRegional?.regions || 0) >= promo.minCrossRegionalPresence,
    };
  } else if (tier === "global") {
    return { ok: true, eligible: false, reason: "already_global", checks: {} };
  }

  const eligible = Object.values(checks).every(c => c.met);
  return { ok: true, artifactId, currentTier: tier, eligible, checks };
}

/**
 * Promote an artifact to the next federation tier.
 */
export function promoteArtifact(db, { artifactId, promotedBy }) {
  const eligibility = checkArtifactPromotionEligibility(db, artifactId);
  if (!eligibility.ok) return eligibility;
  if (!eligibility.eligible) return { ok: false, error: "not_eligible", checks: eligibility.checks };

  const tierMap = { regional: "national", national: "global" };
  const newTier = tierMap[eligibility.currentTier];
  if (!newTier) return { ok: false, error: "cannot_promote_beyond_global" };

  const now = nowISO();
  db.prepare(
    "UPDATE creative_artifacts SET federation_tier = ?, updated_at = ? WHERE id = ?"
  ).run(newTier, now, artifactId);

  return {
    ok: true,
    artifactId,
    previousTier: eligibility.currentTier,
    newTier,
    promotedBy,
    promotedAt: now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATIVE XP & QUESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Award creative XP to a user. No coins — XP and badges only.
 */
export function awardCreativeXP(db, { userId, federationTier, regional, national, xpAmount, season }) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  if (!federationTier) return { ok: false, error: "missing_federation_tier" };
  if (!xpAmount || xpAmount <= 0) return { ok: false, error: "invalid_xp_amount" };

  const now = nowISO();

  db.prepare(`
    INSERT INTO creative_xp (user_id, federation_tier, regional, national, total_xp, level, season, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (user_id, federation_tier, regional, national, season)
    DO UPDATE SET
      total_xp = total_xp + ?,
      updated_at = ?
  `).run(userId, federationTier, regional || "", national || "", xpAmount, season || "", now, xpAmount, now);

  // Get updated XP and calculate level
  const row = db.prepare(`
    SELECT total_xp FROM creative_xp
    WHERE user_id = ? AND federation_tier = ?
      AND regional = ? AND national = ? AND season = ?
  `).get(userId, federationTier, regional || "", national || "", season || "");

  const totalXP = row?.total_xp || xpAmount;
  const level = calculateCreativeLevel(totalXP);

  db.prepare(`
    UPDATE creative_xp SET level = ?
    WHERE user_id = ? AND federation_tier = ?
      AND regional = ? AND national = ? AND season = ?
  `).run(level, userId, federationTier, regional || "", national || "", season || "");

  return { ok: true, userId, totalXP, level, xpAwarded: xpAmount };
}

/**
 * Complete a creative quest. Awards XP and badge — never coins.
 */
export function completeCreativeQuest(db, { userId, questId, federationTier, regional, national }) {
  if (!userId || !questId || !federationTier) {
    return { ok: false, error: "missing_required_fields" };
  }

  // Find quest definition
  const tierQuests = CREATIVE_QUESTS[federationTier];
  if (!tierQuests) return { ok: false, error: "invalid_federation_tier" };

  const questDef = tierQuests.find(q => q.id === questId);
  if (!questDef) return { ok: false, error: "quest_not_found", questId };

  // Check not already completed
  const existing = db.prepare(
    "SELECT id FROM creative_quest_completions WHERE user_id = ? AND quest_id = ? AND federation_tier = ?"
  ).get(userId, questId, federationTier);

  if (existing) return { ok: false, error: "quest_already_completed" };

  const now = nowISO();

  // Record completion (no coin_awarded field — constitutional invariant)
  db.prepare(`
    INSERT INTO creative_quest_completions (id, user_id, quest_id, federation_tier, regional, national, xp_awarded, badge_awarded, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid("cqc"), userId, questId, federationTier, regional || null, national || null, questDef.xpReward, questDef.badge, now);

  // Award XP
  awardCreativeXP(db, {
    userId, federationTier, regional, national,
    xpAmount: questDef.xpReward,
  });

  return {
    ok: true,
    userId, questId,
    xpAwarded: questDef.xpReward,
    badgeAwarded: questDef.badge,
    completedAt: now,
  };
}

/**
 * Get creative XP for a user.
 */
export function getCreativeXP(db, { userId, federationTier, regional, national, season }) {
  const row = db.prepare(`
    SELECT * FROM creative_xp
    WHERE user_id = ? AND federation_tier = ?
      AND regional = ? AND national = ? AND season = ?
  `).get(userId, federationTier, regional || "", national || "", season || "");

  if (!row) return { ok: true, userId, totalXP: 0, level: 1 };
  return { ok: true, userId, totalXP: row.total_xp, level: row.level };
}

/**
 * Get creative quest completions for a user.
 */
export function getCreativeQuestCompletions(db, { userId, federationTier }) {
  let sql = "SELECT * FROM creative_quest_completions WHERE user_id = ?";
  const params = [userId];
  if (federationTier) { sql += " AND federation_tier = ?"; params.push(federationTier); }
  sql += " ORDER BY completed_at DESC";

  const items = db.prepare(sql).all(...params);
  return { ok: true, items, count: items.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// USAGE LICENSE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all active licenses for an artifact.
 */
export function getArtifactLicenses(db, artifactId) {
  const licenses = db.prepare(
    "SELECT * FROM creative_usage_licenses WHERE artifact_id = ? ORDER BY granted_at DESC"
  ).all(artifactId);
  return { ok: true, licenses };
}

/**
 * Get all licenses held by a user.
 */
export function getUserLicenses(db, userId) {
  const licenses = db.prepare(`
    SELECT l.*, a.title, a.type, a.creator_id
    FROM creative_usage_licenses l
    JOIN creative_artifacts a ON a.id = l.artifact_id
    WHERE l.licensee_id = ?
    ORDER BY l.granted_at DESC
  `).all(userId);
  return { ok: true, licenses };
}

// ═══════════════════════════════════════════════════════════════════════════
// CASCADE EARNINGS QUERY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get total cascade royalty earnings for an artifact.
 */
export function getArtifactCascadeEarnings(db, artifactId) {
  const earnings = db.prepare(`
    SELECT
      recipient_id,
      SUM(amount) as total_earned,
      COUNT(*) as payment_count,
      MIN(generation) as closest_generation,
      MAX(generation) as furthest_generation
    FROM creative_royalty_cascade_ledger
    WHERE recipient_artifact_id = ?
    GROUP BY recipient_id
    ORDER BY total_earned DESC
  `).all(artifactId);

  const totalEarned = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM creative_royalty_cascade_ledger WHERE recipient_artifact_id = ?"
  ).get(artifactId)?.total || 0;

  return { ok: true, artifactId, totalEarned, recipients: earnings };
}

/**
 * Get total cascade earnings for a creator across all their artifacts.
 */
export function getCreatorCascadeEarnings(db, creatorId) {
  const earnings = db.prepare(`
    SELECT
      recipient_artifact_id,
      SUM(amount) as total_earned,
      COUNT(*) as payment_count
    FROM creative_royalty_cascade_ledger
    WHERE recipient_id = ?
    GROUP BY recipient_artifact_id
    ORDER BY total_earned DESC
  `).all(creatorId);

  const totalEarned = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM creative_royalty_cascade_ledger WHERE recipient_id = ?"
  ).get(creatorId)?.total || 0;

  return { ok: true, creatorId, totalEarned, byArtifact: earnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pause a marketplace listing (creator action).
 */
export function pauseArtifact(db, { artifactId, creatorId }) {
  const artifact = db.prepare(
    "SELECT * FROM creative_artifacts WHERE id = ? AND creator_id = ?"
  ).get(artifactId, creatorId);

  if (!artifact) return { ok: false, error: "artifact_not_found_or_not_owner" };
  if (artifact.marketplace_status !== "active") return { ok: false, error: "artifact_not_active" };

  db.prepare(
    "UPDATE creative_artifacts SET marketplace_status = 'paused', updated_at = ? WHERE id = ?"
  ).run(nowISO(), artifactId);
  return { ok: true, artifactId, status: "paused" };
}

/**
 * Resume a paused marketplace listing (creator action).
 */
export function resumeArtifact(db, { artifactId, creatorId }) {
  const artifact = db.prepare(
    "SELECT * FROM creative_artifacts WHERE id = ? AND creator_id = ?"
  ).get(artifactId, creatorId);

  if (!artifact) return { ok: false, error: "artifact_not_found_or_not_owner" };
  if (artifact.marketplace_status !== "paused") return { ok: false, error: "artifact_not_paused" };

  db.prepare(
    "UPDATE creative_artifacts SET marketplace_status = 'active', updated_at = ? WHERE id = ?"
  ).run(nowISO(), artifactId);
  return { ok: true, artifactId, status: "active" };
}

/**
 * Delist an artifact from the marketplace (creator action).
 * Existing licenses are honored — only prevents new purchases.
 */
export function delistArtifact(db, { artifactId, creatorId }) {
  const artifact = db.prepare(
    "SELECT * FROM creative_artifacts WHERE id = ? AND creator_id = ?"
  ).get(artifactId, creatorId);

  if (!artifact) return { ok: false, error: "artifact_not_found_or_not_owner" };
  if (artifact.marketplace_status === "delisted") return { ok: false, error: "already_delisted" };

  db.prepare(
    "UPDATE creative_artifacts SET marketplace_status = 'delisted', updated_at = ? WHERE id = ?"
  ).run(nowISO(), artifactId);
  return { ok: true, artifactId, status: "delisted" };
}

/**
 * Update artifact price (creator action).
 */
export function updateArtifactPrice(db, { artifactId, creatorId, newPrice }) {
  if (!newPrice || newPrice <= 0) return { ok: false, error: "invalid_price" };

  const artifact = db.prepare(
    "SELECT * FROM creative_artifacts WHERE id = ? AND creator_id = ?"
  ).get(artifactId, creatorId);

  if (!artifact) return { ok: false, error: "artifact_not_found_or_not_owner" };
  if (artifact.marketplace_status !== "active") return { ok: false, error: "artifact_not_active" };

  db.prepare(
    "UPDATE creative_artifacts SET price = ?, updated_at = ? WHERE id = ?"
  ).run(newPrice, nowISO(), artifactId);

  return { ok: true, artifactId, oldPrice: artifact.price, newPrice };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if adding a parent link would create a cycle.
 */
function wouldCreateCycle(db, childId, parentId) {
  const visited = new Set();
  const queue = [parentId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === childId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = db.prepare(
      "SELECT parent_artifact_id FROM creative_artifact_derivatives WHERE child_artifact_id = ?"
    ).all(current);

    for (const p of parents) {
      if (!visited.has(p.parent_artifact_id)) {
        queue.push(p.parent_artifact_id);
      }
    }

    if (visited.size > CREATIVE_MARKETPLACE.MAX_CASCADE_DEPTH) break;
  }

  return false;
}

/**
 * Calculate creative level from XP.
 */
function calculateCreativeLevel(totalXP) {
  const levels = [
    { level: 1, xpRequired: 0 },
    { level: 2, xpRequired: 100 },
    { level: 3, xpRequired: 350 },
    { level: 4, xpRequired: 800 },
    { level: 5, xpRequired: 2000 },
    { level: 6, xpRequired: 5000 },
    { level: 7, xpRequired: 12000 },
    { level: 8, xpRequired: 30000 },
    { level: 9, xpRequired: 75000 },
    { level: 10, xpRequired: 200000 },
  ];

  let currentLevel = 1;
  for (const l of levels) {
    if (totalXP >= l.xpRequired) currentLevel = l.level;
    else break;
  }
  return currentLevel;
}

/**
 * Format a raw DB row into a clean artifact object.
 */
function formatArtifact(row) {
  return {
    id: row.id,
    dtuId: row.dtu_id,
    creatorId: row.creator_id,
    type: row.type,
    title: row.title,
    description: row.description,
    tags: safeJsonParse(row.tags_json),
    genre: row.genre,
    medium: row.medium,
    language: row.language,
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    filePath: row.file_path,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    previewPath: row.preview_path,
    locationRegional: row.location_regional,
    locationNational: row.location_national,
    federationTier: row.federation_tier,
    licenseType: row.license_type,
    license: safeJsonParse(row.license_json),
    isDerivative: !!row.is_derivative,
    lineageDepth: row.lineage_depth,
    marketplaceStatus: row.marketplace_status,
    price: row.price,
    purchaseCount: row.purchase_count,
    derivativeCount: row.derivative_count,
    rating: row.rating,
    ratingCount: row.rating_count,
    dedupVerified: !!row.dedup_verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (err) { console.debug('[creative-marketplace] JSON parse failed', err?.message); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS RE-EXPORT (for route layer convenience)
// ═══════════════════════════════════════════════════════════════════════════

export {
  ARTIFACT_TYPES, CREATIVE_MARKETPLACE, CREATIVE_FEDERATION,
  CREATIVE_QUESTS, CREATIVE_LEADERBOARD, CREATOR_RIGHTS,
  LICENSE_TYPES,
};
