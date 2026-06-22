import { LruMap, LruSet } from "./lru-map.js";
/**
 * Lens Capability Manifest Registry
 *
 * Every lens declares what it can do via a small JSON manifest.
 * The chat router lazy-loads and caches these to map natural language
 * intent to lens actions without needing to know about every lens at boot.
 *
 * Manifests are auto-generated from existing lens registrations
 * (ALL_LENS_DOMAINS, DOMAIN_ACTION_MANIFEST, LENS_RECOMMENDER_REGISTRY)
 * and can be extended by user-created or emergent-created lenses at runtime.
 *
 * Shape:
 *   {
 *     lensId: string,
 *     domain: string,
 *     actions: string[],
 *     actionTypes: ActionType[],
 *     domainTags: string[],
 *     description: string,
 *     category: string,
 *     source: 'builtin' | 'user' | 'emergent',
 *     registeredAt: string,
 *   }
 */

// ── Action Types (the 8 universal action categories) ─────────────────────

export const ACTION_TYPES = Object.freeze({
  QUERY:    "QUERY",     // "What is X" / "Show me Y" / "Find Z"
  ANALYZE:  "ANALYZE",   // "Compare these" / "Score this" / "What's wrong with"
  CREATE:   "CREATE",    // "Write a policy" / "Make a beat" / "Draft a contract"
  SIMULATE: "SIMULATE",  // "What happens if" / "Run a scenario" / "Test this policy"
  TRADE:    "TRADE",     // "Sell this" / "Buy that" / "List on marketplace"
  CONNECT:  "CONNECT",   // "How does X relate to Y" / "Find connections"
  TEACH:    "TEACH",     // "Explain this to me" / "Help me understand"
  MANAGE:   "MANAGE",    // "Show my stats" / "Check my earnings" / "Update my profile"
});

// ── Action Type Classification ───────────────────────────────────────────

/** Which action types require confirmation before executing */
export const WRITE_ACTION_TYPES = new Set([
  ACTION_TYPES.CREATE,
  ACTION_TYPES.TRADE,
  ACTION_TYPES.MANAGE,
]);

/** Read-only action types that execute immediately */
export const READ_ACTION_TYPES = new Set([
  ACTION_TYPES.QUERY,
  ACTION_TYPES.ANALYZE,
  ACTION_TYPES.CONNECT,
  ACTION_TYPES.TEACH,
]);

// ── Manifest Store ───────────────────────────────────────────────────────

/** lensId → manifest */
const _manifests = new LruMap();

/** domain tag → Set<lensId> (inverted index for fast routing) */
const _tagIndex = new LruMap();

/** action type → Set<lensId> (inverted index) */
const _actionTypeIndex = new LruMap();

let _initialized = false;

// ── Domain → Action Type Mapping ─────────────────────────────────────────
// Maps existing lens actions to the 8 universal action types.

const ACTION_TO_TYPE = Object.freeze({
  // QUERY
  "query": "QUERY", "get": "QUERY", "search": "QUERY", "find": "QUERY",
  "browse": "QUERY", "list": "QUERY", "lookup": "QUERY", "status": "QUERY",
  "info": "QUERY", "stream": "QUERY", "view": "QUERY",

  // ANALYZE
  "analyze": "ANALYZE", "compare": "ANALYZE", "score": "ANALYZE",
  "audit": "ANALYZE", "validate": "ANALYZE", "check": "ANALYZE",
  "detect": "ANALYZE", "evaluate": "ANALYZE", "assess": "ANALYZE",
  "review": "ANALYZE", "inspect": "ANALYZE", "summarize": "ANALYZE",
  "cluster": "ANALYZE", "rank": "ANALYZE", "trace": "ANALYZE",
  "analyze-mix": "ANALYZE", "detect-fallacy": "ANALYZE",
  "check-interactions": "ANALYZE", "detect-contradictions": "ANALYZE",
  "detect-patterns": "ANALYZE", "check-compliance": "ANALYZE",
  "schema-inspect": "ANALYZE", "compare_versions": "ANALYZE",
  "extract_thesis": "ANALYZE", "extract_decisions": "ANALYZE",
  "detect_consensus": "ANALYZE", "generate_insights": "ANALYZE",
  "cluster_topics": "ANALYZE", "rank_posts": "ANALYZE",
  "trace-lineage": "ANALYZE", "score-explain": "ANALYZE",

  // CREATE
  "create": "CREATE", "generate": "CREATE", "draft": "CREATE",
  "write": "CREATE", "compose": "CREATE", "build": "CREATE",
  "forge": "CREATE", "publish": "CREATE", "generate-pattern": "CREATE",
  "suggest-chords": "CREATE", "auto-arrange": "CREATE",
  "generate_summary_dtu": "CREATE",

  // SIMULATE
  "simulate": "SIMULATE", "forecast": "SIMULATE", "predict": "SIMULATE",
  "model": "SIMULATE", "scenario": "SIMULATE", "project": "SIMULATE",
  "test": "SIMULATE",

  // TRADE
  "sell": "TRADE", "buy": "TRADE", "purchase": "TRADE",
  "list-for-sale": "TRADE", "trade": "TRADE", "transfer": "TRADE",

  // CONNECT
  "connect": "CONNECT", "relate": "CONNECT", "link": "CONNECT",
  "map": "CONNECT", "bridge": "CONNECT", "cross-reference": "CONNECT",

  // TEACH
  "teach": "TEACH", "explain": "TEACH", "tutor": "TEACH",
  "learn": "TEACH", "study": "TEACH", "suggest": "TEACH",

  // MANAGE
  "manage": "MANAGE", "configure": "MANAGE", "update": "MANAGE",
  "settings": "MANAGE", "profile": "MANAGE", "export": "MANAGE",
  "import": "MANAGE", "delete": "MANAGE",
});

// ── Domain Tags (pre-computed from lens semantics) ───────────────────────
// Each lens domain gets a set of tags for routing purposes.

const DOMAIN_TAG_MAP = Object.freeze({
  accounting: ["bookkeeping", "invoicing", "tax", "payroll", "finance", "ledger"],
  agriculture: ["farming", "crops", "livestock", "harvest", "soil", "irrigation"],
  agents: ["agent", "automation", "workflow", "bot", "orchestration", "pipeline"],
  art: ["artwork", "gallery", "visual", "illustration", "painting", "drawing"],
  aviation: ["flight", "pilot", "vessel", "charter", "aircraft", "navigation"],
  bio: ["biology", "genetics", "life", "dna", "cell", "organism"],
  board: ["kanban", "tasks", "project", "goals", "calendar", "planning"],
  calendar: ["schedule", "events", "dates", "appointments", "agenda"],
  chat: ["message", "talk", "ai", "conversation", "dialogue"],
  chem: ["chemistry", "molecules", "elements", "reactions", "compounds"],
  code: ["programming", "api", "architecture", "implementation", "debug", "refactor"],
  collab: ["collaborate", "share", "teamwork", "realtime", "co-edit"],
  council: ["governance", "vote", "proposal", "budget", "policy", "decision"],
  creative: ["photography", "video", "design", "production", "media"],
  database: ["sql", "data", "tables", "records", "schema", "query"],
  education: ["school", "student", "course", "teaching", "curriculum", "learning"],
  environment: ["ecology", "wildlife", "conservation", "sustainability", "climate"],
  ethics: ["alignment", "values", "moral", "principles", "fairness"],
  events: ["venue", "festival", "concert", "production", "tickets"],
  finance: ["money", "investment", "portfolio", "budget", "revenue", "cost"],
  fitness: ["training", "workout", "gym", "wellness", "health", "exercise"],
  food: ["restaurant", "recipe", "catering", "kitchen", "nutrition", "cooking"],
  forum: ["discuss", "community", "threads", "posts", "debate"],
  game: ["gaming", "development", "mechanics", "level", "design"],
  government: ["permit", "public", "emergency", "records", "civic", "policy"],
  graph: ["network", "nodes", "edges", "knowledge", "ontology", "taxonomy"],
  healthcare: ["medical", "clinical", "patient", "diagnosis", "treatment"],
  household: ["family", "home", "chores", "maintenance", "domestic"],
  hypothesis: ["test", "experiment", "theory", "prediction", "evidence"],
  insurance: ["policy", "claim", "premium", "coverage", "risk", "underwriting"],
  lab: ["experiment", "sandbox", "explore", "adjacent", "reality"],
  law: ["legal", "contract", "compliance", "license", "rights", "regulation"],
  legal: ["case", "contract", "compliance", "filing", "litigation"],
  literary: ["literature", "text", "book", "poem", "classic", "public-domain", "semantic", "resonance", "provenance"],
  logistics: ["shipping", "fleet", "warehouse", "route", "supply-chain"],
  manufacturing: ["factory", "assembly", "quality", "bom", "production"],
  market: ["trade", "exchange", "dtu", "listing", "browse"],
  marketplace: ["plugins", "extensions", "store", "sell", "buy"],
  math: ["calculation", "algebra", "geometry", "statistics", "calculus"],
  meta: ["about", "info", "system", "meta-information"],
  ml: ["machine-learning", "training", "models", "neural", "inference"],
  music: ["audio", "composition", "sound", "melody", "rhythm", "harmony"],
  neuro: ["brain", "neuroscience", "neural", "cognition", "synaptic"],
  news: ["articles", "headlines", "journalism", "press", "reporting"],
  nonprofit: ["donor", "grant", "volunteer", "charity", "impact"],
  paper: ["research", "academic", "writing", "thesis", "citation"],
  physics: ["simulation", "mechanics", "quantum", "relativity", "energy"],
  quantum: ["qubit", "quantum-computing", "superposition", "entanglement"],
  realestate: ["property", "listing", "tenant", "mortgage", "rental"],
  reasoning: ["logic", "argument", "proof", "inference", "deduction"],
  research: ["search", "find", "explore", "discover", "investigate"],
  retail: ["store", "inventory", "pos", "ecommerce", "merchandise"],
  science: ["expedition", "lab", "sample", "fieldwork", "methodology"],
  security: ["patrol", "incident", "surveillance", "investigation", "threat"],
  services: ["salon", "cleaning", "daycare", "appointment", "booking"],
  sim: ["simulation", "sandbox", "worldmodel", "scenario", "monte-carlo"],
  studio: ["production", "daw", "mix", "master", "recording", "beatmaking"],
  trades: ["construction", "plumbing", "electrical", "contractor", "hvac"],
  vote: ["poll", "election", "ballot", "referendum", "consensus"],
  defense: ["military", "operations", "intelligence", "personnel", "assets", "tactical"],
  space: ["orbit", "satellite", "mission", "launch", "telemetry", "rocket"],
  ocean: ["maritime", "vessel", "marine", "port", "research", "conservation"],
  desert: ["expedition", "climate", "arid", "sand", "oasis", "resource"],
  "urban-planning": ["zoning", "infrastructure", "transit", "development", "permit", "density"],
  telecommunications: ["network", "tower", "spectrum", "fiber", "5G", "bandwidth"],
  mining: ["extraction", "geology", "ore", "mineral", "safety", "drill"],
  forestry: ["timber", "stand", "harvest", "fire", "replanting", "conservation"],
  veterinary: ["animal", "patient", "clinic", "vaccination", "surgery", "species"],
  "law-enforcement": ["case", "incident", "officer", "evidence", "patrol", "warrant"],
  "emergency-services": ["dispatch", "fire", "ems", "rescue", "hazmat", "triage"],

  // Phase Z1 — Phase D sidebar lenses.
  courtship: ["romance", "marriage", "children", "bloodline", "affinity", "wedding"],
  fishing: ["fish", "cast", "bait", "catch", "water", "reel"],
  creatures: ["breeding", "crossbreed", "lineage", "fauna", "hybrid", "species"],
  garage: ["vehicle", "horse", "cart", "glider", "mount", "spawn"],
  "reasoning-traces": ["hlr", "trace", "deductive", "inductive", "abductive", "adversarial"],
});

// ── Manifest Operations ──────────────────────────────────────────────────

/**
 * Register or update a lens manifest.
 * Called at boot for builtins, and at runtime for user/emergent lenses.
 */
export function registerManifest(manifest) {
  if (!manifest?.lensId) return { ok: false, error: "lensId required" };

  const entry = {
    lensId: manifest.lensId,
    domain: manifest.domain || manifest.lensId,
    actions: manifest.actions || [],
    actionTypes: manifest.actionTypes || deriveActionTypes(manifest.actions),
    domainTags: manifest.domainTags || DOMAIN_TAG_MAP[manifest.lensId] || [],
    description: manifest.description || "",
    category: manifest.category || "specialized",
    source: manifest.source || "builtin",
    registeredAt: manifest.registeredAt || new Date().toISOString(),
    // Phase 6 (ideas #9, #39): optional spatial anchor mapping a lens to
    // a 3D location in Concordia. When set, the lens "lives" in the world
    // — crafting → forge, legal → courthouse, marketplace → bazaar.
    // Walking through Concordia, the player encounters live ambient
    // activity in the place that maps to a lens. Pre-existing lenses
    // without spatialAnchor stay valid.
    //
    // Shape: { worldId, x, y, z, radius, type, label? }
    //   type: 'building' | 'district' | 'landmark' | 'ambient'
    spatialAnchor: manifest.spatialAnchor || null,
  };

  _manifests.set(entry.lensId, entry);

  // Update inverted indexes
  for (const tag of entry.domainTags) {
    if (!_tagIndex.has(tag)) _tagIndex.set(tag, new Set());
    _tagIndex.get(tag).add(entry.lensId);
  }
  for (const at of entry.actionTypes) {
    if (!_actionTypeIndex.has(at)) _actionTypeIndex.set(at, new Set());
    _actionTypeIndex.get(at).add(entry.lensId);
  }

  return { ok: true, lensId: entry.lensId };
}

/**
 * Get a manifest by lens ID.
 */
export function getManifest(lensId) {
  return _manifests.get(lensId) || null;
}

/**
 * Find lenses whose domain tags match the given tags.
 * Returns scored results sorted by match quality.
 */
export function findByTags(tags) {
  if (!tags || tags.length === 0) return [];

  const scores = new Map();
  for (const tag of tags) {
    const lensIds = _tagIndex.get(tag);
    if (!lensIds) continue;
    for (const id of lensIds) {
      scores.set(id, (scores.get(id) || 0) + 1);
    }
  }

  return Array.from(scores.entries())
    .map(([lensId, matchCount]) => ({
      lensId,
      manifest: _manifests.get(lensId),
      matchCount,
      matchRatio: matchCount / tags.length,
    }))
    .sort((a, b) => b.matchRatio - a.matchRatio);
}

/**
 * Find lenses that support a given action type.
 */
export function findByActionType(actionType) {
  const lensIds = _actionTypeIndex.get(actionType);
  if (!lensIds) return [];
  return Array.from(lensIds).map(id => _manifests.get(id)).filter(Boolean);
}

/**
 * Get all registered manifests.
 */
export function getAllManifests() {
  return Array.from(_manifests.values());
}

/**
 * Get registry stats.
 */
export function getManifestStats() {
  const bySource = { builtin: 0, user: 0, emergent: 0 };
  for (const m of _manifests.values()) {
    bySource[m.source] = (bySource[m.source] || 0) + 1;
  }
  return {
    ok: true,
    total: _manifests.size,
    bySource,
    tagCount: _tagIndex.size,
    actionTypeCount: _actionTypeIndex.size,
  };
}

// ── Initialization ───────────────────────────────────────────────────────

/**
 * Derive action types from a list of action names.
 */
function deriveActionTypes(actions) {
  if (!actions || actions.length === 0) return [ACTION_TYPES.QUERY];

  const types = new Set();
  for (const action of actions) {
    const actionKey = action.toLowerCase();
    const mapped = ACTION_TO_TYPE[actionKey];
    if (mapped) types.add(mapped);

    // Partial match for compound action names like "generate-pattern"
    for (const [key, type] of Object.entries(ACTION_TO_TYPE)) {
      if (actionKey.includes(key) || key.includes(actionKey)) {
        types.add(type);
      }
    }
  }

  return types.size > 0 ? Array.from(types) : [ACTION_TYPES.QUERY];
}

/**
 * Bootstrap manifests from ALL_LENS_DOMAINS.
 * Called once during server init.
 *
 * @param {string[]} domains - ALL_LENS_DOMAINS array
 * @param {Object} domainActionManifest - DOMAIN_ACTION_MANIFEST object
 */
export function initializeManifests(domains, domainActionManifest = {}) {
  if (_initialized) return { ok: true, skipped: true };

  let count = 0;
  for (const domain of domains) {
    const domainActions = domainActionManifest[domain] || [];
    const actionNames = domainActions.map(a => a.action || a);
    // Include universal actions
    actionNames.push("analyze", "generate", "suggest");

    registerManifest({
      lensId: domain,
      domain,
      actions: [...new Set(actionNames)],
      domainTags: DOMAIN_TAG_MAP[domain] || [],
      description: `${domain} lens capabilities`,
      category: "builtin",
      source: "builtin",
    });
    count++;
  }

  _initialized = true;
  return { ok: true, registered: count };
}

/**
 * Register a user-created lens manifest at runtime.
 * Immediately available for chat routing.
 */
export function registerUserLens(manifest) {
  return registerManifest({
    ...manifest,
    source: "user",
    registeredAt: new Date().toISOString(),
  });
}

/**
 * Register an emergent-created lens manifest at runtime.
 */
export function registerEmergentLens(manifest) {
  return registerManifest({
    ...manifest,
    source: "emergent",
    registeredAt: new Date().toISOString(),
  });
}

/**
 * Check if a lens is registered.
 */
export function hasManifest(lensId) {
  return _manifests.has(lensId);
}

// ── Exports for testing ──────────────────────────────────────────────────

export { ACTION_TO_TYPE, DOMAIN_TAG_MAP, deriveActionTypes as _deriveActionTypes };
