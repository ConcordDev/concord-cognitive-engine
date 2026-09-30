// server/domains/opportunity-engine.js
//
// C.3 — Pre-register opportunity_* tools in the capability registry.

import { registerCapability } from "../lib/runtime/capability-registry.js";

const OPPORTUNITY_CAPABILITIES = [
  {
    capability: "opportunity.scan",
    owner: "opportunity_engine",
    risk: "write",
    description: "Full sweep — collect signals from all upstream organs, classify, score, propose. Never auto-executes.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "opportunity_scan",
  },
  {
    capability: "opportunity.list",
    owner: "opportunity_engine",
    risk: "read",
    description: "List proposals (filter by tier/status/since).",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "opportunity_list",
  },
  {
    capability: "opportunity.get",
    owner: "opportunity_engine",
    risk: "read",
    description: "Get full details of a proposal.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "opportunity_get",
  },
  {
    capability: "opportunity.approve",
    owner: "opportunity_engine",
    risk: "write",
    description: "Operator approval - transitions pending to approved. Does NOT execute; execution is F0's job.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "opportunity_approve",
  },
  {
    capability: "opportunity.reject",
    owner: "opportunity_engine",
    risk: "write",
    description: "Operator rejection - transitions pending to rejected.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "opportunity_reject",
  },
];

const opportunityEngine = {
  registerCapabilities() {
    for (const cap of OPPORTUNITY_CAPABILITIES) {
      const r = registerCapability(cap);
      if (r && !r.ok) {
        // Idempotent
      }
    }
  },
};

opportunityEngine.registerCapabilities();

export default function registerOpportunityEngineActions(registerLensAction) {
  return {
    registered: 0,
    capabilities: OPPORTUNITY_CAPABILITIES.map(c => c.capability),
  };
}