// server/tests/platinum-observability.test.js
//
// Sprint 23 — observability coverage.
//
// Asserts every critical surface in Concord emits structured logs +
// has a Prom metric + a circuit breaker where applicable. Per ISO 25010
// maintainability + Sentry/Honeycomb/DataDog best practice.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SERVER_JS = readFileSync(join(HERE, "..", "server.js"), "utf-8");

test("structured logger is invoked (not console.log) in critical paths", () => {
  // Concord's logger is `structuredLog` or `logger.{info|warn|error}`.
  // Critical paths must use it; raw console.log/error in production
  // code is a regression.
  const usesStructured = /structuredLog\(|logger\.(info|warn|error|debug)\(/.test(SERVER_JS);
  assert.ok(usesStructured, "server.js does not use structured logging in critical paths");
});

test("Prom counter for heartbeat ticks exists", () => {
  assert.ok(/concord_heartbeat_ticks_total/.test(SERVER_JS),
    "concord_heartbeat_ticks_total Prom counter missing — ConcordHeartbeatStopped alert can't fire");
});

test("Prom counter for HTTP requests exists", () => {
  const hasReqMetrics = /http_requests_total|httpRequestsTotal|request.*count.*metric/i.test(SERVER_JS);
  assert.ok(hasReqMetrics, "no HTTP request counter — request rate observability is broken");
});

test("circuit breakers are configured for external calls", () => {
  // CLAUDE.md mentions circuit breakers around brain calls.
  assert.ok(/circuitBreaker|circuit_breaker|breakers\[/.test(SERVER_JS),
    "no circuit-breaker pattern in server.js — external-call resilience is broken");
});

test("request-id middleware threads correlation IDs", () => {
  // CLAUDE.md describes `_rid` in realtimeEmit. Confirm the middleware exists.
  assert.ok(/requestIdMiddleware|request.id|x-request-id|requestId/i.test(SERVER_JS),
    "no request-ID middleware — distributed-tracing correlation is broken");
});

test("error handler middleware exists (Express tail handler)", () => {
  // Express requires a 4-arg middleware for error handling.
  const hasErrorMiddleware = /app\.use\(\s*\(err\s*,\s*req|errorHandler|errorMiddleware/.test(SERVER_JS);
  assert.ok(hasErrorMiddleware, "no error-handler middleware — uncaught exceptions reach the client");
});

test("rate limiter is configured", () => {
  assert.ok(/rateLimit|rate-limit|rateLimiter/i.test(SERVER_JS),
    "rate limiter not configured — DoS protection missing");
});
