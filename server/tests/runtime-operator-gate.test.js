// server/tests/runtime-operator-gate.test.js
//
//   cd server && node --test tests/runtime-operator-gate.test.js
//
// Pins lib/runtime/operator-gate.js and the Concord Runtime's chat wiring.
// Before the gate (verified live 2026-09-27), any signed-up member — directly
// via /api/lens/run or through Concord chat — could read the Zuko Kalshi book,
// Dila's AutoTrader limits, env-var names, the agent vault, and resolve
// Dila's live-trade prediction tickets; `homes` overrides let them aim the
// readers at arbitrary directories.

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load } from "./depth/_harness.js";
import { isOperator, operatorOnlyRegistrar, PRIVATE_CAPABILITY_OWNERS } from "../lib/runtime/operator-gate.js";
import { listCapabilities, checkCapabilityHealth } from "../lib/runtime/capability-registry.js";
import { runCapability } from "../lib/runtime/execution-envelope.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { executeObserveOrgan } from "../lib/v6-observe-bridge.js";

describe("Concord Runtime operator gate + chat wiring", () => {
  let runMacro, operator, member;

  before(async () => {
    const h = await load();
    runMacro = h.runMacro;
    operator = h.makeInternalCtx("gate-operator");
    member = h.makeInternalCtx("gate-member");
    member.actor = { userId: "u_gate_member", role: "member", scopes: ["read", "write"] };
    member.internal = false;
  });

  test("isOperator: operator roles + trusted internal calls only", () => {
    for (const role of ["owner", "founder", "sovereign", "admin"]) assert.equal(isOperator({ actor: { role } }), true, role);
    for (const role of ["member", "viewer", "", undefined]) assert.equal(isOperator({ actor: { role } }), false, String(role));
    assert.equal(isOperator({ actor: { role: "system", internal: true } }), true);
    assert.equal(isOperator({ actor: { role: "member", internal: true } }), false, "internal flag alone is not enough");
    assert.equal(isOperator(null), false);
  });

  test("operatorOnlyRegistrar gates every handler it registers", async () => {
    const seen = new Map();
    const reg = operatorOnlyRegistrar((d, n, fn) => seen.set(`${d}.${n}`, fn));
    reg("x", "y", () => ({ ok: true, secret: 1 }));
    const fn = seen.get("x.y");
    assert.deepEqual(await fn({ actor: { role: "owner" } }), { ok: true, secret: 1 });
    const denied = await fn({ actor: { role: "member" } });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "operator_only");
  });

  test("private sister systems deny members and serve the operator (lens actions)", async () => {
    const la = globalThis.__concordLensActions;
    for (const key of ["zuko.observe", "zuko.status", "trading.observe", "pentester.status",
      "constellation.status", "dila.status", "dila.coding_pipeline", "predict.list", "predict.resolve"]) {
      const h = la.get(key);
      assert.ok(h, `${key} registered`);
      const r = await h(member, null, { homes: { zuko: "/tmp", trading: "/tmp" } });
      assert.equal(r?.reason, "operator_only", `${key} must deny a member`);
    }
    const ok = await la.get("zuko.status")(operator, null, {});
    assert.equal(ok.ok, true);
    assert.equal(ok.executeLocked, true, "operator access still never unlocks execute");
  });

  test("mission runtime (MACROS family) is operator-only too", async () => {
    const denied = await runMacro("mission", "supervisor", {}, member);
    assert.equal(denied?.reason, "operator_only");
    const ok = await runMacro("mission", "supervisor", {}, operator);
    assert.equal(ok?.ok, true);
  });

  test("every non-organ capability descriptor names a real handler", () => {
    // Organ (mcp) reachability depends on scripts on the operator's machine.
    const dead = listCapabilities()
      .filter((c) => c.implementation !== "mcp")
      .filter((c) => !checkCapabilityHealth(c.capability).reachable)
      .map((c) => c.capability);
    assert.deepEqual(dead, [], "descriptor names must match a registered lens action or macro");
  });

  test("runCapability: organ capabilities are operator-only, never run as macros", async () => {
    const organ = listCapabilities().find((c) => c.implementation === "mcp" && c.risk === "read");
    assert.ok(organ, "at least one organ capability is registered");
    const r = await runCapability({ capability: organ.capability, ctx: member, input: {} });
    assert.equal(r.status, "error");
    assert.ok(["operator_only", "capability_unreachable"].includes(r.reason), r.reason);
    assert.notEqual(r.reason, "handler_threw", "organs must not fall through to runMacro");
  });

  test("chat list_capabilities hides private systems from members", async () => {
    const m = await executeToolCall(member, runMacro, globalThis.__concordLensActions, { tool: "list_capabilities", params: {} });
    assert.equal(m.ok, true);
    assert.equal(m.operator, false);
    assert.deepEqual(m.capabilities.filter((c) => PRIVATE_CAPABILITY_OWNERS.includes(c.owner)), []);
    assert.ok(m.capabilities.some((c) => c.owner === "concordia"), "public Concordia stays discoverable");

    const o = await executeToolCall(operator, runMacro, globalThis.__concordLensActions, { tool: "list_capabilities", params: {} });
    assert.ok(o.capabilities.some((c) => c.capability === "zuko.status"));
  });

  test("chat invoke_capability: member gets operator_only, operator gets the real system", async () => {
    const la = globalThis.__concordLensActions;
    const m = await executeToolCall(member, runMacro, la, { tool: "invoke_capability", params: { capability: "zuko.status" } });
    assert.equal(m.ok, false);
    assert.equal(m.error, "operator_only");
    const o = await executeToolCall(operator, runMacro, la, { tool: "invoke_capability", params: { capability: "mission.supervisor" } });
    assert.equal(o.ok, true, JSON.stringify(o).slice(0, 300));
  });

  test("polymarket: operator-only, read-only, execute locked, credentials never read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-home-"));
    try {
      const SECRET = "pk_live_DO_NOT_LEAK_7f3a";
      fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify({ private_key: SECRET, api_key: SECRET }));
      fs.writeFileSync(path.join(dir, "live_favorites_state.json"), JSON.stringify({ cycle_count: 7, orders_placed_total: 3, seen_markets: { a: {}, b: {} }, wallet: SECRET }));
      fs.writeFileSync(path.join(dir, "entry_ledger.json"), JSON.stringify({ m1: { fills: [], vwap: 0.4 } }));
      const la = globalThis.__concordLensActions;
      const homes = { polymarket: dir };
      assert.equal((await la.get("polymarket.status")(member, null, { homes })).reason, "operator_only");
      const r = await la.get("polymarket.status")(operator, null, { homes });
      assert.equal(r.present, true);
      assert.deepEqual(r.bot, { cycleCount: 7, ordersPlacedTotal: 3, marketsSeen: 2 });
      assert.equal(r.positions.entries, 1);
      assert.equal(JSON.stringify(r).includes(SECRET), false, "no secret may leave the observer");
      const ex = await la.get("polymarket.execute")(operator, null, { market: "m1" });
      assert.equal(ex.reason, "locked");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("chat.respond observe bridge: agent vault and worker state are operator-only", async () => {
    for (const tool of ["vault_read", "vault_stats", "dila_status", "dila_workers", "incident_active", "pod_status"]) {
      const r = await executeObserveOrgan({ tool, params: { namespace: "x" } }, { runMacro, ctx: member });
      assert.equal(r.error, "operator_only", tool);
    }
  });
});
