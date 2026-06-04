// Read-replica request-gate invariants. The replica is default-DENY: only vetted
// pure-read GETs run; the write-purity-audit DANGER endpoints and all non-GET
// methods are rejected so they can't write against the readonly DB handle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isReadSafe, readReplicaGate } from "../lib/read-replica-allowlist.js";

test("infra liveness/scrape endpoints are always allowed", () => {
  for (const p of ["/health", "/ready", "/metrics", "/livez"]) {
    assert.equal(isReadSafe("GET", p), true, p);
  }
});

test("vetted pure-read GETs are allowed", () => {
  for (const p of [
    "/api/dtus", "/api/dtus/stats", "/api/dtus/abc123", "/api/megas", "/api/hypers",
    "/api/definitions", "/api/definitions/entropy", "/api/dtu/x9/export",
    "/api/worlds", "/api/worlds/tunya", "/api/worlds/tunya/quests", "/api/worlds/tunya/market",
    "/api/worlds/tunya/buildings/b1/rooms", "/api/worlds/tunya/frame",
    "/api/cities", "/api/cities/home", "/api/cities/c1/players",
    "/api/feeds", "/api/feeds/health",
    "/api/marketplace/browse", "/api/marketplace/search", "/api/marketplace/lens/l1/citations",
    "/api/atlas/tile", "/api/leaderboards", "/api/player-inventory/knowledge",
  ]) {
    assert.equal(isReadSafe("GET", p), true, `expected SAFE: ${p}`);
  }
});

test("write-on-read DANGER endpoints are denied even though they are GETs", () => {
  for (const p of [
    "/api/worlds/tunya/nodes",                 // seedWorldContent INSERT
    "/api/worlds/tunya/buildings",             // seedWorldContent INSERT
    "/api/worlds/tunya/buildings/b1/interior", // recordInteriorActivity UPDATE
  ]) {
    assert.equal(isReadSafe("GET", p), false, `expected DANGER-denied: ${p}`);
  }
});

test("non-GET methods are always denied (replicas never write)", () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal(isReadSafe(m, "/api/dtus"), false, m);
  }
  // CORS preflight is allowed (no handler write).
  assert.equal(isReadSafe("OPTIONS", "/api/dtus"), true);
});

test("unvetted paths default-deny", () => {
  for (const p of ["/api/chat", "/api/auth/me", "/api/admin/world-shards", "/api/lens/run", "/api/random-unknown"]) {
    assert.equal(isReadSafe("GET", p), false, `expected default-deny: ${p}`);
  }
});

test("readReplicaGate is a passthrough no-op when disabled (writer)", () => {
  const gate = readReplicaGate(false);
  let called = false;
  gate({ method: "POST", path: "/api/dtus" }, {}, () => { called = true; });
  assert.equal(called, true, "writer must pass through all requests untouched");
});

test("readReplicaGate rejects non-allowlisted on a replica", () => {
  const gate = readReplicaGate(true);
  let nextCalled = false, statusCode = null, payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(p) { payload = p; return this; } };
  gate({ method: "POST", path: "/api/dtus" }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 421);
  assert.equal(payload.error, "read_replica_misrouted");
});

test("readReplicaGate passes a safe read on a replica", () => {
  const gate = readReplicaGate(true);
  let nextCalled = false;
  gate({ method: "GET", path: "/api/dtus" }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
