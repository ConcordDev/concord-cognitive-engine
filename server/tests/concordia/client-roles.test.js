// server/tests/concordia/client-roles.test.js
//
//   cd server && node --test tests/concordia/client-roles.test.js

import { test } from "node:test";
import assert from "node:assert";
import {
  CLIENT_ROLES,
  INTENT_EVENTS,
  PRESENTATION_EVENTS,
  roleFor,
  mayResolveCombat,
} from "../../lib/concordia/client-roles.js";

test("unity and godot are game clients, not kernel", () => {
  assert.equal(roleFor("unity").role, "game_client");
  assert.equal(roleFor("godot").role, "game_client");
  assert.equal(roleFor("unity").kernel, false);
  assert.equal(roleFor("godot").kernel, false);
  assert.equal(roleFor("unity").path, "/unity-ws");
  assert.equal(roleFor("godot").path, "/godot-ws");
});

test("three.js world-lens is the web OS viewport, not combat authority", () => {
  const r = roleFor("threejs_world_lens");
  assert.equal(r.role, "web_os_viewport");
  assert.equal(r.kernel, false);
  assert.equal(mayResolveCombat("threejs_world_lens"), false);
});

test("living-world Vite kernel is a superseded browser prototype", () => {
  const r = roleFor("living_world_vite");
  assert.equal(r.role, "browser_prototype");
  assert.equal(r.supersededBy, "unity");
  assert.equal(mayResolveCombat("living_world_vite"), false);
});

test("only the server kernel may resolve combat", () => {
  assert.equal(mayResolveCombat("server"), true);
  assert.equal(mayResolveCombat("unity"), false);
  assert.equal(mayResolveCombat("godot"), false);
  assert.equal(mayResolveCombat("nope"), false);
  assert.equal(mayResolveCombat(null), false);
  assert.equal(CLIENT_ROLES.server.kernel, true);
});

test("intent vs presentation event lists stay disjoint and named", () => {
  const intent = new Set(INTENT_EVENTS);
  const presentation = new Set(PRESENTATION_EVENTS);
  for (const evt of INTENT_EVENTS) {
    assert.equal(presentation.has(evt), false, `${evt} must not also be presentation`);
  }
  assert.ok(intent.has("combat:attack"));
  assert.ok(intent.has("player:move"));
  assert.ok(presentation.has("combat:attack:ack"));
  assert.ok(presentation.has("combat:impact"));
});
