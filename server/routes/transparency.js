/**
 * Transparency Report — API Routes
 *
 * Public: annual transparency reports (no auth required).
 * Admin: log, update, and query law enforcement requests.
 */

import express from "express";
import {
  logLegalRequest,
  updateLegalRequest,
  generateTransparencyReport,
  getLegalRequests,
} from "../lib/transparency.js";

/**
 * Create the transparency router.
 * @param {{ db: object, adminOnly: function }} deps
 */
export default function createTransparencyRouter({ db, adminOnly }) {
  const router = express.Router();

  // ── Public: Annual Transparency Report ─────────────────────────────

  router.get("/transparency/:year", (req, res) => {
    const { year } = req.params;
    const result = generateTransparencyReport(db, year);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  // ── Admin: List Legal Requests ─────────────────────────────────────

  router.get("/admin/legal-requests", adminOnly, (req, res) => {
    const { type, response, year, gagged, limit, offset } = req.query;
    const result = getLegalRequests(db, {
      type,
      response,
      year,
      gagged: gagged !== undefined ? gagged === "true" || gagged === "1" : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(result);
  });

  // ── Admin: Log New Legal Request ───────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/admin/legal-requests", adminOnly, (req, res) => {
    const {
      type,
      jurisdiction,
      dateReceived,
      dataRequested,
      usersAffected,
      gagged,
      notes,
    } = req.body || {};

    const result = logLegalRequest(db, {
      type,
      jurisdiction,
      dateReceived,
      dataRequested,
      usersAffected: usersAffected ? Number(usersAffected) : 0,
      gagged: !!gagged,
      notes,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  });

  // ── Admin: Update Legal Request ────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.put("/admin/legal-requests/:id", adminOnly, (req, res) => {
    const { id } = req.params;
    const { response, responseDate, notifiedUser, notes } = req.body || {};

    const result = updateLegalRequest(db, id, {
      response,
      responseDate,
      notifiedUser,
      notes,
    });

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return res.status(status).json(result);
    }

    res.json(result);
  });

  return router;
}
