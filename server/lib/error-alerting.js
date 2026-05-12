/**
 * Error Alerting Service for Concord Cognitive Engine
 *
 * Sends real-time alerts when things break in production.
 * Supports Slack, Discord, and generic webhooks.
 *
 * Features:
 * - Crash detection (unhandled exceptions, unhandled rejections)
 * - Error rate spike detection
 * - Deduplication (won't spam you with the same error)
 * - Cooldown period per error type
 * - Health heartbeat (optional "still alive" pings)
 * - Integrates with existing logger
 *
 * Configure via env:
 *   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx
 *   ALERT_WEBHOOK_TYPE=slack|discord|generic
 */

import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

// ── Configuration ────────────────────────────────────────────────────────────

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const WEBHOOK_TYPE = process.env.ALERT_WEBHOOK_TYPE || "slack"; // slack | discord | generic
const APP_NAME = process.env.APP_NAME || "Concord";
const NODE_ENV = process.env.NODE_ENV || "development";

// Cooldown: don't send the same error more than once per 5 minutes
const ERROR_COOLDOWN_MS = 5 * 60 * 1000;
// Rate spike: >10 errors in 60 seconds triggers an alert
const ERROR_SPIKE_THRESHOLD = 10;
const ERROR_SPIKE_WINDOW_MS = 60 * 1000;

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, number>} errorKey → last alert timestamp */
const _alertCooldowns = new LruMap();

/** @type {{ ts: number }[]} Rolling window of recent errors */
const _recentErrors = [];

let _initialized = false;
let _alertsSent = 0;
let _alertsSuppressed = 0;
let _lastHeartbeat = 0;

// ── Core Alert Sender ────────────────────────────────────────────────────────

/**
 * Send an alert via configured webhook.
 *
 * @param {object} opts
 * @param {string} opts.title - Alert title
 * @param {string} opts.message - Alert body
 * @param {"critical"|"error"|"warning"|"info"} [opts.severity="error"]
 * @param {object} [opts.fields] - Additional key-value fields
 */
export async function sendAlert({ title, message, severity = "error", fields = {} }) {
  if (!WEBHOOK_URL) {
    // No webhook configured — log locally only
    logger.warn("error-alerting", `[ALERT] ${severity.toUpperCase()}: ${title} — ${message}`);
    return { ok: false, reason: "no_webhook_configured" };
  }

  try {
    let body;

    if (WEBHOOK_TYPE === "slack") {
      body = _formatSlack(title, message, severity, fields);
    } else if (WEBHOOK_TYPE === "discord") {
      body = _formatDiscord(title, message, severity, fields);
    } else {
      body = _formatGeneric(title, message, severity, fields);
    }

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error("error-alerting", `Webhook failed: ${response.status} ${response.statusText}`);
      return { ok: false, status: response.status };
    }

    _alertsSent++;
    return { ok: true };
  } catch (err) {
    logger.error("error-alerting", `Failed to send alert: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Send an error alert with deduplication and cooldown.
 */
export async function alertError(error, context = {}) {
  const key = `${error.name || "Error"}:${(error.message || "").slice(0, 100)}`;
  const now = Date.now();

  // Check cooldown
  const lastSent = _alertCooldowns.get(key) || 0;
  if (now - lastSent < ERROR_COOLDOWN_MS) {
    _alertsSuppressed++;
    return { ok: true, suppressed: true };
  }

  _alertCooldowns.set(key, now);

  // Track for rate spike detection
  _recentErrors.push({ ts: now });
  _cleanOldErrors(now);

  const fields = {
    "Error": error.name || "Error",
    "Environment": NODE_ENV,
    ...context,
  };

  if (error.stack) {
    // Include first 3 lines of stack
    fields["Stack"] = error.stack.split("\n").slice(0, 3).join("\n");
  }

  return sendAlert({
    title: `${APP_NAME} Error: ${error.message || "Unknown error"}`,
    message: error.message || "An unhandled error occurred",
    severity: "error",
    fields,
  });
}

/**
 * Send critical crash alert (process about to exit).
 */
export async function alertCrash(error, context = {}) {
  return sendAlert({
    title: `CRITICAL: ${APP_NAME} Crash`,
    message: `Process is crashing: ${error.message || "Unknown"}`,
    severity: "critical",
    fields: {
      "Error": error.name || "Error",
      "Message": error.message || "Unknown",
      "Stack": error.stack ? error.stack.split("\n").slice(0, 5).join("\n") : "N/A",
      "Environment": NODE_ENV,
      "Uptime": `${Math.round(process.uptime())}s`,
      "Memory": `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      ...context,
    },
  });
}

// ── Rate Spike Detection ─────────────────────────────────────────────────────

/**
 * Check if error rate is spiking.
 */
function _checkErrorSpike() {
  const now = Date.now();
  _cleanOldErrors(now);

  if (_recentErrors.length >= ERROR_SPIKE_THRESHOLD) {
    const key = "RATE_SPIKE";
    const lastSent = _alertCooldowns.get(key) || 0;
    if (now - lastSent > ERROR_COOLDOWN_MS) {
      _alertCooldowns.set(key, now);
      sendAlert({
        title: `${APP_NAME} Error Rate Spike`,
        message: `${_recentErrors.length} errors in the last ${ERROR_SPIKE_WINDOW_MS / 1000}s`,
        severity: "critical",
        fields: {
          "Error Count": String(_recentErrors.length),
          "Window": `${ERROR_SPIKE_WINDOW_MS / 1000}s`,
          "Threshold": String(ERROR_SPIKE_THRESHOLD),
          "Environment": NODE_ENV,
        },
      });
    }
  }
}

function _cleanOldErrors(now) {
  while (_recentErrors.length > 0 && now - _recentErrors[0].ts > ERROR_SPIKE_WINDOW_MS) {
    _recentErrors.shift();
  }
}

// ── Process-Level Crash Handlers ─────────────────────────────────────────────

/**
 * Initialize global error handlers.
 * Call once at server startup.
 */
export function initErrorAlerting() {
  if (_initialized) return;
  _initialized = true;

  // Uncaught exceptions
  process.on("uncaughtException", async (error) => {
    logger.error("CRASH", `Uncaught exception: ${error.message}`, { stack: error.stack });
    await alertCrash(error, { type: "uncaughtException" });
    // Give the webhook time to send before exiting
    setTimeout(() => process.exit(1), 2000);
  });

  // Unhandled promise rejections
  process.on("unhandledRejection", async (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("CRASH", `Unhandled rejection: ${error.message}`, { stack: error.stack });
    await alertError(error, { type: "unhandledRejection" });
    _checkErrorSpike();
  });

  // PM2 graceful shutdown
  process.on("SIGINT", async () => {
    await sendAlert({
      title: `${APP_NAME} Shutting Down`,
      message: "Process received SIGINT (graceful shutdown)",
      severity: "info",
      fields: { "Uptime": `${Math.round(process.uptime())}s`, "Environment": NODE_ENV },
    });
    process.exit(0);
  });

  // Startup notification
  sendAlert({
    title: `${APP_NAME} Started`,
    message: `Server started in ${NODE_ENV} mode`,
    severity: "info",
    fields: {
      "Node Version": process.version,
      "Environment": NODE_ENV,
      "PID": String(process.pid),
    },
  });

  logger.info("error-alerting", `Error alerting initialized (webhook: ${WEBHOOK_URL ? "configured" : "not configured — console only"})`);
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

/**
 * Send a periodic "still alive" heartbeat.
 * Call this from your health check interval.
 */
export async function sendHeartbeat() {
  const now = Date.now();
  // Only send heartbeat every 6 hours
  if (now - _lastHeartbeat < 6 * 60 * 60 * 1000) return { ok: true, skipped: true };
  _lastHeartbeat = now;

  const mem = process.memoryUsage();
  return sendAlert({
    title: `${APP_NAME} Heartbeat`,
    message: "Server is alive and responsive",
    severity: "info",
    fields: {
      "Uptime": `${Math.round(process.uptime() / 3600)}h`,
      "Memory (Heap)": `${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      "Alerts Sent": String(_alertsSent),
      "Alerts Suppressed": String(_alertsSuppressed),
      "Environment": NODE_ENV,
    },
  });
}

// ── Webhook Formatters ───────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: "#e74c3c",
  error: "#e67e22",
  warning: "#f1c40f",
  info: "#3498db",
};

const SEVERITY_EMOJI = {
  critical: ":rotating_light:",
  error: ":x:",
  warning: ":warning:",
  info: ":information_source:",
};

function _formatSlack(title, message, severity, fields) {
  return {
    text: `${SEVERITY_EMOJI[severity] || ""} ${title}`,
    attachments: [{
      color: SEVERITY_COLORS[severity] || "#999",
      title,
      text: message,
      fields: Object.entries(fields).map(([k, v]) => ({
        title: k,
        value: String(v).slice(0, 500),
        short: String(v).length < 40,
      })),
      footer: `${APP_NAME} | ${new Date().toISOString()}`,
    }],
  };
}

function _formatDiscord(title, message, severity, fields) {
  const colorMap = { critical: 0xe74c3c, error: 0xe67e22, warning: 0xf1c40f, info: 0x3498db };
  return {
    embeds: [{
      title,
      description: message,
      color: colorMap[severity] || 0x999999,
      fields: Object.entries(fields).map(([k, v]) => ({
        name: k,
        value: String(v).slice(0, 1024),
        inline: String(v).length < 40,
      })),
      footer: { text: `${APP_NAME} | ${NODE_ENV}` },
      timestamp: new Date().toISOString(),
    }],
  };
}

function _formatGeneric(title, message, severity, fields) {
  return {
    title,
    message,
    severity,
    fields,
    app: APP_NAME,
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * Get alerting service status.
 */
export function getAlertingStatus() {
  return {
    initialized: _initialized,
    webhookConfigured: !!WEBHOOK_URL,
    webhookType: WEBHOOK_TYPE,
    alertsSent: _alertsSent,
    alertsSuppressed: _alertsSuppressed,
    recentErrorCount: _recentErrors.length,
    cooldownEntries: _alertCooldowns.size,
  };
}

export default {
  sendAlert,
  alertError,
  alertCrash,
  initErrorAlerting,
  sendHeartbeat,
  getAlertingStatus,
};
