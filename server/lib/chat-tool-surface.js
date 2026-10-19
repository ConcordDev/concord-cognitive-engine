// Chat tool surface — what /api/chat/tools reports, and how chat.respond
// runs web_search.
//
// Two paths inject tools, and they are not the same set:
//   • chat.respond (/api/chat, /api/chat/stream) injects the public tools in
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
    name: "list_lens_actions",
    description: "List real action names and input fields for a lens domain.",
    params: {
      domain: { type: "string", required: true, description: "Lens domain" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "conkay_solver_list",
    description: "List ConKay solvers from the live Solver Registry.",
    params: {
      domain: { type: "string", required: false, description: "Optional physics domain filter" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "conkay_solve",
    description: "Run one ConKay solver against a Design IR.",
    params: {
      solver_id: { type: "string", required: true, description: "Solver id from conkay_solver_list" },
      ir: { type: "object", required: false, description: "Design IR" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "conkay_ir_schema",
    description: "Worked Design IR example and contract hints.",
    params: {},
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "conkay_compile_brief",
    description: "Compile a short design brief into Design IR. Does not invent missing sizes.",
    params: {
      brief: { type: "string", required: true, description: "Plain-language design brief" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "conkay_design",
    description: "Size or check an engineered part, or build a concept 3D assembly from a plain-language spec.",
    params: {
      text: { type: "string", required: true, description: "The design in words" },
    },
    requiresOptIn: true,
    operatorOnly: false,
  },
  {
    name: "generate_3d",
    description: "Free-form 3D model on Concord's GPU. Not for engineered parts.",
    params: {
      prompt: { type: "string", required: true, description: "The object" },
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
  { name: "conkay_design", description: "ConKay sizing check: hand calc + FEA + safety-factor pass/fail from a plain-language spec.", params: { text: { type: "string", required: true } } },
  { name: "conkay_solve", description: "Run one ConKay solver against a Design IR (MCP bridge).", params: { solver_id: { type: "string", required: true }, ir: { type: "object", required: false } } },
  { name: "conkay_solver_list", description: "List ConKay solvers (MCP bridge).", params: { domain: { type: "string", required: false } } },
  { name: "conkay_ir_schema", description: "Worked Design IR example + contract hints (MCP bridge).", params: {} },
  { name: "conkay_compile_brief", description: "Compile a short design brief into Design IR (MCP bridge). Missing sizes stay missing.", params: { brief: { type: "string", required: false }, text: { type: "string", required: false } } },
  { name: "run_python", description: "Python in the isolated Pyodide worker.", params: { code: { type: "string", required: true } } },
  { name: "browse_url", description: "Fetch and read a web page.", params: { url: { type: "string", required: true } } },
  { name: "run_lens_action", description: "Invoke a registered lens action.", params: { domain: { type: "string", required: true }, action: { type: "string", required: true } } },
  { name: "list_lens_actions", description: "List real action names for a domain.", params: { domain: { type: "string", required: true } } },
  { name: "textbook_lookup", description: "Look up a fact or explanation in OpenStax open textbooks (CC BY).", params: { query: { type: "string", required: true }, book: { type: "string", required: false } } },
  { name: "find_lens_actions", description: "Search every lens action across all domains by intent.", params: { query: { type: "string", required: true } } },
  { name: "create_dtu", description: "Mint a DTU from the conversation.", params: { title: { type: "string", required: true } } },
  { name: "create_document", description: "Write a downloadable pdf, md, json, csv, txt, or zip.", params: { title: { type: "string", required: true } } },
  { name: "export_dtu", description: "Export an existing DTU to a file.", params: { dtuId: { type: "string", required: true }, format: { type: "string", required: true } } },
  { name: "read_zip", description: "List or read an entry in a zip stored as a DTU.", params: { dtuId: { type: "string", required: true } } },
  { name: "expert_mode", description: "Cited answer over the corpus.", params: { query: { type: "string", required: true } } },
  { name: "generate_image", description: "Generate an image.", params: { prompt: { type: "string", required: true } } },
  { name: "generate_3d", description: "Free-form 3D model on the GPU pod (FLUX concept → TRELLIS mesh), returned as a rotatable mesh.", params: { prompt: { type: "string", required: true } } },
  { name: "start_long_task", description: "Hand a big multi-step job to a background job that posts its result back.", params: { goal: { type: "string", required: true } } },
  { name: "check_long_task", description: "Progress of the user's background jobs.", params: { jobId: { type: "string", required: false } } },
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
