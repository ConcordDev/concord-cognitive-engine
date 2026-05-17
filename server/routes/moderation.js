/**
 * Content Moderation Routes
 *
 * Wires content-guard.js (illegal content blocking), content-moderation.js
 * (user reporting + queue), and content-shield.js (PII/copyright/advice) into
 * the Express HTTP layer.
 *
 * Endpoints:
 *   POST /api/moderation/report        — User reports content (auth required)
 *   POST /api/moderation/public-report — Anonymous report (no auth)
 *   GET  /api/moderation/contact        — Public contact info (emails + SLAs)
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

  // ── Public Report (no auth) ──────────────────────────────────────────────
  // Banned users, non-users, and external observers (researchers, mandatory
  // reporters, law enforcement) need a path to flag content. Auth-gated
  // reports alone leave those reporters out. This endpoint accepts an
  // anonymous report, requires a real contact channel (email), and queues
  // it for the same moderation review the authenticated path uses.

  router.post("/public-report", asyncHandler(async (req, res) => {
    const { contentId, contentType, category, reason, reporterEmail, reporterContext } = req.body || {};

    if (!contentId) return res.status(400).json({ ok: false, error: "contentId is required" });
    if (!contentType) return res.status(400).json({ ok: false, error: "contentType is required" });
    if (!category || !REPORT_CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${REPORT_CATEGORIES.join(", ")}` });
    }
    if (!reason || reason.length < 5) {
      return res.status(400).json({ ok: false, error: "reason must be at least 5 characters" });
    }
    if (!reporterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail)) {
      return res.status(400).json({ ok: false, error: "reporterEmail required (we use it to respond)" });
    }

    const result = submitReport(STATE, {
      reporterId: `anon:${reporterEmail.toLowerCase().slice(0, 200)}`,
      contentId,
      contentType,
      category,
      reason: String(reason).slice(0, 2000),
      evidence: reporterContext ? `Anonymous report. Reporter context: ${String(reporterContext).slice(0, 4000)}` : "Anonymous report.",
    });

    if (!result.ok) return res.status(400).json(result);

    // Best-effort notify the operator that an anonymous report landed.
    // ABUSE_NOTIFY_WEBHOOK is a Slack/Discord/etc webhook URL; if absent
    // the report still lands in the queue, just without push notification.
    try {
      const hook = process.env.ABUSE_NOTIFY_WEBHOOK;
      if (hook) {
        fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🚩 Anonymous abuse report\nCategory: ${category}\nContent: ${contentType}/${contentId}\nReporter: ${reporterEmail}\nReason: ${String(reason).slice(0, 200)}`,
          }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => { /* webhook best-effort */ });
      }
    } catch { /* never block the report on notification failure */ }

    res.json({ ok: true, reportId: result.reportId, message: "Report received. We'll respond to " + reporterEmail + " within 72 hours." });
  }));

  // ── Public Contact Info ──────────────────────────────────────────────────
  // A canonical place for users + crawlers + automated abuse-reporting tools
  // to find the right email for each report type. Pulls from env so the
  // operator can change addresses without a deploy.

  router.get("/contact", (_req, res) => {
    res.json({
      ok: true,
      contacts: {
        abuse: process.env.ABUSE_EMAIL || "abuse@concord-os.org",
        dmca: process.env.DMCA_EMAIL || "dmca@concord-os.org",
        legal: process.env.LEGAL_EMAIL || "legal@concord-os.org",
        security: process.env.SECURITY_EMAIL || "security@concord-os.org",
        support: process.env.SUPPORT_EMAIL || "support@concord-os.org",
      },
      slas: {
        abuse: "ack within 24h, decision within 72h",
        dmca: "ack within 24h, statutory window",
        legal: "ack within 24h",
        security: "ack within 24h, responsible disclosure preferred",
        support: "best effort",
      },
      reportEndpoint: "/api/moderation/public-report",
      communityStandards: "/docs/COMMUNITY_STANDARDS.md",
    });
  });

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

    const result = resolveReport(STATE, {
      reportId,
      moderatorId: req.user.id,
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
