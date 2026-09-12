// server/tests/invariants/gateway-realtime-mirror-parity.test.js
//
// Pins that the realtime fan-out mirrors into BOTH raw-WebSocket gateways
// (`/godot-ws` and `/unity-ws`), not just Godot's.
//
// ── The bug this closes (root-caused 2026-09-12) ───────────────────────────
// server.js created a gateway emitter for Godot only:
//
//     _godotGatewayEmitter = createGatewayEmitter(godotGatewayHandle);   // ✓
//     globalThis._concordUnityGateway = unityGatewayHandle;              // ← no emitter
//
// `realtimeEmit`/`emitToWorld` fan every world/user/global event into
// `_godotGatewayEmitter`, so a connected Godot client received the entire
// realtime stream while a connected Unity client received NOTHING but direct
// replies to the ~13 RPC verbs it sends (auth, scene:request, kingdom:request,
// dialogue:request, player:move, combat:attack, …).
//
// That left correctly-written Unity client code permanently dead:
// `ConcordClient.HandleFrame` (unity-client/Assets/Concordia/Scripts) has
// cases for `secret:weaponised`, `npc:scheme-resolved` and
// `npc:conversation-bid`, all three of which are emitted through the
// realtimeEmit path (`domains/secrets.js`, `lib/npc-schemes.js`,
// `emergent/npc-conversation-initiator.js`) and therefore could never arrive.
// The handlers looked live in a code read; only the wiring proved otherwise.
//
// This matters more now that Unity — not Three.js — is the canonical World
// Lens web client (docs/ART_DIRECTION_UNITY_WEB.md), with Godot demoted to
// the presenter/spectator role. The client that gets the FULL event stream
// should not be the secondary one.
//
// This is a source-form pin (same genre as
// tests/invariants/gateway-getuser-binding.test.js, which pins the other
// half of these same two mount sites) because the failure mode is silent:
// nothing throws, no test goes red, the Unity client simply never hears
// anything and looks "connected but inert."
//
// Run: node --test tests/invariants/gateway-realtime-mirror-parity.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_JS = join(import.meta.dirname, "..", "..", "server.js");
const rawSrc = readFileSync(SERVER_JS, "utf-8");

// Strip `//` line comments before scanning — the mount sites and the emitter
// declarations carry explanatory comments that NAME these symbols, and those
// would otherwise be counted as real call sites. Same comment-blindness class
// (and same fix) as gateway-getuser-binding.test.js.
const src = rawSrc
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

test("a gateway emitter is created for BOTH the Godot and Unity handles", () => {
  const godot = /_godotGatewayEmitter\s*=\s*createGatewayEmitter\(\s*godotGatewayHandle\s*\)/.test(src);
  const unity = /_unityGatewayEmitter\s*=\s*createGatewayEmitter\(\s*unityGatewayHandle\s*\)/.test(src);
  assert.ok(
    godot,
    "no `_godotGatewayEmitter = createGatewayEmitter(godotGatewayHandle)` in server.js — " +
    "the Godot gateway would receive no realtime events.",
  );
  assert.ok(
    unity,
    "no `_unityGatewayEmitter = createGatewayEmitter(unityGatewayHandle)` in server.js — " +
    "/unity-ws clients get RPC replies only and are deaf to every realtimeEmit " +
    "world/user/global event. Unity is the canonical World Lens client; it must " +
    "not be wired as a lesser citizen than the Godot presenter.",
  );
});

test("every Godot mirror call site has a matching Unity mirror call site", () => {
  // Count by operation so a mismatch names WHICH fan-out tier drifted, rather
  // than just reporting a total that's off by one.
  const tiers = [
    { op: "emitToRoom(`world:", re: /GatewayEmitter\?\.emitToRoom\(`world:\$\{worldId\}`/g },
    { op: "emitToRoom(`user:", re: /GatewayEmitter\?\.emitToRoom\(`user:\$\{userId\}`/g },
    { op: "broadcast(", re: /GatewayEmitter\?\.broadcast\(/g },
  ];

  for (const { op, re } of tiers) {
    const all = src.match(re) || [];
    // Re-scan the same tier scoped to each emitter to split the count.
    const godotRe = new RegExp(re.source.replace("GatewayEmitter", "_godotGatewayEmitter"), "g");
    const unityRe = new RegExp(re.source.replace("GatewayEmitter", "_unityGatewayEmitter"), "g");
    const godotN = (src.match(godotRe) || []).length;
    const unityN = (src.match(unityRe) || []).length;

    assert.ok(
      godotN > 0,
      `expected at least one Godot mirror for \`${op}\`, found 0 — the fan-out tier was removed?`,
    );
    assert.equal(
      unityN,
      godotN,
      `realtime mirror parity broken for \`${op}\`: ${godotN} Godot site(s) but ` +
      `${unityN} Unity site(s) (total matched: ${all.length}). Every place the ` +
      "realtime stream fans into the Godot gateway must fan into the Unity " +
      "gateway too, or /unity-ws silently misses that class of event.",
    );
  }
});

test("each mirror call is individually try/catch-guarded", () => {
  // A gateway hiccup must never break the socket.io emit beside it, nor
  // starve the other gateway. The established shape at every site is a
  // one-line `try { ... } catch { }`.
  const lines = src.split("\n").filter((l) => /GatewayEmitter\?\./.test(l));
  assert.ok(lines.length >= 8, `expected >= 8 mirror call lines, found ${lines.length}`);
  for (const line of lines) {
    assert.match(
      line.trim(),
      /^try\s*\{.*\}\s*catch\s*\{/,
      `unguarded gateway mirror call — one gateway's failure would take down the ` +
      `other, or the socket.io emit beside it:\n    ${line.trim()}`,
    );
  }
});
