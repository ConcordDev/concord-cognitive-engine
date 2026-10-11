/**
 * Repair cortex failure signals.
 *
 * An uncaught macro throw observes once and records pain with
 * avoidance-learning's positional signature. Each Express error handler
 * observes a 500 exactly once. Ten 403/422/429 responses on one route
 * template in the window emit one burst; one does not. logger.error
 * forwards once and does not recurse.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs tests/cortex-failure-signals.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import logger, { setErrorLogObserver } from "../logger.js";
import { getErrorAccumulator } from "../emergent/repair-cortex.js";
import { getPainHistory, recordPain } from "../emergent/avoidance-learning.js";
import { AuthorizationError, NotFoundError, ServerError } from "../lib/errors.js";
import { serverError } from "../lib/http-errors.js";
import { emitFeedEvent } from "../emergent/feed.js";
import {
  _setObserveForTests,
  _setRecordPainForTests,
  errorFingerprint,
  failureSignalStats,
  handleMacroHandlerThrow,
  noteStructuredLog,
  reportHttpFailure,
  reportMacroUncaughtThrow,
  resetFailureSignalsForTests,
  routeTemplate,
} from "../lib/cortex-failure-signals.js";
import {
  createEarlyRouteErrorHandler,
  createLateRouteErrorHandler,
} from "../lib/route-error-handlers.js";

const SECRET = "super-secret-token";
const COOKIE = "session=abc-secret-cookie";
const UUID = "11111111-2222-3333-4444-555555555555";

function mockRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    set() { return this; },
  };
}

function memberReq(id = "req_1") {
  return {
    id,
    method: "GET",
    baseUrl: "/api/members",
    route: { path: "/:id" },
    path: `/api/members/${UUID}`,
    originalUrl: `/api/members/${UUID}?token=${SECRET}`,
    query: { token: SECRET },
    headers: { cookie: COOKIE },
    body: { password: "hunter2" },
    ip: "127.0.0.1",
  };
}

function forwardingLog(logs) {
  return (level, event, data) => {
    logs.push({ level, event, data });
    noteStructuredLog(level, event, data);
  };
}

function earlyHandler(logs, repairCalls = []) {
  return createEarlyRouteErrorHandler({
    structuredLog: forwardingLog(logs),
    repairError: (payload) => {
      repairCalls.push(payload);
      return Promise.resolve({ success: false });
    },
    extractFileFromStack: () => null,
    extractLineFromStack: () => null,
  });
}

function lateHandler(logs, uiJson) {
  return createLateRouteErrorHandler({
    structuredLog: forwardingLog(logs),
    uid: (prefix) => `${prefix}_test`,
    uiJson: uiJson || ((res, out) => res.json(out)),
    withAck: (out) => out,
    version: "1.0.0",
  });
}

describe("cortex failure signals", () => {
  /** @type {{ message: string, stack: string, ctx: string }[]} */
  let calls;

  beforeEach(() => {
    resetFailureSignalsForTests();
    calls = [];
    _setObserveForTests((error, ctx) => {
      calls.push({ message: String(error?.message || ""), stack: String(error?.stack || ""), ctx: String(ctx) });
    });
  });

  it("templates routes and drops ids, query strings, and raw urls", () => {
    const req = memberReq();
    assert.equal(routeTemplate(req), "/api/members/:id");
    assert.equal(routeTemplate({
      path: `/api/members/${UUID}?token=${SECRET}`,
    }), "/api/members/:id");
    assert.equal(routeTemplate(null), "unknown");
    const fp = errorFingerprint(new TypeError("broken"));
    assert.match(fp, /^[0-9a-f]{16}$/);
    assert.notEqual(fp, errorFingerprint(new TypeError("different")));
  });

  it("an uncaught macro throw observes once and records a correctly-shaped pain", () => {
    const name = `listMine_${crypto.randomBytes(4).toString("hex")}`;
    const err = new TypeError("Cannot read properties of undefined (reading 'id')");
    const painArgs = [];
    _setRecordPainForTests((...args) => {
      painArgs.push(args);
      return recordPain(...args);
    });
    const logs = [];
    const envelope = handleMacroHandlerThrow(err, "members", name, forwardingLog(logs));

    assert.deepEqual(envelope, {
      ok: false,
      error: "macro_uncaught_throw",
      message: err.message,
      domain: "members",
      name,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, `macro_uncaught_throw:members.${name}`);
    assert.ok(calls[0].message.includes(`members.${name} TypeError: ${err.message}`));
    assert.match(calls[0].stack, /^[0-9a-f]{16}$/);
    assert.equal(calls[0].stack, calls[0].message.match(/fp=([0-9a-f]{16})/)[1]);
    assert.equal(JSON.stringify(calls[0]).includes("/workspace"), false);

    assert.equal(painArgs.length, 1);
    const [entityId, type, severity, source, context] = painArgs[0];
    assert.equal(entityId, `macro:members.${name}`);
    assert.equal(type, "organ_damage");
    assert.equal(severity, 0.5);
    assert.equal(source, `members.${name}`);
    assert.deepEqual(context, {
      domain: "members",
      name,
      errorClass: "TypeError",
      message: err.message,
      fingerprint: calls[0].stack,
    });

    const history = getPainHistory(entityId, 5);
    assert.equal(history.length, 1);
    assert.equal(history[0].type, "organ_damage");
    assert.equal(history[0].source, `members.${name}`);
    assert.equal(history[0].severity, 0.5);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "warn");
    assert.equal(logs[0].event, "macro_uncaught_throw");
  });

  it("still returns the macro envelope when observe() throws", () => {
    _setObserveForTests(() => { throw new Error("cortex down"); });
    const envelope = handleMacroHandlerThrow(new Error("boom"), "members", "explode", () => {});
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error, "macro_uncaught_throw");
    assert.equal(envelope.message, "boom");
  });

  it("the real observe() accumulator records the macro throw", () => {
    resetFailureSignalsForTests();
    const name = `deliberate_${crypto.randomBytes(4).toString("hex")}`;
    const pain = reportMacroUncaughtThrow(new Error("oracle down"), "council", name);
    assert.equal(pain.ok, true);
    assert.equal(typeof pain.painId, "string");
    const hit = getErrorAccumulator().entries.find((e) => e.context === `macro_uncaught_throw:council.${name}`);
    assert.ok(hit, "observe() stored the macro failure");
    assert.match(hit.message, new RegExp(`council\\.${name} Error: oracle down`));
    assert.match(hit.stack, /^[0-9a-f]{16}/);
  });

  it("a 500 from the early error handler observes exactly once and keeps the response", () => {
    const logs = [];
    const repairs = [];
    const handler = earlyHandler(logs, repairs);
    const req = memberReq("req_early_500");
    const res = mockRes();
    const err = new TypeError("sqlite busy");

    handler(err, req, res, () => {});
    reportHttpFailure(req, null, 500);
    noteStructuredLog("error", "http_request", {
      requestId: req.id,
      statusCode: 500,
      path: req.path,
      query: { token: SECRET },
      userId: "user-1",
      cookie: COOKIE,
      error: "sqlite busy",
    });

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "An unexpected error occurred", code: "INTERNAL_ERROR" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, "http_500:/api/members/:id");
    assert.match(calls[0].message, /500 \/api\/members\/:id TypeError: sqlite busy/);
    assert.match(calls[0].stack, /^[0-9a-f]{16}$/);
    const packed = JSON.stringify(calls);
    assert.equal(packed.includes(SECRET), false);
    assert.equal(packed.includes(COOKIE), false);
    assert.equal(packed.includes(UUID), false);
    assert.equal(packed.includes("hunter2"), false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].event, "unhandled_route_error");
    assert.equal(logs[0].level, "error");
    assert.equal(repairs.length, 1);

    const res2 = mockRes();
    handler(new Error("again"), memberReq("req_early_500b"), res2, () => {});
    assert.equal(res2.statusCode, 500);
    assert.equal(calls.length, 2);
  });

  it("a 500 from the late error handler observes exactly once and keeps the response", () => {
    const logs = [];
    const handler = lateHandler(logs);
    const req = memberReq("req_late_500");
    const res = mockRes();
    handler(new ServerError("sqlite busy"), req, res, () => {});
    reportHttpFailure(req, null, 500);
    noteStructuredLog("error", "request_error", {
      requestId: req.id,
      statusCode: 500,
      path: req.path,
      query: { token: SECRET },
      error: "sqlite busy",
    });

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "sqlite busy", code: "SERVER_ERROR" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, "http_500:/api/members/:id");
    assert.match(calls[0].message, /TypeError|ServerError|Error: sqlite busy/);
    assert.equal(JSON.stringify(calls).includes(SECRET), false);
    assert.equal(JSON.stringify(calls).includes(UUID), false);
    assert.equal(logs.length, 0);
  });

  it("the late handler's 500 fallback observes once when the response send throws", () => {
    const handler = lateHandler([], () => { throw new Error("send failed"); });
    const req = memberReq("req_late_fallback");
    const res = mockRes();
    handler(new Error("explode"), req, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.reply, "Internal error.");
    assert.equal(res.body.meta.version, "1.0.0");
    assert.equal(res.body.meta.errorId, "err_test");
    assert.equal(res.body.meta.sessionId, "default");
    assert.equal(calls.length, 1);
    assert.match(calls[0].message, /explode/);
    assert.equal(calls[0].ctx, "http_500:/api/members/:id");
  });

  it("does not observe when the early handler sends no response", () => {
    const handler = earlyHandler([]);
    const res = mockRes();
    res.headersSent = true;
    handler(new Error("too late"), memberReq("req_sent"), res, () => {});
    assert.equal(calls.length, 0);
    assert.equal(res.body, null);
  });

  it("a thrown observe() does not change the 500 response", () => {
    _setObserveForTests(() => { throw new Error("cortex down"); });
    const handler = earlyHandler([]);
    const res = mockRes();
    handler(new Error("boom"), memberReq("req_throw"), res, () => {});
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "An unexpected error occurred", code: "INTERNAL_ERROR" });
  });

  it("10x 403 on one route emits one burst and 1x does not", () => {
    const handler = earlyHandler([]);
    const route = "/api/members/:id";

    const first = mockRes();
    handler(new AuthorizationError(), memberReq("req_403_1"), first, () => {});
    assert.equal(first.statusCode, 403);
    assert.equal(first.body.code, "FORBIDDEN");
    assert.equal(calls.length, 0);

    for (let i = 2; i <= 9; i++) {
      handler(new AuthorizationError(), memberReq(`req_403_${i}`), mockRes(), () => {});
    }
    assert.equal(calls.length, 0);

    const tenth = mockRes();
    handler(new AuthorizationError(), memberReq("req_403_10"), tenth, () => {});
    assert.equal(tenth.statusCode, 403);
    assert.deepEqual(tenth.body, { ok: false, error: "Insufficient permissions", code: "FORBIDDEN" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, `http_burst_403:${route}`);
    assert.match(calls[0].message, /burst 403 x10 \/api\/members\/:id/);
    assert.equal(JSON.stringify(calls).includes(UUID), false);
    assert.equal(JSON.stringify(calls).includes(SECRET), false);

    handler(new AuthorizationError(), memberReq("req_403_11"), mockRes(), () => {});
    assert.equal(calls.length, 1);

    reportHttpFailure({
      id: "req_billing",
      method: "GET",
      baseUrl: "/api/billing",
      route: { path: "/:id" },
      path: "/api/billing/9",
    }, new AuthorizationError(), 403);
    assert.equal(calls.length, 1);
  });

  it("10x 422 and 10x 429 each emit one burst and 1x does not", () => {
    const req = (id, base) => ({ id, method: "POST", baseUrl: base, route: { path: "/" }, path: base });
    reportHttpFailure(req("u1", "/api/posts"), new Error("unprocessable"), 422);
    assert.equal(calls.length, 0);
    for (let i = 2; i <= 10; i++) {
      reportHttpFailure(req(`u${i}`, "/api/posts"), new Error("unprocessable"), 422);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, "http_burst_422:/api/posts/");

    for (let i = 1; i <= 9; i++) {
      reportHttpFailure(req(`r${i}`, "/api/search"), new Error("slow down"), 429);
    }
    assert.equal(calls.length, 1);
    reportHttpFailure(req("r10", "/api/search"), new Error("slow down"), 429);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].ctx, "http_burst_429:/api/search/");
  });

  it("a 404 is not a burst and not a 5xx observation", () => {
    const handler = lateHandler([]);
    const res = mockRes();
    handler(new NotFoundError("Member", UUID), memberReq("req_404"), res, () => {});
    assert.equal(res.statusCode, 404);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(res.body).includes(SECRET), false);
  });

  it("burst memory stays bounded", () => {
    for (let i = 0; i < 300; i++) {
      reportHttpFailure(
        { id: `b${i}`, method: "GET", baseUrl: "/api", route: { path: `/k${i}/list` }, path: `/api/k${i}/list` },
        null,
        403,
      );
    }
    assert.ok(failureSignalStats().burstKeys <= 256);
    assert.equal(calls.length, 0);
  });

  it("logger.error forwards once and does not recurse", () => {
    logger.error("unit", "disk failed", { error: "ENOSPC", password: "hunter2", cookie: COOKIE });
    assert.equal(calls.length, 1);
    assert.match(calls[0].ctx, /^log:error:/);
    assert.match(calls[0].message, /disk failed/);
    assert.match(calls[0].message, /ENOSPC/);
    const packed = JSON.stringify(calls[0]);
    assert.equal(packed.includes("hunter2"), false);
    assert.equal(packed.includes(COOKIE), false);

    logger.error("unit", "disk failed", { error: "ENOSPC" });
    assert.equal(calls.length, 2);

    let n = 0;
    setErrorLogObserver(() => {
      n += 1;
      logger.error("unit", "reenter", { error: "again" });
    });
    logger.error("unit", "start", { error: "once" });
    assert.equal(n, 1);
  });

  it("fatal logs forward once and observe() cannot re-enter", () => {
    let n = 0;
    _setObserveForTests(() => {
      n += 1;
      noteStructuredLog("error", "from-observe", { error: "loop" });
    });
    noteStructuredLog("fatal", "disk", { error: "ENOSPC" });
    noteStructuredLog("info", "ok", {});
    noteStructuredLog("warn", "ok", {});
    noteStructuredLog("error", "unhandled_route_error", { error: "already reported by the handler" });
    assert.equal(n, 1);
  });

  it("serverError 500 observes once and does not change the response", () => {
    const res = mockRes();
    res.req = memberReq("req_server_error");
    serverError(res, new TypeError("sqlite busy"), 500, "try again");
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, process.env.NODE_ENV === "production" ? "Internal server error" : "sqlite busy");
    assert.equal(res.body.hint, "try again");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx, "http_500:/api/members/:id");
    assert.match(calls[0].message, /TypeError: sqlite busy/);
    assert.equal(JSON.stringify(calls).includes(SECRET), false);
    reportHttpFailure(res.req, null, 500);
    noteStructuredLog("error", "http_500_response", {
      path: res.req.originalUrl,
      query: { token: SECRET },
      message: "sqlite busy",
    });
    assert.equal(calls.length, 1);
  });

  it("a feed DB write failure reaches the structured logger and observe() once", () => {
    const db = {
      open: true,
      prepare() {
        return { run() { throw new Error("readonly database"); } };
      },
    };
    const result = emitFeedEvent({ type: "dream", data: { dream: "secret-dream-text" } }, db, null);
    assert.equal(typeof result.id, "string");
    assert.equal(calls.length, 1);
    assert.match(calls[0].message, /readonly database/);
    assert.equal(JSON.stringify(calls).includes("secret-dream-text"), false);
  });
});
