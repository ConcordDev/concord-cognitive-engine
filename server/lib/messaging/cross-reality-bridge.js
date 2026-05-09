// server/lib/messaging/cross-reality-bridge.js
// Bridges external messaging platforms with Concordia world actions.
// Allows users to trigger world events via text messages and receive
// Concordia event notifications on their linked messaging channels.

import crypto from "node:crypto";
import logger from "../../logger.js";

// World action intent patterns — parse "build X in Y world" style commands
const WORLD_ACTION_PATTERNS = [
  { pattern: /\b(build|construct|place|create)\s+(.+?)\s+(?:in|at|on)\s+(.+)/i, type: "build", groups: { item: 2, location: 3 } },
  { pattern: /\b(move|go|travel|walk)\s+(?:to|towards?)\s+(.+)/i, type: "move", groups: { destination: 2 } },
  { pattern: /\b(buy|purchase|acquire)\s+(.+?)(?:\s+for\s+(.+))?$/i, type: "purchase", groups: { item: 2, price: 3 } },
  { pattern: /\b(attack|fight|battle)\s+(.+)/i, type: "combat", groups: { target: 2 } },
  { pattern: /\b(status|stats|health|balance|inventory)/i, type: "status_check", groups: {} },
];

/**
 * Parse a natural language message into a Concordia world action intent.
 * @param {string} text
 * @returns {{ type: string, parameters: object } | null}
 */
export function parseWorldIntent(text) {
  for (const { pattern, type, groups } of WORLD_ACTION_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const parameters = {};
    for (const [key, idx] of Object.entries(groups)) {
      if (match[idx]) parameters[key] = match[idx].trim();
    }
    return { type, parameters };
  }
  return null;
}

/**
 * Route an inbound message to a Concordia world action if it matches.
 * Falls back to normal chat inference if no world intent detected.
 *
 * @param {object} opts
 * @param {string} opts.text              - message text
 * @param {string} opts.userId            - Concord user ID
 * @param {string} opts.worldId           - active world ID (optional)
 * @param {Function} opts.infer           - inference function
 * @param {Function} [opts.worldExecute]  - world action executor (from world-engine)
 * @returns {Promise<string>} response text
 */
export async function routeToWorldOrChat({ text, userId, worldId, infer, worldExecute }) {
  const worldIntent = parseWorldIntent(text);

  if (worldIntent && worldId && worldExecute) {
    try {
      // Use subconscious brain to interpret and validate the action
      const interpretation = await infer({
        role: "subconscious",
        intent: `Parse this into a Concordia world action command: "${text}". Return JSON with action, target, parameters.`,
        callerId: `messaging:cross-reality:${userId}`,
        brainOverride: "subconscious",
        maxSteps: 1,
      });

      let actionParams = worldIntent;
      try {
        const parsed = JSON.parse(interpretation.finalText.match(/\{[\s\S]+\}/)?.[0] || "{}");
        if (parsed.action) actionParams = parsed;
      } catch { /* use pattern-parsed intent */ }

      const result = await worldExecute({
        type: actionParams.type,
        parameters: actionParams.parameters || {},
        actor: { type: "user", userId },
        callerId: `messaging:cross-reality:${userId}`,
      });

      return result?.message || result?.description || `Action ${actionParams.type} completed.`;
    } catch (err) {
      return `World action failed: ${err?.message || "unknown error"}. Try a simpler command.`;
    }
  }

  // Fall back to normal chat
  try {
    const result = await infer({
      role: "conscious",
      intent: text,
      callerId: `messaging:cross-reality-fallback:${userId}`,
      maxSteps: 3,
    });
    return result.finalText || "I couldn't process that request.";
  } catch {
    return "I encountered an error. Please try again.";
  }
}

/**
 * Notify a user of a Concordia world event via their preferred messaging binding.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {object} opts.event            - world event object
 * @param {object} opts.db               - SQLite instance
 * @param {object} opts.adapters         - Map<platform, adapter>
 */
export async function notifyUserOfWorldEvent({ userId, event, db, adapters }) {
  let bindings = [];
  try {
    bindings = db.prepare(`
      SELECT * FROM messaging_bindings
      WHERE user_id = ? AND verified = 1
      ORDER BY preferred DESC, last_used_at DESC
      LIMIT 1
    `).all(userId);
  } catch { return; }

  if (!bindings.length) return;

  const binding = bindings[0];
  const adapter = adapters.get(binding.platform);
  if (!adapter?.isConfigured()) return;

  const text = formatWorldEventNotification(event);
  await adapter.sendMessage(binding.external_id, text).catch(err => logger?.debug?.('[cross-reality-bridge] background op failed', { err: err?.message }));
}

/**
 * Format a world event into a human-readable notification message.
 */
function formatWorldEventNotification(event) {
  const type = event?.type || "event";
  const description = event?.description || event?.message || "";
  const timestamp = event?.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "";

  const prefixes = {
    combat: "⚔️ Combat",
    quest_complete: "✅ Quest Complete",
    level_up: "⬆️ Level Up",
    item_received: "🎁 Item Received",
    death: "💀 Character Update",
    world_event: "🌍 World Event",
  };

  const prefix = prefixes[type] || "📨 Concordia";
  return `${prefix}${timestamp ? ` [${timestamp}]` : ""}: ${description}`.slice(0, 1000);
}
