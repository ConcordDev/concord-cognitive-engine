// server/domains/code-agent.js
//
// Code Sprint B Item #6 — agent loop macro surface.

import { runAgentLoop } from "../lib/code/agent-loop.js";

export default function registerCodeAgentMacros(register) {
  register("code", "agent_loop", async (ctx, input = {}) => {
    return runAgentLoop(ctx, input);
  }, { destructive: true, requiresLLM: true, note: "Run plan → apply → test → re-plan loop until pass or maxIterations" });
}
