/**
 * Item 1 contract tests — the no-dep Qdrant REST client.
 *
 * Pins: disabled unless VECTOR_DB=qdrant; point ids are deterministic UUIDs
 * (idempotent upserts); upsert/search build the right REST payloads against a
 * mocked fetch; and — the load-bearing property — every path degrades gracefully
 * (no config / unreachable host / thrown fetch → { ok:false }, never throws).
 *
 * Run: node --test server/tests/qdrant-client.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import qdrant from "../lib/qdrant-client.js";

const realFetch = globalThis.fetch;
function mockFetch(handler) { globalThis.fetch = async (url, opts) => handler(url, opts); }

beforeEach(() => { qdrant._resetCache(); process.env.VECTOR_DB = "qdrant"; process.env.QDRANT_HOST = "127.0.0.1"; });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.VECTOR_DB; qdrant._resetCache(); });

describe("config + point ids", () => {
  it("is disabled (and every op no-ops) unless VECTOR_DB=qdrant", async () => {
    delete process.env.VECTOR_DB; qdrant._resetCache();
    assert.equal(qdrant.configured(), false);
    assert.equal((await qdrant.upsert("d1", new Float32Array([1, 2]))).reason, "qdrant_disabled");
    assert.equal((await qdrant.search(new Float32Array([1, 2]))).reason, "qdrant_disabled");
  });

  it("derives a deterministic, valid UUID from a dtuId", () => {
    const a = qdrant.pointIdFor("dtu_abc");
    const b = qdrant.pointIdFor("dtu_abc");
    assert.equal(a, b, "idempotent");
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(a, qdrant.pointIdFor("dtu_xyz"));
  });
});

describe("upsert + search against a mocked Qdrant", () => {
  it("creates the collection on demand and upserts a point with dtuId in the payload", async () => {
    const seen = [];
    mockFetch(async (url, opts) => {
      seen.push({ url: String(url), method: opts?.method || "GET", body: opts?.body ? JSON.parse(opts.body) : null });
      if (String(url).endsWith("/readyz")) return { ok: true, json: async () => ({}) };
      if (String(url).includes("/collections/concord_embeddings") && (!opts || opts.method === "GET")) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ result: true }) };
    });
    const r = await qdrant.upsert("dtu_1", new Float32Array([0.1, 0.2, 0.3]), { tier: "regular" });
    assert.equal(r.ok, true);
    const put = seen.find((s) => s.method === "PUT" && s.url.endsWith("/points"));
    assert.ok(put, "issued a points PUT");
    assert.equal(put.body.points[0].payload.dtuId, "dtu_1");
    assert.equal(put.body.points[0].id, qdrant.pointIdFor("dtu_1"));
    assert.equal(put.body.points[0].vector.length, 3, "vector serialized as a plain array");
  });

  it("search returns [{dtuId, score}] hydrated from the payload", async () => {
    mockFetch(async (url) => {
      if (String(url).endsWith("/readyz")) return { ok: true, json: async () => ({}) };
      if (String(url).endsWith("/points/search")) {
        return { ok: true, json: async () => ({ result: [{ id: "uuid-a", score: 0.92, payload: { dtuId: "dtu_7" } }, { id: "uuid-b", score: 0.81, payload: { dtuId: "dtu_9" } }] }) };
      }
      return { ok: true, json: async () => ({ result: true }) };
    });
    const r = await qdrant.search(new Float32Array([1, 0, 0]), 5);
    assert.equal(r.ok, true);
    assert.deepEqual(r.hits.map((h) => h.dtuId), ["dtu_7", "dtu_9"]);
    assert.equal(r.hits[0].score, 0.92);
  });
});

describe("graceful degradation", () => {
  it("returns ok:false (never throws) when fetch throws / host is unreachable", async () => {
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    const up = await qdrant.upsert("d1", new Float32Array([1, 2]));
    const se = await qdrant.search(new Float32Array([1, 2]));
    assert.equal(up.ok, false);
    assert.equal(se.ok, false);
    assert.deepEqual(se.hits, []);
  });
});
