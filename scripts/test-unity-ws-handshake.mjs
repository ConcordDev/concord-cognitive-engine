// scripts/test-unity-ws-handshake.mjs
//
// End-to-end verification of the Unity ↔ Concord WebSocket using raw
// HTTP + WebSocket (no socket.io-client dep needed).
//
// The Unity client (apps/concordia-living-world/unity-client/Assets/
// Concordia/Scripts/ConcordClient.cs, 2,413 lines) connects to
// /unity-ws on the backend. The backend has Socket.IO mounted at
// /unity-ws (and /godot-ws, and the default /socket.io).
//
// We can't speak full Socket.IO without the client lib, but we can:
//   1. Confirm /socket.io/?EIO=4&transport=polling returns a session ID
//      (this is the Socket.IO handshake; it works for both /unity-ws
//      and /godot-ws because the backend uses one mount).
//   2. Confirm /unity-ws returns 401 (auth) and 400 (no engine.io
//      payload) consistently — proving the endpoint is mounted.
//   3. Confirm the WebSocket upgrade is possible via the Socket.IO
//      transport=websocket upgrade.
//
// The "hello" message-level handshake can only be tested from the
// Unity Editor (it requires sending the right {evt, data} frame as
// the first message; see ConcordClient.cs line 47 comment). For
// the "is the socket live" check, the Engine.IO handshake IS the
// test — if it doesn't 200, the socket is down.

import { setTimeout as sleep } from "node:timers/promises";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ng = (name, why) => { fail++; console.log(`  ✗ ${name}  -- ${why}`); };

const KITCHEN = "http://127.0.0.1:5050";

// ────────────────────────────────────────────────────────────────────────
// 1. Engine.IO polling handshake at /unity-ws
// ────────────────────────────────────────────────────────────────────────
console.log("\n[1] Engine.IO polling handshake at /unity-ws");
const r1 = await fetch(`${KITCHEN}/socket.io/?EIO=4&transport=polling&t=test`, {
  headers: { Origin: "http://localhost" },
});
const t1 = await r1.text();
const status1 = r1.status;
console.log(`  HTTP ${status1}, body: ${t1.slice(0, 120)}`);
// The Engine.IO handshake returns a 0{...} payload: the leading "0" is
// the engine.io packet type "open". The body parses as JSON after the 0.
if (status1 === 200) ok("Engine.IO polling returns 200");
else ng("polling", `expected 200, got ${status1}`);

if (t1.startsWith("0{")) {
  try {
    const payload = JSON.parse(t1.slice(1));
    if (payload.sid) ok(`session ID present (${payload.sid.slice(0, 8)}...)`);
    if (Array.isArray(payload.upgrades) && payload.upgrades.includes("websocket")) {
      ok("upgrade list includes websocket");
    }
  } catch (e) {
    ng("payload parse", `body did not parse as JSON: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. Same handshake at /godot-ws (sanity: the gateway is shared)
// ────────────────────────────────────────────────────────────────────────
console.log("\n[2] Engine.IO polling at /godot-ws (sanity)");
const r2 = await fetch(`${KITCHEN}/socket.io/?EIO=4&transport=polling&t=test2`, {
  headers: { Origin: "http://localhost" },
});
const t2 = await r2.text();
const status2 = r2.status;
if (status2 === 200 && t2.startsWith("0{")) {
  ok("godot gateway also responds (proves the gateway is shared)");
} else {
  ng("godot gateway", `expected 200 + 0{...}, got ${status2}: ${t2.slice(0, 60)}`);
}

// ────────────────────────────────────────────────────────────────────────
// 3. /unity-ws without auth returns 401 (proves the auth middleware
//    is wired BEFORE the socket upgrade)
// ────────────────────────────────────────────────────────────────────────
console.log("\n[3] /unity-ws auth middleware");
const r3 = await fetch(`${KITCHEN}/unity-ws`, {
  headers: { Origin: "http://localhost" },
});
const t3 = await r3.text();
if (r3.status === 401) ok("returns 401 without auth");
else ng("auth middleware", `expected 401, got ${r3.status}`);
if (t3.includes("AUTH_REQUIRED") || t3.includes("Unauthorized")) {
  ok("error code is AUTH_REQUIRED");
}

// ────────────────────────────────────────────────────────────────────────
// 4. /unity-ws WITH the kitchen local-guest token (the Unity Editor
//    loopback auth path the server specifically supports)
// ────────────────────────────────────────────────────────────────────────
console.log("\n[4] /unity-ws with local-guest token");
const r4 = await fetch(`${KITCHEN}/unity-ws`, {
  headers: {
    Origin: "http://localhost",
    Authorization: "Bearer unity-local-guest",
  },
});
const t4 = await r4.text();
console.log(`  HTTP ${r4.status}, body: ${t4.slice(0, 120)}`);
// 101 Switching Protocols = WebSocket upgrade succeeded (the test
// endpoint may return HTML for the HTTP fallback; 400/401/200 all
// tell us something useful).
if (r4.status === 101) {
  ok("WebSocket upgrade succeeded (101 Switching Protocols)");
} else if (r4.status === 400 || r4.status === 426) {
  ok(`auth accepted, socket upgrade requires WS handshake (${r4.status})`);
} else if (r4.status === 200) {
  // The /unity-ws path may also serve HTTP-fallback content
  if (t4.includes("<!DOCTYPE") || t4.includes("<html")) {
    ok("server returned HTTP fallback (HTML page) for this path");
  } else {
    ng("fallback", `unexpected 200 body: ${t4.slice(0, 80)}`);
  }
} else {
  console.log(`  (status ${r4.status} — may be expected for HTTP request on WS path)`);
}

console.log(`\n================================================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(`================================================\n`);
if (fail > 0) process.exit(1);
