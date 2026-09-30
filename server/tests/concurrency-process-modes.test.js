// server/tests/concurrency-process-modes.test.js
//
// Concurrency Refactor Tier 1 — pins the process-split wiring in server.js:
//   CONCORD_HEARTBEAT_ONLY=1   → runs the emergent sim, binds NO HTTP port
//   CONCORD_DISABLE_HEARTBEAT  → serves HTTP, runs NO governorTick / startHeartbeat
//                                / cognitive worker (previously it only gated
//                                _startGovernorHeartbeat's registry dispatch —
//                                startHeartbeat() ran regardless; that gap is
//                                the one this closes)
//
// Structural, not a spawn test: a full server.js boot is ~30-45s and this
// pins the three guard points cheaply. The real behavioral verification was
// done by spawning both modes during development (logs: server_heartbeat_only_mode
// + port refused; heartbeat_skipped_disabled_env + /health 200 + governor
// boot ok:false reason:heartbeat_disabled_env).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(import.meta.dirname, "..", "server.js"), "utf8");

test("HEARTBEAT_ONLY constant is defined and read from CONCORD_HEARTBEAT_ONLY", () => {
  assert.match(SRC, /const HEARTBEAT_ONLY\s*=\s*process\.env\.CONCORD_HEARTBEAT_ONLY\s*===\s*"1"\s*\|\|\s*process\.env\.CONCORD_HEARTBEAT_ONLY\s*===\s*"true"/);
});

test("SHOULD_LISTEN is gated by !HEARTBEAT_ONLY (the sim process binds no port)", () => {
  const m = SRC.match(/const SHOULD_LISTEN\s*=\s*_FORCE_LISTEN\s*\|\|\s*\(([\s\S]*?)\);/);
  assert.ok(m, "SHOULD_LISTEN assignment found");
  assert.match(m[1], /!HEARTBEAT_ONLY/, "SHOULD_LISTEN condition includes !HEARTBEAT_ONLY");
});

test("startHeartbeat() early-returns on CONCORD_DISABLE_HEARTBEAT (completely, not just the governor)", () => {
  const m = SRC.match(/function startHeartbeat\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "startHeartbeat() body found");
  const head = m[1].slice(0, 900);
  assert.match(head, /CONCORD_DISABLE_HEARTBEAT[\s\S]*?===\s*"true"[\s\S]*?return;/,
    "startHeartbeat returns early when CONCORD_DISABLE_HEARTBEAT is true — BEFORE spawning the cognitive worker / starting the timers");
});

test("_startGovernorHeartbeat still self-gates on CONCORD_DISABLE_HEARTBEAT (unchanged)", () => {
  const m = SRC.match(/function _startGovernorHeartbeat\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m);
  assert.match(m[1], /CONCORD_DISABLE_HEARTBEAT\s*===\s*"true"/);
});

test("the boot-time startHeartbeat + governor kick still run for a non-replica non-http-only process", () => {
  // Default deploy (neither flag) must be byte-identical to before: both the
  // T+45s startHeartbeat and the T+50s _startGovernorHeartbeat still fire.
  assert.match(SRC, /setTimeout\(\(\)\s*=>\s*startHeartbeat\(\),\s*45_?000\)/);
  assert.match(SRC, /_startGovernorHeartbeat\(\)/);
});

test("IS_HEARTBEAT_NODE is derived from NODE_APP_INSTANCE (unset/0 = primary)", () => {
  assert.match(SRC, /const NODE_APP_INSTANCE_RAW\s*=\s*process\.env\.NODE_APP_INSTANCE/);
  assert.match(SRC, /const IS_HEARTBEAT_NODE\s*=/);
  assert.match(SRC, /String\(NODE_APP_INSTANCE_RAW\)\s*===\s*"0"/);
});

test("startHeartbeat() early-returns on non-primary NODE_APP_INSTANCE", () => {
  const m = SRC.match(/function startHeartbeat\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "startHeartbeat() body found");
  const head = m[1].slice(0, 1400);
  assert.match(head, /!IS_HEARTBEAT_NODE[\s\S]*?heartbeat_skipped_non_primary_instance/,
    "startHeartbeat skips the tick on NODE_APP_INSTANCE != 0");
});

test("_startGovernorHeartbeat self-gates on !IS_HEARTBEAT_NODE", () => {
  const m = SRC.match(/function _startGovernorHeartbeat\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m);
  assert.match(m[1], /!IS_HEARTBEAT_NODE[\s\S]*?non_primary_instance/);
});
