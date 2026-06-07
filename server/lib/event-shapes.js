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
  "combat:hit":    { required: ["attackerId", "victimId", "damage"], optional: ["isCrit", "blocked", "staggered", "hitDirection", "magnitude", "position", "weapon", "targetId", "targetHealth", "targetMaxHealth", "targetKilled", "targetPosition", "attackerPosition", "element", "skillId", "tier", "style", "skillKey"] },
  "combat:miss":   { required: ["attackerId", "victimId"], optional: ["missed"] },
  "combat:death":  { required: ["victimId"], optional: ["killerId", "position"] },
  // Sprint 1 — defensive-loop wiring. ack events carry the granted i-frame
  // window + parry result; the :perfect events drive the reward slow-mo.
  "combat:dodge:ack":     { required: ["userId"], optional: ["direction", "t", "iframeMs", "perfect"] },
  "combat:dodge:perfect": { required: ["userId"], optional: ["timeDilationPct", "durationMs", "t"] },
  "combat:block:ack":     { required: ["userId"], optional: ["active", "t", "parried", "perfect", "riposteWindowMs"] },
  "combat:parry:perfect": { required: ["userId"], optional: ["riposteWindowMs", "timeDilationPct", "durationMs", "t"] },

  // ── Combat presentation ───────────────────────────────────────────
  // Telegraph fires immediately before applyAttack resolves so clients
  // can render anticipation pose / weapon glow / stance shift before
  // the damage lands. anticipationMs mirrors the biomechanics ladder.
  "combat:telegraph": { required: ["attackerId", "anticipationMs", "severity"], optional: ["targetId", "style", "tier", "perilKind", "counter"] },
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
  "walker:dispatched":    { required: ["walkerId"], optional: ["fromWorld", "toWorld", "messageId", "contractId", "route", "dispatchedAt"] },

  // ── GameJuice fanfare ─────────────────────────────────────────────
  "gameJuice:fanfare":    { required: ["userId", "kind"], optional: ["magnitude", "tone", "label"] },

  // ── Forge — polyglot template engine lifecycle ────────────────────
  // Emitted by emergent/forge-template-engine.js when a template is
  // created/generated/published. Surfaces to the ForgeWorkbench UI for
  // live status updates without polling.
  "forge:template:created":   { required: ["id", "name"], optional: [] },
  "forge:template:generated": { required: ["id", "genId", "lineCount"], optional: [] },
  "forge:template:published": { required: ["id", "name"], optional: [] },

  // ── Layer 13 — NPC ambient conversations ──────────────────────────
  // Emitted by emergent/npc-conversation-initiator.js when a new NPC↔NPC
  // conversation opens. Surfaces to nearby players (subscribed to
  // world:${worldId}) so ambient NPC dialogue is visible.
  "npc:conversation-bid": {
    required: ["id", "worldId", "npcA", "npcB", "opener"],
    optional: ["expiresAt"],
  },

  // ── Lattice-born quests (Phase 4c) ────────────────────────────────
  // Emitted by emergent/lattice-quest-cycle.js when a drift alert promotes
  // into a player-facing quest. Surfaces to EmergentEventFeed.
  "quest:lattice-born": {
    required: ["questId", "hostNpcId", "title"],
    optional: ["driftType", "driftSeverity"],
  },

  // ── Personal beat scheduler (Phase 3) ─────────────────────────────
  // Emitted by emergent/personal-beat-scheduler.js when a forward-sim
  // prediction surfaces as a goddess beat. Per-user (room user:${id}).
  "beat:offered": {
    required: ["id", "userId", "predictionId", "prose"],
    optional: ["worldId", "subjectKind"],
  },

  // ── Combat polish ladder ──────────────────────────────────────────
  // Emitted by lib/combat-polish.js#emitCombatEvent. The detail object is
  // event-kind-specific; validator allows it as a free-form object.
  "combat:polish": {
    required: ["id", "worldId", "actorKind", "actorId", "eventKind"],
    optional: ["detail"],
  },

  // ── Procgen wilderness regions (Phase 5e) ─────────────────────────
  // Emitted by lib/procgen-regions.js when a drift alert spawns a region.
  "world:region-spawned": {
    required: ["regionId", "worldId", "regionKind", "anchor"],
    optional: ["radius", "narrative"],
  },

  // ── Seasons (Phase 5c) ────────────────────────────────────────────
  // Emitted by lib/seasons.js#advanceSeasonForWorld on each transition.
  "world:season-transition": {
    required: ["worldId", "seasonIdx", "seasonName", "year"],
    optional: ["narrative"],
  },

  // ── Skill tier witnessed (Phase 1) ────────────────────────────────
  // Emitted by routes/worlds.js when a player casts a skill of revision
  // ≥ 1 in combat. Powers the npc-skill-evolve-cycle witness path.
  "skill:tier-witnessed": {
    required: ["userId", "npcId", "worldId", "skillId", "skillName", "revisionNum"],
    optional: ["element", "damage", "position"],
  },

  // ── World-wide invariant warning ──────────────────────────────────
  // Emitted by server.js when invariant-guardian detector reports a
  // critical finding; surfaces to all clients (no room scope).
  "world:invariant-warning": {
    required: ["id", "message", "severity"],
    optional: ["location", "generatedAt"],
  },

  // ── Sprint B Phase 8 — combat juice events promoted from lenient ──
  // Both events were emitted by the substrate but never had registered
  // shapes; the audit pass exposed them via cartograph drift, and the
  // combat-juice bridge subscribes to them now.

  // DBZ-style stagger when a high-magnitude (≥30) hit projects through
  // a building. Fires from routes/worlds.js#/combat/attack right after
  // the env-multiplier step, post-cap. The frontend
  // CombatStaggerCameraBridge consumes this for the camera punch-in.
  // Required fields match the actual emit at routes/worlds.js:2127;
  // attackerId is attached so the client can scope camera punches to
  // events the local player is involved in.
  "combat:stagger": {
    required: ["worldId", "targetId", "durationMs"],
    optional: ["attackerId", "targetType", "buildingId", "structuralStress", "elementContrib"],
  },

  // Geo-Mod-light building state transitions. Fires from
  // routes/worlds.js when applyStructuralStress reports a state change.
  // The BuildingCollapseBridge listens for the 'collapsed' transition
  // specifically; the 'damaged' transition gets a smaller VFX cue.
  // attackerId + position are attached so the client can dial full-
  // screen feedback to collapses near the local player.
  "world:building-state": {
    required: ["worldId", "buildingId", "state"],
    optional: ["healthPct", "position", "structuralStress", "attackerId"],
  },

  // Sprint B Phase 9 — NPC visible sentience snapshot. Emitted by the
  // npc-perception-snapshot heartbeat (frequency 8). Drives frontend
  // head-turns, posture mirroring, and mood bias. The renderer
  // applies the update only when the local player matches
  // shouldLookAtPlayer (otherwise the perception is for someone else).
  "npc:perception-update": {
    required: ["npcId", "worldId", "moodBias"],
    optional: [
      "shouldLookAtPlayer",
      "activeGrudgeSeverity",
      "shouldMirrorPosture",
      "shouldAvoidEyeContact",
      "preoccupationKind",
      "factionPhase",
    ],
  },

  // ── Whiteboard realtime collaboration ─────────────────────────────
  // Emitted by server/domains/whiteboard.js broadcast-scene /
  // broadcast-cursor / shared-vote-cast macros. Scoped to
  // socket.io room `whiteboard:${boardId}` so only participants
  // receive events. Multi-cursor + last-write-wins scene sync
  // makes the whiteboard lens true real-time multiplayer.
  "whiteboard:scene-update": {
    required: ["boardId", "userId", "elementCount"],
    optional: [],
  },
  "whiteboard:cursor": {
    required: ["boardId", "userId", "x", "y"],
    optional: [],
  },
  "whiteboard:vote-cast": {
    required: ["boardId", "elementId", "voterId", "voteCount"],
    optional: [],
  },

  // ── Message lens multi-device sync ────────────────────────────────
  // Emitted by server/domains/message.js to room `user:${userId}` so
  // a save/react/voice action on one device flips instantly on every
  // other device the same user has open.
  "message:saved": {
    required: ["userId", "messageId"],
    optional: ["threadId", "entry"],
  },
  "message:unsaved": {
    required: ["userId", "messageId"],
    optional: [],
  },
  "message:reacted": {
    required: ["userId", "messageId", "emoji", "count"],
    optional: [],
  },
  "message:voice-registered": {
    required: ["userId", "messageId", "durationMs"],
    optional: [],
  },

  // ── World voice chat (WebRTC + 50m spatial cells) ─────────────────
  // Emitted by server/domains/world.js voice-{join-cell,update-position,
  // leave-cell,signal} macros. Two room scopes:
  //   • `voice:${worldId}:${cellKey}` — peer-joined / peer-left
  //   • `user:${userId}`              — voice:signal (WebRTC SDP/ICE)
  // Audio NEVER touches the server; the substrate only handles peer
  // discovery + signaling. payload is opaque to the validator.
  "voice:peer-joined": {
    required: ["userId", "worldId", "cellKey"],
    optional: [],
  },
  "voice:peer-left": {
    required: ["userId", "worldId", "cellKey"],
    optional: [],
  },
  "voice:signal": {
    required: ["from", "to", "kind", "payload"],
    optional: ["worldId", "cellKey"],
  },

  // ── Phase F3 — simulation surfacing emit sites ────────────────────
  "faction:war-declared":       { required: ["factionId", "targetFactionId", "move", "summary", "moveId"], optional: [] },
  "faction:alliance-formed":    { required: ["factionId", "targetFactionId", "summary", "moveId"], optional: [] },
  "faction:truce-sought":       { required: ["factionId", "targetFactionId", "summary", "moveId"], optional: [] },
  "npc:scheme-resolved":        { required: ["schemeId", "plotterKind", "plotterId", "kind", "outcome"], optional: ["targetKind", "targetId"] },
  "dream:composed":             { required: ["userId", "dreamRowId", "dreamDtuId", "fragmentCount"], optional: ["worldId"] },
  "prediction:realised":        { required: ["predictionId"], optional: ["userId", "subjectKind", "subjectId", "outcome"] },
  "refusal:compound-threshold": { required: ["worldId", "strength"], optional: ["kind", "reason"] },

  // ── Phase G1 — batched + chain + bridge surfacing ─────────────────
  "combat:chain":               { required: ["originActorId", "targets"], optional: ["worldId", "magnitude", "element"] },
  // T1.4b — server-authoritative combat feel. `feel` carries the exact
  // hitstop/knockback/wince parameters the client applies verbatim.
  "combat:impact":              { required: ["attackerId", "targetId", "severity", "feel"], optional: ["worldId", "targetKind", "impactMomentum", "element", "damage", "isKill", "targetPosition", "attackerPosition", "vfx", "skillKey", "ts"] },
  "npc:activity-batch":         { required: ["worldId", "count", "transitions"], optional: [] },
  "npc:economy-batch":          { required: ["worldId", "gathers", "crafts", "trades", "rests", "notable"], optional: [] },
  "social:shadows-synced":      { required: ["createdShadows", "totalCapacity"], optional: ["droppedForPrivacy"] },

  // ── ConKay honest event spine (Track B / Phase 0) ─────────────────
  // Emitted by app.post("/api/lens/run") to the caller's user:<id> room
  // when the request opts in with a correlation id (x-conkay-run-id /
  // body.__runId). They make a macro's single request→response lifecycle
  // observable so the ConKay HUD can animate the *real* call beginning and
  // ending — never a guessed spinner. `macro:stage` is optional and only
  // ever fires when a macro reports a genuine internal stage (none do yet;
  // the shape is registered so future stage-emitting macros validate).
  "macro:started":   { required: ["runId", "domain", "action"], optional: [] },
  "macro:stage":     { required: ["runId", "stage"], optional: ["domain", "action", "detail", "index", "total"] },
  "macro:completed": { required: ["runId", "domain", "action", "ok"], optional: ["ms", "error"] },
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
  "audio-room:answer",
  "audio-room:ice-candidate",
  "audio-room:offer",
  "audio-room:peer-joined",
  "audio-room:peer-left",
  "audio-room:room-state",
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
  // Domain feed events emitted by server/emergent/realtime-feeds.js for
  // the previously-dead-listener lenses. All carry the same RSS-articles
  // shape: { ok, articles:[{ source, title, link, pubDate, summary }], fetchedAt }
  "agriculture:update",
  "aviation:update",
  "education:update",
  "fitness:update",
  "government:update",
  "insurance:update",
  "legal:update",
  "logistics:update",
  "manufacturing:update",
  "realestate:update",
  "retail:update",
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
