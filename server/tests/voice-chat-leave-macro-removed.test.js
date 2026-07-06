/**
 * Dead-event-listener fix (verification-audit campaign): voice_chat.leave
 * emitted "voice:leave" to a single target user, but had zero frontend
 * callers anywhere AND, even if called, nothing ever subscribed to
 * "voice:leave" (VoiceMesh.tsx only subscribes to voice:offer/answer/ice/
 * participant-joined/participant-left). Fully superseded by leave_room's
 * "voice:participant-left" broadcast, which VoiceMesh.tsx actually uses to
 * close a peer connection. Removed rather than wiring an unreachable macro.
 *
 * Run: node --test server/tests/voice-chat-leave-macro-removed.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerVoiceChatMacros from "../domains/voice-chat.js";

function collectRegistrations() {
  const pairs = [];
  const register = (domain, name) => { pairs.push(`${domain}.${name}`); };
  registerVoiceChatMacros(register);
  return pairs;
}

describe("domains/voice-chat.js — dead 'leave' macro removed, 'leave_room' still real", () => {
  const registered = collectRegistrations();

  it("no longer registers the unreachable 1:1 'leave' macro", () => {
    assert.ok(!registered.includes("voice_chat.leave"), "voice_chat.leave should be removed");
  });

  it("still registers leave_room, offer, answer, ice, join, room_state", () => {
    for (const name of ["room_state", "join", "leave_room", "offer", "answer", "ice"]) {
      assert.ok(registered.includes(`voice_chat.${name}`), `voice_chat.${name} must still be registered`);
    }
  });
});
