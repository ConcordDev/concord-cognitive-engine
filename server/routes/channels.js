/**
 * Channel Routes — Express endpoints for messaging integration
 *
 * Webhook endpoints for Telegram, Discord, and SendGrid inbound parse,
 * plus user-facing settings and channel linking endpoints.
 *
 * Mounts under /api/channels via app.use("/api/channels", ...).
 */

import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import * as telegram from "../channels/telegram.js";
import * as discord from "../channels/discord.js";
import * as email from "../channels/email.js";
import {
  routeInbound,
  routeMessage,
  routeNotification,
  getUserPreferences,
  setUserPreferences,
  linkChannel,
  unlinkChannel,
  getChannelStatus,
  CHANNELS,
} from "../channels/index.js";
import logger from "../logger.js";

/**
 * Create the channels router.
 *
 * @param {object} deps
 * @param {object} deps.STATE        - Server state
 * @param {function} [deps.requireAuth] - Auth middleware factory
 * @param {function} [deps.realtimeEmit] - WebSocket emit helper
 * @returns {express.Router}
 */
export default function createChannelsRouter({ STATE, requireAuth, realtimeEmit } = {}) {
  const router = express.Router();

  // Auth middleware for protected endpoints
  const auth = typeof requireAuth === "function"
    ? requireAuth()
    : (_req, _res, next) => next();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Webhook Endpoints (unauthenticated — verified by channel-specific secrets)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * POST /telegram/webhook
   *
   * Receives Telegram Bot API webhook updates.
   * Verifies the secret token header if TELEGRAM_WEBHOOK_SECRET is set.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/telegram/webhook", asyncHandler(async (req, res) => {
    // Verify webhook secret if configured
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || "";
    if (secretToken) {
      const headerSecret = req.headers["x-telegram-bot-api-secret-token"] || "";
      if (!telegram.verifyWebhookSecret(headerSecret, secretToken)) {
        logger.warn("channels", "Telegram webhook secret mismatch");
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
    }

    const update = req.body;
    if (!update) {
      return res.status(400).json({ ok: false, error: "empty_update" });
    }

    // Parse the incoming update
    const normalized = telegram.handleIncoming(update);

    if (!normalized.ok) {
      // Acknowledge even unsupported update types (Telegram requires 200)
      return res.json({ ok: true, handled: false, type: normalized.type });
    }

    // Route to chat pipeline
    const routeResult = routeInbound(CHANNELS.TELEGRAM, normalized, STATE);

    // Send response back to user via Telegram if chat pipeline produced a route
    if (routeResult.ok && routeResult.route?.message) {
      // Fire-and-forget: send the response back asynchronously
      telegram.sendMessage(normalized.chatId, routeResult.route.message).catch((err) => {
        logger.error("channels", "Telegram response send failed", { error: err.message });
      });
    }

    // Emit WebSocket event for real-time UI updates
    if (realtimeEmit && routeResult.ok) {
      realtimeEmit("channel:inbound", {
        channel: "telegram",
        userId: routeResult.userId,
        actionType: routeResult.route?.actionType,
      });
    }

    // Telegram requires 200 OK acknowledgment
    res.json({ ok: true, handled: true });
  }));

  /**
   * POST /discord/interactions
   *
   * Receives Discord interaction events (slash commands, components).
   * Verifies the Ed25519 signature from Discord.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/discord/interactions", asyncHandler(async (req, res) => {
    // Discord requires signature verification
    const signature = req.headers["x-signature-ed25519"] || "";
    const timestamp = req.headers["x-signature-timestamp"] || "";

    // Need raw body for signature verification
    // Express should have the raw body available if configured with express.json({ verify })
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (process.env.DISCORD_PUBLIC_KEY) {
      const isValid = discord.verifyInteractionSignature(rawBody, signature, timestamp);
      if (!isValid) {
        logger.warn("channels", "Discord interaction signature invalid");
        return res.status(401).json({ ok: false, error: "invalid_signature" });
      }
    }

    const interaction = req.body;
    if (!interaction) {
      return res.status(400).json({ ok: false, error: "empty_interaction" });
    }

    // Parse the interaction
    const normalized = discord.handleSlashCommand(interaction);

    // Ping — respond immediately
    if (normalized.type === "ping") {
      return res.json(normalized.response);
    }

    // Send the immediate interaction response (deferred)
    if (normalized.response) {
      res.json(normalized.response);
    } else {
      res.json({ type: 5 }); // Deferred
    }

    // Process asynchronously after responding
    if (normalized.ok && normalized.text) {
      const routeResult = routeInbound(CHANNELS.DISCORD, normalized, STATE);

      // Send follow-up message with the result
      if (routeResult.ok && routeResult.route?.message && normalized.interactionToken) {
        discord.sendFollowup(normalized.interactionToken, routeResult.route.message).catch((err) => {
          logger.error("channels", "Discord followup failed", { error: err.message });
        });
      }

      if (realtimeEmit && routeResult.ok) {
        realtimeEmit("channel:inbound", {
          channel: "discord",
          userId: routeResult.userId,
          actionType: routeResult.route?.actionType,
        });
      }
    }
  }));

  /**
   * POST /email/inbound
   *
   * Receives SendGrid Inbound Parse webhook payloads.
   * Expects multipart/form-data or JSON body.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/email/inbound", asyncHandler(async (req, res) => {
    const payload = req.body;
    if (!payload) {
      return res.status(400).json({ ok: false, error: "empty_payload" });
    }

    // Parse the inbound email
    const normalized = email.handleInboundEmail(payload);

    if (!normalized.ok) {
      logger.info("channels", "Inbound email rejected", { type: normalized.type, reason: normalized.reason });
      // SendGrid expects 200 to stop retries
      return res.json({ ok: true, handled: false, type: normalized.type });
    }

    // Route to chat pipeline
    const routeResult = routeInbound(CHANNELS.EMAIL, normalized, STATE);

    // Optionally reply by email
    if (routeResult.ok && routeResult.route?.message && normalized.from) {
      const subject = normalized.subject
        ? `Re: ${normalized.subject}`
        : "Reply from Concord";

      email.sendEmail(
        normalized.from,
        subject,
        `<p>${routeResult.route.message.replace(/\n/g, "<br>")}</p>`,
      ).catch((err) => {
        logger.error("channels", "Email reply failed", { error: err.message });
      });
    }

    if (realtimeEmit && routeResult.ok) {
      realtimeEmit("channel:inbound", {
        channel: "email",
        userId: routeResult.userId,
        actionType: routeResult.route?.actionType,
      });
    }

    // SendGrid expects 200 OK
    res.json({ ok: true, handled: true });
  }));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // User Settings (authenticated)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /settings
   *
   * Get the authenticated user's channel preferences.
   */
  router.get("/settings", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId || "anonymous";
    const prefs = getUserPreferences(userId, STATE);
    const status = getChannelStatus();

    res.json({
      ok: true,
      userId,
      preferences: prefs,
      availableChannels: status,
    });
  }));

  /**
   * PUT /settings
   *
   * Update the authenticated user's channel preferences.
   *
   * Body: {
   *   preferredChannel: "telegram"|"discord"|"email"|"inApp",
   *   notifications: { alerts, initiatives, digests, quietHoursStart, quietHoursEnd }
   * }
   */
  router.put("/settings", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "authentication_required" });
    }

    const updates = req.body || {};

    try {
      const prefs = setUserPreferences(userId, updates, STATE);
      res.json({ ok: true, preferences: prefs });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Channel Linking (authenticated)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * POST /connect/telegram
   *
   * Link a Telegram account. User provides the chat ID obtained
   * from messaging the bot (e.g. via /start).
   *
   * Body: { chatId: string, username?: string }
   */
  router.post("/connect/telegram", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "authentication_required" });
    }

    const { chatId, username } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ ok: false, error: "chatId_required" });
    }

    // Verify the chat exists by sending a verification message
    if (telegram.isConfigured()) {
      const verifyResult = await telegram.sendMessage(chatId, "Your Telegram account has been linked to Concord. You will now receive notifications here.");
      if (!verifyResult.ok) {
        return res.status(400).json({
          ok: false,
          error: "telegram_verification_failed",
          detail: "Could not send a message to this chat ID. Make sure you have started a conversation with the bot.",
        });
      }
    }

    const result = linkChannel(userId, CHANNELS.TELEGRAM, { chatId, username }, STATE);
    res.json(result);
  }));

  /**
   * POST /connect/discord
   *
   * Link a Discord account. User provides their Discord user ID
   * and/or a personal webhook URL.
   *
   * Body: { userId: string, username?: string, webhookUrl?: string }
   */
  router.post("/connect/discord", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "authentication_required" });
    }

    const { userId: discordUserId, username, webhookUrl } = req.body || {};
    if (!discordUserId && !webhookUrl) {
      return res.status(400).json({ ok: false, error: "discord_userId_or_webhookUrl_required" });
    }

    // Validate webhook URL format if provided
    if (webhookUrl && !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      return res.status(400).json({ ok: false, error: "invalid_webhook_url" });
    }

    const result = linkChannel(userId, CHANNELS.DISCORD, {
      userId: discordUserId,
      username,
      webhookUrl,
    }, STATE);

    res.json(result);
  }));

  /**
   * POST /connect/email
   *
   * Link an email address for notifications.
   *
   * Body: { address: string }
   */
  router.post("/connect/email", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "authentication_required" });
    }

    const { address } = req.body || {};
    if (!address || !address.includes("@")) {
      return res.status(400).json({ ok: false, error: "valid_email_required" });
    }

    // Send a verification email
    if (email.isConfigured()) {
      await email.sendEmail(
        address,
        "Verify your email for Concord",
        `<p>Your email address has been linked to your Concord account for notifications.</p>
         <p>If you did not request this, you can safely ignore this email.</p>`,
      );
    }

    const result = linkChannel(userId, CHANNELS.EMAIL, {
      address,
      verified: false, // Full verification flow can be added later
    }, STATE);

    res.json(result);
  }));

  /**
   * DELETE /connect/:channel
   *
   * Unlink a channel from the user's account.
   */
  router.delete("/connect/:channel", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "authentication_required" });
    }

    const channel = req.params.channel;
    if (!["telegram", "discord", "email"].includes(channel)) {
      return res.status(400).json({ ok: false, error: "invalid_channel" });
    }

    const result = unlinkChannel(userId, channel, STATE);
    res.json(result);
  }));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Admin / Status
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /status
   *
   * Get the configuration status of all channels.
   */
  router.get("/status", asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      channels: getChannelStatus(),
    });
  }));

  /**
   * POST /telegram/register-webhook
   *
   * Register the Telegram webhook URL (admin action).
   *
   * Body: { url: string, secretToken?: string }
   */
  router.post("/telegram/register-webhook", auth, asyncHandler(async (req, res) => {
    const { url, secretToken } = req.body || {};
    if (!url) {
      return res.status(400).json({ ok: false, error: "url_required" });
    }

    const result = await telegram.registerWebhook(url, { secretToken });
    res.json(result);
  }));

  /**
   * POST /send
   *
   * Send a message to a user through their preferred channel (admin/system use).
   *
   * Body: { userId: string, message: string, channel?: string }
   */
  router.post("/send", auth, asyncHandler(async (req, res) => {
    const { userId, message, channel } = req.body || {};
    if (!userId || !message) {
      return res.status(400).json({ ok: false, error: "userId_and_message_required" });
    }

    const result = await routeMessage(userId, message, channel, STATE);
    res.json(result);
  }));

  /**
   * POST /notify
   *
   * Send a notification to a user (admin/system use).
   *
   * Body: { userId: string, event: string, data: object }
   */
  router.post("/notify", auth, asyncHandler(async (req, res) => {
    const { userId, event, data } = req.body || {};
    if (!userId || !event) {
      return res.status(400).json({ ok: false, error: "userId_and_event_required" });
    }

    const result = await routeNotification(userId, event, data || {}, STATE);
    res.json(result);
  }));

  return router;
}
