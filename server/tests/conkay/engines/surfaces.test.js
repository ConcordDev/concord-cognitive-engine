/**
 * SXE-00 surface wiring tests.
 *
 * The done criteria require the framework to be visible on both public
 * surfaces: GET /api/conkay/engines and MCP conkay_engine_list, both
 * serving the one engineListReport. The MCP side is exercised end to
 * end here (bridge function + capability catalogue + tool registry).
 * The REST route cannot be exercised without booting the server, so it
 * is pinned by source shape: the route registration and its import of
 * the same report function.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  HERMES_USER_ID,
  HERMES_BRIDGE_DEFAULT_SCOPES,
} from "../../../lib/mcp-hermes-identity.js";
import { conkayEngineListMcp } from "../../../lib/mcp-execution-bridge.js";
import { MCP_EXECUTION_BRIDGE_CAPABILITIES } from "../../../domains/mcp-execution-bridge.js";
import { MCP_TOOLS } from "../../../lib/mcp-tools.js";
import { defineEngine, _clearEngines } from "../../../lib/conkay/engines/manifest.js";

const HERMES = {
  id: HERMES_USER_ID,
  userId: HERMES_USER_ID,
  role: "sovereign",
  scopes: [...HERMES_BRIDGE_DEFAULT_SCOPES],
};

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, "..", "..", "..");

test("conkay_engine_list bridge call returns the engine report", async () => {
  _clearEngines();
  defineEngine({
    id: "surface-fixture",
    version: "0.1.0",
    licence: "BSD-3-Clause",
    linkMode: "process",
    envVar: "SURFACE_FIXTURE_BIN",
    defaultPath: process.execPath,
    healthOp: "health",
    ops: ["health"],
    kernel: join(here, "framework.test.js"),
    installHint: "test fixture",
  });
  const r = await conkayEngineListMcp(null, {}, null, { actor: HERMES });
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.engines[0].id, "surface-fixture");
  assert.equal(r.engines[0].present, true);
  assert.equal(r.engines[0].engineDependent, true);
  assert.equal(r.actor_id, HERMES_USER_ID);
  _clearEngines();
  const empty = await conkayEngineListMcp(null, {}, null, { actor: HERMES });
  assert.equal(empty.ok, true);
  assert.equal(empty.total, 0);
});

test("capability catalogue + tool registry carry conkay_engine_list", () => {
  const cap = MCP_EXECUTION_BRIDGE_CAPABILITIES.find((c) => c.capability === "conkay.engine_list");
  assert.ok(cap, "conkay.engine_list capability entry exists");
  assert.equal(cap.mcp_tool_name, "conkay_engine_list");
  assert.equal(cap.risk, "read");
  const tool = MCP_TOOLS.find((t) => t.name === "conkay_engine_list");
  assert.ok(tool, "conkay_engine_list is a registered MCP tool");
  assert.ok(
    globalThis.__concordMcpBuiltinTools?.has("conkay_engine_list"),
    "conkay_engine_list is in the mcp_builtin reachability set",
  );
});

test("REST route serves the same report (source pin; server boot is desk-side)", () => {
  const src = readFileSync(join(serverRoot, "routes", "system.js"), "utf8");
  assert.ok(src.includes('app.get("/api/conkay/engines"'), "route registered");
  assert.ok(
    src.includes('from "../lib/conkay/engines/index.js"'),
    "route imports engineListReport from the framework index",
  );
  const mcpTools = readFileSync(join(serverRoot, "lib", "mcp-tools.js"), "utf8");
  assert.ok(mcpTools.includes('case "conkay_engine_list"'), "mcp-tools dispatch case present");
  const chatAgent = readFileSync(join(serverRoot, "lib", "chat-agent.js"), "utf8");
  assert.ok(chatAgent.includes('case "conkay_engine_list"'), "chat-agent dispatch case present");
});
