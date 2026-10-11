// Chat tool surface — what /api/chat/tools reports, and how chat.respond
// runs web_search.
//
// Two paths inject tools, and they are not the same set:
//   • chat.respond (/api/chat, /api/chat/stream) injects the five tools in
//     its system prompt (plus two operator tools) whenever
//     STATE.__chicken3.toolsEnabled !== false. It then sets the session's
//     toolsOptIn itself. Session opt-in is not a precondition.
//   • chat_agent.do (lib/chat-agent.js runAgentLoop) always injects the
//     executeToolCall switch (~19 tools). It does not read toolsEnabled
//     or toolsOptIn.
//
// web_search on the chat path used to call tools.web_search, which wraps
// the fetch in governedCall. That gate rejects every call once the DTU
// count crosses 1,000 (see the PR note on inLatticeReality). The agent
// loop already calls expert_mode.web_search. Chat does the same here.

// Names chat.respond actually writes into _toolSystemPrompt. operatorOnly
// tools are appended only when isOperator(ctx) is true.
export const CHAT_RESPOND_TOOLS = Object.freeze([
  {
    name: "web_search",
    description: "Search the web for current information.",
    params: { query: { type: "string", required: true, description: "Search query" } },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "run_compute",
    description: "Run a physics, chemistry, math, quantum, or engineering calculation.",
    params: {
      key: { type: "string", required: true, description: "module.function, e.g. chemistry.balanceReaction" },
      input: { type: "object", required: false, description: "Function arguments" },
    },
    requiresOptIn: false,
    operatorOnly: false,
  },
  {
    name: "browse_url",
    description: "Fetch and read a public web page.",
    params: {
      url: { type: "string", required: true, description: "Full http(s) URL" },
      selector: { type: "string", required: false, description: "Optional CSS selector" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "create_dtu",
    description: "Create a DTU from the conversation.",
    params: {
      title: { type: "string", required: true, description: "DTU title" },
      summary: { type: "string", required: false, description: "Brief summary" },
      tags: { type: "array", required: false, description: "Tags" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "run_lens_action",
    description: "Invoke a lens domain action.",
    params: {
      domain: { type: "string", required: true, description: "Lens domain" },
      action: { type: "string", required: true, description: "Action name" },
      params: { type: "object", required: false, description: "Action parameters" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "generate_image",
    description: "Generate an image on Concord's GPU.",
    params: {
      prompt: { type: "string", required: true, description: "Describe the image" },
      size: { type: "string", required: false, description: "e.g. 1024x1024" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "list_capabilities",
    description: "List Concord Runtime capabilities. Injected only for an operator.",
    params: { owner: { type: "string", required: false, description: "Optional owner filter" } },
    requiresOptIn: true,
    operatorOnly: true,
  },
  {
    name: "invoke_capability",
    description: "Run one Runtime capability through the governed envelope. Injected only for an operator.",
    params: {
      capability: { type: "string", required: true, description: "Capability name" },
      input: { type: "object", required: false, description: "Capability input" },
    },
    requiresOptIn: true,
    operatorOnly: true,
  },
]);

// executeToolCall's switch in lib/chat-agent.js. Pinned against that
// function's case labels by tests/chat-tool-surface.test.js.
export const AGENT_LOOP_TOOLS = Object.freeze([
  { name: "web_search", description: "Live web search via expert_mode.web_search.", params: { query: { type: "string", required: true } } },
  { name: "run_compute", description: "Deterministic compute module.function.", params: { key: { type: "string", required: true }, input: { type: "object", required: true } } },
  { name: "run_python", description: "Python in the isolated Pyodide worker.", params: { code: { type: "string", required: true } } },
  { name: "browse_url", description: "Fetch and read a web page.", params: { url: { type: "string", required: true } } },
  { name: "run_lens_action", description: "Invoke a registered lens action.", params: { domain: { type: "string", required: true }, action: { type: "string", required: true } } },
  { name: "list_lens_actions", description: "List real action names for a domain.", params: { domain: { type: "string", required: true } } },
  { name: "create_dtu", description: "Mint a DTU from the conversation.", params: { title: { type: "string", required: true } } },
  { name: "create_document", description: "Write a downloadable pdf, md, json, csv, txt, or zip.", params: { title: { type: "string", required: true } } },
  { name: "export_dtu", description: "Export an existing DTU to a file.", params: { dtuId: { type: "string", required: true }, format: { type: "string", required: true } } },
  { name: "read_zip", description: "List or read an entry in a zip stored as a DTU.", params: { dtuId: { type: "string", required: true } } },
  { name: "expert_mode", description: "Cited answer over the corpus.", params: { query: { type: "string", required: true } } },
  { name: "generate_image", description: "Generate an image.", params: { prompt: { type: "string", required: true } } },
  { name: "mcp_connect", description: "Connect a remote HTTP MCP server.", params: { serverId: { type: "string", required: true }, url: { type: "string", required: true } } },
  { name: "mcp_call", description: "Call a tool on a connected MCP server.", params: { serverId: { type: "string", required: true }, toolName: { type: "string", required: true } } },
  { name: "mcp_list", description: "List tools on connected MCP servers.", params: {} },
  { name: "browser_act", description: "Click, fill, or screenshot a page.", params: { url: { type: "string", required: true }, actions: { type: "array", required: true } } },
  { name: "run_authored_tool", description: "Run a human-approved authored tool.", params: { toolId: { type: "string", required: true } } },
  {
    name: "list_capabilities",
    description: "List Runtime capabilities. Non-operators see the public subset.",
    params: { owner: { type: "string", required: false } },
    operatorScoped: true,
    memberEffect: "public_capabilities_only",
  },
  {
    name: "invoke_capability",
    description: "Run a Runtime capability. Private capabilities return operator_only for a member.",
    params: { capability: { type: "string", required: true } },
    operatorScoped: true,
    memberEffect: "operator_only_for_private",
  },
]);

export const CHAT_COMPUTE_KEYS = Object.freeze([
  "chemistry.molecularAnalysis", "chemistry.balanceReaction", "chemistry.solutionChemistry", "chemistry.enthalpyOfReaction", "chemistry.gibbsFreeEnergy",
  "physics.beamDeflection", "physics.windLoad", "physics.momentOfInertia", "physics.heatTransfer", "physics.carnotEfficiency", "physics.idealGasLaw",
  "quantum.simulateCircuit", "quantum.analyzeCircuit", "quantum.measureCircuit", "quantum.circuitDepth",
  "engineering.columnBuckling", "engineering.weldStrength", "engineering.reinforcedConcreteWall", "engineering.voltageDrop", "engineering.heatLoadCalc",
  "statistics.linearRegression", "statistics.polynomialRegression", "statistics.pearsonCorrelation", "statistics.fitNormal", "statistics.hypothesisTest",
  "math.differentiate", "math.integrate", "math.solve", "math.simplify",
]);

const MAX_TOOL_RESULT_LEN = 12000;

/** Same predicate chat.respond uses before it injects the tool prompt. */
export function chatToolsInjected(toolsEnabled) {
  return toolsEnabled !== false;
}

function stamp(tool, available, path) {
  return {
    name: tool.name,
    description: tool.description,
    params: tool.params,
    available,
    path,
    ...(tool.requiresOptIn !== undefined ? { requiresOptIn: tool.requiresOptIn } : {}),
    ...(tool.operatorOnly ? { operatorOnly: true } : {}),
    ...(tool.operatorScoped ? { operatorScoped: true, memberEffect: tool.memberEffect } : {}),
  };
}

/**
 * Report for GET /api/chat/tools.
 * `available` is the chat path (the historical field). It follows
 * chat.respond's injection rule, not session opt-in.
 */
export function buildChatToolsReport({ toolsEnabled, sessionOptIn = false, operator = false } = {}) {
  const chatOn = chatToolsInjected(toolsEnabled);
  const chatTools = CHAT_RESPOND_TOOLS
    .filter((t) => !t.operatorOnly || operator)
    .map((t) => stamp(t, chatOn, "chat"));
  // The agent loop injects and dispatches this set unconditionally.
  const agentTools = AGENT_LOOP_TOOLS.map((t) => stamp(t, true, "agent"));

  return {
    available: chatOn,
    globalEnabled: Boolean(toolsEnabled),
    sessionOptIn: Boolean(sessionOptIn),
    sessionOptInGatesAvailability: false,
    tools: chatTools,
    computeKeys: CHAT_COMPUTE_KEYS,
    paths: {
      chat: {
        id: "chat.respond",
        routes: ["/api/chat", "/api/chat/stream"],
        available: chatOn,
        gatedBySessionOptIn: false,
        gatedByToolsEnabled: true,
        reason: chatOn
          ? "toolsEnabled is not false; chat.respond injects these tools and sets session toolsOptIn itself"
          : "STATE.__chicken3.toolsEnabled is false",
        tools: chatTools,
      },
      agent: {
        id: "chat_agent.do",
        available: true,
        gatedBySessionOptIn: false,
        gatedByToolsEnabled: false,
        reason: "runAgentLoop always injects its tool schema and dispatches executeToolCall; toolsEnabled and session opt-in are not consulted",
        tools: agentTools,
      },
    },
    usage: "Chat (/api/chat and /api/chat/stream) injects paths.chat.tools as [TOOL_CALL: {\"tool\",\"params\"}] markers when paths.chat.available. The agent loop injects paths.agent.tools and does not consult session opt-in.",
  };
}

/**
 * chat.respond web_search. Routes to expert_mode.web_search, matching
 * executeToolCall, and shapes hits as the numbered title/url/excerpt
 * block the chat grounding pass already cites.
 */
export async function dispatchChatWebSearch(runMacro, ctx, params = {}) {
  const query = String(params.query || params.q || "").trim();
  if (!query) return { tool: "web_search", ok: false, error: "query required" };
  let r;
  try {
    r = await runMacro("expert_mode", "web_search", {
      query,
      limit: Number(params.limit) || 5,
    }, ctx);
  } catch (e) {
    return { tool: "web_search", ok: false, error: String(e?.message || e) };
  }
  if (!r?.ok) {
    return { tool: "web_search", ok: false, error: r?.reason || r?.error || "web_search failed" };
  }
  const rows = Array.isArray(r.results) ? r.results : (Array.isArray(r.sources) ? r.sources : []);
  const text = rows.slice(0, 8).map((x, i) => {
    const title = String(x.title || x.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const url = String(x.url || x.link || x.href || "").trim().slice(0, 400);
    const excerpt = String(x.snippet || x.description || x.text || x.content || "").replace(/\s+/g, " ").trim().slice(0, 280);
    return `${i + 1}. title: ${title}\n   url: ${url}\n   excerpt: ${excerpt || "(no excerpt)"}`;
  }).join("\n");
  return {
    tool: "web_search",
    ok: true,
    query,
    source: "expert_mode.web_search",
    result: text.slice(0, MAX_TOOL_RESULT_LEN),
  };
}
