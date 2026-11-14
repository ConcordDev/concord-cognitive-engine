// FIX-affect-002 — the ATS write routes act only on the caller's own session.
//
// The affect lens opens on the shared "default" session, and the write
// routes took the session id from the request body: any signed-in member
// was offered — and could fire — Reset / Cooldown / Emit against shared
// state or another user's session. The handlers now resolve the target
// through the caller's derived session (req._atsSessionId, which the ATS
// middleware sets to user_<id> for a signed-in caller): a write naming
// any other session is refused 403 unless the caller is an operator
// (admin / sovereign). The FE mirrors the same rule when it decides
// whether to render the controls at all.
//
// Handlers are invoked directly off the real app's route table (the
// INC-108 pattern) with the exact req shape auth + the ATS middleware
// produce.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/affect-session-ownership.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { app } = __TEST__;
registerServerCleanExit(() => __TEST__);

function findRouteHandler(method, path) {
  const router = app._router || app.router;
  const layer = router.stack.find(
    (x) => x.route && x.route.path === path && x.route.methods[method]
  );
  assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const resetHandler = findRouteHandler("post", "/api/affect/reset");
const eventHandler = findRouteHandler("post", "/api/affect/event");

// req as the middleware leaves it: req.user from auth, req._atsSessionId
// derived from that same identity.
function mockReq({ userId, role, body }) {
  return {
    user: userId ? { id: userId, role } : null,
    _atsSessionId: userId ? `user_${userId}` : "anon_0123456789abcdef",
    body,
    headers: {},
    ip: "127.0.0.1",
  };
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function call(handler, reqOpts) {
  const res = mockRes();
  handler(mockReq(reqOpts), res);
  return res;
}

const MEMBER = { userId: "ats-owner-a", role: "member" };
const EVENT = { type: "USER_MESSAGE", intensity: 0.5, polarity: 0.25 };

describe("POST /api/affect/reset — session ownership (FIX-affect-002)", () => {
  it("a member cannot reset the shared default session", () => {
    const res = call(resetHandler, { ...MEMBER, body: { sessionId: "default" } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  });

  it("a member cannot reset another user's session", () => {
    const res = call(resetHandler, { ...MEMBER, body: { sessionId: "user_ats-owner-b" } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  });

  it("a member can reset their own session, named or implied", () => {
    const named = call(resetHandler, { ...MEMBER, body: { sessionId: "user_ats-owner-a" } });
    assert.equal(named.statusCode, 200);
    assert.equal(named.body.ok, true);
    const implied = call(resetHandler, { ...MEMBER, body: {} });
    assert.equal(implied.statusCode, 200);
    assert.equal(implied.body.ok, true);
  });

  it("an operator can reset the shared session", () => {
    const admin = call(resetHandler, { userId: "ats-op", role: "admin", body: { sessionId: "default" } });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.body.ok, true);
    const sovereign = call(resetHandler, { userId: "ats-sov", role: "sovereign", body: { sessionId: "user_ats-owner-b" } });
    assert.equal(sovereign.statusCode, 200);
    assert.equal(sovereign.body.ok, true);
  });
});

describe("POST /api/affect/event — session ownership (FIX-affect-002)", () => {
  it("a member cannot emit into the shared default session", () => {
    const res = call(eventHandler, { ...MEMBER, body: { ...EVENT, source: { sessionId: "default" } } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  });

  it("a member cannot emit into another user's session via body.sessionId", () => {
    const res = call(eventHandler, { ...MEMBER, body: { ...EVENT, sessionId: "user_ats-owner-b" } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  });

  it("a member can emit into their own session", () => {
    const res = call(eventHandler, { ...MEMBER, body: { ...EVENT, source: { sessionId: "user_ats-owner-a" } } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});
