#!/usr/bin/env node
/**
 * Concord Synthetic Monitoring — Critical Path Checker
 *
 * Checks that key endpoints are reachable and return expected responses.
 * Designed to run every minute via cron or a process scheduler.
 *
 * Usage:
 *   node monitoring/synthetic/critical-paths.js
 *   BASE_URL=https://concord-os.org node monitoring/synthetic/critical-paths.js
 *
 * Output:
 *   PASS / FAIL lines to stdout (Prometheus push gateway compatible via run.sh)
 *   Exit code 0 if all checks pass, 1 if any fail.
 */

const BASE_URL = process.env.BASE_URL || process.env.API_BASE || "http://localhost:5050";
const TIMEOUT_MS = parseInt(process.env.CHECK_TIMEOUT_MS || "5000", 10);
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK_URL || null;

const CHECKS = [
  {
    name: "homepage-loads",
    url: `${BASE_URL}/`,
    expectedStatus: 200,
    expectedField: "ok",
  },
  {
    name: "health-endpoint",
    url: `${BASE_URL}/health`,
    expectedStatus: 200,
    validate: (body) => body.status === "healthy" || body.status === "degraded",
  },
  {
    name: "ready-endpoint",
    url: `${BASE_URL}/ready`,
    expectedStatus: [200, 503],
    validate: (body) => typeof body.ready === "boolean",
  },
  {
    name: "health-db",
    url: `${BASE_URL}/api/health/db`,
    expectedStatus: [200, 503],
    validate: (body) => body.status && body.checks,
  },
  {
    name: "health-ws",
    url: `${BASE_URL}/api/health/ws`,
    expectedStatus: [200, 503],
    validate: (body) => body.status !== undefined,
  },
  {
    name: "auth-endpoint-responds",
    url: `${BASE_URL}/api/auth/csrf-token`,
    expectedStatus: [200, 204, 403, 404],
  },
  {
    name: "brain-status",
    url: `${BASE_URL}/api/brain/status`,
    expectedStatus: 200,
  },
  {
    name: "metrics-endpoint",
    url: `${BASE_URL}/metrics`,
    expectedStatus: 200,
    validate: (_, text) => text.includes("concord_"),
  },
  {
    name: "api-status",
    url: `${BASE_URL}/api/status`,
    expectedStatus: 200,
    validate: (body) => body.ok === true,
  },
  // ── Phase F2 probes ─────────────────────────────────────────────────────
  // These hit the heartbeat-driven systems. If world/clock returns and the
  // phase advances between successive probe runs, the heartbeat is alive.
  {
    name: "world-clock",
    url: `${BASE_URL}/api/world/clock`,
    expectedStatus: 200,
    validate: (body) => body.ok === true && typeof body.phase === "number" && typeof body.segment === "string",
  },
  {
    name: "world-weather-concordia",
    url: `${BASE_URL}/api/world/weather/concordia`,
    expectedStatus: 200,
    validate: (body) => body.ok === true && body.weather && typeof body.weather.type === "string",
  },
  {
    name: "creature-topologies",
    url: `${BASE_URL}/api/creature/topologies`,
    expectedStatus: 200,
    validate: (body) => Array.isArray(body.topologies) && body.topologies.length >= 7,
  },
  {
    name: "creature-baselines-fantasy",
    url: `${BASE_URL}/api/creature/baselines/fantasy`,
    expectedStatus: 200,
    validate: (body) => Array.isArray(body.baselines) && body.baselines.length >= 5,
  },
  {
    name: "emergent-skills-list",
    url: `${BASE_URL}/api/emergent-skills/list`,
    expectedStatus: 200,
    validate: (body) => body.ok === true && Array.isArray(body.skills),
  },
  {
    name: "concord-link-anchors-concordia",
    url: `${BASE_URL}/api/concord-link/anchors/concordia`,
    expectedStatus: 200,
    validate: (body) => body.ok === true && Array.isArray(body.anchors),
  },
  {
    name: "black-market-browse",
    url: `${BASE_URL}/api/black-market`,
    expectedStatus: 200,
    validate: (body) => body.ok === true && Array.isArray(body.listings),
  },
];

async function runCheck(check) {
  const start = Date.now();
  try {
    const res = await fetch(check.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Accept": "application/json, text/plain", "X-Synthetic-Monitor": "1" },
    });
    const durationMs = Date.now() - start;

    const text = await res.text().catch(() => "");
    let body = {};
    try { body = JSON.parse(text); } catch { /* not JSON */ }

    const allowedStatuses = Array.isArray(check.expectedStatus)
      ? check.expectedStatus
      : [check.expectedStatus];

    const statusOk = allowedStatuses.includes(res.status);
    const fieldOk = check.expectedField ? body[check.expectedField] !== undefined : true;
    const validateOk = check.validate ? check.validate(body, text) : true;

    const passed = statusOk && fieldOk && validateOk;

    return {
      name: check.name,
      passed,
      status: res.status,
      durationMs,
      error: passed ? null : `status=${res.status} fieldOk=${fieldOk} validateOk=${validateOk}`,
    };
  } catch (err) {
    return {
      name: check.name,
      passed: false,
      status: 0,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

async function sendAlert(failures) {
  if (!ALERT_WEBHOOK || failures.length === 0) return;
  try {
    const payload = {
      text: `🚨 Concord synthetic monitor: ${failures.length} check(s) failing\n` +
        failures.map(f => `• ${f.name}: ${f.error} (${f.durationMs}ms)`).join("\n"),
    };
    await fetch(ALERT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* alert sending failure is non-fatal */ }
}

async function main() {
  const timestamp = new Date().toISOString();
  const results = await Promise.all(CHECKS.map(runCheck));

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  // Prometheus push-gateway compatible output (parsed by run.sh)
  for (const r of results) {
    const state = r.passed ? "PASS" : "FAIL";
    process.stdout.write(
      `${state} ${r.name} status=${r.status} duration=${r.durationMs}ms${r.error ? ` error="${r.error}"` : ""}\n`
    );
  }

  process.stdout.write(
    `\nSUMMARY ${timestamp}: ${passed.length}/${results.length} passed, ${failed.length} failed\n`
  );

  if (failed.length > 0) {
    await sendAlert(failed);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  process.stderr.write(`Synthetic monitor error: ${err.message}\n`);
  process.exit(1);
});
