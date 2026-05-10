/**
 * http-errors helper contract.
 *
 * The point of serverError() is that error messages do NOT leak in
 * production. Locks the contract so a future refactor can't silently
 * regress to plain `e.message` exposure.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { serverError, clientError, configureHttpErrorLogger } from "../lib/http-errors.js";

function fakeRes() {
  const calls = { status: null, json: null };
  return {
    req: { originalUrl: "/api/x", method: "POST" },
    status(code) { calls.status = code; return this; },
    json(body) { calls.json = body; return this; },
    _calls: calls,
  };
}

describe("serverError — production redacts the message", () => {
  let origNodeEnv;
  let logs;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    logs = [];
    configureHttpErrorLogger((level, event, payload) => logs.push({ level, event, payload }));
  });

  afterEach(() => {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    configureHttpErrorLogger(null);
  });

  it("returns 'Internal server error' as the wire message", () => {
    const res = fakeRes();
    serverError(res, new Error("SELECT users.password FROM users LIMIT 1"));
    assert.equal(res._calls.status, 500);
    assert.equal(res._calls.json.error, "Internal server error");
    assert.equal(res._calls.json.stack, undefined, "stack must NOT leak in prod");
  });

  it("logs the real internal message server-side", () => {
    const res = fakeRes();
    serverError(res, new Error("disk full at /var/lib/sqlite/concord.db"));
    const logged = logs.find((l) => l.event === "http_500_response");
    assert.ok(logged, "must log the http_500_response event");
    assert.match(logged.payload.message, /disk full at/);
    assert.equal(logged.payload.path, "/api/x");
    assert.equal(logged.payload.method, "POST");
  });

  it("surfaces 'hint' in the response body — hints are always safe", () => {
    const res = fakeRes();
    serverError(res, new Error("internal"), 503, "ollama unavailable");
    assert.equal(res._calls.json.hint, "ollama unavailable");
    assert.equal(res._calls.json.error, "Internal server error");
  });

  it("respects the statusCode argument", () => {
    const res = fakeRes();
    serverError(res, new Error("x"), 502);
    assert.equal(res._calls.status, 502);
  });
});

describe("serverError — dev/test surfaces the message + stack", () => {
  let origNodeEnv;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    configureHttpErrorLogger(() => {}); // suppress noise
  });

  afterEach(() => {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    configureHttpErrorLogger(null);
  });

  it("returns the real e.message", () => {
    const res = fakeRes();
    serverError(res, new Error("real-error-text"));
    assert.equal(res._calls.json.error, "real-error-text");
  });

  it("returns the stack", () => {
    const res = fakeRes();
    serverError(res, new Error("with-stack"));
    assert.ok(typeof res._calls.json.stack === "string");
    assert.match(res._calls.json.stack, /with-stack/);
  });

  it("handles a non-Error thrown value", () => {
    const res = fakeRes();
    serverError(res, "string-only error");
    assert.equal(res._calls.json.error, "string-only error");
  });
});

describe("clientError — always surfaces the message", () => {
  it("defaults to 400", () => {
    const res = fakeRes();
    clientError(res, "missing field");
    assert.equal(res._calls.status, 400);
    assert.equal(res._calls.json.error, "missing field");
  });

  it("respects custom statusCode", () => {
    const res = fakeRes();
    clientError(res, "not found", 404);
    assert.equal(res._calls.status, 404);
    assert.equal(res._calls.json.error, "not found");
  });

  it("attaches per-field details when provided", () => {
    const res = fakeRes();
    clientError(res, "validation failed", 400, { name: "required", age: "must be number" });
    assert.deepEqual(res._calls.json.fields, { name: "required", age: "must be number" });
  });
});
