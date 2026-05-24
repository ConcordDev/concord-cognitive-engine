// server/tests/cloudflare-turn.test.js
//
// Contract test for the Cloudflare TURN credential minter.
// Verifies the env-presence gate, the request shape sent to Cloudflare,
// successful credential parsing, error fallback, and TTL clamping.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mintIceServers, isConfigured, lastError } from "../lib/cloudflare-turn.js";

const ORIG_FETCH = globalThis.fetch;
const ORIG_KEY = process.env.CF_TURN_KEY_ID;
const ORIG_TOKEN = process.env.CF_TURN_KEY_API_TOKEN;

function makeFetchStub(handler) {
  return async (url, opts) => handler(url, opts);
}

describe("cloudflare-turn credential minter", () => {
  beforeEach(() => {
    process.env.CF_TURN_KEY_ID = "test-key-uuid";
    process.env.CF_TURN_KEY_API_TOKEN = "test-token";
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    if (ORIG_KEY === undefined) delete process.env.CF_TURN_KEY_ID; else process.env.CF_TURN_KEY_ID = ORIG_KEY;
    if (ORIG_TOKEN === undefined) delete process.env.CF_TURN_KEY_API_TOKEN; else process.env.CF_TURN_KEY_API_TOKEN = ORIG_TOKEN;
  });

  it("isConfigured reflects env presence", () => {
    assert.equal(isConfigured(), true);
    delete process.env.CF_TURN_KEY_ID;
    assert.equal(isConfigured(), false);
  });

  it("returns null without throwing when unconfigured", async () => {
    delete process.env.CF_TURN_KEY_ID;
    const result = await mintIceServers();
    assert.equal(result, null);
  });

  it("posts to the correct Cloudflare URL with bearer auth", async () => {
    let captured = null;
    globalThis.fetch = makeFetchStub(async (url, opts) => {
      captured = { url: String(url), method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({
        iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mintIceServers({ ttl: 1800 });
    assert.match(captured.url, /^https:\/\/rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/test-key-uuid\/credentials\/generate$/);
    assert.equal(captured.method, "POST");
    assert.equal(captured.headers.Authorization, "Bearer test-token");
    assert.equal(captured.body.ttl, 1800);
  });

  it("clamps ttl to [60, 86400]", async () => {
    let captured = null;
    globalThis.fetch = makeFetchStub(async (_url, opts) => {
      captured = JSON.parse(opts.body);
      return new Response(JSON.stringify({ iceServers: { urls: ["turn:x"], username: "u", credential: "c" } }), { status: 200 });
    });
    await mintIceServers({ ttl: 1 });
    assert.equal(captured.ttl, 60, "lower bound clamp");
    await mintIceServers({ ttl: 999999 });
    assert.equal(captured.ttl, 86400, "upper bound clamp");
  });

  it("normalizes single-object iceServers into an array", async () => {
    globalThis.fetch = makeFetchStub(async () => new Response(JSON.stringify({
      iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" },
    }), { status: 200 }));
    const result = await mintIceServers();
    assert.ok(result);
    assert.ok(Array.isArray(result.iceServers));
    assert.equal(result.iceServers.length, 1);
    assert.equal(result.iceServers[0].username, "u");
  });

  it("accepts array-shape iceServers as-is", async () => {
    globalThis.fetch = makeFetchStub(async () => new Response(JSON.stringify({
      iceServers: [
        { urls: ["turn:a"], username: "u1", credential: "c1" },
        { urls: ["turn:b"], username: "u2", credential: "c2" },
      ],
    }), { status: 200 }));
    const result = await mintIceServers();
    assert.equal(result.iceServers.length, 2);
  });

  it("returns null on non-2xx response and records lastError", async () => {
    globalThis.fetch = makeFetchStub(async () => new Response("forbidden", { status: 403 }));
    const result = await mintIceServers();
    assert.equal(result, null);
    const err = lastError();
    assert.equal(err.status, 403);
  });

  it("returns null on network error and records lastError", async () => {
    globalThis.fetch = makeFetchStub(async () => { throw new Error("ECONNREFUSED"); });
    const result = await mintIceServers();
    assert.equal(result, null);
    assert.match(lastError().text, /ECONNREFUSED/);
  });

  it("returns null when response is missing iceServers field", async () => {
    globalThis.fetch = makeFetchStub(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await mintIceServers();
    assert.equal(result, null);
    assert.match(lastError().text, /missing iceServers/);
  });

  it("expiresAt approximately reflects ttl", async () => {
    globalThis.fetch = makeFetchStub(async () => new Response(JSON.stringify({
      iceServers: { urls: ["turn:x"], username: "u", credential: "c" },
    }), { status: 200 }));
    const before = Date.now();
    const result = await mintIceServers({ ttl: 3600 });
    const after = Date.now();
    assert.ok(result.expiresAt >= before + 3600 * 1000);
    assert.ok(result.expiresAt <= after + 3600 * 1000);
  });
});
