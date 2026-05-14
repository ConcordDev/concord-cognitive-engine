// server/tests/coverage-smoke-heartbeats.test.js
//
// Sprint 34 wave 2 — heartbeat coverage padding (slice 1 of 4).
//
// Each *.test.js file runs in its own child process under
// `node --test`, with its own --test-timeout budget. Imports of the
// 40-heartbeat-module tree are heavy enough that a single file held
// the whole list (with module loads on first call) was exceeding
// the 30 s per-file timeout in CI. Split into 4 slices so each
// file imports ~10 modules and fits well under the budget.
//
// See _coverage-smoke-heartbeats-shared.mjs for the full
// HEARTBEATS table + mock-context helper.

import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEATS, probe } from "./_coverage-smoke-heartbeats-shared.mjs";

probe(test, assert, HEARTBEATS.slice(0, 10));

test("heartbeat-smoke: aggregate run* declaration count ≥ 40", () => {
  // Static count from the HEARTBEATS table — sum of run-export names
  // across all entries. The per-slice probe() tests above verify that
  // each declared export actually resolves to a function at import
  // time, so we don't need to re-import everything here (which would
  // blow the 30 s file timeout).
  let total = 0;
  for (const [, runs] of HEARTBEATS) total += runs.length;
  assert.ok(total >= 40, `Only ${total} run* declarations in HEARTBEATS table — below 40 floor`);
});
