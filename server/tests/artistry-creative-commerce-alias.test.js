/**
 * WAVE4 — /api/creative-commerce dual-mount alias safety net.
 *
 * The DAW/Studio/Marketplace/Distribution/Collab/AI-production backend is
 * misfiled under the historical "/api/artistry" namespace. Rather than
 * rename any of the 68 existing routes in place (a live-commerce path —
 * marketplace purchases, royalty splits, wallet debits — where a rename
 * risks caller breakage for zero behavioral gain), server.js mounts a
 * SECOND, purely-additive path prefix, "/api/creative-commerce", over the
 * exact same handler functions already registered under "/api/artistry"
 * (see the "WAVE4 — /api/creative-commerce ALIAS" block in server.js,
 * right after the artistry route registrations).
 *
 * Two independent proofs live in this file:
 *
 *  (A) STRUCTURAL (source-inspection, no server boot — the repo's
 *      established pattern for pinning server.js route registrations,
 *      see tests/route-dedup-verification.test.js). Every currently-
 *      registered "/api/artistry/*" route (dynamically extracted from the
 *      live source, not hand-transcribed, so this stays correct as new
 *      artistry routes are added) still appears EXACTLY ONCE in server.js
 *      — i.e. the alias mount did NOT touch, duplicate, or rewrite any of
 *      the original registrations.
 *
 *  (B) BEHAVIORAL (out-of-process integration — spawns the real server,
 *      the repo's established pattern for exercising raw app.get/post
 *      routes that sit outside the macro system and have no in-process
 *      supertest surface, see tests/storage-parity.test.js and
 *      tests/adversarial-critical-endpoints.test.js). Both prefixes are
 *      hit over real HTTP against the same running process and asserted
 *      to return identical shapes — including a write via one prefix
 *      becoming visible through a read via the OTHER prefix, which proves
 *      they share the same in-memory STATE and therefore the same
 *      handler, not just a coincidentally similar duplicate.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "..", "server.js");

// ─────────────────────────── (A) structural ────────────────────────────

describe("WAVE4 artistry alias — structural (source) parity", () => {
  const src = readFileSync(SERVER_JS, "utf8");

  // Dynamically discover every currently-registered "/api/artistry/*"
  // route straight from source, so this test doesn't rot as routes are
  // added/removed — it always checks the routes that actually exist today.
  const ROUTE_RE = /app\.(get|post|put|patch|delete)\(\s*['"](\/api\/artistry\/[^'"]*)['"]/g;
  const discovered = [];
  let m;
  while ((m = ROUTE_RE.exec(src))) discovered.push([m[1], m[2]]);

  it("discovers a non-trivial number of /api/artistry/* routes to check (sanity floor)", () => {
    // 68 at authoring time; floor of 40 tolerates future additions/removals
    // without this test needing to be bumped for unrelated artistry work.
    assert.ok(discovered.length >= 40, `expected >=40 /api/artistry/* routes, found ${discovered.length}`);
  });

  for (const [method, routePath] of discovered) {
    it(`${method.toUpperCase()} ${routePath} is still registered exactly once (untouched by the alias)`, () => {
      const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`app\\.${method}\\(\\s*["']${escaped}["']`, "g");
      const count = (src.match(re) || []).length;
      assert.equal(count, 1, `expected exactly 1 registration of ${method.toUpperCase()} ${routePath}, found ${count}`);
    });
  }

  it("never registers a literal '/api/creative-commerce/...' route string (the alias is mounted programmatically, not copy-pasted)", () => {
    const literalAliasRe = /app\.(get|post|put|patch|delete)\(\s*['"]\/api\/creative-commerce\//g;
    const hits = src.match(literalAliasRe) || [];
    assert.equal(hits.length, 0, "found a hand-written /api/creative-commerce route literal — the alias must stay a programmatic re-mount of the existing /api/artistry handlers, never a duplicated route body");
  });

  it("the alias-mount block walks the router stack from /api/artistry to /api/creative-commerce, after all artistry routes are registered", () => {
    const mountFnIdx = src.indexOf("function mountArtistryNamespaceAlias(");
    assert.ok(mountFnIdx > 0, "mountArtistryNamespaceAlias helper not found");
    const lastArtistryRouteIdx = src.lastIndexOf("app.get('/api/artistry/stats'");
    assert.ok(lastArtistryRouteIdx > 0, "could not locate the last /api/artistry route registration");
    assert.ok(mountFnIdx > lastArtistryRouteIdx, "alias-mount block must be defined AFTER every /api/artistry/* route is registered, so it can see them on the router stack");

    const callIdx = src.indexOf('mountArtistryNamespaceAlias(app, "/api/artistry", "/api/creative-commerce")');
    assert.ok(callIdx > mountFnIdx, "mountArtistryNamespaceAlias must be invoked with the artistry->creative-commerce prefixes after the function is defined");
  });

  it("publicReadPaths (Gate 1) and _safeReadPaths (Gate 3) both list /api/creative-commerce alongside /api/artistry", () => {
    // Gate 1: GET-bypass allowlist.
    assert.match(src, /"\/api\/studio",\s*"\/api\/artistry",\s*"\/api\/creative-commerce"/);
    // Gate 3: Chicken2 safeReadBypass allowlist.
    assert.match(src, /"\/api\/redis",\s*"\/api\/lenses",\s*"\/api\/studio",\s*"\/api\/artistry",\s*"\/api\/creative-commerce",\s*"\/api\/rbac"/);
  });
});

// ─────────────────────────── (B) behavioral ────────────────────────────

let API_BASE = process.env.API_BASE || "";
let serverProcess = null;
let tmpDir = null;

async function waitForHealth(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => { setTimeout(r, 500); });
  }
  return false;
}

before(async () => {
  if (process.env.API_BASE) {
    API_BASE = process.env.API_BASE;
    const ready = await waitForHealth(180_000);
    if (!ready) throw new Error("External server not reachable within 180 seconds");
    return;
  }

  const serverDir = join(__dirname, "..");
  const port = String(20000 + Math.floor(Math.random() * 20000));
  API_BASE = `http://127.0.0.1:${port}`;

  // Fully isolated persistence so this run never touches the dev DB / state.
  tmpDir = mkdtempSync(join(os.tmpdir(), "artistry-alias-test-"));

  serverProcess = spawn("node", ["server.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: "test",
      AUTH_MODE: "",
      CONCORD_FORCE_LISTEN: "true",
      CONCORD_NO_LISTEN: "false",
      DB_PATH: join(tmpDir, "concord.db"),
      DATA_DIR: join(tmpDir, "data"),
      STATE_PATH: join(tmpDir, "state.json"),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  serverProcess.on("error", (err) => { process.stderr.write(`Server error: ${err.message}\n`); });

  const ready = await waitForHealth(60_000);
  if (!ready) throw new Error("Server failed to start within 60 seconds");
});

// Resource-leak fix (2026-07-25): see tests/adversarial-critical-endpoints.test.js
// for the full root-cause (server.js's gracefulShutdown() sleeps an
// unconditional 10s+ before exiting on SIGTERM; a fire-and-forget kill here
// leaves that full server monolith running as an orphan for 10-15s after
// this file's own tests report done). Await actual exit, SIGKILL fallback.
after(async () => {
  try {
    if (serverProcess && !serverProcess.killed) {
      await new Promise((resolve) => {
        serverProcess.kill("SIGTERM");
        const t = setTimeout(() => { serverProcess.kill("SIGKILL"); resolve(); }, 3000);
        serverProcess.on("exit", () => { clearTimeout(t); resolve(); });
      });
    }
  } catch { /* best-effort */ }
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// POST /api/artistry/assets sits behind the standard authMiddleware (no
// GET-only Gate-1 bypass applies to POST here, and it isn't in the narrow
// explicit POST-bypass list) — same as it always has been, unaffected by
// this alias. Register a throwaway user to get a bearer token for the two
// cross-namespace WRITE-visibility tests below.
let authToken = null;
async function ensureAuthToken() {
  if (authToken) return authToken;
  // username cap is 30 chars — keep the generated handle short.
  const suffix = (Date.now() % 1e8).toString(36);
  const reg = await apiPost("/api/auth/register", {
    username: `aap_${suffix}`,
    email: `alias_probe_${suffix}@test.local`,
    password: "AliasParityTest_12345!",
    dateOfBirth: "1990-01-01",
  });
  assert.ok([200, 201].includes(reg.status), `register failed: ${JSON.stringify(reg.data)}`);
  authToken = reg.data.token;
  assert.ok(authToken, "register did not return a token");
  return authToken;
}

describe("WAVE4 artistry alias — behavioral parity over real HTTP", () => {
  it("GET /api/artistry/asset-types and GET /api/creative-commerce/asset-types return byte-identical bodies", async () => {
    const a = await apiGet("/api/artistry/asset-types");
    const b = await apiGet("/api/creative-commerce/asset-types");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.data, b.data);
  });

  it("GET /api/artistry/genres and GET /api/creative-commerce/genres return byte-identical bodies", async () => {
    const a = await apiGet("/api/artistry/genres");
    const b = await apiGet("/api/creative-commerce/genres");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.data, b.data);
  });

  it("GET /api/artistry/assets and GET /api/creative-commerce/assets return the same shape", async () => {
    const a = await apiGet("/api/artistry/assets");
    const b = await apiGet("/api/creative-commerce/assets");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.data.ok, true);
    assert.equal(b.data.ok, true);
    assert.ok(Array.isArray(a.data.assets));
    assert.ok(Array.isArray(b.data.assets));
    assert.deepEqual(Object.keys(a.data).sort(), Object.keys(b.data).sort());
  });

  it("an asset created via /api/artistry is visible via /api/creative-commerce (same underlying STATE, not a lookalike copy)", async () => {
    const token = await ensureAuthToken();
    const created = await apiPost("/api/artistry/assets", {
      type: "beat", title: "Alias Parity Probe A", ownerId: "alias_test_user",
    }, token);
    assert.equal(created.status, 200);
    assert.equal(created.data.ok, true);
    const assetId = created.data.asset.id;

    const viaAlias = await apiGet(`/api/creative-commerce/assets/${assetId}`);
    assert.equal(viaAlias.status, 200);
    assert.equal(viaAlias.data.ok, true);
    assert.equal(viaAlias.data.asset.id, assetId);
    assert.equal(viaAlias.data.asset.title, "Alias Parity Probe A");

    const viaOriginal = await apiGet(`/api/artistry/assets/${assetId}`);
    assert.deepEqual(viaOriginal.data, viaAlias.data);
  });

  it("an asset created via /api/creative-commerce is visible via /api/artistry (reverse direction — proves the mount is bidirectional-transparent, not a one-way proxy)", async () => {
    const token = await ensureAuthToken();
    const created = await apiPost("/api/creative-commerce/assets", {
      type: "artwork", title: "Alias Parity Probe B", ownerId: "alias_test_user",
    }, token);
    assert.equal(created.status, 200);
    assert.equal(created.data.ok, true);
    const assetId = created.data.asset.id;

    const viaOriginal = await apiGet(`/api/artistry/assets/${assetId}`);
    assert.equal(viaOriginal.status, 200);
    assert.equal(viaOriginal.data.ok, true);
    assert.equal(viaOriginal.data.asset.id, assetId);
    assert.equal(viaOriginal.data.asset.title, "Alias Parity Probe B");
  });

  it("GET /api/artistry/stats and GET /api/creative-commerce/stats report the same aggregate counters (shared state, read back-to-back)", async () => {
    const a = await apiGet("/api/artistry/stats");
    const b = await apiGet("/api/creative-commerce/stats");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.data, b.data);
  });

  it("an unknown /api/artistry/assets/:id 404-shape is mirrored by /api/creative-commerce/assets/:id", async () => {
    const a = await apiGet("/api/artistry/assets/does-not-exist");
    const b = await apiGet("/api/creative-commerce/assets/does-not-exist");
    assert.equal(a.status, b.status);
    assert.deepEqual(a.data, b.data);
  });
});
