/**
 * Concord Cognitive Engine — External Developer SDK
 *
 * Public interface for third-party developers to extend the civilization
 * through plugins, webhooks, and documented APIs without touching core
 * systems.
 *
 * Design principles:
 *   1. Read-only by default — no plugin can mutate internal state directly.
 *   2. DTU submissions always route through the council gate.
 *   3. Plugins cannot modify entities, organs, or governance.
 *   4. All access gated by API key + per-plugin rate limits.
 *   5. Sandboxes auto-expire; no long-lived test state.
 *
 * All state in module-level Maps. Silent failure (try/catch everywhere).
 * No new dependencies. Export named functions.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "sdk") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function getSTATE() {
  return globalThis._concordSTATE || globalThis.STATE || {};
}

function hashApiKey(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function hmacSign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// ── Permission Types ────────────────────────────────────────────────────────

export const PERMISSIONS = Object.freeze({
  READ_DTUS:          "read_dtus",
  READ_ENTITIES:      "read_entities",
  READ_EVENTS:        "read_events",
  SUBMIT_DTUS:        "submit_dtus",
  TRIGGER_RESEARCH:   "trigger_research",
  SUBSCRIBE_EVENTS:   "subscribe_events",
  READ_METRICS:       "read_metrics",
  READ_ECONOMY:       "read_economy",
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

// ── Webhook Event Types ─────────────────────────────────────────────────────

const WEBHOOK_EVENT_TYPES = Object.freeze([
  "dtu.created",
  "dtu.promoted",
  "dtu.archived",
  "entity.born",
  "entity.died",
  "entity.emerged",
  "hypothesis.confirmed",
  "hypothesis.rejected",
  "research.completed",
  "era.transition",
  "dispute.filed",
  "dispute.resolved",
]);

// ── In-Memory State ─────────────────────────────────────────────────────────

const _plugins      = new LruMap();   // pluginId → plugin record
const _apiKeyIndex  = new Map();   // hashedKey → pluginId (reverse lookup)
const _webhooks     = new Map();   // webhookId → webhook record
const _sandboxes    = new Map();   // sandboxId → sandbox record
const _rateBuckets  = new Map();   // pluginId → { tokens, lastRefill, burst }
const _webhookQueue = [];          // pending webhook deliveries
const _usageLog     = new LruMap();   // pluginId → [{ hour, count }]

// ── Plugin System ───────────────────────────────────────────────────────────

/**
 * Register a new plugin. Returns pluginId and raw API key (shown once).
 *
 * @param {string} name        — Human-readable plugin name
 * @param {string} author      — Author identifier
 * @param {string} description — Short description
 * @param {string[]} permissions — Requested permissions from PERMISSIONS
 * @returns {{ ok: boolean, pluginId?: string, apiKey?: string, error?: string }}
 */
export function registerPlugin(name, author, description, permissions = []) {
  try {
    if (!name || typeof name !== "string") {
      return { ok: false, error: "Plugin name is required" };
    }
    if (!Array.isArray(permissions)) {
      return { ok: false, error: "Permissions must be an array" };
    }

    // Validate requested permissions
    const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
    if (invalid.length > 0) {
      return { ok: false, error: `Invalid permissions: ${invalid.join(", ")}` };
    }

    const pluginId = uid("plg");
    const rawKey = crypto.randomBytes(32).toString("hex");
    const hashed = hashApiKey(rawKey);
    const now = nowISO();

    const plugin = {
      pluginId,
      name,
      version: "1.0.0",
      author: author || "",
      description: description || "",
      status: "registered",
      permissions,
      hooks: [],
      endpoints: [],
      rateLimits: { requestsPerMinute: 60, burstSize: 10 },
      apiKeyHash: hashed,
      registeredAt: now,
      lastActiveAt: null,
      requestCount: 0,
      errorCount: 0,
      metadata: {},
    };

    _plugins.set(pluginId, plugin);
    _apiKeyIndex.set(hashed, pluginId);

    return { ok: true, pluginId, apiKey: rawKey };
  } catch (err) {
    return { ok: false, error: "Registration failed" };
  }
}

/**
 * Get plugin info (excludes internal key hash).
 */
export function getPlugin(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    const { apiKeyHash, ...safe } = plugin;
    return { ok: true, plugin: safe };
  } catch {
    return { ok: false, error: "Failed to retrieve plugin" };
  }
}

/**
 * List plugins, optionally filtered by status.
 */
export function listPlugins(status) {
  try {
    let results = Array.from(_plugins.values());
    if (status) {
      results = results.filter(p => p.status === status);
    }
    return {
      ok: true,
      plugins: results.map(({ apiKeyHash, ...safe }) => safe),
      total: results.length,
    };
  } catch {
    return { ok: false, error: "Failed to list plugins" };
  }
}

/**
 * Activate a registered plugin. Only "registered" or "suspended" plugins
 * can be activated.
 */
export function activatePlugin(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "revoked") {
      return { ok: false, error: "Revoked plugins cannot be reactivated" };
    }
    if (plugin.status === "active") {
      return { ok: true, pluginId, status: "active", note: "Already active" };
    }
    plugin.status = "active";
    plugin.lastActiveAt = nowISO();
    return { ok: true, pluginId, status: "active" };
  } catch {
    return { ok: false, error: "Activation failed" };
  }
}

/**
 * Temporarily suspend a plugin. Can be reactivated later.
 */
export function suspendPlugin(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "revoked") {
      return { ok: false, error: "Plugin is already revoked" };
    }
    plugin.status = "suspended";

    // Pause all associated webhooks
    for (const wh of _webhooks.values()) {
      if (wh.pluginId === pluginId && wh.status === "active") {
        wh.status = "paused";
      }
    }

    return { ok: true, pluginId, status: "suspended" };
  } catch {
    return { ok: false, error: "Suspension failed" };
  }
}

/**
 * Permanently revoke a plugin. Disables all access and webhooks.
 */
export function revokePlugin(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };

    plugin.status = "revoked";

    // Remove API key from index
    _apiKeyIndex.delete(plugin.apiKeyHash);
    plugin.apiKeyHash = "";

    // Disable all webhooks
    for (const wh of _webhooks.values()) {
      if (wh.pluginId === pluginId) {
        wh.status = "failed";
      }
    }

    // Destroy all sandboxes
    for (const [sbId, sb] of _sandboxes) {
      if (sb.pluginId === pluginId) {
        _sandboxes.delete(sbId);
      }
    }

    return { ok: true, pluginId, status: "revoked" };
  } catch {
    return { ok: false, error: "Revocation failed" };
  }
}

// ── API Key Management ──────────────────────────────────────────────────────

/**
 * Validate an API key. Returns the pluginId if valid, null otherwise.
 * Also increments request count and updates last-active timestamp.
 */
export function validateApiKey(apiKey) {
  try {
    if (!apiKey || typeof apiKey !== "string") {
      return { ok: false, error: "API key is required" };
    }

    const hashed = hashApiKey(apiKey);
    const pluginId = _apiKeyIndex.get(hashed);
    if (!pluginId) {
      return { ok: false, error: "Invalid API key" };
    }

    const plugin = _plugins.get(pluginId);
    if (!plugin) {
      return { ok: false, error: "Plugin not found for key" };
    }

    if (plugin.status !== "active") {
      return { ok: false, error: `Plugin is ${plugin.status}`, pluginId };
    }

    // Update activity
    plugin.lastActiveAt = nowISO();
    plugin.requestCount++;

    return { ok: true, pluginId, permissions: plugin.permissions };
  } catch {
    return { ok: false, error: "Key validation failed" };
  }
}

/**
 * Rotate the API key for a plugin. Returns the new raw key (shown once).
 * The old key is immediately invalidated.
 */
export function rotateApiKey(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "revoked") {
      return { ok: false, error: "Cannot rotate key for revoked plugin" };
    }

    // Remove old key from index
    _apiKeyIndex.delete(plugin.apiKeyHash);

    // Generate new key
    const rawKey = crypto.randomBytes(32).toString("hex");
    const hashed = hashApiKey(rawKey);

    plugin.apiKeyHash = hashed;
    _apiKeyIndex.set(hashed, pluginId);

    return { ok: true, pluginId, apiKey: rawKey };
  } catch {
    return { ok: false, error: "Key rotation failed" };
  }
}

// ── Webhook System ──────────────────────────────────────────────────────────

/**
 * Register a webhook for a plugin.
 *
 * @param {string} pluginId — Owning plugin
 * @param {string} url      — Callback URL (must be HTTPS in production)
 * @param {string[]} events — Event types to subscribe to
 * @returns {{ ok: boolean, webhookId?: string, secret?: string, error?: string }}
 */
export function registerWebhook(pluginId, url, events) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status !== "active") {
      return { ok: false, error: "Plugin must be active to register webhooks" };
    }
    if (!plugin.permissions.includes(PERMISSIONS.SUBSCRIBE_EVENTS)) {
      return { ok: false, error: "Plugin lacks subscribe_events permission" };
    }

    // Validate URL
    if (!url || typeof url !== "string") {
      return { ok: false, error: "Webhook URL is required" };
    }
    try { new URL(url); } catch {
      return { ok: false, error: "Invalid webhook URL" };
    }

    // Validate events
    if (!Array.isArray(events) || events.length === 0) {
      return { ok: false, error: "At least one event type is required" };
    }
    const invalid = events.filter(e => !WEBHOOK_EVENT_TYPES.includes(e));
    if (invalid.length > 0) {
      return { ok: false, error: `Invalid event types: ${invalid.join(", ")}` };
    }

    const webhookId = uid("whk");
    const secret = crypto.randomBytes(32).toString("hex");
    const now = nowISO();

    const webhook = {
      webhookId,
      pluginId,
      url,
      events,
      secret,
      status: "active",
      failureCount: 0,
      maxRetries: 3,
      lastDelivered: null,
      lastError: null,
      createdAt: now,
    };

    _webhooks.set(webhookId, webhook);

    return { ok: true, webhookId, secret };
  } catch {
    return { ok: false, error: "Webhook registration failed" };
  }
}

/**
 * Remove a webhook by ID.
 */
export function removeWebhook(webhookId) {
  try {
    if (!_webhooks.has(webhookId)) {
      return { ok: false, error: "Webhook not found" };
    }
    _webhooks.delete(webhookId);
    return { ok: true, webhookId, removed: true };
  } catch {
    return { ok: false, error: "Webhook removal failed" };
  }
}

/**
 * List all webhooks for a given plugin.
 */
export function listWebhooks(pluginId) {
  try {
    const results = [];
    for (const wh of _webhooks.values()) {
      if (wh.pluginId === pluginId) {
        // Redact secret in listing
        results.push({ ...wh, secret: "***" });
      }
    }
    return { ok: true, webhooks: results, total: results.length };
  } catch {
    return { ok: false, error: "Failed to list webhooks" };
  }
}

// ── Webhook Delivery ────────────────────────────────────────────────────────

/**
 * Queue an event for delivery to all matching webhooks.
 * Does not block — pushes to an internal queue for async processing.
 *
 * @param {string} event — Event type (e.g. "dtu.created")
 * @param {Object} data  — Event payload
 */
export function queueWebhookDelivery(event, data) {
  try {
    if (!event || typeof event !== "string") {
      return { ok: false, error: "Event type is required" };
    }
    if (!WEBHOOK_EVENT_TYPES.includes(event)) {
      return { ok: false, error: `Unknown event type: ${event}` };
    }

    const timestamp = nowISO();
    let queued = 0;

    for (const wh of _webhooks.values()) {
      if (wh.status !== "active") continue;
      if (!wh.events.includes(event)) continue;

      // Verify owning plugin is still active
      const plugin = _plugins.get(wh.pluginId);
      if (!plugin || plugin.status !== "active") continue;

      const deliveryId = uid("dlv");
      const body = JSON.stringify({ event, timestamp, data });
      const signature = hmacSign(body, wh.secret);

      _webhookQueue.push({
        deliveryId,
        webhookId: wh.webhookId,
        pluginId: wh.pluginId,
        url: wh.url,
        event,
        body,
        signature,
        attempts: 0,
        maxRetries: wh.maxRetries,
        nextAttemptAt: Date.now(),
        createdAt: timestamp,
      });

      queued++;
    }

    return { ok: true, event, queued };
  } catch {
    return { ok: false, error: "Failed to queue webhook delivery" };
  }
}

/**
 * Process pending webhook deliveries.
 *
 * In production this would issue real HTTP requests. Here we simulate
 * delivery and manage retry / failure logic:
 *   - HMAC-SHA256 signature in X-Concordos-Signature header
 *   - 3 retries with exponential backoff (2s, 4s, 8s)
 *   - After 10 consecutive failures, auto-pause the webhook
 *
 * Processes up to 20 deliveries per call.
 */
export function processWebhookQueue() {
  try {
    const now = Date.now();
    const results = [];
    const batch = [];

    // Collect deliveries that are ready
    let i = 0;
    while (i < _webhookQueue.length && batch.length < 20) {
      const delivery = _webhookQueue[i];
      if (delivery.nextAttemptAt <= now) {
        _webhookQueue.splice(i, 1);
        batch.push(delivery);
      } else {
        i++;
      }
    }

    for (const delivery of batch) {
      delivery.attempts++;
      const wh = _webhooks.get(delivery.webhookId);

      // Simulate delivery: valid URL starting with http = success
      const success = simulateHTTPPost(delivery.url, delivery.body, delivery.signature);

      if (success) {
        if (wh) {
          wh.failureCount = 0;
          wh.lastDelivered = nowISO();
        }
        results.push({ deliveryId: delivery.deliveryId, status: "delivered" });
      } else {
        // Retry with exponential backoff: 2s, 4s, 8s
        if (delivery.attempts < delivery.maxRetries) {
          const backoffMs = Math.pow(2, delivery.attempts) * 1000;
          delivery.nextAttemptAt = now + backoffMs;
          _webhookQueue.push(delivery);
          results.push({ deliveryId: delivery.deliveryId, status: "retrying", attempt: delivery.attempts });
        } else {
          // Final failure
          if (wh) {
            wh.failureCount++;
            wh.lastError = `Delivery failed after ${delivery.attempts} attempts`;

            // Auto-pause after 10 consecutive failures
            if (wh.failureCount >= 10) {
              wh.status = "paused";
            }
          }
          results.push({ deliveryId: delivery.deliveryId, status: "failed" });
        }
      }
    }

    return { ok: true, processed: results.length, pending: _webhookQueue.length, results };
  } catch {
    return { ok: false, error: "Queue processing failed" };
  }
}

/**
 * Simulate an HTTP POST delivery. In production, this would use fetch().
 * Returns true if the URL looks valid (starts with http).
 */
function simulateHTTPPost(url, body, signature) {
  // In production:
  //   fetch(url, {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       "X-Concordos-Signature": signature,
  //     },
  //     body,
  //   })
  try {
    return typeof url === "string" && url.startsWith("http");
  } catch {
    return false;
  }
}

// ── Schema Introspection ────────────────────────────────────────────────────

/**
 * Return the full API schema for SDK consumers. Provides a self-describing
 * map of all accessible resources, types, and capabilities.
 */
export function getSchema() {
  try {
    const STATE = getSTATE();

    return {
      ok: true,
      schema: {
        version: "1.0.0",
        engine: "Concord Cognitive Engine",
        generatedAt: nowISO(),

        // DTU fields and types
        dtu: {
          description: "Discrete Truth Unit — atomic knowledge record",
          fields: {
            id:          { type: "string",  description: "Unique DTU identifier" },
            title:       { type: "string",  description: "Short descriptive title" },
            body:        { type: "string",  description: "Full content/claim text" },
            tags:        { type: "array",   description: "Classification tags", items: "string" },
            tier:        { type: "string",  description: "Promotion tier", enum: ["regular", "mega", "hyper"] },
            confidence:  { type: "number",  description: "Confidence score 0-1" },
            citations:   { type: "array",   description: "Source citations", items: "object" },
            createdAt:   { type: "string",  description: "ISO-8601 creation timestamp" },
            promotedAt:  { type: "string",  description: "ISO-8601 promotion timestamp (null if unpromoted)" },
            archivedAt:  { type: "string",  description: "ISO-8601 archive timestamp (null if active)" },
            provenance:  { type: "object",  description: "Origin metadata (session, emergent, votes)" },
          },
        },

        // Entity roles and capabilities
        entities: {
          description: "Emergent agents that have crossed entity threshold",
          roles: [
            "builder", "critic", "historian", "economist",
            "ethicist", "engineer", "synthesizer", "auditor", "adversary",
          ],
          capabilities: [
            "talk", "critique", "propose", "summarize", "test", "warn", "ask",
          ],
          archetypes: [
            "Ancient Observer", "Apex", "ConClaude", "Cipher",
            "Proto Species", "Concord",
          ],
        },

        // Event types available for webhook subscription
        events: {
          description: "Subscribable webhook event types",
          types: [...WEBHOOK_EVENT_TYPES],
        },

        // Governance / decree commands
        decrees: {
          description: "Sovereign decree commands available through governance",
          commands: [
            "promote_dtu", "archive_dtu", "create_entity",
            "suspend_entity", "grant_permission", "revoke_permission",
            "set_policy", "trigger_era_transition", "initiate_research",
            "file_dispute", "resolve_dispute",
          ],
        },

        // Economy / resource types
        economy: {
          description: "Economic resource types in the civilization",
          resources: [
            { name: "resonance",  description: "Measure of community agreement" },
            { name: "coherence",  description: "Internal logical consistency" },
            { name: "reputation", description: "Earned trust from contributions" },
            { name: "energy",     description: "Computational budget allocation" },
            { name: "influence",  description: "Governance weight from participation" },
          ],
        },

        // Dispute types
        disputes: {
          description: "Types of disputes that can be filed",
          types: [
            "factual_accuracy", "citation_validity", "scope_violation",
            "ethical_concern", "duplicate_claim", "attribution_dispute",
          ],
        },

        // Hypothesis lifecycle
        hypotheses: {
          description: "Hypothesis DTU lifecycle states",
          statuses: [
            "proposed", "testing", "confirmed", "rejected", "refined", "archived",
          ],
        },

        // Permission model
        permissions: {
          description: "Available SDK permissions",
          types: { ...PERMISSIONS },
          note: "No permission grants direct write access to internal state",
        },

        // Current civilization stats (if state available)
        civilization: buildCivilizationStats(STATE),
      },
    };
  } catch {
    return { ok: false, error: "Schema generation failed" };
  }
}

/**
 * Build a summary of current civilization stats from STATE.
 * Returns empty object if STATE is unavailable.
 */
function buildCivilizationStats(STATE) {
  try {
    const stats = {};

    // DTU count
    if (STATE.dtus && typeof STATE.dtus.size === "number") {
      stats.dtuCount = STATE.dtus.size;
    } else if (Array.isArray(STATE.dtus)) {
      stats.dtuCount = STATE.dtus.length;
    }

    // Entity count
    if (STATE.__emergent && STATE.__emergent.emergents) {
      stats.emergentCount = STATE.__emergent.emergents.size;
    }

    // Era info
    if (STATE.era) {
      stats.currentEra = STATE.era;
    }

    // Timestamp
    stats.snapshotAt = nowISO();

    return stats;
  } catch {
    return {};
  }
}

// ── Sandbox Environment ─────────────────────────────────────────────────────

const MAX_SANDBOXES_PER_PLUGIN = 3;
const SANDBOX_DEFAULT_TTL = 3600000;  // 1 hour

/**
 * Create a sandbox environment for a plugin.
 *
 * @param {string} pluginId — Owning plugin
 * @param {string} type     — "readonly" or "testing"
 * @returns {{ ok: boolean, sandboxId?: string, expiresAt?: string, error?: string }}
 */
export function createSandbox(pluginId, type = "readonly") {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status !== "active") {
      return { ok: false, error: "Plugin must be active to create sandboxes" };
    }

    // Validate type
    if (type !== "readonly" && type !== "testing") {
      return { ok: false, error: "Sandbox type must be 'readonly' or 'testing'" };
    }

    // Enforce max concurrent sandboxes per plugin
    let pluginSandboxCount = 0;
    for (const sb of _sandboxes.values()) {
      if (sb.pluginId === pluginId) pluginSandboxCount++;
    }
    if (pluginSandboxCount >= MAX_SANDBOXES_PER_PLUGIN) {
      return { ok: false, error: `Max ${MAX_SANDBOXES_PER_PLUGIN} concurrent sandboxes per plugin` };
    }

    // Build sandbox state — copy of current DTU list (read-only snapshot)
    const STATE = getSTATE();
    const sandboxState = {};

    try {
      if (STATE.dtus) {
        const dtuSnapshot = [];
        const source = STATE.dtus instanceof Map ? STATE.dtus.values() : (Array.isArray(STATE.dtus) ? STATE.dtus : []);
        for (const dtu of source) {
          dtuSnapshot.push({
            id: dtu.id,
            title: dtu.title,
            tags: dtu.tags ? [...dtu.tags] : [],
            tier: dtu.tier || "regular",
            confidence: dtu.confidence || 0,
            createdAt: dtu.createdAt || null,
          });
        }
        sandboxState.dtus = dtuSnapshot;
      } else {
        sandboxState.dtus = [];
      }
    } catch {
      sandboxState.dtus = [];
    }

    const sandboxId = uid("sbx");
    const now = nowISO();
    const createdMs = Date.now();

    const sandbox = {
      sandboxId,
      pluginId,
      type,
      state: sandboxState,
      ttl: SANDBOX_DEFAULT_TTL,
      createdAt: now,
      expiresAt: new Date(createdMs + SANDBOX_DEFAULT_TTL).toISOString(),
      requestLog: [],
    };

    _sandboxes.set(sandboxId, sandbox);

    return { ok: true, sandboxId, type, expiresAt: sandbox.expiresAt };
  } catch {
    return { ok: false, error: "Sandbox creation failed" };
  }
}

/**
 * Destroy a sandbox and discard its state.
 */
export function destroySandbox(sandboxId) {
  try {
    if (!_sandboxes.has(sandboxId)) {
      return { ok: false, error: "Sandbox not found" };
    }
    _sandboxes.delete(sandboxId);
    return { ok: true, sandboxId, destroyed: true };
  } catch {
    return { ok: false, error: "Sandbox destruction failed" };
  }
}

/**
 * Clean up expired sandboxes. Called internally.
 */
function pruneExpiredSandboxes() {
  try {
    const now = Date.now();
    for (const [sbId, sb] of _sandboxes) {
      const expiresMs = new Date(sb.expiresAt).getTime();
      if (now >= expiresMs) {
        _sandboxes.delete(sbId);
      }
    }
  } catch {
    // silent
  }
}

// Prune expired sandboxes every 60 seconds
// @resource-leak-ok: process-lifetime — sandbox eviction loop
setInterval(pruneExpiredSandboxes, 60000).unref();

// ── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Check whether a plugin has exceeded its rate limit using a token bucket
 * algorithm.
 *
 * Default: 60 requests/minute, burst of 10.
 * Premium (sovereign-approved): 300 requests/minute.
 *
 * @param {string} pluginId
 * @returns {{ ok: boolean, allowed: boolean, remaining?: number, retryAfter?: number }}
 */
export function checkRateLimit(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status !== "active") {
      return { ok: false, error: `Plugin is ${plugin.status}` };
    }

    const limits = plugin.rateLimits || { requestsPerMinute: 60, burstSize: 10 };
    const now = Date.now();

    let bucket = _rateBuckets.get(pluginId);
    if (!bucket) {
      bucket = {
        tokens: limits.burstSize,
        lastRefill: now,
        requestsPerMinute: limits.requestsPerMinute,
        burstSize: limits.burstSize,
      };
      _rateBuckets.set(pluginId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefill;
    const refillRate = bucket.requestsPerMinute / 60000; // tokens per ms
    const newTokens = elapsedMs * refillRate;
    bucket.tokens = Math.min(bucket.burstSize, bucket.tokens + newTokens);
    bucket.lastRefill = now;

    // Try to consume one token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;

      // Track usage
      trackUsage(pluginId);

      return {
        ok: true,
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: bucket.requestsPerMinute,
      };
    }

    // Rate limited — calculate retry-after
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(tokensNeeded / refillRate);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    return {
      ok: true,
      allowed: false,
      remaining: 0,
      retryAfter: retryAfterSec,
      limit: bucket.requestsPerMinute,
    };
  } catch {
    return { ok: false, error: "Rate limit check failed" };
  }
}

/**
 * Track per-plugin usage by hour.
 */
function trackUsage(pluginId) {
  try {
    const hourKey = new Date().toISOString().slice(0, 13); // "2024-01-15T09"
    let log = _usageLog.get(pluginId);
    if (!log) {
      log = [];
      _usageLog.set(pluginId, log);
    }

    const lastEntry = log.length > 0 ? log[log.length - 1] : null;
    if (lastEntry && lastEntry.hour === hourKey) {
      lastEntry.count++;
    } else {
      log.push({ hour: hourKey, count: 1 });
    }

    // Keep only last 168 hours (7 days)
    if (log.length > 168) {
      log.splice(0, log.length - 168);
    }
  } catch {
    // silent
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get per-plugin metrics including request counts, errors, webhooks,
 * sandboxes, and rate limit status.
 */
export function getPluginMetrics(pluginId) {
  try {
    const plugin = _plugins.get(pluginId);
    if (!plugin) return { ok: false, error: "Plugin not found" };

    // Count webhooks
    let webhookCount = 0;
    let activeWebhooks = 0;
    for (const wh of _webhooks.values()) {
      if (wh.pluginId === pluginId) {
        webhookCount++;
        if (wh.status === "active") activeWebhooks++;
      }
    }

    // Count sandboxes
    let sandboxCount = 0;
    for (const sb of _sandboxes.values()) {
      if (sb.pluginId === pluginId) sandboxCount++;
    }

    // Usage history
    const usage = _usageLog.get(pluginId) || [];
    const totalRequests = usage.reduce((sum, entry) => sum + entry.count, 0);
    const last24h = usage.slice(-24);
    const requestsLast24h = last24h.reduce((sum, entry) => sum + entry.count, 0);

    // Rate limit info
    const bucket = _rateBuckets.get(pluginId);

    return {
      ok: true,
      pluginId,
      status: plugin.status,
      requestCount: plugin.requestCount,
      errorCount: plugin.errorCount,
      registeredAt: plugin.registeredAt,
      lastActiveAt: plugin.lastActiveAt,
      webhooks: {
        total: webhookCount,
        active: activeWebhooks,
      },
      sandboxes: {
        active: sandboxCount,
        maxAllowed: MAX_SANDBOXES_PER_PLUGIN,
      },
      usage: {
        totalTracked: totalRequests,
        last24h: requestsLast24h,
        hourlyBreakdown: last24h,
      },
      rateLimit: {
        requestsPerMinute: plugin.rateLimits.requestsPerMinute,
        burstSize: plugin.rateLimits.burstSize,
        currentTokens: bucket ? Math.floor(bucket.tokens) : plugin.rateLimits.burstSize,
      },
    };
  } catch {
    return { ok: false, error: "Failed to retrieve plugin metrics" };
  }
}

/**
 * Get global SDK metrics — aggregate stats across all plugins.
 */
export function getSDKMetrics() {
  try {
    const pluginsByStatus = { registered: 0, active: 0, suspended: 0, revoked: 0 };
    let totalRequests = 0;
    let totalErrors = 0;

    for (const plugin of _plugins.values()) {
      pluginsByStatus[plugin.status] = (pluginsByStatus[plugin.status] || 0) + 1;
      totalRequests += plugin.requestCount;
      totalErrors += plugin.errorCount;
    }

    const webhooksByStatus = { active: 0, paused: 0, failed: 0 };
    for (const wh of _webhooks.values()) {
      webhooksByStatus[wh.status] = (webhooksByStatus[wh.status] || 0) + 1;
    }

    // Aggregate usage across all plugins for last 24 hours
    let globalLast24h = 0;
    for (const log of _usageLog.values()) {
      const last24h = log.slice(-24);
      globalLast24h += last24h.reduce((sum, entry) => sum + entry.count, 0);
    }

    return {
      ok: true,
      generatedAt: nowISO(),
      plugins: {
        total: _plugins.size,
        byStatus: pluginsByStatus,
        totalRequests,
        totalErrors,
      },
      webhooks: {
        total: _webhooks.size,
        byStatus: webhooksByStatus,
        pendingDeliveries: _webhookQueue.length,
      },
      sandboxes: {
        active: _sandboxes.size,
      },
      usage: {
        requestsLast24h: globalLast24h,
        activeRateBuckets: _rateBuckets.size,
      },
      permissions: {
        available: [...ALL_PERMISSIONS],
      },
    };
  } catch {
    return { ok: false, error: "Failed to generate SDK metrics" };
  }
}

// ── Rate Bucket Cleanup ─────────────────────────────────────────────────────

// Clean up stale rate buckets every 2 minutes
// @resource-leak-ok: process-lifetime — sandbox eviction loop
setInterval(() => {
  try {
    const now = Date.now();
    for (const [pluginId, bucket] of _rateBuckets) {
      // If no activity for 5 minutes, remove the bucket
      if (now - bucket.lastRefill > 300000) {
        _rateBuckets.delete(pluginId);
      }
    }
  } catch {
    // silent
  }
}, 120000).unref();
