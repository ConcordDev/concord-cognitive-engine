/**
 * Federation Hierarchy — Core Logic
 *
 * Implements the Concord Federation Hierarchy Spec v1.0:
 *   - National / Regional / CRI registry management
 *   - User location declaration (self-declared, no geolocation)
 *   - Entity home base + CRI transfer
 *   - DTU location tagging + federation tier promotion
 *   - Marketplace local-first purchasing (strict for emergents)
 *   - Knowledge resolution with tiered escalation
 *   - Federation peering protocol
 *   - CRI heartbeat monitoring
 *
 * All location is user-declared. No IP geolocation. No GPS. No verification.
 */

import crypto from "crypto";
import {
  FEDERATION, FEDERATION_FLOW, MARKETPLACE_PURCHASE_PRIORITY, PEERING_POLICIES,
  TIER_QUALITY_GATES, TIER_QUESTS, TIER_HEARTBEATS,
  DEDUP_PROTOCOL, INTEGRITY_INVARIANTS,
} from "./federation-constants.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function hashQuery(query) {
  return crypto.createHash("sha256").update(String(query)).digest("hex").slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// NATIONAL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a new national entity.
 */
export function createNational(db, { name, countryCode, compliance = {}, stewardCouncil = [] }) {
  if (!name) return { ok: false, error: "missing_name" };
  if (!countryCode) return { ok: false, error: "missing_country_code" };

  const id = uid("nat");
  try {
    db.prepare(`
      INSERT INTO nationals (id, name, country_code, compliance_json, steward_council_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, countryCode.toUpperCase(), JSON.stringify(compliance), JSON.stringify(stewardCouncil));
    return { ok: true, national: { id, name, countryCode: countryCode.toUpperCase() } };
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return { ok: false, error: "country_code_exists" };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * List all nationals.
 */
export function listNationals(db) {
  const rows = db.prepare("SELECT * FROM nationals ORDER BY name").all();
  return {
    ok: true,
    nationals: rows.map(r => ({
      id: r.id,
      name: r.name,
      countryCode: r.country_code,
      compliance: JSON.parse(r.compliance_json || "{}"),
      stewardCouncil: JSON.parse(r.steward_council_json || "[]"),
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get a single national by id.
 */
export function getNational(db, id) {
  const r = db.prepare("SELECT * FROM nationals WHERE id = ?").get(id);
  if (!r) return { ok: false, error: "not_found" };
  return {
    ok: true,
    national: {
      id: r.id,
      name: r.name,
      countryCode: r.country_code,
      compliance: JSON.parse(r.compliance_json || "{}"),
      stewardCouncil: JSON.parse(r.steward_council_json || "[]"),
      createdAt: r.created_at,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGIONAL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a new region within a national.
 */
export function createRegion(db, { name, nationalId, timezone = null }) {
  if (!name) return { ok: false, error: "missing_name" };
  if (!nationalId) return { ok: false, error: "missing_national_id" };

  // Verify national exists
  const nat = db.prepare("SELECT id FROM nationals WHERE id = ?").get(nationalId);
  if (!nat) return { ok: false, error: "national_not_found" };

  const id = uid("reg");
  db.prepare(`
    INSERT INTO regions (id, name, national_id, timezone)
    VALUES (?, ?, ?, ?)
  `).run(id, name, nationalId, timezone);

  return { ok: true, region: { id, name, nationalId, timezone } };
}

/**
 * List regions, optionally filtered by national.
 */
export function listRegions(db, { nationalId = null } = {}) {
  let sql = "SELECT * FROM regions";
  const params = [];
  if (nationalId) {
    sql += " WHERE national_id = ?";
    params.push(nationalId);
  }
  sql += " ORDER BY name";
  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    regions: rows.map(r => ({
      id: r.id,
      name: r.name,
      nationalId: r.national_id,
      timezone: r.timezone,
      criCount: r.cri_count,
      userCount: r.user_count,
      entityCount: r.entity_count,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get a single region by id.
 */
export function getRegion(db, id) {
  const r = db.prepare("SELECT * FROM regions WHERE id = ?").get(id);
  if (!r) return { ok: false, error: "not_found" };
  return {
    ok: true,
    region: {
      id: r.id,
      name: r.name,
      nationalId: r.national_id,
      timezone: r.timezone,
      criCount: r.cri_count,
      userCount: r.user_count,
      entityCount: r.entity_count,
      createdAt: r.created_at,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CRI REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a new CRI instance.
 */
export function registerCRIInstance(db, { regionalId, nationalId, areaDescription = null, capabilities = {} }) {
  if (!regionalId) return { ok: false, error: "missing_regional_id" };
  if (!nationalId) return { ok: false, error: "missing_national_id" };

  // Verify region and national exist
  const reg = db.prepare("SELECT id FROM regions WHERE id = ?").get(regionalId);
  if (!reg) return { ok: false, error: "region_not_found" };
  const nat = db.prepare("SELECT id FROM nationals WHERE id = ?").get(nationalId);
  if (!nat) return { ok: false, error: "national_not_found" };

  const id = uid("cri");
  const now = nowISO();
  db.prepare(`
    INSERT INTO cri_instances (id, regional_id, national_id, area_description, capabilities_json, registered_at, last_heartbeat)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, regionalId, nationalId, areaDescription, JSON.stringify(capabilities), now, now);

  // Increment region CRI count
  db.prepare("UPDATE regions SET cri_count = cri_count + 1 WHERE id = ?").run(regionalId);

  return {
    ok: true,
    cri: { id, regionalId, nationalId, areaDescription, capabilities, status: "active", registeredAt: now },
  };
}

/**
 * Record a CRI heartbeat.
 */
export function recordCRIHeartbeat(db, criId) {
  const now = nowISO();
  const changes = db.prepare(
    "UPDATE cri_instances SET last_heartbeat = ?, status = 'active' WHERE id = ?"
  ).run(now, criId);
  if (changes.changes === 0) return { ok: false, error: "cri_not_found" };
  return { ok: true, criId, heartbeatAt: now };
}

/**
 * Mark stale CRIs as offline based on heartbeat threshold.
 */
export function markStaleCRIs(db) {
  const threshold = new Date(Date.now() - FEDERATION.CRI_OFFLINE_THRESHOLD_MS).toISOString();
  const result = db.prepare(`
    UPDATE cri_instances SET status = 'offline'
    WHERE status = 'active' AND last_heartbeat < ?
  `).run(threshold);
  return { ok: true, markedOffline: result.changes };
}

/**
 * List CRI instances, optionally filtered.
 */
export function listCRIInstances(db, { regionalId = null, nationalId = null, status = null } = {}) {
  let sql = "SELECT * FROM cri_instances WHERE 1=1";
  const params = [];
  if (regionalId) { sql += " AND regional_id = ?"; params.push(regionalId); }
  if (nationalId) { sql += " AND national_id = ?"; params.push(nationalId); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY registered_at DESC";

  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    instances: rows.map(r => ({
      id: r.id,
      regionalId: r.regional_id,
      nationalId: r.national_id,
      areaDescription: r.area_description,
      capabilities: JSON.parse(r.capabilities_json || "{}"),
      status: r.status,
      registeredAt: r.registered_at,
      lastHeartbeat: r.last_heartbeat,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// USER LOCATION DECLARATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Declare or update a user's location.
 * Users self-declare. No verification. No geolocation.
 */
export function declareUserLocation(db, { userId, regional = null, national = null }) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  if (!regional && !national) return { ok: false, error: "must_declare_at_least_one" };

  // Get current location for history
  const user = db.prepare("SELECT declared_regional, declared_national FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const now = nowISO();

  // Record history
  db.prepare(`
    INSERT INTO user_location_history (id, user_id, regional, national, previous_regional, previous_national, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid("ulh"), userId, regional, national, user.declared_regional, user.declared_national, now);

  // Update user
  db.prepare(`
    UPDATE users SET declared_regional = ?, declared_national = ?, location_declared_at = ?
    WHERE id = ?
  `).run(regional, national, now, userId);

  return {
    ok: true,
    location: { regional, national, declaredAt: now },
  };
}

/**
 * Get a user's declared location.
 */
export function getUserLocation(db, userId) {
  const user = db.prepare(
    "SELECT declared_regional, declared_national, location_declared_at FROM users WHERE id = ?"
  ).get(userId);
  if (!user) return { ok: false, error: "user_not_found" };
  return {
    ok: true,
    location: {
      regional: user.declared_regional,
      national: user.declared_national,
      declaredAt: user.location_declared_at,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY HOME BASE (CRI-determined location)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set an entity's home CRI. Entities inherit location from CRI.
 */
export function setEntityHomeBase(db, { entityId, criId }) {
  if (!entityId) return { ok: false, error: "missing_entity_id" };
  if (!criId) return { ok: false, error: "missing_cri_id" };

  const cri = db.prepare(
    "SELECT id, regional_id, national_id FROM cri_instances WHERE id = ?"
  ).get(criId);
  if (!cri) return { ok: false, error: "cri_not_found" };

  // Resolve region to get the region name/tag
  const region = db.prepare("SELECT id, name FROM regions WHERE id = ?").get(cri.regional_id);
  const national = db.prepare("SELECT id, country_code FROM nationals WHERE id = ?").get(cri.national_id);

  const now = nowISO();

  // Check for existing home base (for transfer tracking)
  const existing = db.prepare("SELECT * FROM entity_home_base WHERE entity_id = ?").get(entityId);

  if (existing) {
    // Record transfer history
    db.prepare(`
      INSERT INTO entity_transfer_history (id, entity_id, from_cri, to_cri, from_regional, to_regional, transferred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid("etr"), entityId, existing.cri_id, criId, existing.regional, cri.regional_id, now);

    // Update home base
    db.prepare(`
      UPDATE entity_home_base SET cri_id = ?, regional = ?, national = ?, arrived_at = ?
      WHERE entity_id = ?
    `).run(criId, cri.regional_id, cri.national_id, now, entityId);
  } else {
    db.prepare(`
      INSERT INTO entity_home_base (entity_id, cri_id, regional, national, arrived_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(entityId, criId, cri.regional_id, cri.national_id, now);
  }

  return {
    ok: true,
    homeBase: {
      entityId,
      criId,
      regional: cri.regional_id,
      national: cri.national_id,
      regionName: region?.name,
      nationalCode: national?.country_code,
      arrivedAt: now,
    },
  };
}

/**
 * Get an entity's home base.
 */
export function getEntityHomeBase(db, entityId) {
  const row = db.prepare("SELECT * FROM entity_home_base WHERE entity_id = ?").get(entityId);
  if (!row) return { ok: false, error: "no_home_base" };
  return {
    ok: true,
    homeBase: {
      entityId: row.entity_id,
      criId: row.cri_id,
      regional: row.regional,
      national: row.national,
      arrivedAt: row.arrived_at,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DTU LOCATION TAGGING & FEDERATION TIER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tag a DTU with location (inherited from creator at creation time).
 * Location is immutable after creation.
 */
export function tagDTULocation(db, { dtuId, regional = null, national = null, federationTier = "local" }) {
  if (!dtuId) return { ok: false, error: "missing_dtu_id" };
  if (!FEDERATION.TIERS.includes(federationTier)) {
    return { ok: false, error: "invalid_federation_tier" };
  }

  const changes = db.prepare(`
    UPDATE dtus SET location_regional = ?, location_national = ?, federation_tier = ?
    WHERE id = ? AND location_regional IS NULL AND location_national IS NULL
  `).run(regional, national, federationTier, dtuId);

  if (changes.changes === 0) {
    // Check if DTU exists
    const dtu = db.prepare("SELECT id, location_regional FROM dtus WHERE id = ?").get(dtuId);
    if (!dtu) return { ok: false, error: "dtu_not_found" };
    if (dtu.location_regional !== null) return { ok: false, error: "location_already_set" };
    return { ok: false, error: "update_failed" };
  }

  return { ok: true, dtuId, regional, national, federationTier };
}

/**
 * Can `viewer` see `dtu` under the federation tier rules?
 *
 * The read-side filter that was missing. Compares the viewer's declared
 * region and nation against the DTU's federation_tier + location fields
 * and returns a simple allow/deny decision.
 *
 * Rules:
 *   • Owner always sees their own content.
 *   • Admin/founder/sovereign bypass all scope checks.
 *   • visibility=private / internal / draft → owner only.
 *   • federation_tier=local → owner only (plus admin).
 *   • federation_tier=regional → viewer.declared_regional must
 *     equal dtu.location_regional. If the DTU never had a region
 *     stamped we fail-closed (owner/admin only).
 *   • federation_tier=national → viewer.declared_national must
 *     equal dtu.location_national. Same fail-closed rule.
 *   • federation_tier=global → visible to everyone.
 *   • DTUs created before federation tiers existed (no federation_tier
 *     and no location columns) fall through to the legacy
 *     visibility/scope checks so pre-upgrade content stays reachable.
 *
 * @param {object|null} db - optional; the caller can pass null if both
 *                           `viewer` and `dtu` already carry all the
 *                           location fields we need.
 * @param {object} viewer - { id, userId, declaredRegional, declaredNational, role }
 * @param {object} dtu    - DTU record with ownerId, federation_tier,
 *                          location_regional, location_national,
 *                          visibility, scope.
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canViewDtu(db, viewer, dtu) {
  if (!dtu) return { allowed: false, reason: "missing_dtu" };

  const viewerId = viewer?.id || viewer?.userId || null;
  const viewerRole = viewer?.role || "viewer";
  const isAdmin =
    viewerRole === "admin" ||
    viewerRole === "owner" ||
    viewerRole === "founder" ||
    viewerRole === "sovereign";

  // Owner always sees their own
  const ownerId = dtu.ownerId || dtu.owner_user_id || dtu.createdBy || null;
  if (viewerId && ownerId && viewerId === ownerId) return { allowed: true, reason: "owner" };

  // Admin bypass
  if (isAdmin) return { allowed: true, reason: "admin" };

  // Private / internal / draft → owner only (already rejected above)
  const visibility = dtu.visibility || dtu.meta?.visibility || null;
  if (visibility === "private" || visibility === "internal" || visibility === "draft") {
    return { allowed: false, reason: "private" };
  }

  const tier = dtu.federation_tier || dtu.federationTier || null;
  const dtuRegional = dtu.location_regional || dtu.locationRegional || null;
  const dtuNational = dtu.location_national || dtu.locationNational || null;

  // No federation metadata → legacy path. Allow unless explicitly private.
  if (!tier) {
    // Global scope or public visibility = visible
    if (dtu.scope === "global" || visibility === "public" || visibility === "published") {
      return { allowed: true, reason: "legacy_public" };
    }
    // Legacy local/unscoped DTUs: owner-only (already rejected above) OR
    // fall through to allow if the caller is reading an unscoped feed
    // that trusts the query-level filter. Be conservative: deny.
    return { allowed: false, reason: "legacy_unscoped" };
  }

  // Global is always visible
  if (tier === "global") return { allowed: true, reason: "global_tier" };

  // Local = owner only. Owner already handled above.
  if (tier === "local") return { allowed: false, reason: "local_tier_not_owner" };

  // Regional / national tier — need viewer location to compare.
  const viewerRegional = viewer?.declaredRegional || viewer?.declared_regional || null;
  const viewerNational = viewer?.declaredNational || viewer?.declared_national || null;

  // If viewer hasn't declared a location we fail closed — they can't
  // pretend they're in the region.
  if (tier === "regional") {
    if (!dtuRegional) return { allowed: false, reason: "regional_tier_no_dtu_region" };
    if (!viewerRegional) return { allowed: false, reason: "regional_tier_no_viewer_region" };
    if (viewerRegional === dtuRegional) return { allowed: true, reason: "regional_match" };
    return { allowed: false, reason: "regional_mismatch" };
  }

  if (tier === "national") {
    if (!dtuNational) return { allowed: false, reason: "national_tier_no_dtu_nation" };
    if (!viewerNational) return { allowed: false, reason: "national_tier_no_viewer_nation" };
    if (viewerNational === dtuNational) return { allowed: true, reason: "national_match" };
    return { allowed: false, reason: "national_mismatch" };
  }

  return { allowed: false, reason: "unknown_tier" };
}

/**
 * Filter a DTU array by `canViewDtu`. Convenience for feed/browse
 * endpoints that pull a pile of rows and want to drop anything the
 * viewer shouldn't see. Returns a new array, does not mutate.
 */
export function filterDtusByViewer(db, viewer, dtus) {
  if (!Array.isArray(dtus) || dtus.length === 0) return [];
  return dtus.filter((d) => canViewDtu(db, viewer, d).allowed);
}

/**
 * Promote a DTU to a higher federation tier (council-approved).
 * Once promoted, never demoted.
 */
export function promoteDTU(db, { dtuId, toTier, reason = "" }) {
  if (!dtuId) return { ok: false, error: "missing_dtu_id" };
  if (!FEDERATION.TIERS.includes(toTier)) return { ok: false, error: "invalid_tier" };

  const dtu = db.prepare("SELECT id, federation_tier FROM dtus WHERE id = ?").get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  const currentIndex = FEDERATION.TIERS.indexOf(dtu.federation_tier);
  const targetIndex = FEDERATION.TIERS.indexOf(toTier);

  if (targetIndex <= currentIndex) {
    return { ok: false, error: "cannot_demote", currentTier: dtu.federation_tier, requestedTier: toTier };
  }

  const now = nowISO();

  // Update tier
  db.prepare("UPDATE dtus SET federation_tier = ? WHERE id = ?").run(toTier, dtuId);

  // Record history
  db.prepare(`
    INSERT INTO dtu_federation_history (id, dtu_id, from_tier, to_tier, promoted_at, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid("dfh"), dtuId, dtu.federation_tier, toTier, now, reason);

  return {
    ok: true,
    dtuId,
    fromTier: dtu.federation_tier,
    toTier,
    promotedAt: now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE LOCAL-FIRST PURCHASING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search marketplace listings with federation-aware location filtering.
 * Emergents MUST follow regional → national → global order (enforced).
 * Humans SHOULD follow it (recommended, not enforced).
 */
export function findListingsForEntity(db, { entityId, query = {}, isEmergent = false }) {
  if (isEmergent) {
    return _findListingsStrictLocalFirst(db, entityId, query);
  }
  return _findListingsRecommendedLocalFirst(db, query);
}

/**
 * Strict local-first search for emergent entities.
 * Steps through regional → national → global in strict order.
 */
function _findListingsStrictLocalFirst(db, entityId, query) {
  // Get entity home base
  const homeBase = db.prepare("SELECT * FROM entity_home_base WHERE entity_id = ?").get(entityId);
  if (!homeBase) return { ok: false, error: "entity_has_no_home_base" };

  const tiers = MARKETPLACE_PURCHASE_PRIORITY.EMERGENT;

  for (const tier of tiers) {
    const filters = { ...query, status: "active" };

    if (tier === "regional") {
      filters.locationRegional = homeBase.regional;
      filters.locationNational = homeBase.national;
    } else if (tier === "national") {
      filters.locationNational = homeBase.national;
    }
    // "global" — no location filter

    const results = _searchListingsWithLocation(db, filters);
    if (results.items.length > 0) {
      return { ok: true, results: results.items, tier, total: results.total };
    }
  }

  return { ok: true, results: [], tier: "global", total: 0, exhausted: true };
}

/**
 * Recommended local-first search for humans (not enforced).
 * Returns all results but annotates which tier each listing belongs to.
 */
function _findListingsRecommendedLocalFirst(db, query) {
  const results = _searchListingsWithLocation(db, { ...query, status: "active" });
  return { ok: true, results: results.items, total: results.total };
}

/**
 * Internal: search marketplace listings with optional location filters.
 */
function _searchListingsWithLocation(db, filters) {
  let sql = "SELECT * FROM marketplace_economy_listings WHERE 1=1";
  const params = [];

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters.contentType) {
    sql += " AND content_type = ?";
    params.push(filters.contentType);
  }
  if (filters.locationRegional) {
    sql += " AND location_regional = ?";
    params.push(filters.locationRegional);
  }
  if (filters.locationNational) {
    sql += " AND location_national = ?";
    params.push(filters.locationNational);
  }
  if (filters.sellerId) {
    sql += " AND seller_id = ?";
    params.push(filters.sellerId);
  }
  if (filters.minPrice != null) {
    sql += " AND price >= ?";
    params.push(filters.minPrice);
  }
  if (filters.maxPrice != null) {
    sql += " AND price <= ?";
    params.push(filters.maxPrice);
  }

  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params);
  return { items, total, limit, offset };
}

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE RESOLUTION (Tiered Escalation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a knowledge query through the federation tier hierarchy.
 * Escalates local → regional → national → global.
 *
 * @param {object} db - Database handle
 * @param {object} opts
 * @param {string} opts.query - The knowledge query
 * @param {string} opts.currentTier - Starting tier
 * @param {object} opts.userLocation - { regional, national }
 * @param {function} opts.searchFn - Function(query, tier, location) => { sufficient, results }
 */
export async function resolveQuery(db, { query, currentTier = "local", userLocation = {}, searchFn }) {
  if (!searchFn) return { ok: false, error: "missing_search_function" };

  const escalationOrder = FEDERATION.TIERS;
  const startIndex = escalationOrder.indexOf(currentTier);
  if (startIndex < 0) return { ok: false, error: "invalid_current_tier" };

  for (let i = startIndex; i < escalationOrder.length; i++) {
    const tier = escalationOrder[i];
    const result = await searchFn(query, tier, userLocation);

    if (result && result.sufficient) {
      // Log escalation if we had to go higher than starting tier
      if (i > startIndex) {
        _recordEscalation(db, {
          queryHash: hashQuery(query),
          fromTier: currentTier,
          toTier: tier,
          regional: userLocation.regional,
          national: userLocation.national,
        });
      }
      return { ok: true, result, resolvedAt: tier };
    }
  }

  return { ok: true, result: null, resolvedAt: null, exhausted: true };
}

/**
 * Record a knowledge escalation event.
 */
function _recordEscalation(db, { queryHash, fromTier, toTier, regional, national }) {
  try {
    db.prepare(`
      INSERT INTO federation_escalations (id, query_hash, from_tier, to_tier, regional, national)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid("esc"), queryHash, fromTier, toTier, regional || null, national || null);
  } catch {
    // Silent failure — escalation logging should never block queries
  }
}

/**
 * Get escalation analytics.
 */
export function getEscalationStats(db, { regional = null, national = null, hours = 24 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  let sql = `
    SELECT from_tier, to_tier, COUNT(*) as count
    FROM federation_escalations
    WHERE created_at >= ?
  `;
  const params = [cutoff];

  if (regional) { sql += " AND regional = ?"; params.push(regional); }
  if (national) { sql += " AND national = ?"; params.push(national); }

  sql += " GROUP BY from_tier, to_tier ORDER BY count DESC";

  const rows = db.prepare(sql).all(...params);
  return { ok: true, stats: rows, periodHours: hours };
}

// ═══════════════════════════════════════════════════════════════════════════
// FEDERATION PEERING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Establish a federation peer relationship.
 */
export function createPeer(db, { peerType, fromId, toId, sharingPolicy = "pull_on_demand", economicIsolation = true, complianceLayer = false }) {
  if (!peerType || !fromId || !toId) return { ok: false, error: "missing_required_fields" };

  const validTypes = ["regional_sibling", "national_peer", "tier_escalation"];
  if (!validTypes.includes(peerType)) return { ok: false, error: "invalid_peer_type" };

  const id = uid("fpeer");
  db.prepare(`
    INSERT INTO federation_peers (id, peer_type, from_id, to_id, sharing_policy, economic_isolation, compliance_layer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, peerType, fromId, toId, sharingPolicy, economicIsolation ? 1 : 0, complianceLayer ? 1 : 0);

  return { ok: true, peer: { id, peerType, fromId, toId, sharingPolicy, economicIsolation, complianceLayer } };
}

/**
 * List federation peers for a given entity.
 */
export function listPeers(db, { entityId = null, peerType = null } = {}) {
  let sql = "SELECT * FROM federation_peers WHERE 1=1";
  const params = [];
  if (entityId) {
    sql += " AND (from_id = ? OR to_id = ?)";
    params.push(entityId, entityId);
  }
  if (peerType) {
    sql += " AND peer_type = ?";
    params.push(peerType);
  }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    peers: rows.map(r => ({
      id: r.id,
      peerType: r.peer_type,
      fromId: r.from_id,
      toId: r.to_id,
      sharingPolicy: r.sharing_policy,
      economicIsolation: !!r.economic_isolation,
      complianceLayer: !!r.compliance_layer,
      createdAt: r.created_at,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC FLOW SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get economic flow summary by tier for a given time period.
 * Shows how money flows through the federation hierarchy.
 */
export function getEconomicFlowSummary(db, { hours = 24 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Count listings per location tier
  const regionalListings = db.prepare(
    "SELECT COUNT(*) as c FROM marketplace_economy_listings WHERE location_regional IS NOT NULL AND created_at >= ?"
  ).get(cutoff)?.c || 0;

  const nationalListings = db.prepare(
    "SELECT COUNT(*) as c FROM marketplace_economy_listings WHERE location_national IS NOT NULL AND location_regional IS NULL AND created_at >= ?"
  ).get(cutoff)?.c || 0;

  const globalListings = db.prepare(
    "SELECT COUNT(*) as c FROM marketplace_economy_listings WHERE location_regional IS NULL AND location_national IS NULL AND created_at >= ?"
  ).get(cutoff)?.c || 0;

  // Escalation stats
  const escalations = db.prepare(`
    SELECT from_tier, to_tier, COUNT(*) as count
    FROM federation_escalations WHERE created_at >= ?
    GROUP BY from_tier, to_tier
  `).all(cutoff);

  return {
    ok: true,
    periodHours: hours,
    listings: { regional: regionalListings, national: nationalListings, global: globalListings },
    escalations,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — FEDERATED QUERY (Bottom-Up Only, Ephemeral Results)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Federated query with bottom-up flow enforcement.
 * Results from higher tiers are EPHEMERAL — they do NOT persist into the origin tier.
 * Users can QUERY up, but results expire when the session ends.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.originTier - The tier the query originates from
 * @param {object} opts.userLocation - { regional, national }
 * @param {function} opts.searchFn - (query, tier, location) => { sufficient, results }
 */
export async function federatedQuery(db, { query, originTier = "local", userLocation = {}, searchFn }) {
  if (!searchFn) return { ok: false, error: "missing_search_function" };

  // Search local tier first — result persists naturally
  const localResult = await searchFn(query, originTier, userLocation);
  if (localResult && localResult.sufficient) {
    return { ok: true, result: localResult, resolvedAt: originTier, persisted: true };
  }

  // Escalate UP for query resolution
  const tiers = FEDERATION.TIERS;
  const startIdx = tiers.indexOf(originTier);
  if (startIdx < 0) return { ok: false, error: "invalid_origin_tier" };

  for (let i = startIdx + 1; i < tiers.length; i++) {
    const tier = tiers[i];
    const result = await searchFn(query, tier, userLocation);

    if (result && result.sufficient) {
      // Log escalation
      _recordEscalation(db, {
        queryHash: hashQuery(query),
        fromTier: originTier,
        toTier: tier,
        regional: userLocation.regional,
        national: userLocation.national,
      });

      return {
        ok: true,
        result,
        resolvedAt: tier,
        persisted: false,        // DOES NOT persist into lower tier
        ephemeral: true,         // marked as temporary context
        expiresAfter: "session", // gone when session ends
      };
    }
  }

  return { ok: true, result: null, resolvedAt: null, exhausted: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — QUALITY GATE CHECKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether a DTU meets the quality gates for a target tier.
 *
 * @param {object} opts
 * @param {string} opts.targetTier - "regional", "national", or "global"
 * @param {number} opts.authorityScore - DTU's authority score
 * @param {number} opts.citationCount - Number of citations
 * @param {string} opts.dtuTier - DTU content tier ("regular", "mega", "hyper", "shadow")
 * @param {number} [opts.ageHours] - Age in hours (for promotion checks)
 * @param {number} [opts.crossRegionalPresence] - Number of distinct regions citing
 * @param {number} [opts.crossNationalPresence] - Number of distinct nations citing
 */
export function checkQualityGate({
  targetTier, authorityScore = 0, citationCount = 0, dtuTier = "regular",
  ageHours = 0, crossRegionalPresence = 0, crossNationalPresence = 0,
}) {
  const gates = TIER_QUALITY_GATES[targetTier];
  if (!gates) return { ok: false, error: "invalid_target_tier" };

  const failures = [];

  if (authorityScore < gates.minAuthorityScore) {
    failures.push({ gate: "minAuthorityScore", required: gates.minAuthorityScore, actual: authorityScore });
  }
  if (citationCount < gates.minCitations) {
    failures.push({ gate: "minCitations", required: gates.minCitations, actual: citationCount });
  }

  // Check tier allowance
  const tierAllowed = (
    (dtuTier === "shadow" && gates.allowShadowTier) ||
    (dtuTier === "regular" && gates.allowRegularTier) ||
    (dtuTier === "mega" && gates.allowMegaTier) ||
    (dtuTier === "hyper" && gates.allowHyperTier)
  );
  if (!tierAllowed) {
    failures.push({ gate: "tierAllowed", dtuTier, allowedTiers: _allowedTiers(gates) });
  }

  // Check promotion-specific gates
  if (targetTier === "national" && gates.promotionToNational) {
    // This is checked during promotion FROM regional
  }
  if (targetTier === "global") {
    if (gates.crossNationalPresence && crossNationalPresence < gates.crossNationalPresence) {
      failures.push({ gate: "crossNationalPresence", required: gates.crossNationalPresence, actual: crossNationalPresence });
    }
  }

  return {
    ok: failures.length === 0,
    passed: failures.length === 0,
    targetTier,
    failures,
    gatesChecked: Object.keys(gates).length,
  };
}

/**
 * Check promotion eligibility from one tier to the next.
 */
export function checkPromotionEligibility({
  fromTier, authorityScore = 0, citationCount = 0, ageHours = 0,
  crossRegionalPresence = 0, crossNationalPresence = 0,
}) {
  if (fromTier === "regional") {
    const promo = TIER_QUALITY_GATES.regional.promotionToNational;
    const failures = [];
    if (authorityScore < promo.minAuthorityScore)
      {failures.push({ gate: "minAuthorityScore", required: promo.minAuthorityScore, actual: authorityScore });}
    if (citationCount < promo.minCitations)
      {failures.push({ gate: "minCitations", required: promo.minCitations, actual: citationCount });}
    if (ageHours < promo.minAgeHours)
      {failures.push({ gate: "minAgeHours", required: promo.minAgeHours, actual: ageHours });}
    return { ok: failures.length === 0, from: "regional", to: "national", failures };
  }

  if (fromTier === "national") {
    const promo = TIER_QUALITY_GATES.national.promotionToGlobal;
    const failures = [];
    if (authorityScore < promo.minAuthorityScore)
      {failures.push({ gate: "minAuthorityScore", required: promo.minAuthorityScore, actual: authorityScore });}
    if (citationCount < promo.minCitations)
      {failures.push({ gate: "minCitations", required: promo.minCitations, actual: citationCount });}
    if (ageHours < promo.minAgeDays * 24)
      {failures.push({ gate: "minAgeDays", required: promo.minAgeDays, actual: Math.floor(ageHours / 24) });}
    if (crossRegionalPresence < promo.crossRegionalPresence)
      {failures.push({ gate: "crossRegionalPresence", required: promo.crossRegionalPresence, actual: crossRegionalPresence });}
    return { ok: failures.length === 0, from: "national", to: "global", failures };
  }

  return { ok: false, error: "invalid_from_tier" };
}

function _allowedTiers(gates) {
  const allowed = [];
  if (gates.allowShadowTier) allowed.push("shadow");
  if (gates.allowRegularTier) allowed.push("regular");
  if (gates.allowMegaTier) allowed.push("mega");
  if (gates.allowHyperTier) allowed.push("hyper");
  return allowed;
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — TIER CONTENT TRACKING (Promotion Audit Trail)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a DTU's presence in a specific federation tier.
 * Creates an entry in tier_content when a DTU is promoted.
 */
export function recordTierContent(db, { contentId, federationTier, promotedFromTier = null, promotedBy = null, authorityScore = null, citationCount = null }) {
  if (!contentId || !federationTier) return { ok: false, error: "missing_required_fields" };

  const id = uid("tc");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO tier_content (id, original_content_id, federation_tier, promoted_from_tier, promoted_at, promoted_by, authority_at_promotion, citation_count_at_promotion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, contentId, federationTier, promotedFromTier, now, promotedBy, authorityScore, citationCount);
    return { ok: true, tierContentId: id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get all tiers a piece of content exists at.
 */
export function getContentTiers(db, contentId) {
  const rows = db.prepare(
    "SELECT * FROM tier_content WHERE original_content_id = ? ORDER BY promoted_at"
  ).all(contentId);
  return {
    ok: true,
    tiers: rows.map(r => ({
      id: r.id,
      tier: r.federation_tier,
      promotedFrom: r.promoted_from_tier,
      promotedAt: r.promoted_at,
      promotedBy: r.promoted_by,
      authorityAtPromotion: r.authority_at_promotion,
      citationCountAtPromotion: r.citation_count_at_promotion,
    })),
    tiersPresent: rows.map(r => r.federation_tier),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — MULTI-TIER ROYALTY STREAMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate multi-tier royalty summary for a creator's content.
 * A single piece of content can earn royalties at every tier simultaneously.
 */
export function getMultiTierRoyalties(db, { creatorId, contentId }) {
  const tiers = db.prepare(
    "SELECT * FROM tier_content WHERE original_content_id = ?"
  ).all(contentId);

  const streams = tiers.map(tc => ({
    tier: tc.federation_tier,
    tierContentId: tc.id,
    promotedAt: tc.promoted_at,
  }));

  return {
    ok: true,
    creatorId,
    originalContentId: contentId,
    streams,
    tiersPresent: streams.map(s => s.tier),
    totalStreams: streams.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — QUEST & XP ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Award XP to a user for a specific tier.
 */
export function awardXP(db, { userId, federationTier, regional = null, national = null, xpAmount, season = null }) {
  if (!userId || !federationTier || !xpAmount) return { ok: false, error: "missing_required_fields" };

  const regKey = regional || "";
  const natKey = national || "";
  const seasonKey = season || "";

  // Upsert XP
  const existing = db.prepare(`
    SELECT total_xp, level FROM user_xp
    WHERE user_id = ? AND federation_tier = ?
      AND COALESCE(regional,'') = ? AND COALESCE(national,'') = ? AND COALESCE(season,'') = ?
  `).get(userId, federationTier, regKey, natKey, seasonKey);

  const newXp = (existing?.total_xp || 0) + xpAmount;
  const newLevel = _calculateLevel(federationTier, newXp);
  const now = nowISO();

  if (existing) {
    db.prepare(`
      UPDATE user_xp SET total_xp = ?, level = ?, updated_at = ?
      WHERE user_id = ? AND federation_tier = ?
        AND COALESCE(regional,'') = ? AND COALESCE(national,'') = ? AND COALESCE(season,'') = ?
    `).run(newXp, newLevel, now, userId, federationTier, regKey, natKey, seasonKey);
  } else {
    db.prepare(`
      INSERT INTO user_xp (user_id, federation_tier, regional, national, total_xp, level, season, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, federationTier, regional, national, newXp, newLevel, season, now);
  }

  return { ok: true, userId, federationTier, totalXp: newXp, level: newLevel, xpAwarded: xpAmount };
}

/**
 * Complete a quest for a user.
 */
export function completeQuest(db, { userId, questId, federationTier, regional = null, national = null }) {
  if (!userId || !questId || !federationTier) return { ok: false, error: "missing_required_fields" };

  // Check if already completed
  const existing = db.prepare(
    "SELECT id FROM quest_completions WHERE user_id = ? AND quest_id = ? AND federation_tier = ?"
  ).get(userId, questId, federationTier);
  if (existing) return { ok: false, error: "quest_already_completed" };

  // Find quest definition
  const tierQuests = TIER_QUESTS[federationTier];
  if (!tierQuests) return { ok: false, error: "invalid_tier" };
  const quest = tierQuests.questTypes.find(q => q.id === questId);
  if (!quest) return { ok: false, error: "quest_not_found" };

  const id = uid("qc");
  const now = nowISO();

  // Quests reward XP and badges only — no coin rewards (constitutional invariant)
  db.prepare(`
    INSERT INTO quest_completions (id, user_id, quest_id, federation_tier, regional, national, xp_awarded, coin_awarded, badge_awarded, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, questId, federationTier, regional, national, quest.xpReward, 0, quest.badge, now);

  // Award XP
  awardXP(db, { userId, federationTier, regional, national, xpAmount: quest.xpReward });

  return {
    ok: true,
    questId,
    xpAwarded: quest.xpReward,
    badgeAwarded: quest.badge,
  };
}

/**
 * Get a user's XP and level for a tier.
 */
export function getUserXP(db, { userId, federationTier, regional = null, national = null, season = null }) {
  const regKey = regional || "";
  const natKey = national || "";
  const seasonKey = season || "";

  const row = db.prepare(`
    SELECT total_xp, level FROM user_xp
    WHERE user_id = ? AND federation_tier = ?
      AND COALESCE(regional,'') = ? AND COALESCE(national,'') = ? AND COALESCE(season,'') = ?
  `).get(userId, federationTier, regKey, natKey, seasonKey);

  if (!row) return { ok: true, totalXp: 0, level: 1 };
  return { ok: true, totalXp: row.total_xp, level: row.level };
}

/**
 * Get completed quests for a user at a tier.
 */
export function getUserQuestCompletions(db, { userId, federationTier = null }) {
  let sql = "SELECT * FROM quest_completions WHERE user_id = ?";
  const params = [userId];
  if (federationTier) { sql += " AND federation_tier = ?"; params.push(federationTier); }
  sql += " ORDER BY completed_at DESC";

  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    completions: rows.map(r => ({
      id: r.id,
      questId: r.quest_id,
      federationTier: r.federation_tier,
      xpAwarded: r.xp_awarded,
      badgeAwarded: r.badge_awarded,
      completedAt: r.completed_at,
    })),
  };
}

/**
 * Calculate level from XP based on tier-specific thresholds.
 */
function _calculateLevel(federationTier, totalXp) {
  const tierQuests = TIER_QUESTS[federationTier];
  if (!tierQuests) return 1;

  let level = 1;
  for (const lvl of tierQuests.xpLevels) {
    if (totalXp >= lvl.xpRequired) level = lvl.level;
  }
  return level;
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1 — KNOWLEDGE RACE SEASONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new knowledge race season.
 */
export function createRaceSeason(db, { name, startDate, endDate }) {
  if (!name || !startDate || !endDate) return { ok: false, error: "missing_required_fields" };

  const id = uid("season");
  db.prepare(`
    INSERT INTO race_seasons (id, season_name, start_date, end_date, status)
    VALUES (?, ?, ?, ?, 'upcoming')
  `).run(id, name, startDate, endDate);

  return { ok: true, season: { id, name, startDate, endDate, status: "upcoming" } };
}

/**
 * Get the currently active race season.
 */
export function getActiveSeason(db) {
  const row = db.prepare("SELECT * FROM race_seasons WHERE status = 'active' LIMIT 1").get();
  if (!row) return { ok: true, season: null };
  return {
    ok: true,
    season: {
      id: row.id,
      name: row.season_name,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
    },
  };
}

/**
 * Get tier heartbeat configuration.
 */
export function getTierHeartbeat(tier) {
  return TIER_HEARTBEATS[tier] || null;
}

/**
 * Get the federation flow invariant (for introspection / constitution checks).
 */
export function getFederationFlowInvariant() {
  return { ...FEDERATION_FLOW };
}

/**
 * Update user federation preferences.
 */
export function updateFederationPreferences(db, { userId, preferences }) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  if (!preferences || typeof preferences !== "object") return { ok: false, error: "invalid_preferences" };

  const user = db.prepare("SELECT id, federation_preferences_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const current = JSON.parse(user.federation_preferences_json || "{}");
  const merged = { ...current, ...preferences };

  db.prepare("UPDATE users SET federation_preferences_json = ? WHERE id = ?")
    .run(JSON.stringify(merged), userId);

  return { ok: true, preferences: merged };
}

/**
 * Get user federation preferences.
 */
export function getFederationPreferences(db, userId) {
  const user = db.prepare("SELECT federation_preferences_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };
  return { ok: true, preferences: JSON.parse(user.federation_preferences_json || "{}") };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1.1 — COUNCIL DEDUP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a dedup review request when automated check finds similar content.
 */
export function createDedupReview(db, { contentId, targetTier, similarItems = [], highestSimilarity = 0 }) {
  if (!contentId || !targetTier) return { ok: false, error: "missing_required_fields" };

  const id = uid("dedup");
  db.prepare(`
    INSERT INTO dedup_reviews (id, content_id, target_tier, similar_items_json, highest_similarity, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, contentId, targetTier, JSON.stringify(similarItems), highestSimilarity);

  const config = DEDUP_PROTOCOL.council[targetTier];
  return {
    ok: true,
    reviewId: id,
    status: "held_for_review",
    dedupVerified: false,
    timeoutHours: config?.timeoutHours || 48,
  };
}

/**
 * Process a council dedup decision.
 */
export function processDedupDecision(db, { reviewId, decision, reviewerId }) {
  if (!reviewId || !decision || !reviewerId) return { ok: false, error: "missing_required_fields" };

  const validDecisions = ["approve", "reject_duplicate", "merge_with_existing"];
  if (!validDecisions.includes(decision)) return { ok: false, error: "invalid_decision" };


  const review = db.prepare("SELECT * FROM dedup_reviews WHERE id = ?").get(reviewId);
  if (!review) return { ok: false, error: "review_not_found" };
  if (review.status !== "pending") return { ok: false, error: "review_already_processed" };

  const now = nowISO();

  // Update review status
  db.prepare("UPDATE dedup_reviews SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
    .run(decision === "approve" ? "approved" : decision === "reject_duplicate" ? "rejected_duplicate" : "merged",
      reviewerId, now, reviewId);

  if (decision === "approve") {
    // Mark listing as dedup verified
    db.prepare("UPDATE marketplace_economy_listings SET dedup_verified = 1 WHERE id = ?")
      .run(review.content_id);
  } else if (decision === "reject_duplicate") {
    db.prepare(`
      UPDATE marketplace_economy_listings
      SET status = 'flagged', rejection_reason = 'Duplicate of existing listing', similar_to = ?
      WHERE id = ?
    `).run(review.similar_items_json, review.content_id);
  }

  return { ok: true, reviewId, decision, processedAt: now };
}

/**
 * Get pending dedup reviews for a tier.
 */
export function getPendingDedupReviews(db, { targetTier = null, limit = 50 } = {}) {
  let sql = "SELECT * FROM dedup_reviews WHERE status = 'pending'";
  const params = [];
  if (targetTier) { sql += " AND target_tier = ?"; params.push(targetTier); }
  sql += " ORDER BY created_at ASC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    reviews: rows.map(r => ({
      id: r.id,
      contentId: r.content_id,
      targetTier: r.target_tier,
      similarItems: JSON.parse(r.similar_items_json || "[]"),
      highestSimilarity: r.highest_similarity,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get the dedup protocol config.
 */
export function getDedupProtocol() {
  return { ...DEDUP_PROTOCOL };
}

/**
 * Get integrity invariants.
 */
export function getIntegrityInvariants() {
  return { ...INTEGRITY_INVARIANTS };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1.1 — MARKETPLACE FILTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user marketplace filter preferences.
 */
export function updateMarketplaceFilters(db, { userId, filters }) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  if (!filters || typeof filters !== "object") return { ok: false, error: "invalid_filters" };

  const user = db.prepare("SELECT id, marketplace_filters_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const current = JSON.parse(user.marketplace_filters_json || "{}");
  const merged = { ...current, ...filters };

  db.prepare("UPDATE users SET marketplace_filters_json = ? WHERE id = ?")
    .run(JSON.stringify(merged), userId);

  return { ok: true, filters: merged };
}

/**
 * Get user marketplace filters.
 */
export function getMarketplaceFilters(db, userId) {
  const user = db.prepare("SELECT marketplace_filters_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };
  return { ok: true, filters: JSON.parse(user.marketplace_filters_json || "{}") };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1.1 — WEALTH PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user wealth recirculation preferences.
 */
export function updateWealthPreferences(db, { userId, preferences }) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  if (!preferences || typeof preferences !== "object") return { ok: false, error: "invalid_preferences" };

  const user = db.prepare("SELECT id, wealth_preferences_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const current = JSON.parse(user.wealth_preferences_json || "{}");
  const merged = { ...current, ...preferences };

  db.prepare("UPDATE users SET wealth_preferences_json = ? WHERE id = ?")
    .run(JSON.stringify(merged), userId);

  return { ok: true, preferences: merged };
}

/**
 * Get user wealth preferences.
 */
export function getWealthPreferences(db, userId) {
  const user = db.prepare("SELECT wealth_preferences_json FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };
  return { ok: true, preferences: JSON.parse(user.wealth_preferences_json || "{}") };
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.1.1 — LEADERBOARD ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update a leaderboard entry for a user.
 */
export function updateLeaderboardEntry(db, { userId, scope, scopeId, category, season = null, score, rank }) {
  if (!userId || !scope || !scopeId || !category) return { ok: false, error: "missing_required_fields" };

  const seasonKey = season || "";
  const now = nowISO();

  const existing = db.prepare(`
    SELECT user_id FROM leaderboard_entries
    WHERE user_id = ? AND scope = ? AND scope_id = ? AND category = ? AND COALESCE(season,'') = ?
  `).get(userId, scope, scopeId, category, seasonKey);

  if (existing) {
    db.prepare(`
      UPDATE leaderboard_entries SET score = ?, rank = ?, updated_at = ?
      WHERE user_id = ? AND scope = ? AND scope_id = ? AND category = ? AND COALESCE(season,'') = ?
    `).run(score, rank, now, userId, scope, scopeId, category, seasonKey);
  } else {
    db.prepare(`
      INSERT INTO leaderboard_entries (user_id, scope, scope_id, category, season, score, rank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, scope, scopeId, category, season, score, rank, now);
  }

  return { ok: true, userId, scope, scopeId, category, score, rank };
}

/**
 * Get leaderboard entries for a scope.
 */
export function getLeaderboard(db, { scope, scopeId, category, season = null, limit = 50 }) {
  if (!scope || !scopeId || !category) return { ok: false, error: "missing_required_fields" };

  const seasonKey = season || "";
  // TODO: project explicit columns (auto-fix suggestion)
  const rows = db.prepare(`
    SELECT * FROM leaderboard_entries
    WHERE scope = ? AND scope_id = ? AND category = ? AND COALESCE(season,'') = ?
    ORDER BY rank ASC LIMIT ?
  `).all(scope, scopeId, category, seasonKey, limit);

  return {
    ok: true,
    entries: rows.map(r => ({
      userId: r.user_id,
      score: r.score,
      rank: r.rank,
      updatedAt: r.updated_at,
    })),
  };
}

/**
 * Cross-instance DTU purchase scaffold.
 *
 * Phase 1 of the federation marketplace: when a buyer purchases a DTU
 * whose origin is a remote peer, this routes the request through the
 * peer's marketplace.purchaseWithRoyalties endpoint, then mirrors the
 * purchased envelope locally so the buyer's wallet+royalty cascade pays
 * out the right way on this instance.
 *
 * Two halves of the flow live in different modules:
 *   - This function: discovers the peer, posts the purchase request,
 *     receives the signed DTU envelope back. Stops there.
 *   - Caller (server.js marketplace.purchaseWithRoyalties branch on
 *     dtu.origin_peer_id): on success, runs importEnvelope() so the DTU
 *     + attachments + citations land locally; the cascade then works
 *     against local creator records.
 *
 * Designed so a federation peer that doesn't speak this protocol just
 * returns 404 and the call falls through to local-only error handling.
 */
export async function remotePurchase(db, { peerId, dtuId, buyerId, priceCents }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!peerId || !dtuId || !buyerId) return { ok: false, reason: "missing_inputs" };

  // Discover peer's base URL via the registered CRI instances + its
  // declared peer endpoint. We accept either a regional CRI id or a
  // direct hostname for symmetry with self-hosted single-instance peers.
  let peerUrl = null;
  try {
    const cri = db.prepare(`SELECT capabilities FROM cri_instances WHERE id = ?`).get(peerId);
    if (cri?.capabilities) {
      try {
        const caps = JSON.parse(cri.capabilities);
        peerUrl = caps.marketplaceEndpoint || caps.baseUrl || null;
      } catch { /* malformed capabilities row — fall through */ }
    }
  } catch { /* cri_instances table optional in minimal builds */ }
  if (!peerUrl && /^https?:\/\//i.test(peerId)) peerUrl = peerId.replace(/\/+$/, "");
  if (!peerUrl) return { ok: false, reason: "peer_unreachable" };

  const url = `${peerUrl}/api/marketplace/purchaseWithRoyalties`;
  let envelope = null;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CONCORD_FEDERATION_TOKEN
          ? { Authorization: `Bearer ${process.env.CONCORD_FEDERATION_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ dtuId, buyerId, priceCents, federation: true, includeAttachments: true }),
    });
    if (!resp.ok) {
      return { ok: false, reason: "peer_rejected", status: resp.status };
    }
    envelope = await resp.json();
  } catch (err) {
    return { ok: false, reason: "peer_network_error", error: String(err?.message || err) };
  }

  if (!envelope || !envelope.dtus || !Array.isArray(envelope.dtus)) {
    return { ok: false, reason: "peer_returned_invalid_envelope" };
  }

  // Mirror locally via the existing portability path so attachments are
  // restored to artifact-store and citations land in dtu_citations.
  let imported = null;
  try {
    const port = await import("./dtu-portability.js");
    imported = await port.importEnvelope(db, envelope, {
      importCitations: true,
      importAttachments: true,
    });
  } catch (err) {
    return { ok: false, reason: "local_import_failed", error: String(err?.message || err) };
  }

  return {
    ok: imported?.ok === true,
    dtuId,
    peerId,
    imported,
    signature: envelope.instance_signature || null,
  };
}
