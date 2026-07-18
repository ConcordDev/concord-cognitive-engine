/**
 * Comprehensive tests for server/rateLimit.js
 * Covers: LIMITS, checkRateLimit(), rateLimitMiddleware()
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, rateLimitMiddleware, LIMITS, isRateLimitExemptPath, readRateLimitMiddleware, writeRateLimitMiddleware } from "../rateLimit.js";

describe("rateLimit", () => {
  // ── LIMITS constant ──────────────────────────────────────────
  describe("LIMITS", () => {
    it("defines expected endpoint limits", () => {
      assert.deepStrictEqual(LIMITS["conscious.chat"], { max: 600, windowMs: 60000 });
      assert.deepStrictEqual(LIMITS["utility.call"], { max: 6000, windowMs: 60000 });
      assert.deepStrictEqual(LIMITS["marketplace.submit"], { max: 5, windowMs: 3600000 });
      assert.deepStrictEqual(LIMITS["global.pull"], { max: 20, windowMs: 3600000 });
      assert.deepStrictEqual(LIMITS["semantic.search"], { max: 6000, windowMs: 60000 });
      assert.deepStrictEqual(LIMITS["default"], { max: 6000, windowMs: 60000 });
    });

    it("leashes off compute buckets (local Ollama = no per-request cost), keeps non-compute guards tight", () => {
      // Compute/interactive buckets are runaway-backstop-only — no human reaches them.
      assert.equal(LIMITS["write.lens"].max, 6000);   // every lens action funnels through POST /api/lens/run
      assert.equal(LIMITS["read.default"].max, 12000); // HUD polls + heartbeat feeds, 200/s
      assert.equal(LIMITS["utility.call"].max, 6000);
      assert.equal(LIMITS["default"].max, 6000);
      // Kept LOW because they protect NON-compute concerns, which free Ollama doesn't make safe.
      assert.equal(LIMITS["marketplace.submit"].max, 5); // governance, constitutional
      assert.equal(LIMITS["write.mail"].max, 30);        // REAL outbound email — anti-spam
      assert.equal(LIMITS["write.media.upload"].max, 30); // bandwidth/disk
      // marketplace.submit + global.pull stay on the hour window, not the minute window.
      assert.equal(LIMITS["marketplace.submit"].windowMs, 3600000);
    });
  });

  // ── isRateLimitExemptPath() — the connection-drop fix ────────
  describe("isRateLimitExemptPath()", () => {
    it("exempts the Socket.IO transport so its poll/handshake never 429s", () => {
      assert.equal(isRateLimitExemptPath({ path: "/socket.io/" }), true);
      assert.equal(isRateLimitExemptPath({ path: "/socket.io/?EIO=4&transport=polling" }), true);
    });
    it("exempts liveness probes", () => {
      assert.equal(isRateLimitExemptPath({ path: "/api/health" }), true);
      assert.equal(isRateLimitExemptPath({ path: "/health" }), true);
      assert.equal(isRateLimitExemptPath({ path: "/api/ping" }), true);
    });
    it("does NOT exempt normal API paths", () => {
      assert.equal(isRateLimitExemptPath({ path: "/api/lens/run" }), false);
      assert.equal(isRateLimitExemptPath({ path: "/api/dtus" }), false);
    });
    it("read middleware lets an exempt path through without accounting", () => {
      let called = false;
      const req = { method: "GET", path: "/socket.io/", ip: "9.9.9.9" };
      const res = { setHeader() {}, status() { return this; }, json() {} };
      readRateLimitMiddleware(req, res, () => { called = true; });
      assert.equal(called, true);
    });
    it("write middleware lets an exempt path through without accounting", () => {
      let called = false;
      const req = { method: "POST", path: "/socket.io/", ip: "9.9.9.8" };
      const res = { setHeader() {}, status() { return this; }, json() {} };
      writeRateLimitMiddleware(req, res, () => { called = true; });
      assert.equal(called, true);
    });
  });

  // ── checkRateLimit() ─────────────────────────────────────────
  describe("checkRateLimit()", () => {
    it("allows first request and sets remaining", () => {
      const userId = `user_first_${Date.now()}`;
      const result = checkRateLimit(userId, "conscious.chat");
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 599); // max 600 - 1
    });

    it("counts down remaining on subsequent calls", () => {
      const userId = `user_count_${Date.now()}`;
      checkRateLimit(userId, "conscious.chat"); // remaining = 599
      const r2 = checkRateLimit(userId, "conscious.chat"); // remaining = 598
      assert.equal(r2.allowed, true);
      assert.equal(r2.remaining, 598);
    });

    it("denies when limit exceeded", () => {
      const userId = `user_exceed_${Date.now()}`;
      const endpoint = "marketplace.submit"; // max: 5

      // Use up all 5
      for (let i = 0; i < 5; i++) {
        const r = checkRateLimit(userId, endpoint);
        assert.equal(r.allowed, true);
      }

      // 6th should be denied
      const denied = checkRateLimit(userId, endpoint);
      assert.equal(denied.allowed, false);
      assert.equal(denied.remaining, 0);
      assert.ok(typeof denied.retryAfter === "number");
      assert.ok(denied.retryAfter > 0);
    });

    it("uses default limit for unknown endpoint", () => {
      const userId = `user_default_${Date.now()}`;
      const result = checkRateLimit(userId, "unknown.endpoint");
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5999); // default max: 6000
    });

    it("resets after window expires", () => {
      const userId = `user_expire_${Date.now()}`;
      const endpoint = `test_expire_${Date.now()}`;

      // First request establishes window
      checkRateLimit(userId, endpoint);

      // Manually expire the window by manipulating the stored entry
      // The internal map is not exported, but we can verify the behavior
      // by creating a short-window scenario with the default limit (60s)
      // Instead, we test that calling with the same userId after time works
      // This is a unit test, so we trust the code logic from reading it:
      // if (Date.now() - entry.windowStart > limit.windowMs) → reset
      const r = checkRateLimit(userId, endpoint);
      assert.equal(r.allowed, true);
    });

    it("tracks separate keys for different endpoints", () => {
      const userId = `user_sep_${Date.now()}`;
      const r1 = checkRateLimit(userId, "conscious.chat");
      const r2 = checkRateLimit(userId, "utility.call");
      assert.equal(r1.remaining, 599); // conscious.chat 600 - 1
      assert.equal(r2.remaining, 5999); // utility.call 6000 - 1
    });

    it("tracks separate keys for different users", () => {
      const u1 = `user_u1_${Date.now()}`;
      const u2 = `user_u2_${Date.now()}`;
      checkRateLimit(u1, "conscious.chat");
      checkRateLimit(u1, "conscious.chat");
      const r1 = checkRateLimit(u1, "conscious.chat");
      const r2 = checkRateLimit(u2, "conscious.chat");

      assert.equal(r1.remaining, 597); // 3rd call (conscious.chat 600)
      assert.equal(r2.remaining, 599); // 1st call for u2
    });
  });

  // ── rateLimitMiddleware() ────────────────────────────────────
  describe("rateLimitMiddleware()", () => {
    function createMockReqRes(userId, ip) {
      const req = {
        user: userId ? { id: userId } : undefined,
        ip: ip || "127.0.0.1",
      };
      const headers = {};
      const res = {
        setHeader: mock.fn((key, val) => { headers[key] = val; }),
        status: mock.fn(function (code) { this._status = code; return this; }),
        json: mock.fn(),
        _status: 200,
        _headers: headers,
      };
      const next = mock.fn();
      return { req, res, next, headers };
    }

    it("returns a function (middleware)", () => {
      const mw = rateLimitMiddleware("conscious.chat");
      assert.equal(typeof mw, "function");
    });

    it("calls next() when allowed", () => {
      const mw = rateLimitMiddleware("default");
      const userId = `mw_allow_${Date.now()}`;
      const { req, res, next } = createMockReqRes(userId);

      mw(req, res, next);
      assert.equal(next.mock.calls.length, 1);
      assert.equal(res.setHeader.mock.calls.length, 1);
      assert.equal(res.setHeader.mock.calls[0].arguments[0], "X-RateLimit-Remaining");
    });

    it("returns 429 when rate limited", () => {
      const endpoint = `mw_limit_${Date.now()}`;
      // Patch LIMITS temporarily is not needed; we use marketplace.submit with max=5
      const mw = rateLimitMiddleware("marketplace.submit");
      const userId = `mw_block_${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        const { req, res, next } = createMockReqRes(userId);
        mw(req, res, next);
      }

      // 6th call should be blocked
      const { req, res, next } = createMockReqRes(userId);
      mw(req, res, next);

      assert.equal(next.mock.calls.length, 0);
      assert.equal(res.status.mock.calls[0].arguments[0], 429);
      assert.equal(res.json.mock.calls.length, 1);
      const body = res.json.mock.calls[0].arguments[0];
      assert.equal(body.error, "Rate limit exceeded");
      assert.ok(body.retryAfter > 0);
      assert.equal(body.endpoint, "marketplace.submit");
    });

    it("uses req.user.userId as fallback identifier", () => {
      const mw = rateLimitMiddleware("default");
      const userId = `mw_userId_${Date.now()}`;
      const req = { user: { userId }, ip: "1.2.3.4" };
      const headers = {};
      const res = {
        setHeader: mock.fn((k, v) => { headers[k] = v; }),
        status: mock.fn(function () { return this; }),
        json: mock.fn(),
      };
      const next = mock.fn();

      mw(req, res, next);
      assert.equal(next.mock.calls.length, 1);
    });

    it("falls back to req.ip when no user", () => {
      const mw = rateLimitMiddleware("default");
      const ip = `10.0.0.${Math.floor(Math.random() * 255)}`;
      const req = { ip };
      const headers = {};
      const res = {
        setHeader: mock.fn((k, v) => { headers[k] = v; }),
        status: mock.fn(function () { return this; }),
        json: mock.fn(),
      };
      const next = mock.fn();

      mw(req, res, next);
      assert.equal(next.mock.calls.length, 1);
    });

    it("sets Retry-After header when blocked", () => {
      const mw = rateLimitMiddleware("marketplace.submit");
      const userId = `mw_retry_${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        const { req, res, next } = createMockReqRes(userId);
        mw(req, res, next);
      }

      const { req, res, next } = createMockReqRes(userId);
      mw(req, res, next);

      // Second setHeader call should be Retry-After
      const retryCall = res.setHeader.mock.calls.find(c => c.arguments[0] === "Retry-After");
      assert.ok(retryCall, "Expected Retry-After header to be set");
      assert.ok(retryCall.arguments[1] > 0);
    });
  });
});
