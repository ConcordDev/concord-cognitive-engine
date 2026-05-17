// server/domains/agent-marketplace.js
//
// Phase 13 (Stage C) — agent marketplace macros.
//
// Surface:
//   agent.validate           — validator-only (safe for publicReadDomains)
//   agent.mint               — mint kind='agent_spec' DTU
//   agent.publish            — mint + list in one step
//   agent.list_for_user      — read path
//   agent.earnings           — read path
//   agent.load               — load + re-validate manifest
//   agent.run                — execute a published agent via sandboxed ctx

import {
  mintAgentAsDtu,
  listAgentOnMarketplace,
  listAgentsForUser,
  getAgentEarnings,
  loadAgent,
} from "../lib/agent-marketplace.js";
import { validateAgentManifest } from "../lib/agent-spec-validator.js";
import { makeSandboxedCtx, CAPABILITY_DENIED } from "../lib/agent-capability-sandbox.js";

export default function registerAgentMarketplaceMacros(register) {
  register("agent", "validate", async (_ctx, input = {}) => {
    return validateAgentManifest(input.manifest);
  }, { note: "Validator-only: shape-check an agent manifest without persistence" });

  register("agent", "mint", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "auth_required" };
    return mintAgentAsDtu(db, {
      userId,
      agentManifest: input.manifest,
      summary: input.summary,
    });
  }, { note: "Mint an agent manifest as a kind='agent_spec' DTU" });

  register("agent", "publish", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "auth_required" };
    const mint = await mintAgentAsDtu(db, {
      userId,
      agentManifest: input.manifest,
      summary: input.summary,
    });
    if (!mint.ok) return mint;
    const list = listAgentOnMarketplace(db, {
      dtuId: mint.dtuId,
      sellerId: userId,
      priceCents: Number(input.priceCents) || 0,
      currency: input.currency || "USD",
      title: input.title || input.manifest?.name || "Agent",
      description: input.description || input.manifest?.description || "",
    });
    return { ok: list.ok, dtuId: mint.dtuId, citationIds: mint.citationIds, listing: list };
  }, { note: "Mint + list in one step" });

  register("agent", "list_for_user", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "missing_user" };
    return { ok: true, agents: listAgentsForUser(db, userId, Number(input.limit) || 50) };
  }, { note: "List the user's published agents" });

  register("agent", "earnings", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "auth_required" };
    return getAgentEarnings(db, userId, { agentDtuId: input.agentDtuId });
  }, { note: "Aggregate royalty earnings for the user's agents" });

  register("agent", "load", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    return loadAgent(db, String(input.dtuId || ""));
  }, { note: "Load an agent DTU + re-validate its manifest" });

  register("agent", "run", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const loaded = loadAgent(db, String(input.dtuId || ""));
    if (!loaded.ok) return loaded;
    let sandbox;
    try {
      sandbox = makeSandboxedCtx(ctx, loaded.manifest);
    } catch (err) {
      return { ok: false, reason: "sandbox_setup_failed", error: err?.message };
    }
    // The actual execution body is delegated. Callers supply a small
    // recipe: `op` = which sandboxed macro to call, `args` = its input.
    // This is intentionally narrow — running arbitrary agent code is out
    // of scope for v1; what matters is that the proxy gates correctly.
    const op = String(input.op || "");
    if (!op || !op.includes(".")) {
      return { ok: false, reason: "missing_op", hint: "input.op = '<domain>.<macro>'" };
    }
    const [domain, name] = op.split(".", 2);
    try {
      const result = await sandbox.runMacro(domain, name, input.args || {});
      return { ok: true, agentId: loaded.manifest.id, result };
    } catch (err) {
      if (err?.code === CAPABILITY_DENIED) {
        return { ok: false, reason: "capability_denied", denied: err.deniedMacro };
      }
      return { ok: false, reason: "execution_failed", error: err?.message };
    }
  }, { note: "Execute a sandboxed agent macro (capability-gated)" });
}
