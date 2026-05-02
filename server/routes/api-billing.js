/**
 * API Billing Routes — v1.0
 *
 * Endpoints for API key management, usage dashboard, and alerts.
 * The metering engine (meterAPICall) is middleware, not a route —
 * these routes are for managing the billing system itself.
 */

import express from "express";
import "../lib/api-billing-constants.js"; // imported for module wiring; constants sourced below
import {
  API_BILLING_MODEL, API_KEY_SYSTEM, API_PRICING,
  API_DASHBOARD, API_BILLING_HEADERS, API_BALANCE_ALERTS,
  API_CONSTANTS,
  createAPIKey, revokeAPIKey, listAPIKeys, validateAPIKey,
  determineTier, getRateLimits,
  categorizeEndpoint, getCategoryCost,
  getMonthlyUsage, getFreeRemaining,
  meterAPICall,
  getUsageSummary, getUsageLog, getDailyUsage, getEndpointUsage,
  createAlert, getAlerts, deleteAlert, checkAlerts,
  getFeeDistributions,
} from "../economy/api-billing.js";

export default function createAPIBillingRouter({ db, requireAuth }) {
  const router = express.Router();

  // Auth for writes: POST/PUT/DELETE/PATCH require authentication
  const authForWrites = (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (typeof requireAuth === "function") return requireAuth()(req, res, next);
    return res.status(401).json({ ok: false, error: 'auth_not_configured' });
  };
  router.use(authForWrites);

  // ── Config ────────────────────────────────────────────────────────
  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      billingModel: API_BILLING_MODEL,
      keySystem: API_KEY_SYSTEM,
      pricing: API_PRICING,
      dashboard: API_DASHBOARD,
      billingHeaders: API_BILLING_HEADERS,
      balanceAlerts: API_BALANCE_ALERTS,
      constants: API_CONSTANTS,
    });
  });

  // ── API Key Management ────────────────────────────────────────────
  router.post("/keys", (req, res) => {
    const { userId, name, isTest } = req.body || {};
    const result = createAPIKey(db, { userId, name, isTest });
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.delete("/keys/:keyId", (req, res) => {
    const { userId } = req.body || {};
    const result = revokeAPIKey(db, { keyId: req.params.keyId, userId });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/keys/:userId", (req, res) => {
    const result = listAPIKeys(db, req.params.userId);
    res.json(result);
  });

  router.post("/keys/validate", (req, res) => {
    const { rawKey } = req.body || {};
    const result = validateAPIKey(db, rawKey);
    res.status(result.ok ? 200 : 401).json(result);
  });

  // ── Tier Info ─────────────────────────────────────────────────────
  router.get("/tier/:balance", (req, res) => {
    const balance = parseFloat(req.params.balance) || 0;
    const tier = determineTier(balance);
    const limits = getRateLimits(tier);
    res.json({ ok: true, tier, rateLimits: limits });
  });

  // ── Endpoint Pricing ──────────────────────────────────────────────
  router.post("/price", (req, res) => {
    const { endpoint, method, metadata } = req.body || {};
    if (!endpoint) return res.status(400).json({ ok: false, error: "missing_endpoint" });
    const category = categorizeEndpoint(endpoint, method || "GET");
    const cost = getCategoryCost(category, metadata || {});
    res.json({ ok: true, category, cost, endpoint, method });
  });

  // ── Metering (test endpoint) ──────────────────────────────────────
  router.post("/meter", (req, res) => {
    const { keyHash, userId, endpoint, method, metadata, balance } = req.body || {};
    const result = meterAPICall(db, { keyHash, userId, endpoint, method, metadata, balance });
    res.status(result.allowed ? 200 : 402).json(result);
  });

  // ── Usage Dashboard ───────────────────────────────────────────────
  router.get("/usage/:userId", (req, res) => {
    const result = getUsageSummary(db, req.params.userId);
    res.json(result);
  });

  router.get("/usage/:userId/log", (req, res) => {
    const { limit, offset, category } = req.query;
    const result = getUsageLog(db, req.params.userId, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      category,
    });
    res.json(result);
  });

  router.get("/usage/:userId/daily", (req, res) => {
    const { days } = req.query;
    const result = getDailyUsage(db, req.params.userId, { days: days ? Number(days) : 30 });
    res.json(result);
  });

  router.get("/usage/:userId/endpoints", (req, res) => {
    const { limit } = req.query;
    const result = getEndpointUsage(db, req.params.userId, { limit: limit ? Number(limit) : 20 });
    res.json(result);
  });

  // ── Free Allowance ────────────────────────────────────────────────
  router.get("/free/:userId/:category", (req, res) => {
    const remaining = getFreeRemaining(db, req.params.userId, req.params.category);
    res.json({ ok: true, category: req.params.category, freeRemaining: remaining });
  });

  // ── Monthly Usage ─────────────────────────────────────────────────
  router.get("/monthly/:userId", (req, res) => {
    const { month } = req.query;
    const usage = getMonthlyUsage(db, req.params.userId, month);
    res.json({ ok: true, ...usage });
  });

  // ── Alerts ────────────────────────────────────────────────────────
  router.post("/alerts", (req, res) => {
    const result = createAlert(db, req.body || {});
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.get("/alerts/:userId", (req, res) => {
    const result = getAlerts(db, req.params.userId);
    res.json(result);
  });

  router.delete("/alerts/:alertId", (req, res) => {
    const { userId } = req.body || {};
    const result = deleteAlert(db, { alertId: req.params.alertId, userId });
    res.status(result.ok ? 200 : 404).json(result);
  });

  router.post("/alerts/check", (req, res) => {
    const { userId, balance, dailySpend } = req.body || {};
    const result = checkAlerts(db, userId, { balance, dailySpend });
    res.json(result);
  });

  // ── Fee Distributions ─────────────────────────────────────────────
  router.get("/fees/:userId", (req, res) => {
    const { limit } = req.query;
    const result = getFeeDistributions(db, req.params.userId, { limit: limit ? Number(limit) : 50 });
    res.json(result);
  });

  return router;
}
