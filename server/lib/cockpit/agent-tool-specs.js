// Typed specs for the 20 agent tools a cockpit run may use (CKPT-02).
// Kept in step with TOOL_SCHEMA_BLOCK / TOOL_REQUIRED_PARAMS in lib/chat-agent.js;
// tests/cockpit/tool-spec.test.js pins the required-key sets.
const S = { type: "string" };
const N = { type: "number" };
const I = { type: "integer" };
const O = { type: "object" };

function obj(required, properties) {
  return { type: "object", additionalProperties: false, required, properties };
}

function spec(title, description, inputSchema, risk, idempotent, timeoutMs, fallbacks, extra = {}) {
  return {
    title,
    description: description.slice(0, 160),
    inputSchema,
    outputSchema: null,
    risk,
    idempotent,
    aliases: extra.aliases || [],
    fallbacks,
    timeoutMs,
    requiresScopes: extra.requiresScopes || [],
  };
}

/** @type {Record<string, Omit<import("./tool-spec.js").ToolSpec, "id">>} */
export const AGENT_TOOL_SPECS = {
  web_search: spec("Search the web", "Search the web for current information.",
    obj(["query"], { query: S, limit: I }), "read", true, 30000, ["browse_url"],
    { aliases: ["websearch", "search_web", "search"] }),
  browse_url: spec("Read a web page", "Fetch and read one web page by URL.",
    obj(["url"], { url: S }), "read", true, 30000, ["web_search"]),
  run_compute: spec("Run a calculation", "Run a math, physics, chemistry or engineering calculation by function key.",
    obj(["key", "input"], { key: S, input: O }), "compute", true, 20000, ["run_recipe"],
    { aliases: ["compute", "calculate", "calc"] }),
  dtu_search: spec("Search your knowledge base", "Search the user's saved notes and knowledge.",
    obj(["query"], { query: S, limit: I }), "read", true, 15000, ["web_search"],
    { aliases: ["search_dtus", "dtu.search"] }),
  get_live_data: spec("Look up live data", "Look up live reference data: compound properties or exchange rates.",
    obj(["kind"], {
      kind: { type: "string", enum: ["compound", "fx"] },
      name: S, property: S, base: S, symbols: { type: "array", items: S },
    }), "read", true, 20000, ["web_search"]),
  list_recipes: spec("Look up tested calculations", "List tested multi-step calculations, optionally filtered by a query.",
    obj([], { query: S }), "read", true, 5000, []),
  run_recipe: spec("Run a tested calculation", "Run a tested calculation recipe with named inputs.",
    obj(["recipe", "inputs"], { recipe: S, inputs: O }), "compute", true, 20000, ["run_compute"]),
  find_lens_actions: spec("Find the right action", "Find lens actions that match a plain-words request.",
    obj(["query"], { query: S, limit: I }), "read", true, 10000, ["list_lens_actions"]),
  list_lens_actions: spec("List a lens's actions", "List the actions one lens offers.",
    obj(["domain"], { domain: S }), "read", true, 10000, ["find_lens_actions"],
    { requiresScopes: ["mcp:lens:read"] }),
  run_lens_action: spec("Run a lens action", "Run one action of one lens with parameters.",
    obj(["domain", "action"], { domain: S, action: S, params: O }), null, false, 60000, ["find_lens_actions"],
    { aliases: ["lens_action", "run_action"], requiresScopes: ["mcp:lens:read"] }),
  textbook_lookup: spec("Check a textbook", "Look a fact up in the textbook references.",
    obj(["query"], { query: S }), "read", true, 20000, ["web_search"]),
  create_dtu: spec("Save a note", "Save a new note (DTU) from the conversation.",
    obj(["title"], { title: S, summary: S, content: S, tags: { type: "array", items: S } }), "write", false, 20000, []),
  create_document: spec("Write a document", "Write a document and save it.",
    obj(["title"], { title: S, content: S }), "write", false, 30000, ["create_dtu"]),
  export_dtu: spec("Export a note", "Export a saved note in a given format.",
    obj(["dtuId", "format"], { dtuId: S, format: S }), "compute", true, 30000, []),
  conkay_design: spec("Size the design", "Design and size an engineered part from a plain-words brief.",
    obj(["text"], { text: S, scope: S }), "compute", true, 120000, ["run_recipe"]),
  conkay_solver_list: spec("List the solvers", "List the available design solvers.",
    obj([], { domain: S }), "read", true, 10000, [], { requiresScopes: ["mcp:conkay:read"] }),
  conkay_ir_schema: spec("Get the design format", "Return the design format the solvers read.",
    obj([], {}), "read", true, 10000, [], { requiresScopes: ["mcp:conkay:read"] }),
  conkay_compile_brief: spec("Turn the brief into a design", "Compile a plain-words brief into a design.",
    obj([], { text: S }), "compute", true, 30000, ["conkay_design"], { requiresScopes: ["mcp:conkay:read"] }),
  conkay_solve: spec("Run the solver", "Run one design solver on a design.",
    obj(["solver_id"], { solver_id: S, ir: O, designId: S }), "compute", true, 120000, ["conkay_design"],
    { requiresScopes: ["mcp:conkay:read"] }),
  generate_3d: spec("Make the 3D model", "Generate a free-form 3D model from a short description.",
    obj(["prompt"], { prompt: S }), "compute", false, 300000, ["conkay_design"]),
};
