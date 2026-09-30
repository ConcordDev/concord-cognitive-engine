// tests/runtime/capability-registry.test.js — REAL behavioral tests for
// lib/runtime/capability-registry.js. No boot needed for the pure
// registration/lookup tests; the health-check test fakes the two globals
// it reads (documented, not the real production maps) since this is a
// unit test of the LOOKUP LOGIC, not a re-test of the macro system itself.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerCapability, getCapabilityDescriptor, listCapabilities,
  checkCapabilityHealth, RISK_TIERS, _resetRegistry, _mcpOrganOwnersForTest,
} from "../../lib/runtime/capability-registry.js";
import { ORGANS } from "../../lib/mcp-tools.js";

beforeEach(() => _resetRegistry());

describe("registerCapability: validation", () => {
  it("rejects a missing descriptor", () => {
    assert.deepEqual(registerCapability(null), { ok: false, reason: "missing_descriptor" });
  });
  it("rejects a capability name with no dot", () => {
    const r = registerCapability({ capability: "nodothere", owner: "x", risk: "read" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_capability_name");
  });
  it("rejects a missing owner", () => {
    const r = registerCapability({ capability: "x.y", risk: "read" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_owner");
  });
  it("rejects an invalid risk tier", () => {
    const r = registerCapability({ capability: "x.y", owner: "x", risk: "catastrophic" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_risk_tier");
  });
  it("accepts every real risk tier", () => {
    for (const risk of RISK_TIERS) {
      const r = registerCapability({ capability: `x.${risk}`, owner: "x", risk });
      assert.equal(r.ok, true);
    }
  });
});

describe("registerCapability + getCapabilityDescriptor: round-trip and idempotency", () => {
  it("round-trips every field, stamps registeredAt", () => {
    const before = Date.now();
    const r = registerCapability({ capability: "x.y", owner: "x", risk: "write", description: "d", inputs: ["a"], outputs: ["b"], dependencies: ["db"] });
    assert.equal(r.ok, true);
    const got = getCapabilityDescriptor("x.y");
    assert.equal(got.capability, "x.y");
    assert.equal(got.owner, "x");
    assert.equal(got.risk, "write");
    assert.equal(got.description, "d");
    assert.deepEqual(got.inputs, ["a"]);
    assert.deepEqual(got.outputs, ["b"]);
    assert.deepEqual(got.dependencies, ["db"]);
    assert.ok(got.registeredAt >= before);
  });

  it("returns null for an unregistered capability", () => {
    assert.equal(getCapabilityDescriptor("nope.nope"), null);
  });

  it("re-registering the same name overwrites, not duplicates", () => {
    registerCapability({ capability: "x.y", owner: "x", risk: "read" });
    registerCapability({ capability: "x.y", owner: "x", risk: "high" });
    assert.equal(getCapabilityDescriptor("x.y").risk, "high");
    assert.equal(listCapabilities({ owner: "x" }).length, 1);
  });
});

describe("listCapabilities: filters", () => {
  beforeEach(() => {
    registerCapability({ capability: "a.one", owner: "a", risk: "read" });
    registerCapability({ capability: "a.two", owner: "a", risk: "write" });
    registerCapability({ capability: "b.one", owner: "b", risk: "read" });
  });

  it("filters by owner", () => {
    const names = listCapabilities({ owner: "a" }).map((c) => c.capability).sort();
    assert.deepEqual(names, ["a.one", "a.two"]);
  });

  it("filters by risk", () => {
    const names = listCapabilities({ risk: "read" }).map((c) => c.capability).sort();
    assert.deepEqual(names, ["a.one", "b.one"]);
  });

  it("combines both filters", () => {
    const names = listCapabilities({ owner: "a", risk: "write" }).map((c) => c.capability);
    assert.deepEqual(names, ["a.two"]);
  });

  it("with no filters, returns every registered capability", () => {
    assert.equal(listCapabilities().length, 3);
  });
});

describe("checkCapabilityHealth: real reachability, never trusted from the descriptor alone", () => {
  const savedLensActions = globalThis.__concordLensActions;
  const savedMacros = globalThis._concordMACROS;

  function restoreGlobals() {
    globalThis.__concordLensActions = savedLensActions;
    globalThis._concordMACROS = savedMacros;
  }

  it("reports not_registered for an unknown capability", () => {
    const h = checkCapabilityHealth("nope.nope");
    assert.equal(h.ok, false);
    assert.equal(h.reachable, false);
    assert.equal(h.reason, "not_registered");
  });

  it("reports reachable:true when a matching LENS_ACTIONS handler exists", () => {
    registerCapability({ capability: "x.y", owner: "x", risk: "read" });
    globalThis.__concordLensActions = new Map([["x.y", () => {}]]);
    globalThis._concordMACROS = new Map();
    try {
      const h = checkCapabilityHealth("x.y");
      assert.equal(h.reachable, true);
    } finally {
      restoreGlobals();
    }
  });

  it("reports reachable:true when a matching MACROS handler exists (fallback path)", () => {
    registerCapability({ capability: "x.z", owner: "x", risk: "read" });
    globalThis.__concordLensActions = new Map(); // no lens-action entry
    globalThis._concordMACROS = new Map([["x", new Map([["z", () => {}]])]]);
    try {
      const h = checkCapabilityHealth("x.z");
      assert.equal(h.reachable, true);
    } finally {
      restoreGlobals();
    }
  });

  it("honestly reports reachable:false when registered but no real handler exists in either map — a stale/typo'd registration is never silently trusted", () => {
    registerCapability({ capability: "x.gone", owner: "x", risk: "read" });
    globalThis.__concordLensActions = new Map();
    globalThis._concordMACROS = new Map();
    try {
      const h = checkCapabilityHealth("x.gone");
      assert.equal(h.ok, true); // the registry itself is fine — the underlying handler is the problem
      assert.equal(h.reachable, false);
      assert.equal(h.reason, "handler_not_found_in_lens_actions_or_macros");
    } finally {
      restoreGlobals();
    }
  });
});

// 2026-09-05: MCP-backed (organ) capabilities used to consult
// globalThis.__concordMcpTools, a Set nothing ever populated — so every
// implementation:"mcp" capability with a read/write/execute risk
// permanently reported reachable:true via an unconditional fallback,
// regardless of whether its organ script actually existed. These tests
// exercise the real replacement: a direct fs.existsSync check against
// the organ's actual (or env-overridden) path, mirroring organCall's own
// resolution formula so an operator's relocation via env var is honoured.
describe("checkCapabilityHealth: MCP-backed capabilities are verified against the real organ script, never assumed", () => {
  const ENV_KEY = "incident-engine_PATH";
  const savedEnv = process.env[ENV_KEY];
  function restoreEnv() {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
  }
  // No lens-action/macro entries for these capabilities on purpose — the
  // point is to reach the mcp branch, not short-circuit before it.
  beforeEach(() => {
    globalThis.__concordLensActions = new Map();
    globalThis._concordMACROS = new Map();
  });

  it("reports reachable:true when the organ script file genuinely exists", () => {
    process.env[ENV_KEY] = process.execPath; // any real, always-present file
    registerCapability({
      capability: "incident.watch", owner: "incident_engine", risk: "write",
      implementation: "mcp", mcp_tool_name: "incident_watch",
    });
    try {
      const h = checkCapabilityHealth("incident.watch");
      assert.equal(h.reachable, true);
    } finally {
      restoreEnv();
    }
  });

  it("reports reachable:false with reason organ_script_missing when the file does not exist — this is the exact case the old code got permanently wrong", () => {
    process.env[ENV_KEY] = "/definitely/does/not/exist/incident-engine.py";
    registerCapability({
      capability: "incident.watch", owner: "incident_engine", risk: "write",
      implementation: "mcp", mcp_tool_name: "incident_watch",
    });
    try {
      const h = checkCapabilityHealth("incident.watch");
      assert.equal(h.ok, true); // registry bookkeeping is fine; the organ is the problem
      assert.equal(h.reachable, false);
      assert.equal(h.reason, "organ_script_missing");
    } finally {
      restoreEnv();
    }
  });

  it("never silently assumes reachable regardless of risk tier — the retired fallback covered every valid risk unconditionally", () => {
    process.env[ENV_KEY] = "/definitely/does/not/exist/incident-engine.py";
    try {
      for (const risk of RISK_TIERS) {
        _resetRegistry();
        globalThis.__concordLensActions = new Map();
        globalThis._concordMACROS = new Map();
        registerCapability({
          capability: "incident.x", owner: "incident_engine", risk,
          implementation: "mcp", mcp_tool_name: "incident_x",
        });
        const h = checkCapabilityHealth("incident.x");
        assert.equal(h.reachable, false, `risk="${risk}" must not be silently assumed reachable`);
      }
    } finally {
      restoreEnv();
    }
  });

  it("reports reachable:false with reason mcp_owner_not_mapped for an mcp-implementation capability whose owner isn't a known organ — honest failure, not a guess", () => {
    registerCapability({
      capability: "ghost.tool", owner: "nonexistent_organ", risk: "read",
      implementation: "mcp", mcp_tool_name: "ghost_tool",
    });
    const h = checkCapabilityHealth("ghost.tool");
    assert.equal(h.reachable, false);
    assert.equal(h.reason, "mcp_owner_not_mapped");
  });
});

// Bidirectional drift guard: MCP_ORGAN_OWNERS in capability-registry.js
// duplicates ORGANS' path values from mcp-tools.js by necessity (see that
// map's own comment for why it can't just import mcp-tools.js directly).
// This test fails the moment the two disagree, so an organ relocation that
// updates one side and forgets the other is caught here, not discovered
// later as a silent false "organ_script_missing".
describe("MCP_ORGAN_OWNERS: pinned against the live ORGANS map in mcp-tools.js", () => {
  const OWNER_TO_ORGANS_KEY = {
    browser_organ: "BROWSER_ORGAN",
    incident_engine: "INCIDENT_ENGINE",
    opportunity_engine: "OPPORTUNITY",
    research_frontier: "RESEARCH",
    trace_fabric_organ: "TRACE_FABRIC",
  };

  it("every mapped owner's path matches the real ORGANS entry it claims to mirror", () => {
    const owners = _mcpOrganOwnersForTest();
    const mappedOwners = Object.keys(OWNER_TO_ORGANS_KEY);
    assert.deepEqual(
      Object.keys(owners).sort(), mappedOwners.sort(),
      "OWNER_TO_ORGANS_KEY in this test must track every owner added to MCP_ORGAN_OWNERS"
    );
    for (const owner of mappedOwners) {
      const organsKey = OWNER_TO_ORGANS_KEY[owner];
      assert.ok(organsKey in ORGANS, `ORGANS.${organsKey} must exist for owner "${owner}"`);
      assert.equal(
        owners[owner].path, ORGANS[organsKey],
        `capability-registry's path for "${owner}" has drifted from mcp-tools.js's ORGANS.${organsKey}`
      );
    }
  });
});
