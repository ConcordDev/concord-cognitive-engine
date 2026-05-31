// Wave 8f — the Vela/Cascade weld, completed.
//
// Sovereign-Ruins lore (content/world/sovereign-ruins/lore.json) authors that
// every Concordian Refusal is "strength-capped at 9 AND expires unless a quorum
// re-records it within seven days" — the Compact's answer to the Cascade. The
// strength cap was already in code; this pins the matching 7-day duration ceiling
// (so the lore↔mechanic weld is now true front-to-back) WITHOUT changing the 30s
// default for ephemeral combat gates.
//
// Run: node --test tests/refusal-ttl-cap.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyTemporaryRefusal } from "../lib/refusal-field.js";

const SEVEN_DAYS_MS = 604800 * 1000;

describe("Wave 8f — refusal 7-day expiry ceiling", () => {
  let savedEnv;
  beforeEach(() => { savedEnv = process.env.CONCORD_REFUSAL_TTL_S; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CONCORD_REFUSAL_TTL_S;
    else process.env.CONCORD_REFUSAL_TTL_S = savedEnv;
  });

  it("leaves a short ephemeral gate (60s) unchanged", () => {
    const state = { refusalFields: new Map() };
    const t0 = Date.now();
    const e = applyTemporaryRefusal(state, "w", "death_suspended", { durationMs: 60_000 });
    const ttl = e.expiresAt - t0;
    assert.ok(ttl > 55_000 && ttl <= 61_000, `expected ~60s, got ${ttl}ms`);
  });

  it("caps a long-tail refusal at 7 days (the Concordant window)", () => {
    const state = { refusalFields: new Map() };
    const t0 = Date.now();
    const e = applyTemporaryRefusal(state, "w", "death_suspended", { durationMs: 30 * 24 * 3600 * 1000 });
    const ttl = e.expiresAt - t0;
    assert.ok(ttl <= SEVEN_DAYS_MS + 1000, `expected <= 7 days, got ${ttl}ms`);
    assert.ok(ttl > SEVEN_DAYS_MS - 5000, `expected ~7 days, got ${ttl}ms`);
  });

  it("honors CONCORD_REFUSAL_TTL_S override", () => {
    process.env.CONCORD_REFUSAL_TTL_S = "10"; // 10s ceiling
    const state = { refusalFields: new Map() };
    const t0 = Date.now();
    const e = applyTemporaryRefusal(state, "w", "death_suspended", { durationMs: 3_600_000 });
    const ttl = e.expiresAt - t0;
    assert.ok(ttl <= 11_000, `expected <= 10s under override, got ${ttl}ms`);
  });
});
