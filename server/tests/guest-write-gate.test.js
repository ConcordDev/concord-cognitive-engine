// server/tests/guest-write-gate.test.js
//
// GB-1536 §6b — the guest WRITE gate, proven in production shape.
//
// Founder rule: a guest (signed-out visitor) may look, never act. The
// server is the authority, so this suite runs with NODE_ENV=production
// and AUTH_MODE=jwt — the two production gates live — and asserts:
//
//   1. ROUTER-STACK ENUMERATION: every registered non-GET Express route
//      (walked from app._router.stack, mounted routers included) returns
//      401 to a credential-less caller, except the explicit allowlist
//      below (each entry carries its reason). A new mutating route that
//      somehow lands in front of the gates fails here.
//   2. GARBAGE CREDENTIALS: on representative write surfaces, a garbage
//      Authorization header, a forged concord_auth cookie and a junk
//      x-api-key get the same 401 as no credentials at all — credential
//      PRESENCE is not validity (the pre-GB-1536 write gate passed all
//      three).
//   3. LENS ACTIONS: every LENS_ACTIONS key NOT marked guestRead 401s
//      over POST /api/lens/run for every credential variant; every
//      guestRead action does NOT 401 (it reaches H1's pass-through) and
//      passes the static guestRead contract: not write-shaped, and its
//      handler source contains no brain/LLM call helper.
//
// Run (GitHub CI): cd server && node --test tests/guest-write-gate.test.js
// (the repo's server test harness supplies the no-egress preload and
// per-file DB isolation; NODE_ENV/AUTH_MODE are set below, pre-import.)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.NODE_ENV = "production";
process.env.AUTH_MODE = "jwt";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { app, LENS_ACTIONS } = __TEST__;
registerServerCleanExit(() => __TEST__);

const { lensActionGuestRead } = await import("../lib/lens-action-dispatch.js");
const { isWriteActionName } = await import("../lib/lens-authz.js");

// ── The explicit allowlist: non-GET routes an anonymous caller may
// reach. Each is a deliberate, separately-reviewed decision (see
// WRITE_AUTH_PUBLIC_PATHS + the authMiddleware bypass comments in
// server.js). Anything else answering a credential-less write with
// anything but 401 fails this suite.
const ALLOWLIST = [
  { prefix: "/api/auth/login", reason: "sign-in must be reachable before a session exists" },
  { prefix: "/api/auth/register", reason: "sign-up must be reachable before a session exists" },
  { prefix: "/api/auth/csrf-token", reason: "CSRF bootstrap for the auth forms" },
  { prefix: "/api/auth/refresh", reason: "cookie-authenticated refresh (httpOnly refresh token)" },
  { prefix: "/health", reason: "liveness probe" },
  { prefix: "/ready", reason: "readiness probe" },
  { prefix: "/metrics", reason: "Prometheus scrape + FE web-vitals beacon (no user data written)" },
  { prefix: "/api/metrics/vitals", reason: "FE web-vitals beacon (in-memory window only)" },
  { prefix: "/api/stripe/webhook", reason: "Stripe-signature-authenticated webhook" },
  { prefix: "/api/welding/portal/", reason: "unguessable single-purpose portal token, token-scoped server-side" },
  { prefix: "/api/spectate/", reason: "read-only spectator subscribe/heartbeat (no user data)" },
  { prefix: "/api/esign/", reason: "unguessable single-signer token, token-scoped server-side" },
  { prefix: "/api/receipts/verify", reason: "exact path: verifies an Ed25519 signature, writes nothing" },
  { prefix: "/api/receipts/sheet", reason: "exact path: renders a calc sheet for a verified receipt, writes nothing" },
  { prefix: "/api/public-share/", reason: "proof-link reviewer comment only: token-scoped, rate-limited (PUBLIC_PROOF_COMMENT_RE)" },
  { prefix: "/api/ingest", reason: "token-scoped inbound ingest webhook (exact-route regex in the gate)" },
];

function allowlisted(path) {
  return ALLOWLIST.find((a) => path === a.prefix || path.startsWith(a.prefix));
}

// ── Router-stack enumeration ──────────────────────────────────────────
function enumerateRoutes() {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
        for (const method of methods) {
          out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        // Mounted router: recover its mount prefix from the layer regexp.
        let mount = "";
        const src = layer.regexp?.source || "";
        const m = /^\/\^\\\/(.*?)\\\/\?\(\?\=/.exec(src) || /^\/\^\\\/(.*?)\\\/\?\$/.exec(src);
        if (m) mount = "/" + m[1].replace(/\\\//g, "/");
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  const router = app._router || app.router;
  walk(router.stack, "");
  return out;
}

let base;
let server;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server?.close(); } catch { /* teardown */ } });

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const CRED_VARIANTS = [
  ["no credentials", {}],
  ["garbage Authorization", { authorization: "Bearer <redacted>" }],
  ["forged concord_auth cookie", { cookie: "concord_auth=forged.junk.token" }],
  ["junk x-api-key", { "x-api-key": "junk-key-not-issued" }],
];

describe("guest write gate — production shape (GB-1536)", () => {
  it("enumerates a real router stack (sanity: hundreds of routes, dozens of writes)", () => {
    const routes = enumerateRoutes();
    assert.ok(routes.length > 200, `expected >200 routes, got ${routes.length}`);
    const writes = routes.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method));
    assert.ok(writes.length > 50, `expected >50 non-GET routes, got ${writes.length}`);
  });

  it("every non-allowlisted non-GET route 401s a credential-less caller", async () => {
    const routes = enumerateRoutes().filter(
      (r) => !["GET", "HEAD", "OPTIONS"].includes(r.method) && !allowlisted(r.path),
    );
    const failures = [];
    for (const r of routes) {
      const probePath = r.path.replace(/:[^/]+/g, "gb1536-probe");
      const { status } = await call(r.method, probePath, { body: {} });
      // 401/403 = a gate refused it (the app gates answer 401; a few
      // role-gated route stacks answer 403 — both are refusals before
      // any handler ran). 404/405 = the mount never matched (the
      // enumeration's mount-prefix recovery is approximate for a few
      // routers) — not a pass, but not a gate failure either. Anything
      // else (2xx/3xx/400/422/5xx) means a handler RAN for a guest:
      // validation, a redirect or a crash all prove the request got in.
      if (![401, 403, 404, 405].includes(status)) {
        failures.push(`${r.method} ${r.path} -> ${status}`);
      }
    }
    assert.deepEqual(failures, [], `guest reached a handler:\n${failures.join("\n")}`);
  });

  it("garbage credentials are worth nothing on representative write surfaces", async () => {
    const surfaces = [
      ["POST", "/api/lens/code"],
      ["PUT", "/api/lens/code/gb1536-probe"],
      ["DELETE", "/api/lens/code/gb1536-probe"],
      ["POST", "/api/chat/memory"],
      ["POST", "/api/dtus"],
    ];
    for (const [method, path] of surfaces) {
      for (const [label, headers] of CRED_VARIANTS) {
        const { status } = await call(method, path, { headers, body: {} });
        assert.equal(status, 401, `${method} ${path} with ${label} -> ${status}, expected 401`);
      }
    }
  });

  it("every non-guestRead lens action 401s over /api/lens/run, for every credential variant", async () => {
    const keys = [...LENS_ACTIONS.keys()];
    assert.ok(keys.length > 100, `expected the lens-action registry, got ${keys.length}`);
    let checked = 0;
    for (const key of keys) {
      const dot = key.indexOf(".");
      const domain = key.slice(0, dot);
      const action = key.slice(dot + 1);
      if (lensActionGuestRead(domain, action)) continue;
      for (const [label, headers] of CRED_VARIANTS) {
        const { status } = await call("POST", "/api/lens/run", {
          headers,
          body: { domain, action, input: {} },
        });
        assert.equal(status, 401, `${key} with ${label} -> ${status}, expected 401`);
      }
      checked++;
    }
    assert.ok(checked > 100, `expected to check >100 non-guestRead actions, checked ${checked}`);
  });

  it("guestRead actions pass the gates (not 401) and honour the static contract", async () => {
    const guestReads = [...LENS_ACTIONS.keys()].filter((key) => {
      const dot = key.indexOf(".");
      return lensActionGuestRead(key.slice(0, dot), key.slice(dot + 1));
    });
    assert.ok(guestReads.length >= 2, `expected the registered guestRead actions, got ${guestReads.join(",")}`);
    for (const key of guestReads) {
      const dot = key.indexOf(".");
      const domain = key.slice(0, dot);
      const action = key.slice(dot + 1);
      // (i) not write-shaped
      assert.equal(isWriteActionName(action), false, `${key} is write-shaped — cannot be guestRead`);
      // (ii) no brain/LLM call path in the handler source
      const src = LENS_ACTIONS.get(key).toString();
      assert.ok(!/callBrain|governedCall|askBrain|brainComplete|llmCall/.test(src), `${key} handler reaches a brain/LLM helper — cannot be guestRead`);
      // (iii) reachable by a guest: the gates pass it (H1's verdict is
      // the envelope, never a gate 401)
      const { status } = await call("POST", "/api/lens/run", { body: { domain, action, input: {} } });
      assert.notEqual(status, 401, `${key} guestRead but the gates 401'd it`);
    }
  });
});
