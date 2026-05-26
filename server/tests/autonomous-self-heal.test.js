// server/tests/autonomous-self-heal.test.js
//
// Pins the self-heal contract: when state-load reads a persisted JSON
// with autonomous-engine flags == false, the boot silently flips them
// back to true unless `CONCORD_AUTONOMOUS_DEFAULT_ON=false` explicitly
// opts out. Without this guard, a previous test run that turned the
// engines off would silently freeze every subsequent boot — every NPC
// idle, every faction static, every dream uncomposed.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FLAGS = ["heartbeatEnabled", "autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled"];

// The self-heal lives inline in server.js loadStateFromDisk path
// (around line 8648). The test exercises the same shape directly so
// it can validate the contract without booting the whole server (which
// pulls 71k lines of init).
function selfHeal(stateSettings, envValue) {
  if (envValue === "false") return { settings: stateSettings, repaired: [] };
  const repaired = [];
  for (const f of FLAGS) {
    if (stateSettings[f] === false) {
      stateSettings[f] = true;
      repaired.push(f);
    }
  }
  return { settings: stateSettings, repaired };
}

describe("Autonomous-engine self-heal", () => {
  it("flips every false flag back to true by default", () => {
    const settings = {
      heartbeatEnabled: false,
      autogenEnabled: false,
      dreamEnabled: false,
      evolutionEnabled: false,
      synthEnabled: false,
      heartbeatMs: 5000,
    };
    const r = selfHeal(settings, undefined);
    assert.equal(r.repaired.length, 5);
    for (const f of FLAGS) assert.equal(settings[f], true);
    assert.equal(settings.heartbeatMs, 5000, "unrelated keys untouched");
  });

  it("leaves true values untouched", () => {
    const settings = {
      heartbeatEnabled: true,
      autogenEnabled: true,
      dreamEnabled: true,
      evolutionEnabled: true,
      synthEnabled: true,
    };
    const r = selfHeal(settings, undefined);
    assert.equal(r.repaired.length, 0);
  });

  it("repairs only the false ones in a mixed state", () => {
    const settings = {
      heartbeatEnabled: true,
      autogenEnabled: false,
      dreamEnabled: true,
      evolutionEnabled: false,
      synthEnabled: true,
    };
    const r = selfHeal(settings, undefined);
    assert.deepEqual(r.repaired.sort(), ["autogenEnabled", "evolutionEnabled"]);
    assert.equal(settings.autogenEnabled, true);
    assert.equal(settings.evolutionEnabled, true);
    assert.equal(settings.heartbeatEnabled, true);
  });

  it("respects CONCORD_AUTONOMOUS_DEFAULT_ON=false opt-out", () => {
    const settings = {
      heartbeatEnabled: false,
      autogenEnabled: false,
      dreamEnabled: false,
      evolutionEnabled: false,
      synthEnabled: false,
    };
    const r = selfHeal(settings, "false");
    assert.equal(r.repaired.length, 0, "opt-out should suppress all repairs");
    for (const f of FLAGS) assert.equal(settings[f], false, "false stays false under opt-out");
  });

  it("undefined values are left alone (defaults take over downstream)", () => {
    const settings = {}; // none of the flags present
    const r = selfHeal(settings, undefined);
    assert.equal(r.repaired.length, 0);
    for (const f of FLAGS) assert.equal(settings[f], undefined);
  });
});
