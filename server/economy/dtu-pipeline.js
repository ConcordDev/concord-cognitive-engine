// economy/dtu-pipeline.js
// One-click DTU creation/publication from any lens.
// Handles atomization, metadata tagging, CRETI scoring, marketplace listing,
// preview generation, and cross-lens citation registration.

import { randomUUID } from "crypto";
import { registerCitation } from "./royalty-cascade.js";
import { awardMeritCredit } from "./lens-economy-wiring.js";
import { canEmergentCiteUser } from "../lib/consent.js";
import { batchLookup } from "./_batch-lookup.js";

function uid(prefix = "dtu") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// DTU Tiers
const DTU_TIERS = {
  REGULAR: { maxSizeKb: 256, maxCitations: 50, label: "DTU" },
  MEGA:    { maxSizeKb: 10240, maxCitations: 500, label: "Mega DTU" },
  HYPER:   { maxSizeKb: 1048576, maxCitations: 10000, label: "Hyper DTU" },
  SHADOW:  { maxSizeKb: 64, maxCitations: 10, label: "Shadow DTU" },
};

// ═══════════════════════════════════════════════════════════════════════════
// EMERGENT CITATION ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build citation-compliant DTU params for emergent/system-generated content.
 *
 * Emergents can NEVER claim "original" when they consumed user DTUs as context.
 * The brain call's context window IS the citation list.
 *
 * @param {object} params - DTU creation params
 * @param {Array} contextDTUs - DTUs that were fed to the brain call
 * @returns {object} params with correct citationMode and citations
 */
export function enforceEmergentCitations(params, contextDTUs = [], db = null) {
  const userContextDTUs = (contextDTUs || []).filter(d => {
    if (!d || !d.id || !d.creator) return false;
    if (d.creator === "__CONCORD__" || d.creator === "system") return false;
    // Consent gate: only include DTUs from users who opted into emergent learning
    if (db && !canEmergentCiteUser(db, d.creator)) return false;
    return true;
  });

  if (userContextDTUs.length === 0) {
    // No user content referenced — system-generated original
    return { ...params, citationMode: "original", citations: [] };
  }

  // User content was consumed — mandatory citation
  return {
    ...params,
    citationMode: "citing",
    citations: userContextDTUs.map(d => ({
      parentId: d.id,
      parentCreatorId: d.creator,
      generation: 1,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DTU CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new DTU from any lens.
 * This is the universal "publish" action — turns any lens content into a
 * sellable, citable, forkable DTU.
 */
export function createDTU(db, {
  creatorId, title, content, contentType, lensId, tier = "REGULAR",
  tags = [], citations = [], price = 0, previewPolicy = "first_3",
  citationMode = "original", // "original" | "citing" | "derivative"
  metadata = {},
}) {
  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!title) return { ok: false, error: "missing_title" };
  if (!content) return { ok: false, error: "missing_content" };

  // Citation sovereignty: enforce citation mode rules
  const validModes = ["original", "citing", "derivative"];
  if (!validModes.includes(citationMode)) {
    return { ok: false, error: "invalid_citation_mode", validModes };
  }
  if (citationMode === "original" && citations.length > 0) {
    return { ok: false, error: "original_mode_cannot_have_citations" };
  }
  if (citationMode === "derivative" && citations.length === 0) {
    return { ok: false, error: "derivative_mode_requires_citations" };
  }

  const dtuId = uid("dtu");
  const now = nowISO();

  // Auto-detect tier based on content size
  const sizeKb = Buffer.byteLength(typeof content === "string" ? content : JSON.stringify(content)) / 1024;
  const effectiveTier = tier === "REGULAR" && sizeKb > DTU_TIERS.REGULAR.maxSizeKb ? "MEGA" : tier;

  // Compute initial CRETI score
  const cretiScore = computeInitialCRETI({
    contentLength: typeof content === "string" ? content.length : JSON.stringify(content).length,
    citationCount: citations.length,
    hasMetadata: Object.keys(metadata).length > 0,
    hasTags: tags.length > 0,
  });

  const doCreate = db.transaction(() => {
    // Insert DTU with citation mode (citations locked after publish)
    const dtuMetadata = {
      ...metadata,
      citationMode,
      citationLocked: true, // citations cannot be changed after publish
    };
    db.prepare(`
      INSERT INTO dtus (id, creator_id, title, content, content_type, lens_id,
        tier, tags_json, price, preview_policy, creti_score,
        size_kb, metadata_json, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?, ?)
    `).run(
      dtuId, creatorId, title,
      typeof content === "string" ? content : JSON.stringify(content),
      contentType || "text", lensId || "unknown", effectiveTier,
      JSON.stringify(tags), price, previewPolicy, cretiScore,
      Math.round(sizeKb * 100) / 100, JSON.stringify(dtuMetadata), now, now,
    );

    // Register ownership
    db.prepare(`
      INSERT INTO dtu_ownership (id, dtu_id, owner_id, acquired_via, created_at)
      VALUES (?, ?, ?, 'CREATED', ?)
    `).run(uid("own"), dtuId, creatorId, now);

    // Register citations
    for (const citation of citations) {
      registerCitation(db, {
        childId: dtuId,
        parentId: citation.parentId,
        creatorId,
        parentCreatorId: citation.parentCreatorId || "unknown",
        generation: citation.generation || 1,
      });
    }

    // Generate preview
    const previewContent = generatePreview(content, contentType, previewPolicy);
    db.prepare(`
      INSERT INTO dtu_previews (id, dtu_id, preview_content, preview_type,
        policy, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid("prv"), dtuId, previewContent, contentType || "text",
      previewPolicy, now);

    return { dtuId, tier: effectiveTier, cretiScore, previewContent };
  });

  try {
    const result = doCreate();
    // Award merit for creation
    awardMeritCredit(db, creatorId, "dtu_created", 5, { dtuId, lensId, tier: effectiveTier });

    return {
      ok: true,
      dtu: {
        id: result.dtuId,
        title,
        tier: result.tier,
        cretiScore: result.cretiScore,
        price,
        lensId,
        citationMode,
        citationCount: citations.length,
        citationLocked: true,
        status: "published",
      },
    };
  } catch (err) {
    console.error("[economy] dtu_creation_failed:", err.message);
    return { ok: false, error: "dtu_creation_failed" };
  }
}

/**
 * List a DTU on the marketplace for sale.
 */
export function listDTU(db, { dtuId, sellerId, price, licenseType = "standard" }) {
  if (!dtuId || !sellerId || price == null) return { ok: false, error: "missing_params" };
  if (price <= 0) return { ok: false, error: "price_must_be_positive" };

  const now = nowISO();
  try {
    db.prepare(`
      INSERT INTO marketplace_listings (id, dtu_id, seller_id, price, license_type,
        status, listed_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(uid("lst"), dtuId, sellerId, price, licenseType, now, now);

    // Update DTU price
    db.prepare("UPDATE dtus SET price = ?, updated_at = ? WHERE id = ?")
      .run(price, now, dtuId);

    awardMeritCredit(db, sellerId, "dtu_listed", 2, { dtuId });
    return { ok: true, listing: { dtuId, price, licenseType, status: "ACTIVE" } };
  } catch (err) {
    console.error("[economy] listing_failed:", err.message);
    return { ok: false, error: "listing_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRETI QUALITY SCORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CRETI Score: Credibility, Relevance, Evidence, Timeliness, Impact
 * Each dimension scored 0-20, total 0-100.
 *
 * Initial score is computed at creation. Score evolves based on:
 * - Citation velocity (how often cited by others)
 * - Purchase count and revenue
 * - Fork count and fork quality
 * - Review ratings
 * - Age decay (timeliness)
 */
export function computeInitialCRETI({ contentLength, citationCount, hasMetadata, hasTags }) {
  let score = 0;

  // Credibility (0-20): based on metadata quality
  score += hasMetadata ? 12 : 5;
  score += hasTags ? 5 : 0;
  // Max: 17 initial, grows with reviews

  // Relevance (0-20): starts at 10, adjusted by marketplace signals
  score += 10;

  // Evidence (0-20): based on citations provided
  score += Math.min(citationCount * 3, 18);

  // Timeliness (0-20): new content starts at 18, decays over time
  score += 18;

  // Impact (0-20): starts at 0, grows with citations/purchases/forks
  score += 0;

  return Math.min(Math.round(score), 100);
}

/**
 * Recalculate CRETI score for a DTU based on marketplace activity.
 */
export function recalculateCRETI(db, dtuId) {
  const dtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  // Citation count (Impact)
  const citedBy = db.prepare(
    "SELECT COUNT(*) as c FROM royalty_lineage WHERE parent_id = ?"
  ).get(dtuId)?.c || 0;

  // Purchase count
  const purchases = db.prepare(
    "SELECT COUNT(*) as c FROM dtu_ownership WHERE dtu_id = ? AND acquired_via = 'PURCHASE'"
  ).get(dtuId)?.c || 0;

  // Fork count
  const forks = db.prepare(
    "SELECT COUNT(*) as c FROM dtu_forks WHERE original_dtu_id = ?"
  ).get(dtuId)?.c || 0;

  // Age in days
  const ageMs = Date.now() - new Date(dtu.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Credibility (0-20)
  const metadata = safeJsonParse(dtu.metadata_json);
  const tags = safeJsonParse(dtu.tags_json);
  const credibility = Math.min(
    5 + (Object.keys(metadata).length > 0 ? 7 : 0) + (tags.length > 0 ? 5 : 0) +
    Math.min(purchases * 0.5, 3),
    20
  );

  // Relevance (0-20): search hits, recent activity
  const relevance = Math.min(10 + Math.min(citedBy * 0.5, 5) + Math.min(purchases * 0.3, 5), 20);

  // Evidence (0-20)
  const citationsMade = db.prepare(
    "SELECT COUNT(*) as c FROM royalty_lineage WHERE child_id = ?"
  ).get(dtuId)?.c || 0;
  const evidence = Math.min(citationsMade * 3, 20);

  // Timeliness (0-20): decay over time, boosted by recent activity
  const timeliness = Math.max(Math.round(20 - Math.log2(ageDays + 1) * 3), 2);

  // Impact (0-20): citations received + purchases + forks
  const impact = Math.min(Math.round(citedBy * 2 + purchases * 1 + forks * 3), 20);

  const newScore = Math.min(credibility + relevance + evidence + timeliness + impact, 100);

  db.prepare("UPDATE dtus SET creti_score = ?, updated_at = ? WHERE id = ?")
    .run(newScore, nowISO(), dtuId);

  return {
    ok: true,
    dtuId,
    score: newScore,
    breakdown: { credibility, relevance, evidence, timeliness, impact },
    signals: { citedBy, purchases, forks, ageDays: Math.round(ageDays) },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DTU COMPRESSION — DTU → Mega → Hyper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compress multiple related DTUs into a Mega DTU.
 * The child DTUs still exist independently but are now also part of the aggregate.
 * Citation chains are preserved — citing the Mega cites all children.
 */
export function compressToDMega(db, {
  creatorId, title, childDtuIds, lensId, price = 0, metadata = {},
}) {
  if (!creatorId || !title) return { ok: false, error: "missing_params" };
  if (!childDtuIds || childDtuIds.length < 2) return { ok: false, error: "need_at_least_2_dtus" };

  const megaId = uid("mega");
  const now = nowISO();

  const doCompress = db.transaction(() => {
    // Phase 2 perf fix: single batched IN-list lookup replaces N round-trips.
    const childMap = batchLookup(db, "dtus", "id", childDtuIds, {
      columns: ["id", "title", "content_type", "creti_score", "tier"],
    });
    const children = [];
    for (const childId of childDtuIds) {
      const child = childMap.get(childId);
      if (!child) throw new Error(`child_dtu_not_found: ${childId}`);
      children.push(child);
    }

    // Aggregate CRETI score — Mega is at least the average of children
    const avgCreti = Math.round(children.reduce((s, c) => s + (c.creti_score || 0), 0) / children.length);

    // Create the Mega DTU
    const aggregateContent = JSON.stringify({
      type: "mega_dtu",
      children: children.map(c => ({ id: c.id, title: c.title, type: c.content_type })),
    });

    db.prepare(`
      INSERT INTO dtus (id, creator_id, title, content, content_type, lens_id,
        tier, tags_json, price, creti_score, metadata_json, status, version,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, 'mega_dtu', ?, 'MEGA', '[]', ?, ?, ?, 'published', 1, ?, ?)
    `).run(megaId, creatorId, title, aggregateContent, lensId || "unknown",
      price, Math.min(avgCreti + 5, 100), JSON.stringify(metadata), now, now);

    // Link children
    for (let i = 0; i < childDtuIds.length; i++) {
      db.prepare(`
        INSERT INTO dtu_compression (id, parent_id, child_id, child_order,
          compression_type, created_at)
        VALUES (?, ?, ?, ?, 'mega', ?)
      `).run(uid("cmp"), megaId, childDtuIds[i], i, now);
    }

    // Register citations from mega to all children
    for (const childId of childDtuIds) {
      const child = children.find(c => c.id === childId);
      registerCitation(db, {
        childId: megaId,
        parentId: childId,
        creatorId,
        parentCreatorId: creatorId,
        generation: 1,
      });
    }

    return { megaId, childCount: childDtuIds.length, avgCreti };
  });

  try {
    const result = doCompress();
    awardMeritCredit(db, creatorId, "mega_dtu_created", 15, { megaId, lensId });
    return { ok: true, mega: { id: result.megaId, childCount: result.childCount, tier: "MEGA" } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Compress Mega DTUs into a Hyper DTU.
 */
export function compressToHyper(db, {
  creatorId, title, megaDtuIds, lensId, price = 0, metadata = {},
}) {
  if (!creatorId || !title) return { ok: false, error: "missing_params" };
  if (!megaDtuIds || megaDtuIds.length < 2) return { ok: false, error: "need_at_least_2_megas" };

  const hyperId = uid("hyp");
  const now = nowISO();

  const doCompress = db.transaction(() => {
    // Phase 2 perf fix: batched IN-list with extra MEGA-tier filter.
    const megaMap = batchLookup(db, "dtus", "id", megaDtuIds, {
      whereExtra: "tier = 'MEGA'",
    });
    const megas = [];
    for (const megaId of megaDtuIds) {
      const mega = megaMap.get(megaId);
      if (!mega) throw new Error(`mega_dtu_not_found: ${megaId}`);
      megas.push(mega);
    }

    const avgCreti = Math.round(megas.reduce((s, m) => s + (m.creti_score || 0), 0) / megas.length);

    const aggregateContent = JSON.stringify({
      type: "hyper_dtu",
      megas: megas.map(m => ({ id: m.id, title: m.title })),
    });

    db.prepare(`
      INSERT INTO dtus (id, creator_id, title, content, content_type, lens_id,
        tier, tags_json, price, creti_score, metadata_json, status, version,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hyper_dtu', ?, 'HYPER', '[]', ?, ?, ?, 'published', 1, ?, ?)
    `).run(hyperId, creatorId, title, aggregateContent, lensId || "unknown",
      price, Math.min(avgCreti + 10, 100), JSON.stringify(metadata), now, now);

    for (let i = 0; i < megaDtuIds.length; i++) {
      db.prepare(`
        INSERT INTO dtu_compression (id, parent_id, child_id, child_order,
          compression_type, created_at)
        VALUES (?, ?, ?, ?, 'hyper', ?)
      `).run(uid("cmp"), hyperId, megaDtuIds[i], i, now);
    }

    for (const megaId of megaDtuIds) {
      registerCitation(db, {
        childId: hyperId, parentId: megaId,
        creatorId, parentCreatorId: creatorId, generation: 1,
      });
    }

    return { hyperId, megaCount: megaDtuIds.length };
  });

  try {
    const result = doCompress();
    awardMeritCredit(db, creatorId, "hyper_dtu_created", 50, { hyperId, lensId });
    return { ok: true, hyper: { id: result.hyperId, megaCount: result.megaCount, tier: "HYPER" } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORK MECHANISM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fork a DTU — creates a derivative with auto-citation.
 * The original creator automatically earns from all future sales of the fork.
 */
export function forkDTU(db, {
  forkerId, originalDtuId, newTitle, newContent, lensId,
}) {
  if (!forkerId || !originalDtuId) return { ok: false, error: "missing_params" };

  const original = db.prepare("SELECT * FROM dtus WHERE id = ?").get(originalDtuId);
  if (!original) return { ok: false, error: "original_not_found" };

  // Check fork permissions
  const forkPolicy = safeJsonParse(original.metadata_json).forkPolicy || "open";
  if (forkPolicy === "restricted" && forkerId !== original.creator_id) {
    return { ok: false, error: "fork_restricted" };
  }

  const forkId = uid("frk");
  const now = nowISO();

  const doFork = db.transaction(() => {
    // Create the forked DTU
    db.prepare(`
      INSERT INTO dtus (id, creator_id, title, content, content_type, lens_id,
        tier, tags_json, price, creti_score, metadata_json, status, version,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'published', 1, ?, ?)
    `).run(
      forkId, forkerId,
      newTitle || `Fork of: ${original.title}`,
      newContent || original.content,
      original.content_type, lensId || original.lens_id,
      original.tier, original.tags_json || "[]",
      Math.max((original.creti_score || 0) - 5, 10),
      JSON.stringify((() => {
        const origMeta = safeJsonParse(original.metadata_json);
        const forkMeta = {
          ...origMeta,
          forkedFrom: originalDtuId,
          forkPolicy: "open",
          citationMode: "derivative",
          citationLocked: true,
          royaltyNotice: `Original creator (${original.creator_id}) earns royalties on sales of this fork`,
        };
        // Preserve source attribution through forks — attribution cannot be removed
        if (origMeta.source || origMeta.via) {
          forkMeta.lineage = {
            ...(origMeta.lineage || {}),
            originalSource: origMeta.source || origMeta.lineage?.originalSource || null,
            originalVia: origMeta.via || origMeta.lineage?.originalVia || null,
            forkParent: originalDtuId,
            forkedAt: now,
          };
        }
        return forkMeta;
      })()),
      now, now,
    );

    // Record the fork relationship
    db.prepare(`
      INSERT INTO dtu_forks (id, original_dtu_id, fork_dtu_id, forker_id,
        original_creator_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid("fkr"), originalDtuId, forkId, forkerId, original.creator_id, now);

    // Auto-citation — original creator will earn royalties on fork sales
    registerCitation(db, {
      childId: forkId,
      parentId: originalDtuId,
      creatorId: forkerId,
      parentCreatorId: original.creator_id,
      generation: 1,
    });

    // Ownership
    db.prepare(`
      INSERT INTO dtu_ownership (id, dtu_id, owner_id, acquired_via, created_at)
      VALUES (?, ?, ?, 'FORKED', ?)
    `).run(uid("own"), forkId, forkerId, now);

    return { forkId };
  });

  try {
    const result = doFork();
    awardMeritCredit(db, forkerId, "dtu_forked", 3, { originalDtuId, forkId: result.forkId });
    awardMeritCredit(db, original.creator_id, "dtu_was_forked", 2, { originalDtuId, forkId: result.forkId });

    return {
      ok: true,
      fork: {
        id: result.forkId,
        originalId: originalDtuId,
        originalCreator: original.creator_id,
        autoCitation: true,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get fork tree for a DTU.
 */
export function getForkTree(db, dtuId) {
  const forks = db.prepare(`
    SELECT f.*, d.title as fork_title, d.creti_score as fork_creti
    FROM dtu_forks f
    JOIN dtus d ON d.id = f.fork_dtu_id
    WHERE f.original_dtu_id = ?
    ORDER BY f.created_at
  `).all(dtuId);

  return { ok: true, dtuId, forks, count: forks.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate preview content based on policy:
 * - "first_3": First 3 sections/paragraphs free
 * - "summary": AI-generated summary only
 * - "teaser": First 10% of content
 * - "none": Title and metadata only
 * - "full": Full content (free DTUs)
 */
function generatePreview(content, contentType, policy) {
  if (policy === "full") return typeof content === "string" ? content : JSON.stringify(content);
  if (policy === "none") return "";

  const text = typeof content === "string" ? content : JSON.stringify(content);

  if (policy === "first_3") {
    const paragraphs = text.split(/\n\n+/);
    return paragraphs.slice(0, 3).join("\n\n");
  }

  if (policy === "teaser") {
    const cutoff = Math.max(Math.floor(text.length * 0.1), 100);
    return text.slice(0, cutoff) + (text.length > cutoff ? "..." : "");
  }

  if (policy === "summary") {
    // Simplified — in production, this would call the AI
    const cutoff = Math.min(text.length, 500);
    return text.slice(0, cutoff) + (text.length > cutoff ? "\n\n[Preview — purchase for full content]" : "");
  }

  return text.slice(0, 200);
}

/**
 * Get preview for a DTU.
 */
export function getDTUPreview(db, dtuId) {
  const preview = db.prepare(
    "SELECT * FROM dtu_previews WHERE dtu_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(dtuId);

  if (!preview) return { ok: false, error: "preview_not_found" };

  const dtu = db.prepare(
    "SELECT id, title, creator_id, content_type, lens_id, tier, price, creti_score, tags_json FROM dtus WHERE id = ?"
  ).get(dtuId);

  return {
    ok: true,
    preview: {
      dtuId,
      title: dtu?.title,
      creator: dtu?.creator_id,
      contentType: dtu?.content_type,
      lensId: dtu?.lens_id,
      tier: dtu?.tier,
      price: dtu?.price,
      cretiScore: dtu?.creti_score,
      tags: safeJsonParse(dtu?.tags_json),
      previewContent: preview.preview_content,
      previewType: preview.preview_type,
      policy: preview.policy,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-LENS SEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search DTUs across all lenses.
 * Ranked by CRETI score, weighted by relevance to query.
 */
export function searchDTUs(db, {
  query, lensId, tier, minCreti = 0, maxPrice,
  sortBy = "creti_score", limit = 50, offset = 0,
} = {}) {
  if (!query && !lensId) return { ok: false, error: "query_or_lens_required" };

  let sql = "SELECT id, creator_id, title, content_type, lens_id, tier, price, creti_score, tags_json, created_at FROM dtus WHERE status = 'published'";
  const params = [];

  if (query) {
    sql += " AND (title LIKE ? OR content LIKE ? OR tags_json LIKE ?)";
    const q = `%${query}%`;
    params.push(q, q, q);
  }
  if (lensId) { sql += " AND lens_id = ?"; params.push(lensId); }
  if (tier) { sql += " AND tier = ?"; params.push(tier); }
  if (minCreti > 0) { sql += " AND creti_score >= ?"; params.push(minCreti); }
  if (maxPrice !== undefined) { sql += " AND price <= ?"; params.push(maxPrice); }

  const countSql = sql.replace(/^SELECT .+ FROM/, "SELECT COUNT(*) as c FROM");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  const validSorts = { creti_score: "creti_score DESC", price: "price ASC", newest: "created_at DESC", popular: "creti_score DESC" };
  sql += ` ORDER BY ${validSorts[sortBy] || "creti_score DESC"} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = db.prepare(sql).all(...params).map(row => ({
    ...row,
    tags: safeJsonParse(row.tags_json),
  }));

  return { ok: true, results, total, limit, offset, query, lensId };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function safeJsonParse(str) {
  try { return JSON.parse(str || "[]"); } catch (err) { console.debug('[dtu-pipeline] JSON parse failed', err?.message); return []; }
}
