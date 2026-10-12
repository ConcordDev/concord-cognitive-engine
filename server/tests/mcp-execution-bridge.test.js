// server/tests/mcp-execution-bridge.test.js
//
// Targeted tests for the MCP Execution Bridge (lens actions + ConKay solvers).
// Does NOT boot the full server for most cases — exercises the bridge modules
// + capability registration + Hermes identity directly.
//
// Run: node --test --import=./tests/preload/no-egress.mjs --test-timeout=120000 \
//        tests/mcp-execution-bridge.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_USER_ID,
  HERMES_BRIDGE_DEFAULT_SCOPES,
  classifyLensActionRisk,
  authorizeBridgeCall,
  rejectImpersonation,
  BRIDGE_RISK,
} from "../lib/mcp-hermes-identity.js";
import {
  runLensActionMcp,
  listLensActionsMcp,
  conkaySolverListMcp,
  conkaySolveMcp,
} from "../lib/mcp-execution-bridge.js";
import {
  registerCapability,
  getCapabilityDescriptor,
  checkCapabilityHealth,
  _resetRegistry,
} from "../lib/runtime/capability-registry.js";
import { MCP_EXECUTION_BRIDGE_CAPABILITIES } from "../domains/mcp-execution-bridge.js";
import { MCP_TOOLS } from "../lib/mcp-tools.js";

const HERMES = {
  id: HERMES_USER_ID,
  userId: HERMES_USER_ID,
  role: "sovereign",
  scopes: [...HERMES_BRIDGE_DEFAULT_SCOPES],
};

const BRACKET_IR = {
  design: { id: "bracket", name: "Lap-splice bracket" },
  materials: {
    "astm-a325": { costPerKgUsd: "4 USD/kg", source: "test price" },
  },
  nodes: [
    { id: "A1", kind: "Assembly", name: "Bracket" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "P2", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
    { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
    { id: "J1", kind: "Joint", name: "Splice", props: { shearPlanes: 1 } },
  ],
  edges: [
    ...["P1", "P2", "B1", "B2", "J1"].map((to) => ({ type: "CONTAINS", from: "A1", to })),
    ...["P1", "P2", "B1", "B2"].map((to) => ({ type: "CONTAINS", from: "J1", to })),
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
  requirements: [],
};

describe("MCP tools surface includes bridge tools", () => {
  it("registers run_lens_action, list_lens_actions, conkay_solve, conkay_solver_list", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const n of ["run_lens_action", "list_lens_actions", "conkay_solve", "conkay_solver_list"]) {
      assert.ok(names.has(n), `missing ${n}`);
    }
  });
});

describe("Capability registration (no unregistered_but_dispatchable)", () => {
  before(() => {
    _resetRegistry();
    for (const cap of MCP_EXECUTION_BRIDGE_CAPABILITIES) {
      const r = registerCapability(cap);
      assert.equal(r.ok, true, r.reason);
    }
    globalThis.__concordMcpBuiltinTools = new Set(
      MCP_EXECUTION_BRIDGE_CAPABILITIES.map((c) => c.mcp_tool_name)
    );
  });

  after(() => {
    _resetRegistry();
  });

  it("registers all four bridge capabilities with mcp_builtin", () => {
    for (const cap of MCP_EXECUTION_BRIDGE_CAPABILITIES) {
      const d = getCapabilityDescriptor(cap.capability);
      assert.ok(d, cap.capability);
      assert.equal(d.implementation, "mcp_builtin");
      assert.equal(d.mcp_tool_name, cap.mcp_tool_name);
      const health = checkCapabilityHealth(cap.capability);
      assert.equal(health.reachable, true, `${cap.capability}: ${health.reason}`);
    }
  });
});

describe("Hermes service identity", () => {
  it("rejects impersonation args", () => {
    const r = rejectImpersonation(HERMES, { as_user: "ramaj", domain: "physics", action: "power" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "impersonation_forbidden");
  });

  it("rejects cross-tenant params.userId", () => {
    const r = rejectImpersonation(HERMES, {
      domain: "dtu",
      action: "get",
      params: { userId: "someone-else" },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "tenant_isolation");
  });

  it("classifies pay/publish as high and list as compute", () => {
    assert.equal(classifyLensActionRisk("marketplace", "purchase"), BRIDGE_RISK.HIGH);
    assert.equal(classifyLensActionRisk("physics", "power"), BRIDGE_RISK.COMPUTE);
  });

  it("denies write without mcp:lens:write", () => {
    const r = authorizeBridgeCall({
      actor: HERMES,
      tool: "run_lens_action",
      risk: BRIDGE_RISK.WRITE,
      domain: "physics",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "scope_denied");
  });

  it("denies high-risk without approval", () => {
    const actor = { ...HERMES, scopes: [...HERMES_BRIDGE_DEFAULT_SCOPES, "mcp:lens:high"] };
    const r = authorizeBridgeCall({
      actor,
      tool: "run_lens_action",
      risk: BRIDGE_RISK.HIGH,
      approval: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "approval_required");
  });

  it("allows compute under default Hermes scopes", () => {
    const r = authorizeBridgeCall({
      actor: HERMES,
      tool: "run_lens_action",
      risk: BRIDGE_RISK.COMPUTE,
      domain: "physics",
    });
    assert.equal(r.ok, true);
  });

  it("requires auth (anon blocked)", () => {
    const r = authorizeBridgeCall({
      actor: null,
      tool: "conkay_solve",
      risk: BRIDGE_RISK.COMPUTE,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });
});

describe("run_lens_action / list_lens_actions (in-process)", () => {
  before(() => {
    // Minimal dual-registry stub
    const lens = new Map();
    lens.set("physics.power", async (_ctx, _a, input) => ({
      ok: true,
      watts: Number(input?.v || 0) * Number(input?.i || 0),
    }));
    globalThis.__concordLensActions = lens;
    globalThis.__concordRunMacro = async (domain, name) => {
      throw new Error(`macro not found: ${domain}.${name}`);
    };
    globalThis._concordMACROS = new Map([
      ["physics", new Map([["power", { handler: () => {} }]])],
    ]);
  });

  after(() => {
    delete globalThis.__concordLensActions;
    delete globalThis.__concordRunMacro;
    delete globalThis._concordMACROS;
  });

  it("lists actions for a domain", async () => {
    const r = await listLensActionsMcp(null, { domain: "physics" }, null, { actor: HERMES });
    assert.equal(r.ok, true);
    assert.ok(r.actions.some((a) => a.action === "power"));
  });

  it("runs a real lens action", async () => {
    const r = await runLensActionMcp(
      null,
      { domain: "physics", action: "power", params: { v: 12, i: 3 } },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.watts, 36);
    assert.equal(r.actor_id, HERMES_USER_ID);
    assert.equal(r.audited, true);
  });

  it("dry_run does not dispatch", async () => {
    let called = false;
    globalThis.__concordLensActions.set("physics.power", async () => {
      called = true;
      return { ok: true };
    });
    const r = await runLensActionMcp(
      null,
      { domain: "physics", action: "power", params: { v: 1, i: 1 }, dry_run: true },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, true);
    assert.equal(r.dry_run, true);
    assert.equal(called, false);
  });

  it("blocks high-risk without approval", async () => {
    globalThis.__concordLensActions.set("marketplace.purchase", async () => ({ ok: true }));
    globalThis._concordMACROS.set("marketplace", new Map([["purchase", {}]]));
    const r = await runLensActionMcp(
      null,
      { domain: "marketplace", action: "purchase", params: {} },
      null,
      { actor: { ...HERMES, scopes: [...HERMES_BRIDGE_DEFAULT_SCOPES, "mcp:lens:high"] } }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "approval_required");
  });

  it("blocks anon", async () => {
    const r = await runLensActionMcp(
      null,
      { domain: "physics", action: "power", params: { v: 1, i: 1 } },
      null,
      { actor: null }
    );
    assert.equal(r.ok, false);
    assert.ok(r.reason === "auth_required" || r.error);
  });

  it("honors API-key scopes over user-row wildcard", async () => {
    const r = await runLensActionMcp(
      null,
      { domain: "physics", action: "power", params: { v: 2, i: 2 } },
      null,
      {
        actor: { id: HERMES_USER_ID, role: "sovereign", scopes: ["*"] },
        req: { apiKey: { scopes: ["mcp:lens:read"] } }, // compute denied
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "scope_denied");
  });
});

describe("conkay_solve / conkay_solver_list", () => {
  it("lists solvers from the registry", async () => {
    const r = await conkaySolverListMcp(null, {}, null, { actor: HERMES });
    assert.equal(r.ok, true);
    assert.ok(r.total >= 20, `expected many solvers, got ${r.total}`);
    assert.ok(r.solvers.some((s) => s.id === "joint.bolt-shear"));
  });

  it("runs joint.bolt-shear with provenance", async () => {
    const r = await conkaySolveMcp(
      null,
      { solver_id: "joint.bolt-shear", ir: BRACKET_IR, target: "J1" },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, true, r.error || r.reason);
    assert.ok(r.results?.length >= 1);
    const env = r.results[0];
    assert.ok(["PASS", "FAIL", "WARN", "NOT_COMPUTED"].includes(env.status));
    assert.ok(env.provenance?.kind);
    assert.ok(["sourced", "computed", "estimated", "assumed", "unknown"].includes(env.provenance.kind));
    assert.equal(typeof env.provenance.screening === "boolean" || env.provenance.screening == null, true);
  });

  it("unknown solver stays honest", async () => {
    const r = await conkaySolveMcp(
      null,
      { solver_id: "not.a.real.solver", ir: BRACKET_IR },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_solver");
  });

  it("dry_run previews targets", async () => {
    const r = await conkaySolveMcp(
      null,
      { solver_id: "joint.bolt-shear", ir: BRACKET_IR, dry_run: true },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, true);
    assert.equal(r.dry_run, true);
    assert.ok(Array.isArray(r.preview.targets));
  });

  it("tenant-isolates designId ownership", async () => {
    const fakeDb = {
      prepare() {
        return {
          get() {
            return { id: "dsg_x", owner_id: "other-user", ir_json: JSON.stringify(BRACKET_IR) };
          },
        };
      },
    };
    const r = await conkaySolveMcp(
      fakeDb,
      { solver_id: "joint.bolt-shear", designId: "dsg_x" },
      null,
      { actor: HERMES }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "tenant_isolation");
  });
});
