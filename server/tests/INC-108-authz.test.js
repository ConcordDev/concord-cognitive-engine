// server/tests/INC-108-authz.test.js
//
// Regression pins for INC-108 — knowledge bequest claim/revoke authz.
//
// Run:
//   cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/INC-108-authz.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

// Disable embeddings so the claim route's reindexUserDTUs() call is a no-op
// and the test stays hermetic / fast. This must run before server.js imports.
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { db, STATE, app } = __TEST__;
// Shared teardown: terminate workers, clear timers, and exit cleanly (see tests/lib/server-clean-exit.js).
registerServerCleanExit(() => __TEST__);

function findRouteHandler(method, path) {
  const router = app._router || app.router;
  const layer = router.stack.find(
    (x) => x.route && x.route.path === path && x.route.methods[method]
  );
  assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);
  // Business handler is last in the route stack (after requireAuth + validate).
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockReq(userId, body = {}) {
  return { user: { id: userId }, body, validated: body };
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function seedUser(userId, email) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, scopes, created_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    userId,
    `user_${userId}`,
    email ?? `${userId}@test.local`,
    "hash",
    "member",
    JSON.stringify(["read", "write"]),
    now
  );
}

function seedBequest(opts) {
  STATE.bequests = STATE.bequests || new Map();
  const bequest = {
    id: opts.id,
    grantorId: opts.grantorId,
    recipientEmail: opts.recipientEmail,
    domains: opts.domains === "all" ? null : (opts.domains || null),
    message: opts.message || "",
    status: opts.status || "active",
    createdAt: new Date().toISOString(),
    claimedAt: null,
    claimedBy: null,
  };
  STATE.bequests.set(bequest.id, bequest);
  return bequest;
}

function seedDtu(opts) {
  STATE.dtus = STATE.dtus || new Map();
  const dtu = {
    id: opts.id,
    ownerId: opts.ownerId,
    domain: opts.domain || "notes",
    scope: opts.scope || "personal",
    title: opts.title || "Test DTU",
    meta: opts.meta || {},
  };
  STATE.dtus.set(dtu.id, dtu);
  return dtu;
}

before(() => {
  // Ensure state maps exist; server.js may not have initialized them.
  STATE.bequests = STATE.bequests || new Map();
  STATE.dtus = STATE.dtus || new Map();
});

beforeEach(() => {
  // Each test gets a clean slate. The DB persists across tests in this process,
  // so remove seeded users. Bequests/DTUs live in STATE and are reset below.
  db.prepare("DELETE FROM users").run();
  STATE.bequests = new Map();
  STATE.dtus = new Map();
});


describe("INC-108 — knowledge bequest claim authz", () => {
  it("non-recipient claim is refused 403 and bequest stays active", async () => {
    seedUser("u1a", "u1a@test.local");
    seedUser("u1b", "u1b@test.local");
    const bequest = seedBequest({
      id: "bq1",
      grantorId: "u1a",
      recipientEmail: "u1a@test.local",
      domains: ["notes"],
    });

    seedDtu({ id: "dtu1", ownerId: "u1a", domain: "notes", scope: "personal" });

    const claim = findRouteHandler("post", "/api/inheritance/claim");
    const res = mockRes();
    await claim(mockReq("u1b", { bequestId: "bq1" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "Not your bequest");
    assert.equal(bequest.status, "active");
    assert.equal(bequest.claimedBy, null);
    assert.equal(
      Array.from(STATE.dtus.values()).filter((d) => d.meta?.bequestId === "bq1").length,
      0,
      "no DTU copy should be created for a non-recipient"
    );
  });

  it("user without a verified email is refused 403", async () => {
    seedUser("u2a", "u2a@test.local");
    seedUser("u2none", "");
    const bequest = seedBequest({
      id: "bq2",
      grantorId: "u2a",
      recipientEmail: "u2a@test.local",
      domains: ["notes"],
    });

    const claim = findRouteHandler("post", "/api/inheritance/claim");
    const res = mockRes();
    await claim(mockReq("u2none", { bequestId: "bq2" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "Not your bequest");
    assert.equal(bequest.status, "active");
  });

  it("anonymous placeholder id is refused 403", async () => {
    seedUser("u3a", "u3a@test.local");
    const bequest = seedBequest({
      id: "bq-anon",
      grantorId: "u3a",
      recipientEmail: "u3a@test.local",
      domains: ["notes"],
    });

    const claim = findRouteHandler("post", "/api/inheritance/claim");
    const res = mockRes();
    await claim(mockReq("anonymous", { bequestId: "bq-anon" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "Not your bequest");
    assert.equal(bequest.status, "active");
  });

  it("recipient claim succeeds 200 and copies only matching grantor DTUs", async () => {
    seedUser("u4a", "u4a@test.local");
    seedUser("u4b", "u4b@test.local");
    const bequest = seedBequest({
      id: "bq3",
      grantorId: "u4a",
      recipientEmail: "u4b@test.local",
      domains: ["notes"],
    });

    seedDtu({ id: "dtu1", ownerId: "u4a", domain: "notes", scope: "personal" });
    seedDtu({ id: "dtu2", ownerId: "u4a", domain: "photos", scope: "personal" });
    seedDtu({ id: "dtu3", ownerId: "u4c", domain: "notes", scope: "personal" });

    const claim = findRouteHandler("post", "/api/inheritance/claim");
    const res = mockRes();
    await claim(mockReq("u4b", { bequestId: "bq3" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.inherited, 1, "only notes DTU owned by grantor");
    assert.equal(bequest.status, "claimed");
    assert.equal(bequest.claimedBy, "u4b");

    const copies = Array.from(STATE.dtus.values()).filter(
      (d) => d.meta?.inheritedFrom === "u4a" && d.meta?.bequestId === "bq3"
    );
    assert.equal(copies.length, 1);
    assert.equal(copies[0].ownerId, "u4b");
    assert.equal(copies[0].scope, "personal");
  });

  it("recipient match is case-insensitive", async () => {
    seedUser("u5a", "Mixed.Case@Example.Local");
    seedUser("u5b", "mixed.case@example.local");
    const bequest = seedBequest({
      id: "bq4",
      grantorId: "u5a",
      recipientEmail: "MIXED.CASE@EXAMPLE.LOCAL",
      domains: [],
    });

    const claim = findRouteHandler("post", "/api/inheritance/claim");
    const res = mockRes();
    await claim(mockReq("u5b", { bequestId: "bq4" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(bequest.status, "claimed");
  });
});

describe("INC-108 — knowledge bequest revoke authz", () => {
  it("revoking an already-claimed bequest is refused 409 and inherited copies stay", async () => {
    seedUser("u6a", "u6a@test.local");
    seedUser("u6b", "u6b@test.local");
    const bequest = seedBequest({
      id: "bq5",
      grantorId: "u6a",
      recipientEmail: "u6b@test.local",
      domains: ["notes"],
      status: "claimed",
    });
    bequest.claimedBy = "u6b";
    bequest.claimedAt = new Date().toISOString();

    seedDtu({ id: "dtu-original", ownerId: "u6a", domain: "notes", scope: "personal" });
    seedDtu({
      id: "dtu-copy",
      ownerId: "u6b",
      domain: "notes",
      scope: "personal",
      meta: { inheritedFrom: "u6a", bequestId: "bq5" },
    });

    const revoke = findRouteHandler("post", "/api/inheritance/revoke");
    const res = mockRes();
    await revoke(mockReq("u6a", { bequestId: "bq5" }), res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "bequest already claimed");
    assert.equal(bequest.status, "claimed");
    assert.ok(STATE.dtus.has("dtu-copy"), "inherited copy must stay with claimant");
  });

  it("non-owner revoke is refused 403", async () => {
    seedUser("u7a", "u7a@test.local");
    seedUser("u7b", "u7b@test.local");
    const bequest = seedBequest({
      id: "bq6",
      grantorId: "u7a",
      recipientEmail: "u7b@test.local",
      domains: [],
    });

    const revoke = findRouteHandler("post", "/api/inheritance/revoke");
    const res = mockRes();
    await revoke(mockReq("u7b", { bequestId: "bq6" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "forbidden");
    assert.equal(bequest.status, "active");
  });

  it("owner can still revoke an active bequest", async () => {
    seedUser("u8a", "u8a@test.local");
    const bequest = seedBequest({
      id: "bq7",
      grantorId: "u8a",
      recipientEmail: "u8b@test.local",
      domains: [],
    });

    const revoke = findRouteHandler("post", "/api/inheritance/revoke");
    const res = mockRes();
    await revoke(mockReq("u8a", { bequestId: "bq7" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(bequest.status, "revoked");
  });

  it("admin-role non-grantor gets 403", async () => {
    seedUser("u9a", "u9a@test.local");
    seedUser("u9admin", "u9admin@test.local");
    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run("admin", "u9admin");
    const bequest = seedBequest({
      id: "bq8",
      grantorId: "u9a",
      recipientEmail: "u9b@test.local",
      domains: [],
    });

    const revoke = findRouteHandler("post", "/api/inheritance/revoke");
    const res = mockRes();
    await revoke(mockReq("u9admin", { bequestId: "bq8" }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "forbidden");
    assert.equal(bequest.status, "active");
  });
});
