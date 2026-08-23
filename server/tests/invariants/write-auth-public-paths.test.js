// server/tests/invariants/write-auth-public-paths.test.js
//
// Pins the EXACT contents of WRITE_AUTH_PUBLIC_PATHS (server.js), the
// allowlist of prefixes exempt from productionWriteAuthMiddleware — i.e. the
// paths that accept UNAUTHENTICATED WRITES in production.
//
// WHY THIS EXISTS — a real blind spot, found 2026-07-27 by probing rather than
// assuming:
//
// The authz-coverage detector emits one `authz_write_auth_bypass` finding per
// entry in this array, and the security gate grandfathers reviewed findings by
// fingerprint. But `lib/detectors/baseline.js#fingerprint` hashes
//     sha256(detector | ruleId | location | severity)
// and deliberately EXCLUDES the message. Every entry in this array lives on
// the SAME SOURCE LINE (it is a single-line literal), so every finding it
// produces shares one ruleId, one location and one severity — and therefore
// ONE FINGERPRINT.
//
// Consequence: once any single entry is baselined, every future addition to
// the array is silently grandfathered. Verified empirically — adding a fake
// "/api/PROBE_FAKE_BYPASS/" prefix produced a second high-severity finding
// that collapsed onto the already-baselined fingerprint, and
// `run-detectors.js --consumer security --diff --ci` reported
// `added: 0 ... CI check PASSED`.
//
// That is the same silently-disarmed-gate class this repo has been bitten by
// before (the Trivy job that gated on a nonexistent root Dockerfile; the
// guard.mjs coin-service path that left minting ungated). The detector gate
// cannot see additions here, so this test is the control that can: adding,
// removing or reordering an entry turns THIS named test red with a diff
// showing exactly which prefix changed.
//
// If you are here because this test failed: that is the point. A new
// unauthenticated-write prefix is a security decision. Justify it, then update
// EXPECTED below in the same commit.
//
// Run: node --test server/tests/invariants/write-auth-public-paths.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_JS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "server.js",
);

/**
 * The allowlist as reviewed on 2026-07-27. Each entry is exempt from the
 * production write-auth gate, so each is a deliberate decision:
 *
 *   /api/auth/login, /api/auth/register, /api/auth/csrf-token
 *       — must be reachable before a session exists.
 *   /api/auth/refresh
 *       — cookie-authenticated via the httpOnly refresh token, not a JWT/
 *         session header; SameSite=lax already blocks a cross-site POST from
 *         forging the refresh, and it must work before a CSRF cookie exists
 *         (see the matching justification at this array's own declaration
 *         in server.js). Pre-existing, already-justified entry — this
 *         ratchet's EXPECTED list simply hadn't been synced to it.
 *   /health, /ready
 *       — liveness/readiness probes; no writes behind them.
 *   /metrics
 *       — Prometheus scrape.
 *   /api/stripe/webhook
 *       — signature-authenticated by Stripe, no cookie/JWT. Exempting it is
 *         required or every webhook 401s and paid coins never mint;
 *         handleWebhook verifies the signature before any write.
 *   /api/welding/portal/
 *       — anonymous customer using an unguessable, single-purpose portal
 *         token, scoped server-side to exactly one estimate/invoice. Covered
 *         end-to-end by tests/e2e/welding-portal-routes.test.js (cross-tenant
 *         isolation, no fabricated payment success, invalid-token rejection).
 *   /api/spectate/
 *       — the Godot spectator-viewer milestone. `POST /api/spectate/:worldId/
 *         subscribe` and `POST /api/spectate/heartbeat` are genuinely
 *         anonymous-capable POSTs that open/refresh a READ-ONLY spectator
 *         session (this gate's automatic GET/HEAD/OPTIONS exemption doesn't
 *         cover them, since they're POSTs by necessity — a session token has
 *         to be minted/refreshed somehow). The actual world feed is a GET
 *         (`/api/spectate/:worldId/feed`) and needs no exemption. See the
 *         inline justification at this array's own declaration in server.js.
 */
const EXPECTED = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/csrf-token",
  "/api/auth/refresh",
  "/health",
  "/ready",
  "/metrics",
  "/api/stripe/webhook",
  "/api/welding/portal/",
  "/api/spectate/",
];

function parseAllowlist() {
  const src = readFileSync(SERVER_JS, "utf8");
  const m = src.match(/const WRITE_AUTH_PUBLIC_PATHS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "WRITE_AUTH_PUBLIC_PATHS literal not found — did it get renamed or restructured?");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("WRITE_AUTH_PUBLIC_PATHS — the unauthenticated-write allowlist", () => {
  it("contains exactly the reviewed set (order-independent)", () => {
    const actual = parseAllowlist();
    const added = actual.filter((p) => !EXPECTED.includes(p));
    const removed = EXPECTED.filter((p) => !actual.includes(p));

    assert.deepEqual(
      added, [],
      "NEW unauthenticated-write prefix(es) added. The detector gate CANNOT catch this — " +
      "every entry shares one fingerprint. Justify each, then update EXPECTED."
    );
    assert.deepEqual(
      removed, [],
      "Reviewed prefix(es) removed. Probably fine, possibly a broken flow (e.g. dropping " +
      "/api/stripe/webhook makes every webhook 401 and paid coins never mint). Update EXPECTED."
    );
    assert.equal(actual.length, EXPECTED.length, "duplicate entries in the allowlist");
  });

  it("the gate that consumes it is still wired and still prefix-matched", () => {
    const src = readFileSync(SERVER_JS, "utf8");
    // If this stops being a prefix match, the reasoning in EXPECTED's comments
    // (e.g. "/api/welding/portal/" covering :token subpaths) no longer holds.
    assert.match(
      src,
      /WRITE_AUTH_PUBLIC_PATHS\.some\(\s*p\s*=>\s*req\.path\.startsWith\(p\)\s*\)/,
      "the allowlist is no longer consumed as a startsWith prefix match"
    );
    assert.match(
      src, /function productionWriteAuthMiddleware/,
      "productionWriteAuthMiddleware is gone — the allowlist guards nothing"
    );
  });

  it("every entry is a rooted path, so it cannot match unexpectedly broadly", () => {
    for (const p of parseAllowlist()) {
      assert.ok(p.startsWith("/"), `${p} is not rooted — a bare prefix can match far more than intended`);
      assert.ok(!p.includes("*"), `${p} contains a wildcard; this is a startsWith match, not a glob`);
    }
  });
});
