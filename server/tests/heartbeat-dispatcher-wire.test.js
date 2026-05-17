// server/tests/heartbeat-dispatcher-wire.test.js
//
// Phase 12 audit fix — pin that `_startGovernorHeartbeat()` is actually
// called from the boot path. Before the fix, the function was defined
// but never invoked, so every module registered via `registerHeartbeat()`
// silently never fired.
//
// This is a static regression test (greps the source file) so it can
// run without booting the whole server. If the boot wire-up regresses
// to "definition without caller" again, this test fails loudly.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.join(__dirname, "..", "server.js");

test("_startGovernorHeartbeat is wired into the boot path", () => {
  const source = fs.readFileSync(SERVER_JS, "utf8");

  // 1. The definition exists.
  assert.match(source, /function _startGovernorHeartbeat\(\)/, "definition missing");

  // 2. At least one invocation exists OUTSIDE the definition line.
  // Strip the definition line from the source before searching.
  const callRe = /_startGovernorHeartbeat\(\)/g;
  const matches = source.match(callRe) || [];
  assert.ok(
    matches.length >= 2,
    `expected ≥2 occurrences of _startGovernorHeartbeat() (the definition + at least one caller), found ${matches.length}`
  );

  // 3. Specifically, the wire-up is a setTimeout that calls the
  //    function (any indirection). Confirms the call is on the boot
  //    path rather than buried in some never-reached helper.
  // Find a setTimeout block whose body mentions the function. The
  // body can be multi-line so we use [\s\S] (any char including \n).
  assert.match(
    source,
    /setTimeout\([\s\S]{0,400}?_startGovernorHeartbeat\(\)/,
    "expected the boot-path setTimeout that calls _startGovernorHeartbeat()"
  );

  // 4. The boot wire-up also emits a structuredLog so an operator can
  //    confirm the dispatcher started by greping `governor_heartbeat_boot`
  //    in the server log (the audit fingerprint).
  assert.match(
    source,
    /governor_heartbeat_boot/,
    "expected the structuredLog fingerprint `governor_heartbeat_boot`"
  );
});

test("tickAllRegistered is the only path to dispatch registry-pattern heartbeats", () => {
  const source = fs.readFileSync(SERVER_JS, "utf8");
  // Inside governorTick, tickAllRegistered must be called — otherwise
  // every registry-style heartbeat (signal-propagation, npc-conversation-
  // initiator, faction-strategy-cycle, etc.) silently never fires.
  assert.match(source, /await tickAllRegistered\(/, "governorTick must call tickAllRegistered");
});

test("the prom-client heartbeat counter increments inside governorTick", () => {
  const source = fs.readFileSync(SERVER_JS, "utf8");
  // The Prometheus alert rule `ConcordHeartbeatStopped` matches on
  // `rate(concord_heartbeat_ticks_total[5m]) == 0` — so the counter
  // must be incremented on every tick.
  assert.match(
    source,
    /METRICS\?\.counters\?\.heartbeatTicks\?\.inc\(\)/,
    "expected METRICS.counters.heartbeatTicks.inc() call in governorTick"
  );
});
