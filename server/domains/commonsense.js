// server/domains/commonsense.js
// Domain actions for common-sense reasoning: plausibility checking,
// analogy mapping, default reasoning with exceptions, plus real
// ConceptNet knowledge-graph lookups (free, no API key — ~34M
// edges across 304 languages).

const CONCEPTNET_BASE = "https://api.conceptnet.io";

export default function registerCommonsenseActions(registerLensAction) {
  /**
   * plausibilityCheck
   * Score statement plausibility using constraint satisfaction.
   * Check temporal ordering, spatial consistency, and causal chains.
   * artifact.data.statement = { text, entities?: [], events?: [{ action, time?, location? }] }
   * artifact.data.constraints = [{ type: "temporal"|"spatial"|"causal"|"physical"|"social", rule, entities? }]
   */
  registerLensAction("commonsense", "plausibilityCheck", (ctx, artifact, _params) => {
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
  });

  /**
   * analogyMapping
   * Map analogies between domains using structural alignment theory.
   * Compute systematicity score and identify candidate inferences.
   * artifact.data.source = { domain, entities: [{ name, type }], relations: [{ type, from, to, properties?: {} }] }
   * artifact.data.target = { domain, entities: [{ name, type }], relations: [{ type, from, to, properties?: {} }] }
   */
  registerLensAction("commonsense", "analogyMapping", (ctx, artifact, _params) => {
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
  });

  /**
   * defaultReasoning
   * Apply default reasoning with exceptions: maintain an inheritance network,
   * handle overrides, and detect conflicting defaults.
   * artifact.data.classes = [{ name, parent?, defaults: { key: value }, overrides?: { key: value } }]
   * artifact.data.instance = { class, properties?: { key: value } }
   */
  registerLensAction("commonsense", "defaultReasoning", (ctx, artifact, _params) => {
    const classes = artifact.data?.classes || [];
    const instance = artifact.data?.instance || {};

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
}
