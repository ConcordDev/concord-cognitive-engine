// server/lib/messaging/inbound-pipeline.js
// Processes inbound messages from external messaging platforms.
// Steps: lookup binding → content guard → rate limit → inference → respond.

import crypto from "node:crypto";
import { PERMISSION_TIERS } from "./permission-tiers.js";
import logger from "../../logger.js";
import { parseWorldIntent, routeToWorldOrChat } from "./cross-reality-bridge.js";

/**
 * Process an inbound message from an external platform.
 *
 * @param {object} opts
 * @param {object} opts.adapter          - platform adapter (sendMessage, platform)
 * @param {object} opts.normalized       - NormalizedMessage from adapter.parseIncoming()
 * @param {object} opts.db               - better-sqlite3 instance
 * @param {Function} opts.infer          - @concord/inference infer()
 * @param {Function} opts.createDTU      - DTU creation function
 * @param {object} [opts.contentGuard]   - optional content guard module
 */
export async function processInboundMessage({ adapter, normalized, db, infer, createDTU, contentGuard }) {
  if (!normalized.ok || !normalized.text) return;

  const { platform } = adapter;

  // 1. Look up binding — map platform sender to a Concord user
  let binding = null;
  try {
    binding = db.prepare(`
      SELECT * FROM messaging_bindings
      WHERE platform = ? AND external_id = ? AND verified = 1
    `).get(platform, normalized.externalId);
  } catch { /* DB may not have table yet */ }

  if (!binding) {
    // Unknown sender — send onboarding prompt
    await adapter.sendMessage(normalized.chatId,
      `This account isn't linked to Concord. Visit your Concord settings to connect ${platform}.`
    ).catch(err => logger?.debug?.('[inbound-pipeline] background op failed', { err: err?.message }));
    return;
  }

  // 2. Content guard check
  if (contentGuard?.check) {
    try {
      const guard = await contentGuard.check(normalized.text, { userId: binding.user_id, platform });
      if (!guard.ok) {
        await adapter.sendMessage(normalized.chatId, "I can't help with that.").catch(err => logger?.debug?.('[inbound-pipeline] background op failed', { err: err?.message }));
        return;
      }
    } catch { /* content guard errors are non-fatal */ }
  }

  // 2b. Cross-reality routing — check if message targets a virtual world
  const worldIntent = parseWorldIntent(normalized.text ?? '');
  if (worldIntent) {
    // TODO: wire infer and worldExecute when available in this scope for full routing
    await routeToWorldOrChat({ text: normalized.text, userId: binding.user_id, worldId: null, infer, worldExecute: null }).catch(err => logger?.debug?.('[inbound] world routing failed', { err: err?.message }));
    return; // handled by world routing
  }

  // 3. Record inbound message
  const inboundId = `msg_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO messaging_messages (id, binding_id, direction, external_message_id, content_text, created_at)
      VALUES (?, ?, 'inbound', ?, ?, ?)
    `).run(inboundId, binding.id, normalized.messageId || null, normalized.text, now);
  } catch { /* non-fatal */ }

  // 4. Run inference
  let responseText = "";
  let inferenceId = null;

  try {
    const tier = PERMISSION_TIERS[binding.permission_level] || PERMISSION_TIERS.standard;

    const result = await infer({
      role: "conscious",
      intent: normalized.text,
      callerId: `messaging:${platform}:${binding.user_id}`,
      lensContext: {
        lens: "chat",
        platform,
        permissionLevel: binding.permission_level || "standard",
        tier,
      },
      maxSteps: 5,
    });

    responseText = result.finalText || "";
    inferenceId = result.inferenceId;
  } catch (err) {
    responseText = "I encountered an error processing your message. Please try again.";
  }

  if (!responseText) return;

  // 5. Send response back on the platform
  const sendResult = await adapter.sendMessage(normalized.chatId, responseText).catch(err => { logger?.debug?.('[inbound-pipeline] background op failed', { err: err?.message }); return { ok: false }; });

  // 6. Record outbound message
  const outboundId = `msg_${crypto.randomBytes(8).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO messaging_messages (id, binding_id, direction, external_message_id, content_text, created_at)
      VALUES (?, ?, 'outbound', ?, ?, ?)
    `).run(outboundId, binding.id, sendResult?.messageId || null, responseText, new Date().toISOString());

    // Update last_used_at on the binding
    db.prepare(`UPDATE messaging_bindings SET last_used_at = ? WHERE id = ?`).run(new Date().toISOString(), binding.id);
  } catch { /* non-fatal */ }
}

/**
 * Create a new messaging binding for a user.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} platform
 * @param {string} externalId
 * @param {string} [displayName]
 * @returns {{ bindingId: string, verificationToken: string }}
 */
export function createBinding(db, userId, platform, externalId, displayName) {
  const bindingId = `bind_${crypto.randomBytes(8).toString("hex")}`;
  const verificationToken = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO messaging_bindings
    (id, user_id, platform, external_id, display_name, verified, verification_token, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(bindingId, userId, platform, externalId, displayName || null, verificationToken, now);

  return { bindingId, verificationToken };
}

/**
 * Verify a binding using the token the user sent from the platform.
 */
export function verifyBinding(db, userId, platform, token) {
  const binding = db.prepare(`
    SELECT * FROM messaging_bindings
    WHERE user_id = ? AND platform = ? AND verification_token = ? AND verified = 0
  `).get(userId, platform, token);

  if (!binding) return { ok: false, error: "invalid_token" };

  db.prepare(`
    UPDATE messaging_bindings SET verified = 1, verified_at = ? WHERE id = ?
  `).run(new Date().toISOString(), binding.id);

  return { ok: true, bindingId: binding.id };
}

/**
 * Get all verified bindings for a user.
 */
export function getUserBindings(db, userId) {
  try {
    return db.prepare(`
      SELECT id, platform, external_id, display_name, permission_level, preferred, last_used_at, created_at
      FROM messaging_bindings WHERE user_id = ? AND verified = 1
      ORDER BY preferred DESC, last_used_at DESC
    `).all(userId);
  } catch {
    return [];
  }
}

/**
 * Delete a binding.
 */
export function deleteBinding(db, userId, bindingId) {
  const result = db.prepare(`
    DELETE FROM messaging_bindings WHERE id = ? AND user_id = ?
  `).run(bindingId, userId);
  return { ok: result.changes > 0 };
}
