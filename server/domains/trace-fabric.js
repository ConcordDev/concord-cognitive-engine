// server/domains/trace-fabric.js
//
// F3.3 — Pre-register trace_* tools in the capability registry.

import { registerCapability } from "../lib/runtime/capability-registry.js";

const TRACE_FABRIC_CAPABILITIES = [
  {
    capability: "trace.lookup",
    owner: "trace_fabric_organ",
    risk: "read",
    description: "All events for a given trace_id, ordered chronologically.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_lookup",
  },
  {
    capability: "trace.recent",
    owner: "trace_fabric_organ",
    risk: "read",
    description: "Recent distinct trace_ids with summary stats (sources, tools, durations).",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_recent",
  },
  {
    capability: "trace.tool_history",
    owner: "trace_fabric_organ",
    risk: "read",
    description: "All events for a given tool_name.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_tool_history",
  },
  {
    capability: "trace.root_cause",
    owner: "trace_fabric_organ",
    risk: "read",
    description: "For a given trace_id, find originating event + walk parent_trace_id chain.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_root_cause",
  },
  {
    capability: "trace.record",
    owner: "trace_fabric_organ",
    risk: "write",
    description: "Write a custom trace event (for backfilling or external writes).",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_record",
  },
  {
    capability: "trace.backfill",
    owner: "trace_fabric_organ",
    risk: "write",
    description: "Backfill from browser_organ.db + sentinel.db.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "trace_backfill",
  },
];

const traceFabric = {
  registerCapabilities() {
    for (const cap of TRACE_FABRIC_CAPABILITIES) {
      const r = registerCapability(cap);
      if (r && !r.ok) {
        // Idempotent: ignore already-registered errors at boot time
      }
    }
  },
};

traceFabric.registerCapabilities();

export default function registerTraceFabricActions(registerLensAction) {
  return {
    registered: 0,
    capabilities: TRACE_FABRIC_CAPABILITIES.map(c => c.capability),
  };
}