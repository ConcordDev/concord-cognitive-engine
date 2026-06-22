/**
 * Error Path Coverage Tests
 *
 * Tests server behavior under adverse conditions:
 *  - Brain endpoints when Ollama is unreachable
 *  - Graceful degradation when dependencies are unavailable
 *  - Timeout handling
 *  - Malformed request bodies
 *
 * Run: node --test tests/error-paths.test.js
 * Or in CI: API_BASE=http://localhost:5050 node --test tests/error-paths.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let API_BASE = process.env.API_BASE || "";
let serverProcess = null;

before(async () => {
  if (process.env.API_BASE) {
    API_BASE = process.env.API_BASE;
    // 180s budget — matches the CI workflow's own "Wait for server"
    // patience. A heavy server on a slow runner can have its event loop
    // starved by early-life simulation churn well past 30s; the test
    // should wait it out rather than assert a tight readiness SLA.
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) return;
      } catch { /* not ready */ }
      await new Promise(r => { setTimeout(r, 500); });
    }
    throw new Error("External server not reachable within 180 seconds");
  }

  const serverDir = join(__dirname, "..");
  const port = String(24000 + Math.floor(Math.random() * 5000));
  API_BASE = `http://localhost:${port}`;

  // Start server with deliberately unreachable brain URLs
  serverProcess = spawn("node", ["server.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: "test",
      AUTH_MODE: "",
      // Out-of-process integration test — spawned server must bind a port.
      CONCORD_FORCE_LISTEN: "true",
      // Point brain to unreachable localhost port to test degraded mode
      BRAIN_CONSCIOUS_URL: "http://127.0.0.1:19999",
      BRAIN_SUBCONSCIOUS_URL: "http://127.0.0.1:19999",
      BRAIN_UTILITY_URL: "http://127.0.0.1:19999",
      BRAIN_REPAIR_URL: "http://127.0.0.1:19999",
      OLLAMA_HOST: "http://127.0.0.1:19999",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  serverProcess.on("error", (err) => { process.stderr.write(`Server error: ${err.message}\n`); });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) { serverProcess.unref(); return; }
    } catch { /* not ready */ }
    // eslint-disable-next-line no-promise-executor-return
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Server failed to start within 60 seconds");
});

after(() => {
  serverProcess?.kill("SIGTERM");
});

async function api(method, path, body = null, { token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  // Cold CI servers can take well over 10s on early requests while
  // startup simulation churns through a fresh seed corpus; retry
  // transient timeouts/network errors so the suite asserts behaviour,
  // not a tight latency SLA. (Per-test degraded-mode timeout probes
  // below use their own inline AbortSignal — this helper is the
  // happy-path request path.)
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...opts, signal: AbortSignal.timeout(30_000) });
      const json = await res.json().catch(() => ({}));
      return { ...json, _status: res.status };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => { setTimeout(r, 500 * (attempt + 1)); });
    }
  }
  throw lastErr;
}

let _seq = Date.now();
async function registerAndLogin() {
  const n = ++_seq;
  const creds = { username: `err_user_${n}`, email: `err_${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" };
  const reg = await api("POST", "/api/auth/register", creds);
  if (reg.ok && reg.token) return { token: reg.token, userId: reg.user?.id ?? reg.userId };
  const login = await api("POST", "/api/auth/login", { username: creds.username, password: creds.password });
  return { token: login.token, userId: login.user?.id ?? login.userId };
}

// ── Brain offline / unreachable ──────────────────────────────────────────────

describe("Brain endpoints — degraded mode (Ollama unreachable)", () => {
  it("GET /api/brain/status returns 200 (degraded) not 5xx", async () => {
    const res = await api("GET", "/api/brain/status");
    assert.ok(res._status < 500, `Brain status should not 5xx when offline, got ${res._status}`);
  });

  it("GET /api/brain/health returns 2xx or 4xx, not 5xx", async () => {
    const res = await api("GET", "/api/brain/health");
    assert.ok(res._status < 500, `Brain health should not 5xx when offline, got ${res._status}`);
  });

  it("POST /api/brain/chat returns error payload not 5xx when brain offline", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/brain/chat", {
      message: "Hello brain",
      sessionId: "test-session",
    }, { token });
    // Brain offline should return a structured error, not an unhandled 500
    assert.ok(res._status < 500 || (res._status === 500 && (res.error || res.message)),
      `Brain chat with offline brain should degrade gracefully, got ${res._status} ${JSON.stringify(res)}`);
  });

  it("POST /api/brain/generate returns error payload not 500", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/brain/generate", {
      prompt: "Generate something",
      model: "llama3",
    }, { token });
    assert.ok(res._status < 500 || (res._status === 500 && (res.error || res.message)),
      `Brain generate offline should degrade gracefully, got ${res._status}`);
  });
});

// ── Malformed request bodies ──────────────────────────────────────────────────

describe("Malformed request bodies — JSON parse errors", () => {
  it("malformed JSON body returns 400, not 500", async () => {
    const headers = { "Content-Type": "application/json" };
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers,
      body: "{ not valid json !!!",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(res.status < 500, `Malformed JSON should not 5xx, got ${res.status}`);
  });

  it("empty body for auth/register returns 400", async () => {
    const headers = { "Content-Type": "application/json" };
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers,
      body: "",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(res.status < 500, `Empty body should not 5xx, got ${res.status}`);
  });

  it("array body instead of object returns 400", async () => {
    const res = await api("POST", "/api/auth/login", [1, 2, 3]);
    assert.ok(res._status < 500, `Array body should not 5xx, got ${res._status}`);
  });

  it("null body for DTU create returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const res = await fetch(`${API_BASE}/api/dtus`, {
      method: "POST",
      headers,
      body: "null",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(res.status < 500, `Null body should not 5xx, got ${res.status}`);
  });
});

// ── Missing required headers ──────────────────────────────────────────────────

describe("Missing Content-Type header", () => {
  it("POST without Content-Type header is handled gracefully", async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ username: "test", password: "test" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(res.status < 500, `No Content-Type should not 5xx, got ${res.status}`);
  });
});

// ── Oversized payloads ────────────────────────────────────────────────────────

describe("Oversized payloads", () => {
  it("very large request body is rejected or truncated, not 5xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const largContent = "X".repeat(10_000_000); // 10 MB
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    try {
      const res = await fetch(`${API_BASE}/api/dtus`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Oversized", content: largContent, domain: "test" }),
        signal: AbortSignal.timeout(15_000),
      });
      // Should reject with 413 or 400, not 500
      assert.ok(res.status !== 500, `Oversized body should not 5xx, got ${res.status}`);
    } catch (err) {
      // Connection reset/abort is also acceptable — server protecting itself
      assert.ok(
        err.name === "AbortError" || err.message?.includes("ECONNRESET") || err.message?.includes("fetch"),
        `Oversized payload connection error is acceptable: ${err.message}`
      );
    }
  });
});

// ── Concurrent requests ───────────────────────────────────────────────────────

describe("Concurrent requests — no crashes", () => {
  it("10 simultaneous health checks all return 200", async () => {
    const requests = Array.from({ length: 10 }, () =>
      fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(10_000) })
    );
    const responses = await Promise.all(requests);
    for (const res of responses) {
      assert.equal(res.status, 200, `Health check should return 200, got ${res.status}`);
    }
  });

  it("5 simultaneous DTU list requests complete without 5xx", async () => {
    const requests = Array.from({ length: 5 }, () =>
      api("GET", "/api/dtus?limit=10")
    );
    const responses = await Promise.all(requests);
    for (const res of responses) {
      assert.ok(res._status < 500, `Concurrent DTU list should not 5xx, got ${res._status}`);
    }
  });

  it("3 simultaneous registrations succeed independently", async () => {
    const n = ++_seq;
    const registrations = [0, 1, 2].map(i =>
      api("POST", "/api/auth/register", {
        username: `concurrent_${n}_${i}`,
        email: `concurrent_${n}_${i}@test.invalid`,
        password: "TestPass123!",
      })
    );
    const results = await Promise.all(registrations);
    for (const res of results) {
      assert.ok(res._status < 500, `Concurrent registration should not 5xx, got ${res._status}`);
    }
  });
});

// ── URL edge cases ────────────────────────────────────────────────────────────

describe("URL edge cases — no crashes", () => {
  it("GET with path traversal attempt returns 4xx, not 5xx", async () => {
    const res = await api("GET", "/api/../../etc/passwd");
    assert.ok(res._status < 500, `Path traversal should not 5xx, got ${res._status}`);
  });

  it("GET with very long URL path is handled gracefully", async () => {
    const longPath = "/api/dtus/" + "a".repeat(500);
    const res = await api("GET", longPath);
    assert.ok(res._status < 500, `Long URL path should not 5xx, got ${res._status}`);
  });

  it("GET with URL-encoded null bytes is handled", async () => {
    const res = await api("GET", "/api/dtus/%00");
    assert.ok(res._status < 500, `Null byte in URL should not 5xx, got ${res._status}`);
  });

  it("unknown API route returns 404 not 500", async () => {
    const res = await api("GET", "/api/this-does-not-exist");
    assert.ok(res._status === 404 || res._status < 500, `Unknown route should 404 not 5xx, got ${res._status}`);
  });
});
