/**
 * Concord Legal Liability Framework — v1.0
 *
 * Implementation: user agreements, DMCA processing, dispute resolution,
 * copyright strike system, content labeling, disclaimer management.
 *
 * Concord is the road. Not the driver. Not the passenger. The road.
 */

import { generateId } from "../lib/id-factory.js";
import {
  LEGAL_POSITION,
  LENS_DISCLAIMER,
  LENS_SPECIFIC_DISCLAIMERS,
  DMCA_COMPLIANCE,
  DISPUTE_RESOLUTION,
  TERMS_OF_SERVICE,
  LIABILITY_SHIELD,
  CONTENT_LABELING,
  LEGAL_CONSTANTS,
} from "../lib/legal-liability-constants.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ═══════════════════════════════════════════════════════════════════════════
// USER AGREEMENT TRACKING
// Every agreement at every touchpoint is recorded and versioned
// ═══════════════════════════════════════════════════════════════════════════

export function recordAgreement(db, { userId, agreementType, ipAddress }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!userId || !agreementType) {
    return { ok: false, error: "missing_required_fields" };
  }
  if (!LEGAL_CONSTANTS.AGREEMENT_TYPES.includes(agreementType)) {
    return { ok: false, error: "invalid_agreement_type", valid: LEGAL_CONSTANTS.AGREEMENT_TYPES };
  }

  const versionMap = {
    account_creation: LEGAL_CONSTANTS.ACCOUNT_AGREEMENT_VERSION,
    first_transaction: LEGAL_CONSTANTS.TRANSACTION_AGREEMENT_VERSION,
    first_upload: LEGAL_CONSTANTS.UPLOAD_AGREEMENT_VERSION,
    api_creation: LEGAL_CONSTANTS.API_AGREEMENT_VERSION,
  };

  const id = generateId("agr");
  try {
    db.prepare(`
      INSERT INTO user_agreements (id, user_id, agreement_type, version, agreed_at, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, agreementType, versionMap[agreementType], nowISO(), ipAddress || null);
    return { ok: true, agreementId: id, type: agreementType, version: versionMap[agreementType] };
  } catch (e) {
    return { ok: false, error: "insert_failed", message: e.message };
  }
}

export function hasAgreed(db, userId, agreementType) {
  if (!db) return false;
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM user_agreements WHERE user_id = ? AND agreement_type = ?",
    ).get(userId, agreementType);
    return row && row.cnt > 0;
  } catch {
    return false;
  }
}

export function getUserAgreements(db, userId) {
  if (!db) return [];
  try {
    return db.prepare(
      "SELECT * FROM user_agreements WHERE user_id = ? ORDER BY agreed_at DESC",
    ).all(userId);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DMCA NOTICE PROCESSING
// Standard safe harbor compliance: receive, review, act, notify
// ═══════════════════════════════════════════════════════════════════════════

export function submitDMCANotice(db, notice) {
  if (!db) return { ok: false, error: "no_database" };

  // Validate required string fields
  const required = [
    "complainantName", "complainantEmail", "copyrightedWork",
    "infringingContentId", "signature",
  ];
  for (const field of required) {
    if (!notice[field]) {
      return { ok: false, error: "missing_required_field", field };
    }
  }

  // Validate sworn statements (boolean fields checked separately)
  if (!notice.goodFaithStatement || !notice.accuracyStatement) {
    return { ok: false, error: "statements_required", message: "Good faith and accuracy statements must be affirmed" };
  }

  const id = generateId("dmca");
  try {
    db.prepare(`
      INSERT INTO dmca_notices (
        id, complainant_name, complainant_email,
        copyrighted_work, infringing_content_id,
        good_faith_statement, accuracy_statement, signature,
        status, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id,
      notice.complainantName,
      notice.complainantEmail,
      notice.copyrightedWork,
      notice.infringingContentId,
      notice.goodFaithStatement ? 1 : 0,
      notice.accuracyStatement ? 1 : 0,
      notice.signature,
      nowISO(),
    );
    return {
      ok: true,
      noticeId: id,
      status: "pending",
      responseTime: LEGAL_CONSTANTS.DMCA_RESPONSE_HOURS + " hours",
    };
  } catch (e) {
    return { ok: false, error: "insert_failed", message: e.message };
  }
}

export function reviewDMCANotice(db, noticeId, { valid, notes }) {
  if (!db) return { ok: false, error: "no_database" };

  const notice = db.prepare("SELECT * FROM dmca_notices WHERE id = ?").get(noticeId);
  if (!notice) return { ok: false, error: "notice_not_found" };

  const newStatus = valid ? "content_removed" : "resolved";
  try {
    db.prepare(`
      UPDATE dmca_notices SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?
    `).run(newStatus, nowISO(), notes || null, noticeId);

    // If valid, issue copyright strike to the uploader
    if (valid) {
      const contentId = notice.infringing_content_id;
      // Look up the content creator — this will be resolved by the content system
      // For now, record the action
      return {
        ok: true,
        noticeId,
        status: newStatus,
        contentRemoved: true,
        message: "Content removed. Uploader will be notified.",
      };
    }

    return { ok: true, noticeId, status: newStatus, contentRemoved: false };
  } catch (e) {
    return { ok: false, error: "update_failed", message: e.message };
  }
}

export function submitCounterNotification(db, noticeId, { uploaderName, uploaderEmail, statement, signature }) {
  if (!db) return { ok: false, error: "no_database" };

  const notice = db.prepare("SELECT * FROM dmca_notices WHERE id = ?").get(noticeId);
  if (!notice) return { ok: false, error: "notice_not_found" };
  if (notice.status !== "content_removed") {
    return { ok: false, error: "invalid_state", message: "Counter-notification only valid after content removal" };
  }

  if (!uploaderName || !statement || !signature) {
    return { ok: false, error: "missing_required_fields" };
  }

  try {
    db.prepare(`
      UPDATE dmca_notices SET status = 'counter_filed', notes = ? WHERE id = ?
    `).run(
      `Counter-notification by ${uploaderName} (${uploaderEmail}): ${statement}`,
      noticeId,
    );
    return {
      ok: true,
      noticeId,
      status: "counter_filed",
      restorationDate: `Content will be restored in ${LEGAL_CONSTANTS.DMCA_COUNTER_NOTICE_WAIT_DAYS} business days unless copyright holder files lawsuit`,
    };
  } catch (e) {
    return { ok: false, error: "update_failed", message: e.message };
  }
}

export function getDMCANotice(db, noticeId) {
  if (!db) return null;
  try {
    return db.prepare("SELECT * FROM dmca_notices WHERE id = ?").get(noticeId);
  } catch {
    return null;
  }
}

export function getDMCANotices(db, { status, limit = 50 } = {}) {
  if (!db) return [];
  try {
    if (status) {
      return db.prepare("SELECT * FROM dmca_notices WHERE status = ? ORDER BY received_at DESC LIMIT ?").all(status, limit);
    }
    return db.prepare("SELECT * FROM dmca_notices ORDER BY received_at DESC LIMIT ?").all(limit);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COPYRIGHT STRIKE SYSTEM
// Three strikes: warning → suspension → termination
// ═══════════════════════════════════════════════════════════════════════════

export function issueStrike(db, { userId, dmcaNoticeId }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!userId || !dmcaNoticeId) return { ok: false, error: "missing_required_fields" };

  // Count existing strikes
  const existingStrikes = getStrikeCount(db, userId);
  const strikeNumber = existingStrikes + 1;

  let actionTaken;
  if (strikeNumber === 1) actionTaken = LEGAL_CONSTANTS.STRIKE_1_ACTION;
  else if (strikeNumber === 2) actionTaken = LEGAL_CONSTANTS.STRIKE_2_ACTION;
  else actionTaken = LEGAL_CONSTANTS.STRIKE_3_ACTION;

  const id = generateId("strk");
  try {
    db.prepare(`
      INSERT INTO copyright_strikes (id, user_id, dmca_notice_id, strike_number, action_taken, issued_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, dmcaNoticeId, strikeNumber, actionTaken, nowISO());

    return {
      ok: true,
      strikeId: id,
      strikeNumber,
      totalStrikes: strikeNumber,
      maxStrikes: LEGAL_CONSTANTS.MAX_STRIKES,
      actionTaken,
      appealsAvailable: DMCA_COMPLIANCE.repeatInfringer.appealsAvailable,
    };
  } catch (e) {
    return { ok: false, error: "insert_failed", message: e.message };
  }
}

export function getStrikeCount(db, userId) {
  if (!db) return 0;
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM copyright_strikes WHERE user_id = ? AND (appealed = 0 OR appeal_result != 'overturned')",
    ).get(userId);
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

export function getUserStrikes(db, userId) {
  if (!db) return [];
  try {
    return db.prepare(
      "SELECT * FROM copyright_strikes WHERE user_id = ? ORDER BY issued_at DESC",
    ).all(userId);
  } catch {
    return [];
  }
}

export function appealStrike(db, strikeId, { reason }) {
  if (!db) return { ok: false, error: "no_database" };

  const strike = db.prepare("SELECT * FROM copyright_strikes WHERE id = ?").get(strikeId);
  if (!strike) return { ok: false, error: "strike_not_found" };
  if (strike.appealed) return { ok: false, error: "already_appealed" };

  try {
    db.prepare("UPDATE copyright_strikes SET appealed = 1 WHERE id = ?").run(strikeId);
    return { ok: true, strikeId, status: "appeal_submitted", reason };
  } catch (e) {
    return { ok: false, error: "update_failed", message: e.message };
  }
}

export function resolveAppeal(db, strikeId, { result }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!["upheld", "overturned"].includes(result)) {
    return { ok: false, error: "invalid_result", valid: ["upheld", "overturned"] };
  }

  try {
    db.prepare("UPDATE copyright_strikes SET appeal_result = ? WHERE id = ?").run(result, strikeId);
    return { ok: true, strikeId, appealResult: result };
  } catch (e) {
    return { ok: false, error: "update_failed", message: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPUTE RESOLUTION
// Concord facilitates. Concord does not judge.
// ═══════════════════════════════════════════════════════════════════════════

export function openDispute(db, { reporterId, disputeType, reportedContentId, reportedUserId, description, evidence }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!reporterId || !disputeType || !description) {
    return { ok: false, error: "missing_required_fields" };
  }
  if (!LEGAL_CONSTANTS.DISPUTE_TYPES.includes(disputeType)) {
    return { ok: false, error: "invalid_dispute_type", valid: LEGAL_CONSTANTS.DISPUTE_TYPES };
  }

  const id = generateId("disp");
  try {
    db.prepare(`
      INSERT INTO disputes (
        id, dispute_type, reporter_id, reported_content_id,
        reported_user_id, description, evidence_json, status, opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      id, disputeType, reporterId,
      reportedContentId || null, reportedUserId || null,
      description, JSON.stringify(evidence || []),
      nowISO(),
    );

    const handler = DISPUTE_RESOLUTION.disputeTypes[disputeType];
    return {
      ok: true,
      disputeId: id,
      status: "open",
      handler: handler?.handler,
      concordRole: handler?.concordRole,
      reviewTime: LEGAL_CONSTANTS.DISPUTE_REVIEW_HOURS + " hours",
    };
  } catch (e) {
    return { ok: false, error: "insert_failed", message: e.message };
  }
}

export function updateDisputeStatus(db, disputeId, { status, resolution }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!LEGAL_CONSTANTS.DISPUTE_STATUSES.includes(status)) {
    return { ok: false, error: "invalid_status", valid: LEGAL_CONSTANTS.DISPUTE_STATUSES };
  }

  try {
    const updates = ["status = ?", "resolved_at = CASE WHEN ? IN ('resolved','dismissed') THEN ? ELSE resolved_at END"];
    const params = [status, status, nowISO()];

    if (resolution) {
      updates.push("resolution = ?");
      params.push(resolution);
    }
    params.push(disputeId);

    db.prepare(`UPDATE disputes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return { ok: true, disputeId, status };
  } catch (e) {
    return { ok: false, error: "update_failed", message: e.message };
  }
}

export function getDispute(db, disputeId) {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM disputes WHERE id = ?").get(disputeId);
    if (!row) return null;
    return { ...row, evidence: JSON.parse(row.evidence_json || "[]") };
  } catch {
    return null;
  }
}

export function getDisputes(db, { status, disputeType, limit = 50 } = {}) {
  if (!db) return [];
  try {
    // @select-star-ok: disputes admin list — admin dashboard renders all columns
    let sql = "SELECT * FROM disputes";
    const conditions = [];
    const params = [];

    if (status) { conditions.push("status = ?"); params.push(status); }
    if (disputeType) { conditions.push("dispute_type = ?"); params.push(disputeType); }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY opened_at DESC LIMIT ?";
    params.push(limit);

    return db.prepare(sql).all(...params).map(r => ({
      ...r,
      evidence: JSON.parse(r.evidence_json || "[]"),
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCLAIMER ACKNOWLEDGMENT
// Track when users acknowledge lens disclaimers
// ═══════════════════════════════════════════════════════════════════════════

export function acknowledgeDisclaimer(db, { userId, lensId }) {
  if (!db) return { ok: false, error: "no_database" };
  if (!userId || !lensId) return { ok: false, error: "missing_required_fields" };

  try {
    db.prepare(`
      INSERT OR REPLACE INTO disclaimer_acknowledgments (user_id, lens_id, acknowledged_at, disclaimer_version)
      VALUES (?, ?, ?, ?)
    `).run(userId, lensId, nowISO(), LEGAL_CONSTANTS.DISCLAIMER_VERSION);
    return { ok: true, userId, lensId, version: LEGAL_CONSTANTS.DISCLAIMER_VERSION };
  } catch (e) {
    return { ok: false, error: "insert_failed", message: e.message };
  }
}

export function hasAcknowledgedDisclaimer(db, userId, lensId) {
  if (!db) return false;
  try {
    const row = db.prepare(
      "SELECT disclaimer_version FROM disclaimer_acknowledgments WHERE user_id = ? AND lens_id = ?",
    ).get(userId, lensId);
    return !!(row && row.disclaimer_version === LEGAL_CONSTANTS.DISCLAIMER_VERSION);
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT LABELING
// Generate the correct label for any piece of content
// ═══════════════════════════════════════════════════════════════════════════

export function getContentLabel(content) {
  if (!content) return CONTENT_LABELING.labels.userGenerated;

  // Entity-generated content gets prominent labeling
  if (content.creatorType === "emergent" || content.creatorType === "entity") {
    return {
      ...CONTENT_LABELING.labels.entityGenerated,
      entityId: content.creatorId,
      entityType: content.entityType || "autonomous",
    };
  }

  // Derivative content
  if (content.parentIds?.length > 0 || content.derivativeOf) {
    return {
      ...CONTENT_LABELING.labels.derivative,
      parentIds: content.parentIds || [content.derivativeOf],
      originalCreator: content.originalCreator,
    };
  }

  // Promoted content
  if (content.promotedFrom) {
    return {
      ...CONTENT_LABELING.labels.promoted,
      promotedFrom: content.promotedFrom,
    };
  }

  // Default: user generated
  return {
    ...CONTENT_LABELING.labels.userGenerated,
    creatorId: content.creatorId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCLAIMER RETRIEVAL
// Get the right disclaimer for any lens
// ═══════════════════════════════════════════════════════════════════════════

export function getDisclaimerForLens(lensId) {
  // Always include universal disclaimer
  const universal = LENS_DISCLAIMER.universal;

  // Get lens-specific disclaimer if available
  const specific = LENS_SPECIFIC_DISCLAIMERS[lensId] || null;

  return {
    universal,
    specific,
    version: LEGAL_CONSTANTS.DISCLAIMER_VERSION,
  };
}

export function getAllDisclaimers() {
  return {
    universal: LENS_DISCLAIMER.universal,
    lensSpecific: LENS_SPECIFIC_DISCLAIMERS,
    version: LEGAL_CONSTANTS.DISCLAIMER_VERSION,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGAL DASHBOARD — Summary for steward council
// ═══════════════════════════════════════════════════════════════════════════

export function getLegalDashboard(db) {
  if (!db) return { ok: false, error: "no_database" };

  return {
    ok: true,
    legalPosition: LEGAL_POSITION,
    dmca: {
      pending: _safeCount(db, "SELECT COUNT(*) as cnt FROM dmca_notices WHERE status = 'pending'"),
      contentRemoved: _safeCount(db, "SELECT COUNT(*) as cnt FROM dmca_notices WHERE status = 'content_removed'"),
      counterFiled: _safeCount(db, "SELECT COUNT(*) as cnt FROM dmca_notices WHERE status = 'counter_filed'"),
      total: _safeCount(db, "SELECT COUNT(*) as cnt FROM dmca_notices"),
    },
    strikes: {
      totalActive: _safeCount(db, "SELECT COUNT(*) as cnt FROM copyright_strikes WHERE appealed = 0 OR appeal_result != 'overturned'"),
      appealed: _safeCount(db, "SELECT COUNT(*) as cnt FROM copyright_strikes WHERE appealed = 1"),
    },
    disputes: {
      open: _safeCount(db, "SELECT COUNT(*) as cnt FROM disputes WHERE status = 'open'"),
      underReview: _safeCount(db, "SELECT COUNT(*) as cnt FROM disputes WHERE status = 'under_review'"),
      resolved: _safeCount(db, "SELECT COUNT(*) as cnt FROM disputes WHERE status = 'resolved'"),
      total: _safeCount(db, "SELECT COUNT(*) as cnt FROM disputes"),
    },
    agreements: {
      total: _safeCount(db, "SELECT COUNT(*) as cnt FROM user_agreements"),
    },
    liabilityShield: LIABILITY_SHIELD,
    constants: LEGAL_CONSTANTS,
  };
}

function _safeCount(db, sql) {
  try {
    const row = db.prepare(sql).get();
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}
