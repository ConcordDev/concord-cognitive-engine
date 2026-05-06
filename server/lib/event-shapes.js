/**
 * WebSocket Event Shape Registry
 *
 * Centralizes the payload shape contract for the highest-traffic socket
 * events emitted by realtimeEmit (server.js:6208). 91 emit call sites
 * exist across the codebase; this registry covers the top 20 by
 * frequency / criticality (combat, social, world clock, evo-asset
 * promotion, quests, marketplace, walker journeys).
 *
 * Why pin shapes here instead of TypeScript on the client?
 *   - The frontend uses the events without an explicit contract today;
 *     drift between server emit and client handler is silent.
 *   - The `validateEvent` helper below runs in dev/test mode only
 *     (NODE_ENV !== "production") so the runtime cost is zero in prod.
 *   - When CI catches a shape mismatch the fix is local and obvious.
 *
 * Shape format:
 *   { required: ["fieldName", ...], optional: ["fieldName", ...] }
 *
 * NOTE: realtimeEmit auto-attaches `ts`, `_seq`, `_rid`, `_evt` to every
 * payload (server.js:6210-6216). Those reserved fields are NOT listed in
 * any shape — the validator ignores them.
 */

const RESERVED = new Set(["ts", "_seq", "_rid", "_evt"]);

export const EVENT_SHAPES = Object.freeze({
  // ── Combat ────────────────────────────────────────────────────────
  "combat:attack": { required: ["attackerId"], optional: ["weapon", "animation", "direction", "position"] },
  "combat:hit":    { required: ["attackerId", "victimId", "damage"], optional: ["isCrit", "blocked", "staggered", "hitDirection", "magnitude", "position", "weapon"] },
  "combat:miss":   { required: ["attackerId", "victimId"], optional: ["missed"] },
  "combat:death":  { required: ["victimId"], optional: ["killerId", "position"] },

  // ── Social ────────────────────────────────────────────────────────
  "social:ping":   { required: ["from", "type", "position"], optional: ["cityId", "target", "text"] },

  // ── World ─────────────────────────────────────────────────────────
  "world:clock":         { required: ["phase", "segment", "epochMs", "dayLengthMs"], optional: [] },
  "world:weather":       { required: ["worldId", "type"], optional: ["intensity", "since", "windDirection"] },
  "world:refusal-field": { required: ["worldId", "kind"], optional: ["expiresAt", "reason", "glyphHint", "strength"] },

  // ── Evo-Asset ─────────────────────────────────────────────────────
  "evo:asset-promoted": { required: ["assetId", "versionId", "passKind"], optional: ["score", "kind"] },

  // ── Quests ────────────────────────────────────────────────────────
  "quest:new":              { required: ["questId", "title"], optional: ["worldId", "description", "giverNpcId", "rewardJson"] },
  "quest:rewards_granted":  { required: ["questId", "userId"], optional: ["xp", "gold", "items", "skillXp"] },

  // ── Timeline / Social Lens ────────────────────────────────────────
  "timeline:post":          { required: ["postId", "authorId"], optional: ["worldId", "summary", "tags"] },

  // ── Player effects ────────────────────────────────────────────────
  "player:effect-applied":  { required: ["userId", "effectId"], optional: ["expiresAt", "magnitude", "source"] },

  // ── NPC ───────────────────────────────────────────────────────────
  "npc:dialogue":           { required: ["npcId", "tree"], optional: ["worldId", "questId", "phase", "userId"] },

  // ── Concord Link (cross-world) ────────────────────────────────────
  "concord-link:delivered": { required: ["messageId"], optional: ["fromWorld", "toWorld", "hops"] },

  // ── DTU lifecycle ─────────────────────────────────────────────────
  "dtu:created":   { required: ["dtuId", "title"], optional: ["userId", "tags", "tier"] },
  "dtu:promoted":  { required: ["dtuId", "tier"], optional: ["fromTier", "score"] },

  // ── Marketplace ───────────────────────────────────────────────────
  "marketplace:purchase": { required: ["buyerId", "sellerId", "contentId", "amount"], optional: ["currency", "txId"] },

  // ── Walker journeys ───────────────────────────────────────────────
  "walker:dispatched":    { required: ["walkerId"], optional: ["fromWorld", "toWorld", "messageId"] },

  // ── GameJuice fanfare ─────────────────────────────────────────────
  "gameJuice:fanfare":    { required: ["userId", "kind"], optional: ["magnitude", "tone", "label"] },
});

/**
 * Validate a payload against its registered shape.
 *
 * @param {string} eventName — the socket.io event name, e.g. "combat:hit"
 * @param {object} payload   — the payload object passed to realtimeEmit
 * @returns {{ ok: boolean, missing?: string[], unknown?: string[], unregistered?: boolean }}
 *
 *   ok=true            — payload satisfies the shape
 *   ok=false + unregistered=true — event isn't in the registry (not a failure;
 *                                  the registry is intentionally partial)
 *   ok=false + missing — required fields are absent
 *   ok=false + unknown — payload has fields not in required+optional+RESERVED
 */
export function validateEvent(eventName, payload) {
  const shape = EVENT_SHAPES[eventName];
  if (!shape) return { ok: false, unregistered: true };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, missing: shape.required, unknown: [] };
  }

  const provided = new Set(Object.keys(payload));
  const allowed  = new Set([...shape.required, ...shape.optional, ...RESERVED]);

  const missing = shape.required.filter((k) => !provided.has(k));
  const unknown = [...provided].filter((k) => !allowed.has(k));

  if (missing.length > 0 || unknown.length > 0) {
    return { ok: false, missing, unknown };
  }
  return { ok: true };
}

/**
 * Helper for realtimeEmit-side dev-mode validation. Returns true when
 * shape validation should run (i.e. NOT in production). Intentionally
 * cheap so wrapping every emit doesn't add cost in prod.
 */
export function shouldValidateEventShapes() {
  const env = (typeof process !== "undefined" && process.env?.NODE_ENV) || "development";
  return env !== "production";
}
