// server/tests/high-power-allowlist.test.js
//
// Task #33 of the Private Mode / High Power Mode plan: the
// CONCORD_HIGH_POWER_ALLOWLIST rollout gate.
//
// Pins isHighPowerModeAllowed()'s full value contract:
//   - unset                 -> everyone allowed (gate removed / never
//                               configured)
//   - "*"                   -> everyone allowed, explicit
//   - "" (present, empty)   -> nobody allowed (explicit hard lockout,
//                               distinct from unset)
//   - comma-separated list  -> only listed user ids
// Private Mode itself is never gated by this — the plan is explicit that
// this is a rollout visibility switch on High Power Mode only.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { isHighPowerModeAllowed, describeAllowlistMode } from "../lib/high-power-allowlist.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => { delete process.env.CONCORD_HIGH_POWER_ALLOWLIST; });
after(() => { process.env = { ...ORIGINAL_ENV }; });

describe("isHighPowerModeAllowed", () => {
  it("unset (gate removed) allows everyone, including a null/undefined userId", () => {
    assert.equal(isHighPowerModeAllowed("user_a"), true);
    assert.equal(isHighPowerModeAllowed(null), true);
    assert.equal(isHighPowerModeAllowed(undefined), true);
  });

  it("'*' allows everyone, explicitly", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "*";
    assert.equal(isHighPowerModeAllowed("user_a"), true);
    assert.equal(isHighPowerModeAllowed("anyone_at_all"), true);
  });

  it("an empty string (present but empty) is a hard lockout for everyone", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "";
    assert.equal(isHighPowerModeAllowed("user_a"), false);
    assert.equal(isHighPowerModeAllowed(null), false);
  });

  it("a whitespace-only value is treated the same as empty (hard lockout)", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "   ";
    assert.equal(isHighPowerModeAllowed("user_a"), false);
  });

  it("a comma-separated list allows only listed ids", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "user_a,user_b, user_c ";
    assert.equal(isHighPowerModeAllowed("user_a"), true);
    assert.equal(isHighPowerModeAllowed("user_b"), true);
    assert.equal(isHighPowerModeAllowed("user_c"), true, "surrounding whitespace in the list entry must be trimmed");
    assert.equal(isHighPowerModeAllowed("user_d"), false);
  });

  it("a single-id list rejects everyone else, including a missing userId", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "user_a";
    assert.equal(isHighPowerModeAllowed("user_a"), true);
    assert.equal(isHighPowerModeAllowed(null), false);
    assert.equal(isHighPowerModeAllowed(undefined), false);
  });
});

// Backs GET /api/admin/platform-providers-status's `allowlist` field — the
// diagnostic an operator uses to watch real platform-provider spend/volume
// before removing the gate. Never exposes actual membership, only the mode
// (+ size when list-restricted).
describe("describeAllowlistMode", () => {
  it("reports 'open' when unset", () => {
    const r = describeAllowlistMode();
    assert.equal(r.mode, "open");
  });

  it("reports 'open' for '*'", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "*";
    const r = describeAllowlistMode();
    assert.equal(r.mode, "open");
  });

  it("reports 'closed' for an empty string", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "";
    const r = describeAllowlistMode();
    assert.equal(r.mode, "closed");
  });

  it("reports 'list' with the correct size, and never the actual member ids", () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "user_a,user_b,user_c";
    const r = describeAllowlistMode();
    assert.equal(r.mode, "list");
    assert.equal(r.size, 3);
    assert.equal(JSON.stringify(r).includes("user_a"), false, "must never leak actual member ids");
  });
});
