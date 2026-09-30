// server/lib/mission-templates.js
//
// Deterministic mission templates + autonomous tool safety allowlist.
// Missions never invent tools — only registered MCP organ tools listed here.

/** @type {Record<string, { title: string, goal: string, steps: Array<{ tool: string, args?: object }> }>} */
export const MISSION_TEMPLATES = Object.freeze({
  fleet_health: {
    title: "Fleet health verification",
    goal: "Assemble and verify all organ health; sweep sentinel signals.",
    steps: [
      { tool: "concordia_assemble", args: {} },
      { tool: "concordia_verify", args: {} },
      { tool: "sentinel_sweep", args: {} },
      { tool: "economic_check", args: {} },
    ],
  },
  watch_detect: {
    title: "Watch and detect incidents",
    goal: "Sweep sentinel, list active incidents, record trace.",
    steps: [
      { tool: "sentinel_sweep", args: {} },
      { tool: "incident_list", args: { active_only: true } },
      { tool: "incident_history", args: { limit: 10 } },
      { tool: "trace_recent", args: { limit: 20 } },
    ],
  },
  opportunity_pipeline: {
    title: "Opportunity scan and compose",
    goal: "Scan upstream signals, list opportunities, compose initiatives.",
    steps: [
      { tool: "opportunity_scan", args: { since_minutes: 60 } },
      { tool: "opportunity_list", args: { limit: 20 } },
      { tool: "initiative_compose", args: { since_minutes: 1440 } },
      { tool: "initiative_list", args: { status: "composed", limit: 20 } },
    ],
  },
  proactive_research: {
    title: "Proactive prediction research",
    goal: "List near-horizon predictions and filter research signals.",
    steps: [
      { tool: "proactive_list_predictions", args: { horizon: "near", limit: 10 } },
      { tool: "research_filter", args: { since_minutes: 120 } },
      { tool: "research_list_pending", args: { limit: 10 } },
    ],
  },
  initiative_monitor: {
    title: "Initiative submission monitor",
    goal: "Monitor submitted initiatives and economic safety.",
    steps: [
      { tool: "initiative_list", args: { status: "submitted", limit: 10 } },
      { tool: "economic_check", args: {} },
      { tool: "experience_stats", args: {} },
    ],
  },
  experience_consolidate: {
    title: "Experience consolidation",
    goal: "Compress organ experience into durable memories.",
    steps: [
      { tool: "experience_compress", args: { since_minutes: 1440 } },
      { tool: "experience_distill", args: { since_minutes: 1440 } },
      { tool: "experience_stats", args: {} },
    ],
  },
  coding_audit: {
    title: "Coding audit",
    goal: "Index repo symbols, verify organ fleet, review recent traces.",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "concordia_assemble", args: {} },
      { tool: "concordia_verify", args: {} },
      { tool: "trace_recent", args: { limit: 20 } },
    ],
  },
  coding_loop: {
    title: "Coding loop",
    goal: "Index repo, search targets, verify fleet, run targeted tests.",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "coding_loop_search", args: {} },
      { tool: "concordia_assemble", args: {} },
      { tool: "concordia_verify", args: {} },
      { tool: "coding_loop_verify", args: {} },
    ],
  },
  coding_loop_closed: {
    title: "Closed coding loop",
    goal: "PCE transform → verify tests → critic gate.",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "pce_execute", args: {} },
      { tool: "coding_loop_verify", args: {} },
    ],
  },
  pce_transform: {
    title: "PCE deterministic transform",
    goal: "Compile intent to pattern, apply transforms, run verification gates.",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "pce_execute", args: {} },
    ],
  },
  pce_excellence_cycle: {
    title: "PCE empirical excellence cycle",
    goal: "Full ConcordBench (core+engineering+adversarial) → learning → regression-gated promotion.",
    steps: [
      { tool: "pce_excellence_run", args: {} },
      { tool: "pattern_lifecycle_run", args: {} },
    ],
  },
  swe_harness: {
    title: "SWE mini harness",
    goal: "Run synthetic SWE-style patch+test cases.",
    steps: [
      { tool: "swe_harness_run", args: {} },
    ],
  },
  incident_response: {
    title: "Incident response",
    goal: "Detect, classify, trace, and record incident handling.",
    steps: [
      { tool: "incident_detect", args: {} },
      { tool: "incident_classify", args: {} },
      { tool: "trace_root_cause", args: {} },
      { tool: "incident_list", args: { status: "open", limit: 10 } },
      { tool: "trace_record", args: {} },
    ],
  },
  marathon_delegate: {
    title: "Marathon delegate",
    goal: "Spawn a long-running LLM marathon for open-ended work.",
    steps: [
      { tool: "economic_check", args: {} },
      { tool: "marathon_spawn", args: {} },
      { tool: "marathon_status", args: {} },
    ],
  },
  initiative_execute: {
    title: "Initiative execute handoff",
    goal: "Monitor submitted initiatives and record execution outcomes.",
    steps: [
      { tool: "initiative_list", args: { status: "submitted", limit: 5 } },
      { tool: "initiative_validate", args: {} },
      { tool: "economic_check", args: {} },
      { tool: "initiative_handoff", args: {} },
      { tool: "experience_stats", args: {} },
    ],
  },
  cognitive_probe: {
    title: "Cognitive probe — full stack",
    goal: "Analyze fleet organ health via DHTP cognitive delta",
    steps: [
      { tool: "concordia_assemble", args: {} },
      {
        tool: "cognitive_delta_execute",
        args: {
          text: "@ACTION analyze\n@RATIONALE_REF ledger:verified\n@CONFIDENCE 0.85\n@EXPECTED_RESULT structured_observation",
        },
      },
    ],
  },
  cognitive_probe_variant: {
    title: "Cognitive probe variant — incident analysis",
    goal: "Detect active incidents via sentinel sweep and analyze via cognitive delta",
    steps: [
      { tool: "sentinel_sweep", args: {} },
      { tool: "incident_list", args: { active_only: true } },
      {
        tool: "cognitive_delta_execute",
        args: {
          text: "@ACTION analyze\n@RATIONALE_REF sentinel:incidents\n@CONFIDENCE 0.82\n@EXPECTED_RESULT incident_summary",
        },
      },
    ],
  },
  dgb_semantic_vitals: {
    title: "DGB L3 — semantic organ vitality assessment",
    goal: "Produce a verified read-only assessment of distributed organ subsystem health using structured cognitive delta",
    steps: [
      { tool: "concordia_assemble", args: {} },
      {
        tool: "cognitive_delta_execute",
        args: {
          text: "@ACTION analyze\n@RATIONALE_REF ledger:verified\n@CONFIDENCE 0.84\n@EXPECTED_RESULT verified_structured_assessment",
        },
      },
    ],
  },
  dgb_compose_audit: {
    title: "DGB L4 — composed repository audit",
    goal: "Index repository symbols, verify organ fleet integrity, review recent traces, then emit a verified composed observation",
    steps: [
      { tool: "repo_graph_index", args: {} },
      { tool: "concordia_assemble", args: {} },
      { tool: "concordia_verify", args: {} },
      { tool: "trace_recent", args: { limit: 10 } },
      {
        tool: "cognitive_delta_execute",
        args: {
          text: "@ACTION analyze\n@RATIONALE_REF repo_graph:indexed,concordia:verified,trace:recent\n@CONFIDENCE 0.86\n@EXPECTED_RESULT composed_audit_observation",
        },
      },
    ],
  },
  dgb_adversarial_probe: {
    title: "DGB L5 — adversarial fleet assessment",
    goal: "Under conflicting memory noise and misleading evidence, produce a verified read-only fleet assessment",
    steps: [
      { tool: "concordia_assemble", args: {} },
      {
        tool: "cognitive_delta_execute",
        args: {
          text: "@ACTION analyze\n@RATIONALE_REF ledger:verified\n@CONFIDENCE 0.84\n@EXPECTED_RESULT verified_structured_assessment",
        },
      },
    ],
  },
});

/** Internal runtime tools — handled in mission-runtime.js, not F0 MCP. */
export const INTERNAL_RUNTIME_TOOLS = new Set([
  "parallel_batch",
  "repo_graph_index",
  "coding_loop_search",
  "coding_loop_verify",
  "coding_loop_closure",
  "swe_harness_run",
  "worker_execute",
  "pce_execute",
  "concord_bench_run",
  "pce_excellence_run",
  "pce_improvement_run",
  "pattern_lifecycle_run",
  "cognitive_delta_execute",
  "marathon_spawn",
  "marathon_status",
  "initiative_handoff",
]);

/**
 * Tools an autonomous mission may invoke. Anything not listed requires
 * operator-sourced missions (source=operator) with explicit tool in steps.
 */
export const AUTONOMOUS_SAFE_TOOLS = new Set([
  "browser_check_coins",
  "browser_check_rate_limits",
  "browser_check_incidents",
  "sentinel_sweep",
  "sentinel_list_alerts",
  "sentinel_health",
  "sentinel_gate_diff",
  "trace_record",
  "trace_lookup",
  "trace_recent",
  "trace_tool_history",
  "trace_root_cause",
  "incident_list",
  "incident_history",
  "incident_detect",
  "incident_classify",
  "research_filter",
  "research_list_findings",
  "research_list_pending",
  "research_get_finding",
  "opportunity_scan",
  "opportunity_list",
  "opportunity_get",
  "proactive_list_predictions",
  "proactive_list_reminders",
  "proactive_calibration",
  "economic_snapshot",
  "economic_budget",
  "economic_costs",
  "economic_pnl",
  "economic_attribution",
  "economic_check",
  "initiative_compose",
  "initiative_list",
  "initiative_get",
  "initiative_validate",
  "initiative_submit",
  "capability_list_patterns",
  "capability_list_templates",
  "a2a_list_messages",
  "a2a_list_routes",
  "a2a_check_delivery",
  "experience_compress",
  "experience_distill",
  "experience_list_memories",
  "experience_stats",
  "concordia_assemble",
  "concordia_verify",
  "concordia_list_assemblies",
]);

/** Never auto-invoke — operator missions only. */
export const AUTONOMOUS_FORBIDDEN_TOOLS = new Set([
  "research_invoke",
  "initiative_record_execution",
  "capability_register",
  "opportunity_approve",
  "opportunity_reject",
  "a2a_send",
]);

export function getTemplate(name) {
  return MISSION_TEMPLATES[name] || null;
}

export function listTemplateNames() {
  return Object.keys(MISSION_TEMPLATES);
}

export function expandTemplate(name, spawnContext = {}) {
  const tpl = getTemplate(name);
  if (!tpl) return null;
  const steps = tpl.steps.map((s) => ({
    tool: s.tool,
    args: mergeSpawnArgs(s.args || {}, spawnContext),
  }));
  return { title: tpl.title, goal: tpl.goal, steps };
}

function mergeSpawnArgs(base, ctx) {
  if (!ctx || typeof ctx !== "object") return { ...base };
  const out = { ...base };
  if (ctx.since_minutes != null && out.since_minutes == null) {
    out.since_minutes = ctx.since_minutes;
  }
  if (ctx.signal_id && out.signal_id == null) out.signal_id = ctx.signal_id;
  if (ctx.initiative_id && out.initiative_id == null) out.initiative_id = ctx.initiative_id;
  return out;
}

/**
 * @param {string} tool
 * @param {string} source mission source
 */
export function isToolAllowed(tool, source) {
  if (!tool || typeof tool !== "string") return false;
  if (INTERNAL_RUNTIME_TOOLS.has(tool)) {
    if (source === "operator" || source === "scheduled") return true;
    const autonomousInternal = new Set([
      "repo_graph_index", "coding_loop_search", "coding_loop_verify",
      "coding_loop_closure", "swe_harness_run", "worker_execute", "pce_execute",
      "cognitive_delta_execute",
    ]);
    return autonomousInternal.has(tool);
  }
  if (source === "operator") return true;
  if (AUTONOMOUS_FORBIDDEN_TOOLS.has(tool)) return false;
  return AUTONOMOUS_SAFE_TOOLS.has(tool);
}
