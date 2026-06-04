// tests/lens-auth-gate.test.js
//
// Regression guard for the H1 production-readiness fix: the /api/lens action surface
// must NOT be an unauthenticated write/RCE bypass. The runMacro ACL is a no-op for
// anonymous HTTP (the "anon" actor is truthy + _isHumanRequest skips canRunMacro), and
// the /api/lens/run + lens.run paths dispatch registerLensAction macros directly, so the
// only reliable gate is _lensActionForbiddenForAnon + keeping /api/lens out of the
// write-auth bypass lists. This test locks those invariants against silent regression.
//
// (The runtime behavior is validated live in production mode — anon lens-action → 401,
//  authed → 200; this guard prevents the source from drifting back open.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(path.join(ROOT, "server.js"), "utf8");

test("/api/lens is NOT in WRITE_AUTH_PUBLIC_PATHS (no Gate-1 write bypass)", () => {
  const m = SRC.match(/const WRITE_AUTH_PUBLIC_PATHS = \[([^\]]*)\]/);
  assert.ok(m, "WRITE_AUTH_PUBLIC_PATHS not found");
  assert.ok(!/["']\/api\/lens["']/.test(m[1]), "/api/lens must not be in the write-auth bypass");
});

test("/api/lens is NOT in _safePostPaths (no Gate-3 Chicken2 POST bypass)", () => {
  const m = SRC.match(/const _safePostPaths = \[([\s\S]*?)\];/);
  assert.ok(m, "_safePostPaths not found");
  assert.ok(!/["']\/api\/lens["']/.test(m[1]), "/api/lens must not be in _safePostPaths");
});

test("the anon lens-action gate helper exists and is applied on both dispatch paths", () => {
  assert.ok(/function _lensActionForbiddenForAnon\s*\(/.test(SRC), "gate helper missing");
  // /api/lens/run HTTP handler applies it
  assert.ok(/app\.post\("\/api\/lens\/run"[\s\S]*?_lensActionForbiddenForAnon\(ctx\)/.test(SRC),
    "/api/lens/run handler must call _lensActionForbiddenForAnon");
  // lens.run macro applies it (covers /api/lens/:domain/:id/run)
  assert.ok(/register\("lens", "run"[\s\S]*?_lensActionForbiddenForAnon\(ctx\)/.test(SRC),
    "lens.run macro must call _lensActionForbiddenForAnon");
});

test("publicReadDomains.lens is read-only (no create/update/delete/bulkCreate/run)", () => {
  const m = SRC.match(/lens: new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "publicReadDomains.lens not found");
  for (const w of ["create", "update", "delete", "bulkCreate", "run"]) {
    assert.ok(!new RegExp(`["']${w}["']`).test(m[1]), `lens public set must not include write/dispatch macro "${w}"`);
  }
});
