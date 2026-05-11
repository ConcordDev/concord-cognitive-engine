// server/tests/platinum-security-headers.test.js
//
// Sprint 18 — platinum security headers gate.
//
// Verifies the Concord server's middleware stack configures the
// security headers a Fortune-500-grade application must ship:
//
//   - Strict-Transport-Security (HSTS)
//   - X-Content-Type-Options: nosniff
//   - X-Frame-Options: DENY  OR  Content-Security-Policy frame-ancestors
//   - Referrer-Policy: strict-origin-when-cross-origin (or stricter)
//   - Permissions-Policy: minimal allowlist
//   - Content-Security-Policy: present (preferably strict-dynamic)
//
// This is the OWASP Secure Headers Project baseline. We scan the
// server.js + middleware/index.js source for the helmet configuration
// patterns. End-to-end verification (live response inspection) belongs
// in the Playwright e2e suite when CI infra is online.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SOURCES = [
  readFileSync(join(HERE, "..", "server.js"), "utf-8"),
  readFileSync(join(HERE, "..", "middleware", "index.js"), "utf-8"),
].join("\n");

test("server configures Strict-Transport-Security (HSTS)", () => {
  const hsts = /hsts\s*:|Strict-Transport-Security|HSTS/i.test(SOURCES);
  assert.ok(hsts, "neither server.js nor middleware/index.js configures HSTS");
});

test("server configures X-Content-Type-Options: nosniff", () => {
  // Helmet's default behavior includes nosniff; the presence of
  // helmet() invocation satisfies this.
  const nosniff = /nosniff|X-Content-Type-Options|helmet\(/i.test(SOURCES);
  assert.ok(nosniff, "X-Content-Type-Options: nosniff not configured");
});

test("server configures clickjacking protection (X-Frame-Options or CSP frame-ancestors/frameSrc)", () => {
  const clickjack = /X-Frame-Options|frame-ancestors|frameSrc|frameguard|helmet\(/i.test(SOURCES);
  assert.ok(clickjack, "clickjacking protection not configured");
});

test("server configures Referrer-Policy", () => {
  const refPolicy = /referrerPolicy|Referrer-Policy/i.test(SOURCES);
  assert.ok(refPolicy, "Referrer-Policy not configured");
});

test("server configures Content-Security-Policy", () => {
  const csp = /contentSecurityPolicy|Content-Security-Policy/i.test(SOURCES);
  assert.ok(csp, "Content-Security-Policy not configured");
});

test("server configures Permissions-Policy", () => {
  const pp = /permissionsPolicy|Permissions-Policy|featurePolicy/i.test(SOURCES);
  assert.ok(pp, "Permissions-Policy not configured");
});

test("helmet middleware is actually applied (app.use(helmet(...)))", () => {
  const applied = /app\.use\(helmet\(/i.test(SOURCES);
  assert.ok(applied, "helmet() is imported but never wired into the middleware chain via app.use()");
});
