import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asyncHandler, createErrorMiddleware } from "../lib/async-handler.js";
import { ValidationError, NotFoundError } from "../lib/errors.js";

// Minimal Express-like mocks
function mockReq(overrides = {}) {
  return { id: "req_test", method: "GET", path: "/test", ...overrides };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    _json: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res._json = data; return res; },
  };
  return res;
}

describe("asyncHandler", () => {
  it("passes successful handler through", async () => {
     
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });

    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;

    await handler(req, res, () => { nextCalled = true; });
    assert.equal(res._json.ok, true);
    assert.equal(nextCalled, false);
  });

  it("catches async errors and forwards to next", async () => {
     
    const handler = asyncHandler(async () => {
      throw new Error("async boom");
    });

    const req = mockReq();
    const res = mockRes();
    let capturedError = null;

    await handler(req, res, (err) => { capturedError = err; });
    assert.ok(capturedError);
    assert.equal(capturedError.message, "async boom");
  });

  it("catches ConcordError subclasses and forwards to next", async () => {
     
    const handler = asyncHandler(async () => {
      throw new ValidationError("bad input");
    });

    const req = mockReq();
    const res = mockRes();
    let capturedError = null;

    await handler(req, res, (err) => { capturedError = err; });
    assert.ok(capturedError instanceof ValidationError);
    assert.equal(capturedError.statusCode, 400);
  });

  it("handles sync errors too", async () => {
     
    const handler = asyncHandler(async () => {
      throw new Error("sync in async");
    });

    let capturedError = null;
    await handler(mockReq(), mockRes(), (err) => { capturedError = err; });
    assert.ok(capturedError);
  });
});

describe("createErrorMiddleware", () => {
  it("handles ConcordError with proper status and code", () => {
    const logs = [];
    const logger = (level, event, data) => logs.push({ level, event, data });
    const middleware = createErrorMiddleware(logger);

    const err = new NotFoundError("DTU", "abc");
    const req = mockReq();
    const res = mockRes();

    middleware(err, req, res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res._json.ok, false);
    assert.equal(res._json.code, "NOT_FOUND");
    assert.equal(res._json.error, "DTU not found: abc");
    // Should not expose stack
    assert.equal(res._json.stack, undefined);
  });

  it("handles generic Error as 500", () => {
    const logs = [];
    const logger = (level, event, data) => logs.push({ level, event, data });
    const middleware = createErrorMiddleware(logger);

    const err = new Error("unexpected");
    const req = mockReq();
    const res = mockRes();

    middleware(err, req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res._json.code, "INTERNAL_ERROR");
    assert.equal(res._json.error, "An unexpected error occurred");
    // Should not expose stack traces or internal info to client
    assert.equal(res._json.stack, undefined);
    assert.equal(res._json.cause, undefined);
  });

  it("logs error at correct severity level", () => {
    const logs = [];
    const logger = (level, event, data) => logs.push({ level, event, data });
    const middleware = createErrorMiddleware(logger);

    // 400-level → warn
    middleware(new ValidationError("x"), mockReq(), mockRes(), () => {});
    assert.equal(logs[0].level, "warn");

    // 500-level → error
    middleware(new Error("x"), mockReq(), mockRes(), () => {});
    assert.equal(logs[1].level, "error");
  });

  it("does not send response if headers already sent", () => {
    const logs = [];
    const logger = (level, event, data) => logs.push({ level, event, data });
    const middleware = createErrorMiddleware(logger);

    const res = mockRes();
    res.headersSent = true;

    middleware(new Error("x"), mockReq(), res, () => {});
    assert.equal(res._json, null, "Should not send response when headers already sent");
  });
});
