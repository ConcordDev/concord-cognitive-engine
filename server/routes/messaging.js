// server/routes/messaging.js
// External messaging platform webhook receivers and binding management API.
// Mount at: app.use('/api/messaging', createMessagingRouter({ db, infer, contentGuard }))
//
// Three-gate additions required in server.js:
//   publicReadPaths: '/api/messaging'
//   publicReadDomains: messaging → Set(['status','bindings','connect','verify'])
//   safeReadBypass._safePostPaths: '/api/messaging/whatsapp/webhook',
//     '/api/messaging/telegram/webhook', '/api/messaging/discord/interactions',
//     '/api/messaging/signal/webhook', '/api/messaging/slack/events',
//     '/api/messaging/imessage/webhook'

import { Router } from "express";
import * as whatsapp from "../lib/messaging/adapters/whatsapp.js";
import * as telegram from "../lib/messaging/adapters/telegram.js";
import * as discord from "../lib/messaging/adapters/discord.js";
import * as signal from "../lib/messaging/adapters/signal.js";
import * as imessage from "../lib/messaging/adapters/imessage.js";
import * as slack from "../lib/messaging/adapters/slack.js";
import { buildAdapterRegistry } from "../lib/messaging/adapter-interface.js";
import {
  processInboundMessage,
  createBinding,
  verifyBinding,
  getUserBindings,
  deleteBinding,
} from "../lib/messaging/inbound-pipeline.js";
import { registerPermissionTierHook } from "../lib/messaging/permission-tiers.js";
import logger from '../logger.js';

const ADAPTERS = { whatsapp, telegram, discord, signal, imessage, slack };
const adapterRegistry = buildAdapterRegistry({ whatsapp, telegram, discord, signal, imessage, slack });

export function createMessagingRouter({ db, infer, contentGuard }) {
  const router = Router();

  // Register permission tier hook (idempotent)
  registerPermissionTierHook();

  // ─── PLATFORM STATUS ────────────────────────────────────────────────────────

  router.get("/status", (_req, res) => {
    const status = {};
    for (const [name, adapter] of Object.entries(ADAPTERS)) {
      status[name] = {
        configured: adapter.isConfigured(),
        platform: adapter.platform,
      };
    }
    res.json({ ok: true, platforms: status });
  });

  // ─── WEBHOOK RECEIVERS (unauthenticated — have own verification) ────────────

  function webhookHandler(adapter) {
    return async (req, res) => {
      // Platform-specific challenge/response (e.g., Meta, Slack URL verify)
      if (req.method === "GET" && adapter.platform === "whatsapp") {
        const result = whatsapp.handleVerificationChallenge(req.query);
        if (result.ok) return res.send(result.challenge);
        return res.sendStatus(403);
      }

      if (!adapter.verifyIncoming(req)) {
        return res.status(403).json({ error: "signature_invalid" });
      }

      const normalized = adapter.parseIncoming(req.body);

      // Handle Slack URL verification challenge
      if (normalized._challenge) {
        return res.json({ challenge: normalized._challenge });
      }

      // Process async — respond 200 immediately (most platforms require < 3s response)
      res.json({ ok: true });

      if (normalized.ok) {
        processInboundMessage({ adapter, normalized, db, infer, contentGuard }).catch((err) => {
          logger.warn('routes:messaging', 'inbound message processing failed', {
            platform: normalized?.platform,
            error: err?.message,
          });
        });
      }
    };
  }

  router.all("/whatsapp/webhook", webhookHandler(whatsapp));
  router.post("/telegram/webhook", webhookHandler(telegram));
  router.post("/discord/interactions", webhookHandler(discord));
  router.post("/signal/webhook", webhookHandler(signal));
  router.post("/slack/events", webhookHandler(slack));
  router.post("/imessage/webhook", webhookHandler(imessage));

  // ─── BINDING MANAGEMENT (authenticated) ────────────────────────────────────

  router.get("/bindings", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    const bindings = getUserBindings(db, userId);
    res.json({ ok: true, bindings });
  });

  router.post("/connect/:platform", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });

    const platform = req.params.platform;
    if (!ADAPTERS[platform]) return res.status(400).json({ error: "unknown_platform" });

    const { externalId, displayName } = req.body;
    if (!externalId) return res.status(400).json({ error: "externalId_required" });

    const { bindingId, verificationToken } = createBinding(db, userId, platform, String(externalId), displayName);

    res.json({
      ok: true,
      bindingId,
      verificationToken,
      instructions: `Send this token to your Concord bot on ${platform} to verify: ${verificationToken}`,
    });
  });

  router.post("/verify", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });

    const { platform, token } = req.body;
    if (!platform || !token) return res.status(400).json({ error: "platform_and_token_required" });

    const result = verifyBinding(db, userId, platform, token);
    res.json(result);
  });

  router.delete("/bindings/:bindingId", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    const result = deleteBinding(db, userId, req.params.bindingId);
    res.json(result);
  });

  router.patch("/bindings/:bindingId", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });

    const { permission_level, preferred } = req.body;
    const allowed = ["restricted", "standard", "elevated"];

    if (permission_level && !allowed.includes(permission_level)) {
      return res.status(400).json({ error: "invalid_permission_level" });
    }

    const updates = [];
    const params = [];
    if (permission_level) { updates.push("permission_level = ?"); params.push(permission_level); }
    if (preferred !== undefined) { updates.push("preferred = ?"); params.push(preferred ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: "no_updates" });

    params.push(req.params.bindingId, userId);
    try {
      db.prepare(`UPDATE messaging_bindings SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).run(...params);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "update_failed" });
    }
  });

  // ─── MESSAGE HISTORY ────────────────────────────────────────────────────────

  router.get("/messages", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });

    const { platform, limit = 20 } = req.query;
    try {
      const messages = db.prepare(`
        SELECT mm.id, mm.direction, mm.content_text, mm.created_at, mb.platform, mb.display_name
        FROM messaging_messages mm
        JOIN messaging_bindings mb ON mm.binding_id = mb.id
        WHERE mb.user_id = ?
        ${platform ? "AND mb.platform = ?" : ""}
        ORDER BY mm.created_at DESC LIMIT ?
      `).all(...(platform ? [userId, platform, Number(limit)] : [userId, Number(limit)]));
      res.json({ ok: true, messages });
    } catch {
      res.json({ ok: true, messages: [] });
    }
  });

  return router;
}
