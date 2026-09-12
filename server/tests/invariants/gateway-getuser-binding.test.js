// server/tests/invariants/gateway-getuser-binding.test.js
//
// Pins the receiver-binding of `getUser` at the two raw-WebSocket gateway
// mount sites (`/godot-ws` via mountGodotGateway, `/unity-ws` via
// mountUnityGateway) in server.js.
//
// ── The bug this closes (root-caused 2026-09-11) ───────────────────────────
// Both sites used to pass `getUser: AuthDB.getUser`. That detaches the method
// from its receiver. `AuthDB.getUser` (server.js) is:
//
//     getUser(userId) {
//       if (userId != null) {
//         const hit = _userCache.get(String(userId));
//         if (hit && (Date.now() - hit.at) < _USER_CACHE_TTL_MS) return hit.user;  // ← early return
//       }
//       const user = this._getUserUncached(userId);                                // ← needs `this`
//       ...
//     }
//
// On a cache HIT it returns before ever touching `this`, so a detached call
// works. On a cache MISS it dereferences `this._getUserUncached`, and in
// strict-mode ESM a detached call has `this === undefined`, so it throws
//   TypeError: Cannot read properties of undefined (reading '_getUserUncached')
// which godot-gateway.js#tryAuth swallows in `catch { user = null; }` and
// reports as `auth:error { reason: "user_not_found" }` — for a user that
// genuinely exists and had just registered successfully (HTTP 201).
//
// That cache shape is why this presented as a years-long intermittent "flake"
// rather than a hard bug: the HTTP register that mints the test's token calls
// AuthDB.getUser correctly bound and warms `_userCache`, so a fast
// register→WS-auth round trip hits the warm path and passes. Under full-suite
// CI contention the 5s TTL lapses first, the miss path runs, and every
// handshake fails — taking the whole godot-gateway-integration suite with it
// (18 cascading subtests, since they share one authenticated socket).
// `CONCORD_USER_CACHE_TTL_MS=0` makes it deterministic.
//
// Both sites matter equally: `lib/unity-bridge.js` extends
// `lib/godot-gateway.js`, so the Unity client's `/unity-ws` auth rides the
// exact same `tryAuth` path.
//
// This is a source-form pin (same genre as
// tests/invariants/launch-script-memory-config.test.js and
// tests/platinum-codeql-drift.test.js) because the failure mode is a silent
// one-token edit that only manifests under cache-miss timing — precisely the
// kind of reversion a behavioral test run on a warm cache would miss.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_JS = join(import.meta.dirname, "..", "..", "server.js");
const rawSrc = readFileSync(SERVER_JS, "utf-8");

// Strip `//` line comments before scanning. The mount sites carry a comment
// that deliberately NAMES the forbidden `getUser: AuthDB.getUser` form so a
// future reader knows exactly what not to write — without this, that comment
// trips the very check it documents. Same comment-blindness class as the UX
// grader's documented false positive (CLAUDE.md) and the same fix
// tests/platinum-codeql-drift.test.js applies. Newlines are preserved so any
// line-number diagnostics stay aligned; block comments aren't used at these
// sites, so line-stripping is sufficient here.
const src = rawSrc
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

test("neither gateway mount passes AuthDB.getUser detached from its receiver", () => {
  // The exact detached form. Any whitespace variant of `getUser: AuthDB.getUser`
  // that is NOT followed by a call paren is the bug.
  const detached = /getUser\s*:\s*AuthDB\.getUser\s*(?![(.])/g;
  const hits = src.match(detached) || [];
  assert.equal(
    hits.length,
    0,
    `server.js passes AuthDB.getUser detached (${hits.length} site(s)). ` +
    "It must stay wrapped — `getUser: (userId) => AuthDB.getUser(userId)` — or the " +
    "cache-miss path throws on `this._getUserUncached` and every /godot-ws and " +
    "/unity-ws handshake fails with a misleading auth:error{user_not_found}.",
  );
});

test("both gateway mounts pass a wrapped getUser that preserves the receiver", () => {
  const wrapped = /getUser\s*:\s*\(\s*userId\s*\)\s*=>\s*AuthDB\.getUser\(\s*userId\s*\)/g;
  const hits = src.match(wrapped) || [];
  assert.equal(
    hits.length,
    2,
    `expected exactly 2 wrapped getUser injections (mountGodotGateway + ` +
    `mountUnityGateway), found ${hits.length}. If a third gateway was added, ` +
    "wrap its getUser the same way and bump this count.",
  );
});

// ── Direction 2: prove the hazard is real, not theoretical ─────────────────
// If AuthDB.getUser ever stops depending on `this`, this test fails and the
// pin above can be relaxed. That keeps the invariant honest instead of
// cargo-culted: it asserts WHY the wrapper is required, not just that it's there.
test("AuthDB.getUser's cache-miss path still depends on `this` (why the wrapper is required)", () => {
  const body = src.match(/\n {2}getUser\(userId\)\s*\{[\s\S]*?\n {2}\},/);
  assert.ok(body, "could not locate AuthDB.getUser in server.js — update this pin");
  assert.match(
    body[0],
    /this\._getUserUncached\(/,
    "AuthDB.getUser no longer calls this._getUserUncached — the detachment hazard may be gone; " +
    "re-verify before relaxing the wrapper pins above.",
  );
});

// A standalone, dependency-free reproduction of the exact shape, so the
// mechanism is demonstrated in-repo rather than only described in prose.
test("reproduction: detached call throws on cache miss, wrapped call does not", () => {
  const cache = new Map();
  const TTL = 5000;
  const Obj = {
    getUser(id) {
      if (id != null) {
        const hit = cache.get(String(id));
        if (hit && Date.now() - hit.at < TTL) return hit.user;
      }
      const user = this._uncached(id);
      if (id != null) cache.set(String(id), { user, at: Date.now() });
      return user;
    },
    _uncached(id) { return { id }; },
  };

  const detached = Obj.getUser;

  // Warm cache → detached works. This is the masking behaviour.
  cache.set("warm", { user: { id: "warm" }, at: Date.now() });
  assert.deepEqual(detached("warm"), { id: "warm" }, "warm-cache detached call should succeed (this is what masked the bug)");

  // Cold cache → detached throws exactly the swallowed TypeError.
  assert.throws(
    () => detached("cold"),
    /Cannot read properties of undefined \(reading '_uncached'\)/,
    "cold-cache detached call must throw — this is the real failure tryAuth swallows",
  );

  // Wrapped → works regardless of cache state.
  const wrapped = (id) => Obj.getUser(id);
  assert.deepEqual(wrapped("cold2"), { id: "cold2" }, "wrapped call must work on a cache miss");
});
