// FIX-whiteboard-003 — the whiteboard "updated" metadata ping must be
// scoped to the board's owner, never broadcast to every connected
// client. Boards are private by default; the ping carries the board id
// and its element count, which is the owner's information alone.
// Collaborator live sync rides the room-scoped domain path and is not
// this event. Source pin: server.js's whiteboard update handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

test("whiteboard update emit is owner-scoped, not global", () => {
  const i = src.indexOf('register("whiteboard", "update"');
  assert.ok(i >= 0, "whiteboard update handler present");
  const block = src.slice(i, i + 1600);
  const emit = block.match(/realtimeEmit\("whiteboard:updated"[^;]*;/);
  assert.ok(emit, "update handler emits whiteboard:updated");
  assert.match(emit[0], /userId:\s*dtu\.ownerId/, "emit targets the owner's user room");
  assert.doesNotMatch(emit[0], /\{\s*\}\s*\)\s*;$/, "emit must not use empty (global) targeting");
});
