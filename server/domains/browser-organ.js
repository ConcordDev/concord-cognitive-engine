// server/domains/browser-organ.js
//
// O001.5 / Gap 3 — Pre-register browser_* tools in the capability registry
// so F0's capability gate recognizes them as legitimate (no more
// "capability_unregistered_but_dispatchable").
//
// Per the F0 architecture, every observable capability must:
//   - declare risk tier
//   - declare owner
//   - declare dependencies
//   - have a description
//
// These are OBSERVATION-ONLY capabilities (no writes, no execution, no trade).
// Risk tier is "read" because they only fetch external state.

import { registerCapability } from "../lib/runtime/capability-registry.js";

const BROWSER_ORGAN_CAPABILITIES = [
  {
    capability: "browser.check_coins",
    owner: "browser_organ",
    risk: "read",
    description: "Read-only Coinbase probe — hits public spot price + (if CDP key available) authenticated balance/portfolio endpoint. Returns btc_usd_spot, total_balance_usd, portfolio positions. No writes.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "browser_check_coins",
  },
  {
    capability: "browser.check_rate_limits",
    owner: "browser_organ",
    risk: "read",
    description: "Read-only probe of provider health — hits each provider's models/health endpoint (no auth) and reports network_reachable + api_accessible + latency per provider.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "browser_check_rate_limits",
  },
  {
    capability: "browser.check_incidents",
    owner: "browser_organ",
    risk: "read",
    description: "Read-only probe of Coinbase public status API. Returns indicator (none/minor/major/critical), description, page_id, updated_at. No auth, no writes.",
    dependencies: [],
    implementation: "mcp",
    mcp_tool_name: "browser_check_incidents",
  },
];

const browserOrgan = {
  registerCapabilities() {
    for (const cap of BROWSER_ORGAN_CAPABILITIES) {
      const r = registerCapability(cap);
      if (r && !r.ok) {
        // Idempotent: ignore already-registered errors at boot time
      }
    }
  },
};

// Register at module load time (same pattern as domains/predict.js)
browserOrgan.registerCapabilities();

export default function registerBrowserOrganActions(registerLensAction) {
  // No lens actions for the browser organ — it exposes MCP tools via
  // lib/mcp-tools.js::browserOrganCall, which is registered as a tool,
  // not a lens action. This function is the module-load hook used by
  // domains/index.js forEach wiring.
  return {
    registered: 0,
    capabilities: BROWSER_ORGAN_CAPABILITIES.map(c => c.capability),
  };
}
