/**
 * Content Moderation Routes
 *
 * Wires content-guard.js (illegal content blocking), content-moderation.js
 * (user reporting + queue), and content-shield.js (PII/copyright/advice) into
 * the Express HTTP layer.
 *
 * Endpoints:
 *   POST /api/moderation/report        — User reports content
 *   GET  /api/moderation/reports        — List reports (admin)
 *   GET  /api/moderation/queue          — Moderation queue (admin)
 *   POST /api/moderation/resolve/:id    — Resolve a report (admin)
 *   GET  /api/moderation/metrics        — Moderation stats (admin)
 *   GET  /api/moderation/audit/:contentId — Audit trail for content
 *   GET  /api/moderation/user/:userId   — User moderation status
 *   POST /api/moderation/appeal         — User appeals a removal
 */

import { Router } from "express";
import {
  submitReport,
  listReports,
  getModerationQueue,
  resolveReport,
  getModerationMetrics,
  getContentAuditLog,
  getUserModerationStatus,
  scanContent as moderationScanContent,
  REPORT_CATEGORIES,
} from "../lib/content-moderation.js";
import { checkAutoHide, createModerationDTU } from "../lib/content-guard.js";

/**
 * Create moderation routes.
 *
 * @param {Object} deps
 * @param {Object} deps.STATE - Server state
 * @param {Function} deps.requireAuth - Auth middleware factory
 * @param {Function} deps.requireRole - Role check middleware factory
 * @param {Function} deps.asyncHandler - Async error wrapper
 * @returns {Router}
 */
export function createModerationRouter(deps) {
  const { STATE, requireAuth, requireRole, asyncHandler } = deps;
  const router = Router();

  // ── User Reporting ───────────────────────────────────────────────────────

  /**
   * POST /report — Any authenticated user can report content.
   */
  router.post("/report", asyncHandler(async (req, res) => {
    const reporterId = req.user?.id;
    if (!reporterId) {
      return res.status(401).json({ ok: false, error: "Login required to report content" });
    }

    const { contentId, contentType, category, reason, evidence } = req.body;

    if (!contentId) return res.status(400).json({ ok: false, error: "contentId is required" });
    if (!contentType) return res.status(400).json({ ok: false, error: "contentType is required (dtu, media, comment, profile)" });
    if (!category || !REPORT_CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${REPORT_CATEGORIES.join(", ")}` });
    }
    if (!reason || reason.length < 5) {
      return res.status(400).json({ ok: false, error: "reason must be at least 5 characters" });
    }

    const result = submitReport(STATE, {
      reporterId,
      contentId,
      contentType,
      category,
      reason: String(reason).slice(0, 2000),
      evidence: evidence ? String(evidence).slice(0, 5000) : undefined,
    });

    if (!result.ok) return res.status(400).json(result);

    // Check if auto-hide threshold is reached
    const autoHide = checkAutoHide(STATE, contentId);
    if (autoHide.hidden) {
      result.autoHidden = true;
      result.reportCount = autoHide.reportCount;
    }

    res.json(result);
  }));

  // ── Admin: List Reports ──────────────────────────────────────────────────

  router.get("/reports", requireRole("admin", "sovereign"), asyncHandler(async (req, res) => {
    const { status, category, limit, offset } = req.query;
    const result = listReports(STATE, {
      status: status || undefined,
      category: category || undefined,
      limit: Math.min(Number(limit) || 50, 200),
      offset: Number(offset) || 0,
    });
    res.json(result);
  }));

  // ── Admin: Moderation Queue ──────────────────────────────────────────────

  router.get("/queue", requireRole("admin", "sovereign"), asyncHandler(async (req, res) => {
    const result = getModerationQueue(STATE, {
      limit: Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json(result);
  }));

  // ── Admin: Resolve Report ────────────────────────────────────────────────

  router.post("/resolve/:reportId", requireRole("admin", "sovereign"), asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const { action, reason } = req.body;

    if (!action) return res.status(400).json({ ok: false, error: "action is required" });

    const result = resolveReport(STATE, reportId, req.user.id, {
      action,
      reason: reason ? String(reason).slice(0, 2000) : undefined,
    });

    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }));

  // ── Admin: Metrics ───────────────────────────────────────────────────────

  router.get("/metrics", requireRole("admin", "sovereign"), asyncHandler(async (req, res) => {
    const result = getModerationMetrics(STATE);
    res.json(result);
  }));

  // ── Content Audit Trail ──────────────────────────────────────────────────

  router.get("/audit/:contentId", requireRole("admin", "sovereign"), asyncHandler(async (req, res) => {
    const result = getContentAuditLog(STATE, req.params.contentId);
    res.json(result);
  }));

  // ── User Moderation Status ───────────────────────────────────────────────

  router.get("/user/:userId", asyncHandler(async (req, res) => {
    // Users can check their own status; admins can check anyone
    const targetUserId = req.params.userId;
    const isOwnStatus = req.user?.id === targetUserId;
    const isAdmin = req.user?.role === "admin" || req.user?.role === "sovereign";

    if (!isOwnStatus && !isAdmin) {
      return res.status(403).json({ ok: false, error: "Can only view your own moderation status" });
    }

    const result = getUserModerationStatus(STATE, targetUserId);
    res.json(result);
  }));

  // ── User Appeals ─────────────────────────────────────────────────────────

  router.post("/appeal", asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Login required to appeal" });

    const { contentId, reason } = req.body;
    if (!contentId) return res.status(400).json({ ok: false, error: "contentId is required" });
    if (!reason || reason.length < 20) {
      return res.status(400).json({ ok: false, error: "reason must be at least 20 characters explaining why the removal was incorrect" });
    }

    // Create an appeal report
    const result = submitReport(STATE, {
      reporterId: userId,
      contentId,
      contentType: "appeal",
      category: "other",
      reason: `APPEAL: ${String(reason).slice(0, 2000)}`,
      evidence: `User ${userId} appeals moderation action on ${contentId}`,
    });

    // Create moderation DTU for the appeal
    createModerationDTU(STATE, {
      action: "appeal_submitted",
      category: "appeal",
      userId,
      contentType: "appeal",
      severity: "medium",
    });

    res.json({ ok: true, appealId: result.report?.id, message: "Appeal submitted for manual review" });
  }));

  return router;
}
