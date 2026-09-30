// tests/runtime/incident-and-research-capability-registration.test.js
//
// Regression test for the RISK_TIERS gap fixed 2026-09-05: incident.recover
// and research.invoke had been registering with risk:"execute" since they
// were written -- a value RISK_TIERS never contained -- so every call to
// registerCapability() for them returned {ok:false, reason:"invalid_risk_tier"}
// and both were silently absent from the registry, with no caller ever
// noticing (the domain files themselves swallow a non-ok result at boot:
// "Idempotent: ignore already-registered errors at boot time" -- the same
// catch-all also hid a genuine validation rejection).
//
// This imports the REAL domain files (not a synthetic registerCapability
// call standing in for them) so it fails again if RISK_TIERS regresses, or
// if either domain file's own registration call breaks some other way.
// Kept in its own file rather than added to capability-registry.test.js so
// these dynamic imports (which register at module-load time, once, cached
// by the ESM loader for the life of this process) can't interact with that
// file's beforeEach(_resetRegistry) / synthetic registrations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getCapabilityDescriptor, checkCapabilityHealth, RISK_TIERS, _resetRegistry,
} from "../../lib/runtime/capability-registry.js";

// Runs once at this file's own load time, before either domain file has had
// a chance to import (dynamic import() only happens inside the it() bodies
// below) -- so the registry is genuinely empty going in, not relying on
// another file's cleanup.
_resetRegistry();

describe("RISK_TIERS", () => {
  it("includes execute, between write and high", () => {
    assert.ok(RISK_TIERS.includes("execute"));
    assert.ok(RISK_TIERS.indexOf("write") < RISK_TIERS.indexOf("execute"));
    assert.ok(RISK_TIERS.indexOf("execute") < RISK_TIERS.indexOf("high"));
  });
});

describe("incident.recover: real registration via the actual domain file", () => {
  it("is present in the registry after incident-engine.js is imported, with risk execute", async () => {
    await import("../../domains/incident-engine.js");
    const d = getCapabilityDescriptor("incident.recover");
    assert.ok(d, "incident.recover must be registered — this is exactly what silently failed before the RISK_TIERS fix");
    assert.equal(d.risk, "execute");
    assert.equal(d.owner, "incident_engine");
    assert.equal(d.implementation, "mcp");
    assert.equal(d.mcp_tool_name, "incident_recover");
  });
});

describe("research.invoke: real registration via the actual domain file", () => {
  it("is present in the registry after research-frontier.js is imported, with risk execute", async () => {
    await import("../../domains/research-frontier.js");
    const d = getCapabilityDescriptor("research.invoke");
    assert.ok(d, "research.invoke must be registered — this is exactly what silently failed before the RISK_TIERS fix");
    assert.equal(d.risk, "execute");
    assert.equal(d.owner, "research_frontier");
    assert.equal(d.implementation, "mcp");
    assert.equal(d.mcp_tool_name, "research_invoke");
  });
});

describe("both capabilities get a real health answer now that they're actually registered", () => {
  it("checkCapabilityHealth resolves reachability normally for an execute-risk mcp capability", () => {
    // Env-var overrides (the same mechanism organCall itself respects) keep
    // this hermetic — it doesn't depend on whether /Users/dutch/.local/bin/
    // *.py happens to exist on whatever machine runs this suite.
    process.env["incident-engine_PATH"] = process.execPath;
    process.env["research-frontier_PATH"] = process.execPath;
    try {
      const hi = checkCapabilityHealth("incident.recover");
      const hr = checkCapabilityHealth("research.invoke");
      assert.equal(hi.ok, true);
      assert.equal(hi.reachable, true);
      assert.equal(hr.ok, true);
      assert.equal(hr.reachable, true);
    } finally {
      delete process.env["incident-engine_PATH"];
      delete process.env["research-frontier_PATH"];
    }
  });
});
