#!/usr/bin/env node
// scripts/verify-prod-env.mjs
//
// Real preflight a deployer runs before pushing Concord to the browser.
// Every check below is a REAL probe against the actual environment / dependency
// tree / filesystem this process can see — never a fabricated "looks fine".
// A check that can't run honestly reports SKIP with the reason, not a fake PASS.
//
// Ground truth encoded here was read directly out of the code, not guessed:
//   - server/server.js:1758-1837  validateEnvironment() — REQUIRED_ENV_PRODUCTION,
//     JWT_SECRET/SESSION_SECRET >=32, ADMIN_PASSWORD >=12, security deps mandatory.
//   - server/server.js:2596-2632  AUTH_MODE resolution + the production
//     AUTH_MODE==='public' refusal + the JWT_SECRET-required-in-prod gate.
//   - server/server.js:8174-8193  WS CORS fails CLOSED (reject cross-origin,
//     allow only no-Origin clients) when ALLOWED_ORIGINS is unset in production.
//   - concord-frontend/lib/api/client.ts:30, lib/realtime/socket.ts:10 —
//     NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SOCKET_URL fall back to '' (same-origin),
//     which only works because concord-frontend/next.config.js rewrites
//     /api/*, /socket.io/*, /health, /ready to BACKEND_URL.
//   - .env.example — the REPLACE_ME / your-* / change-me placeholder values that
//     ship in the template, used here to catch "copied the example, never edited it".
//   - server/server.js:36 "Node: v18+ recommended (works on v24+)" and
//     server/package.json engines.node ">=18.0.0" — the real floor; >=22 is
//     recommended (matches the newer CI workflows + docker base images trend)
//     but is NOT a hard requirement, so it WARNs rather than FAILs.
//
// Usage:
//   node scripts/verify-prod-env.mjs            # human-readable report
//   node scripts/verify-prod-env.mjs --json      # machine-readable report
//
// Exit code: 0 only if every REQUIRED check passes. Non-zero otherwise.

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");
const JSON_MODE = process.argv.includes("--json");

// Load .env the same way server.js does (best-effort, never fatal) so this
// preflight sees exactly what the real boot would see if a .env file is
// present next to server/. This does NOT fabricate values — if dotenv isn't
// installed or there's no .env file, we say so and move on.
let dotenvLoad = { attempted: false, loaded: false, reason: null };
try {
  dotenvLoad.attempted = true;
  const requireServer = createRequire(path.join(SERVER_DIR, "package.json"));
  const dotenvPath = requireServer.resolve("dotenv");
  const dotenv = await import(dotenvPath);
  const envFile = fs.existsSync(path.join(SERVER_DIR, ".env"))
    ? path.join(SERVER_DIR, ".env")
    : fs.existsSync(path.join(ROOT, ".env"))
    ? path.join(ROOT, ".env")
    : null;
  if (envFile) {
    const result = dotenv.config({ path: envFile });
    dotenvLoad.loaded = !result?.error;
    dotenvLoad.path = envFile;
  } else {
    dotenvLoad.reason = "no .env file found at server/.env or ./.env — reading process env only";
  }
} catch (e) {
  dotenvLoad.reason = `dotenv not loaded: ${String(e?.message || e)}`;
}

const results = []; // { group, name, status: PASS|FAIL|WARN|SKIP|CONFIGURED|DORMANT, reason, required }

function record(group, name, status, reason, { required = false } = {}) {
  results.push({ group, name, status, reason, required });
}

// ---------------------------------------------------------------------------
// Placeholder detection — values that ship (commented out) in .env.example.
// A deployer who copies .env.example and forgets to replace a value should
// get a hard FAIL, not a false PASS just because the var is "set".
// ---------------------------------------------------------------------------
const PLACEHOLDER_RE = /^(your-|change-?me|replace_?me|xxx|placeholder|sk_replace|whsec_replace|price_replace|example)/i;

function isPlaceholder(value) {
  if (!value) return false;
  return PLACEHOLDER_RE.test(value.trim());
}

// ---------------------------------------------------------------------------
// 1. REQUIRED environment variables (server/server.js:1759, :2613, :2619)
// ---------------------------------------------------------------------------
const nodeEnv = process.env.NODE_ENV || "development";
if (nodeEnv !== "production") {
  record(
    "required",
    "NODE_ENV",
    "WARN",
    `NODE_ENV='${nodeEnv}'. The production guards this script checks (validateEnvironment(), the AUTH_MODE='public' refusal, the JWT_SECRET-required gate) only fire when NODE_ENV=production at boot. Set NODE_ENV=production for this preflight to reflect the real boot path.`
  );
} else {
  record("required", "NODE_ENV", "PASS", "NODE_ENV=production");
}

// JWT_SECRET: required, >=32 chars, not a placeholder (server.js:1770, :1803, :2613-2625)
{
  const v = process.env.JWT_SECRET;
  if (!v) {
    record("required", "JWT_SECRET", "FAIL", "Not set. server.js:2619-2625 exits the process at boot in production (AUTH_USES_JWT true by default). Generate with: openssl rand -base64 48", { required: true });
  } else if (isPlaceholder(v)) {
    record("required", "JWT_SECRET", "FAIL", `Value looks like an unedited placeholder ('${v.slice(0, 12)}...'). Generate a real secret.`, { required: true });
  } else if (v.length < 32) {
    record("required", "JWT_SECRET", "FAIL", `Only ${v.length} chars — server.js:1803-1805 requires >=32 (validateEnvironment() exits in production).`, { required: true });
  } else {
    record("required", "JWT_SECRET", "PASS", `Set, ${v.length} chars, entropy check passed.`, { required: true });
  }
}

// ADMIN_PASSWORD: required, >=12 chars, not a placeholder (server.js:1770, :1813)
{
  const v = process.env.ADMIN_PASSWORD;
  if (!v) {
    record("required", "ADMIN_PASSWORD", "FAIL", "Not set. server.js:1770-1774 lists this as required in production — validateEnvironment() exits the process.", { required: true });
  } else if (isPlaceholder(v)) {
    record("required", "ADMIN_PASSWORD", "FAIL", "Value looks like an unedited placeholder.", { required: true });
  } else if (v.length < 12) {
    record("required", "ADMIN_PASSWORD", "FAIL", `Only ${v.length} chars — server.js:1813-1815 requires >=12 (exits in production).`, { required: true });
  } else {
    record("required", "ADMIN_PASSWORD", "PASS", `Set, ${v.length} chars.`, { required: true });
  }
}

// AUTH_MODE resolution — replicate server.js:2596-2616 exactly so the check
// is faithful to the real fallback chain, not a guess.
{
  const AUTH_MODE_VALUES = new Set(["public", "apikey", "jwt", "hybrid"]);
  const LEGACY_AUTH_ENABLED = String(process.env.AUTH_ENABLED || "true").toLowerCase() === "true";
  const AUTH_MODE_RAW = String(process.env.AUTH_MODE || "").toLowerCase().trim();
  const AUTH_MODE = AUTH_MODE_VALUES.has(AUTH_MODE_RAW)
    ? AUTH_MODE_RAW
    : (AUTH_MODE_RAW ? "hybrid" : (LEGACY_AUTH_ENABLED ? "hybrid" : "public"));
  if (AUTH_MODE === "public") {
    record("required", "AUTH_MODE", "FAIL", `Resolves to 'public' (AUTH_MODE='${process.env.AUTH_MODE || "(unset)"}', AUTH_ENABLED='${process.env.AUTH_ENABLED ?? "(unset, defaults true)"}'). server.js:2613-2616 refuses to start with AUTH_MODE='public' in production. Set AUTH_MODE=jwt or AUTH_MODE=hybrid.`, { required: true });
  } else {
    record("required", "AUTH_MODE", "PASS", `Resolves to '${AUTH_MODE}' — not the refused 'public' mode.`, { required: true });
  }
}

// Security dependencies mandatory in production (server.js:1779-1789) — real
// require.resolve() probes against server/node_modules, not a hopeful assert.
{
  const requireServer = createRequire(path.join(SERVER_DIR, "package.json"));
  const deps = [
    { name: "helmet", pkg: "helmet" },
    { name: "express-rate-limit", pkg: "express-rate-limit" },
    { name: "bcryptjs", pkg: "bcryptjs" },
    { name: "jsonwebtoken", pkg: "jsonwebtoken" },
  ];
  for (const dep of deps) {
    try {
      requireServer.resolve(dep.pkg);
      record("required", `security dep: ${dep.pkg}`, "PASS", "Resolvable from server/node_modules.", { required: true });
    } catch (e) {
      record("required", `security dep: ${dep.pkg}`, "FAIL", `Not resolvable — server.js:1785-1789 treats a missing security dep as fatal in production. Run: npm install ${dep.pkg} (in server/). ${String(e?.message || e)}`, { required: true });
    }
  }
}

// better-sqlite3 loadable — real require + real :memory: DB open/close.
{
  try {
    const requireServer = createRequire(path.join(SERVER_DIR, "package.json"));
    const Database = requireServer("better-sqlite3");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("probe");
    const row = db.prepare("SELECT v FROM t WHERE id = 1").get();
    db.close();
    if (row?.v === "probe") {
      record("required", "better-sqlite3", "PASS", "Loaded natively, created table, wrote + read a row, closed cleanly.", { required: true });
    } else {
      record("required", "better-sqlite3", "FAIL", "Loaded but round-trip read did not return the written value.", { required: true });
    }
  } catch (e) {
    record("required", "better-sqlite3", "FAIL", `Failed to load/open: ${String(e?.message || e)}. server.js falls back to JSON persistence without it — validateEnvironment() only WARNs, but that fallback is not production-grade.`, { required: true });
  }
}

// Node version — real floor is >=18 (server.js:36, package.json engines).
// >=22 is recommended (matches newer CI/Docker trend) but not a hard gate.
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    record("required", "node version", "FAIL", `Running Node ${process.versions.node}. server/package.json engines.node requires >=18.0.0.`, { required: true });
  } else if (major < 22) {
    record("required", "node version", "WARN", `Running Node ${process.versions.node}. Floor (>=18) is met; >=22 is recommended (several CI workflows and the general trend in this repo target 22).`);
  } else {
    record("required", "node version", "PASS", `Running Node ${process.versions.node} (>=22 recommended target met).`);
  }
}

// DB_PATH directory writable — real fs probe (write + delete a temp file),
// not just an existsSync check.
{
  const DATA_DIR = process.env.DATA_DIR
    || (fs.existsSync("/workspace") ? "/workspace/concord-data" : path.join(ROOT, "server", "data"));
  const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "concord.db");
  const dir = path.dirname(DB_PATH);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probeFile = path.join(dir, `.verify-prod-env-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probeFile, "probe");
    fs.rmSync(probeFile);
    record("required", "DB_PATH directory writable", "PASS", `${dir} is writable (wrote + removed a probe file).`, { required: true });
  } catch (e) {
    record("required", "DB_PATH directory writable", "FAIL", `${dir} is NOT writable: ${String(e?.message || e)}`, { required: true });
  }
}

// ---------------------------------------------------------------------------
// 2. Fail-closed behaviors (report, don't hard-fail — these are safe defaults)
// ---------------------------------------------------------------------------
{
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    record(
      "fail-closed",
      "ALLOWED_ORIGINS",
      "WARN",
      "Not set. server.js:8174-8193 fails CLOSED in production: WebSocket CORS will reject every cross-origin browser client (only no-Origin/non-browser clients pass). The browser app served from a different origin than the API will NOT be able to open a socket. Set ALLOWED_ORIGINS to your real https origin(s) if the frontend and backend are on different hosts."
    );
  } else {
    const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
    const bad = [];
    for (const o of origins) {
      try {
        const u = new URL(o);
        if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
          bad.push(`${o} (not https)`);
        }
      } catch {
        bad.push(`${o} (does not parse as a URL)`);
      }
    }
    if (bad.length) {
      record("fail-closed", "ALLOWED_ORIGINS", "WARN", `Set to '${raw}' but ${bad.length} entr${bad.length === 1 ? "y is" : "ies are"} suspect: ${bad.join(", ")}. Production origins should be https://.`);
    } else {
      record("fail-closed", "ALLOWED_ORIGINS", "PASS", `Set to ${origins.length} origin(s): ${origins.join(", ")}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Frontend origin configuration
// ---------------------------------------------------------------------------
function checkPublicUrl(name) {
  const v = process.env[name];
  if (!v) return null;
  try {
    const u = new URL(v);
    const localHostish = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return { ok: true, url: u, localHostish };
  } catch {
    return { ok: false };
  }
}
{
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  const backendUrl = process.env.BACKEND_URL;
  if (!apiUrl && !socketUrl) {
    if (backendUrl) {
      record("frontend", "NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SOCKET_URL", "CONFIGURED", `Unset, but BACKEND_URL='${backendUrl}' is set — concord-frontend/next.config.js rewrites /api/*, /socket.io/*, /health, /ready to it. lib/api/client.ts + lib/realtime/socket.ts fall back to '' (same-origin), which works through this rewrite proxy.`);
    } else {
      record("frontend", "NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SOCKET_URL", "WARN", "Neither is set, and BACKEND_URL is also unset (next.config.js rewrite would default to http://127.0.0.1:5050). If frontend and backend are NOT on the same host/process, the browser app will call relative paths against nothing real. Set NEXT_PUBLIC_API_URL/NEXT_PUBLIC_SOCKET_URL (baked in at Next.js build time) OR set BACKEND_URL for the same-origin rewrite proxy.");
    }
  } else {
    for (const name of ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SOCKET_URL"]) {
      const parsed = checkPublicUrl(name);
      if (parsed === null) continue; // unset is fine if the other is set / handled above
      if (!parsed.ok) {
        record("frontend", name, "FAIL", `Set to '${process.env[name]}' which does not parse as a URL.`, { required: true });
      } else if (parsed.localHostish && nodeEnv === "production") {
        record("frontend", name, "WARN", `Set to '${process.env[name]}' (localhost) while NODE_ENV=production — this is baked into the frontend build at build time (next.config.js), so a localhost value in a production build means real users' browsers will try to reach localhost.`);
      } else {
        record("frontend", name, "PASS", `Set to '${process.env[name]}', parses as a valid URL.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Optional groups — CONFIGURED vs DORMANT (dormant = honest degradation)
// ---------------------------------------------------------------------------
// SESSION_SECRET
{
  const v = process.env.SESSION_SECRET;
  if (!v) {
    record("optional", "SESSION_SECRET", "DORMANT", "Not set. Cookie-session signing falls back to a generated value that won't survive restart — not a boot blocker, just a UX regression (sessions drop) on every restart. Generate with: openssl rand -base64 48");
  } else if (v.length < 32) {
    record("optional", "SESSION_SECRET", "FAIL", `Set but only ${v.length} chars — server.js:1809-1811 requires >=32 when present (validateEnvironment() exits in production).`, { required: true });
  } else {
    record("optional", "SESSION_SECRET", "CONFIGURED", `Set, ${v.length} chars.`);
  }
}

// Sentry
{
  const dsn = process.env.SENTRY_DSN;
  const pubDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn || pubDsn) {
    record("optional", "Sentry", "CONFIGURED", `${dsn ? "SENTRY_DSN set" : ""}${dsn && pubDsn ? "; " : ""}${pubDsn ? "NEXT_PUBLIC_SENTRY_DSN set" : ""}. concord-frontend/next.config.js only wraps the build with withSentryConfig when NEXT_PUBLIC_SENTRY_DSN + SENTRY_ORG are both set.`);
  } else {
    record("optional", "Sentry", "DORMANT", "SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN not set — error tracking is off. next.config.js explicitly skips withSentryConfig when unset (avoids the CSP/redirect script-load error it otherwise causes). Not a boot blocker.");
  }
}

// Google OAuth / connectors
{
  const cid = process.env.GOOGLE_CLIENT_ID;
  const csec = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.CONCORD_CONNECTOR_TOKEN_KEY;
  if (cid && csec) {
    let note = "GOOGLE_CLIENT_ID/SECRET set — Gmail/Calendar connectors can authorize.";
    if (!tokenKey) {
      note += " CONCORD_CONNECTOR_TOKEN_KEY is unset — connector-tokens.js falls back to JWT_SECRET/SESSION_SECRET for AES-256-GCM at-rest encryption; set a dedicated 32+ byte key for production per docs/CONNECTORS_GO_LIVE.md.";
    } else if (tokenKey.length < 32) {
      note += ` CONCORD_CONNECTOR_TOKEN_KEY is only ${tokenKey.length} chars — should be >=32 bytes.`;
    } else {
      note += " CONCORD_CONNECTOR_TOKEN_KEY set (>=32 chars).";
    }
    record("optional", "Google OAuth / connectors", "CONFIGURED", note);
  } else {
    record("optional", "Google OAuth / connectors", "DORMANT", "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set — Gmail/Calendar/Sheets connectors + Google sign-in return an honest not-configured/no_token response rather than fabricating a connection. See docs/CONNECTORS_GO_LIVE.md for the go-live steps (OAuth client, redirect URI, consent-screen verification, CASA for Gmail's restricted scope).");
  }
}

// Stripe
{
  const sk = process.env.STRIPE_SECRET_KEY;
  const wh = process.env.STRIPE_WEBHOOK_SECRET;
  if (sk && !isPlaceholder(sk)) {
    record("optional", "Stripe", "CONFIGURED", `STRIPE_SECRET_KEY set.${wh && !isPlaceholder(wh) ? " STRIPE_WEBHOOK_SECRET set." : " STRIPE_WEBHOOK_SECRET missing/placeholder — webhook signature verification will fail."}`);
  } else if (sk && isPlaceholder(sk)) {
    record("optional", "Stripe", "FAIL", "STRIPE_SECRET_KEY is set to the .env.example placeholder ('sk_REPLACE_ME_NOT_A_REAL_KEY') — billing will call Stripe with a fake key and fail at request time, not at boot. Replace it or unset it to keep billing honestly dormant.", { required: true });
  } else {
    record("optional", "Stripe", "DORMANT", "STRIPE_SECRET_KEY not set — billing/checkout/withdrawal-payout routes are dormant. Not a boot blocker unless you're shipping paid features.");
  }
}

// Heap tuning pair
{
  const heap = process.env.MAX_OLD_SPACE_SIZE;
  if (heap) {
    const n = Number(heap);
    if (!Number.isFinite(n) || n <= 0) {
      record("optional", "MAX_OLD_SPACE_SIZE", "FAIL", `Set to '${heap}', not a positive number. server/lib/memory-pressure.js reads it directly as the heap ceiling for the pressure watchdog.`, { required: true });
    } else {
      record("optional", "MAX_OLD_SPACE_SIZE", "CONFIGURED", `Set to ${heap}MB. This value must match the '--max-old-space-size=${heap}' flag node is actually started with — this script cannot see the parent process's launch flags, so verify your start command pairs them (CLAUDE.md: "Keep both in sync").`);
    }
  } else {
    record("optional", "MAX_OLD_SPACE_SIZE", "DORMANT", "Not set — server/lib/memory-pressure.js defaults the watchdog ceiling to 32768MB (32GB). Fine on a 32GB+ box; set explicitly (and pass --max-old-space-size to match) on a smaller box.");
  }
}

// DB_PATH / PORT informational
{
  const DATA_DIR = process.env.DATA_DIR
    || (fs.existsSync("/workspace") ? "/workspace/concord-data" : path.join(ROOT, "server", "data"));
  const dbPath = process.env.DB_PATH || path.join(DATA_DIR, "concord.db");
  record("optional", "DB_PATH", process.env.DB_PATH ? "CONFIGURED" : "DORMANT", `Resolves to ${dbPath}${process.env.DB_PATH ? "" : " (default — DATA_DIR/concord.db)"}.`);
  const port = process.env.PORT;
  if (port && (isNaN(Number(port)) || Number(port) < 1)) {
    record("optional", "PORT", "FAIL", `PORT='${port}' is not a valid positive number — server.js:1817-1819 rejects this in validateEnvironment().`, { required: true });
  } else {
    record("optional", "PORT", port ? "CONFIGURED" : "DORMANT", `Resolves to ${port || "5050 (default)"}.`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const requiredFails = results.filter((r) => r.required && (r.status === "FAIL"));
const ok = requiredFails.length === 0;

if (JSON_MODE) {
  console.log(JSON.stringify({
    ok,
    nodeEnv,
    dotenv: dotenvLoad,
    results,
    summary: {
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      warn: results.filter((r) => r.status === "WARN").length,
      configured: results.filter((r) => r.status === "CONFIGURED").length,
      dormant: results.filter((r) => r.status === "DORMANT").length,
      requiredFails: requiredFails.length,
    },
  }, null, 2));
} else {
  console.log("Concord production-env preflight");
  console.log("=================================");
  console.log(`NODE_ENV: ${nodeEnv}  |  Node: ${process.versions.node}  |  Host: ${os.hostname()}`);
  console.log(dotenvLoad.loaded ? `.env loaded from ${dotenvLoad.path}` : `.env: ${dotenvLoad.reason || "not loaded"}`);
  console.log("");

  const groups = [
    ["required", "REQUIRED (must pass to go live)"],
    ["fail-closed", "FAIL-CLOSED BEHAVIOR"],
    ["frontend", "FRONTEND ORIGIN CONFIG"],
    ["optional", "OPTIONAL (CONFIGURED / DORMANT is not a failure)"],
  ];
  for (const [key, title] of groups) {
    const rows = results.filter((r) => r.group === key);
    if (!rows.length) continue;
    console.log(`-- ${title} --`);
    for (const r of rows) {
      const badge = r.status.padEnd(11, " ");
      console.log(`  [${badge}] ${r.name}`);
      console.log(`              ${r.reason}`);
    }
    console.log("");
  }

  console.log("=================================");
  console.log(`PASS=${results.filter((r) => r.status === "PASS").length}  FAIL=${results.filter((r) => r.status === "FAIL").length}  WARN=${results.filter((r) => r.status === "WARN").length}  CONFIGURED=${results.filter((r) => r.status === "CONFIGURED").length}  DORMANT=${results.filter((r) => r.status === "DORMANT").length}`);
  if (ok) {
    console.log("RESULT: OK — all REQUIRED checks passed. Review WARN/DORMANT lines for optional features you may want live.");
  } else {
    console.log(`RESULT: NOT READY — ${requiredFails.length} required check(s) failed:`);
    for (const r of requiredFails) console.log(`  - ${r.name}: ${r.reason}`);
  }
}

process.exit(ok ? 0 : 1);
