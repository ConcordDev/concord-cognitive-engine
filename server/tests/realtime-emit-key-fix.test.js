// Verification-audit fix — source-pinning regression test for 3 more
// realtimeEmit call sites in server.js hit by the same option-key
// signature-mismatch bug already fixed elsewhere in this campaign
// (server.js's brawl routes, emergent/brawl-queue-cycle.js,
// lib/event-rsvp.js, routes/world-invites.js).
//
// realtimeEmit's real signature (server.js) destructures exactly
// `userId` (plus sessionId/orgId/requestId) and silently ignores unknown
// keys. These 3 call sites passed `{ targetUserId: ... }` instead — the
// destructure picks up nothing, `userId` stays the empty-string default,
// and the emit falls through to an unscoped broadcast instead of reaching
// just the intended recipient:
//   - POST /api/parties/:partyId/invite — a party invite notification.
//   - POST /api/mail/send — a "you received mail" notification.
//   - POST /api/friends/request — a friend-request notification.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, "..", "server.js");
const src = readFileSync(SERVER_JS, "utf8");

function extractAround(needle, windowBefore = 200, windowAfter = 400) {
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `expected to find: ${needle}`);
  return src.slice(Math.max(0, start - windowBefore), start + windowAfter);
}

describe("realtimeEmit wiring — 3 more targetUserId→userId fixes (server.js)", () => {
  it("party invite notifies the invitee via { userId }, not { targetUserId }", () => {
    const block = extractAround('realtimeEmit?.("party:invite-received"');
    assert.doesNotMatch(block, /\{\s*targetUserId:/, "regressed to the unrecognised { targetUserId } options key");
    assert.match(block, /\{\s*userId:\s*req\.body\?\.toUserId\s*\}/, "must pass { userId } bound to the invitee");
  });

  it("mail:received notifies the recipient via { userId }, not { targetUserId }", () => {
    const block = extractAround('realtimeEmit?.("mail:received"');
    assert.doesNotMatch(block, /\{\s*targetUserId:/, "regressed to the unrecognised { targetUserId } options key");
    assert.match(block, /\{\s*userId:\s*req\.body\?\.toUserId\s*\}/, "must pass { userId } bound to the recipient");
  });

  it("friend:request-received notifies the target via { userId }, not { targetUserId }", () => {
    const block = extractAround('realtimeEmit?.("friend:request-received"');
    assert.doesNotMatch(block, /\{\s*targetUserId:/, "regressed to the unrecognised { targetUserId } options key");
    assert.match(block, /\{\s*userId:\s*targetId\s*\}/, "must pass { userId } bound to the target");
  });
});
