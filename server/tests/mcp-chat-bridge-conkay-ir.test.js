// Chat → MCP bridge routing + easier ConKay Design IR.
// Run: node --test --import=./tests/preload/no-egress.mjs --test-timeout=120000 \
//        tests/mcp-chat-bridge-conkay-ir.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../lib/chat-agent.js";
import { parseQuantity } from "../lib/conkay/compiler/units.js";
import { softenDesignIR, CONKAY_IR_MINI_EXAMPLE } from "../lib/conkay/compiler/soften-ir.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import { openDesign } from "../lib/conkay/index.js";
import {
  listLensActionsMcp,
  runLensActionMcp,
  conkaySolveMcp,
  conkayIrSchemaMcp,
} from "../lib/mcp-execution-bridge.js";
import { MCP_TOOLS } from "../lib/mcp-tools.js";

const ACTOR = { id: "u-chat-bridge", userId: "u-chat-bridge", role: "member", scopes: [] };

describe("parseQuantity bare SI coercion", () => {
  it("treats bare numbers as SI when expectDim is set", () => {
    const q = parseQuantity(1.5, "mass");
    assert.equal(q.ok, true);
    assert.equal(q.si, 1.5);
    assert.equal(q.dim, "mass");
    assert.equal(q.coercedBare, true);
  });
  it("treats bare position numbers as metres", () => {
    const q = parseQuantity(0, "length");
    assert.equal(q.ok, true);
    assert.equal(q.si, 0);
    assert.equal(q.dim, "length");
  });
  it("still rejects wrong dimension on unit strings", () => {
    const q = parseQuantity("1.5 kg", "length");
    assert.equal(q.ok, false);
    assert.match(q.error, /expected a length/);
    assert.match(q.error, /Use a unit string/);
  });
});

describe("softenDesignIR", () => {
  it("auto-fills massSource and aliases aluminum-5052", () => {
    const { ir, warnings } = softenDesignIR({
      design: { id: "r1" },
      nodes: [
        { id: "P1", kind: "Part", material: "aluminum-5052", props: { mass: "2 kg" } },
      ],
      edges: [],
      loadCases: [],
      requirements: ["be light"],
    });
    assert.equal(ir.nodes[0].material, "aluminum-6061-t6-b221");
    assert.match(ir.nodes[0].props.massSource, /caller assumption/);
    assert.equal(ir.requirements.length, 0);
    assert.ok(warnings.some((w) => /massSource/.test(w)));
    assert.ok(warnings.some((w) => /aluminum-5052/.test(w)));
    assert.ok(warnings.some((w) => /requirements/.test(w)));
  });

  it("compiles a mass-only node that previously needed massSource", () => {
    const c = compileDesignIR({
      design: { id: "m1" },
      nodes: [{ id: "P1", kind: "Part", props: { mass: "1 kg" } }],
      edges: [],
      loadCases: [],
      requirements: [],
    });
    assert.equal(c.ok, true, c.errors?.join("; "));
    assert.ok((c.warnings || []).some((w) => /massSource/.test(w)));
  });
});

describe("MCP tools surface includes conkay_ir_schema", () => {
  it("lists conkay_ir_schema", () => {
    assert.ok(MCP_TOOLS.some((t) => t.name === "conkay_ir_schema"));
  });
});

describe("chat executeToolCall uses MCP bridge", () => {
  before(() => {
    globalThis.__concordLensActions = new Map([
      ["physics.power", async () => ({ ok: true, watts: 42 })],
    ]);
    globalThis.__concordRunMacro = async () => ({ ok: false, error: "no macro" });
  });
  after(() => {
    delete globalThis.__concordLensActions;
    delete globalThis.__concordRunMacro;
  });

  it("run_lens_action returns via mcp_execution_bridge and audited", async () => {
    const r = await executeToolCall(
      { actor: ACTOR, db: null },
      globalThis.__concordRunMacro,
      globalThis.__concordLensActions,
      { tool: "run_lens_action", params: { domain: "physics", action: "power", params: {} } },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, "mcp_execution_bridge");
    assert.equal(r.audited, true);
    assert.equal(r.result?.watts, 42);
  });

  it("list_lens_actions returns via mcp_execution_bridge", async () => {
    const r = await executeToolCall(
      { actor: ACTOR },
      globalThis.__concordRunMacro,
      globalThis.__concordLensActions,
      { tool: "list_lens_actions", params: { domain: "physics" } },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, "mcp_execution_bridge");
    assert.equal(r.audited, true);
    assert.ok(r.actions.some((a) => a.action === "power"));
  });

  it("run_lens_action dry_run previews without dispatch", async () => {
    let hits = 0;
    globalThis.__concordLensActions.set("physics.power", async () => {
      hits += 1;
      return { ok: true };
    });
    const r = await executeToolCall(
      { actor: ACTOR },
      null,
      globalThis.__concordLensActions,
      { tool: "run_lens_action", params: { domain: "physics", action: "power", params: {}, dry_run: true } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.dry_run, true);
    assert.equal(hits, 0);
    assert.equal(r.via, "mcp_execution_bridge");
  });

  it("conkay_ir_schema returns example", async () => {
    const r = await executeToolCall(
      { actor: ACTOR },
      null,
      new Map(),
      { tool: "conkay_ir_schema", params: {} },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, "mcp_execution_bridge");
    assert.equal(r.example.design.id, CONKAY_IR_MINI_EXAMPLE.design.id);
    assert.ok(Array.isArray(r.hints) && r.hints.length > 0);
  });

  it("conkay_solve accepts IR that used to fail massSource", async () => {
    const r = await executeToolCall(
      { actor: ACTOR },
      null,
      new Map(),
      {
        tool: "conkay_solve",
        params: {
          solver_id: "mass.budget",
          ir: {
            design: { id: "soft" },
            nodes: [
              { id: "A1", kind: "Assembly" },
              { id: "P1", kind: "Part", props: { mass: "2 kg" } },
            ],
            edges: [{ type: "CONTAINS", from: "A1", to: "P1" }],
            loadCases: [],
            requirements: [],
          },
        },
      },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, "mcp_execution_bridge");
    assert.ok(["PASS", "WARN", "NOT_COMPUTED", "FAIL"].includes(r.status), r.status);
  });
});

describe("bridge handlers share path with chat", () => {
  before(() => {
    globalThis.__concordLensActions = new Map([
      ["dtu.search", async () => ({ ok: true, hits: [] })],
    ]);
  });
  after(() => {
    delete globalThis.__concordLensActions;
  });

  it("listLensActionsMcp + chat list agree on domain actions", async () => {
    const mcp = await listLensActionsMcp(null, { domain: "dtu" }, null, { actor: ACTOR });
    const chat = await executeToolCall(
      { actor: ACTOR },
      null,
      globalThis.__concordLensActions,
      { tool: "list_lens_actions", params: { domain: "dtu" } },
    );
    assert.equal(mcp.ok, true);
    assert.equal(chat.ok, true);
    assert.deepEqual(
      mcp.actions.map((a) => a.action).sort(),
      chat.actions.map((a) => a.action).sort(),
    );
  });

  it("conkayIrSchemaMcp returns audited example", async () => {
    const r = await conkayIrSchemaMcp(null, {}, null, { actor: ACTOR });
    assert.equal(r.ok, true);
    assert.equal(r.audited, true);
    assert.ok(r.example.nodes[0].props.massSource);
  });

  it("openDesign accepts bare position numbers", () => {
    const opened = openDesign({
      design: { id: "pos" },
      nodes: [
        { id: "P1", kind: "Part", position: { x: 0, y: 0, z: 1 }, props: { mass: "1 kg" } },
      ],
      edges: [],
      loadCases: [],
      requirements: [],
    });
    assert.equal(opened.ok, true, opened.errors?.join("; "));
  });
});
