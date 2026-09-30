// server/domains/research-frontier.js
//
// D.3 — Pre-register research_* tools in the capability registry.

import { registerCapability } from "../lib/runtime/capability-registry.js";

const RESEARCH_CAPABILITIES = [
  {
    capability: "research.filter",
    owner: "research_frontier",
    risk: "read",
    description: "Run novelty + value filter on a signal. Returns scores without invoking LLM.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "research_filter",
  },
  {
    capability: "research.invoke",
    owner: "research_frontier",
    risk: "execute",
    description: "Invoke LLM research on a signal. Only runs if both scores pass threshold. Cost-guarded (default disabled).",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "research_invoke",
  },
  {
    capability: "research.findings",
    owner: "research_frontier",
    risk: "read",
    description: "List recent research findings.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "research_findings",
  },
  {
    capability: "research.pending",
    owner: "research_frontier",
    risk: "read",
    description: "List signals that passed filter but haven't been researched yet.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "research_pending",
  },
  {
    capability: "research.get",
    owner: "research_frontier",
    risk: "read",
    description: "Get full details of a research finding.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "research_get",
  },
];

const researchFrontier = {
  registerCapabilities() {
    for (const cap of RESEARCH_CAPABILITIES) {
      const r = registerCapability(cap);
      if (r && !r.ok) {
        // Idempotent: ignore already-registered errors at boot time
      }
    }
  },
};

researchFrontier.registerCapabilities();

export default function registerResearchFrontierActions(registerLensAction) {
  return {
    registered: 0,
    capabilities: RESEARCH_CAPABILITIES.map(c => c.capability),
  };
}