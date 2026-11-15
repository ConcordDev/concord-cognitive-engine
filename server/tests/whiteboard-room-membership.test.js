import { test } from "node:test";
import assert from "node:assert/strict";
import { whiteboardRoomAllowed } from "../lib/whiteboard-room.js";

test("whiteboard room join requires owner or invited participant", () => {
  const state = {
    whiteboardLens: {
      sharedBoards: new Map([
        ["shared_1", { ownerId: "owner", participants: new Set(["owner", "invited"]) }],
      ]),
      boards: new Map([
        ["owner", new Map([["private_1", { id: "private_1" }]])],
      ]),
    },
  };
  assert.equal(whiteboardRoomAllowed(state, "owner", "shared_1"), true);
  assert.equal(whiteboardRoomAllowed(state, "invited", "shared_1"), true);
  assert.equal(whiteboardRoomAllowed(state, "stranger", "shared_1"), false);
  assert.equal(whiteboardRoomAllowed(state, "owner", "private_1"), true);
  assert.equal(whiteboardRoomAllowed(state, "stranger", "private_1"), false);
  assert.equal(whiteboardRoomAllowed(state, "stranger", "missing"), false);
  assert.equal(whiteboardRoomAllowed(state, "", "shared_1"), false);
});
