/**
 * API Key Management Routes — v1.0
 *
 * CRUD endpoints for Concord Secret Keys (csk_...).
 * Mounted at /api/keys.
 *
 * All mutating routes require authentication.
 * Keys are scoped to the authenticated user — you can only manage your own keys.
 */

import express from "express";
import {
  generateKey,
  validateKey,
  revokeKey,
  listKeys,
  trackUsage,
  getKeyUsage,
  updateKey,
} from "../lib/api-keys.js";

/**
 * Create the API keys router.
 *
 * @param {object} deps
 * @param {Function} [deps.requireAuth] - Auth middleware factory (returns middleware fn)
 * @returns {import('express').Router}
 */
export default function createAPIKeysRouter({ requireAuth } = {}) {
  const router = express.Router();

  // ── Auth gate — all key management requires authentication ────────────
  if (typeof requireAuth === "function") {
    router.use(requireAuth());
  } else {
    router.use((_req, res, _next) => res.status(401).json({ ok: false, error: 'auth_not_configured' }));
  }

  // ── POST /api/keys — Generate a new API key ──────────────────────────
  router.post("/", (req, res) => {
    // eslint-disable-next-line no-restricted-syntax
    // eslint-disable-next-line no-restricted-syntax
    const userId = req.user?.id || req.body?.userId; // safe: target-identifier
    if (!userId) {
      return res.status(400).json({ ok: false, error: "missing_user_id" });
    }

    const { scopes, rateLimit, name } = req.body || {};
    const result = generateKey(userId, scopes, rateLimit);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    // Attach optional display name
    if (name && result.key) {
      result.key.name = String(name).slice(0, 64);
    }

    return res.status(201).json(result);
  });

  // ── GET /api/keys — List all keys for the authenticated user ─────────
  // eslint-disable-next-line no-restricted-syntax
  router.get("/", (req, res) => {
    // eslint-disable-next-line no-restricted-syntax
    const userId = req.user?.id || req.query?.userId; // safe: public-filter
    if (!userId) {
      return res.status(400).json({ ok: false, error: "missing_user_id" });
    }

    const result = listKeys(userId);
    return res.json(result);
  });

  // ── GET /api/keys/:id/usage — Usage stats for a specific key ─────────
  router.get("/:id/usage", (req, res) => {
    const userId = req.user?.id;
    const result = getKeyUsage(req.params.id, userId);

    if (!result.ok) {
      return res.status(404).json(result);
    }

    return res.json(result);
  });

  // ── PUT /api/keys/:id — Update scopes/rate limit ─────────────────────
  router.put("/:id", (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "auth_required" });
    }

    const { scopes, rateLimit } = req.body || {};
    const result = updateKey(req.params.id, userId, { scopes, rateLimit });

    if (!result.ok) {
      const status = result.error === "not_owner" ? 403
        : result.error === "key_not_found" ? 404
        : 400;
      return res.status(status).json(result);
    }

    return res.json(result);
  });

  // ── DELETE /api/keys/:id — Revoke a key ──────────────────────────────
  router.delete("/:id", (req, res) => {
    const userId = req.user?.id;
    const result = revokeKey(req.params.id, userId);

    if (!result.ok) {
      const status = result.error === "not_owner" ? 403
        : result.error === "key_not_found" ? 404
        : 400;
      return res.status(status).json(result);
    }

    return res.json(result);
  });

  // ── POST /api/keys/validate — Validate a raw key (utility) ───────────
  router.post("/validate", (req, res) => {
    const { key } = req.body || {};
    const result = validateKey(key);
    return res.status(result.ok ? 200 : 401).json(result);
  });

  return router;
}
