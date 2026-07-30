/**
 * server/tests/dtu-tier-mutation-authz.test.js
 *
 * Security audit 2026-07-30, follow-on to the 2026-07-27 Aikido triage.
 *
 * Three routes in routes/helpers-extended.js let ANY authenticated caller
 * mutate ANY OTHER user's DTUs, with the "tier" field itself accepted as a
 * raw client-supplied override:
 *
 *  - POST /api/atlas/tiers/promote/:dtuId — requireAuth() only, no ownership
 *    check, `dtu.tier = req.body.tier || "verified"` (arbitrary override).
 *  - POST /api/atlas/tiers/demote/:dtuId — same shape.
 *  - POST /api/dtus/bulk — requireAuth() only, no per-item ownership check;
 *    action:"delete" could destroy any user's DTUs by id, action:"promote"
 *    had the same raw tier override.
 *
 * `dtu.tier` isn't a cosmetic label — dozens of files (the DTU-consolidation
 * pipeline, atlas trust/audit reads, orphan counting) read it as the
 * regular/mega/hyper classification, so an uncontrolled write is a real
 * data-integrity hazard on top of the missing authorization.
 *
 * Fix: both atlas routes are now gated behind the same sovereign-family
 * requireRole(...) used for the SEC-3 RBAC fix, and no longer accept a
 * body-supplied tier override (the endpoint name already declares the
 * direction). /api/dtus/bulk gained a per-item ownership check reusing the
 * exact field convention dtu.delete (server.js) already established
 * (ownerId/createdBy/createdByUser/authorId/source/author, admin-role
 * bypass, permissive only for genuinely unowned legacy DTUs) — plus an
 * admin-only gate specifically on the "promote" action.
 *
 * This test hermetically mounts the real registerHelpersExtendedRoutes with
 * a stub dependency graph (no full server.js boot) and pins the
 * authorization + tier-override behavior directly.
 *
 * Run: node --test server/tests/dtu-tier-mutation-authz.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerHelpersExtendedRoutes from "../routes/helpers-extended.js";

function requireAuth() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
    next();
  };
}

function makeApp(STATE) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    const role = req.get("x-test-user-role");
    if (uid) req.user = { id: uid, role: role || undefined };
    next();
  });

  registerHelpersExtendedRoutes(app, {
    db: null,
    STATE,
    makeCtx: () => ({}),
    runMacro: async () => ({ ok: true }),
    saveStateDebounced: () => {},
    dtusArray: () => [...STATE.dtus.values()],
    uid: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
    requireAuth,
    requireRole,
  });
  return app;
}

async function post(app, path, body, opts = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (opts.userId) headers["x-test-user-id"] = opts.userId;
    if (opts.role) headers["x-test-user-role"] = opts.role;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("POST /api/atlas/tiers/promote|demote/:dtuId — admin-gated, no body override", () => {
  let STATE;
  beforeEach(() => {
    STATE = { dtus: new Map([["d1", { id: "d1", tier: "regular" }]]) };
  });

  it("401s a fully anonymous caller", async () => {
    const app = makeApp(STATE);
    const { status } = await post(app, "/api/atlas/tiers/promote/d1", {});
    assert.equal(status, 401);
  });

  it("403s a real, non-admin authenticated user", async () => {
    const app = makeApp(STATE);
    const { status } = await post(app, "/api/atlas/tiers/promote/d1", {}, { userId: "u1", role: "member" });
    assert.equal(status, 403);
    assert.equal(STATE.dtus.get("d1").tier, "regular", "must not have been mutated");
  });

  it("an admin-role user can promote, and a body tier override is ignored", async () => {
    const app = makeApp(STATE);
    const { status, body } = await post(
      app,
      "/api/atlas/tiers/promote/d1",
      { tier: "totally-made-up-value" },
      { userId: "admin1", role: "admin" }
    );
    assert.equal(status, 200);
    assert.equal(body.newTier, "verified", "promote always sets 'verified', ignoring the body");
    assert.equal(STATE.dtus.get("d1").tier, "verified");
  });

  it("an admin-role user can demote, and a body tier override is ignored", async () => {
    STATE.dtus.set("d1", { id: "d1", tier: "verified" });
    const app = makeApp(STATE);
    const { status, body } = await post(
      app,
      "/api/atlas/tiers/demote/d1",
      { tier: "totally-made-up-value" },
      { userId: "admin1", role: "sovereign" }
    );
    assert.equal(status, 200);
    assert.equal(body.newTier, "regular");
  });
});

describe("POST /api/dtus/bulk — per-item ownership + admin-only promote", () => {
  let STATE;
  beforeEach(() => {
    STATE = {
      dtus: new Map([
        ["mine", { id: "mine", tier: "regular", ownerId: "u1", tags: [] }],
        ["theirs", { id: "theirs", tier: "regular", ownerId: "u2", tags: [] }],
        ["unowned", { id: "unowned", tier: "regular", tags: [] }],
      ]),
    };
  });

  it("a user can tag/delete their OWN DTU", async () => {
    const app = makeApp(STATE);
    const { status, body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "delete", ids: ["mine"] },
      { userId: "u1", role: "member" }
    );
    assert.equal(status, 200);
    assert.equal(body.results[0].ok, true);
    assert.equal(STATE.dtus.has("mine"), false);
  });

  it("a user CANNOT delete another user's DTU", async () => {
    const app = makeApp(STATE);
    const { body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "delete", ids: ["theirs"] },
      { userId: "u1", role: "member" }
    );
    assert.equal(body.results[0].ok, false);
    assert.match(body.results[0].error, /unauthorized/);
    assert.equal(STATE.dtus.has("theirs"), true, "must survive — never deleted");
  });

  it("a user CAN act on a genuinely unowned (legacy/system) DTU", async () => {
    const app = makeApp(STATE);
    const { body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "tag", ids: ["unowned"], data: { tags: ["x"] } },
      { userId: "u1", role: "member" }
    );
    assert.equal(body.results[0].ok, true);
    assert.deepEqual(STATE.dtus.get("unowned").tags, ["x"]);
  });

  it("promote is admin-only even on the caller's OWN DTU", async () => {
    const app = makeApp(STATE);
    const { body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "promote", ids: ["mine"], data: { tier: "whatever-i-want" } },
      { userId: "u1", role: "member" }
    );
    assert.equal(body.results[0].ok, false);
    assert.match(body.results[0].error, /admin/);
    assert.equal(STATE.dtus.get("mine").tier, "regular");
  });

  it("promote by an admin always sets 'verified', ignoring the body override", async () => {
    const app = makeApp(STATE);
    const { body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "promote", ids: ["theirs"], data: { tier: "whatever-i-want" } },
      { userId: "admin1", role: "owner" }
    );
    assert.equal(body.results[0].ok, true);
    assert.equal(STATE.dtus.get("theirs").tier, "verified");
  });

  it("mixed batch: own DTU succeeds, another user's DTU in the same batch is rejected", async () => {
    const app = makeApp(STATE);
    const { body } = await post(
      app,
      "/api/dtus/bulk",
      { action: "delete", ids: ["mine", "theirs"] },
      { userId: "u1", role: "member" }
    );
    const byId = Object.fromEntries(body.results.map((r) => [r.id, r.ok]));
    assert.equal(byId.mine, true);
    assert.equal(byId.theirs, false);
    assert.equal(STATE.dtus.has("theirs"), true);
  });
});
