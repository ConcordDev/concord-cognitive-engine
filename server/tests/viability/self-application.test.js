// Wave 5 #33 — self-application: the engine judging its own viability through
// the same spine it judges everything else with. Pins that a nominal system is
// viable, and each failure mode (stalled heartbeat / red suite / error spike /
// memory exhaustion) drops V to 0 and names the binding subsystem.
//
// Run: node --test tests/viability/self-application.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { systemViability, SYSTEM_ENVELOPE } from "../../lib/viability/self-application.js";

describe("systemViability — the reflexive loop", () => {
  it("a nominal system is viable", () => {
    const r = systemViability({ heartbeatHz: 0.066, testPassRate: 1, errorRate: 0, memoryPressure: 0.1 });
    assert.ok(r.viability > 0);
    assert.equal(r.healthy, true);
  });

  it("a stalled heartbeat collapses viability and names the heartbeat as binding", () => {
    const r = systemViability({ heartbeatHz: 0, testPassRate: 1, memoryPressure: 0.1 });
    assert.equal(r.viability, 0);
    assert.equal(r.healthy, false);
    assert.equal(r.binding.id, "heartbeatHz");
  });

  it("an error spike binds on errorRate", () => {
    const r = systemViability({ errorRate: 0.2 });
    assert.equal(r.healthy, false);
    assert.equal(r.binding.id, "errorRate");
  });

  it("memory exhaustion binds on memoryHeadroom", () => {
    const r = systemViability({ memoryPressure: 0.97 });
    assert.equal(r.healthy, false);
    assert.equal(r.binding.id, "memoryHeadroom");
  });

  it("a red test suite binds on testPassRate", () => {
    const r = systemViability({ heartbeatHz: 0.066, testPassRate: 0.5, memoryPressure: 0.1 });
    assert.equal(r.healthy, false);
    assert.equal(r.binding.id, "testPassRate");
  });

  it("defaults to a healthy baseline on an empty read", () => {
    assert.ok(systemViability({}).viability > 0);
    assert.equal(SYSTEM_ENVELOPE.length, 4);
  });
});
