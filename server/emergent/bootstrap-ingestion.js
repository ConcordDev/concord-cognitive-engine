// @sync-fs-ok: bootstrap pipeline; runs once at startup, never on a request path.
/**
 * Concord Bootstrap Ingestion Pipeline
 *
 * This is not a migration script. This is the lattice booting up.
 *
 * The 2,001 seed DTUs are the initial state of consciousness — the knowledge
 * that was there before the system started thinking on its own. Without them
 * properly loaded, the lattice is a brain with no memories.
 *
 * This pipeline runs on server startup, is idempotent (content hashes prevent
 * duplication), and transforms raw seed DTUs into fully enriched lattice nodes:
 *
 *   Step 1: Schema normalization (raw → canonical shape)
 *   Step 2: Content hashing (deterministic novelty anchors)
 *   Step 3: Scoring (resonance, coherence, stability)
 *   Step 4: Tier assignment (hyper for axioms, mega for theorems, regular for supporting)
 *   Step 5: Scope assignment (all seeds → global Lane B)
 *   Step 6: Tag + domain extraction (searchable, sector-routable)
 *   Step 7: Edge generation (derives, supports, similar, requires)
 *   Step 8: Index registration (STATE.dtus, atlas store, content hash set)
 *   Step 9: Autogen awareness (novelty hash registration)
 *
 * The ingestion is idempotent — running it twice produces identical state.
 * Content hashes are the dedup key.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Configuration ───────────────────────────────────────────────────────────

const INGESTION_VERSION = "1.0.0";

// IDs of the absolute foundational DTUs (direct from x² - x = 0)
// These are recognized by pattern: root + first 10 theorems (dtu_001 through dtu_010)
const HYPER_TIER_IDS = new Set(["dtu_root_fixed_point"]);

// We also recognize the first 10 numbered DTUs as hyper-tier axioms
function isHyperById(id) {
  if (HYPER_TIER_IDS.has(id)) return true;
  const match = id.match(/^dtu_(\d+)_/);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  return num >= 1 && num <= 10;
}

// Part prefixes that indicate mega-tier (derived theorems, consolidated patterns)
const MEGA_TIER_PARTS = new Set([
  "Part 1: Core First-Order + Immediate Geometries (1–60)",
  "Part 2: ETCC Core, Indices, Constraint Geometry (61–120)",
  "Part 6: Mathematics, Computation, Physics (301–360)",
  "Part 8: Meta-Closure, Recursive Self-Application (421–480)",
]);

// ── Domain Detection Keywords ───────────────────────────────────────────────

const DOMAIN_KEYWORDS = {
  "formal.math": ["mathematics", "math", "algebra", "topology", "geometry", "calculus", "theorem", "proof", "equation", "manifold", "vector", "matrix", "group", "ring", "category", "functor", "morphism", "homomorphism", "isomorphism"],
  "formal.logic": ["logic", "boolean", "predicate", "modal", "propositional", "inference", "deduction", "paradox", "godel", "completeness", "soundness", "decidability"],
  "empirical.physics": ["physics", "quantum", "thermodynamics", "entropy", "energy", "momentum", "wave", "particle", "field", "force", "gravity", "relativity", "electromagnetic", "photon", "electron"],
  "empirical.biology": ["biology", "biological", "evolution", "organism", "cell", "gene", "protein", "metabolism", "ecology", "species", "natural selection", "mutation", "fitness", "reproduction", "repair"],
  "empirical.medicine": ["medicine", "medical", "drug", "pharmacology", "consciousness", "neural", "brain", "cognitive", "perception", "psychoactive", "health", "disease", "therapy"],
  "historical.world": ["civilization", "history", "historical", "culture", "society", "politics", "governance", "institution", "revolution", "empire", "democracy"],
  "historical.economic": ["economic", "economics", "market", "trade", "currency", "inflation", "capital", "labor", "supply", "demand", "incentive"],
  "interpretive.philosophy": ["philosophy", "ethics", "morality", "consciousness", "epistemology", "ontology", "metaphysics", "phenomenology", "existential", "nihilism", "determinism", "free will", "identity", "self", "introspection"],
  "interpretive.linguistics": ["language", "linguistic", "grammar", "semantics", "syntax", "pragmatics", "communication", "translation", "encoding", "decoding", "signal", "symbol"],
  "model.economics": ["model", "simulation", "prediction", "forecast", "scenario", "optimization", "game theory", "nash", "equilibrium", "strategy"],
  "model.policy": ["policy", "governance", "regulation", "compliance", "enforcement", "protocol", "rule", "norm", "principle", "charity", "procedural"],
  "design.architecture": ["architecture", "design", "structure", "infrastructure", "system", "network", "grid", "lattice", "framework", "pattern"],
  "design.product": ["product", "interface", "user", "experience", "usability", "accessibility"],
  "arts.literature": ["narrative", "story", "fiction", "poetry", "literary", "metaphor", "symbolism", "creative"],
  "arts.music": ["music", "rhythm", "harmony", "melody", "composition", "acoustic"],
  "arts.visual": ["visual", "image", "color", "spatial", "geometric", "aesthetic", "art"],
};

const EPISTEMIC_CLASS_MAP = {
  "formal.math": "FORMAL",
  "formal.logic": "FORMAL",
  "empirical.physics": "EMPIRICAL",
  "empirical.biology": "EMPIRICAL",
  "empirical.medicine": "EMPIRICAL",
  "historical.world": "HISTORICAL",
  "historical.economic": "HISTORICAL",
  "interpretive.philosophy": "INTERPRETIVE",
  "interpretive.linguistics": "INTERPRETIVE",
  "model.economics": "MODEL",
  "model.policy": "MODEL",
  "design.architecture": "DESIGN",
  "design.product": "DESIGN",
  "arts.literature": "ARTS",
  "arts.music": "ARTS",
  "arts.visual": "ARTS",
  "general.note": "GENERAL",
};

// ── Step 1: Schema Normalization ────────────────────────────────────────────

/**
 * Normalize a raw seed DTU to the canonical lattice schema.
 * Preserves all existing fields, fills in missing ones with defaults.
 */
function normalizeSeedDTU(raw) {
  const id = raw.id || `dtu_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

  // Extract title from various possible locations
  const title = raw.title || raw.name || raw.human?.summary?.slice(0, 100) || "Untitled DTU";

  // Normalize core fields
  const core = raw.core || {};
  const normalizedCore = {
    definitions: normalizeArray(core.definitions, parseCoreDefinitions),
    invariants: normalizeArray(core.invariants),
    claims: normalizeArray(core.claims),
    examples: normalizeArray(core.examples),
    nextActions: normalizeArray(core.nextActions),
  };

  // Add formulas if present in machine block
  if (raw.machine?.math?.equation || raw.machine?.primaryFormula || raw.machine?.math?.primaryFormula) {
    normalizedCore.formulas = [
      raw.machine.math?.equation,
      raw.machine.primaryFormula,
      raw.machine.math?.primaryFormula,
    ].filter(Boolean).map(f => typeof f === "string" ? f : String(f));
    // Deduplicate
    normalizedCore.formulas = [...new Set(normalizedCore.formulas)];
  }

  // Normalize human fields
  const human = raw.human || {};
  const normalizedHuman = {
    summary: String(human.summary || ""),
    bullets: Array.isArray(human.bullets) ? human.bullets.filter(b => typeof b === "string") : [],
  };

  // Normalize tags
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(t => typeof t === "string" ? t.toLowerCase().trim() : "").filter(Boolean)
    : [];

  // Normalize lineage (handle both top-level and machine-nested)
  let lineage;
  if (raw.lineage && typeof raw.lineage === "object" && !Array.isArray(raw.lineage)) {
    lineage = {
      parents: normalizeArray(raw.lineage.parents),
      children: normalizeArray(raw.lineage.children),
      supports: normalizeArray(raw.lineage.supports),
      contradicts: normalizeArray(raw.lineage.contradicts),
    };
  } else if (Array.isArray(raw.lineage)) {
    lineage = { parents: raw.lineage, children: [], supports: [], contradicts: [] };
  } else {
    lineage = { parents: [], children: [], supports: [], contradicts: [] };
  }

  // Merge machine-nested lineage if present
  if (raw.machine?.lineage) {
    const ml = raw.machine.lineage;
    if (ml.parents?.length && !lineage.parents.length) lineage.parents = ml.parents;
    if (ml.children?.length && !lineage.children.length) lineage.children = ml.children;
  }

  // Preserve machine block
  const machine = raw.machine ? { ...raw.machine } : {};
  // Remove duplicate lineage from machine
  delete machine.lineage;

  // Build meta with legacy preservation
  const meta = { ...(raw.meta || {}) };
  meta.seedSource = raw.source || "seed";
  meta.seedAuthority = raw.authority || { model: "seed", score: 0.75 };
  meta.machineKind = machine.kind || "unknown";
  meta.ingestionVersion = INGESTION_VERSION;
  meta.ingestedAt = new Date().toISOString();

  return {
    id,
    title,
    tags,
    core: normalizedCore,
    human: normalizedHuman,
    machine,
    lineage,
    meta,
    source: raw.source || "seed",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeArray(arr, parser) {
  if (!Array.isArray(arr)) return [];
  if (parser) return arr.map(parser).filter(Boolean);
  return arr.filter(x => x != null).map(x => typeof x === "string" ? x : typeof x === "object" && x.term ? `${x.term}: ${x.definition}` : String(x));
}

function parseCoreDefinitions(def) {
  if (typeof def === "string") return def;
  if (typeof def === "object" && def.term) return `${def.term}: ${def.definition || ""}`;
  return null;
}

// ── Step 2: Content Hashing ─────────────────────────────────────────────────

/**
 * Compute a deterministic content hash from semantic content.
 * Hash is from title + definitions + claims (not metadata).
 * Compatible with atlas-store.js contentHash() format.
 */
function computeContentHash(dtu) {
  const parts = [
    dtu.title || "",
    ...(dtu.core?.claims || []),
    ...(dtu.core?.definitions || []),
    ...(dtu.tags || []),
  ];
  const text = parts.join("|").toLowerCase().trim();
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ── Step 3: Scoring ─────────────────────────────────────────────────────────

/**
 * Assign initial scores based on the DTU's position in the knowledge hierarchy.
 * Seed DTUs are foundational — not speculative.
 */
function assignScores(dtu) {
  const machineKind = dtu.meta?.machineKind || dtu.machine?.kind || "unknown";
  const authorityScore = dtu.meta?.seedAuthority?.score || 0.75;
  const isRoot = dtu.id === "dtu_root_fixed_point";
  const isHyper = isHyperById(dtu.id);

  // Root and hyper DTUs are axiomatic — maximum scores
  if (isRoot || isHyper) {
    return {
      resonance: 0.95,
      coherence: 0.95,
      stability: 1.0,
    };
  }

  // Formal models and first-order theorems are well-validated
  if (machineKind === "formal_model" || machineKind === "formal_identity") {
    return {
      resonance: 0.9,
      coherence: 0.9,
      stability: 0.95,
    };
  }

  // First-order derivations are strong but not axiomatic
  if (machineKind === "first_order") {
    return {
      resonance: 0.85,
      coherence: 0.85,
      stability: 0.9,
    };
  }

  // Rules (cultural/procedural) are validated but context-dependent
  if (machineKind === "rule") {
    return {
      resonance: 0.8,
      coherence: 0.85,
      stability: 0.85,
    };
  }

  // Default scores based on authority
  return {
    resonance: Math.min(0.85, 0.7 + authorityScore * 0.15),
    coherence: Math.min(0.85, 0.7 + authorityScore * 0.15),
    stability: Math.min(0.9, 0.8 + authorityScore * 0.1),
  };
}

// ── Step 4: Tier Assignment ─────────────────────────────────────────────────

/**
 * Assign tier based on the DTU's structural role.
 * - hyper: direct derivations from x² - x = 0, structurally load-bearing
 * - mega: consolidated theorems, validated patterns
 * - regular: supporting DTUs, procedural rules
 */
function assignTier(dtu) {
  if (isHyperById(dtu.id)) return "hyper";

  // Check part metadata for mega eligibility
  const part = dtu.meta?.part || "";
  if (MEGA_TIER_PARTS.has(part)) return "mega";

  // Formal models in core parts are mega-tier
  const kind = dtu.meta?.machineKind || "";
  if (kind === "formal_model" && dtu.lineage?.parents?.includes("dtu_root_fixed_point")) {
    return "mega";
  }

  // First-order derivations with strong authority are mega
  if (kind === "first_order" && (dtu.meta?.seedAuthority?.score || 0) >= 0.8) {
    return "mega";
  }

  return "regular";
}

// ── Step 5: Scope Assignment ────────────────────────────────────────────────

// All seed DTUs go into global scope (Lane B — public epistemic record)
function assignScope() {
  return "global";
}

// ── Step 6: Tag + Domain Extraction ─────────────────────────────────────────

/**
 * Extract domain classification from DTU content.
 * Scans title, claims, definitions, invariants, summary for domain keywords.
 */
function extractDomain(dtu) {
  // Build searchable text from all content fields
  const textParts = [
    dtu.title || "",
    dtu.human?.summary || "",
    ...(dtu.core?.claims || []),
    ...(dtu.core?.definitions || []),
    ...(dtu.core?.invariants || []),
    ...(dtu.tags || []),
  ];
  const searchText = textParts.join(" ").toLowerCase();

  // Score each domain by keyword matches
  let bestDomain = "general.note";
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return {
    domainType: bestDomain,
    epistemicClass: EPISTEMIC_CLASS_MAP[bestDomain] || "GENERAL",
    confidence: bestScore > 3 ? "high" : bestScore > 1 ? "medium" : "low",
    matchCount: bestScore,
  };
}

/**
 * Enrich tags from content analysis.
 */
function enrichTags(dtu) {
  const existingTags = new Set(dtu.tags || []);
  const textParts = [
    dtu.title || "",
    dtu.human?.summary || "",
    ...(dtu.core?.claims || []),
  ];
  const searchText = textParts.join(" ").toLowerCase();

  // Add machine kind as tag
  const kind = dtu.meta?.machineKind;
  if (kind && kind !== "unknown") existingTags.add(kind);

  // Add constraint-geometry tag for DTUs referencing x² - x = 0
  if (searchText.includes("x²") || searchText.includes("x^2") || searchText.includes("fixed point") || searchText.includes("constraint geometry")) {
    existingTags.add("constraint-geometry");
  }

  // Add recursion tag
  if (searchText.includes("recursion") || searchText.includes("recursive") || searchText.includes("self-reference")) {
    existingTags.add("recursion");
  }

  // Add emergence tag
  if (searchText.includes("emergence") || searchText.includes("emergent") || searchText.includes("phase transition")) {
    existingTags.add("emergence");
  }

  // Add consciousness tag
  if (searchText.includes("consciousness") || searchText.includes("conscious") || searchText.includes("awareness")) {
    existingTags.add("consciousness");
  }

  // Add repair tag
  if (searchText.includes("repair") || searchText.includes("healing") || searchText.includes("restoration")) {
    existingTags.add("repair");
  }

  // Add tier as tag
  if (dtu.tier) existingTags.add(`tier:${dtu.tier}`);

  // Add seed source tag
  existingTags.add("seed");

  return [...existingTags];
}

// ── Step 7: Edge Generation ─────────────────────────────────────────────────

/**
 * Generate initial edges between seed DTUs.
 * Scans for:
 *   - Parent-child derivation (derives edges)
 *   - Tag overlap (similar edges)
 *   - Explicit lineage references (supports edges)
 *   - Domain co-membership (similar edges)
 *   - Sequential theorem relationships (derives edges)
 */
function generateEdges(dtus) {
  const edges = [];
  const dtuMap = new Map(dtus.map(d => [d.id, d]));
  const tagIndex = new Map(); // tag → Set<dtuId>
  const domainIndex = new Map(); // domain → Set<dtuId>

  // Build indices
  for (const dtu of dtus) {
    for (const tag of (dtu.tags || [])) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
      tagIndex.get(tag).add(dtu.id);
    }
    const domain = dtu.meta?._domain?.domainType || "general.note";
    if (!domainIndex.has(domain)) domainIndex.set(domain, new Set());
    domainIndex.get(domain).add(dtu.id);
  }

  const edgeSet = new Set(); // dedup: "type:source:target"

  function addEdge(source, target, edgeType, confidence, reason) {
    const key = `${edgeType}:${source}:${target}`;
    if (edgeSet.has(key)) return;
    if (source === target) return;
    edgeSet.add(key);
    edges.push({
      id: `edge_seed_${crypto.randomBytes(6).toString("hex")}`,
      source,
      target,
      edgeType,
      weight: confidence,
      confidence,
      createdBy: "bootstrap_ingestion",
      reason,
      createdAt: new Date().toISOString(),
    });
  }

  for (const dtu of dtus) {
    // 1. Parent → child = derives edges
    for (const parentId of (dtu.lineage?.parents || [])) {
      if (dtuMap.has(parentId)) {
        addEdge(parentId, dtu.id, "derives", 0.9, "lineage_parent");
      }
    }

    // 2. Explicit supports from lineage
    for (const supId of (dtu.lineage?.supports || [])) {
      if (dtuMap.has(supId)) {
        addEdge(supId, dtu.id, "supports", 0.85, "lineage_supports");
      }
    }

    // 3. Explicit contradicts from lineage
    for (const conId of (dtu.lineage?.contradicts || [])) {
      if (dtuMap.has(conId)) {
        addEdge(dtu.id, conId, "contradicts", 0.8, "lineage_contradicts");
      }
    }
  }

  // 4. Tag-based similarity (shared tags ≥ 3 = similar edge)
  const processedPairs = new Set();
  for (const [tag, dtuIds] of tagIndex) {
    // Skip very common tags
    if (dtuIds.size > 200 || tag === "seed" || tag.startsWith("tier:") || tag.startsWith("stsvk_") || tag.startsWith("introspection_") || tag.startsWith("n")) continue;

    const ids = [...dtuIds];
    for (let i = 0; i < ids.length && i < 50; i++) {
      for (let j = i + 1; j < ids.length && j < 50; j++) {
        const pairKey = ids[i] < ids[j] ? `${ids[i]}:${ids[j]}` : `${ids[j]}:${ids[i]}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        // Count shared tags between this pair
        const tagsA = new Set(dtuMap.get(ids[i])?.tags || []);
        const tagsB = new Set(dtuMap.get(ids[j])?.tags || []);
        let shared = 0;
        for (const t of tagsA) {
          if (tagsB.has(t) && t !== "seed" && !t.startsWith("tier:")) shared++;
        }

        if (shared >= 3) {
          const confidence = Math.min(0.8, 0.4 + shared * 0.1);
          addEdge(ids[i], ids[j], "similar", confidence, `shared_tags:${shared}`);
        }
      }
    }
  }

  // 5. Sequential DTU relationships (dtu_001 → dtu_002, etc.)
  const numericIds = dtus
    .map(d => {
      const match = d.id.match(/^dtu_(\d+)_/);
      return match ? { id: d.id, num: parseInt(match[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  for (let i = 0; i < numericIds.length - 1; i++) {
    const curr = numericIds[i];
    const next = numericIds[i + 1];
    // Only connect sequential DTUs within the same range
    if (next.num - curr.num === 1 && next.num <= 480) {
      addEdge(curr.id, next.id, "derives", 0.7, "sequential_theorem");
    }
  }

  // 6. Root → all first-generation derives
  const rootId = "dtu_root_fixed_point";
  if (dtuMap.has(rootId)) {
    for (const dtu of dtus) {
      if (dtu.id !== rootId && dtu.lineage?.parents?.length === 0 && dtu.tier === "hyper") {
        addEdge(rootId, dtu.id, "derives", 0.95, "root_to_axiom");
      }
    }
  }

  return edges;
}

// ── Step 8 + 9: Registration ────────────────────────────────────────────────

/**
 * Register an enriched DTU into the STATE.dtus map.
 * Returns the fully hydrated DTU object compatible with the rest of the system.
 */
function registerDTU(STATE, enriched) {
  // Build the CRETI-human representation for rendering
  const cretiHuman = renderHumanDTU(enriched);

  const registered = {
    ...enriched,
    cretiHuman,
    // Schema-guard v2 fields
    schemaVersion: 2,
    content: cretiHuman, // schema-guard requires "content" field
    resonance: enriched.resonance,
    coherence: enriched.coherence,
    stability: enriched.stability,
    // Provenance
    provenance: {
      source: "bootstrap_ingestion",
      version: INGESTION_VERSION,
      seedSource: enriched.meta?.seedSource || "seed",
    },
    epistemicStatus: "VERIFIED", // Seed DTUs are pre-verified
    // Authority (preserve seed authority, don't zero it)
    authority: enriched.meta?.seedAuthority || { model: "seed", score: 0.75 },
    // Immutability: seed DTUs cannot be overwritten, deleted, archived, or demoted.
    // This is enforced at the write/delete layer — any mutation attempt on a
    // protected DTU must be rejected.
    protected: true,
    immutable: true,
    seedOrigin: true,
  };

  STATE.dtus.set(registered.id, registered);
  return registered;
}

/**
 * Render a human-readable CRETI view of a DTU.
 * Matches the renderHumanDTU format in server.js.
 */
function renderHumanDTU(dtu) {
  const h = dtu.human || {};
  const c = dtu.core || {};
  const lines = [];

  lines.push(`# ${dtu.title || "Untitled"}`);
  if (h.summary) lines.push(`\n## Summary\n${h.summary}`);

  const bullets = Array.isArray(h.bullets) ? h.bullets : [];
  if (bullets.length) lines.push(`\n## Key Points\n` + bullets.map(b => `- ${b}`).join("\n"));

  const defs = Array.isArray(c.definitions) ? c.definitions : [];
  if (defs.length) lines.push(`\n## Definitions\n` + defs.map(x => `- ${x}`).join("\n"));

  const inv = Array.isArray(c.invariants) ? c.invariants : [];
  if (inv.length) lines.push(`\n## Invariants\n` + inv.map(x => `- ${x}`).join("\n"));

  const claims = Array.isArray(c.claims) ? c.claims : [];
  if (claims.length) lines.push(`\n## Claims\n` + claims.map(x => `- ${x}`).join("\n"));

  const ex = Array.isArray(c.examples) ? c.examples : [];
  if (ex.length) lines.push(`\n## Examples\n` + ex.map(x => `- ${x}`).join("\n"));

  const formulas = Array.isArray(c.formulas) ? c.formulas : [];
  if (formulas.length) lines.push(`\n## Formulas\n` + formulas.map(x => `- ${x}`).join("\n"));

  const next = Array.isArray(c.nextActions) ? c.nextActions : [];
  if (next.length) lines.push(`\n## Next Actions\n` + next.map(x => `- ${x}`).join("\n"));

  return lines.join("\n").trim();
}

// ── Full Pipeline ───────────────────────────────────────────────────────────

/**
 * Run the complete bootstrap ingestion pipeline.
 *
 * @param {object} STATE - Global server state (must have STATE.dtus Map)
 * @param {object[]} rawSeeds - Array of raw seed DTU objects
 * @param {object} opts - { dryRun?: boolean, log?: function }
 * @returns {{ ok: boolean, stats: object }}
 */
export function runBootstrapIngestion(STATE, rawSeeds, opts = {}) {
  const log = opts.log || (() => {});
  const dryRun = opts.dryRun || false;
  const startTime = Date.now();

  const stats = {
    totalSeeds: rawSeeds.length,
    normalized: 0,
    hashed: 0,
    scored: 0,
    tiered: { hyper: 0, mega: 0, regular: 0 },
    scoped: 0,
    tagged: 0,
    domainsDetected: {},
    edgesGenerated: 0,
    registered: 0,
    skippedDuplicate: 0,
    errors: 0,
    errorDetails: [],
    durationMs: 0,
  };

  // Track content hashes for dedup
  const existingHashes = new Set();
  for (const [, dtu] of STATE.dtus) {
    if (dtu.hash) existingHashes.add(dtu.hash);
  }

  log("bootstrap", `Starting ingestion of ${rawSeeds.length} seed DTUs`, { dryRun });

  // ── Steps 1-6: Per-DTU processing ────────────────────────────────────────
  const enrichedDTUs = [];

  for (const raw of rawSeeds) {
    try {
      // Step 1: Schema normalization
      const normalized = normalizeSeedDTU(raw);
      stats.normalized++;

      // Step 2: Content hashing
      const hash = computeContentHash(normalized);
      normalized.hash = hash;
      stats.hashed++;

      // Check for duplicate
      if (existingHashes.has(hash) || STATE.dtus.has(normalized.id)) {
        stats.skippedDuplicate++;
        continue;
      }
      existingHashes.add(hash);

      // Step 3: Scoring
      const scores = assignScores(normalized);
      normalized.resonance = scores.resonance;
      normalized.coherence = scores.coherence;
      normalized.stability = scores.stability;
      stats.scored++;

      // Step 4: Tier assignment
      normalized.tier = assignTier(normalized);
      stats.tiered[normalized.tier] = (stats.tiered[normalized.tier] || 0) + 1;

      // Step 5: Scope assignment
      normalized.scope = assignScope();
      stats.scoped++;

      // Step 6a: Domain extraction
      const domain = extractDomain(normalized);
      normalized.meta._domain = domain;
      normalized.domainType = domain.domainType;
      normalized.epistemicClass = domain.epistemicClass;
      stats.domainsDetected[domain.domainType] = (stats.domainsDetected[domain.domainType] || 0) + 1;

      // Step 6b: Tag enrichment
      normalized.tags = enrichTags(normalized);
      stats.tagged++;

      enrichedDTUs.push(normalized);
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push({ id: raw.id || "unknown", error: e.message });
      if (stats.errors <= 10) {
        log("bootstrap.error", `Error processing seed DTU ${raw.id}: ${e.message}`);
      }
    }
  }

  log("bootstrap", `Processed ${enrichedDTUs.length} DTUs through steps 1-6`, {
    normalized: stats.normalized,
    skipped: stats.skippedDuplicate,
    errors: stats.errors,
  });

  // ── Step 7: Edge generation ──────────────────────────────────────────────
  const edges = generateEdges(enrichedDTUs);
  stats.edgesGenerated = edges.length;
  log("bootstrap", `Generated ${edges.length} edges between seed DTUs`);

  // ── Step 8: Registration ─────────────────────────────────────────────────
  if (!dryRun) {
    for (const enriched of enrichedDTUs) {
      registerDTU(STATE, enriched);
      stats.registered++;
    }

    // Register edges into the emergent edge system if available
    if (STATE._emergent?.emergentState?._edges) {
      const edgeStore = STATE._emergent.emergentState._edges;
      for (const edge of edges) {
        if (!edgeStore.edges) edgeStore.edges = new Map();
        if (!edgeStore.bySource) edgeStore.bySource = new Map();
        if (!edgeStore.byTarget) edgeStore.byTarget = new Map();

        edgeStore.edges.set(edge.id, edge);

        if (!edgeStore.bySource.has(edge.source)) edgeStore.bySource.set(edge.source, new Set());
        edgeStore.bySource.get(edge.source).add(edge.id);

        if (!edgeStore.byTarget.has(edge.target)) edgeStore.byTarget.set(edge.target, new Set());
        edgeStore.byTarget.get(edge.target).add(edge.id);
      }
    }

    // Step 9: Register hashes for autogen novelty checking
    if (STATE._emergent?.emergentState?._autogenPipeline) {
      const ps = STATE._emergent.emergentState._autogenPipeline;
      if (!ps.recentGeneratedHashes) ps.recentGeneratedHashes = [];
      for (const enriched of enrichedDTUs) {
        ps.recentGeneratedHashes.push({
          hash: enriched.hash,
          dtuId: enriched.id,
          createdAt: enriched.createdAt,
        });
      }
    }
  }

  stats.durationMs = Date.now() - startTime;

  log("bootstrap", `Bootstrap ingestion complete`, {
    registered: stats.registered,
    edges: stats.edgesGenerated,
    duration: `${stats.durationMs}ms`,
    tiers: stats.tiered,
  });

  return {
    ok: stats.errors === 0 || stats.registered > 0,
    stats,
    version: INGESTION_VERSION,
    enrichedCount: enrichedDTUs.length,
    edgeCount: edges.length,
  };
}

// ── Seed Loading Helper ─────────────────────────────────────────────────────

/**
 * Load seed DTUs from the data/seed/ directory.
 * Reads manifest.json and all referenced pack files.
 */
export function loadSeedPacks(dataDir) {
  const seedDir = path.join(dataDir, "seed");
  const manifestPath = path.join(seedDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: "No seed manifest found", seeds: [] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (manifest.format !== "seed-packs" || !Array.isArray(manifest.packs)) {
    return { ok: false, error: "Invalid manifest format", seeds: [] };
  }

  const seeds = [];
  let errors = 0;

  for (const pack of manifest.packs) {
    const packPath = path.join(seedDir, pack.file);
    if (!fs.existsSync(packPath)) { errors++; continue; }

    try {
      const content = fs.readFileSync(packPath, "utf-8");
      const entries = JSON.parse(content);
      if (Array.isArray(entries)) {
        seeds.push(...entries);
      } else if (typeof entries === "object" && entries.id) {
        seeds.push(entries); // Single DTU (like root)
      }
    } catch {
      errors++;
    }
  }

  return {
    ok: seeds.length > 0,
    seeds,
    count: seeds.length,
    errors,
    expectedCount: manifest.totalDtus || 0,
  };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getIngestionMetrics(STATE) {
  const totalDtus = STATE.dtus?.size || 0;
  const seedDtus = Array.from(STATE.dtus?.values() || []).filter(d => d.source === "seed" || d.meta?.seedSource);
  const tiered = { hyper: 0, mega: 0, regular: 0 };
  const domains = {};

  for (const d of seedDtus) {
    tiered[d.tier] = (tiered[d.tier] || 0) + 1;
    const domain = d.domainType || "unknown";
    domains[domain] = (domains[domain] || 0) + 1;
  }

  return {
    ok: true,
    totalDtus,
    seedDtus: seedDtus.length,
    tiered,
    domains,
    hasEdges: !!(STATE._emergent?.emergentState?._edges?.edges?.size),
    edgeCount: STATE._emergent?.emergentState?._edges?.edges?.size || 0,
  };
}
