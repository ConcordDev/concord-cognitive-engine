// server/tests/world-host.test.js — lib/world-host.js (shared-world host registry).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as H from "../lib/world-host.js";

const host = { id: "host-socket" }, player = { id: "player-socket" };
const op = { userId: "u_owner", role: "owner" }, member = { userId: "u_member", role: "member" };
beforeEach(() => H._resetWorldHosts());

test("only operator accounts can become a world's host", () => {
  assert.deepEqual(H.registerHost(player, member, "concordia-hub"), { ok: false, reason: "operator_only" });
  assert.equal(H.registerHost(host, op, "concordia-hub").ok, true);
  assert.equal(H.registerHost(host, op, "../etc").reason, "invalid_world");
  assert.equal(H.registerHost(host, {}, "concordia-hub").reason, "not_authenticated");
});

test("a player cannot publish as the host", () => {
  H.registerHost(host, op, "concordia-hub");
  assert.equal(H.acceptManifest(player, "concordia-hub", [{ id: "n1" }]).reason, "not_host");
  assert.equal(H.acceptSnapshot(player, "concordia-hub", [{ id: "n1", x: 1 }]).reason, "not_host");
});

test("manifest chunks merge; a non-append chunk replaces", () => {
  H.registerHost(host, op, "w");
  H.acceptManifest(host, "w", [{ id: "a", name: "Ada", look: "{}" }], { append: false }, 1);
  H.acceptManifest(host, "w", [{ id: "b", name: "Bo" }], { append: true }, 2);
  assert.deepEqual(H.manifestFor("w").entities.map((e) => e.id), ["a", "b"]);
  H.acceptManifest(host, "w", [{ id: "c" }], { append: false }, 3);
  assert.deepEqual(H.manifestFor("w").entities.map((e) => e.id), ["c"]);
});

test("snapshots are sanitized and throttled", () => {
  H.registerHost(host, op, "w");
  const r = H.acceptSnapshot(host, "w", [{ id: "a", x: 1.23456, y: 0, z: "evil", act: "walk", extra: "dropped" }, { nope: 1 }], 1000);
  assert.deepEqual(r.snapshot.entities, [{ id: "a", x: 1.23, y: 0, act: "walk" }]);
  assert.equal(H.acceptSnapshot(host, "w", [{ id: "a" }], 1010).reason, "throttled");
  assert.equal(H.acceptSnapshot(host, "w", [{ id: "a" }], 1100).ok, true);
});

test("closing the host socket releases its worlds", () => {
  H.registerHost(host, op, "w1"); H.registerHost(host, op, "w2");
  assert.deepEqual(H.releaseClient(host).sort(), ["w1", "w2"]);
  assert.equal(H.hostFor("w1"), null);
  assert.deepEqual(H.releaseClient(player), []);
});
