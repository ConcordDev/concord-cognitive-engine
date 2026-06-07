/**
 * Concord Lens & Culture Engine — v1.3
 *
 * Culture DTU lifecycle, resonance/reflections, lens protection,
 * one-tap purchase, artifact export, sovereign biomonitor,
 * grief protocol, Great Merge, lens registration & validation.
 */

import { randomUUID } from "crypto";
import { purchaseArtifact, getArtifact } from "./creative-marketplace.js";
import { CREDIT_ROW_PREDICATE } from "./balances.js";
import {
  CULTURE_GATING,
  CULTURE_RESTRICTIONS,
  LENS_PROTECTION_SYSTEM,
  LENS_VALIDATOR,
  LENS_CONSTANTS,
  SOVEREIGN_BIOMONITOR,
  GRIEF_PROTOCOL,
  SYSTEM_LENS_DECLARATIONS,
} from "../lib/lens-culture-constants.js";

function uid(prefix = "cd") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ─────────────────────────────────────────────────────────────────────
// Culture DTU Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Post a culture DTU. Culture is region/nation locked.
 * Only declared residents may post. Emergents CANNOT post.
 */
export function postCultureDTU(db, {
  creatorId, cultureTier, contentType, title, body, media, tags, mood,
}) {
  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!cultureTier) return { ok: false, error: "missing_culture_tier" };
  if (!contentType) return { ok: false, error: "missing_content_type" };
  if (!["text", "image", "audio", "video", "mixed"].includes(contentType)) {
    return { ok: false, error: "invalid_content_type" };
  }
  if (!["regional", "national"].includes(cultureTier)) {
    return { ok: false, error: "invalid_culture_tier", validTiers: ["regional", "national"] };
  }
  if (!body && (!media || media.length === 0)) {
    return { ok: false, error: "empty_content" };
  }

  // Validate media limits
  if (media && media.length > LENS_CONSTANTS.CULTURE_MAX_MEDIA_PER_POST) {
    return { ok: false, error: "too_many_media", max: LENS_CONSTANTS.CULTURE_MAX_MEDIA_PER_POST };
  }

  // Look up user's declared location
  const user = db.prepare("SELECT id, role, declared_regional, declared_national FROM users WHERE id = ?").get(creatorId);
  if (!user) return { ok: false, error: "user_not_found" };

  // Emergent check — emergents CANNOT post to culture
  if (user.role === "emergent") {
    return { ok: false, error: "emergent_cannot_post_culture" };
  }

  // Region/nation gating — CONSTITUTIONAL
  const regional = user.declared_regional;
  const national = user.declared_national;

  if (!regional || !national) {
    return { ok: false, error: "no_declared_location" };
  }

  const now = nowISO();
  const id = uid("cd");

  try {
    db.prepare(`
      INSERT INTO culture_dtus (
        id, creator_id, culture_tier, regional, national,
        content_type, title, body, media_json, tags_json, mood,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, creatorId, cultureTier, regional, national,
      contentType, title || null, body || null,
      JSON.stringify(media || []),
      JSON.stringify(tags || []),
      mood || null,
      now, now,
    );

    return {
      ok: true,
      cultureDTU: {
        id, creatorId, cultureTier, regional, national,
        contentType, title, body,
        media: media || [],
        tags: tags || [],
        mood: mood || null,
        resonanceCount: 0,
        reflectionCount: 0,
        createdAt: now,
      },
    };
  } catch (err) {
    console.error("[economy] post_failed:", err.message);
    return { ok: false, error: "post_failed" };
  }
}

/**
 * Get a single culture DTU by ID.
 * Enforces regional/national viewing gating unless merge is complete.
 */
export function getCultureDTU(db, dtuId, { viewerId } = {}) {
  const row = db.prepare("SELECT * FROM culture_dtus WHERE id = ?").get(dtuId);
  if (!row) return null;

  // Check merge status for global visibility
  const merge = db.prepare("SELECT * FROM great_merge WHERE id = 'singleton'").get();
  const mergeComplete = merge && (merge.status === "complete" || merge.phase !== "pre_merge");

  // If merge hasn't happened, enforce gating
  if (!mergeComplete && viewerId) {
    const viewer = db.prepare("SELECT id, role, declared_regional, declared_national FROM users WHERE id = ?").get(viewerId);
    if (viewer) {
      if (row.culture_tier === "regional" && viewer.declared_regional !== row.regional) {
        return { restricted: true, error: "not_your_region" };
      }
      if (row.culture_tier === "national" && viewer.declared_national !== row.national) {
        return { restricted: true, error: "not_your_nation" };
      }
    }
  }

  return formatCultureDTU(row);
}

/**
 * Browse culture DTUs for a region or nation.
 * Chronological ONLY — no algorithmic ranking.
 */
export function browseCulture(db, {
  cultureTier, regional, national, viewerId,
  sort = "newest", limit = 50, offset = 0,
}) {
  if (!cultureTier) return { ok: false, error: "missing_culture_tier" };

  // Check merge status
  const merge = db.prepare("SELECT * FROM great_merge WHERE id = 'singleton'").get();
  const mergeComplete = merge && (merge.status === "complete" || merge.phase !== "pre_merge");

  // Before merge, enforce gating
  if (!mergeComplete && viewerId) {
    const viewer = db.prepare("SELECT id, role, declared_regional, declared_national FROM users WHERE id = ?").get(viewerId);
    if (viewer) {
      if (cultureTier === "regional" && regional && viewer.declared_regional !== regional) {
        return { ok: false, error: "not_your_region" };
      }
      if (cultureTier === "national" && national && viewer.declared_national !== national) {
        return { ok: false, error: "not_your_nation" };
      }
    }
  }

  const orderDir = sort === "oldest" ? "ASC" : "DESC";
  let where = "WHERE culture_tier = ?";
  const params = [cultureTier];

  if (regional) {
    where += " AND regional = ?";
    params.push(regional);
  }
  if (national) {
    where += " AND national = ?";
    params.push(national);
  }

  const rows = db.prepare(`
    SELECT * FROM culture_dtus ${where}
    ORDER BY created_at ${orderDir}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { ok: true, cultureDTUs: rows.map(formatCultureDTU), sort, limit, offset };
}

// ─────────────────────────────────────────────────────────────────────
// Resonance & Reflections
// ─────────────────────────────────────────────────────────────────────

/**
 * Give resonance to a culture DTU. Not a like — a resonance.
 * Only declared residents of the same region/nation can resonate.
 */
export function resonateCulture(db, { userId, dtuId }) {
  if (!userId || !dtuId) return { ok: false, error: "missing_required_fields" };

  const dtu = db.prepare("SELECT * FROM culture_dtus WHERE id = ?").get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  // Verify residency
  const user = db.prepare("SELECT id, role, declared_regional, declared_national FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  if (dtu.culture_tier === "regional" && user.declared_regional !== dtu.regional) {
    return { ok: false, error: "not_your_region" };
  }
  if (dtu.culture_tier === "national" && user.declared_national !== dtu.national) {
    return { ok: false, error: "not_your_nation" };
  }

  try {
    db.prepare(`
      INSERT INTO culture_resonance (culture_dtu_id, user_id, created_at)
      VALUES (?, ?, ?)
    `).run(dtuId, userId, nowISO());

    db.prepare(`
      UPDATE culture_dtus SET resonance_count = resonance_count + 1, updated_at = ?
      WHERE id = ?
    `).run(nowISO(), dtuId);

    const updated = db.prepare("SELECT resonance_count FROM culture_dtus WHERE id = ?").get(dtuId);
    if (!updated) return { ok: false, error: "culture_dtu_not_found" };

    return { ok: true, dtuId, resonanceCount: updated.resonance_count };
  } catch (err) {
    if (err.message.includes("UNIQUE") || err.message.includes("PRIMARY KEY")) {
      return { ok: false, error: "already_resonated" };
    }
    console.error("[economy] resonance_failed:", err.message);
    return { ok: false, error: "resonance_failed" };
  }
}

/**
 * Add a reflection (response) to a culture DTU.
 */
export function reflectOnCulture(db, { userId, dtuId, body, media }) {
  if (!userId || !dtuId || !body) return { ok: false, error: "missing_required_fields" };

  const dtu = db.prepare("SELECT * FROM culture_dtus WHERE id = ?").get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  // Verify residency
  const user = db.prepare("SELECT id, role, declared_regional, declared_national FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  if (dtu.culture_tier === "regional" && user.declared_regional !== dtu.regional) {
    return { ok: false, error: "not_your_region" };
  }

  const id = uid("cr");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO culture_reflections (id, culture_dtu_id, creator_id, body, media_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, dtuId, userId, body, JSON.stringify(media || []), now);

    db.prepare(`
      UPDATE culture_dtus SET reflection_count = reflection_count + 1, updated_at = ?
      WHERE id = ?
    `).run(now, dtuId);

    const updated = db.prepare("SELECT reflection_count FROM culture_dtus WHERE id = ?").get(dtuId);
    if (!updated) return { ok: false, error: "culture_dtu_not_found" };

    return {
      ok: true,
      reflection: { id, dtuId, creatorId: userId, body, createdAt: now },
      reflectionCount: updated.reflection_count,
    };
  } catch (err) {
    console.error("[economy] reflection_failed:", err.message);
    return { ok: false, error: "reflection_failed" };
  }
}

/**
 * Get reflections for a culture DTU.
 */
export function getReflections(db, dtuId, { limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT * FROM culture_reflections
    WHERE culture_dtu_id = ?
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(dtuId, limit, offset);

  return {
    ok: true,
    reflections: rows.map(r => ({
      id: r.id,
      dtuId: r.culture_dtu_id,
      creatorId: r.creator_id,
      body: r.body,
      media: JSON.parse(r.media_json || "[]"),
      createdAt: r.created_at,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lens Protection
// ─────────────────────────────────────────────────────────────────────

/**
 * Set or override lens protection mode for an artifact.
 * Culture lens CANNOT be overridden — ISOLATED forever.
 */
export function setLensProtection(db, { artifactId, lensId, protectionMode, creatorId }) {
  if (!artifactId || !lensId || !protectionMode) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (!LENS_PROTECTION_SYSTEM.modes[protectionMode]) {
    return { ok: false, error: "invalid_protection_mode", validModes: Object.keys(LENS_PROTECTION_SYSTEM.modes) };
  }

  // Culture lens is ALWAYS isolated — no override
  if (lensId === "culture") {
    return { ok: false, error: "culture_lens_isolated_forever" };
  }

  // Get the default mode for this lens
  const defaultMode = LENS_PROTECTION_SYSTEM.lensDefaults[lensId];
  const isOverride = defaultMode && defaultMode !== protectionMode;

  // Validate override permissions
  if (isOverride) {
    const overrideKey = `${defaultMode}_to_${protectionMode}`;
    if (!LENS_PROTECTION_SYSTEM.lensDefaults.creatorOverride[overrideKey]) {
      return { ok: false, error: "override_not_allowed", from: defaultMode, to: protectionMode };
    }
  }

  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO lens_protection (artifact_id, lens_id, protection_mode, creator_override, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (artifact_id, lens_id)
      DO UPDATE SET protection_mode = ?, creator_override = ?, created_at = ?
    `).run(artifactId, lensId, protectionMode, isOverride ? 1 : 0, now, protectionMode, isOverride ? 1 : 0, now);

    return { ok: true, artifactId, lensId, protectionMode, isOverride };
  } catch (err) {
    console.error("[economy] set_protection_failed:", err.message);
    return { ok: false, error: "set_protection_failed" };
  }
}

/**
 * Get the effective protection mode for an artifact in a lens.
 */
export function getLensProtection(db, artifactId, lensId) {
  const row = db.prepare(
    "SELECT * FROM lens_protection WHERE artifact_id = ? AND lens_id = ?"
  ).get(artifactId, lensId);

  if (row) {
    return {
      protectionMode: row.protection_mode,
      isOverride: !!row.creator_override,
    };
  }

  // Fall back to lens default
  const defaultMode = LENS_PROTECTION_SYSTEM.lensDefaults[lensId] || "PROTECTED";
  return { protectionMode: defaultMode, isOverride: false };
}

/**
 * Check if an action is allowed under the current protection mode.
 */
export function checkProtectionAllows(db, { artifactId, lensId, action, userId }) {
  const protection = getLensProtection(db, artifactId, lensId);
  const modeRules = LENS_PROTECTION_SYSTEM.modes[protection.protectionMode];

  if (!modeRules) return { allowed: false, reason: "unknown_protection_mode" };

  // Check if the action is explicitly allowed by the mode
  if (action === "citation" && modeRules.citation) return { allowed: true };
  if (action === "derivative" && modeRules.derivative) return { allowed: true };
  if (action === "export" && modeRules.export) return { allowed: true };

  // If action is blocked, check if user has a purchase license
  if (modeRules.purchaseUnlocks) {
    if (!userId) return { allowed: false, reason: "purchase_required" };

    const license = db.prepare(`
      SELECT id FROM creative_usage_licenses
      WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'
    `).get(artifactId, userId);

    if (license) {
      // Check if this specific action is unlocked by purchase
      if (modeRules.purchaseUnlocks === true) return { allowed: true };
      if (Array.isArray(modeRules.purchaseUnlocks) && modeRules.purchaseUnlocks.includes(action)) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: "purchase_required" };
  }

  return { allowed: false, reason: "action_not_permitted" };
}

// ─────────────────────────────────────────────────────────────────────
// One-Tap Purchase (lens inline purchase)
// ─────────────────────────────────────────────────────────────────────

/**
 * One-tap purchase from within a lens.
 * Delegates to the standard marketplace purchase flow.
 */
export function oneTapPurchase(db, { userId, artifactId, requestId, ip }) {
  if (!userId || !artifactId) return { ok: false, error: "missing_required_fields" };

  // Check artifact exists and get price
  const artifact = getArtifact(db, artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };

  // Check user balance
  const balanceRow = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN to_user_id = ? AND ${CREDIT_ROW_PREDICATE} THEN net ELSE 0 END) -
           SUM(CASE WHEN from_user_id = ? THEN amount ELSE 0 END), 0) as balance
    FROM economy_ledger WHERE (to_user_id = ? OR from_user_id = ?) AND status = 'complete'
  `).get(userId, userId, userId, userId);

  const balance = balanceRow?.balance || 0;

  if (balance < artifact.price) {
    return {
      ok: false,
      error: "insufficient_balance",
      needed: artifact.price - balance,
      currentBalance: balance,
    };
  }

  // Execute through standard marketplace flow
  const result = purchaseArtifact(db, { buyerId: userId, artifactId, requestId, ip });

  if (!result.ok) return result;

  return {
    ok: true,
    licenseId: result.licenseId,
    exportEnabled: true,
    newBalance: balance - artifact.price,
    artistPaid: result.creatorEarnings,
    purchase: result,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Artifact Export
// ─────────────────────────────────────────────────────────────────────

/**
 * Export a purchased artifact. Requires active license.
 * Export is unlimited once purchased. No DRM. No expiry.
 */
export function exportArtifact(db, { userId, artifactId }) {
  if (!userId || !artifactId) return { ok: false, error: "missing_required_fields" };

  // Verify active license
  const license = db.prepare(`
    SELECT id, status FROM creative_usage_licenses
    WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'
  `).get(artifactId, userId);

  if (!license) {
    return {
      ok: false,
      error: "no_active_license",
      message: "Purchase this artifact to enable export",
    };
  }

  const artifact = getArtifact(db, artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };

  // Log export (analytics only — no restriction)
  const exportId = uid("exp");
  db.prepare(`
    INSERT INTO artifact_exports (id, artifact_id, user_id, exported_at)
    VALUES (?, ?, ?, ?)
  `).run(exportId, artifactId, userId, nowISO());

  return {
    ok: true,
    exportId,
    filePath: artifact.filePath,
    fileName: artifact.title,
    fileSize: artifact.fileSize,
    artifactType: artifact.type,
  };
}

/**
 * Get export history for a user or artifact.
 */
export function getExportHistory(db, { userId, artifactId, limit = 50, offset = 0 }) {
  let where = "WHERE 1=1";
  const params = [];

  if (userId) { where += " AND user_id = ?"; params.push(userId); }
  if (artifactId) { where += " AND artifact_id = ?"; params.push(artifactId); }

  const rows = db.prepare(`
    SELECT * FROM artifact_exports ${where}
    ORDER BY exported_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    ok: true,
    exports: rows.map(r => ({
      id: r.id,
      artifactId: r.artifact_id,
      userId: r.user_id,
      exportedAt: r.exported_at,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sovereign Biomonitor
// ─────────────────────────────────────────────────────────────────────

/**
 * Record a biomonitor reading.
 */
export function recordBiomonitorReading(db, {
  heartRate, bloodOxygen, bodyTemperature, movementDetected, rawData, notes,
}) {
  const id = uid("bio");
  const now = nowISO();

  // Determine alert level based on thresholds
  const thresholds = SOVEREIGN_BIOMONITOR.inputs;
  let alertLevel = "green";

  if (heartRate !== null && heartRate !== undefined) {
    if (heartRate <= thresholds.heartRate.critical_low || heartRate >= thresholds.heartRate.critical_high) {
      alertLevel = "red";
    } else if (heartRate <= thresholds.heartRate.critical_low + 10 || heartRate >= thresholds.heartRate.critical_high - 10) {
      alertLevel = alertLevel === "red" ? "red" : "orange";
    } else if (heartRate <= thresholds.heartRate.critical_low + 20 || heartRate >= thresholds.heartRate.critical_high - 20) {
      alertLevel = alertLevel === "red" || alertLevel === "orange" ? alertLevel : "yellow";
    }
  }

  if (bloodOxygen !== null && bloodOxygen !== undefined) {
    if (bloodOxygen <= thresholds.bloodOxygen.critical_low) {
      alertLevel = "red";
    } else if (bloodOxygen <= thresholds.bloodOxygen.critical_low + 3) {
      alertLevel = alertLevel === "red" ? "red" : "orange";
    } else if (bloodOxygen <= thresholds.bloodOxygen.critical_low + 7) {
      alertLevel = alertLevel === "red" || alertLevel === "orange" ? alertLevel : "yellow";
    }
  }

  if (bodyTemperature !== null && bodyTemperature !== undefined) {
    if (bodyTemperature <= thresholds.bodyTemperature.critical_low || bodyTemperature >= thresholds.bodyTemperature.critical_high) {
      alertLevel = "red";
    } else if (bodyTemperature <= thresholds.bodyTemperature.critical_low + 2 || bodyTemperature >= thresholds.bodyTemperature.critical_high - 2) {
      alertLevel = alertLevel === "red" ? "red" : "orange";
    }
  }

  try {
    db.prepare(`
      INSERT INTO sovereign_biomonitor (
        id, timestamp, alert_level, heart_rate, blood_oxygen,
        body_temperature, movement_detected, raw_data_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, now, alertLevel,
      heartRate ?? null,
      bloodOxygen ?? null,
      bodyTemperature ?? null,
      movementDetected != null ? (movementDetected ? 1 : 0) : null,
      rawData ? JSON.stringify(rawData) : null,
      notes || null,
    );

    return {
      ok: true,
      reading: {
        id, timestamp: now, alertLevel,
        heartRate, bloodOxygen, bodyTemperature, movementDetected,
      },
      stewardNotification: SOVEREIGN_BIOMONITOR.alertLevels[alertLevel].stewardNotification,
      stewardMessage: SOVEREIGN_BIOMONITOR.alertLevels[alertLevel].stewardMessage || null,
      concordAction: SOVEREIGN_BIOMONITOR.alertLevels[alertLevel].concordAction || "none",
    };
  } catch (err) {
    console.error("[economy] reading_failed:", err.message);
    return { ok: false, error: "reading_failed" };
  }
}

/**
 * Get latest biomonitor reading.
 */
export function getLatestBiomonitorReading(db) {
  const row = db.prepare(
    "SELECT * FROM sovereign_biomonitor ORDER BY timestamp DESC LIMIT 1"
  ).get();
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    alertLevel: row.alert_level,
    heartRate: row.heart_rate,
    bloodOxygen: row.blood_oxygen,
    bodyTemperature: row.body_temperature,
    movementDetected: !!row.movement_detected,
  };
}

/**
 * Get biomonitor history.
 */
export function getBiomonitorHistory(db, { limit = 100, alertLevel } = {}) {
  // @select-star-ok: sovereign_biomonitor admin history — full row needed
  let query = "SELECT * FROM sovereign_biomonitor";
  const params = [];
  if (alertLevel) {
    query += " WHERE alert_level = ?";
    params.push(alertLevel);
  }
  query += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  return {
    ok: true,
    readings: rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      alertLevel: r.alert_level,
      heartRate: r.heart_rate,
      bloodOxygen: r.blood_oxygen,
      bodyTemperature: r.body_temperature,
      movementDetected: !!r.movement_detected,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Grief Protocol
// ─────────────────────────────────────────────────────────────────────

/**
 * Initialize grief protocol singleton (call once at startup).
 */
export function initGriefProtocol(db) {
  const existing = db.prepare("SELECT * FROM grief_protocol WHERE id = 'singleton'").get();
  if (existing) return { ok: true, status: existing.status };

  db.prepare(`
    INSERT INTO grief_protocol (id, status) VALUES ('singleton', 'inactive')
  `).run();

  return { ok: true, status: "inactive" };
}

/**
 * Activate the grief protocol. Triggered by biomonitor red or steward council.
 */
export function activateGriefProtocol(db, { activatedBy }) {
  if (!activatedBy) return { ok: false, error: "missing_activated_by" };
  if (!GRIEF_PROTOCOL.activatedBy.includes(activatedBy)) {
    return { ok: false, error: "invalid_activation_trigger", validTriggers: GRIEF_PROTOCOL.activatedBy };
  }

  const current = db.prepare("SELECT * FROM grief_protocol WHERE id = 'singleton'").get();
  if (current && current.status !== "inactive") {
    return { ok: false, error: "grief_already_active", currentStatus: current.status };
  }

  const now = nowISO();
  const griefEnd = new Date();
  griefEnd.setDate(griefEnd.getDate() + GRIEF_PROTOCOL.griefPeriod.duration.minDays);
  const griefEndISO = griefEnd.toISOString().replace("T", " ").replace("Z", "");

  db.prepare(`
    INSERT INTO grief_protocol (id, status, activated_at, activated_by, grief_period_end)
    VALUES ('singleton', 'activated', ?, ?, ?)
    ON CONFLICT (id)
    DO UPDATE SET status = 'activated', activated_at = ?, activated_by = ?, grief_period_end = ?
  `).run(now, activatedBy, griefEndISO, now, activatedBy, griefEndISO);

  return {
    ok: true,
    status: "activated",
    activatedAt: now,
    activatedBy,
    griefPeriodEnd: griefEndISO,
    systemBehavior: GRIEF_PROTOCOL.griefPeriod.systemBehavior,
    sovereignLastDTU: GRIEF_PROTOCOL.sovereignLastDTU,
  };
}

/**
 * Get current grief protocol status.
 */
export function getGriefProtocolStatus(db) {
  const row = db.prepare("SELECT * FROM grief_protocol WHERE id = 'singleton'").get();
  if (!row) return { ok: true, status: "inactive" };

  return {
    ok: true,
    status: row.status,
    activatedAt: row.activated_at,
    activatedBy: row.activated_by,
    griefPeriodEnd: row.grief_period_end,
    transitionEnd: row.transition_end,
    completedAt: row.completed_at,
    stewardDeclarations: JSON.parse(row.steward_declarations_json || "[]"),
  };
}

/**
 * Transition grief protocol to next phase (steward council action).
 */
export function transitionGriefPhase(db, { targetPhase }) {
  if (!targetPhase) return { ok: false, error: "missing_target_phase" };

  const validPhases = ["grief_period", "transition", "complete"];
  if (!validPhases.includes(targetPhase)) {
    return { ok: false, error: "invalid_phase", validPhases };
  }

  const current = db.prepare("SELECT * FROM grief_protocol WHERE id = 'singleton'").get();
  if (!current) return { ok: false, error: "grief_not_initialized" };

  const now = nowISO();
  const updates = { status: targetPhase };

  if (targetPhase === "transition") {
    const transitionEnd = new Date();
    transitionEnd.setDate(transitionEnd.getDate() + GRIEF_PROTOCOL.postGrief.transitionPeriod.durationDays);
    updates.transitionEnd = transitionEnd.toISOString().replace("T", " ").replace("Z", "");
  }

  if (targetPhase === "complete") {
    updates.completedAt = now;
  }

  db.prepare(`
    UPDATE grief_protocol SET
      status = ?,
      transition_end = COALESCE(?, transition_end),
      completed_at = COALESCE(?, completed_at)
    WHERE id = 'singleton'
  `).run(updates.status, updates.transitionEnd || null, updates.completedAt || null);

  return { ok: true, status: targetPhase, ...updates };
}

// ─────────────────────────────────────────────────────────────────────
// Great Merge
// ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the Great Merge countdown (call once at launch).
 */
export function initGreatMerge(db, { launchDate }) {
  if (!launchDate) return { ok: false, error: "missing_launch_date" };

  const launch = new Date(launchDate);
  const mergeDate = new Date(launch);
  mergeDate.setFullYear(mergeDate.getFullYear() + 5);

  const mergeDateISO = mergeDate.toISOString().replace("T", " ").replace("Z", "");

  try {
    db.prepare(`
      INSERT INTO great_merge (id, launch_date, merge_date, status, phase)
      VALUES ('singleton', ?, ?, 'countdown', 'pre_merge')
      ON CONFLICT (id)
      DO UPDATE SET launch_date = ?, merge_date = ?
    `).run(launchDate, mergeDateISO, launchDate, mergeDateISO);

    return { ok: true, launchDate, mergeDate: mergeDateISO, status: "countdown" };
  } catch (err) {
    console.error("[economy] init_failed:", err.message);
    return { ok: false, error: "init_failed" };
  }
}

/**
 * Get Great Merge status and countdown.
 */
export function getGreatMergeStatus(db) {
  const row = db.prepare("SELECT * FROM great_merge WHERE id = 'singleton'").get();
  if (!row) return { ok: true, status: "not_initialized" };

  const now = new Date();
  const mergeDate = new Date(row.merge_date);
  const remainingMs = Math.max(0, mergeDate.getTime() - now.getTime());

  const days = Math.floor(remainingMs / 86400000);
  const hours = Math.floor((remainingMs % 86400000) / 3600000);
  const minutes = Math.floor((remainingMs % 3600000) / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  return {
    ok: true,
    status: row.status,
    phase: row.phase,
    launchDate: row.launch_date,
    mergeDate: row.merge_date,
    countdown: { days, hours, minutes, seconds, remainingMs },
    totalRegionalCultures: row.total_regional_cultures,
    totalNationalCultures: row.total_national_cultures,
    totalCultureDTUs: row.total_culture_dtus,
  };
}

/**
 * Advance the Great Merge to the next phase.
 */
export function advanceMergePhase(db, { targetPhase }) {
  const validPhases = ["unveiling", "weaving", "understanding", "complete"];
  if (!validPhases.includes(targetPhase)) {
    return { ok: false, error: "invalid_phase", validPhases };
  }

  const current = db.prepare("SELECT * FROM great_merge WHERE id = 'singleton'").get();
  if (!current) return { ok: false, error: "merge_not_initialized" };

  const now = nowISO();

  // Count culture DTUs for stats
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN culture_tier = 'regional' THEN regional END) as regional_count,
      COUNT(DISTINCT CASE WHEN culture_tier = 'national' THEN national END) as national_count,
      COUNT(*) as total_dtus
    FROM culture_dtus
  `).get();

  const doAdvance = db.transaction(() => {
    db.prepare(`
      UPDATE great_merge SET
        status = CASE WHEN ? = 'complete' THEN 'complete' ELSE 'merging' END,
        phase = ?,
        phase_started_at = ?,
        completed_at = CASE WHEN ? = 'complete' THEN ? ELSE completed_at END,
        total_regional_cultures = ?,
        total_national_cultures = ?,
        total_culture_dtus = ?
      WHERE id = 'singleton'
    `).run(targetPhase, targetPhase, now, targetPhase, now,
      stats.regional_count, stats.national_count, stats.total_dtus);

    // Phase 1: The Unveiling — mark all culture DTUs as merge-included
    if (targetPhase === "unveiling") {
      db.prepare(`
        UPDATE culture_dtus SET merge_included = 1, merged_at = ?
        WHERE merge_included = 0
      `).run(now);

      // Freeze pre-merge DTUs
      db.prepare(`
        UPDATE culture_dtus SET frozen = 1, frozen_at = ?
        WHERE frozen = 0
      `).run(now);
    }
  });

  try {
    doAdvance();
    return {
      ok: true,
      phase: targetPhase,
      phaseStartedAt: now,
      stats: {
        regionalCultures: stats.regional_count,
        nationalCultures: stats.national_count,
        totalCultureDTUs: stats.total_dtus,
      },
    };
  } catch (err) {
    console.error("[economy] advance_failed:", err.message);
    return { ok: false, error: "advance_failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lens Registry & Validation
// ─────────────────────────────────────────────────────────────────────

/**
 * Register a lens in the system.
 */
export function registerLens(db, {
  name, icon, protectionMode, layersUsed, supportedArtifactTypes,
  publishableScopes, federationTiers, isSystem, createdBy,
}) {
  if (!name) return { ok: false, error: "missing_name" };
  if (!protectionMode || !["PROTECTED", "OPEN", "ISOLATED"].includes(protectionMode)) {
    return { ok: false, error: "invalid_protection_mode" };
  }
  if (!layersUsed || !Array.isArray(layersUsed) || layersUsed.length === 0) {
    return { ok: false, error: "missing_layers_used" };
  }

  // Validate layers
  const validLayers = ["human", "core", "machine", "artifact"];
  for (const layer of layersUsed) {
    if (!validLayers.includes(layer)) {
      return { ok: false, error: "invalid_layer", layer, validLayers };
    }
  }

  const id = uid("lens");
  const now = nowISO();

  // Run validation checks
  const validationErrors = validateLensDeclarations({
    protectionMode, layersUsed, supportedArtifactTypes,
    publishableScopes, federationTiers,
  });

  const bridgeValidated = validationErrors.length === 0 ? 1 : 0;

  try {
    db.prepare(`
      INSERT INTO lens_registry (
        id, name, icon, protection_mode,
        layers_used_json, supported_artifact_types_json,
        publishable_scopes_json, federation_tiers_json,
        bridge_validated, validation_errors_json,
        is_system, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, icon || null, protectionMode,
      JSON.stringify(layersUsed),
      JSON.stringify(supportedArtifactTypes || []),
      JSON.stringify(publishableScopes || []),
      JSON.stringify(federationTiers || []),
      bridgeValidated,
      JSON.stringify(validationErrors),
      isSystem ? 1 : 0,
      createdBy || null,
      now, now,
    );

    return {
      ok: true,
      lens: {
        id, name, icon, protectionMode, layersUsed,
        supportedArtifactTypes: supportedArtifactTypes || [],
        publishableScopes: publishableScopes || [],
        federationTiers: federationTiers || [],
        bridgeValidated: !!bridgeValidated,
        validationErrors,
        isSystem: !!isSystem,
      },
    };
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return { ok: false, error: "lens_name_exists" };
    }
    console.error("[economy] registration_failed:", err.message);
    return { ok: false, error: "registration_failed" };
  }
}

/**
 * Validate lens bridge declarations.
 */
function validateLensDeclarations({ protectionMode, layersUsed, supportedArtifactTypes, publishableScopes, federationTiers }) {
  const errors = [];

  // bridge_implementation — check declarations exist
  if (!protectionMode) errors.push({ check: "bridge_implementation", message: "Missing protectionMode" });

  // layer_declaration
  if (!layersUsed || layersUsed.length === 0) {
    errors.push({ check: "layer_declaration", message: "No layers declared" });
  }

  // artifact_type_support
  if (!Array.isArray(supportedArtifactTypes)) {
    errors.push({ check: "artifact_type_support", message: "supportedArtifactTypes must be an array" });
  }

  // protection_mode
  if (protectionMode && !["PROTECTED", "OPEN", "ISOLATED"].includes(protectionMode)) {
    errors.push({ check: "protection_mode", message: `Invalid protection mode: ${protectionMode}` });
  }

  // federation_tiers
  if (!Array.isArray(federationTiers)) {
    errors.push({ check: "federation_tiers", message: "federationTiers must be an array" });
  }

  // scope_declaration
  if (!Array.isArray(publishableScopes)) {
    errors.push({ check: "scope_declaration", message: "publishableScopes must be an array" });
  }

  return errors;
}

/**
 * Get a registered lens by name.
 */
export function getLens(db, name) {
  const row = db.prepare("SELECT * FROM lens_registry WHERE name = ?").get(name);
  if (!row) return null;
  return formatLens(row);
}

/**
 * List all registered lenses.
 */
// @select-star-ok: lens_registry — registry list, all columns displayed
export function listLenses(db, { isSystem } = {}) {
  let query = "SELECT * FROM lens_registry";
  const params = [];
  if (isSystem !== undefined) {
    query += " WHERE is_system = ?";
    params.push(isSystem ? 1 : 0);
  }
  query += " ORDER BY name ASC";

  const rows = db.prepare(query).all(...params);
  return { ok: true, lenses: rows.map(formatLens) };
}

/**
 * Register all built-in system lenses.
 */
export function registerSystemLenses(db) {
  const results = [];
  // Single batched lookup of already-registered names (was N+1).
  const declNames = Object.keys(SYSTEM_LENS_DECLARATIONS);
  const existingNames = new Set();
  if (declNames.length > 0) {
    const placeholders = declNames.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT name FROM lens_registry WHERE name IN (${placeholders})`,
    ).all(...declNames);
    for (const r of rows) existingNames.add(r.name);
  }
  for (const [name, decl] of Object.entries(SYSTEM_LENS_DECLARATIONS)) {
    if (existingNames.has(name)) {
      results.push({ name, status: "already_registered" });
      continue;
    }
    const result = registerLens(db, {
      name,
      protectionMode: decl.protectionMode,
      layersUsed: decl.layersUsed,
      supportedArtifactTypes: decl.supportedArtifactTypes,
      publishableScopes: decl.publishableScopes,
      federationTiers: decl.federationTiers,
      isSystem: true,
    });
    results.push({ name, status: result.ok ? "registered" : result.error });
  }
  return { ok: true, results };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatCultureDTU(row) {
  return {
    id: row.id,
    creatorId: row.creator_id,
    cultureTier: row.culture_tier,
    regional: row.regional,
    national: row.national,
    contentType: row.content_type,
    title: row.title,
    body: row.body,
    media: JSON.parse(row.media_json || "[]"),
    tags: JSON.parse(row.tags_json || "[]"),
    mood: row.mood,
    resonanceCount: row.resonance_count,
    reflectionCount: row.reflection_count,
    mergeIncluded: !!row.merge_included,
    frozen: !!row.frozen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatLens(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    protectionMode: row.protection_mode,
    layersUsed: JSON.parse(row.layers_used_json || "[]"),
    supportedArtifactTypes: JSON.parse(row.supported_artifact_types_json || "[]"),
    publishableScopes: JSON.parse(row.publishable_scopes_json || "[]"),
    federationTiers: JSON.parse(row.federation_tiers_json || "[]"),
    bridgeValidated: !!row.bridge_validated,
    validationErrors: JSON.parse(row.validation_errors_json || "[]"),
    isSystem: !!row.is_system,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// Re-export constants
export {
  MUSIC_LENS, MUSIC_PROTECTION, ONE_TAP_PURCHASE, ARTIFACT_EXPORT,
  ARTISTRY_SCOPE, ARTIST_STRATEGY,
  CULTURE_LENS, CULTURE_GATING, CULTURE_HEARTBEAT, CULTURE_RESTRICTIONS,
  GREAT_MERGE, POST_MERGE_RULES,
  SOVEREIGN_BIOMONITOR, GRIEF_PROTOCOL,
  LENS_PROTECTION_SYSTEM, LENS_DTU_BRIDGE, LENS_VALIDATOR,
  SYSTEM_LENS_DECLARATIONS,
  ART_LENS, VIDEO_LENS, CODE_LENS,
  LENS_CONSTANTS,
} from "../lib/lens-culture-constants.js";
