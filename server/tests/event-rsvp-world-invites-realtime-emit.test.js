// Verification-audit fix — source-pinning regression test for two more
// call sites hit by the same `realtimeEmit(event, payload, opts)`
// signature-mismatch bug already fixed elsewhere in this campaign
// (server.js:52106 brawl-invite/accept routes, emergent/brawl-queue-cycle.js
// heartbeat — see `server/tests/brawl-realtime-emit-wiring.test.js`).
//
// `realtimeEmit`'s real signature (server.js:8066) is:
//   function realtimeEmit(event, payload, { sessionId, orgId, userId, requestId } = {})
// It destructures exactly `userId` (plus session/org/request id) and
// silently ignores any other key on the options object. Both files this
// test covers were calling it with `{ targetUserId: ... }` instead of
// `{ userId: ... }` — the destructure picks up nothing, `userId` stays
// the empty-string default, and the emit falls through to an unscoped
// broadcast instead of reaching just the intended recipient:
//
//   - server/lib/event-rsvp.js#sweepEventReminders — an "event starts in
//     10 minutes" RSVP reminder that should reach only the RSVP'd user.
//   - server/routes/world-invites.js POST /api/worlds/invites — a world
//     invite notification that should reach only the invitee.
//
// This test pins the fix via source inspection (the same technique used
// by `brawl-realtime-emit-wiring.test.js`): neither file may regress to
// passing `targetUserId` in the realtimeEmit options object, and each
// call site's options object must carry the correct `userId` key bound
// to the correct recipient variable.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENT_RSVP_PATH = path.resolve(__dirname, "..", "lib", "event-rsvp.js");
const WORLD_INVITES_PATH = path.resolve(__dirname, "..", "routes", "world-invites.js");

describe("event-rsvp + world-invites realtimeEmit wiring", () => {
  it("event-rsvp.js sweepEventReminders targets the RSVP'd user via { userId }, not { targetUserId }", () => {
    const src = readFileSync(EVENT_RSVP_PATH, "utf8");

    // Must not regress to the broken options-object key.
    assert.doesNotMatch(
      src,
      /_concordRealtimeEmit\?\.\(\s*"event:reminder"[\s\S]*?\{\s*targetUserId:/,
      "regressed to the unrecognised { targetUserId } options key — realtimeEmit ignores it and broadcasts globally"
    );

    // Correct shape: literal event name, payload, then { userId: r.user_id }.
    assert.match(
      src,
      /_concordRealtimeEmit\?\.\(\s*"event:reminder"[\s\S]*?\{\s*userId:\s*r\.user_id\s*\}/,
      "must call realtimeEmit(\"event:reminder\", payload, { userId: r.user_id }) so the reminder reaches only the RSVP'd user"
    );
  });

  it("world-invites.js POST /api/worlds/invites targets the invitee via { userId }, not { targetUserId }", () => {
    const src = readFileSync(WORLD_INVITES_PATH, "utf8");

    assert.doesNotMatch(
      src,
      /realtimeEmit\?\.\(\s*"world:invite-received"[\s\S]*?\{\s*targetUserId:/,
      "regressed to the unrecognised { targetUserId } options key — realtimeEmit ignores it and broadcasts globally"
    );

    assert.match(
      src,
      /realtimeEmit\?\.\(\s*"world:invite-received",[\s\S]*?\{\s*userId:\s*toUserId\s*\}/,
      "must call realtimeEmit(\"world:invite-received\", payload, { userId: toUserId }) so the invite reaches only the invitee"
    );
  });

  it("neither file references targetUserId anywhere (full regression sweep)", () => {
    const rsvpSrc = readFileSync(EVENT_RSVP_PATH, "utf8");
    const invitesSrc = readFileSync(WORLD_INVITES_PATH, "utf8");
    assert.doesNotMatch(rsvpSrc, /targetUserId/, "server/lib/event-rsvp.js must not reference targetUserId");
    assert.doesNotMatch(invitesSrc, /targetUserId/, "server/routes/world-invites.js must not reference targetUserId");
  });
});
