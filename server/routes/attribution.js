/**
 * Attribution & DMCA Admin Routes
 *
 * Provides REST API for:
 *   - GET /api/attribution/stats — attribution statistics for admin dashboard
 *   - POST /api/attribution/dmca — initiate a DMCA takedown
 *   - GET /api/attribution/dmca — list DMCA records
 *   - POST /api/attribution/validate/:dtuId — validate attribution on a DTU
 *   - GET /api/attribution/license-check/:dtuId — check if DTU can be listed on marketplace
 */

import { Router } from "express";
import {
  getAttributionStats,
  validateAttribution,
  canListOnMarketplace,
  createDMCARecord,
} from "../lib/source-attribution.js";
import logger from "../logger.js";

/** @type {Map<string, object>} In-memory DMCA records (persisted via DTU if pipelineCommitDTU available) */
const _dmcaRecords = new Map();

export default function createAttributionRoutes({ requireAuth } = {}) {
  const router = Router();

  const requireAdmin = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  // GET /api/attribution/stats — admin dashboard stats
  router.get("/stats", requireAdmin, (req, res) => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE?.dtus) return res.status(503).json({ ok: false, error: "state_not_available" });

      const dtus = [...STATE.dtus.values()];
      const stats = getAttributionStats(dtus);
      res.json({ ok: true, ...stats });
    } catch (err) {
      logger.warn?.("[attribution-route] stats error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/attribution/dmca — initiate a DMCA takedown
  router.post("/dmca", requireAdmin, (req, res) => {
    try {
      const { dtuId, noticeUrl, complainant, reason, action } = req.body;
      if (!dtuId || !complainant || !reason) {
        return res.status(400).json({ ok: false, error: "dtuId, complainant, and reason are required" });
      }

      const record = createDMCARecord({
        dtuId,
        noticeUrl: noticeUrl || "",
        complainant,
        reason,
        action: action || "restrict",
      });

      _dmcaRecords.set(record.id, record);

      // If STATE is available, mark the DTU as restricted
      const STATE = globalThis._concordSTATE;
      if (STATE?.dtus) {
        const dtu = STATE.dtus.get(dtuId);
        if (dtu) {
          dtu.meta = dtu.meta || {};
          dtu.meta.dmca = {
            recordId: record.id,
            action: action || "restrict",
            complainant,
            reason,
            restrictedAt: new Date().toISOString(),
          };
          if (action === "remove") {
            dtu.meta.removed = true;
            dtu.meta.removedReason = `DMCA takedown: ${reason}`;
          }
          STATE.dtus.set(dtuId, dtu);
        }
      }

      res.json({ ok: true, record });
    } catch (err) {
      logger.warn?.("[attribution-route] dmca error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/attribution/dmca — list DMCA records
  router.get("/dmca", requireAdmin, (req, res) => {
    try {
      const records = [..._dmcaRecords.values()].sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      res.json({ ok: true, count: records.length, records });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/attribution/validate/:dtuId — validate attribution on a DTU
  router.post("/validate/:dtuId", requireAdmin, (req, res) => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE?.dtus) return res.status(503).json({ ok: false, error: "state_not_available" });

      const dtu = STATE.dtus.get(req.params.dtuId);
      if (!dtu) return res.status(404).json({ ok: false, error: "dtu_not_found" });

      const result = validateAttribution(dtu);
      res.json({ ok: true, dtuId: req.params.dtuId, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/attribution/license-check/:dtuId — check marketplace eligibility
  router.get("/license-check/:dtuId", (req, res) => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE?.dtus) return res.status(503).json({ ok: false, error: "state_not_available" });

      const dtu = STATE.dtus.get(req.params.dtuId);
      if (!dtu) return res.status(404).json({ ok: false, error: "dtu_not_found" });

      const result = canListOnMarketplace(dtu);
      res.json({ ok: true, dtuId: req.params.dtuId, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
