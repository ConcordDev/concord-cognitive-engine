// server/domains/mission-runtime.js
//
// P0 — Mission Task Runtime macros + capability registry entries.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import {
  abandonMission,
  createMission,
  getMission,
  listMissions,
  pauseMission,
  planMissionGoal,
  runtimeOverview,
  tickMission,
} from "../lib/mission-runtime.js";
import { listTemplateNames } from "../lib/mission-templates.js";
import { collectFullSupervisorStatus } from "../lib/runtime/supervisor.js";
import { listDomainPacks } from "../lib/runtime/domain-packs.js";
import { runBenchmark } from "../lib/runtime/dila-bench.js";
import { createDilaMission, kickoffDilaMission } from "../lib/dila-mission.js";
import { routeModel, routingStats } from "../lib/runtime/model-router.js";
import { orgOverview } from "../lib/runtime/agent-org.js";
import { buildSupervisorTree } from "../lib/runtime/supervisor-tree.js";
import { recoveryOverview } from "../lib/runtime/recovery.js";
import { listImprovementProposals } from "../lib/runtime/self-improvement.js";
import { runWorkspaceAudit, listWorkspaceAudits } from "../lib/runtime/workspace-audit.js";
import { runAgentLoopPhase } from "../lib/runtime/agent-loop.js";
import { getMissionControlPlane, getMissionControlDetail } from "../lib/runtime/mission-control.js";
import { computeDilaCapabilityIndex } from "../lib/runtime/dila-capability-index.js";
import { listConfig } from "../lib/runtime/runtime-config.js";
import { listCapabilities, forgeCapabilityFromNeed } from "../lib/capability-forge/index.js";
import { causalMemoryOverview } from "../lib/runtime/causal-memory.js";
import { operatorOnlyRegistrar } from "../lib/runtime/operator-gate.js";

// Each capability name MUST equal a real `register(domain, name)` below —
// checkCapabilityHealth resolves the name literally. (Four were registered
// under names no handler used, so they reported unreachable.)
const CAPABILITY_DESCRIPTORS = [
  { capability: "mission.create", owner: "mission-runtime", risk: "write", description: "Create a durable multi-step organ mission.", dependencies: ["db", "dispatchMCP"] },
  { capability: "mission.list", owner: "mission-runtime", risk: "read", description: "List mission tasks.", dependencies: ["db"] },
  { capability: "mission.get", owner: "mission-runtime", risk: "read", description: "Get mission detail + step log.", dependencies: ["db"] },
  { capability: "mission.tick", owner: "mission-runtime", risk: "write", description: "Advance mission by one F0-gated organ step.", dependencies: ["db", "dispatchMCP"] },
  { capability: "mission.pause", owner: "mission-runtime", risk: "write", description: "Pause a running mission.", dependencies: ["db"] },
  { capability: "mission.abandon", owner: "mission-runtime", risk: "write", description: "Abandon a mission (terminal).", dependencies: ["db"] },
  { capability: "mission.overview", owner: "mission-runtime", risk: "read", description: "Mission runtime health + counts.", dependencies: ["db"] },
  { capability: "mission.plan", owner: "mission-runtime", risk: "read", description: "Plan mission steps from a goal (deterministic or LLM).", dependencies: ["db"] },
  { capability: "mission.supervisor", owner: "mission-runtime", risk: "read", description: "Aggregate runtime subsystem health.", dependencies: ["db", "dispatchMCP"] },
  { capability: "mission.benchmark", owner: "mission-runtime", risk: "write", description: "Run DilaBench scenarios.", dependencies: ["db", "dispatchMCP"] },
  { capability: "dila.kickoff_mission", owner: "mission-runtime", risk: "write", description: "Kick off a Dila-owned mission with agent loop.", dependencies: ["db", "dispatchMCP"] },
  { capability: "dila.workspace_audit", owner: "mission-runtime", risk: "read", description: "Audit workspace keys and data sources.", dependencies: ["db"] },
  { capability: "dila.mission_control", owner: "mission-runtime", risk: "read", description: "Mission control plane aggregate.", dependencies: ["db"] },
  { capability: "dila.capability_index", owner: "mission-runtime", risk: "read", description: "Dila capability index (20 dimensions).", dependencies: ["db"] },
  { capability: "dila.runtime_config", owner: "mission-runtime", risk: "read", description: "Ouroboros-promoted runtime config KV.", dependencies: ["db"] },
];

for (const descriptor of CAPABILITY_DESCRIPTORS) registerCapability(descriptor);

async function getDispatch() {
  const mod = await import("../lib/auth-gate/dispatch.js");
  return mod.dispatchMCP;
}

export default function registerMissionRuntimeMacros(rawRegistrar) {
  // Operator-only: private sister-system state (lib/runtime/operator-gate.js).
  const register = operatorOnlyRegistrar(rawRegistrar);
  register("mission", "create", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId || ctx?.actor?.id || "system";
    const fn = input.asDila ? createDilaMission : createMission;
    return fn(db, {
      template: input.template,
      title: input.title,
      goal: input.goal,
      steps: input.steps,
      source: input.source || "operator",
      sourceRef: input.sourceRef,
      spawnContext: input.spawnContext,
      userId: input.asDila ? undefined : userId,
      maxSteps: input.maxSteps,
      asDila: input.asDila,
      ownerAgentId: input.ownerAgentId,
      executionMode: input.executionMode,
      decomposeParallel: input.decomposeParallel,
    });
  }, { note: "Create a durable mission orchestrating organ MCP tools through F0." });

  register("mission", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, missions: listMissions(db, input), templates: listTemplateNames() };
  }, { note: "List missions with optional status filter." });

  register("mission", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    const mission = getMission(db, input.missionId);
    if (!mission) return { ok: false, reason: "not_found" };
    return { ok: true, mission };
  }, { note: "Get mission + per-step F0 dispatch log." });

  register("mission", "tick", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    const dispatchMCP = await getDispatch();
    return tickMission({
      db,
      missionId: input.missionId,
      dispatchMCP,
      STATE: ctx?.STATE || globalThis.STATE || null,
    });
  }, { note: "Advance mission one step via F0 dispatchMCP." });

  register("mission", "pause", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    return pauseMission(db, input.missionId);
  }, { note: "Pause a pending/running mission." });

  register("mission", "abandon", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    return abandonMission(db, input.missionId);
  }, { note: "Abandon a mission (terminal)." });

  register("mission", "overview", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return runtimeOverview(db);
  }, { note: "Mission runtime health snapshot for mission control." });

  register("mission", "plan", async (ctx, input = {}) => {
    return planMissionGoal({
      goal: input.goal,
      plannerMode: input.plannerMode,
      templateHint: input.templateHint,
      spawnContext: input.spawnContext,
      ctx,
    });
  }, { note: "Plan mission steps from a natural-language goal." });

  register("mission", "supervisor", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dispatchMCP = await getDispatch();
    const status = await collectFullSupervisorStatus({ db, dispatchMCP });
    return { ok: true, ...status };
  }, { note: "Runtime supervisor aggregate + hierarchical tree." });

  register("mission", "domain_packs", async () => {
    return { ok: true, packs: listDomainPacks() };
  }, { note: "List autonomous domain packs." });

  register("mission", "benchmark", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dispatchMCP = await getDispatch();
    return runBenchmark({ db, dispatchMCP, suite: input.suite || "dila_core", scenarioIds: input.scenarioIds });
  }, { note: "Run DilaBench harness." });

  register("mission", "coding_loop", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.goal) return { ok: false, reason: "missing_goal" };
    const dispatchMCP = await getDispatch();
    const { runCodingLoopIteration } = await import("../lib/coding-loop.js");
    const { allowedRepoRoot } = await import("../lib/runtime/repo-graph.js");
    const repoRoot = allowedRepoRoot(input.repoRoot);
    if (!repoRoot) return { ok: false, reason: "repo_root_not_allowed" };
    return runCodingLoopIteration({ db, goal: input.goal, dispatchMCP, repoRoot });
  }, { note: "Run one coding-loop iteration (index → search → verify)." });

  register("mission", "spawn_marathon", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    const mission = getMission(db, input.missionId);
    if (!mission) return { ok: false, reason: "not_found" };
    const { spawnMarathonForMission, kickstartAndTickMarathon } = await import("../lib/mission-marathon-bridge.js");
    const spawn = spawnMarathonForMission(db, mission, input);
    if (spawn.ok && input.tick) await kickstartAndTickMarathon(db, spawn.sessionId);
    return spawn;
  }, { note: "Spawn marathon session linked to a mission." });

  register("dila", "kickoff_mission", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.goal) return { ok: false, reason: "missing_goal" };
    const dispatchMCP = await getDispatch();
    return kickoffDilaMission({ db, goal: input.goal, template: input.template, dispatchMCP, opts: input });
  }, { note: "Dila-owned mission kickoff with executive agent loop." });

  register("dila", "route_model", async (ctx, input = {}) => {
    const db = ctx?.db;
    return routeModel({ db, ...input });
  }, { note: "Runtime model router — task class to provider/worker." });

  register("dila", "org_overview", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return orgOverview(db);
  }, { note: "Multi-agent org worker reliability overview." });

  register("dila", "supervisor_tree", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return buildSupervisorTree(db);
  }, { note: "Hierarchical Dila supervisor tree." });

  register("dila", "agent_loop", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    const mission = getMission(db, input.missionId);
    if (!mission) return { ok: false, reason: "not_found" };
    const dispatchMCP = await getDispatch();
    return runAgentLoopPhase({ db, mission, dispatchMCP, phase: input.phase });
  }, { note: "Run one executive agent-loop phase." });

  register("dila", "workspace_audit", async (ctx) => {
    const db = ctx?.db;
    return runWorkspaceAudit({ db });
  }, { note: "Audit env keys and data source wiring (no secret values)." });

  register("dila", "recovery_overview", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return recoveryOverview(db);
  }, { note: "Mission failure recovery metrics." });

  register("dila", "routing_stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return routingStats(db, input.taskClass);
  }, { note: "Learned model routing statistics." });

  register("dila", "improvements", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, proposals: listImprovementProposals(db, input.limit) };
  }, { note: "Self-improvement proposals from completed missions." });

  register("dila", "mission_control", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return getMissionControlPlane(db);
  }, { note: "Mission control plane — missions, workers, capability index, recovery." });

  register("dila", "mission_detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.missionId) return { ok: false, reason: "missing_mission_id" };
    return getMissionControlDetail(db, input.missionId);
  }, { note: "Full mission control detail — ledger, causal memory, recovery." });

  register("dila", "capability_index", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return computeDilaCapabilityIndex(db);
  }, { note: "Dila capability index across 20 measured dimensions." });

  register("dila", "runtime_config", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, entries: listConfig(db, input.prefix || "") };
  }, { note: "Runtime config KV (Ouroboros promotions)." });

  register("dila", "capabilities", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, capabilities: listCapabilities(db, { status: input.status, limit: input.limit }) };
  }, { note: "Capability forge registry." });

  register("dila", "forge_capability", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.need) return { ok: false, reason: "missing_need" };
    return forgeCapabilityFromNeed(db, { need: input.need, tools: input.tools, domainPack: input.domainPack });
  }, { note: "Register a forged capability from an identified need." });

  register("dila", "causal_overview", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return causalMemoryOverview(db);
  }, { note: "Causal memory graph statistics." });
}
