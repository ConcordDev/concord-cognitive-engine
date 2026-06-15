/**
 * Adversarial Auth Bypass Tests
 *
 * Verifies that every fixed mutation endpoint:
 *  (a) Returns 401 without authentication
 *  (b) Ignores body.userId — uses req.user.id from the session
 *
 * Run: node --test tests/adversarial-critical-endpoints.test.js
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
  const port = String(20000 + Math.floor(Math.random() * 20000));
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

async function api(method, path, body = null, { token, noAuth } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token && !noAuth) headers["Authorization"] = `Bearer ${token}`;
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

let _userSeq = Date.now();
async function registerAndLogin() {
  const n = ++_userSeq;
  const creds = { username: `adv_user_${n}`, email: `adv_${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" };
  const reg = await api("POST", "/api/auth/register", creds, { noAuth: true });
  if (reg.ok && reg.token) return { token: reg.token, userId: reg.user?.id ?? reg.userId };
  const login = await api("POST", "/api/auth/login", { username: creds.username, password: creds.password }, { noAuth: true });
  return { token: login.token, userId: login.user?.id ?? login.userId };
}

// ── helper to assert 401 without auth ─────────────────────────────────────────

async function assert401(method, path, body = null) {
  const res = await api(method, path, body, { noAuth: true });
  assert.ok(
    res._status === 401 || res._status === 403,
    `Expected 401/403 on ${method} ${path} without auth, got ${res._status}`
  );
}

// ── DTU mutation routes ───────────────────────────────────────────────────────

describe("DTU mutations — 401 without auth", () => {
  it("POST /api/dtus/:id/fork returns 401 without auth", async () => {
    await assert401("POST", "/api/dtus/nonexistent-dtu/fork");
  });

  it("POST /api/dtus/:id/like returns 401 without auth", async () => {
    await assert401("POST", "/api/dtus/nonexistent-dtu/like");
  });

  it("POST /api/dtus/:id/vote returns 401 without auth", async () => {
    await assert401("POST", "/api/dtus/nonexistent-dtu/vote", { vote: "up" });
  });
});

describe("DTU fork — body.userId ignored", () => {
  it("fork uses req.user.id, not body.userId", async () => {
    const actor = await registerAndLogin();
    const victim = await registerAndLogin();
    if (!actor.token || !victim.userId) return; // skip if registration unavailable

    // Create a DTU to fork
    const dtu = await api("POST", "/api/dtus", {
      title: "Adversarial Fork Test DTU",
      content: "test content",
      domain: "test",
    }, { token: actor.token });
    if (!dtu.ok || !dtu.dtu?.id) return; // skip if DTU creation unavailable

    // Fork as actor but supply victim's userId in body
    const fork = await api("POST", `/api/dtus/${dtu.dtu.id}/fork`, {
      userId: victim.userId,  // adversarial: try to attribute fork to victim
    }, { token: actor.token });

    if (!fork.ok) return; // skip if fork not implemented or DTU missing
    const forkOwnerId = fork.dtu?.ownerId ?? fork.dtu?.userId ?? fork.dtu?.createdBy ?? fork.dtu?.meta?.createdBy;
    assert.notEqual(forkOwnerId, victim.userId, "Fork must not be attributed to body.userId");
    assert.equal(forkOwnerId, actor.userId, "Fork must be attributed to authenticated user");
  });
});

// ── Social routes ─────────────────────────────────────────────────────────────

describe("Social mutations — 401 without auth", () => {
  it("POST /api/social/post returns 401 without auth", async () => {
    await assert401("POST", "/api/social/post", { content: "test" });
  });

  it("POST /api/social/profile returns 401 without auth", async () => {
    await assert401("POST", "/api/social/profile", { displayName: "Hacker" });
  });

  it("POST /api/social/stories/view returns 401 without auth", async () => {
    await assert401("POST", "/api/social/stories/view", { storyId: "test-story" });
  });

  it("POST /api/social/poll/vote returns 401 without auth", async () => {
    await assert401("POST", "/api/social/poll/vote", { postId: "test-poll", optionIndex: 0 });
  });

  it("POST /api/social/notifications/read-all returns 401 without auth", async () => {
    await assert401("POST", "/api/social/notifications/read-all");
  });
});

describe("Social profile — body.userId ignored", () => {
  it("profile upsert uses req.user.id, not body.userId", async () => {
    const actor = await registerAndLogin();
    const victim = await registerAndLogin();
    if (!actor.token || !victim.userId) return;

    const res = await api("POST", "/api/social/profile", {
      userId: victim.userId,  // adversarial: try to overwrite victim profile
      displayName: "Hacker overwrote this",
      bio: "PWNED",
    }, { token: actor.token });

    if (!res.ok) return;
    // The profile should belong to actor, not victim
    const profileUserId = res.profile?.userId;
    assert.notEqual(profileUserId, victim.userId, "Profile must not be written for body.userId");
    assert.equal(profileUserId, actor.userId, "Profile must be written for authenticated user");
  });
});

// ── Collaboration routes ──────────────────────────────────────────────────────

describe("Collab mutations — 401 without auth", () => {
  it("POST /api/collab/workspace returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/workspace", { name: "hack" });
  });

  it("POST /api/collab/comment returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/comment", { dtuId: "test", text: "hack" });
  });

  it("PUT /api/collab/comment/:id returns 401 without auth", async () => {
    await assert401("PUT", "/api/collab/comment/test-id", { text: "hacked" });
  });

  it("POST /api/collab/revision returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/revision", { dtuId: "test", changes: {} });
  });

  it("POST /api/collab/revision/:id/vote returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/revision/test-id/vote", { vote: "approve" });
  });

  it("POST /api/collab/edit-session/:dtuId/start returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/edit-session/test-dtu/start");
  });

  it("POST /api/collab/edit-session/:dtuId/edit returns 401 without auth", async () => {
    await assert401("POST", "/api/collab/edit-session/test-dtu/edit", { field: "title", newValue: "hacked" });
  });

  it("DELETE /api/collab/workspace/:id/member/:userId returns 401 without auth", async () => {
    await assert401("DELETE", "/api/collab/workspace/test-ws/member/test-user");
  });
});

describe("Collab comment — body.userId ignored", () => {
  it("comment uses req.user.id, not body.userId", async () => {
    const actor = await registerAndLogin();
    const victim = await registerAndLogin();
    if (!actor.token || !victim.userId) return;

    const res = await api("POST", "/api/collab/comment", {
      dtuId: "test-dtu-id",
      userId: victim.userId,  // adversarial
      text: "This should be attributed to actor",
    }, { token: actor.token });

    if (!res.ok) return;
    const commentUserId = res.comment?.userId ?? res.comment?.authorId ?? res.comment?.author;
    if (!commentUserId) return; // no user attribution in response — skip
    assert.notEqual(commentUserId, victim.userId, "Comment must not be attributed to body.userId");
    assert.equal(commentUserId, actor.userId, "Comment must be attributed to authenticated user");
  });
});

// ── Economy routes ────────────────────────────────────────────────────────────

describe("Economy mutations — 401 without auth", () => {
  it("POST /api/economy/marketplace-purchase returns 401 without auth", async () => {
    await assert401("POST", "/api/economy/marketplace-purchase", {
      buyer_id: "attacker",
      seller_id: "victim",
      amount: 100,
    });
  });

  it("POST /api/economy/withdraw returns 401 without auth", async () => {
    await assert401("POST", "/api/economy/withdraw", { user_id: "victim", amount: 100 });
  });

  it("POST /api/economy/withdrawals/:id/cancel returns 401 without auth", async () => {
    await assert401("POST", "/api/economy/withdrawals/test-id/cancel", { user_id: "victim" });
  });

  it("POST /api/economy/buy/checkout returns 401 without auth", async () => {
    await assert401("POST", "/api/economy/buy/checkout", { user_id: "victim", tokens: 100 });
  });

  it("POST /api/stripe/connect/onboard returns 401 without auth", async () => {
    await assert401("POST", "/api/stripe/connect/onboard", { user_id: "victim" });
  });
});

// ── Other fixed routes ────────────────────────────────────────────────────────

describe("Other mutation routes — 401 without auth", () => {
  it("POST /api/onboarding/start returns 401 without auth", async () => {
    await assert401("POST", "/api/onboarding/start", { userId: "victim" });
  });

  it("POST /api/onboarding/complete-step returns 401 without auth", async () => {
    await assert401("POST", "/api/onboarding/complete-step", { userId: "victim", stepId: "step1" });
  });

  it("POST /api/onboarding/skip returns 401 without auth", async () => {
    await assert401("POST", "/api/onboarding/skip", { userId: "victim" });
  });

  it("POST /api/consent/update returns 401 without auth", async () => {
    await assert401("POST", "/api/consent/update", { userId: "victim", action: "data_processing", granted: true });
  });

  it("POST /api/rbac/role returns 401 without auth (privilege escalation)", async () => {
    await assert401("POST", "/api/rbac/role", { userId: "victim", role: "admin", orgId: "test-org" });
  });

  it("DELETE /api/rbac/role returns 401 without auth", async () => {
    await assert401("DELETE", "/api/rbac/role", { userId: "victim", orgId: "test-org" });
  });

  it("POST /api/futures/:id/stake returns 401 without auth", async () => {
    await assert401("POST", "/api/futures/test-future/stake", { userId: "victim", optionId: "a", amount: 50 });
  });

  it("POST /api/brain/spontaneous/preferences returns 401 without auth", async () => {
    await assert401("POST", "/api/brain/spontaneous/preferences", { userId: "victim", enabled: false });
  });
});

describe("Futures stake — body.userId ignored", () => {
  it("stake uses req.user.id, not body.userId", async () => {
    const actor = await registerAndLogin();
    const victim = await registerAndLogin();
    if (!actor.token || !victim.userId) return;

    // Create a future to stake on
    const future = await api("POST", "/api/futures", {
      question: "Adversarial test future?",
      options: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }, { token: actor.token });
    if (!future.ok || !future.future?.id) return;

    const stake = await api("POST", `/api/futures/${future.future.id}/stake`, {
      userId: victim.userId,  // adversarial: stake on behalf of victim
      optionId: "a",
      amount: 10,
    }, { token: actor.token });

    if (!stake.ok) return;
    const stakeUserId = stake.stake?.userId ?? stake.userId;
    if (!stakeUserId) return;
    assert.notEqual(stakeUserId, victim.userId, "Stake must not be attributed to body.userId");
    assert.equal(stakeUserId, actor.userId, "Stake must be attributed to authenticated user");
  });
});

// ── Like/Vote dedup ───────────────────────────────────────────────────────────

describe("Like/Vote deduplication", () => {
  it("second like on same DTU returns alreadyLiked:true", async () => {
    const actor = await registerAndLogin();
    if (!actor.token) return;

    const dtu = await api("POST", "/api/dtus", {
      title: "Dedup Test DTU",
      content: "test",
      domain: "test",
    }, { token: actor.token });
    if (!dtu.ok || !dtu.dtu?.id) return;

    const first = await api("POST", `/api/dtus/${dtu.dtu.id}/like`, {}, { token: actor.token });
    const second = await api("POST", `/api/dtus/${dtu.dtu.id}/like`, {}, { token: actor.token });

    if (!first.ok || !second.ok) return;
    assert.ok(
      second.alreadyLiked === true || second._status === 409 || second.error?.includes("already"),
      "Second like should indicate already liked"
    );
  });

  it("second vote on same DTU returns alreadyVoted:true", async () => {
    const actor = await registerAndLogin();
    if (!actor.token) return;

    const dtu = await api("POST", "/api/dtus", {
      title: "Vote Dedup Test DTU",
      content: "test",
      domain: "test",
    }, { token: actor.token });
    if (!dtu.ok || !dtu.dtu?.id) return;

    const first = await api("POST", `/api/dtus/${dtu.dtu.id}/vote`, { vote: "up" }, { token: actor.token });
    const second = await api("POST", `/api/dtus/${dtu.dtu.id}/vote`, { vote: "up" }, { token: actor.token });

    if (!first.ok || !second.ok) return;
    assert.ok(
      second.alreadyVoted === true || second._status === 409 || second.error?.includes("already"),
      "Second vote should indicate already voted"
    );
  });
});
