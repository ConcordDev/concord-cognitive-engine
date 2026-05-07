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

  // ── Combat presentation ───────────────────────────────────────────
  // Telegraph fires immediately before applyAttack resolves so clients
  // can render anticipation pose / weapon glow / stance shift before
  // the damage lands. anticipationMs mirrors the biomechanics ladder.
  "combat:telegraph": { required: ["attackerId", "anticipationMs", "severity"], optional: ["targetId", "style", "tier"] },
  // Combo evolution surfaces a procedurally-derived combo with an
  // LLM-selected name; client raises a slow-mo + audio sting + hotbar
  // icon. `evolved` is the array from flow-engine.evolveFighterCombos.
  "combat:combo-evolved": { required: ["userId", "evolved"], optional: ["worldId"] },

  // ── Companions (pet/tame) ─────────────────────────────────────────
  "companion:tame-success": { required: ["ownerId", "companionId", "creatureId"], optional: ["name"] },
  "companion:deployed":     { required: ["ownerId", "companionId", "worldId"], optional: [] },
  "companion:level-up":     { required: ["companionId", "newLevel"], optional: ["ownerId"] },

  // ── Stealth perception (Phase B) ──────────────────────────────────
  // Fires when a high-perception observer breaks a hidden actor's cover
  // (e.g. a backstab attempt that fails the perception gate).
  "stealth:detected":       { required: ["detectorId", "hiddenId"], optional: ["confidence"] },

  // ── Kingdoms (Phase C) ────────────────────────────────────────────
  "kingdom:founded":         { required: ["kingdomId", "rulerId", "worldId"], optional: ["name"] },
  "kingdom:decree-enacted":  { required: ["kingdomId", "decreeId", "decreeKind", "activationState"], optional: ["alignmentScore"] },
  "kingdom:contested":       { required: ["kingdomId", "contestId", "claimantId", "contestKind"], optional: [] },
  "kingdom:fallen":          { required: ["contestId", "outcome"], optional: ["kingdomId"] },

  // ── Fishing (Phase D) ─────────────────────────────────────────────
  "fishing:cast":   { required: ["userId", "sessionId"], optional: ["biteAtEpochMs"] },
  "fishing:bite":   { required: ["userId", "sessionId"], optional: [] },
  "fishing:caught": { required: ["userId", "sessionId", "fishId"], optional: ["fishName", "qualityScore", "tier"] },

  // ── Minigames (Phase E) ───────────────────────────────────────────
  "minigame:started":  { required: ["matchId", "kind"], optional: ["players", "trackId"] },
  "minigame:scored":   { required: ["matchId", "kind", "actor"], optional: ["eventKind", "points"] },
  "minigame:complete": { required: ["matchId", "kind"], optional: ["winner"] },

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
/**
 * Lenient-registered events — known names without locked-in shapes.
 *
 * Phase 3.9 of the v1 closeout sprint registered 131 socket-emit events
 * the cartographer had flagged as "unshaped". Pinning strict shapes for
 * every one is premature (some are emergent / experimental); listing
 * them here makes the cartographer count them as known and lets
 * validateEvent return ok=true with `lenient: true` so dev-mode
 * warnings don't fire for events that have intentionally fluid payloads.
 *
 * To promote a lenient event to a strict shape: move it from this Set
 * into EVENT_SHAPES with required/optional fields, and remove it from
 * the Set in the same commit.
 */
export const LENIENT_EVENTS = new Set([
  "activity:new",
  "affect:pain_signal",
  "agent:insights",
  "app:created",
  "app:published",
  "artifact:rendered",
  "attention:allocation",
  "beacon:check",
  "body:destroyed",
  "body:instantiated",
  "boss:phase-enter",
  "channel:inbound",
  "chat:complete",
  "chat:status",
  "chat:token",
  "chat:update",
  "chat:web_results",
  "city:npcs",
  "city:positions",
  "city:stream-dtu-created",
  "city:stream-ended",
  "city:stream-sale",
  "city:stream-started",
  "collab:accepted",
  "collab:change",
  "collab:invite",
  "collab:lock",
  "collab:session:created",
  "collab:unlock",
  "collab:user:joined",
  "combat:attack:ack",
  "combat:block:ack",
  "combat:dodge:ack",
  "combat:kill",
  "comment:added",
  "council:proposal",
  "council:vote",
  "creative_registry:update",
  "crypto:ticker",
  "dream:captured",
  "dtu:deleted",
  "economy:update",
  "emergent:activity",
  "energy:update",
  "entity:death",
  "error",
  "event:name",
  "event:reward",
  "faction-war:tick",
  "feed:new-dtu",
  "finance:ticker",
  "forgetting:cycle_complete",
  "graph:update",
  "health:pulse",
  "health:update",
  "heartbeat:tick",
  "hello",
  "initiative:new",
  "lattice:meta:convergence",
  "lattice:meta:derived",
  "lens:dtu_generated",
  "market:listing",
  "marketplace:sale",
  "meta:committed",
  "music:toggle",
  "name",
  "nemesis:defeated",
  "news:update",
  "pain:avoidance_created",
  "pain:processed",
  "pain:recorded",
  "pain:wound_created",
  "pain:wound_healed",
  "pipeline:completed",
  "pipeline:started",
  "pipeline:step_completed",
  "pipeline:step_started",
  "platform:activity",
  "player:load:ack",
  "player:move:ack",
  "player:move:nack",
  "player:respawn:ack",
  "pong",
  "prediction:ready",
  "promotion:approved",
  "qualia:policy",
  "quest:completed",
  "queue:notifications:new",
  "repair:dtu_logged",
  "research:completed",
  "research:started",
  "research:update",
  "resonance:update",
  "room:joined",
  "room:left",
  "screen-share:answer",
  "screen-share:ice-candidate",
  "shared-session:ai-response",
  "shared-session:artifact-produced",
  "shared-session:dtu-shared",
  "shared-session:ended",
  "shared-session:invite",
  "shared-session:joined",
  "shared-session:message",
  "skill:xp-awarded",
  "subscribed",
  "system:alert",
  "system:reconnect",
  "teaching:promotion_suggestion",
  "tournament:bracket-advanced",
  "tournament:complete",
  "training:end",
  "training:round-end",
  "user:tick",
  "voice:answer",
  "voice:ice-candidate",
  "voice:offer",
  "voice:room-state",
  "weather:update",
  "whiteboard:updated",
  "world:action",
  "world:broadcast",
  "world:building-placed",
  "world:crisis",
  "world:crisis-resolved",
  "world:legendary-achievement",
  "world:loot-node",
  "world:node-update",
  "world:notification",
  "world:player-arrived",
  "yjs:update",
]);

export function validateEvent(eventName, payload) {
  const shape = EVENT_SHAPES[eventName];
  if (!shape) {
    if (LENIENT_EVENTS.has(eventName)) return { ok: true, lenient: true };
    return { ok: false, unregistered: true };
  }
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
