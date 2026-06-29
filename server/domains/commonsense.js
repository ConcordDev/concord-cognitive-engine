// server/domains/commonsense.js
// Domain actions for common-sense reasoning: plausibility checking,
// analogy mapping, default reasoning with exceptions, plus real
// ConceptNet knowledge-graph lookups (free, no API key — ~34M
// edges across 304 languages).

import { cachedFetchJson } from "../lib/external-fetch.js";

const CONCEPTNET_BASE = "https://api.conceptnet.io";

// ---------------------------------------------------------------------------
// Per-user persistent fact store. Lives on globalThis._concordSTATE so it
// survives across macro calls (but not server restart — intentional, this is
// a working knowledge base, not the DTU substrate).
// ---------------------------------------------------------------------------

/** Lazily provision the per-domain state container. */
function csState() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.commonsenseLens) {
    STATE.commonsenseLens = {
      facts: new Map(), // userId -> Map<factId, fact>
    };
  }
  return STATE.commonsenseLens;
}

/** Resolve the calling user's id from ctx, defaulting to a shared bucket. */
function userIdOf(ctx) {
  return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
}

/** Per-user Map accessor that auto-creates the bucket. */
function factBucket(uid) {
  const map = csState().facts;
  if (!map.has(uid)) map.set(uid, new Map());
  return map.get(uid);
}

function rid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Canonical relation taxonomy (ConceptNet-aligned), grouped for browsing.
const RELATION_TAXONOMY = [
  {
    group: "Taxonomic",
    description: "Class membership and subtype hierarchy.",
    relations: [
      { id: "is_a", label: "IsA", inverse: "has_subtype", symmetric: false, transitive: true },
      { id: "instance_of", label: "InstanceOf", inverse: null, symmetric: false, transitive: false },
    ],
  },
  {
    group: "Compositional",
    description: "Part-whole and made-of structure.",
    relations: [
      { id: "part_of", label: "PartOf", inverse: "has_part", symmetric: false, transitive: true },
      { id: "made_of", label: "MadeOf", inverse: null, symmetric: false, transitive: false },
      { id: "has_a", label: "HasA", inverse: "part_of", symmetric: false, transitive: false },
    ],
  },
  {
    group: "Functional",
    description: "Purpose, capability, and use.",
    relations: [
      { id: "used_for", label: "UsedFor", inverse: null, symmetric: false, transitive: false },
      { id: "capable_of", label: "CapableOf", inverse: null, symmetric: false, transitive: false },
      { id: "has_property", label: "HasProperty", inverse: null, symmetric: false, transitive: false },
    ],
  },
  {
    group: "Causal",
    description: "Cause, effect, and motivation.",
    relations: [
      { id: "causes", label: "Causes", inverse: "caused_by", symmetric: false, transitive: true },
      { id: "has_prerequisite", label: "HasPrerequisite", inverse: null, symmetric: false, transitive: true },
      { id: "motivated_by", label: "MotivatedByGoal", inverse: null, symmetric: false, transitive: false },
    ],
  },
  {
    group: "Spatial / Lexical",
    description: "Location and word relationships.",
    relations: [
      { id: "located_at", label: "AtLocation", inverse: null, symmetric: false, transitive: false },
      { id: "synonym", label: "Synonym", inverse: "synonym", symmetric: true, transitive: true },
      { id: "antonym", label: "Antonym", inverse: "antonym", symmetric: true, transitive: false },
      { id: "related_to", label: "RelatedTo", inverse: "related_to", symmetric: true, transitive: false },
    ],
  },
];

const RELATION_INDEX = (() => {
  const idx = {};
  for (const g of RELATION_TAXONOMY) {
    for (const r of g.relations) idx[r.id] = { ...r, group: g.group };
  }
  return idx;
})();

// Antonym / mutually-exclusive property pairs for contradiction detection.
const ANTONYM_PAIRS = [
  ["alive", "dead"], ["hot", "cold"], ["big", "small"], ["large", "small"],
  ["fast", "slow"], ["wet", "dry"], ["open", "closed"], ["light", "heavy"],
  ["soft", "hard"], ["happy", "sad"], ["true", "false"], ["empty", "full"],
  ["young", "old"], ["safe", "dangerous"], ["edible", "poisonous"],
  ["animate", "inanimate"], ["solid", "liquid"], ["natural", "artificial"],
];

function normTok(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export default function registerCommonsenseActions(registerLensAction) {
  /**
   * plausibilityCheck
   * Score statement plausibility using constraint satisfaction.
   * Check temporal ordering, spatial consistency, and causal chains.
   * artifact.data.statement = { text, entities?: [], events?: [{ action, time?, location? }] }
   * artifact.data.constraints = [{ type: "temporal"|"spatial"|"causal"|"physical"|"social", rule, entities? }]
   */
  registerLensAction("commonsense", "plausibilityCheck", (ctx, artifact, _params) => {
  try {
    const statement = artifact.data?.statement || {};
    const constraints = artifact.data?.constraints || [];
    const events = statement.events || [];
    const text = (statement.text || "").toLowerCase();

    const violations = [];
    let satisfiedCount = 0;

    // Built-in temporal ordering checks
    if (events.length >= 2) {
      for (let i = 0; i < events.length - 1; i++) {
        const a = events[i];
        const b = events[i + 1];
        if (a.time && b.time) {
          const tA = new Date(a.time).getTime();
          const tB = new Date(b.time).getTime();
          if (!isNaN(tA) && !isNaN(tB) && tA > tB) {
            violations.push({
              type: "temporal",
              description: `Event "${a.action}" (${a.time}) occurs after "${b.action}" (${b.time}) but is listed first`,
              severity: "high",
            });
          } else {
            satisfiedCount++;
          }
        }
      }
    }

    // Built-in spatial consistency checks
    const locations = events.filter(e => e.location).map(e => ({ action: e.action, location: e.location, time: e.time }));
    if (locations.length >= 2) {
      for (let i = 0; i < locations.length - 1; i++) {
        const a = locations[i];
        const b = locations[i + 1];
        if (a.location !== b.location && a.time && b.time) {
          const tA = new Date(a.time).getTime();
          const tB = new Date(b.time).getTime();
          const gapMinutes = (tB - tA) / 60000;
          // Implausible if location changes with zero or negative time
          if (!isNaN(gapMinutes) && gapMinutes <= 0) {
            violations.push({
              type: "spatial",
              description: `Location changes from "${a.location}" to "${b.location}" with no elapsed time`,
              severity: "high",
            });
          } else if (!isNaN(gapMinutes) && gapMinutes < 5) {
            violations.push({
              type: "spatial",
              description: `Location changes from "${a.location}" to "${b.location}" in only ${Math.round(gapMinutes)} minutes`,
              severity: "medium",
            });
          } else {
            satisfiedCount++;
          }
        }
      }
    }

    // Built-in causal chain checks
    const causalPatterns = [
      { cause: /\b(dead|died|killed)\b/, effect: /\b(spoke|said|walked|ran|ate|drove)\b/, rule: "Dead entities cannot perform actions" },
      { cause: /\b(destroyed|broken|shattered)\b/, effect: /\b(used|operated|drove|opened)\b/, rule: "Destroyed objects cannot be used" },
      { cause: /\b(asleep|unconscious|comatose)\b/, effect: /\b(decided|chose|calculated|spoke)\b/, rule: "Unconscious entities cannot make conscious decisions" },
      { cause: /\b(frozen|solid)\b/, effect: /\b(poured|flowed|drank)\b/, rule: "Frozen liquids cannot flow" },
      { cause: /\b(locked|sealed)\b/, effect: /\b(entered|walked in|opened)\b/, rule: "Locked barriers cannot be freely passed" },
    ];

    for (const pattern of causalPatterns) {
      if (pattern.cause.test(text) && pattern.effect.test(text)) {
        violations.push({
          type: "causal",
          description: pattern.rule,
          severity: "high",
        });
      }
    }

    // Physical plausibility checks
    const physicalPatterns = [
      { pattern: /\b(lifted|carried)\b.*\b(\d{4,})\s*(kg|kilogram|ton)/i, rule: "Humans cannot lift extremely heavy objects" },
      { pattern: /\b(ran|walked)\b.*\b(\d{4,})\s*(km|mile)/i, rule: "Implausible distance for human locomotion" },
      { pattern: /\b(underwater|submerged)\b.*\b(breathed|breathing)\b/i, rule: "Humans cannot breathe underwater" },
    ];

    for (const check of physicalPatterns) {
      if (check.pattern.test(text)) {
        violations.push({ type: "physical", description: check.rule, severity: "medium" });
      }
    }

    // Evaluate user-supplied constraints
    for (const constraint of constraints) {
      const entities = constraint.entities || [];
      const rule = (constraint.rule || "").toLowerCase();
      const type = constraint.type || "general";

      // Simple constraint evaluation: check if the text contradicts the rule
      const negationWords = ["not", "never", "cannot", "impossible", "no"];
      const ruleTokens = rule.split(/\s+/).filter(w => w.length > 2);
      const textTokens = new Set(text.split(/\s+/));

      let ruleMatchCount = 0;
      let hasNegation = false;
      for (const t of ruleTokens) {
        if (textTokens.has(t)) ruleMatchCount++;
        if (negationWords.includes(t)) hasNegation = true;
      }

      const ruleRelevance = ruleTokens.length > 0 ? ruleMatchCount / ruleTokens.length : 0;

      if (ruleRelevance > 0.3) {
        // Rule is relevant to the text
        if (hasNegation) {
          // Constraint says something should NOT happen
          const positiveTokens = ruleTokens.filter(t => !negationWords.includes(t));
          const allPresent = positiveTokens.every(t => textTokens.has(t));
          if (allPresent) {
            violations.push({ type, description: `Constraint violated: "${constraint.rule}"`, severity: "medium", entities });
          } else {
            satisfiedCount++;
          }
        } else {
          satisfiedCount++;
        }
      }
    }

    // Compute plausibility score
    const totalChecks = satisfiedCount + violations.length;
    const plausibilityScore = totalChecks > 0
      ? Math.round((satisfiedCount / totalChecks) * 100)
      : (violations.length === 0 ? 80 : 50); // default moderate if no checks apply

    // Severity-adjusted score
    const highViolations = violations.filter(v => v.severity === "high").length;
    const adjustedScore = Math.max(0, plausibilityScore - highViolations * 15);

    return {
      ok: true,
      result: {
        plausibilityScore: adjustedScore,
        plausibilityLabel: adjustedScore >= 80 ? "highly plausible" : adjustedScore >= 50 ? "somewhat plausible" : adjustedScore >= 25 ? "questionable" : "implausible",
        violations: { count: violations.length, items: violations },
        constraintsSatisfied: satisfiedCount,
        totalChecksPerformed: totalChecks,
        eventsAnalyzed: events.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * analogyMapping
   * Map analogies between domains using structural alignment theory.
   * Compute systematicity score and identify candidate inferences.
   * artifact.data.source = { domain, entities: [{ name, type }], relations: [{ type, from, to, properties?: {} }] }
   * artifact.data.target = { domain, entities: [{ name, type }], relations: [{ type, from, to, properties?: {} }] }
   */
  registerLensAction("commonsense", "analogyMapping", (ctx, artifact, _params) => {
  try {
    const source = artifact.data?.source || {};
    const target = artifact.data?.target || {};
    const srcEntities = source.entities || [];
    const tgtEntities = target.entities || [];
    const srcRelations = source.relations || [];
    const tgtRelations = target.relations || [];

    if (srcEntities.length === 0 || tgtEntities.length === 0) {
      return { ok: true, result: { message: "Both source and target must have entities." } };
    }

    // Step 1: Compute entity type similarity matrix
    function typeSimilarity(typeA, typeB) {
      if (typeA === typeB) return 1.0;
      const a = (typeA || "").toLowerCase();
      const b = (typeB || "").toLowerCase();
      if (a === b) return 1.0;
      // Simple semantic type similarity
      const categories = {
        agent: ["person", "human", "agent", "actor", "entity", "organism", "animal"],
        object: ["object", "thing", "item", "tool", "instrument", "device"],
        location: ["place", "location", "area", "region", "space", "room"],
        event: ["event", "action", "process", "activity", "occurrence"],
        property: ["property", "attribute", "quality", "feature", "trait"],
        quantity: ["number", "amount", "quantity", "value", "measure"],
      };
      for (const group of Object.values(categories)) {
        if (group.includes(a) && group.includes(b)) return 0.7;
      }
      // Character-level Jaccard for partial matches
      const setA = new Set(a.split(""));
      const setB = new Set(b.split(""));
      let intersection = 0;
      for (const c of setA) if (setB.has(c)) intersection++;
      const union = new Set([...setA, ...setB]).size;
      return union > 0 ? intersection / union * 0.3 : 0;
    }

    // Step 2: Find best entity mapping using greedy assignment
    const simMatrix = [];
    for (let i = 0; i < srcEntities.length; i++) {
      simMatrix[i] = [];
      for (let j = 0; j < tgtEntities.length; j++) {
        simMatrix[i][j] = typeSimilarity(srcEntities[i].type, tgtEntities[j].type);
      }
    }

    // Greedy 1-to-1 mapping
    const entityMapping = [];
    const usedSrc = new Set();
    const usedTgt = new Set();
    const pairs = [];
    for (let i = 0; i < srcEntities.length; i++) {
      for (let j = 0; j < tgtEntities.length; j++) {
        pairs.push({ src: i, tgt: j, score: simMatrix[i][j] });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    for (const p of pairs) {
      if (usedSrc.has(p.src) || usedTgt.has(p.tgt)) continue;
      entityMapping.push({
        source: srcEntities[p.src].name,
        target: tgtEntities[p.tgt].name,
        similarity: Math.round(p.score * 1000) / 1000,
      });
      usedSrc.add(p.src);
      usedTgt.add(p.tgt);
    }

    // Build a quick name-to-name mapping
    const nameMap = {};
    for (const m of entityMapping) {
      nameMap[m.source] = m.target;
    }

    // Step 3: Relation mapping - find structurally aligned relations
    const relationMappings = [];
    const usedTgtRels = new Set();
    for (const sr of srcRelations) {
      const mappedFrom = nameMap[sr.from];
      const mappedTo = nameMap[sr.to];
      if (!mappedFrom || !mappedTo) continue;

      // Find matching target relation
      let bestMatch = null;
      let bestScore = 0;
      for (let j = 0; j < tgtRelations.length; j++) {
        if (usedTgtRels.has(j)) continue;
        const tr = tgtRelations[j];
        let score = 0;
        // Check if endpoints match the mapping
        if (tr.from === mappedFrom && tr.to === mappedTo) score += 0.5;
        else if (tr.from === mappedFrom || tr.to === mappedTo) score += 0.25;
        // Relation type similarity
        if (sr.type === tr.type) score += 0.5;
        else if (sr.type && tr.type) {
          const stA = new Set(sr.type.toLowerCase().split(""));
          const stB = new Set(tr.type.toLowerCase().split(""));
          let inter = 0;
          for (const c of stA) if (stB.has(c)) inter++;
          score += (inter / new Set([...stA, ...stB]).size) * 0.3;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { index: j, relation: tr };
        }
      }

      if (bestMatch && bestScore > 0.2) {
        usedTgtRels.add(bestMatch.index);
        relationMappings.push({
          sourceRelation: { type: sr.type, from: sr.from, to: sr.to },
          targetRelation: { type: bestMatch.relation.type, from: bestMatch.relation.from, to: bestMatch.relation.to },
          alignmentScore: Math.round(bestScore * 1000) / 1000,
        });
      }
    }

    // Step 4: Compute systematicity score
    // Systematicity favors systems of interconnected relations over isolated matches
    const mappedRelCount = relationMappings.length;
    const totalPossibleRels = Math.max(srcRelations.length, tgtRelations.length, 1);
    const relCoverage = mappedRelCount / totalPossibleRels;

    // Higher-order structure: count chains of related mappings
    let chainCount = 0;
    for (const rm of relationMappings) {
      const endpoints = [rm.sourceRelation.from, rm.sourceRelation.to];
      for (const other of relationMappings) {
        if (rm === other) continue;
        if (endpoints.includes(other.sourceRelation.from) || endpoints.includes(other.sourceRelation.to)) {
          chainCount++;
        }
      }
    }
    const chainDensity = mappedRelCount > 1 ? chainCount / (mappedRelCount * (mappedRelCount - 1)) : 0;

    const systematicityScore = Math.round(Math.min(1, relCoverage * 0.6 + chainDensity * 0.4) * 100);

    // Step 5: Identify candidate inferences
    // Relations in source not yet mapped suggest predictions about the target
    const candidateInferences = [];
    for (const sr of srcRelations) {
      const alreadyMapped = relationMappings.some(rm =>
        rm.sourceRelation.type === sr.type && rm.sourceRelation.from === sr.from && rm.sourceRelation.to === sr.to
      );
      if (!alreadyMapped && nameMap[sr.from] && nameMap[sr.to]) {
        candidateInferences.push({
          predictedRelation: sr.type,
          from: nameMap[sr.from],
          to: nameMap[sr.to],
          basis: `Source relation "${sr.type}" between "${sr.from}" and "${sr.to}"`,
          confidence: Math.round(systematicityScore * 0.8) / 100,
        });
      }
    }

    return {
      ok: true,
      result: {
        sourceDomain: source.domain || "source",
        targetDomain: target.domain || "target",
        entityMapping,
        relationMappings,
        systematicityScore,
        systematicityLabel: systematicityScore >= 70 ? "high" : systematicityScore >= 40 ? "moderate" : "low",
        candidateInferences,
        coverage: {
          entitiesMapped: entityMapping.length,
          totalSourceEntities: srcEntities.length,
          totalTargetEntities: tgtEntities.length,
          relationsMapped: mappedRelCount,
          totalSourceRelations: srcRelations.length,
          totalTargetRelations: tgtRelations.length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * defaultReasoning
   * Apply default reasoning with exceptions: maintain an inheritance network,
   * handle overrides, and detect conflicting defaults.
   * artifact.data.classes = [{ name, parent?, defaults: { key: value }, overrides?: { key: value } }]
   * artifact.data.instance = { class, properties?: { key: value } }
   */
  registerLensAction("commonsense", "defaultReasoning", (ctx, artifact, _params) => {
  try {
    // Array-guard: a poisoned non-array `classes` (e.g. a string) must not be
    // iterated char-by-char — treat malformed input as an empty hierarchy and
    // degrade gracefully to the "no hierarchy" result.
    const classes = Array.isArray(artifact.data?.classes) ? artifact.data.classes : [];
    const instance = (artifact.data?.instance && typeof artifact.data.instance === "object" && !Array.isArray(artifact.data.instance)) ? artifact.data.instance : {};

    if (classes.length === 0) {
      return { ok: true, result: { message: "No class hierarchy provided." } };
    }

    // Build class lookup
    const classMap = {};
    for (const cls of classes) {
      classMap[cls.name] = {
        name: cls.name,
        parent: cls.parent || null,
        defaults: cls.defaults || {},
        overrides: cls.overrides || {},
      };
    }

    // Compute inheritance chain for a given class
    function getInheritanceChain(className) {
      const chain = [];
      const visited = new Set();
      let current = className;
      while (current && classMap[current] && !visited.has(current)) {
        visited.add(current);
        chain.push(current);
        current = classMap[current].parent;
      }
      return chain;
    }

    // Detect cycles in the hierarchy
    const cycles = [];
    for (const cls of classes) {
      const visited = new Set();
      let current = cls.name;
      const path = [];
      while (current && classMap[current]) {
        if (visited.has(current)) {
          cycles.push({ cycle: [...path, current], startClass: cls.name });
          break;
        }
        visited.add(current);
        path.push(current);
        current = classMap[current].parent;
      }
    }

    // Resolve properties for the instance using default inheritance
    const instanceClass = instance.class || classes[0]?.name;
    const chain = getInheritanceChain(instanceClass);

    // Collect all properties via inheritance (most specific wins)
    const resolvedProperties = {};
    const propertySources = {};
    const conflictsDetected = [];

    // Walk from most general to most specific, overwriting
    for (let i = chain.length - 1; i >= 0; i--) {
      const cls = classMap[chain[i]];
      if (!cls) continue;

      for (const [key, value] of Object.entries(cls.defaults)) {
        if (key in resolvedProperties && resolvedProperties[key] !== value) {
          // Track that this default was overridden
          conflictsDetected.push({
            property: key,
            overriddenValue: resolvedProperties[key],
            overriddenBy: propertySources[key],
            newValue: value,
            newSource: cls.name + " (default)",
          });
        }
        resolvedProperties[key] = value;
        propertySources[key] = cls.name + " (default)";
      }

      // Overrides take precedence over defaults at the same level
      for (const [key, value] of Object.entries(cls.overrides)) {
        if (key in resolvedProperties && resolvedProperties[key] !== value) {
          conflictsDetected.push({
            property: key,
            overriddenValue: resolvedProperties[key],
            overriddenBy: propertySources[key],
            newValue: value,
            newSource: cls.name + " (override)",
          });
        }
        resolvedProperties[key] = value;
        propertySources[key] = cls.name + " (override)";
      }
    }

    // Apply instance-specific properties (highest priority)
    const instanceProps = instance.properties || {};
    for (const [key, value] of Object.entries(instanceProps)) {
      if (key in resolvedProperties && resolvedProperties[key] !== value) {
        conflictsDetected.push({
          property: key,
          overriddenValue: resolvedProperties[key],
          overriddenBy: propertySources[key],
          newValue: value,
          newSource: "instance",
        });
      }
      resolvedProperties[key] = value;
      propertySources[key] = "instance";
    }

    // Detect conflicting defaults at the same hierarchy level
    // (e.g., diamond inheritance — check siblings)
    const siblingConflicts = [];
    const allClasses = Object.values(classMap);
    for (const cls of allClasses) {
      // Find other classes with the same parent
      if (!cls.parent) continue;
      const siblings = allClasses.filter(c => c.parent === cls.parent && c.name !== cls.name);
      for (const sib of siblings) {
        for (const [key, value] of Object.entries(cls.defaults)) {
          if (key in sib.defaults && sib.defaults[key] !== value) {
            siblingConflicts.push({
              property: key,
              classA: cls.name,
              valueA: value,
              classB: sib.name,
              valueB: sib.defaults[key],
              parent: cls.parent,
            });
          }
        }
      }
    }

    // Deduplicate sibling conflicts (A-B same as B-A)
    const seenConflicts = new Set();
    const uniqueSiblingConflicts = siblingConflicts.filter(c => {
      const key = [c.property, c.classA, c.classB].sort().join("|");
      if (seenConflicts.has(key)) return false;
      seenConflicts.add(key);
      return true;
    });

    // Build hierarchy tree for visualization
    const roots = classes.filter(c => !c.parent || !classMap[c.parent]);
    function buildTree(className) {
      const children = classes.filter(c => c.parent === className);
      return {
        name: className,
        defaultCount: Object.keys(classMap[className]?.defaults || {}).length,
        overrideCount: Object.keys(classMap[className]?.overrides || {}).length,
        children: children.map(c => buildTree(c.name)),
      };
    }
    const hierarchy = roots.map(r => buildTree(r.name));

    return {
      ok: true,
      result: {
        instanceClass,
        inheritanceChain: chain,
        resolvedProperties,
        propertySources,
        totalProperties: Object.keys(resolvedProperties).length,
        conflicts: {
          inheritanceOverrides: conflictsDetected.length,
          siblingConflicts: uniqueSiblingConflicts.length,
          details: conflictsDetected.slice(0, 20),
          siblingDetails: uniqueSiblingConflicts.slice(0, 10),
        },
        hierarchy,
        cycles: cycles.length > 0 ? cycles : null,
        warnings: [
          ...(cycles.length > 0 ? ["Cycle detected in class hierarchy"] : []),
          ...(uniqueSiblingConflicts.length > 0 ? [`${uniqueSiblingConflicts.length} conflicting default(s) among sibling classes`] : []),
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * conceptnet-edges — Real ConceptNet edges for a concept. Returns
   * related concepts with relation type (IsA / PartOf / UsedFor /
   * HasProperty / CapableOf / Causes / etc.) + weight.
   * Free, no API key.
   *
   * params: { concept: string, lang?: ISO-2 (default "en"), rel?: relation type filter, limit?: 1-100 }
   */
  registerLensAction("commonsense", "conceptnet-edges", async (_ctx, _artifact, params = {}) => {
    const concept = String(params.concept || "").trim();
    if (!concept) return { ok: false, error: "concept required" };
    const lang = String(params.lang || "en").toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const normalized = concept.toLowerCase().replace(/\s+/g, "_");
    const relFilter = params.rel ? `&rel=/r/${encodeURIComponent(String(params.rel))}` : "";
    try {
      const r = await fetch(`${CONCEPTNET_BASE}/c/${lang}/${encodeURIComponent(normalized)}?limit=${limit}${relFilter}`);
      if (!r.ok) throw new Error(`conceptnet ${r.status}`);
      const data = await r.json();
      const edges = (data.edges || []).map((e) => ({
        relation: e.rel?.label,
        relationId: e.rel?.["@id"],
        start: e.start?.label,
        startConcept: e.start?.["@id"],
        startLang: e.start?.language,
        end: e.end?.label,
        endConcept: e.end?.["@id"],
        endLang: e.end?.language,
        weight: e.weight,
        sources: (e.sources || []).map((s) => s.contributor),
        surfaceText: e.surfaceText,
      }));
      return {
        ok: true,
        result: {
          concept, lang, edges, count: edges.length,
          conceptId: data["@id"],
          source: "conceptnet-5",
        },
      };
    } catch (e) {
      return { ok: false, error: `conceptnet unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * conceptnet-relatedness — Numeric similarity between two concepts
   * via ConceptNet's embedding-based relatedness score.
   * params: { concept1, concept2, lang?: default "en" }
   */
  registerLensAction("commonsense", "conceptnet-relatedness", async (_ctx, _artifact, params = {}) => {
    const a = String(params.concept1 || "").trim();
    const b = String(params.concept2 || "").trim();
    if (!a || !b) return { ok: false, error: "concept1 + concept2 required" };
    const lang = String(params.lang || "en").toLowerCase();
    const norm = (s) => s.toLowerCase().replace(/\s+/g, "_");
    try {
      const r = await fetch(`${CONCEPTNET_BASE}/relatedness?node1=/c/${lang}/${encodeURIComponent(norm(a))}&node2=/c/${lang}/${encodeURIComponent(norm(b))}`);
      if (!r.ok) throw new Error(`conceptnet ${r.status}`);
      const data = await r.json();
      return {
        ok: true,
        result: {
          concept1: a, concept2: b, lang,
          relatedness: data.value,
          interpretation: data.value > 0.7 ? "very-related" : data.value > 0.4 ? "related" : data.value > 0.2 ? "weakly-related" : "unrelated",
          source: "conceptnet-5",
        },
      };
    } catch (e) {
      return { ok: false, error: `conceptnet unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // =========================================================================
  // FACT STORE — persistent per-user subject-relation-object triples.
  // These back the graph / inference / contradiction / query features.
  // =========================================================================

  /**
   * factAdd — add one fact triple to the per-user store.
   * params: { subject, relation, object, confidence?, source? }
   */
  registerLensAction("commonsense", "factAdd", (ctx, _artifact, params = {}) => {
    try {
      const subject = String(params.subject || "").trim();
      const relation = normTok(params.relation || "is_a");
      const object = String(params.object || "").trim();
      if (!subject || !object) return { ok: false, error: "subject + object required" };
      const confidence = Math.max(0, Math.min(1, Number(params.confidence) || 0.8));
      const bucket = factBucket(userIdOf(ctx));
      const id = rid("fact");
      const fact = {
        id, subject, relation, object, confidence,
        source: String(params.source || "user").trim() || "user",
        createdAt: new Date().toISOString(),
      };
      bucket.set(id, fact);
      return { ok: true, result: { fact, total: bucket.size } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** factList — list all stored facts for the calling user. */
  registerLensAction("commonsense", "factList", (ctx, _artifact, _params = {}) => {
    try {
      const facts = [...factBucket(userIdOf(ctx)).values()];
      return { ok: true, result: { facts, count: facts.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** factDelete — remove a fact by id. params: { id } */
  registerLensAction("commonsense", "factDelete", (ctx, _artifact, params = {}) => {
    try {
      const id = String(params.id || "");
      const bucket = factBucket(userIdOf(ctx));
      const existed = bucket.delete(id);
      return { ok: true, result: { deleted: existed, total: bucket.size } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * knowledgeGraph — build a node/edge graph from the fact store, optionally
   * focused on one concept up to a given hop depth. Backs the interactive
   * graph visualization.
   * params: { focus?: string, depth?: 1-4, includeConceptNet?: bool }
   */
  registerLensAction("commonsense", "knowledgeGraph", async (ctx, _artifact, params = {}) => {
    try {
      const facts = [...factBucket(userIdOf(ctx)).values()];
      const focus = normTok(params.focus || "");
      const depth = Math.max(1, Math.min(4, Number(params.depth) || 2));

      // Adjacency from the fact store (undirected reachability for the BFS).
      const adj = new Map();
      const touch = (k) => { if (!adj.has(k)) adj.set(k, new Set()); return adj.get(k); };
      for (const f of facts) {
        const s = normTok(f.subject), o = normTok(f.object);
        touch(s).add(o);
        touch(o).add(s);
      }

      // BFS from focus to find the included node set.
      let included = null;
      if (focus) {
        included = new Set([focus]);
        let frontier = [focus];
        for (let h = 0; h < depth; h++) {
          const next = [];
          for (const n of frontier) {
            for (const nb of (adj.get(n) || [])) {
              if (!included.has(nb)) { included.add(nb); next.push(nb); }
            }
          }
          frontier = next;
        }
      }

      const inScope = (f) =>
        !included || included.has(normTok(f.subject)) || included.has(normTok(f.object));
      const scopedFacts = facts.filter(inScope);

      // Build nodes + edges.
      const nodeMap = new Map();
      const addNode = (label) => {
        const id = normTok(label);
        if (!nodeMap.has(id)) {
          nodeMap.set(id, { id, label, degree: 0, isFocus: id === focus });
        }
        return id;
      };
      const edges = [];
      for (const f of scopedFacts) {
        const sId = addNode(f.subject);
        const oId = addNode(f.object);
        nodeMap.get(sId).degree++;
        nodeMap.get(oId).degree++;
        edges.push({
          id: f.id, source: sId, target: oId,
          relation: f.relation,
          label: RELATION_INDEX[f.relation]?.label || f.relation,
          weight: f.confidence,
        });
      }

      // Optionally enrich the focus node with live ConceptNet edges.
      let conceptNetEdges = [];
      if (focus && params.includeConceptNet) {
        try {
          const data = await cachedFetchJson(
            `${CONCEPTNET_BASE}/c/en/${encodeURIComponent(focus)}?limit=20`,
            { ttlMs: 600000 },
          );
          for (const e of (data.edges || [])) {
            if (!e.start?.label || !e.end?.label) continue;
            const sId = addNode(e.start.label);
            const oId = addNode(e.end.label);
            nodeMap.get(sId).degree++;
            nodeMap.get(oId).degree++;
            const ce = {
              id: `cn_${conceptNetEdges.length}`,
              source: sId, target: oId,
              relation: normTok(e.rel?.label || "related_to"),
              label: e.rel?.label || "RelatedTo",
              weight: typeof e.weight === "number" ? Math.min(1, e.weight / 5) : 0.5,
              source_kind: "conceptnet",
            };
            edges.push(ce);
            conceptNetEdges.push(ce);
          }
        } catch {
          // ConceptNet unreachable — graceful: keep local graph only.
          conceptNetEdges = [];
        }
      }

      const nodes = [...nodeMap.values()].sort((a, b) => b.degree - a.degree);
      return {
        ok: true,
        result: {
          focus: focus || null,
          depth,
          nodes,
          edges,
          stats: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            conceptNetEdges: conceptNetEdges.length,
            maxDegree: nodes[0]?.degree || 0,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * inferChain — derive new facts from existing ones via transitive-relation
   * closure (IsA, PartOf, Causes, HasPrerequisite, Synonym chains). Backs the
   * inference chaining UI.
   * params: { maxHops?: 1-5, minConfidence?: 0-1, relation?: filter }
   */
  registerLensAction("commonsense", "inferChain", (ctx, _artifact, params = {}) => {
    try {
      const facts = [...factBucket(userIdOf(ctx)).values()];
      // Fail-CLOSED: poisoned maxHops / minConfidence (NaN/±Infinity/1e308/-1) must
      // not be silently clamped and reported ok:true. Default when absent; reject
      // when present-but-not-finite.
      let maxHops = 3;
      if (params.maxHops !== undefined && params.maxHops !== null && params.maxHops !== "") {
        maxHops = Number(params.maxHops);
        if (!Number.isFinite(maxHops)) return { ok: false, error: "invalid_maxHops" };
        maxHops = Math.max(1, Math.min(5, maxHops));
      }
      let minConf = 0.3;
      if (params.minConfidence !== undefined && params.minConfidence !== null && params.minConfidence !== "") {
        minConf = Number(params.minConfidence);
        if (!Number.isFinite(minConf)) return { ok: false, error: "invalid_minConfidence" };
        minConf = Math.max(0, Math.min(1, minConf));
      }
      const relFilter = params.relation ? normTok(params.relation) : null;

      // Transitive relations only — these are the ones we can chain.
      const transitiveRels = new Set(
        Object.values(RELATION_INDEX).filter(r => r.transitive).map(r => r.id),
      );

      // Index facts by (subject, relation) for chaining lookups.
      const known = new Set(
        facts.map(f => `${normTok(f.subject)}|${f.relation}|${normTok(f.object)}`),
      );
      const bySubjectRel = new Map();
      for (const f of facts) {
        if (!transitiveRels.has(f.relation)) continue;
        const k = `${normTok(f.subject)}|${f.relation}`;
        if (!bySubjectRel.has(k)) bySubjectRel.set(k, []);
        bySubjectRel.get(k).push(f);
      }

      const derived = [];
      const derivedKeys = new Set();

      // For each transitive relation, walk chains up to maxHops.
      for (const rel of transitiveRels) {
        if (relFilter && rel !== relFilter) continue;
        for (const seed of facts) {
          if (seed.relation !== rel) continue;
          // BFS chain: seed.subject --rel--> ... --rel--> endpoint
          let frontier = [{
            node: normTok(seed.object),
            label: seed.object,
            hops: 1,
            conf: seed.confidence,
            path: [seed],
          }];
          while (frontier.length) {
            const next = [];
            for (const st of frontier) {
              if (st.hops >= maxHops) continue;
              const cont = bySubjectRel.get(`${st.node}|${rel}`) || [];
              for (const f of cont) {
                const endNode = normTok(f.object);
                const startNode = normTok(seed.subject);
                if (endNode === startNode) continue; // skip cycles
                const newConf = st.conf * f.confidence;
                const key = `${startNode}|${rel}|${endNode}`;
                if (known.has(key) || derivedKeys.has(key)) {
                  next.push({
                    node: endNode, label: f.object,
                    hops: st.hops + 1, conf: newConf,
                    path: [...st.path, f],
                  });
                  continue;
                }
                if (newConf >= minConf) {
                  derivedKeys.add(key);
                  derived.push({
                    subject: seed.subject,
                    relation: rel,
                    relationLabel: RELATION_INDEX[rel]?.label || rel,
                    object: f.object,
                    confidence: Math.round(newConf * 1000) / 1000,
                    hops: st.path.length + 1,
                    derivation: [...st.path, f].map(p => ({
                      subject: p.subject, relation: p.relation, object: p.object,
                      confidence: p.confidence,
                    })),
                    rationale: `transitive ${RELATION_INDEX[rel]?.label || rel} over ${st.path.length + 1} known facts`,
                  });
                }
                next.push({
                  node: endNode, label: f.object,
                  hops: st.hops + 1, conf: newConf,
                  path: [...st.path, f],
                });
              }
            }
            frontier = next;
          }
        }
      }

      derived.sort((a, b) => b.confidence - a.confidence);
      return {
        ok: true,
        result: {
          inferences: derived,
          count: derived.length,
          baseFactCount: facts.length,
          maxHops,
          minConfidence: minConf,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * contradictionScan — detect contradictions across the fact store:
   *  - antonym-property conflicts (X has_property hot + X has_property cold)
   *  - exclusive IsA conflicts (transitive classes that are antonymic)
   *  - direct negation pairs across relations
   * Backs the contradiction detection feature.
   */
  registerLensAction("commonsense", "contradictionScan", (ctx, _artifact, _params = {}) => {
    try {
      const facts = [...factBucket(userIdOf(ctx)).values()];
      const contradictions = [];

      // Antonym lookup.
      const antonymOf = new Map();
      for (const [a, b] of ANTONYM_PAIRS) {
        antonymOf.set(a, b);
        antonymOf.set(b, a);
      }

      // Group facts by subject for same-subject conflict checks.
      const bySubject = new Map();
      for (const f of facts) {
        const s = normTok(f.subject);
        if (!bySubject.has(s)) bySubject.set(s, []);
        bySubject.get(s).push(f);
      }

      for (const [, subjFacts] of bySubject) {
        for (let i = 0; i < subjFacts.length; i++) {
          for (let j = i + 1; j < subjFacts.length; j++) {
            const a = subjFacts[i];
            const b = subjFacts[j];
            if (a.relation !== b.relation) continue;
            const objA = normTok(a.object);
            const objB = normTok(b.object);
            if (objA === objB) continue;

            // Antonymic objects under the same relation = contradiction.
            if (antonymOf.get(objA) === objB) {
              contradictions.push({
                kind: a.relation === "is_a" ? "exclusive-class" : "antonym-property",
                severity: "high",
                subject: a.subject,
                relation: a.relation,
                factA: { id: a.id, object: a.object, confidence: a.confidence },
                factB: { id: b.id, object: b.object, confidence: b.confidence },
                description: `"${a.subject}" cannot be both "${a.object}" and "${b.object}" under ${RELATION_INDEX[a.relation]?.label || a.relation}`,
              });
            }
          }
        }
      }

      // Negation-pair contradiction: a fact and its explicit negation
      // ("not X", "no X") under the same subject+relation.
      for (const [, subjFacts] of bySubject) {
        for (const f of subjFacts) {
          const obj = normTok(f.object);
          const isNeg = /^(not_|no_|non_)/.test(obj);
          const bare = obj.replace(/^(not_|no_|non_)/, "");
          for (const g of subjFacts) {
            if (g.id === f.id || g.relation !== f.relation) continue;
            if (isNeg && normTok(g.object) === bare) {
              contradictions.push({
                kind: "direct-negation",
                severity: "high",
                subject: f.subject,
                relation: f.relation,
                factA: { id: f.id, object: f.object, confidence: f.confidence },
                factB: { id: g.id, object: g.object, confidence: g.confidence },
                description: `"${f.subject}" asserted as both "${g.object}" and its negation "${f.object}"`,
              });
            }
          }
        }
      }

      // Deduplicate (A,B) == (B,A).
      const seen = new Set();
      const unique = contradictions.filter(c => {
        const k = [c.subject, c.relation, c.factA.id, c.factB.id].sort().join("|");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      return {
        ok: true,
        result: {
          contradictions: unique,
          count: unique.length,
          factsScanned: facts.length,
          consistent: unique.length === 0,
          highSeverity: unique.filter(c => c.severity === "high").length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * relationTaxonomy — return the canonical relation taxonomy, annotated
   * with usage counts from the calling user's fact store. Backs the
   * IsA / PartOf / Causes / UsedFor browsing UI.
   */
  registerLensAction("commonsense", "relationTaxonomy", (ctx, _artifact, _params = {}) => {
    try {
      const facts = [...factBucket(userIdOf(ctx)).values()];
      const counts = {};
      for (const f of facts) counts[f.relation] = (counts[f.relation] || 0) + 1;
      const groups = RELATION_TAXONOMY.map(g => ({
        group: g.group,
        description: g.description,
        relations: g.relations.map(r => ({
          ...r,
          usageCount: counts[r.id] || 0,
        })),
      }));
      return {
        ok: true,
        result: {
          taxonomy: groups,
          totalRelationTypes: Object.keys(RELATION_INDEX).length,
          relationsInUse: Object.keys(counts).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * confidenceQuery — confidence-weighted query: "things very likely true
   * about X". Combines the local fact store with live ConceptNet edge
   * weights, ranked by a unified confidence score.
   * params: { subject: string, minConfidence?: 0-1, relation?: filter, useConceptNet?: bool }
   */
  registerLensAction("commonsense", "confidenceQuery", async (ctx, _artifact, params = {}) => {
    try {
      const subject = String(params.subject || "").trim();
      if (!subject) return { ok: false, error: "subject required" };
      const subjNorm = normTok(subject);
      // Fail-CLOSED: a poisoned minConfidence (NaN/±Infinity/1e308/-1) must not be
      // silently clamped into a valid threshold and reported ok:true. Default when
      // absent; reject when present-but-not-finite.
      let minConf = 0.5;
      if (params.minConfidence !== undefined && params.minConfidence !== null && params.minConfidence !== "") {
        minConf = Number(params.minConfidence);
        if (!Number.isFinite(minConf)) return { ok: false, error: "invalid_minConfidence" };
        minConf = Math.max(0, Math.min(1, minConf));
      }
      const relFilter = params.relation ? normTok(params.relation) : null;

      const facts = [...factBucket(userIdOf(ctx)).values()];
      const matches = [];

      for (const f of facts) {
        if (normTok(f.subject) !== subjNorm) continue;
        if (relFilter && f.relation !== relFilter) continue;
        if (f.confidence < minConf) continue;
        matches.push({
          subject: f.subject,
          relation: f.relation,
          relationLabel: RELATION_INDEX[f.relation]?.label || f.relation,
          object: f.object,
          confidence: f.confidence,
          source: f.source || "user",
          origin: "local",
        });
      }

      // Pull ConceptNet edges and convert their weights into a 0-1 confidence.
      let conceptNetCount = 0;
      if (params.useConceptNet !== false) {
        try {
          const data = await cachedFetchJson(
            `${CONCEPTNET_BASE}/c/en/${encodeURIComponent(subjNorm)}?limit=60`,
            { ttlMs: 600000 },
          );
          for (const e of (data.edges || [])) {
            // Keep only assertions where the subject is the start node.
            if (normTok(e.start?.label || "") !== subjNorm) continue;
            const rel = normTok(e.rel?.label || "related_to");
            if (relFilter && rel !== relFilter) continue;
            // ConceptNet weight ~ 1..10; map to a saturating confidence.
            const w = typeof e.weight === "number" ? e.weight : 1;
            const conf = Math.round(Math.min(0.99, 1 - Math.exp(-w / 3)) * 1000) / 1000;
            if (conf < minConf) continue;
            matches.push({
              subject,
              relation: rel,
              relationLabel: e.rel?.label || rel,
              object: e.end?.label || "",
              confidence: conf,
              source: "conceptnet",
              origin: "conceptnet",
            });
            conceptNetCount++;
          }
        } catch {
          conceptNetCount = 0;
        }
      }

      matches.sort((a, b) => b.confidence - a.confidence);
      return {
        ok: true,
        result: {
          subject,
          minConfidence: minConf,
          matches,
          count: matches.length,
          localCount: matches.length - conceptNetCount,
          conceptNetCount,
          interpretation: matches.length === 0
            ? `No assertions about "${subject}" meet the ${(minConf * 100).toFixed(0)}% confidence threshold`
            : `${matches.length} assertion(s) likely true about "${subject}" (≥${(minConf * 100).toFixed(0)}% confidence)`,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * extractFacts — extract subject-relation-object triples from free text
   * via pattern matching. Optionally commit them to the fact store.
   * params: { text: string, commit?: bool, defaultConfidence?: 0-1 }
   */
  registerLensAction("commonsense", "extractFacts", (ctx, _artifact, params = {}) => {
    try {
      const text = String(params.text || "").trim();
      if (!text) return { ok: false, error: "text required" };
      const defConf = Math.max(0, Math.min(1, Number(params.defaultConfidence) || 0.6));

      // Pattern → relation extraction rules. Each captures (subject, object).
      const patterns = [
        { re: /\b([a-z][\w\s-]{1,40}?)\s+is\s+a\s+(?:kind\s+of\s+|type\s+of\s+)?([a-z][\w\s-]{1,40}?)\b/gi, relation: "is_a", conf: 0.85 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+(?:are|is)\s+([a-z][\w\s-]{1,40}?)\b/gi, relation: "is_a", conf: 0.55 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+is\s+part\s+of\s+(?:a\s+|an\s+|the\s+)?([a-z][\w\s-]{1,40}?)\b/gi, relation: "part_of", conf: 0.85 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+(?:has|have)\s+(?:a\s+|an\s+)?([a-z][\w\s-]{1,40}?)\b/gi, relation: "has_a", conf: 0.7 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+is\s+used\s+(?:for|to)\s+([a-z][\w\s-]{1,40}?)\b/gi, relation: "used_for", conf: 0.8 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+can\s+([a-z][\w\s-]{1,40}?)\b/gi, relation: "capable_of", conf: 0.75 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+causes?\s+([a-z][\w\s-]{1,40}?)\b/gi, relation: "causes", conf: 0.8 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+is\s+located\s+(?:in|at|on)\s+(?:a\s+|an\s+|the\s+)?([a-z][\w\s-]{1,40}?)\b/gi, relation: "located_at", conf: 0.8 },
        { re: /\b([a-z][\w\s-]{1,40}?)\s+is\s+([a-z][\w-]{2,20})\b/gi, relation: "has_property", conf: 0.5 },
      ];

      const STOP = new Set(["the", "a", "an", "this", "that", "it", "they", "there", "and", "or", "but"]);
      const clean = (s) => s.trim().replace(/^(the|a|an)\s+/i, "").trim();

      const extracted = [];
      const seen = new Set();
      for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
        for (const p of patterns) {
          p.re.lastIndex = 0;
          let m;
          while ((m = p.re.exec(sentence)) !== null) {
            const subject = clean(m[1]);
            const object = clean(m[2]);
            if (!subject || !object) continue;
            if (subject.length < 2 || object.length < 2) continue;
            if (STOP.has(subject.toLowerCase()) || STOP.has(object.toLowerCase())) continue;
            if (normTok(subject) === normTok(object)) continue;
            const key = `${normTok(subject)}|${p.relation}|${normTok(object)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            extracted.push({
              subject, relation: p.relation,
              relationLabel: RELATION_INDEX[p.relation]?.label || p.relation,
              object,
              confidence: Math.round(Math.min(p.conf, defConf + 0.25) * 1000) / 1000,
              sourceSentence: sentence.trim().slice(0, 160),
            });
          }
        }
      }

      // Optionally commit to the fact store.
      let committed = 0;
      if (params.commit && extracted.length) {
        const bucket = factBucket(userIdOf(ctx));
        for (const e of extracted) {
          const id = rid("fact");
          bucket.set(id, {
            id, subject: e.subject, relation: e.relation, object: e.object,
            confidence: e.confidence, source: "text-extraction",
            createdAt: new Date().toISOString(),
            provenance: { method: "extraction", sentence: e.sourceSentence },
          });
          committed++;
        }
      }

      return {
        ok: true,
        result: {
          extracted,
          count: extracted.length,
          committed,
          charactersAnalyzed: text.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * provenanceChain — trace the citation / derivation chain for a fact.
   * Walks: the fact's own source/provenance, then (for derived facts) the
   * inference chain that would produce it, then the supporting base facts.
   * params: { factId: string }
   */
  registerLensAction("commonsense", "provenanceChain", (ctx, _artifact, params = {}) => {
    try {
      const factId = String(params.factId || "");
      const bucket = factBucket(userIdOf(ctx));
      const fact = bucket.get(factId);
      if (!fact) return { ok: false, error: "fact not found" };

      const facts = [...bucket.values()];
      const chain = [];

      // Step 1: the fact's declared origin.
      chain.push({
        step: 1,
        kind: "assertion",
        fact: { id: fact.id, subject: fact.subject, relation: fact.relation, object: fact.object },
        source: fact.source || "user",
        confidence: fact.confidence,
        detail: fact.provenance
          ? `${fact.provenance.method}${fact.provenance.sentence ? `: "${fact.provenance.sentence}"` : ""}`
          : `Directly asserted (source: ${fact.source || "user"})`,
      });

      // Step 2: supporting evidence — other stored facts that share the
      // subject or object, forming the local evidential neighbourhood.
      const s = normTok(fact.subject), o = normTok(fact.object);
      const supporting = facts
        .filter(f => f.id !== fact.id &&
          (normTok(f.subject) === s || normTok(f.object) === o ||
           normTok(f.object) === s || normTok(f.subject) === o))
        .slice(0, 12)
        .map(f => ({
          id: f.id, subject: f.subject, relation: f.relation, object: f.object,
          confidence: f.confidence, source: f.source || "user",
        }));
      if (supporting.length) {
        chain.push({
          step: 2,
          kind: "supporting-evidence",
          count: supporting.length,
          facts: supporting,
          detail: `${supporting.length} related fact(s) in the local neighbourhood`,
        });
      }

      // Step 3: derivability — could this fact also be inferred transitively?
      let derivable = null;
      if (RELATION_INDEX[fact.relation]?.transitive) {
        // Look for a 2-hop path subject --rel--> mid --rel--> object.
        for (const f1 of facts) {
          if (f1.id === fact.id || f1.relation !== fact.relation) continue;
          if (normTok(f1.subject) !== s) continue;
          for (const f2 of facts) {
            if (f2.relation !== fact.relation) continue;
            if (normTok(f2.subject) === normTok(f1.object) && normTok(f2.object) === o) {
              derivable = {
                path: [
                  { subject: f1.subject, relation: f1.relation, object: f1.object, confidence: f1.confidence },
                  { subject: f2.subject, relation: f2.relation, object: f2.object, confidence: f2.confidence },
                ],
                inferredConfidence: Math.round(f1.confidence * f2.confidence * 1000) / 1000,
              };
              break;
            }
          }
          if (derivable) break;
        }
      }
      if (derivable) {
        chain.push({
          step: chain.length + 1,
          kind: "alternative-derivation",
          derivation: derivable.path,
          inferredConfidence: derivable.inferredConfidence,
          detail: `Independently derivable via transitive ${RELATION_INDEX[fact.relation]?.label} chain`,
        });
      }

      return {
        ok: true,
        result: {
          factId,
          fact: {
            subject: fact.subject, relation: fact.relation, object: fact.object,
            confidence: fact.confidence,
          },
          chain,
          depth: chain.length,
          independentlyVerified: !!derivable,
          rootSource: fact.source || "user",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
