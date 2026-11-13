// Three MCP tools so an outside agent can start, watch and cancel a run (CKPT-20).
// There is deliberately NO decision tool: an outside agent cannot approve a step. Only the signed-in
// person can, through POST /api/cockpit/runs/:id/decision (ARCHITECTURE.md section 11).
import { cockpitFlag } from "./flags.js";
import { getRunForUser, listSteps, updateRun } from "./run-store.js";
import { runProgress } from "./engine.js";
import { stepLabel } from "./events.js";
import { startCockpitLongTask } from "./long-task-bridge.js";
import { authorizeBridgeCall } from "../mcp-hermes-identity.js";
import { publicRun, publicStep } from "../../routes/cockpit.js";

export const COCKPIT_MCP_TOOLS = Object.freeze([
  { name: "start_run", risk: "write", requiresScopes: ["mcp:lens:compute"],
    description: "Start a multi-step job. Writes still wait for the signed-in person to approve.",
    inputSchema: { type: "object", additionalProperties: false, required: ["goal"], properties: { goal: { type: "string", maxLength: 2000 } } } },
  { name: "get_run", risk: "read", requiresScopes: ["mcp:lens:read"],
    description: "Progress and steps of one of your runs.",
    inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: { run_id: { type: "string" } } } },
  { name: "cancel_run", risk: "write", requiresScopes: ["mcp:lens:compute"],
    description: "Cancel one of your runs.",
    inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: { run_id: { type: "string" } } } },
]);

export const isCockpitMcpTool = (name) => COCKPIT_MCP_TOOLS.some((t) => t.name === name);
export const advertisedCockpitMcpTools = (env = process.env) => (cockpitFlag("LONG_TASK", env) ? COCKPIT_MCP_TOOLS : []);

// The bridge ladder knows read / compute / write / high. Starting and cancelling need only the compute
// scope (the confirm card, not the scope, is what gates a write), so they are authorized as compute.
const AUTH_RISK = { start_run: "compute", get_run: "read", cancel_run: "compute" };
const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** @returns {Promise<object>} the tool result; always { ok, ... } */
export async function callCockpitMcpTool(name, args, { db, actor, lensActions, deps } = {}) {
  if (!cockpitFlag("LONG_TASK")) return { ok: false, reason: "disabled" };
  const tool = COCKPIT_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, reason: "unknown_tool" };
  const auth = authorizeBridgeCall({ actor, tool: name, risk: AUTH_RISK[name] });
  if (!auth.ok) return { ok: false, reason: auth.reason, error: auth.error };
  const userId = auth.actorId;
  const a = args && typeof args === "object" ? args : {};

  if (name === "start_run") {
    const r = await startCockpitLongTask({ db, userId, goal: String(a.goal || "").slice(0, 2000), surface: "mcp", lensActions, deps });
    return r.ok ? { ok: true, run_id: r.runId, total: r.total } : { ok: false, reason: r.reason };
  }

  const run = getRunForUser(db, String(a.run_id || ""), userId);
  if (!run) return { ok: false, reason: "not_found" };

  if (name === "get_run") {
    const steps = listSteps(db, run.id);
    const waiting = steps.find((s) => s.status === "awaiting_confirm");
    return {
      ok: true, run: publicRun(run), steps: steps.map(publicStep), progress: runProgress(steps),
      needs_person: run.status === "awaiting_confirm" || !!waiting,
      ...(waiting ? { confirm_label: stepLabel(waiting) } : {}),
    };
  }

  // cancel_run
  if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
  updateRun(db, run.id, { status: "cancelled", finishedAt: Math.floor(Date.now() / 1000) });
  return { ok: true, run_id: run.id, status: "cancelled" };
}
