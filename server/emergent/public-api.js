/**
 * Concord — Public API & Webhook System
 *
 * Public API for DTU retrieval/creation, citation queries,
 * marketplace interaction, and a webhook notification system.
 */

import crypto from "crypto";

// ── Webhook State ────────────────────────────────────────────────────────

function getWebhookState(STATE) {
  if (!STATE._webhooks) {
    STATE._webhooks = {
      registrations: new Map(),  // webhookId → webhook config
      deliveryLog: [],           // delivery history
      pendingDeliveries: [],     // queued deliveries

      metrics: {
        totalRegistrations: 0,
        totalDeliveries: 0,
        totalFailures: 0,
        totalRetries: 0,
      },
    };
  }
  return STATE._webhooks;
}

// ── Webhook Events ───────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = Object.freeze({
  DTU_CREATED:       "dtu:created",
  DTU_UPDATED:       "dtu:updated",
  DTU_PROMOTED:      "dtu:promoted",
  DTU_DELETED:       "dtu:deleted",
  ATLAS_DTU_CREATED: "atlas:dtu:created",
  ATLAS_DTU_VERIFIED:"atlas:dtu:verified",
  ATLAS_DTU_DISPUTED:"atlas:dtu:disputed",
  CITATION_ADDED:    "citation:added",
  MARKETPLACE_LISTED:"marketplace:listed",
  MARKETPLACE_SOLD:  "marketplace:sold",
  COMMENT_ADDED:     "comment:added",
  REVISION_PROPOSED: "revision:proposed",
  COUNCIL_ACTION:    "council:action",
});

// ── Webhook Registration ─────────────────────────────────────────────────

/**
 * Register a webhook to receive events.
 */
export function registerWebhook(STATE, input) {
  const webhooks = getWebhookState(STATE);

  if (!input.url) return { ok: false, error: "URL required" };
  if (!input.events || input.events.length === 0) {
    return { ok: false, error: "At least one event type required" };
  }

  // Validate URL
  try { new URL(input.url); } catch {
    return { ok: false, error: "Invalid URL" };
  }

  // Validate events
  const validEvents = new Set(Object.values(WEBHOOK_EVENTS));
  for (const event of input.events) {
    if (!validEvents.has(event)) {
      return { ok: false, error: `Invalid event type: ${event}` };
    }
  }

  const webhook = {
    id: `wh_${crypto.randomBytes(8).toString("hex")}`,
    url: input.url,
    events: input.events,
    secret: input.secret || crypto.randomBytes(32).toString("hex"),
    ownerId: input.ownerId || "system",
    active: true,
    createdAt: new Date().toISOString(),
    lastDeliveryAt: null,
    consecutiveFailures: 0,
    maxRetries: input.maxRetries || 3,
  };

  webhooks.registrations.set(webhook.id, webhook);
  webhooks.metrics.totalRegistrations++;

  return { ok: true, webhook: { ...webhook, secret: webhook.secret } };
}

export function getWebhook(STATE, webhookId) {
  const webhooks = getWebhookState(STATE);
  const wh = webhooks.registrations.get(webhookId);
  if (!wh) return { ok: false, error: "Webhook not found" };
  return { ok: true, webhook: { ...wh, secret: "***" } };
}

export function listWebhooks(STATE, ownerId) {
  const webhooks = getWebhookState(STATE);
  let results = Array.from(webhooks.registrations.values());
  if (ownerId) {
    results = results.filter(w => w.ownerId === ownerId);
  }
  return {
    ok: true,
    webhooks: results.map(w => ({ ...w, secret: "***" })),
    total: results.length,
  };
}

export function deactivateWebhook(STATE, webhookId) {
  const webhooks = getWebhookState(STATE);
  const wh = webhooks.registrations.get(webhookId);
  if (!wh) return { ok: false, error: "Webhook not found" };
  wh.active = false;
  return { ok: true, webhookId, deactivated: true };
}

export function deleteWebhook(STATE, webhookId) {
  const webhooks = getWebhookState(STATE);
  webhooks.registrations.delete(webhookId);
  return { ok: true, webhookId, deleted: true };
}

// ── Webhook Dispatch ─────────────────────────────────────────────────────

/**
 * Dispatch an event to all registered webhooks.
 * Queues the delivery for async processing.
 */
export function dispatchWebhookEvent(STATE, eventType, payload) {
  const webhooks = getWebhookState(STATE);

  const matchingWebhooks = [];
  for (const wh of webhooks.registrations.values()) {
    if (!wh.active) continue;
    if (wh.consecutiveFailures >= 10) continue; // auto-disabled after 10 failures
    if (wh.events.includes(eventType)) {
      matchingWebhooks.push(wh);
    }
  }

  if (matchingWebhooks.length === 0) return { ok: true, dispatched: 0 };

  const deliveryId = `del_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = new Date().toISOString();

  for (const wh of matchingWebhooks) {
    const delivery = {
      id: `${deliveryId}_${wh.id}`,
      webhookId: wh.id,
      url: wh.url,
      event: eventType,
      payload: {
        event: eventType,
        timestamp,
        data: payload,
      },
      signature: computeSignature(JSON.stringify(payload), wh.secret),
      status: "PENDING",
      attempts: 0,
      maxRetries: wh.maxRetries,
      createdAt: timestamp,
      lastAttemptAt: null,
    };

    webhooks.pendingDeliveries.push(delivery);
  }

  return {
    ok: true,
    dispatched: matchingWebhooks.length,
    eventType,
    deliveryId,
  };
}

/**
 * Process pending webhook deliveries.
 * In a real system this would use HTTP fetch with retries.
 * Here we simulate the delivery and record results.
 */
export function processPendingDeliveries(STATE) {
  const webhooks = getWebhookState(STATE);
  const results = [];

  const toProcess = webhooks.pendingDeliveries.splice(0, 10); // batch of 10

  for (const delivery of toProcess) {
    delivery.attempts++;
    delivery.lastAttemptAt = new Date().toISOString();

    // Simulate delivery (in production, would use fetch/axios)
    const success = simulateDelivery(delivery);

    if (success) {
      delivery.status = "DELIVERED";
      webhooks.metrics.totalDeliveries++;

      const wh = webhooks.registrations.get(delivery.webhookId);
      if (wh) {
        wh.lastDeliveryAt = delivery.lastAttemptAt;
        wh.consecutiveFailures = 0;
      }
    } else {
      if (delivery.attempts < delivery.maxRetries) {
        delivery.status = "RETRYING";
        webhooks.pendingDeliveries.push(delivery); // re-queue
        webhooks.metrics.totalRetries++;
      } else {
        delivery.status = "FAILED";
        webhooks.metrics.totalFailures++;

        const wh = webhooks.registrations.get(delivery.webhookId);
        if (wh) wh.consecutiveFailures++;
      }
    }

    // Log delivery
    webhooks.deliveryLog.push({ ...delivery });
    results.push({ id: delivery.id, status: delivery.status });
  }

  // Cap delivery log
  if (webhooks.deliveryLog.length > 1000) {
    webhooks.deliveryLog = webhooks.deliveryLog.slice(-500);
  }

  return { ok: true, processed: results.length, results };
}

function simulateDelivery(delivery) {
  // In production: fetch(delivery.url, { method: 'POST', headers, body })
  // For now, deliveries are always queued successfully
  // The webhook URL must be valid and the endpoint responsive
  return delivery.url && delivery.url.startsWith("http");
}

function computeSignature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// ── Webhook Delivery History ─────────────────────────────────────────────

export function getDeliveryHistory(STATE, webhookId, limit = 50) {
  const webhooks = getWebhookState(STATE);
  let history = webhooks.deliveryLog;
  if (webhookId) {
    history = history.filter(d => d.webhookId === webhookId);
  }
  history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, history: history.slice(0, limit), total: history.length };
}

// ── Public API Rate Limiting ─────────────────────────────────────────────

const apiRateBuckets = new Map(); // apiKeyId → { count, windowStart }

export function checkApiRateLimit(apiKeyId, limit = 100) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  let bucket = apiRateBuckets.get(apiKeyId);

  if (!bucket || now - bucket.windowStart > windowMs) {
    bucket = { count: 0, windowStart: now };
    apiRateBuckets.set(apiKeyId, bucket);
  }

  bucket.count++;

  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.windowStart + windowMs,
    limit,
  };
}

// Cleanup
// @resource-leak-ok: process-lifetime — public-api rate-limit cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of apiRateBuckets) {
    if (now - bucket.windowStart > 120000) apiRateBuckets.delete(key);
  }
}, 60000).unref();

// ── API Metrics ──────────────────────────────────────────────────────────

export function getApiMetrics(STATE) {
  const webhooks = getWebhookState(STATE);
  return {
    ok: true,
    webhooks: {
      ...webhooks.metrics,
      activeWebhooks: Array.from(webhooks.registrations.values()).filter(w => w.active).length,
      pendingDeliveries: webhooks.pendingDeliveries.length,
    },
    rateLimit: {
      activeBuckets: apiRateBuckets.size,
    },
  };
}
