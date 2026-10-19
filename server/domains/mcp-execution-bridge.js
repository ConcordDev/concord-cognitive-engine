// server/domains/mcp-execution-bridge.js
//
// Pre-register MCP Execution Bridge tools in the capability registry so F0's
// capability gate never returns capability_unregistered_but_dispatchable for
// run_lens_action / list_lens_actions / conkay_solve / conkay_solver_list /
// conkay_ir_schema / conkay_compile_brief.
//
// implementation: "mcp_builtin" — in-process handlers in lib/mcp-tools.js
// (not organ Python scripts). Health is checked against the live MCP_TOOLS
// list via capability-registry.js.

import { registerCapability } from "../lib/runtime/capability-registry.js";

export const MCP_EXECUTION_BRIDGE_CAPABILITIES = [
  {
    capability: "run.lens_action",
    owner: "mcp_execution_bridge",
    risk: "execute",
    description:
      "Invoke a registered Concord lens/macro action through the same dual-registry path as chat-agent run_lens_action. Per-action risk + Hermes scopes enforced inside the handler.",
    inputs: ["domain", "action", "params", "dry_run", "approval", "idempotency_key"],
    outputs: ["result", "risk", "via", "actor_id"],
    dependencies: ["lens_actions", "macros"],
    implementation: "mcp_builtin",
    mcp_tool_name: "run_lens_action",
  },
  {
    capability: "list.lens_actions",
    owner: "mcp_execution_bridge",
    risk: "read",
    description:
      "Discover real action names and input field hints for a lens domain before calling run_lens_action.",
    inputs: ["domain"],
    outputs: ["actions", "total"],
    dependencies: ["lens_actions", "macros"],
    implementation: "mcp_builtin",
    mcp_tool_name: "list_lens_actions",
  },
  {
    capability: "conkay.solve",
    owner: "mcp_execution_bridge",
    risk: "compute",
    description:
      "Run one ConKay Solver Registry solver by id against a Design IR (or owned designId). Returns envelopes with provenance (sourced/computed/estimated/assumed/unknown). Not 71 hard-coded tools.",
    inputs: ["solver_id", "ir", "designId", "target", "dry_run"],
    outputs: ["results", "provenance", "status"],
    dependencies: ["conkay_solver_registry"],
    implementation: "mcp_builtin",
    mcp_tool_name: "conkay_solve",
  },
  {
    capability: "conkay.solver_list",
    owner: "mcp_execution_bridge",
    risk: "read",
    description: "List ConKay solvers from the live registry (id, domain, fidelity, screening).",
    inputs: ["domain", "fidelity"],
    outputs: ["solvers", "total"],
    dependencies: ["conkay_solver_registry"],
    implementation: "mcp_builtin",
    mcp_tool_name: "conkay_solver_list",
  },
  {
    capability: "conkay.ir_schema",
    owner: "mcp_execution_bridge",
    risk: "read",
    description: "Worked Design IR example and contract hints for conkay_solve.",
    inputs: [],
    outputs: ["example", "hints"],
    dependencies: ["conkay_solver_registry"],
    implementation: "mcp_builtin",
    mcp_tool_name: "conkay_ir_schema",
  },
  {
    capability: "conkay.compile_brief",
    owner: "mcp_execution_bridge",
    risk: "read",
    description: "Compile a short design brief into Design IR. Missing sizes stay missing.",
    inputs: ["brief", "text"],
    outputs: ["ir", "warnings", "assumptions", "architecture"],
    dependencies: ["conkay_solver_registry"],
    implementation: "mcp_builtin",
    mcp_tool_name: "conkay_compile_brief",
  },
];

for (const cap of MCP_EXECUTION_BRIDGE_CAPABILITIES) {
  registerCapability(cap);
}

export default function registerMcpExecutionBridge(_registerLensAction) {
  return {
    registered: 0,
    capabilities: MCP_EXECUTION_BRIDGE_CAPABILITIES.map((c) => c.capability),
  };
}
