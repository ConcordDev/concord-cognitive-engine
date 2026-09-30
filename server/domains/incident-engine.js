// server/domains/incident-engine.js
//
// B.3 — Pre-register incident_* tools in the capability registry.

import { registerCapability } from "../lib/runtime/capability-registry.js";

const INCIDENT_CAPABILITIES = [
  {
    capability: "incident.watch",
    owner: "incident_engine",
    risk: "write",
    description: "Full sweep — consume sentinel + trace-fabric signals, classify, decide, act, verify, record.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "incident_watch",
  },
  {
    capability: "incident.active",
    owner: "incident_engine",
    risk: "read",
    description: "List currently active incidents.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "incident_active",
  },
  {
    capability: "incident.history",
    owner: "incident_engine",
    risk: "read",
    description: "List recent resolved/escalated incidents.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "incident_history",
  },
  {
    capability: "incident.classify",
    owner: "incident_engine",
    risk: "read",
    description: "Manually classify a signal (for testing or operator override).",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "incident_classify",
  },
  {
    capability: "incident.recover",
    owner: "incident_engine",
    risk: "execute",
    description: "Manually trigger bounded recovery. Requires execute authority but NOT destructive or trade.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "incident_recover",
  },
];

const incidentEngine = {
  registerCapabilities() {
    for (const cap of INCIDENT_CAPABILITIES) {
      const r = registerCapability(cap);
      if (r && !r.ok) {
        // Idempotent: ignore already-registered errors at boot time
      }
    }
  },
};

incidentEngine.registerCapabilities();

export default function registerIncidentEngineActions(registerLensAction) {
  return {
    registered: 0,
    capabilities: INCIDENT_CAPABILITIES.map(c => c.capability),
  };
}