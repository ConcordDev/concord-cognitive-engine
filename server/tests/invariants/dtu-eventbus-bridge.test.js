// server/tests/invariants/dtu-eventbus-bridge.test.js
//
// Pins server.js's "Concord Runtime bridge" — the one-line-per-event
// mirror from the server.js-internal ConcordEventBus (`eventBus`, 18
// call sites, none reachable from domains/*.js or lib/*.js — see the
// bridge's own comment for that finding) into the cross-domain runtime
// bus (lib/runtime/event-bus.js). Without this bridge, DTU lifecycle
// events created through the CANONICAL dtu.create/dtu.update/dtu.compost
// macros — the majority of real DTU traffic across every lens whose real
// output is a DTU — would be invisible to lib/runtime/reactions.js and
// any future cross-domain reactor, even though `eventBus.emit("dtu.created", ...)`
// already fires on every one of them.
//
// Source-form pin (same genre as gateway-getuser-binding.test.js and
// gateway-realtime-mirror-parity.test.js): booting the full server per
// assertion here would be disproportionate to what's being pinned, and
// the actual reaction behavior once an event reaches the runtime bus is
// already covered end-to-end by tests/runtime/dtu-created-reaction.test.js
// and tests/runtime/craft-reaction-chain.test.js — this file only proves
// the bridge itself exists and is wired to the real ConcordEventBus
// instance, not a duplicate.
//
// Run: node --test tests/invariants/dtu-eventbus-bridge.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_JS = join(import.meta.dirname, "..", "..", "server.js");
const rawSrc = readFileSync(SERVER_JS, "utf-8");

// Strip `//` line comments before scanning — same comment-blindness fix as
// gateway-getuser-binding.test.js (the bridge's own explanatory comment
// names every symbol this test checks for).
const src = rawSrc
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

test("publishRuntimeEvent is imported from the real runtime event-bus module", () => {
  assert.match(
    src,
    /import\s*\{\s*publish as publishRuntimeEvent\s*\}\s*from\s*["']\.\/lib\/runtime\/event-bus\.js["']/,
    "server.js must import `publish as publishRuntimeEvent` from ./lib/runtime/event-bus.js — " +
    "without it the bridge below has nothing to forward to.",
  );
});

test("all three DTU lifecycle events are bridged from ConcordEventBus onto the runtime bus", () => {
  const expected = ["dtu.created", "dtu.updated", "dtu.composted"];
  for (const evt of expected) {
    const re = new RegExp(
      `eventBus\\.on\\(\\s*["']${evt.replace(".", "\\.")}["']\\s*,\\s*\\(evt\\)\\s*=>\\s*\\{[^}]*publishRuntimeEvent\\(\\s*["']${evt.replace(".", "\\.")}["']`,
    );
    assert.match(src, re, `expected an eventBus.on("${evt}", ...) handler that calls publishRuntimeEvent("${evt}", ...) — bridge missing or broken for this event`);
  }
});

test("the bridge is genuinely a mirror off the SAME eventBus instance the dtu.create/update/compost macros emit on", () => {
  // The macros' own real emit calls (unchanged by this bridge — it only
  // adds listeners, never touches these lines) must still be present with
  // their real, evidence-based payload shapes, so a future edit to either
  // side can't silently drift the two apart without this test catching it.
  assert.match(src, /eventBus\.emit\(\s*["']dtu\.created["']\s*,\s*\{\s*id:\s*dtu\.id,\s*title:\s*dtu\.title,\s*domain:\s*dtu\.domain,\s*creatorId:/);
  assert.match(src, /eventBus\.emit\(\s*["']dtu\.updated["']\s*,\s*\{\s*id,\s*title:\s*updated\.title\s*\}/);
  assert.match(src, /eventBus\.emit\(\s*["']dtu\.composted["']\s*,\s*\{\s*id\s*\}/);
});
