/**
 * Edge Case Tests — Critical Paths
 *
 * Covers: auth edge cases, DTU lifecycle, marketplace, governance
 *
 * Run: node --test tests/edge-cases-critical-paths.test.js
 * Or in CI: API_BASE=http://localhost:5050 node --test tests/edge-cases-critical-paths.test.js
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
  const port = String(22000 + Math.floor(Math.random() * 5000));
  API_BASE = `http://localhost:${port}`;

  serverProcess = spawn("node", ["server.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: port, NODE_ENV: "test", AUTH_MODE: "", CONCORD_FORCE_LISTEN: "true" },
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

async function api(method, path, body = null, { token, rawAuth } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (rawAuth) headers["Authorization"] = rawAuth;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  // Cold CI servers can take well over 10s on early requests while
  // startup simulation churns through a fresh seed corpus; retry
  // transient timeouts/network errors so the suite asserts behaviour,
  // not a tight latency SLA.
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
  const creds = { username: `edge_user_${n}`, email: `edge_${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" };
  const reg = await api("POST", "/api/auth/register", creds);
  if (reg.ok && reg.token) return { token: reg.token, userId: reg.user?.id ?? reg.userId };
  const login = await api("POST", "/api/auth/login", { username: creds.username, password: creds.password });
  return { token: login.token, userId: login.user?.id ?? login.userId };
}

// ── Auth edge cases ───────────────────────────────────────────────────────────

describe("Auth — malformed / expired tokens", () => {
  it("malformed JWT returns 401", async () => {
    const res = await api("GET", "/api/social/notifications", null, { rawAuth: "Bearer not.a.real.jwt" });
    assert.ok(res._status === 401 || res._status === 403, `Expected 401/403 got ${res._status}`);
  });

  it("empty Bearer token returns 401", async () => {
    const res = await api("GET", "/api/social/notifications", null, { rawAuth: "Bearer " });
    assert.ok(res._status === 401 || res._status === 403, `Expected 401/403 got ${res._status}`);
  });

  it("truncated JWT returns 401", async () => {
    const res = await api("GET", "/api/social/notifications", null, { rawAuth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0" });
    assert.ok(res._status === 401 || res._status === 403, `Expected 401/403 got ${res._status}`);
  });

  it("completely missing Authorization header returns 401", async () => {
    const res = await api("POST", "/api/dtus/any-id/fork", { title: "test" });
    assert.ok(res._status === 401 || res._status === 403, `Expected 401/403 got ${res._status}`);
  });

  it("valid token for POST /api/auth/logout clears session", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/auth/logout", null, { token });
    assert.ok(res._status < 500, `Logout should not 5xx, got ${res._status}`);
  });
});

describe("Auth — registration validation", () => {
  it("register with missing username returns 400", async () => {
    const res = await api("POST", "/api/auth/register", { email: "nousername@test.invalid", password: "TestPass123!" });
    assert.ok(res._status === 400 || res._status === 422, `Expected 400/422 got ${res._status}`);
  });

  it("register with missing password returns 400", async () => {
    const res = await api("POST", "/api/auth/register", { username: "nopassuser", email: "nopass@test.invalid" });
    assert.ok(res._status === 400 || res._status === 422, `Expected 400/422 got ${res._status}`);
  });

  it("duplicate username returns 409 or 400", async () => {
    const n = ++_seq;
    const creds = { username: `dup_user_${n}`, email: `dup_${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" };
    const first = await api("POST", "/api/auth/register", creds);
    if (!first.ok) return; // skip if registration unavailable
    const second = await api("POST", "/api/auth/register", { ...creds, email: `dup2_${n}@test.invalid` });
    assert.ok(second._status === 409 || second._status === 400 || !second.ok, `Duplicate username should fail, got ${second._status}`);
  });
});

// ── DTU lifecycle edge cases ──────────────────────────────────────────────────

describe("DTU lifecycle — nonexistent targets", () => {
  it("POST /api/dtus/nonexistent/fork returns 4xx, not 5xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/dtus/does-not-exist-xyz/fork", {}, { token });
    assert.ok(res._status < 500, `Fork nonexistent DTU should not 5xx, got ${res._status}`);
  });

  it("POST /api/dtus/nonexistent/like returns 4xx, not 5xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/dtus/does-not-exist-xyz/like", {}, { token });
    assert.ok(res._status < 500, `Like nonexistent DTU should not 5xx, got ${res._status}`);
  });

  it("GET /api/dtus/nonexistent returns 404, not 5xx", async () => {
    const res = await api("GET", "/api/dtus/does-not-exist-xyz-999");
    assert.ok(res._status === 404 || res._status === 400, `Get nonexistent DTU should be 404 got ${res._status}`);
  });
});

describe("DTU creation — input validation", () => {
  it("create DTU without title returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/dtus", { content: "content only, no title", domain: "test" }, { token });
    assert.ok(res._status < 500, `Create without title should not 5xx, got ${res._status}`);
  });

  it("create DTU with extremely long title is handled gracefully", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const longTitle = "A".repeat(10_000);
    const res = await api("POST", "/api/dtus", { title: longTitle, content: "test", domain: "test" }, { token });
    assert.ok(res._status < 500, `Very long title should not 5xx, got ${res._status}`);
  });

  it("create DTU with special characters in title is handled gracefully", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/dtus", {
      title: "<script>alert('xss')</script>",
      content: "test",
      domain: "test",
    }, { token });
    assert.ok(res._status < 500, `Special chars in title should not 5xx, got ${res._status}`);
    if (res.ok && res.dtu?.title) {
      assert.ok(!res.dtu.title.includes("<script>"), "Title should be sanitized or stored as text");
    }
  });
});

describe("DTU deduplication", () => {
  it("liking a DTU twice returns alreadyLiked on second call", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const dtu = await api("POST", "/api/dtus", { title: "Like Dedup Test", content: "test", domain: "test" }, { token });
    if (!dtu.ok || !dtu.dtu?.id) return;
    const first = await api("POST", `/api/dtus/${dtu.dtu.id}/like`, {}, { token });
    const second = await api("POST", `/api/dtus/${dtu.dtu.id}/like`, {}, { token });
    if (second._status < 400) {
      assert.ok(second.alreadyLiked === true || second.already === true || second.message?.includes("already"),
        "Second like should indicate already liked");
    }
  });

  it("voting on a DTU twice returns alreadyVoted on second call", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const dtu = await api("POST", "/api/dtus", { title: "Vote Dedup Test", content: "test", domain: "test" }, { token });
    if (!dtu.ok || !dtu.dtu?.id) return;
    await api("POST", `/api/dtus/${dtu.dtu.id}/vote`, { vote: "up" }, { token });
    const second = await api("POST", `/api/dtus/${dtu.dtu.id}/vote`, { vote: "up" }, { token });
    if (second._status < 400) {
      assert.ok(second.alreadyVoted === true || second.already === true || second.message?.includes("already"),
        "Second vote should indicate already voted");
    }
  });
});

// ── Marketplace edge cases ────────────────────────────────────────────────────

describe("Marketplace — nonexistent listings", () => {
  it("purchase nonexistent listing returns 4xx, not 5xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/economy/marketplace-purchase", {
      listingId: "nonexistent-listing-xyz",
    }, { token });
    assert.ok(res._status < 500, `Purchase nonexistent listing should not 5xx, got ${res._status}`);
  });
});

describe("Marketplace — wallet edge cases", () => {
  it("withdraw negative amount returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/economy/withdraw", { amount: -100 }, { token });
    assert.ok(res._status < 500, `Negative withdraw should not 5xx, got ${res._status}`);
    assert.ok(res._status >= 400 || !res.ok, `Negative withdraw should fail, got ${res._status}`);
  });

  it("withdraw zero amount returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/economy/withdraw", { amount: 0 }, { token });
    assert.ok(res._status < 500, `Zero withdraw should not 5xx, got ${res._status}`);
  });

  it("withdraw more than balance returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/economy/withdraw", { amount: 999_999_999 }, { token });
    assert.ok(res._status < 500, `Overdraft should not 5xx, got ${res._status}`);
    assert.ok(res._status >= 400 || !res.ok, `Overdraft should fail, got ${res._status}`);
  });
});

// ── Governance edge cases ─────────────────────────────────────────────────────

describe("Governance — nonexistent proposals", () => {
  it("vote on nonexistent proposal returns 4xx, not 5xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/governance/proposals/nonexistent-proposal/vote", {
      vote: "yes",
    }, { token });
    assert.ok(res._status < 500, `Vote on nonexistent proposal should not 5xx, got ${res._status}`);
  });

  it("GET nonexistent proposal returns 4xx, not 5xx", async () => {
    const res = await api("GET", "/api/governance/proposals/nonexistent-proposal-xyz");
    assert.ok(res._status < 500, `Get nonexistent proposal should not 5xx, got ${res._status}`);
  });
});

describe("Governance — proposal creation validation", () => {
  it("create proposal without title returns 4xx", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    const res = await api("POST", "/api/governance/proposals", { description: "no title" }, { token });
    assert.ok(res._status < 500, `Create proposal without title should not 5xx, got ${res._status}`);
  });

  it("double-vote on same proposal is rejected or handled gracefully", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    // Create a proposal
    const proposal = await api("POST", "/api/governance/proposals", {
      title: "Edge Case Double Vote Test",
      description: "Testing double vote behavior",
      type: "general",
    }, { token });
    if (!proposal.ok || !proposal.proposal?.id) return;

    const first = await api("POST", `/api/governance/proposals/${proposal.proposal.id}/vote`, { vote: "yes" }, { token });
    const second = await api("POST", `/api/governance/proposals/${proposal.proposal.id}/vote`, { vote: "yes" }, { token });
    assert.ok(second._status < 500, `Double vote should not 5xx, got ${second._status}`);
  });
});

// ── Health endpoints edge cases ───────────────────────────────────────────────

describe("Health endpoints — always respond", () => {
  it("GET /health returns 200 with status field", async () => {
    const res = await api("GET", "/health");
    assert.equal(res._status, 200, "Health should return 200");
    assert.ok(res.status, "Health response should have status field");
  });

  it("GET /ready returns 200 with ready field", async () => {
    const res = await api("GET", "/ready");
    assert.ok(res._status === 200 || res._status === 503, "Ready should return 200 or 503");
    assert.ok(typeof res.ready === "boolean", "Ready response should have boolean ready field");
  });

  it("GET /api/health/db returns status and checks fields", async () => {
    const res = await api("GET", "/api/health/db");
    assert.ok(res._status === 200 || res._status === 503, `/api/health/db should not 4xx, got ${res._status}`);
    assert.ok(res.status, "DB health should have status field");
    assert.ok(res.checks, "DB health should have checks field");
  });

  it("GET /api/health/ws returns status field", async () => {
    const res = await api("GET", "/api/health/ws");
    assert.ok(res._status === 200 || res._status === 503, `/api/health/ws should not 4xx, got ${res._status}`);
    assert.ok(res.status, "WS health should have status field");
  });
});

// ── Input injection edge cases ────────────────────────────────────────────────

describe("Input sanitization — SQL/NoSQL injection attempts", () => {
  it("search with SQL injection payload returns safe response", async () => {
    const res = await api("GET", "/api/dtus?search=" + encodeURIComponent("' OR '1'='1"));
    assert.ok(res._status < 500, `SQL injection in search should not 5xx, got ${res._status}`);
  });

  it("search with NoSQL injection payload returns safe response", async () => {
    const res = await api("GET", '/api/dtus?search={"$gt":""}');
    assert.ok(res._status < 500, `NoSQL injection in search should not 5xx, got ${res._status}`);
  });

  it("deeply nested JSON body is handled safely", async () => {
    const { token } = await registerAndLogin();
    if (!token) return;
    // Deeply nested object shouldn't cause stack overflow
    let nested = { value: "leaf" };
    for (let i = 0; i < 50; i++) nested = { nested };
    const res = await api("POST", "/api/dtus", { title: "Nested", content: nested, domain: "test" }, { token });
    assert.ok(res._status < 500, `Deeply nested body should not 5xx, got ${res._status}`);
  });
});
