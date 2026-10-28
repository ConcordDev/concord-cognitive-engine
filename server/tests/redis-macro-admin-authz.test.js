// redis.* macros + /api/redis/stats — admin-only (SEC-REDIS fix).
//
// MACRO_ACL marks the redis domain admin-only, but the generic macro
// dispatcher skips the ACL for authenticated human HTTP requests, so any
// signed-in user could read/write/delete shared Redis (or the in-memory
// cache fallback) keys — including redis.del with a pattern. The fix:
// each redis.* macro runs the same dbMacroDenied guard the db.* macros
// use as its FIRST statement, and the /api/redis/stats route is gated by
// requireRole. "/api/redis" was also removed from both public GET
// read-bypass lists (Gate 1 publicReadPaths + Gate 3 _safeReadPaths —
// tests/three-gate-consistency.test.js keeps the two in sync).
//
// This file deliberately does NOT import server.js (it boots the whole
// server): the macro bodies and route gate are asserted from source,
// mirroring the three-gate-consistency test's approach. No network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dbMacroDenied } from "../lib/db-console.js";

const SERVER_PATH = path.resolve(import.meta.dirname, "../server.js");
const source = readFileSync(SERVER_PATH, "utf-8");

const GUARD = "const denied = dbMacroDenied(ctx); if (denied) return denied;";
const FORBIDDEN = { ok: false, error: "forbidden: admin role required" };

// The body of `register("redis", "<name>"` sliced up to the next
// `register(` call — the four redis macros are registered consecutively.
function macroBody(name) {
  const startMarker = `register("redis", "${name}"`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `register("redis", "${name}" not found in server.js`);
  const next = source.indexOf("register(", start + startMarker.length);
  assert.notEqual(next, -1, `no register( call follows the redis.${name} macro`);
  return source.slice(start, next);
}

describe("dbMacroDenied (shared admin-only macro guard)", () => {
  it("denies member/viewer/guest and missing actors with a forbidden object", () => {
    for (const role of ["member", "viewer", "guest"]) {
      assert.deepEqual(dbMacroDenied({ actor: { role } }), FORBIDDEN, `role=${role}`);
    }
    // undefined actor (no ctx.actor at all)
    assert.deepEqual(dbMacroDenied({}), FORBIDDEN);
    assert.deepEqual(dbMacroDenied(undefined), FORBIDDEN);
  });

  it("allows owner/admin/founder/sovereign and internal callers (null)", () => {
    for (const role of ["owner", "admin", "founder", "sovereign"]) {
      assert.equal(dbMacroDenied({ actor: { role } }), null, `role=${role}`);
    }
    assert.equal(dbMacroDenied({ internal: true }), null);
  });
});

describe("redis.* macros are admin-only (SEC-REDIS)", () => {
  for (const name of ["get", "set", "del", "stats"]) {
    it(`redis.${name}: dbMacroDenied guard is the first statement of the macro`, () => {
      const body = macroBody(name);
      const arrow = body.indexOf("=> {");
      assert.notEqual(arrow, -1, `redis.${name} macro body not found`);
      const inner = body.slice(arrow + "=> {".length);
      assert.ok(
        inner.trimStart().startsWith(GUARD),
        `redis.${name}: first statement must be the dbMacroDenied guard, got: ${inner.slice(0, 120)}`
      );
    });

    it(`redis.${name}: guard runs before any redisClient/runMacro use`, () => {
      const body = macroBody(name);
      const guardIdx = body.indexOf(GUARD);
      assert.notEqual(guardIdx, -1, `redis.${name} missing the dbMacroDenied guard`);
      for (const token of ["redisClient", "runMacro"]) {
        const tokenIdx = body.indexOf(token);
        assert.ok(
          tokenIdx === -1 || guardIdx < tokenIdx,
          `redis.${name}: guard must precede the first ${token} use`
        );
      }
    });
  }

  it("redis.stats takes a ctx parameter (the guard must see the actor)", () => {
    const body = macroBody("stats");
    assert.ok(
      body.includes("async (ctx, _input) =>"),
      "redis.stats signature must be async (ctx, _input), not (_ctx, ...)"
    );
  });
});

describe("/api/redis/stats route gate", () => {
  it("is gated by requireRole with admin", () => {
    const line = source.split("\n").find((l) => l.includes('app.get("/api/redis/stats"'));
    assert.ok(line, "/api/redis/stats route not found in server.js");
    assert.ok(line.includes("requireRole("), "route must be gated by requireRole(...)");
    assert.ok(line.includes('"admin"'), "requireRole gate must include admin");
  });
});

describe("public GET read-bypass lists no longer carry /api/redis", () => {
  it('no "/api/redis", entry outside comments', () => {
    // Strip // comments per line, then the quoted+comma form must be gone
    // everywhere (both Gate 1 publicReadPaths and Gate 3 _safeReadPaths).
    const stripped = source
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.ok(
      !stripped.includes('"/api/redis",'),
      '"/api/redis", must not appear outside comments in server.js'
    );
  });
});