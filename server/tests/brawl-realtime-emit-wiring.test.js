// Verification-audit fix — source-pinning regression test for the two
// inline `/api/combat/brawl/*` route handlers in server.js.
//
// server.js is a 77k-line monolith with no exported `app`/`REALTIME`
// surface for supertest-style HTTP testing (the repo's established
// pattern for this file is behavioral testing via the exported
// `__TEST__.runMacro`/lensRun harness, not full-app HTTP boots — these
// routes sit outside the macro system so that harness doesn't reach
// them). The dynamic-call-shape half of this fix is covered by
// `tests/brawl-queue-cycle-realtime.test.js` (mocks `realtimeEmit` and
// asserts the exact argument shape the brawl-queue heartbeat passes).
// This test pins the OTHER two call sites, in server.js itself, against
// the same argument-order regression via source inspection — the same
// technique already used by e.g. `concord-frontend/tests/brawl-hud-wired.test.tsx`.
//
// The bug: `realtimeEmit`'s real signature (server.js:8066) is
// `realtimeEmit(event, payload, { sessionId, orgId, userId, requestId })`.
// The invite route used to call it as `realtimeEmit(`user:${id}:brawl-invited`, {...})`
// — event name baked into a room-shaped first-argument string, no options
// object — which falls through realtimeEmit's `else` branch to an
// unscoped global `io.emit()` under a garbled event name.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, "..", "server.js");
const src = readFileSync(SERVER_JS, "utf8");

// Isolate just the brawl route block so assertions don't accidentally
// match an unrelated realtimeEmit call elsewhere in the 77k-line file.
function extractRoute(routePath, method = "post") {
  const marker = `app.${method}("${routePath}"`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `route ${method.toUpperCase()} ${routePath} not found in server.js`);
  // Grab a generous window — every brawl handler body is well under 1500 chars.
  return src.slice(start, start + 1500);
}

describe("brawl realtimeEmit wiring (server.js inline routes)", () => {
  it("/api/combat/brawl/invite calls realtimeEmit(\"brawl-invited\", payload, { userId })", () => {
    const block = extractRoute("/api/combat/brawl/invite");
    // The old broken shape baked the room + event into one string:
    // realtimeEmit(`user:${...}:brawl-invited`, {...}) — must not regress to that.
    assert.doesNotMatch(block, /realtimeEmit\?\.\(\s*`user:/, "regressed to room-string-as-event-name call shape");
    // Correct shape: literal event name first, then payload, then an
    // options object carrying userId (NOT a template-literal room string).
    // The invitee id is hoisted once (`const toUserId = req.body?.toUserId`,
    // under the route's no-restricted-syntax target-identifier disable) and
    // that same variable must be what the options object carries.
    assert.match(block, /realtimeEmit\?\.\(\s*"brawl-invited"/, "must call realtimeEmit with the literal event name first");
    assert.match(block, /const toUserId = req\.body\?\.toUserId/, "invitee id must come from req.body.toUserId (hoisted const)");
    assert.match(block, /\{\s*userId:\s*toUserId\s*\}/, "must pass { userId } as the options object so the room is derived internally");
  });

  it("/api/combat/brawl/accept notifies both participants via realtimeEmit(\"brawl-started\", payload, { userId })", () => {
    const block = extractRoute("/api/combat/brawl/accept");
    assert.match(block, /realtimeEmit\?\.\(\s*"brawl-started"/, "accept route should emit brawl-started on success");
    assert.match(block, /\{\s*userId:\s*r\.opponent\s*\}/, "must notify the inviter (r.opponent) via the options-object userId form");
    assert.match(block, /\{\s*userId\s*\}\s*\)/, "must also notify the accepter via the options-object userId form");
  });

  it("brawl-queue-cycle.js heartbeat call sites use the (event, payload, { userId }) shape", () => {
    const cyclePath = path.resolve(__dirname, "..", "emergent", "brawl-queue-cycle.js");
    const cycleSrc = readFileSync(cyclePath, "utf8");
    // Old broken shape: realtimeEmit(`user:${r.paired.a}`, "brawl-invited", {...})
    assert.doesNotMatch(cycleSrc, /realtimeEmit\(\s*`user:/, "regressed to room-string-as-first-argument call shape");
    assert.match(cycleSrc, /realtimeEmit\(\s*"brawl-invited",[\s\S]*?\{\s*userId:\s*r\.paired\.a\s*\}/, "must target r.paired.a via { userId } options");
    assert.match(cycleSrc, /realtimeEmit\(\s*"brawl-invited",[\s\S]*?\{\s*userId:\s*r\.paired\.b\s*\}/, "must target r.paired.b via { userId } options");
  });
});
