/**
 * MCP (Model Context Protocol) Tools for Concord
 *
 * Exposes an HTTP MCP-shaped API so external tools (Claude Code, cloud workers, etc.)
 * can query Concord's surface — DTU store, CSL router, brain routing, atlas graph,
 * embeddings, lens system, federation, schema. This is the cloud fleet's shared
 * context substrate.
 *
 * Tools exposed (18 total):
 *   DTU OPERATIONS (5):
 *     - dtu_search(query, limit, tier?)        - search DTUs by free-text (FTS5 → LIKE)
 *     - dtu_get(id)                            - fetch a single DTU by id
 *     - dtu_list(limit, tier?)                 - list recent DTUs (compact)
 *     - dtu_compress(ids, max_tokens?)         - consolidate N DTUs into a compressed working-set
 *     - dtu_neighbors(id, depth?)              - get atlas graph neighbors for a DTU
 *
 *   CSL SYSTEM (3):
 *     - csl_classify(message)                  - classify user intent via CSL router
 *     - csl_compress(text, max_tokens?)        - token-budget-assembler on arbitrary text
 *     - csl_proofs_run(obligations, payload)   - run Z3 proof obligations (env-flagged)
 *
 *   BRAIN ROUTING (2):
 *     - brain_route(query, hint?)              - pick best brain for a query
 *     - brain_status()                         - current brain config + health
 *
 *   ATLAS (1):
 *     - atlas_search(query, limit)             - search across atlas nodes/edges
 *
 *   LENS (2):
 *     - lens_list()                            - all available lenses
 *     - lens_manifest(lens_id)                 - get one lens manifest
 *
 *   EMBEDDINGS (1):
 *     - embedding_search(query, limit)         - semantic search via embeddings_e5
 *
 *   FEDERATION (1):
 *     - federation_peers()                     - list federated peers
 *
 *   SCHEMA (1):
 *     - schema_status()                        - migration status + table count
 *
 *   POD (2):
 *     - pod_status()                           - pod health snapshot
 *     - pod_schema_list()                      - list tables in DB
 *
 * Endpoints:
 *   GET  /mcp/tools   - returns JSON list of tool definitions
 *   POST /mcp/call    - {tool, args} -> {result}
 *
 * Activation: requires CONCORD_MCP_PUBLIC=1 env var (Sprint 54 auth bypass).
 */

import {
  reflectMacros,
  callReflectedTool,
  getReflectionStats,
  summarizeReflection,
  REFLECTED_TOOLS,
  MACRO_REGISTRY,
} from "./macro-reflection.js";

// Run the reflection pass on module load. reflectMacros is async (walks
// server/domains + server/lib + server/routes via fs.promises, not sync fs
// calls that would otherwise block the event loop for the whole scan —
// measured at ~6s wall-clock on this tree, not the ~200ms this comment used
// to claim) — top-level await here is fine, ESM supports it, and it keeps
// module-load ordering identical to the old synchronous call.
const _reflectionTools = await reflectMacros({ maxTools: 20000, includeExports: true, includeRoutes: true });
console.debug // downgraded from log(summarizeReflection());

// DHTP — Dynamic Hybrid Tokenization Protocol (Sprint 60+)
const _dhtp = await import("./dhtp.js");
const _dhtpPresets = await import("./dhtp-presets.js");
const _breakdown = await import("./breakdown-structuring.js");

const SCHEMA_DESCRIPTION_BASE = {
  type: "object",
  properties: {},
};

function jsonSchema(properties, required) {
  return { type: "object", properties, required: required || [] };
}

function textProp(desc) { return { type: "string", description: desc }; }
function intProp(desc, def) { return { type: "integer", description: desc, default: def }; }
function arrayProp(desc, items) { return { type: "array", description: desc, items }; }
function boolProp(desc, def) { return { type: "boolean", description: desc, default: def }; }
function enumProp(desc, values) { return { type: "string", enum: values, description: desc }; }

export const MCP_TOOLS = [
  // ── DTU OPERATIONS ─────────────────────────────────────────────────────
  {
    name: "dtu_search",
    description: "Search DTUs by free-text query. Uses FTS5 index when available, falls back to LIKE search. Returns matching DTU ids + titles + snippet.",
    inputSchema: jsonSchema({
      query: textProp("Free-text search query"),
      limit: intProp("Max results (default 10, max 50)", 10),
      tier: textProp("Optional tier filter (regular, mega, hyper)")
    }, ["query"])
  },
  {
    name: "dtu_get",
    description: "Fetch a single DTU by id (exact or prefix match). Returns the full DTU including content. Use after dtu_search.",
    inputSchema: jsonSchema({ id: textProp("DTU id (uuid or short prefix)") }, ["id"])
  },
  {
    name: "dtu_list",
    description: "List recent DTUs (compact). Returns id + title + tier + created_at. Good for browsing.",
    inputSchema: jsonSchema({
      limit: intProp("Max results (default 20, max 100)", 20),
      tier: textProp("Optional tier filter")
    })
  },
  {
    name: "dtu_compress",
    description: "Consolidate N DTUs into a compressed working-set. Returns budget-bounded summary. Token-savings key tool.",
    inputSchema: jsonSchema({
      ids: arrayProp("DTU ids to consolidate", { type: "string" }),
      max_tokens: intProp("Token budget (default 4000, max 16000)", 4000)
    }, ["ids"])
  },
  {
    name: "dtu_neighbors",
    description: "Get atlas graph neighbors for a DTU (citations, related, contradicts). Returns related DTU ids.",
    inputSchema: jsonSchema({
      id: textProp("DTU id"),
      depth: intProp("Graph traversal depth (default 1, max 3)", 1)
    }, ["id"])
  },

  // ── CSL SYSTEM ─────────────────────────────────────────────────────────
  {
    name: "csl_classify",
    description: "Classify a message via the CSL router. Returns intent (tool/chat), confidence, and recommended dispatch.",
    inputSchema: jsonSchema({ message: textProp("User message to classify") }, ["message"])
  },
  {
    name: "csl_compress",
    description: "Token-budget-assembler on arbitrary input text. Returns compressed summary bounded by max_tokens.",
    inputSchema: jsonSchema({
      text: textProp("Text to compress"),
      max_tokens: intProp("Token budget (default 1000, max 8000)", 1000)
    }, ["text"])
  },
  {
    name: "csl_proofs_run",
    description: "Run CSL proof obligations (Z3-via-WASM) against a payload. Returns pass/fail per obligation. Note: some obligations are env-flagged (dev-only).",
    inputSchema: jsonSchema({
      obligations: arrayProp("List of obligation names to run", { type: "string" }),
      payload: textProp("JSON payload to evaluate")
    }, ["obligations"])
  },

  // ── BRAIN ROUTING ──────────────────────────────────────────────────────
  {
    name: "brain_route",
    description: "Pick the best brain (conscious/subconscious/utility/repair/multimodal) for a query. Returns brain name + config.",
    inputSchema: jsonSchema({
      query: textProp("Query to route"),
      hint: textProp("Optional hint (conscious/subconscious/utility/repair/multimodal)")
    }, ["query"])
  },
  {
    name: "brain_status",
    description: "Current brain configuration + health. Useful for sanity-checking the LLM routing layer.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },

  // ── ATLAS ─────────────────────────────────────────────────────────────
  {
    name: "atlas_search",
    description: "Search across the DTU atlas (nodes + edges + causal graph). Returns related DTUs ranked by relevance.",
    inputSchema: jsonSchema({
      query: textProp("Search query"),
      limit: intProp("Max results (default 10, max 50)", 10)
    }, ["query"])
  },

  // ── LENS ──────────────────────────────────────────────────────────────
  {
    name: "lens_list",
    description: "List all available lenses (UI surfaces). Returns lens id + name + tags + action types.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "lens_manifest",
    description: "Get the manifest for a specific lens. Returns its full action set + schemas.",
    inputSchema: jsonSchema({ lens_id: textProp("Lens id") }, ["lens_id"])
  },

  // ── EMBEDDINGS ────────────────────────────────────────────────────────
  {
    name: "embedding_search",
    description: "Semantic search via the embeddings_e5 store. Returns DTU ids ranked by cosine similarity to query.",
    inputSchema: jsonSchema({
      query: textProp("Search query"),
      limit: intProp("Max results (default 10, max 50)", 10)
    }, ["query"])
  },

  // ── FEDERATION ────────────────────────────────────────────────────────
  {
    name: "federation_peers",
    description: "List federated peers (cross-world DTU sync partners). Returns peer id + status + last sync.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },

  // ── SCHEMA ────────────────────────────────────────────────────────────
  {
    name: "schema_status",
    description: "Database schema status: current version, applied migrations count, table count.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },

  // ── POD ───────────────────────────────────────────────────────────────
  {
    name: "pod_status",
    description: "Pod health snapshot: uptime, RSS, heap, schema version, DTU count.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "pod_schema_list",
    description: "List all tables in the database. Useful for discovering what data is available.",
    inputSchema: jsonSchema({ pattern: textProp("Optional name pattern filter (LIKE)") })
  },

  // ── AUTONOMOUS MACRO REFLECTION (Sprint 56) ───────────────────────────
  // These tools expose the auto-discovered macros from server/domains/.
  // On boot, the reflection pass scans every domain file and generates
  // ~8,688 macro pair tools. The tools below let the fleet trigger re-scans,
  // search the discovered arsenal, and invoke any reflected macro.
  {
    name: "reflect_search",
    description: "Search the auto-discovered macro arsenal (8,688+ tools). Returns matching tool names + descriptions. Use this to discover what Concord can do without manual tool listing.",
    inputSchema: jsonSchema({
      query: textProp("Free-text search query (matches tool name, description, file)"),
      limit: intProp("Max results (default 20, max 100)", 20)
    }, ["query"])
  },
  {
    name: "reflect_invoke",
    description: "Invoke a reflected macro tool by name. Returns the macro's domain + name + a description of what would be invoked. NOTE: full execution requires the lens runtime context; this endpoint provides discovery + dispatch routing.",
    inputSchema: jsonSchema({
      tool_name: textProp("Full reflected tool name (e.g. macro.accounting.trialBalance)"),
      args: textProp("Optional JSON args string")
    }, ["tool_name"])
  },
  {
    name: "reflect_stats",
    description: "Get reflection factory stats: macros discovered, domains, scan duration, last scan time. Useful for verifying the boot pass worked.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "reflect_rescan",
    description: "Trigger a fresh reflection pass over the repo. Use this after adding new domain files or macro registrations. Slower (~200ms) but reflects the current state of the code.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },

  // ── PERSONAL DTU VAULT (Sprint 58) ──────────────────────────────────────
  // Every participant (33 workers + Dila + operator) gets a personal
  // namespace inside Concord's dtus table. Backlog pattern: workers ping
  // vault_backlog() before work, vault_done() when finished. Every 15
  // writes the vault auto-compresses via dtu_compress (megas then hypers).
  {
    name: "vault_write",
    description: "Append an entry to your personal DTU vault. type=task for operator-handed work, report for results, note for free-form context, decision for choices, blocker for stuck items.",
    inputSchema: jsonSchema({
      namespace: textProp("Your worker/agent name (e.g. 'wr-mistral-2' or 'dila')"),
      vault_type: enumProp("Entry type", ["task", "report", "note", "decision", "blocker"]),
      title: textProp("One-line summary"),
      content: textProp("Full content"),
      tags: arrayProp("Tag list", "string")
    }, ["namespace", "vault_type", "title", "content"])
  },
  {
    name: "vault_read",
    description: "Read entries from your vault. Use type/limit/since to filter. Recall past decisions/notes without operator roundtrip.",
    inputSchema: jsonSchema({
      namespace: textProp("Your worker name"),
      vault_type: enumProp("Filter by type (optional)", ["task", "report", "note", "decision", "blocker"]),
      since: textProp("ISO timestamp filter (optional)"),
      limit: intProp("Max results (default 20, max 100)", 20)
    }, ["namespace"])
  },
  {
    name: "vault_backlog",
    description: "Get unread 'task' entries for your namespace. Workers should ping this before starting work.",
    inputSchema: jsonSchema({
      namespace: textProp("Your worker name"),
      include_done: boolProp("Include reported entries (default false)")
    }, ["namespace"])
  },
  {
    name: "vault_done",
    description: "Mark a vault entry complete by reporting a result. Creates a matching report entry linked to the task.",
    inputSchema: jsonSchema({
      namespace: textProp("Your worker name"),
      task_id: textProp("Task DTU id you completed"),
      result: textProp("Your result/summary"),
      success: boolProp("Did you complete it? (default true)")
    }, ["namespace", "task_id", "result"])
  },
  {
    name: "vault_compress",
    description: "Compress old entries into a single mega-DTU summary. Run after 15+ writes to save tokens. Old entries become 'mega' tier.",
    inputSchema: jsonSchema({
      namespace: textProp("Worker name (optional - if empty, all namespaces)"),
      max_tokens: intProp("Target token count (default 4000)", 4000),
      older_than_hours: intProp("Age threshold (default 24 hours)", 24)
    })
  },
  {
    name: "vault_stats",
    description: "Vault stats: total entries, by type/namespace, oldest entry, compression ratio.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "vault_broadcast",
    description: "Post to #coordination channel visible to all workers. For operator announcements, fleet-wide decisions.",
    inputSchema: jsonSchema({
      from_namespace: textProp("Your name"),
      title: textProp("Short headline"),
      content: textProp("Body"),
      priority: enumProp("Priority", ["info", "action", "urgent"]),
      tags: arrayProp("Optional tags", "string")
    }, ["from_namespace", "title", "content"])
  },
  {
    name: "vault_inbox",
    description: "Read the shared #coordination channel. Workers should check before starting work.",
    inputSchema: jsonSchema({
      since: textProp("ISO timestamp filter (optional)"),
      limit: intProp("Max entries (default 10)", 10)
    })
  },

  // ── DILA MCP TOOLS (Sprint 60) ─────────────────────────────────────────
  // Dila = partner orchestrator. Exposes coordination, worker management,
  // skill access, and substrate wiring to all MCP clients (workers,
  // Claude Code, etc.).
  {
    name: "dila_status",
    description: "Get Dila orchestrator state: cycle count, vault stats, last activity, alive workers, MCP health.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "dila_workers",
    description: "Get worker fleet status. Returns: each worker name, model, alive state, current task, last activity. Used by operators/workers to see who's doing what.",
    inputSchema: jsonSchema({
      family: enumProp("Filter by family", ["claude", "opencode", "wr", "all"], "all"),
      limit: intProp("Max workers (default 50)", 50)
    })
  },
  {
    name: "dila_skill_list",
    description: "List all available hermes skills. Returns skill names + 1-line descriptions. Workers can load any skill via dila_skill_load.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "dila_skill_load",
    description: "Load a skill's full content (SKILL.md) into context. Returns the skill markdown. Workers should call this to absorb knowledge without operator roundtrip.",
    inputSchema: jsonSchema({
      skill: textProp("Skill name (e.g. 'cloudflare-budget-guard', 'personal-dtu-vault')")
    }, ["skill"])
  },
  {
    name: "dila_dispatch",
    description: "Dispatch a task to a worker via vault_write. Auto-reports to vault broadcast for visibility.",
    inputSchema: jsonSchema({
      worker: textProp("Worker name (e.g. 'wr-mistral-4', 'cc-haiku')"),
      task: textProp("Task title"),
      content: textProp("Full task content"),
      priority: enumProp("Priority", ["info", "action", "urgent"], "action")
    }, ["worker", "task", "content"])
  },
  {
    name: "dila_repair",
    description: "Trigger repair-cortex analysis on current state. Returns blockers + suggested fixes. Use periodically to keep concord healthy.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "dila_compress",
    description: "Manually trigger vault compression across all namespaces. Reduces token bloat in worker contexts.",
    inputSchema: jsonSchema({
      namespace: textProp("Specific namespace (empty = all)"),
      max_tokens: intProp("Target token count (default 4000)", 4000)
    })
  },
  // DHTP — Dynamic Hybrid Tokenization Protocol (Sprint 60+)
  // HASH-mode design target (~33:1 on DTU refs; live IR ~1.2×) context compression for chat prompts
  {
    name: "dhtp_detect",
    description: "Detect DHTP preset for prompt (greeting, explain, list, code, debug, etc). Returns preset id + template + compression stats.",
    inputSchema: jsonSchema({
      prompt: textProp("User prompt to analyze"),
    }, ["prompt"])
  },
  {
    name: "dhtp_compress",
    description: "Apply DHTP compression to prompt + DTU refs. ~1.2× live IR (preset path may be higher) ratio. Hash refs let LLM fetch full DTUs on demand.",
    inputSchema: jsonSchema({
      prompt: textProp("User prompt"),
      dtu_refs: arrayProp("DTU IDs (max 33)", "string"),
      base_system_prompt: textProp("Original system prompt (for ratio calc)", ""),
    }, ["prompt"])
  },
  {
    name: "dhtp_stats",
    description: "DHTP cache stats + preset list (20 presets).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "tool_compile_universe",
    description: "Compile task-relevant MCP tool subset from the full universe (hand + reflected macros). Bounds context by relevance score.",
    inputSchema: jsonSchema({
      task: textProp("Task description or intent"),
      budget: intProp("Max tools to return (default 12)", 12),
      include_reflected: boolProp("Include reflected macro tools (default true)", true),
    }, ["task"])
  },
  {
    name: "repo_graph_overview",
    description: "Repository world model overview: file/symbol/edge counts, staleness, graph kinds.",
    inputSchema: jsonSchema({
      repo_root: textProp("Optional repo root (default cwd)"),
    })
  },
  {
    name: "repo_graph_index",
    description: "Index or refresh the repository graph (imports, routes, migrations, tests).",
    inputSchema: jsonSchema({
      repo_root: textProp("Optional repo root (default cwd)"),
    })
  },
  {
    name: "repo_graph_context",
    description: "Build task-scoped repo context: symbol hits, file neighborhoods, graph summary.",
    inputSchema: jsonSchema({
      intent: textProp("Task intent or goal"),
      symbol: textProp("Optional symbol name to search"),
      file: textProp("Optional file path hint"),
      repo_root: textProp("Optional repo root"),
    }, ["intent"])
  },
  {
    name: "repo_graph_link_dtu",
    description: "Link a DTU to a repository ref (file, route, migration, symbol).",
    inputSchema: jsonSchema({
      dtu_id: textProp("DTU id"),
      repo_ref: textProp("Repository reference (e.g. server/lib/foo.js)"),
      link_kind: textProp("Link kind (references, covers, implements)", "references"),
    }, ["dtu_id", "repo_ref"])
  },
  {
    name: "memory_benchmark_run",
    description: "Run LoCoMo-style memory benchmark (factual, temporal, contradiction, stale, constraint, goal, corruption).",
    inputSchema: jsonSchema({
      case_ids: arrayProp("Optional subset of case ids", "string"),
    })
  },
  {
    name: "substrate_invoke_oracles",
    description: "Invoke deterministic substrate oracles (CAS, FEA, engineering, physics, chem, accounting) through real dual-registry dispatch; logs macro_call_log rows.",
    inputSchema: jsonSchema({
      case_ids: arrayProp("Optional subset of oracle case ids", "string"),
    })
  },
  {
    name: "dtu_retrieval_eval",
    description: "Run deterministic DTU retrieval quality eval (precision/recall, stale exclusion).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "breakdown_decompose",
    description: "Sprint 60+ Breakdown Structuring: decompose a big request (book, app, report) into N ordered subtasks. Returns structured JSON array of subtasks ready for parallel dispatch.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "breakdown_dispatch",
    description: "Sprint 60+ Breakdown Structuring: dispatch N subtasks in PARALLEL through brain fleet. Each subtask = focused 2-4k token turn. Output mints ordered DTUs.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "breakdown_stitch",
    description: "Sprint 60+ Breakdown Structuring: deterministically stitch ordered DTU bodies into one compiled text. No LLM involved.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "breakdown_build",
    description: "Sprint 60+ Breakdown Structuring: ONE-SHOT factory. Decompose, parallel dispatch, mint DTUs, stitch, render to PDF/ZIP/MD. Returns real file artifact.",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "browser_check_coins",
    description: "Browser Organ: check coin balances, positions, and P&L (O001 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "browser_check_incidents",
    description: "Browser Organ: check recent incidents and alerts (O001 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "browser_check_rate_limits",
    description: "Browser Organ: check rate-limit status across providers (O001 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "sentinel_watch",
    description: "Sentinel Organ: monitor system health + alert on anomalies (A organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "sentinel_review_alerts",
    description: "Sentinel Organ: review pending alerts (A organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "sentinel_health_snapshot",
    description: "Sentinel Organ: get current system health snapshot (A organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "sentinel_gate_diff",
    description: "Sentinel Organ: get gate diff vs baseline (A organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_record",
    description: "Trace Fabric: record a new trace event (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_lookup",
    description: "Trace Fabric: lookup traces by id (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_recent",
    description: "Trace Fabric: get recent traces (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_tool_history",
    description: "Trace Fabric: get tool invocation history (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_root_cause",
    description: "Trace Fabric: identify root cause of a failure (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "trace_backfill",
    description: "Trace Fabric: backfill missing trace data (F3 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "incident_watch",
    description: "Incident Engine: detect and report active incidents (B organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "incident_active",
    description: "Incident Engine: list active incidents (B organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "incident_history",
    description: "Incident Engine: get incident history (B organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "incident_classify",
    description: "Incident Engine: classify an incident (B organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "incident_recover",
    description: "Incident Engine: attempt recovery on an incident (B organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "research_filter",
    description: "Research Frontier: filter signals by novelty/value (D organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "research_invoke",
    description: "Research Frontier: invoke LLM research on a signal (D organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "research_findings",
    description: "Research Frontier: list recent findings (D organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "research_pending",
    description: "Research Frontier: list pending research items (D organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "research_get",
    description: "Research Frontier: get full finding details (D organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "opportunity_scan",
    description: "Opportunity Engine: scan upstream signals + propose opportunities (C organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "opportunity_list",
    description: "Opportunity Engine: list proposals with filters (C organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "opportunity_get",
    description: "Opportunity Engine: get proposal details (C organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "opportunity_approve",
    description: "Opportunity Engine: approve a proposal (C organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "opportunity_reject",
    description: "Opportunity Engine: reject a proposal (C organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "proactive_predict",
    description: "Proactive Engine: scan upstream patterns + generate predictions + schedule reminders (C.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "proactive_list_predictions",
    description: "Proactive Engine: list predictions with horizon/kind/outcome filters (C.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "proactive_list_reminders",
    description: "Proactive Engine: list reminders with status filter (C.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "proactive_dismiss_reminder",
    description: "Proactive Engine: dismiss a reminder (C.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "proactive_calibration",
    description: "Proactive Engine: show prediction accuracy (confirmed/disproved/pending) (C.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_snapshot",
    description: "Economic Controller: full unified snapshot — budget + costs + P&L + attribution (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_budget",
    description: "Economic Controller: just budget state — CF daily/monthly, OpenCode quota (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_costs",
    description: "Economic Controller: per-organ cost attribution for window (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_pnl",
    description: "Economic Controller: trading P&L ex-airdrops with fee drag breakdown (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_attribution",
    description: "Economic Controller: map specific costs to specific organs (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "economic_check",
    description: "Economic Controller: budget gate — is it safe to proceed with new spend? (E organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_compose",
    description: "Initiative Engine: read approved opportunities + proactive predictions, compose into initiatives (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_list",
    description: "Initiative Engine: list initiatives with filters (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_get",
    description: "Initiative Engine: get full initiative details (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_validate",
    description: "Initiative Engine: validate a specific initiative (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_submit",
    description: "Initiative Engine: submit initiative to F0 authority gate (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "initiative_record_execution",
    description: "Initiative Engine: operator records execution outcome for a submitted initiative (F organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "capability_mine",
    description: "Capability Forge: mine successful initiatives for patterns (F.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "capability_list_patterns",
    description: "Capability Forge: list mined patterns with filters (F.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "capability_generate_template",
    description: "Capability Forge: generate capability descriptor from a pattern (F.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "capability_list_templates",
    description: "Capability Forge: list templates with status filter (F.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "capability_register",
    description: "Capability Forge: operator approves/rejects a template (deploy risk, F0-gated) (F.5 organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_send",
    description: "A2A Boundary: send a message with envelope + durable delivery log (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_list_messages",
    description: "A2A Boundary: list sent messages with status/sender/recipient filters (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_get_message",
    description: "A2A Boundary: get full message details including delivery history (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_ack",
    description: "A2A Boundary: operator/recipient acknowledges a delivered message (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_list_routes",
    description: "A2A Boundary: list available sender -> recipient routes (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "a2a_check_delivery",
    description: "A2A Boundary: re-check status of pending/failed messages + retry (G organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_compress",
    description: "Experience-to-Learning: scan all organ DBs and create compressed chunks (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_distill",
    description: "Experience-to-Learning: group chunks and find recurring patterns (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_consolidate",
    description: "Experience-to-Learning: distill + persist semantic memories (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_list_memories",
    description: "Experience-to-Learning: list consolidated memories with filters (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_get_memory",
    description: "Experience-to-Learning: get full memory + lineage (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "experience_stats",
    description: "Experience-to-Learning: compression/distillation statistics (H organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "concordia_assemble",
    description: "Concordia: build full fleet snapshot of all 13 organs (I organ, final integration).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "concordia_verify",
    description: "Concordia: run health check on all organs + log per-organ verification (I organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "concordia_demonstrate",
    description: "Concordia: execute end-to-end cross-organ workflow (non-destructive) (I organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  },
  {
    name: "concordia_list_assemblies",
    description: "Concordia: list previous assemblies + verifications (I organ).",
    inputSchema: SCHEMA_DESCRIPTION_BASE
  }
];

// ═══════════════════════════════════════════════════════════════════════
// DTU OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

function rowToDtu(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    tier: row.tier,
    type: row.type,
    status: row.status,
    content: row.content || "",
    body_json: row.body_json,
    tags_json: row.tags_json,
    visibility: row.visibility,
    creator_id: row.creator_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function dtuSearch(db, args) {
  const query = String(args?.query || "").trim();
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
  const tier = args?.tier || null;
  if (!query) return { ok: false, error: "query is required" };

  let rows = [];
  let fts5 = false;
  try {
    const ftsQuery = query.replace(/["\\]/g, " ").trim();
    let sql, params;
    // dtus_fts is an external-content FTS5 table declared `content='dtus',
    // content_rowid='rowid'` (migration 024) — its `rowid` mirrors dtus's
    // own IMPLICIT integer rowid, NOT the TEXT `id` primary key. Joining on
    // `d.id = f.rowid` compares a UUID string to an integer and never
    // matches, so this path always silently fell through to the LIKE
    // fallback below (confirmed empirically: `fts5` was always `false`).
    // The fix joins on `d.rowid`, the column that actually corresponds.
    if (tier) {
      sql = `SELECT d.id, d.title, d.tier, d.type, substr(coalesce(d.content, ''), 1, 200) AS snippet, d.created_at
             FROM dtus d JOIN dtus_fts f ON d.rowid = f.rowid
             WHERE dtus_fts MATCH ? AND d.tier = ?
             ORDER BY rank LIMIT ?`;
      params = [ftsQuery, tier, limit];
    } else {
      sql = `SELECT d.id, d.title, d.tier, d.type, substr(coalesce(d.content, ''), 1, 200) AS snippet, d.created_at
             FROM dtus d JOIN dtus_fts f ON d.rowid = f.rowid
             WHERE dtus_fts MATCH ?
             ORDER BY rank LIMIT ?`;
      params = [ftsQuery, limit];
    }
    rows = db.prepare(sql).all(...params);
    fts5 = rows.length > 0;
  } catch (_e) { /* FTS5 unavailable, fall through */ }

  if (!fts5) {
    const like = "%" + query.replace(/[%_]/g, "\\$&") + "%";
    try {
      if (tier) {
        rows = db.prepare(
          "SELECT id, title, tier, type, substr(coalesce(content, ''), 1, 200) AS snippet, created_at FROM dtus WHERE (title LIKE ? OR content LIKE ?) AND tier = ? ORDER BY created_at DESC LIMIT ?"
        ).all(like, like, tier, limit);
      } else {
        rows = db.prepare(
          "SELECT id, title, tier, type, substr(coalesce(content, ''), 1, 200) AS snippet, created_at FROM dtus WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT ?"
        ).all(like, like, limit);
      }
    } catch (e) {
      return { ok: false, error: "DB query failed: " + String(e?.message || e) };
    }
  }
  return { ok: true, results: rows, count: rows.length, fts5 };
}

export async function dtuGet(db, args) {
  const id = String(args?.id || "").trim();
  if (!id) return { ok: false, error: "id is required" };
  try {
    let row = db.prepare(
      "SELECT id, title, tier, type, status, content, body_json, tags_json, visibility, creator_id, created_at, updated_at FROM dtus WHERE id = ? LIMIT 1"
    ).get(id);
    if (!row && id.length >= 6) {
      row = db.prepare(
        "SELECT id, title, tier, type, status, content, body_json, tags_json, visibility, creator_id, created_at, updated_at FROM dtus WHERE id LIKE ? LIMIT 1"
      ).get(id + "%");
    }
    if (!row) return { ok: false, error: "DTU not found" };
    return { ok: true, dtu: rowToDtu(row) };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

export async function dtuList(db, args) {
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
  const tier = args?.tier || null;
  try {
    let rows;
    if (tier) {
      rows = db.prepare("SELECT id, title, tier, type, created_at FROM dtus WHERE tier = ? ORDER BY created_at DESC LIMIT ?").all(tier, limit);
    } else {
      rows = db.prepare("SELECT id, title, tier, type, created_at FROM dtus ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return { ok: true, results: rows, count: rows.length };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

export async function dtuCompress(db, args) {
  const ids = Array.isArray(args?.ids) ? args.ids : [];
  const maxTokens = Math.min(16000, Math.max(500, Number(args?.max_tokens) || 4000));
  if (ids.length === 0) return { ok: false, error: "ids array is required" };
  if (ids.length > 50) return { ok: false, error: "max 50 DTUs per compress call" };

  try {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, title, tier, type, substr(coalesce(content, ''), 1, 1500) AS preview FROM dtus WHERE id IN (${placeholders})`
    ).all(...ids);
    if (rows.length === 0) return { ok: false, error: "no DTUs found" };

    const sections = rows.map((r, i) => {
      const preview = (r.preview || "").slice(0, 800).replace(/\s+/g, " ").trim();
      return `[${i + 1}/${rows.length}] ${r.id} (${r.tier}/${r.type}): ${r.title}\n${preview}`;
    });
    const workingSet = sections.join("\n\n---\n\n");

    const charBudget = maxTokens * 4;
    let compressed = workingSet;
    let truncated = false;
    if (workingSet.length > charBudget) {
      const perSection = Math.floor(charBudget / sections.length);
      compressed = sections.map(s => s.slice(0, perSection)).join("\n\n---\n\n");
      truncated = true;
    }

    return {
      ok: true,
      workingSet: compressed,
      dtuCount: rows.length,
      approxTokens: Math.ceil(compressed.length / 4),
      maxTokens,
      truncated
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

export async function dtuNeighbors(db, args) {
  const id = String(args?.id || "").trim();
  const depth = Math.min(3, Math.max(1, Number(args?.depth) || 1));
  if (!id) return { ok: false, error: "id is required" };
  try {
    // dtu_citations (migration 010) is keyed by a single dtu_id (citation
    // COUNT + signal aggregates for that one DTU) — it has no
    // source/target pair at all, so it can't answer "who cites this DTU
    // and who does it cite." dtu_causal_edges (migration 352) is the real
    // pairwise edge table, with columns child_id/parent_id/edge_type, not
    // source_id/target_id/weight. Both were wrong (confirmed empirically:
    // "no such column: source_dtu_id"). Fixed to the real schema; citation
    // *count* for this DTU (not neighbor ids — the table doesn't have any)
    // is surfaced separately as citationCount.
    const citationRow = db.prepare(
      `SELECT citation_count FROM dtu_citations WHERE dtu_id = ?`
    ).get(id);
    const causal = db.prepare(
      `SELECT child_id, parent_id, edge_type FROM dtu_causal_edges WHERE child_id = ? OR parent_id = ? LIMIT 20`
    ).all(id, id);
    const relatedIds = new Set();
    causal.forEach(c => { relatedIds.add(c.child_id); relatedIds.add(c.parent_id); });
    relatedIds.delete(id);
    return {
      ok: true,
      neighbors: Array.from(relatedIds).slice(0, 20),
      citationCount: citationRow?.citation_count ?? 0,
      causalCount: causal.length,
      depth
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CSL SYSTEM
// ═══════════════════════════════════════════════════════════════════════

export async function cslClassify(db, args) {
  const message = String(args?.message || "").trim();
  if (!message) return { ok: false, error: "message is required" };
  try {
    // Pattern-match for tool intent
    const toolPatterns = /^\s*(\/[a-z_]+|@?[a-z]+:[a-z_]+|cmd:|tool:)/i;
    const toolMatch = toolPatterns.test(message);
    const chatPatterns = /\?|how|why|what|when|tell me|explain/i;
    const chatMatch = chatPatterns.test(message);
    const intent = toolMatch ? "tool" : (chatMatch ? "chat" : "neutral");
    return {
      ok: true,
      intent: `intent:${intent}`,
      confidence: toolMatch ? 0.85 : (chatMatch ? 0.7 : 0.4),
      toolMatch: !!toolMatch,
      chatMatch: !!chatMatch,
      routerNote: "Pattern-based classification (full CSL router requires loaded modules)"
    };
  } catch (e) {
    return { ok: false, error: "classification failed: " + String(e?.message || e) };
  }
}

export async function cslCompress(db, args) {
  const text = String(args?.text || "").trim();
  const maxTokens = Math.min(8000, Math.max(100, Number(args?.max_tokens) || 1000));
  if (!text) return { ok: false, error: "text is required" };

  const charBudget = maxTokens * 4;
  let compressed = text;
  let truncated = false;
  if (text.length > charBudget) {
    // Compress: take first half + last quarter (cheap heuristic)
    const firstHalf = text.slice(0, charBudget * 0.6);
    const lastQuarter = text.slice(text.length - charBudget * 0.3);
    compressed = firstHalf + "\n\n[...]\n\n" + lastQuarter;
    truncated = true;
  }
  return {
    ok: true,
    compressed,
    originalTokens: Math.ceil(text.length / 4),
    approxTokens: Math.ceil(compressed.length / 4),
    maxTokens,
    truncated
  };
}

export async function cslProofsRun(db, args) {
  const obligations = Array.isArray(args?.obligations) ? args.obligations : [];
  const payload = args?.payload || "{}";
  if (obligations.length === 0) return { ok: false, error: "obligations array is required" };
  if (obligations.length > 10) return { ok: false, error: "max 10 obligations per call" };

  // We can't actually run Z3 here without the proof obligation module loaded.
  // Return placeholder results.
  const results = obligations.map(name => ({
    obligation: name,
    status: "not_loaded",
    note: "Proof obligations require csl-proof-obligations.js to be loaded in the same process. Use this endpoint for status checks only."
  }));
  return { ok: true, results, payload_size: String(payload).length };
}

// ═══════════════════════════════════════════════════════════════════════
// BRAIN ROUTING
// ═══════════════════════════════════════════════════════════════════════

export async function brainRoute(db, args) {
  const query = String(args?.query || "").trim();
  const hint = args?.hint || null;
  if (!query) return { ok: false, error: "query is required" };

  let brain = hint;
  if (!brain) {
    const q = query.toLowerCase();
    if (q.match(/\bcode|fix|bug|error|stack|trace\b/)) brain = "repair";
    else if (q.match(/\bimage|photo|picture|visual|draw\b/)) brain = "multimodal";
    else if (q.match(/\bsummarize|brief|recap|recap\b/)) brain = "utility";
    else if (q.match(/\bthink|reason|why|analyze|reflect\b/)) brain = "subconscious";
    else brain = "conscious";
  }

  return {
    ok: true,
    selectedBrain: brain,
    confidence: hint ? 1.0 : 0.6,
    routing: "pattern-based (full brain-router requires loaded modules)",
    alternatives: ["conscious", "subconscious", "utility", "repair", "multimodal"].filter(b => b !== brain)
  };
}

export async function brainStatus(db, args) {
  return {
    ok: true,
    brains: [
      { name: "conscious", role: "primary reasoning", endpoint: "configured" },
      { name: "subconscious", role: "background processing", endpoint: "configured" },
      { name: "utility", role: "task-specific helpers", endpoint: "configured" },
      { name: "repair", role: "code/bug fixes", endpoint: "configured" },
      { name: "multimodal", role: "vision + text", endpoint: "configured" }
    ],
    total: 5,
    routingActive: true
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ATLAS
// ═══════════════════════════════════════════════════════════════════════

export async function atlasSearch(db, args) {
  const query = String(args?.query || "").trim();
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
  if (!query) return { ok: false, error: "query is required" };

  try {
    const like = "%" + query.replace(/[%_]/g, "\\$&") + "%";
    // Search across atlas-store tables.
    // Subquery alias: the outer SELECT reads "name" from the inner derived
    // table, NOT from dtus.name (dtus only has "title"). Safe by construction.
    // @drift-ok detector trips on naive string-match of the outer column name.
    /* @drift-ok: outer SELECT reads "name" from inner derived table alias; dtus only has "title" */ const rows = db.prepare(
      `SELECT id, name, type FROM (
         SELECT id, title AS name, 'dtu' AS type FROM dtus WHERE title LIKE ? LIMIT ?
       ) ORDER BY name LIMIT ?`
    ).all(like, limit, limit);
    return { ok: true, results: rows, count: rows.length };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LENS
// ═══════════════════════════════════════════════════════════════════════

export async function lensList(db, args) {
  try {
    const rows = db.prepare(
      `SELECT DISTINCT lens_id, COUNT(*) AS dtus FROM dtus WHERE lens_id IS NOT NULL AND lens_id != 'unknown' GROUP BY lens_id ORDER BY dtus DESC LIMIT 50`
    ).all();
    return { ok: true, lenses: rows.map(r => ({ id: r.lens_id, dtuCount: r.dtus })), count: rows.length };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

export async function lensManifest(db, args) {
  const lensId = String(args?.lens_id || "").trim();
  if (!lensId) return { ok: false, error: "lens_id is required" };
  try {
    const dtus = db.prepare(
      `SELECT id, title, tier, type FROM dtus WHERE lens_id = ? ORDER BY created_at DESC LIMIT 10`
    ).all(lensId);
    return {
      ok: true,
      lens_id: lensId,
      dtuCount: dtus.length,
      sample: dtus
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════

export async function embeddingSearch(db, args) {
  const query = String(args?.query || "").trim();
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
  if (!query) return { ok: false, error: "query is required" };

  try {
    // We can't do real semantic search without the embedding model.
    // Return the metadata of recent embeddings as a placeholder.
    const rows = db.prepare(
      `SELECT dtu_id, model, source, created_at FROM embeddings_e5 ORDER BY updated_at DESC LIMIT ?`
    ).all(limit);
    return {
      ok: true,
      results: rows,
      count: rows.length,
      note: "Semantic search requires the embedding model loaded in-process. This endpoint returns recent embedding metadata."
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FEDERATION
// ═══════════════════════════════════════════════════════════════════════

export async function federationPeers(db, args) {
  try {
    const inbox = db.prepare(
      `SELECT COUNT(*) AS count FROM federation_inbox`
    ).get();
    const outbox = db.prepare(
      `SELECT COUNT(*) AS count FROM federation_outbox`
    ).get();
    // federation_peers (migration 011) has no peer_actor_id/last_seen
    // columns — its real shape is a directed tier-relationship row
    // (from_id/to_id/peer_type/sharing_policy), confirmed empirically
    // ("no such column: peer_actor_id"). fedmesh_peers (migration 348) is
    // the later, persistent per-peer registry this tool's description
    // ("peer id + status + last sync") actually describes — read from
    // there instead.
    const peers = db.prepare(
      `SELECT peer_id AS id, url, revoked, added_at AS last_seen FROM fedmesh_peers ORDER BY added_at DESC LIMIT 50`
    ).all();
    return {
      ok: true,
      peers,
      inboxCount: inbox?.count ?? 0,
      outboxCount: outbox?.count ?? 0
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════

export async function schemaStatus(db, args) {
  try {
    const verRow = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get();
    const migRow = db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get();
    const tblRow = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).get();
    return {
      ok: true,
      schemaVersion: verRow?.v ?? null,
      migrationsApplied: migRow?.c ?? 0,
      tableCount: tblRow?.c ?? 0
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// POD
// ═══════════════════════════════════════════════════════════════════════

export async function podStatus(db, args) {
  try {
    const rss = process.memoryUsage().rss;
    const heap = process.memoryUsage().heapUsed;
    const uptime = process.uptime();
    let schemaVersion = null;
    try {
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
      schemaVersion = row?.v ?? null;
    } catch (_e) { /* ignore */ }
    let dtuCount = null;
    try {
      const row = db.prepare("SELECT COUNT(*) AS c FROM dtus").get();
      dtuCount = row?.c ?? null;
    } catch (_e) { /* ignore */ }
    return {
      ok: true,
      uptime: Math.floor(uptime),
      rssMB: Math.floor(rss / 1024 / 1024),
      heapMB: Math.floor(heap / 1024 / 1024),
      schemaVersion,
      dtuCount,
      nodeVersion: process.version
    };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

export async function podSchemaList(db, args) {
  const pattern = args?.pattern ? String(args.pattern) : null;
  try {
    let rows;
    if (pattern) {
      rows = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name LIKE ? ORDER BY name LIMIT 500`
      ).all(pattern);
    } else {
      rows = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 500`
      ).all();
    }
    return { ok: true, tables: rows.map(r => r.name), count: rows.length };
  } catch (e) {
    return { ok: false, error: "DB query failed: " + String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PERSONAL DTU VAULT (Sprint 58)
// ═══════════════════════════════════════════════════════════════════════
// Each participant gets creator_id = their name; type = 'vault_<type>'.
// Vault entries are first-class DTUs in the dtus table. Auto-compression
// turns old entries into mega/hyper tier summaries.

function uuid() {
  return 'vlt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export async function vaultWrite(db, args) {
  const namespace = String(args?.namespace || "").trim();
  const vaultType = String(args?.vault_type || "note").trim();
  const title = String(args?.title || "").trim();
  const content = String(args?.content || "").trim();
  const tags = args?.tags || [];
  if (!namespace) return { ok: false, error: "namespace is required" };
  if (!title) return { ok: false, error: "title is required" };
  if (!content) return { ok: false, error: "content is required" };

  const id = uuid();
  const fullTags = ['vault', 'vault_' + vaultType, namespace, ...(Array.isArray(tags) ? tags : [])];
  const body = JSON.stringify({
    namespace,
    vault_type: vaultType,
    content,
    tags: Array.isArray(tags) ? tags : [],
    written_at: new Date().toISOString(),
  });

  try {
    db.prepare(
      "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, type, creator_id, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      null,
      '[' + vaultType.toUpperCase() + '][' + namespace + '] ' + title,
      body,
      JSON.stringify(fullTags),
      'internal',
      'regular',
      'vault_' + vaultType,
      namespace,
      content,
      'active'
    );
    return { ok: true, id, namespace, vault_type: vaultType, title, tags: fullTags };
  } catch (e) {
    return { ok: false, error: 'INSERT failed: ' + e.message };
  }
}

export async function vaultRead(db, args) {
  const namespace = String(args?.namespace || "").trim();
  const vaultType = args?.vault_type || null;
  const since = args?.since || null;
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
  if (!namespace) return { ok: false, error: "namespace is required" };

  let sql, params;
  if (vaultType) {
    sql = "SELECT id, title, body_json, tags_json, created_at, tier FROM dtus WHERE creator_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?";
    params = [namespace, 'vault_' + vaultType, limit];
  } else {
    sql = "SELECT id, title, body_json, tags_json, created_at, tier FROM dtus WHERE creator_id = ? ORDER BY created_at DESC LIMIT ?";
    params = [namespace, limit];
  }
  try {
    const rows = db.prepare(sql).all(...params);
    const filtered = since ? rows.filter(r => r.created_at >= since) : rows;
    return {
      ok: true,
      namespace,
      count: filtered.length,
      entries: filtered.map(r => ({
        id: r.id,
        title: r.title,
        body: (() => { try { return JSON.parse(r.body_json); } catch(_e) { return {}; } })(),
        tags: (() => { try { return JSON.parse(r.tags_json); } catch(_e) { return []; } })(),
        created_at: r.created_at,
        tier: r.tier,
      })),
    };
  } catch (e) {
    return { ok: false, error: 'query failed: ' + e.message };
  }
}

export async function vaultBacklog(db, args) {
  const namespace = String(args?.namespace || "").trim();
  const includeDone = !!args?.include_done;
  if (!namespace) return { ok: false, error: "namespace is required" };

  try {
    // Get all task entries for this namespace
    const tasks = db.prepare(
      "SELECT id, title, body_json, created_at FROM dtus WHERE creator_id = ? AND type = 'vault_task' ORDER BY created_at ASC"
    ).all(namespace);

    // Get all report entries to know which are done
    const reports = db.prepare(
      "SELECT body_json FROM dtus WHERE creator_id = ? AND type = 'vault_report'"
    ).all(namespace);
    const reportedTaskIds = new Set();
    for (const r of reports) {
      try {
        const body = JSON.parse(r.body_json);
        if (body.task_id) reportedTaskIds.add(body.task_id);
      } catch(_e) { /* observed: silent catch is intentional */ }
    }

    const backlog = includeDone ? tasks : tasks.filter(t => !reportedTaskIds.has(t.id));
    return {
      ok: true,
      namespace,
      backlog_count: backlog.length,
      total_tasks: tasks.length,
      done_count: tasks.length - backlog.length,
      entries: backlog.map(t => {
        let body = {};
        try { body = JSON.parse(t.body_json); } catch(_e) { /* observed: silent catch is intentional */ }
        return {
          id: t.id,
          title: t.title,
          content: body.content || '',
          tags: body.tags || [],
          created_at: t.created_at,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function vaultDone(db, args) {
  const namespace = String(args?.namespace || "").trim();
  const taskId = String(args?.task_id || "").trim();
  const result = String(args?.result || "").trim();
  const success = args?.success !== false;
  if (!namespace) return { ok: false, error: "namespace is required" };
  if (!taskId) return { ok: false, error: "task_id is required" };
  if (!result) return { ok: false, error: "result is required" };

  const id = uuid();
  try {
    db.prepare(
      "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, type, creator_id, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      null,
      '[REPORT][' + namespace + '] ' + (success ? 'DONE' : 'BLOCKED') + ': ' + taskId,
      JSON.stringify({ namespace, task_id: taskId, result, success, reported_at: new Date().toISOString() }),
      JSON.stringify(['vault', 'vault_report', namespace, 'task:' + taskId]),
      'internal', 'regular', 'vault_report', namespace, result, 'active'
    );
    return { ok: true, id, namespace, task_id: taskId, success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function vaultCompress(db, args) {
  const namespace = args?.namespace ? String(args.namespace) : null;
  const maxTokens = Math.max(500, Math.min(50000, Number(args?.max_tokens) || 4000));
  const olderThanHours = Math.max(0, Number(args?.older_than_hours) || 24);
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();

  try {
    let old;
    if (namespace) {
      old = db.prepare(
        "SELECT id, title, body_json FROM dtus WHERE creator_id = ? AND type LIKE 'vault_%' AND tier = 'regular' AND created_at < ? ORDER BY created_at ASC LIMIT 50"
      ).all(namespace, cutoff);
    } else {
      old = db.prepare(
        "SELECT id, title, body_json FROM dtus WHERE type LIKE 'vault_%' AND tier = 'regular' AND created_at < ? ORDER BY created_at ASC LIMIT 50"
      ).all(cutoff);
    }
    if (old.length < 5) {
      return { ok: true, compressed: 0, message: "Not enough entries to compress (need >=5)" };
    }

    const summary = old.map((e, i) => {
      let body = {};
      try { body = JSON.parse(e.body_json); } catch(_e) { /* observed: silent catch is intentional */ }
      return (i + 1) + '. [' + (body.vault_type || '?') + '] ' + e.title + ': ' + (body.content || '').slice(0, 150);
    }).join('\n');

    const megaId = 'mega_' + Date.now().toString(36);
    const megaTitle = '[MEGA][' + (namespace || 'all') + '] ' + old.length + ' entries from ' + old[0].title.slice(0, 60);

    // Insert the mega
    db.prepare(
      "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, type, creator_id, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      megaId,
      null,
      megaTitle,
      JSON.stringify({ namespace: namespace || 'all', summary, source_count: old.length, compressed_at: new Date().toISOString() }),
      JSON.stringify(['vault', 'mega', namespace || 'all', 'compressed_' + old.length]),
      'internal', 'mega', 'vault_mega', namespace || 'all', summary, 'active'
    );

    // Bump old entries tier (mark them as superseded)
    const ids = old.map(o => o.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      "UPDATE dtus SET tier = 'shadow', body_json = json_set(body_json, '$.superseded_by', ?) WHERE id IN (" + placeholders + ")"
    ).run(megaId, ...ids);

    return { ok: true, compressed: old.length, mega_id: megaId, mega_title: megaTitle };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function vaultStats(db, args) {
  try {
    const total = db.prepare("SELECT COUNT(*) as c FROM dtus WHERE type LIKE 'vault_%'").get();
    const byType = db.prepare(
      "SELECT type, COUNT(*) as count FROM dtus WHERE type LIKE 'vault_%' GROUP BY type ORDER BY count DESC"
    ).all();
    const byNamespace = db.prepare(
      "SELECT creator_id as namespace, COUNT(*) as count FROM dtus WHERE type LIKE 'vault_%' AND creator_id != 'coordination' GROUP BY creator_id ORDER BY count DESC LIMIT 20"
    ).all();
    const oldest = db.prepare(
      "SELECT MIN(created_at) as oldest FROM dtus WHERE type LIKE 'vault_%'"
    ).get();
    return {
      ok: true,
      total_entries: total.c,
      by_type: byType,
      by_namespace: byNamespace,
      oldest_entry: oldest?.oldest || null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function vaultBroadcast(db, args) {
  return vaultWrite(db, {
    namespace: 'coordination',
    vault_type: 'note',
    title: '[' + (args?.priority || 'info').toUpperCase() + '] ' + String(args?.title || ''),
    content: 'From: ' + String(args?.from_namespace || '?') + '\n\n' + String(args?.content || ''),
    tags: ['coordination', 'broadcast', ...(args?.tags || [])],
  });
}

export async function vaultInbox(db, args) {
  const since = args?.since || null;
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));

  try {
    let rows;
    if (since) {
      rows = db.prepare(
        "SELECT id, title, body_json, created_at FROM dtus WHERE creator_id = 'coordination' AND type = 'vault_note' AND created_at >= ? ORDER BY created_at DESC LIMIT ?"
      ).all(since, limit);
    } else {
      rows = db.prepare(
        "SELECT id, title, body_json, created_at FROM dtus WHERE creator_id = 'coordination' AND type = 'vault_note' ORDER BY created_at DESC LIMIT ?"
      ).all(limit);
    }
    return {
      ok: true,
      count: rows.length,
      broadcasts: rows.map(r => {
        let body = {};
        try { body = JSON.parse(r.body_json); } catch(_e) { /* observed: silent catch is intentional */ }
        return {
          id: r.id,
          title: r.title,
          from: body.namespace || '?',
          content: body.content || '',
          tags: body.tags || [],
          created_at: r.created_at,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// AUTONOMOUS MACRO REFLECTION (Sprint 56)
// ═══════════════════════════════════════════════════════════════════════

export async function reflectSearch(db, args) {
  const query = String(args?.query || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
  if (!query) return { ok: false, error: "query is required" };

  const matches = REFLECTED_TOOLS.filter(t =>
    t.name.toLowerCase().includes(query) ||
    t.description.toLowerCase().includes(query) ||
    (t._meta?.file || "").toLowerCase().includes(query)
  ).slice(0, limit);

  return {
    ok: true,
    query,
    matches: matches.map(t => ({
      name: t.name,
      description: t.description.slice(0, 200),
      file: t._meta?.file,
      domain: t._meta?.domain,
      kind: t._meta?.kind,
    })),
    count: matches.length,
    totalAvailable: REFLECTED_TOOLS.length,
  };
}

export async function reflectInvoke(db, args) {
  const toolName = String(args?.tool_name || "").trim();
  const argsStr = args?.args || "{}";
  if (!toolName) return { ok: false, error: "tool_name is required" };

  let parsedArgs = {};
  try { parsedArgs = JSON.parse(argsStr); } catch (_e) { /* keep empty */ }

  return await callReflectedTool(toolName, parsedArgs);
}

export async function reflectStats(db, args) {
  return {
    ok: true,
    ...getReflectionStats(),
    note: "Reflection factory auto-discovers macros from server/domains/ on boot."
  };
}

export async function reflectRescan(db, args) {
  await reflectMacros({ maxTools: 20000, includeExports: true, includeRoutes: true });
  return {
    ok: true,
    rescanCompleted: true,
    ...getReflectionStats()
  };
}

// ═══════════════════════════════════════════════════════════════════════
// DISPATCHER
// ═══════════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════════
// DILA TOOLS (Sprint 60)
// ═══════════════════════════════════════════════════════════════════════

async function dilaStatus(db, args = {}) {
  // Returns Dila orchestrator state.
  try {
    const vault = await vaultStats(db, {});
    const pod = await podStatus(db, {});
    return {
      ok: true,
      dila: {
        active: true,
        cycle: "auto-managed",
        vault_total: vault?.total_entries || 0,
        vault_by_type: vault?.by_type || {},
        pod_uptime_s: pod?.uptime || 0,
        pod_dtus: pod?.dtuCount || 0,
        pod_rss_mb: pod?.rssMB || 0,
        mcp_public: true,
        ts: new Date().toISOString(),
      },
      note: "Dila orchestrator status. For worker-level detail, use dila_workers."
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function dilaWorkers(db, args = {}) {
  const { listDilaWorkers } = await import("./dila-workers.js");
  return listDilaWorkers({
    family: args?.family || "all",
    limit: args?.limit || 50,
  });
}

async function dilaSkillList(db, args = {}) {
  // List hermes skills from vault (populated by operator with vault_write)
  try {
    const r = await vaultRead(db, { namespace: 'skills', vault_type: 'skill', limit: 100 });
    const entries = (r && r.entries) || [];
    const skills = entries.map(e => {
      const body = (e.body && e.body.content) || '';
      const firstLine = body.split('\n')[0] || '';
      // description comes from the YAML frontmatter line
      const m = body.match(/description:\s*(.+)/);
      let description = m ? m[1].trim().slice(0, 140) : (firstLine.slice(0, 140) || '');
      // Strip "[SKILL][namespace] " prefix from title
      let name = e.title || '';
      const tm = name.match(/^\[.*?\]\[.*?\]\s*(.+)$/);
      if (tm) name = tm[1];
      return { name, description, id: e.id };
    });
    return { ok: true, total: skills.length, skills };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function dilaSkillLoad(db, args = {}) {
  // Load skill content from vault (operator populated SKILL.md via vault_write)
  const skill = String(args?.skill || '').trim();
  if (!skill) return { ok: false, error: 'skill name required' };
  try {
    const r = await vaultRead(db, { namespace: 'skills', vault_type: 'skill', limit: 100 });
    const entries = (r && r.entries) || [];
    // Match either raw title or stripped title (strip "[TAG][namespace] " prefix)
    const match = entries.find(e => {
      let name = e.title || '';
      const m = name.match(/^\[.*?\]\[.*?\]\s*(.+)$/);
      if (m) name = m[1];
      return name === skill;
    });
    if (match) {
      // vault entries store content in body.content
      const c = (match.body && match.body.content) || match.content || '';
      return { ok: true, skill, source: 'vault', id: match.id, content: c, bytes: c.length };
    }
    return { ok: false, error: `skill not found: ${skill}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function dilaDispatch(db, args = {}) {
  // Writes a task to vault and broadcasts to coordination channel.
  const worker = String(args?.worker || '').trim();
  const task = String(args?.task || '').trim();
  const content = String(args?.content || '').trim();
  const priority = String(args?.priority || 'action');
  if (!worker || !task || !content) {
    return { ok: false, error: "worker, task, content are all required" };
  }
  // Write to vault under coordination namespace (so all workers see it)
  const writeResult = await vaultWrite(db, {
    namespace: 'coordination',
    vault_type: 'task',
    title: `[dispatch→${worker}] ${task}`,
    content,
    tags: ['dispatch', worker, priority],
  });
  // Also broadcast
  await vaultBroadcast(db, {
    from_namespace: 'dila',
    title: `DISPATCH→${worker}: ${task}`,
    content: `Worker: ${worker}\nTask: ${task}\n\n${content}`,
    priority,
  });
  return { ok: true, dispatched: worker, task, vault_id: writeResult?.id, priority };
}

async function dilaRepair(db, args = {}) {
  // Triggers a vault blocker scan + summary
  // Returns recent blockers by namespace.
  const blockers = await vaultRead(db, { vault_type: 'blocker', limit: 20 });
  const reports = await vaultRead(db, { vault_type: 'report', limit: 10 });
  return {
    ok: true,
    ts: new Date().toISOString(),
    recent_blockers: (blockers?.entries || []).slice(0, 10),
    recent_reports: (reports?.entries || []).slice(0, 5),
    note: "Repair cortex monitors via vault blockers. For full audit run detector scripts."
  };
}

async function dilaCompress(db, args = {}) {
  // Trigger vault compression across namespaces
  const namespace = String(args?.namespace || '').trim();
  const maxTokens = Number(args?.max_tokens || 4000);
  const result = await vaultCompress(db, {
    namespace: namespace || undefined,
    max_tokens: maxTokens,
  });
  return result || { ok: false, error: 'compression failed' };
}

// ═══════════════════════════════════════════════════════════════════════
// DHTP — Dynamic Hybrid Tokenization Protocol (Sprint 60+)
// HASH-mode design target (~33:1 on DTU refs; live IR ~1.2×) context compression for chat prompts
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detect the DHTP preset for a prompt. Returns preset info + match stats.
 */
async function dhtpDetect(db, args = {}) {
  try {
    const prompt = String(args?.prompt || "");
    const detected = _dhtp.selectPreset(prompt);
    if (!detected.matched) {
      return {
        ok: true,
        matched: false,
        prompt,
        matchTimeMs: detected.matchTimeMs,
        note: "No preset matched — will use default pipeline",
      };
    }
    return {
      ok: true,
      matched: true,
      prompt,
      presetId: detected.preset.id,
      template: detected.preset.template,
      dtuBudgetPct: detected.preset.dtuBudgetPct,
      maxResponseTokens: detected.preset.maxResponseTokens,
      matchTimeMs: detected.matchTimeMs,
    };
  } catch (e) {
    return { ok: false, error: `dhtp_detect failed: ${e?.message || String(e)}` };
  }
}

/**
 * Apply DHTP compression to a prompt + DTU refs.
 * Returns compact system prompt + hash refs.
 */
async function dhtpCompress(db, args = {}) {
  try {
    const prompt = String(args?.prompt || "");
    const dtuRefs = Array.isArray(args?.dtu_refs) ? args.dtu_refs : [];
    const baseSystemPrompt = String(args?.base_system_prompt || "");

    // Fetch DTUs from refs (real ones if db available)
    const workingSet = [];
    if (db && dtuRefs.length > 0) {
      try {
        const boundRefs = dtuRefs.slice(0, 33);
        // placeholders must match boundRefs' length, not the full (unbounded)
        // dtuRefs — passing more than 33 refs previously generated MORE "?"
        // placeholders than bound arguments, which better-sqlite3 throws on
        // ("wrong number of parameter bindings") instead of silently truncating.
        const placeholders = boundRefs.map(() => "?").join(",");
        const rows = db.prepare(`SELECT id, title, tier, metadata_json, updated_at FROM dtus WHERE id IN (${placeholders})`).all(...boundRefs);
        for (const r of rows) {
          workingSet.push({
            id: r.id,
            title: r.title,
            tier: r.tier || "regular",
            updatedAt: r.updated_at,
          });
        }
      } catch (e) {
        // DTUs not accessible — use refs directly
        for (const id of dtuRefs.slice(0, 33)) {
          workingSet.push({ id, title: id, tier: "regular" });
        }
      }
    }

    const result = _dhtp.applyDHTP({
      prompt,
      workingSetDtus: workingSet,
      baseSystemPrompt,
    });

    return {
      ok: true,
      compressed: result.compressed,
      presetId: result.presetId,
      systemPrompt: result.systemPrompt,
      dtuRefs: result.dtuRefs,
      dtuHash: result.dtuHash,
      dtuBlockSize: result.dtuBlockCompressed.length,
      maxResponseTokens: result.maxResponseTokens,
      dtuBudgetPct: result.dtuBudgetPct,
      originalChars: result.originalChars,
      compressedChars: result.compressedChars,
      ratio: result.ratio,
      matchTimeMs: result.matchTimeMs,
    };
  } catch (e) {
    return { ok: false, error: `dhtp_compress failed: ${e?.message || String(e)}` };
  }
}

/**
 * DHTP statistics — cache hit rate + preset list.
 */


// ── Breakdown Structuring implementations ─────────────────────────────────────

async function breakdownDecompose(db, args = {}, STATE) {
  try {
    const r = await _breakdown.decomposeIntoSubtasks({
      request: args.request,
      unit: args.unit,
      count: args.count,
      db,
      userId: args.userId,
    });
    return r;
  } catch (e) {
    return { ok: false, error: `breakdown_decompose failed: ${e?.message || String(e)}` };
  }
}

async function breakdownDispatch(db, args = {}, STATE) {
  try {
    const subtasks = typeof args.subtasks === "string" ? JSON.parse(args.subtasks) : args.subtasks;
    const r = await _breakdown.dispatchSubtasksInParallel({
      subtasks,
      request: args.request,
      db,
      userId: args.userId,
      unit: args.unit,
    });
    return r;
  } catch (e) {
    return { ok: false, error: `breakdown_dispatch failed: ${e?.message || String(e)}` };
  }
}

async function breakdownStitch(db, args = {}) {
  try {
    const r = await _breakdown.stitchDtusToBody({
      db,
      dtuIds: args.dtuIds,
      title: args.title,
    });
    return r;
  } catch (e) {
    return { ok: false, error: `breakdown_stitch failed: ${e?.message || String(e)}` };
  }
}

async function breakdownBuild(db, args = {}, STATE) {
  try {
    const r = await _breakdown.buildMassArtifact({
      request: args.request,
      unit: args.unit,
      count: args.count,
      format: args.format,
      userId: args.userId,
      db,
      title: args.title,
      STATE,
    });
    return r;
  } catch (e) {
    return { ok: false, error: `breakdown_build failed: ${e?.message || String(e)}` };
  }
}

async function dhtpStats(db, args = {}) {
  try {
    const stats = _dhtp.getDHTPStats();
    return {
      ok: true,
      cache: stats.cache,
      presets: stats.presets,
      presetList: _dhtpPresets.DHTP_PRESETS.map(p => ({
        id: p.id,
        pattern: p.pattern,
        dtuBudgetPct: p.dtu_budget_pct,
        maxResponseTokens: p.max_response_tokens,
      })),
    };
  } catch (e) {
    return { ok: false, error: `dhtp_stats failed: ${e?.message || String(e)}` };
  }
}

async function toolCompileUniverse(db, args = {}) {
  try {
    const { compileToolUniverse } = await import("./runtime/tool-universe-compiler.js");
    return compileToolUniverse(args.task || args.intent || "", {
      budget: args.budget || 12,
      includeReflected: args.include_reflected !== false,
      handTools: MCP_TOOLS,
      alwaysInclude: args.always_include || [],
    });
  } catch (e) {
    return { ok: false, error: `tool_compile_universe failed: ${e?.message || String(e)}` };
  }
}

async function repoGraphOverview(db, args = {}) {
  try {
    const { getRepositoryWorldModel } = await import("./runtime/repository-world-model.js");
    const model = await getRepositoryWorldModel(db, { repoRoot: args.repo_root });
    return { ok: true, overview: model.overview, refreshed: model.refreshed };
  } catch (e) {
    return { ok: false, error: `repo_graph_overview failed: ${e?.message || String(e)}` };
  }
}

async function repoGraphIndex(db, args = {}) {
  try {
    const { ensureRepoWorldModel } = await import("./runtime/repository-world-model.js");
    return ensureRepoWorldModel(db, args.repo_root);
  } catch (e) {
    return { ok: false, error: `repo_graph_index failed: ${e?.message || String(e)}` };
  }
}

async function repoGraphContext(db, args = {}) {
  try {
    const { buildRepoContextForTask } = await import("./runtime/repository-world-model.js");
    return buildRepoContextForTask(db, {
      intent: args.intent,
      symbol: args.symbol,
      file: args.file,
      keywords: args.keywords,
    }, { repoRoot: args.repo_root });
  } catch (e) {
    return { ok: false, error: `repo_graph_context failed: ${e?.message || String(e)}` };
  }
}

async function repoGraphLinkDtu(db, args = {}) {
  try {
    const { linkDtuToRepo } = await import("./runtime/repository-world-model.js");
    return linkDtuToRepo(db, args.dtu_id, args.repo_ref, args.link_kind || "references", args.meta);
  } catch (e) {
    return { ok: false, error: `repo_graph_link_dtu failed: ${e?.message || String(e)}` };
  }
}

async function memoryBenchmarkRun(db, args = {}) {
  try {
    const { runMemoryBenchmark } = await import("./runtime/memory-benchmark.js");
    return runMemoryBenchmark(db, { caseIds: args.case_ids });
  } catch (e) {
    return { ok: false, error: `memory_benchmark_run failed: ${e?.message || String(e)}` };
  }
}

/** Invoke CAS/FEA/engineering/physics/chem/accounting oracles — real dispatch + macro_call_log. */
async function substrateInvokeOracles(db, args = {}) {
  try {
    const run = globalThis.__concordRunMcpTool;
    if (typeof run !== "function") {
      return { ok: false, error: "dispatch_unavailable", detail: "server not fully booted" };
    }
    const { runSubstrateOracles } = await import("./runtime/substrate-oracles.js");
    const mod = await import("../server.js");
    const T = mod.__TEST__;
    const ctx = T?.makeInternalCtx ? T.makeInternalCtx("substrate-mcp") : { actor: { userId: "substrate-mcp" } };
    return await runSubstrateOracles({
      dispatch: (domain, name, input, c) => run(domain, name, input, c),
      ctx,
      db,
      logCalls: true,
      userId: "substrate-mcp",
      caseIds: args.case_ids,
    });
  } catch (e) {
    return { ok: false, error: `substrate_invoke_oracles failed: ${e?.message || String(e)}` };
  }
}

async function dtuRetrievalEval(db, args = {}) {
  try {
    const { runDtuRetrievalEval } = await import("./runtime/dtu-retrieval-eval.js");
    return runDtuRetrievalEval(db);
  } catch (e) {
    return { ok: false, error: `dtu_retrieval_eval failed: ${e?.message || String(e)}` };
  }
}

/* ========================================================================
 * ORGAN WRAPPERS — stdio JSON-RPC delegates to standalone Python organs.
 * Each wrapper spawns the organ's Python entrypoint and forwards the call.
 * ======================================================================== */

async function organCall(organPath, toolName, args, organLabel) {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const python = process.env.ORGAN_PYTHON || "python3";
  const target = process.env[organLabel + "_PATH"] || organPath;

  const f0TraceId = (args && args.__trace_id) ||
                    globalThis.__concordLastTraceId ||
                    null;
  const cleanArgs = { ...(args || {}) };
  delete cleanArgs.__trace_id;

  return new Promise((resolve) => {
    try {
      const init = JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {},
                  clientInfo: { name: "concord-mcp", version: "1.0.0" } },
      });
      const params = { name: toolName, arguments: cleanArgs };
      if (f0TraceId) params._meta = { trace_id: f0TraceId };
      const callMsg = JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params,
      });
      const proc = spawn(python, [target]);
      let out = "";
      let err = "";
      proc.stdout.on("data", d => out += d);
      proc.stderr.on("data", d => err += d);
      proc.on("close", () => {
        try {
          const lines = out.split("\n").filter(l => l.trim());
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.id === 2 && msg.result?.content?.[0]?.text) {
                const text = msg.result.content[0].text;
                try {
                  const organResult = JSON.parse(text);
                  if (f0TraceId) organResult.f0_trace_id = f0TraceId;
                  resolve(organResult);
                  return;
                } catch {
                  resolve({ ok: false, error: organLabel + ": unparseable text", raw: text.slice(0, 500), f0_trace_id: f0TraceId });
                  return;
                }
              }
            } catch { /* noop */ }
          }
          resolve({ ok: false, error: organLabel + ": no valid response", raw: out.slice(0, 500), stderr: err.slice(0, 200), f0_trace_id: f0TraceId });
        } catch (e) {
          resolve({ ok: false, error: organLabel + " parse failed: " + e.message });
        }
      });
      proc.on("error", (e) => {
        resolve({ ok: false, error: organLabel + " spawn failed: " + e.message });
      });
      proc.stdin.write(init + "\n" + callMsg + "\n");
      proc.stdin.end();
    } catch (e) {
      resolve({ ok: false, error: organLabel + " wrapper failed: " + e.message });
    }
  });
}

// Exported (2026-09-05) so lib/runtime/capability-registry.js's
// MCP_ORGAN_OWNERS table can be drift-checked against this map by
// tests/runtime/capability-registry-organ-paths.test.js, rather than the two
// silently disagreeing if an organ script is ever relocated.
export const ORGANS = {
  BROWSER_ORGAN:  "/Users/dutch/.local/bin/browser-organ.py",
  SENTINEL:       "/Users/dutch/.local/bin/sentinel-organ.py",
  TRACE_FABRIC:   "/Users/dutch/.local/bin/trace-fabric.py",
  INCIDENT_ENGINE:"/Users/dutch/.local/bin/incident-engine.py",
  RESEARCH:       "/Users/dutch/.local/bin/research-frontier.py",
  OPPORTUNITY:    "/Users/dutch/.local/bin/opportunity-engine.py",
  PROACTIVE:      "/Users/dutch/.local/bin/proactive-engine.py",
  ECONOMIC:       "/Users/dutch/.local/bin/economic-controller.py",
  INITIATIVE:     "/Users/dutch/.local/bin/initiative-engine.py",
  CAPABILITY_FORGE: "/Users/dutch/.local/bin/capability-forge.py",
  A2A_BOUNDARY:    "/Users/dutch/.local/bin/a2a-boundary.py",
  EXPERIENCE_LEARNER: "/Users/dutch/.local/bin/experience-learner.py",
  CONCORDIA:        "/Users/dutch/.local/bin/concordia.py",
};

async function browserOrganCall(db, args, STATE, toolName) {
  return organCall(ORGANS.BROWSER_ORGAN, toolName, args, "browser-organ");
}
async function sentinelOrganCall(db, args, STATE, toolName) {
  return organCall(ORGANS.SENTINEL, toolName, args, "sentinel-organ");
}
async function traceFabricCall(db, args, STATE, toolName) {
  return organCall(ORGANS.TRACE_FABRIC, toolName, args, "trace-fabric");
}
async function incidentEngineCall(db, args, STATE, toolName) {
  return organCall(ORGANS.INCIDENT_ENGINE, toolName, args, "incident-engine");
}
async function researchFrontierCall(db, args, STATE, toolName) {
  return organCall(ORGANS.RESEARCH, toolName, args, "research-frontier");
}
async function opportunityEngineCall(db, args, STATE, toolName) {
  return organCall(ORGANS.OPPORTUNITY, toolName, args, "opportunity-engine");
}
async function proactiveEngineCall(db, args, STATE, toolName) {
  return organCall(ORGANS.PROACTIVE, toolName, args, "proactive-engine");
}

async function economicControllerCall(db, args, STATE, toolName) {
  return organCall(ORGANS.ECONOMIC, toolName, args, "economic-controller");
}

async function initiativeEngineCall(db, args, STATE, toolName) {
  return organCall(ORGANS.INITIATIVE, toolName, args, "initiative-engine");
}

async function capabilityForgeCall(db, args, STATE, toolName) {
  return organCall(ORGANS.CAPABILITY_FORGE, toolName, args, "capability-forge");
}

async function a2aBoundaryCall(db, args, STATE, toolName) {
  return organCall(ORGANS.A2A_BOUNDARY, toolName, args, "a2a-boundary");
}

async function experienceLearnerCall(db, args, STATE, toolName) {
  return organCall(ORGANS.EXPERIENCE_LEARNER, toolName, args, "experience-learner");
}

async function concordiaCall(db, args, STATE, toolName) {
  return organCall(ORGANS.CONCORDIA, toolName, args, "concordia");
}

export async function callMCPTool(db, toolName, args, STATE) {
  switch (toolName) {
    case "dila_status":          return dilaStatus(db, args);
    case "dila_workers":         return dilaWorkers(db, args);
    case "dila_skill_list":      return dilaSkillList(db, args);
    case "dila_skill_load":      return dilaSkillLoad(db, args);
    case "dila_dispatch":        return dilaDispatch(db, args);
    case "dila_repair":          return dilaRepair(db, args);
    case "dila_compress":        return dilaCompress(db, args);
  case "dhtp_detect":          return dhtpDetect(db, args);
  case "dhtp_compress":        return dhtpCompress(db, args);
  case "dhtp_stats":           return dhtpStats(db, args);
  case "tool_compile_universe": return toolCompileUniverse(db, args);
  case "repo_graph_overview":  return repoGraphOverview(db, args);
  case "repo_graph_index":     return repoGraphIndex(db, args);
  case "repo_graph_context":   return repoGraphContext(db, args);
  case "repo_graph_link_dtu":  return repoGraphLinkDtu(db, args);
  case "memory_benchmark_run": return memoryBenchmarkRun(db, args);
  case "substrate_invoke_oracles": return substrateInvokeOracles(db, args);
  case "dtu_retrieval_eval":   return dtuRetrievalEval(db, args);
  case "breakdown_decompose":  return breakdownDecompose(db, args, STATE);
  case "breakdown_dispatch":   return breakdownDispatch(db, args, STATE);
  case "breakdown_stitch":     return breakdownStitch(db, args);
  case "breakdown_build":      return breakdownBuild(db, args, STATE);
    case "dtu_search":         return dtuSearch(db, args);
    case "dtu_get":            return dtuGet(db, args);
    case "dtu_list":           return dtuList(db, args);
    case "dtu_compress":       return dtuCompress(db, args);
    case "dtu_neighbors":      return dtuNeighbors(db, args);
    case "csl_classify":       return cslClassify(db, args);
    case "csl_compress":       return cslCompress(db, args);
    case "csl_proofs_run":     return cslProofsRun(db, args);
    case "brain_route":        return brainRoute(db, args);
    case "brain_status":       return brainStatus(db, args);
    case "atlas_search":       return atlasSearch(db, args);
    case "lens_list":          return lensList(db, args);
    case "lens_manifest":      return lensManifest(db, args);
    case "embedding_search":   return embeddingSearch(db, args);
    case "federation_peers":   return federationPeers(db, args);
    case "schema_status":      return schemaStatus(db, args);
    case "pod_status":         return podStatus(db, args);
    case "pod_schema_list":    return podSchemaList(db, args);
    case "reflect_search":     return reflectSearch(db, args);
    case "reflect_invoke":     return reflectInvoke(db, args);
    case "reflect_stats":      return reflectStats(db, args);
    case "reflect_rescan":     return reflectRescan(db, args);
    case "vault_write":        return vaultWrite(db, args);
    case "vault_read":         return vaultRead(db, args);
    case "vault_backlog":      return vaultBacklog(db, args);
    case "vault_done":         return vaultDone(db, args);
    case "vault_compress":     return vaultCompress(db, args);
    case "vault_stats":        return vaultStats(db, args);
    case "vault_broadcast":    return vaultBroadcast(db, args);
    case "vault_inbox":        return vaultInbox(db, args);
        // === 2026-08-31 BROWSER ORGAN (O001) ===
    case "browser_check_coins":          return browserOrganCall(db, args, STATE, "browser_check_coins");
    case "browser_check_incidents":      return browserOrganCall(db, args, STATE, "browser_check_incidents");
    case "browser_check_rate_limits":    return browserOrganCall(db, args, STATE, "browser_check_rate_limits");
    // === 2026-08-31 SENTINEL ORGAN (A) ===
    case "sentinel_watch":               return sentinelOrganCall(db, args, STATE, "sentinel_watch");
    case "sentinel_review_alerts":       return sentinelOrganCall(db, args, STATE, "sentinel_review_alerts");
    case "sentinel_health_snapshot":     return sentinelOrganCall(db, args, STATE, "sentinel_health_snapshot");
    case "sentinel_gate_diff":           return sentinelOrganCall(db, args, STATE, "sentinel_gate_diff");
    // === 2026-08-31 TRACE FABRIC ORGAN (F3) ===
    case "trace_record":                 return traceFabricCall(db, args, STATE, "trace_record");
    case "trace_lookup":                 return traceFabricCall(db, args, STATE, "trace_lookup");
    case "trace_recent":                 return traceFabricCall(db, args, STATE, "trace_recent");
    case "trace_tool_history":           return traceFabricCall(db, args, STATE, "trace_tool_history");
    case "trace_root_cause":             return traceFabricCall(db, args, STATE, "trace_root_cause");
    case "trace_backfill":               return traceFabricCall(db, args, STATE, "trace_backfill");
    // === 2026-08-31 INCIDENT ENGINE ORGAN (B) ===
    case "incident_watch":               return incidentEngineCall(db, args, STATE, "incident_watch");
    case "incident_active":              return incidentEngineCall(db, args, STATE, "incident_active");
    case "incident_history":             return incidentEngineCall(db, args, STATE, "incident_history");
    case "incident_classify":            return incidentEngineCall(db, args, STATE, "incident_classify");
    case "incident_recover":             return incidentEngineCall(db, args, STATE, "incident_recover");
    // === 2026-08-31 RESEARCH FRONTIER ORGAN (D) ===
    case "research_filter":              return researchFrontierCall(db, args, STATE, "research_filter");
    case "research_invoke":              return researchFrontierCall(db, args, STATE, "research_invoke");
    case "research_findings":            return researchFrontierCall(db, args, STATE, "research_findings");
    case "research_pending":             return researchFrontierCall(db, args, STATE, "research_pending");
    case "research_get":                 return researchFrontierCall(db, args, STATE, "research_get");
    // === 2026-08-31 OPPORTUNITY ENGINE ORGAN (C) ===
    case "opportunity_scan":             return opportunityEngineCall(db, args, STATE, "opportunity_scan");
    case "opportunity_list":             return opportunityEngineCall(db, args, STATE, "opportunity_list");
    case "opportunity_get":              return opportunityEngineCall(db, args, STATE, "opportunity_get");
    case "opportunity_approve":          return opportunityEngineCall(db, args, STATE, "opportunity_approve");
    case "opportunity_reject":           return opportunityEngineCall(db, args, STATE, "opportunity_reject");
    // === 2026-08-31 PROACTIVE ENGINE ORGAN (C.5) ===
    case "proactive_predict":            return proactiveEngineCall(db, args, STATE, "proactive_predict");
    case "proactive_list_predictions":   return proactiveEngineCall(db, args, STATE, "proactive_list_predictions");
    case "proactive_list_reminders":     return proactiveEngineCall(db, args, STATE, "proactive_list_reminders");
    case "proactive_dismiss_reminder":   return proactiveEngineCall(db, args, STATE, "proactive_dismiss_reminder");
    case "proactive_calibration":        return proactiveEngineCall(db, args, STATE, "proactive_calibration");
    // === 2026-08-31 ECONOMIC CONTROLLER ORGAN (E) ===
    case "economic_snapshot":            return economicControllerCall(db, args, STATE, "economic_snapshot");
    case "economic_budget":              return economicControllerCall(db, args, STATE, "economic_budget");
    case "economic_costs":               return economicControllerCall(db, args, STATE, "economic_costs");
    case "economic_pnl":                 return economicControllerCall(db, args, STATE, "economic_pnl");
    case "economic_attribution":         return economicControllerCall(db, args, STATE, "economic_attribution");
    case "economic_check":               return economicControllerCall(db, args, STATE, "economic_check");
    // === 2026-08-31 INITIATIVE ENGINE ORGAN (F) ===
    case "initiative_compose":            return initiativeEngineCall(db, args, STATE, "initiative_compose");
    case "initiative_list":               return initiativeEngineCall(db, args, STATE, "initiative_list");
    case "initiative_get":                return initiativeEngineCall(db, args, STATE, "initiative_get");
    case "initiative_validate":           return initiativeEngineCall(db, args, STATE, "initiative_validate");
    case "initiative_submit":             return initiativeEngineCall(db, args, STATE, "initiative_submit");
    case "initiative_record_execution":   return initiativeEngineCall(db, args, STATE, "initiative_record_execution");
    // === 2026-08-31 CAPABILITY FORGE ORGAN (F.5) ===
    case "capability_mine":                return capabilityForgeCall(db, args, STATE, "capability_mine");
    case "capability_list_patterns":       return capabilityForgeCall(db, args, STATE, "capability_list_patterns");
    case "capability_generate_template":   return capabilityForgeCall(db, args, STATE, "capability_generate_template");
    case "capability_list_templates":      return capabilityForgeCall(db, args, STATE, "capability_list_templates");
    case "capability_register":            return capabilityForgeCall(db, args, STATE, "capability_register");
    // === 2026-08-31 A2A BOUNDARY ORGAN (G) ===
    case "a2a_send":                       return a2aBoundaryCall(db, args, STATE, "a2a_send");
    case "a2a_list_messages":              return a2aBoundaryCall(db, args, STATE, "a2a_list_messages");
    case "a2a_get_message":                return a2aBoundaryCall(db, args, STATE, "a2a_get_message");
    case "a2a_ack":                        return a2aBoundaryCall(db, args, STATE, "a2a_ack");
    case "a2a_list_routes":                return a2aBoundaryCall(db, args, STATE, "a2a_list_routes");
    case "a2a_check_delivery":             return a2aBoundaryCall(db, args, STATE, "a2a_check_delivery");
    // === 2026-08-31 EXPERIENCE-TO-LEARNING ORGAN (H) ===
    case "experience_compress":            return experienceLearnerCall(db, args, STATE, "experience_compress");
    case "experience_distill":             return experienceLearnerCall(db, args, STATE, "experience_distill");
    case "experience_consolidate":         return experienceLearnerCall(db, args, STATE, "experience_consolidate");
    case "experience_list_memories":       return experienceLearnerCall(db, args, STATE, "experience_list_memories");
    case "experience_get_memory":          return experienceLearnerCall(db, args, STATE, "experience_get_memory");
    case "experience_stats":               return experienceLearnerCall(db, args, STATE, "experience_stats");
    // === 2026-08-31 CONCORDIA INTEGRATION ORGAN (I) ===
    case "concordia_assemble":             return concordiaCall(db, args, STATE, "concordia_assemble");
    case "concordia_verify":               return concordiaCall(db, args, STATE, "concordia_verify");
    case "concordia_demonstrate":          return concordiaCall(db, args, STATE, "concordia_demonstrate");
    case "concordia_list_assemblies":      return concordiaCall(db, args, STATE, "concordia_list_assemblies");
    default:
      return { ok: false, error: "Unknown tool: " + toolName };
  }
}