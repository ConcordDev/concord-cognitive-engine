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

const HERE = import.meta.dirname; // fileURLToPath-equivalent, real Node builtin — .pathname does NOT decode percent-encoding (e.g. spaces -> %20), which broke every test in this file on any checkout path containing a space
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

// ── Frontend layer (added 2026-07-27, Aikido triage) ────────────────────────
//
// Every test above scans server.js + middleware/index.js — the EXPRESS API.
// That is a real gap, not a stylistic one: the Cloudflare tunnel routes root
// traffic straight to the Next.js server on 127.0.0.1:3000, so on the
// deployed topology the HTML document is served by a layer none of the above
// assertions can see. HSTS was genuinely missing there while every test here
// passed on the API's Helmet config.
//
// These scan concord-frontend/next.config.js so the frontend cannot silently
// drop a document-level header either.

const FRONTEND_CONFIG = readFileSync(
  join(HERE, "..", "..", "concord-frontend", "next.config.js"),
  "utf-8"
);

test("frontend serves Strict-Transport-Security on the document", () => {
  assert.match(
    FRONTEND_CONFIG, /Strict-Transport-Security/,
    "next.config.js headers() does not set HSTS — on the tunnel->:3000 topology " +
    "the HTML document ships without it, regardless of what the API sends"
  );
});

test("frontend HSTS has a meaningful max-age and covers subdomains", () => {
  const m = FRONTEND_CONFIG.match(/max-age=(\d+)/);
  assert.ok(m, "HSTS present but no max-age");
  assert.ok(
    Number(m[1]) >= 31536000,
    `HSTS max-age ${m[1]} is under one year, too short to be meaningful`
  );
  assert.match(FRONTEND_CONFIG, /includeSubDomains/);
});

test("frontend still sets the other document-level headers", () => {
  for (const h of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.match(FRONTEND_CONFIG, new RegExp(h), `frontend dropped ${h}`);
  }
});

// Security audit 2026-07-30: the frontend previously shipped NO
// Content-Security-Policy at all — a prior nonce attempt was reportedly
// removed for "breaking inline scripts" (the real cause was more likely a
// naive style-src without 'unsafe-inline', which breaks React's
// style={{}} prop — CSP nonces can't cover the style HTML attribute, only
// <style> elements — see middleware.ts's header comment). Fixed via real
// per-request nonce generation in middleware.ts. Shipped first as
// Content-Security-Policy-Report-Only, then flipped to fully-enforced
// Content-Security-Policy the same day after a dedicated pre-flight audit
// (zero raw <script> tags, zero javascript: URLs, style-src's
// 'unsafe-inline' unaffected by the flip, and all 13 real <iframe> usages
// traced to same-origin/srcDoc or the two now-allowlisted YouTube origins
// — see middleware.ts's header comment for the full trace).
const MIDDLEWARE_SOURCE = readFileSync(
  join(HERE, "..", "..", "concord-frontend", "middleware.ts"),
  "utf-8"
);

test("frontend generates a per-request CSP nonce and ships a CSP header", () => {
  assert.match(
    MIDDLEWARE_SOURCE, /crypto\.randomUUID\(\)/,
    "middleware.ts no longer generates a per-request nonce"
  );
  assert.match(
    MIDDLEWARE_SOURCE, /Content-Security-Policy(-Report-Only)?/,
    "middleware.ts does not set a Content-Security-Policy header (enforced or report-only)"
  );
});

test("frontend CSP's script-src actually uses the nonce (not just 'unsafe-inline')", () => {
  assert.match(
    MIDDLEWARE_SOURCE, /script-src[^`]*'nonce-\$\{nonce\}'/,
    "script-src does not reference the generated nonce — a CSP without a real nonce " +
    "(or hash) on script-src provides no XSS protection at all"
  );
});

test("frontend CSP restricts the high-severity directives (object-src, frame-ancestors, base-uri)", () => {
  for (const directive of [/object-src\s+'none'/, /frame-ancestors\s+'none'/, /base-uri\s+'self'/]) {
    assert.match(MIDDLEWARE_SOURCE, directive, `middleware.ts CSP missing/loosened: ${directive}`);
  }
});
