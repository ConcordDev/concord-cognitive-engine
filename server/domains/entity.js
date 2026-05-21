// server/domains/entity.js
// Domain actions for entity/identity management: entity resolution,
// relationship graph analysis, and attribute validation.

export default function registerEntityActions(registerLensAction) {
  /**
   * entityResolution
   * Merge/deduplicate entity records using Jaro-Winkler string similarity,
   * probabilistic record linkage, and match confidence scoring.
   * artifact.data.records = [{ id, fields: { name?, email?, phone?, address?, ... } }]
   * params.threshold (default 0.85), params.matchFields (default all)
   */
  registerLensAction("entity", "entityResolution", (ctx, artifact, params) => {
    const records = artifact.data?.records || [];
    if (records.length < 2) {
      return { ok: true, result: { message: "Need at least 2 records for entity resolution." } };
    }

    const threshold = params.threshold || 0.85;
    const matchFields = params.matchFields || null; // null = use all fields

    // Jaro-Winkler similarity
    function jaroWinkler(s1, s2) {
      if (!s1 || !s2) return 0;
      s1 = s1.toLowerCase().trim();
      s2 = s2.toLowerCase().trim();
      if (s1 === s2) return 1;

      const len1 = s1.length;
      const len2 = s2.length;
      if (len1 === 0 || len2 === 0) return 0;

      const matchWindow = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
      const s1Matches = new Array(len1).fill(false);
      const s2Matches = new Array(len2).fill(false);

      let matches = 0;
      let transpositions = 0;

      // Find matches
      for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, len2);
        for (let j = start; j < end; j++) {
          if (s2Matches[j] || s1[i] !== s2[j]) continue;
          s1Matches[i] = true;
          s2Matches[j] = true;
          matches++;
          break;
        }
      }

      if (matches === 0) return 0;

      // Count transpositions
      let k = 0;
      for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
      }

      const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

      // Winkler modification: boost for common prefix
      let prefix = 0;
      for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
      }

      return jaro + prefix * 0.1 * (1 - jaro);
    }

    // Normalized phone comparison
    function phoneMatch(a, b) {
      if (!a || !b) return 0;
      const normA = a.replace(/[^0-9]/g, "");
      const normB = b.replace(/[^0-9]/g, "");
      if (normA.length === 0 || normB.length === 0) return 0;
      if (normA === normB) return 1;
      // Check if one is suffix of the other (country code difference)
      if (normA.endsWith(normB) || normB.endsWith(normA)) return 0.95;
      return 0;
    }

    // Email comparison
    function emailMatch(a, b) {
      if (!a || !b) return 0;
      a = a.toLowerCase().trim();
      b = b.toLowerCase().trim();
      if (a === b) return 1;
      // Check local part similarity
      const localA = a.split("@")[0];
      const localB = b.split("@")[0];
      const domainA = a.split("@")[1];
      const domainB = b.split("@")[1];
      if (domainA === domainB) return jaroWinkler(localA, localB) * 0.9;
      return jaroWinkler(a, b) * 0.5;
    }

    // Field-specific comparison
    function compareField(key, a, b) {
      if (key === "email") return emailMatch(a, b);
      if (key === "phone" || key === "telephone") return phoneMatch(a, b);
      return jaroWinkler(String(a), String(b));
    }

    // Field reliability weights for probabilistic linkage
    const fieldWeights = {
      email: 0.95,
      phone: 0.9,
      ssn: 0.99,
      name: 0.7,
      firstName: 0.5,
      lastName: 0.6,
      address: 0.6,
      city: 0.3,
      state: 0.2,
      zip: 0.4,
      dob: 0.85,
      dateOfBirth: 0.85,
    };

    // Compute pairwise matches
    const matches = [];
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const fieldsA = records[i].fields || {};
        const fieldsB = records[j].fields || {};

        const allKeys = new Set([
          ...Object.keys(fieldsA),
          ...Object.keys(fieldsB),
        ]);

        const fieldKeys = matchFields
          ? [...allKeys].filter(k => matchFields.includes(k))
          : [...allKeys];

        if (fieldKeys.length === 0) continue;

        let weightedScoreSum = 0;
        let totalWeight = 0;
        const fieldScores = {};

        for (const key of fieldKeys) {
          const valA = fieldsA[key];
          const valB = fieldsB[key];
          if (valA == null || valB == null) continue;

          const sim = compareField(key, valA, valB);
          const weight = fieldWeights[key] || 0.5;
          weightedScoreSum += sim * weight;
          totalWeight += weight;
          fieldScores[key] = Math.round(sim * 1000) / 1000;
        }

        const confidence = totalWeight > 0 ? weightedScoreSum / totalWeight : 0;

        if (confidence >= threshold) {
          matches.push({
            recordA: records[i].id || i,
            recordB: records[j].id || j,
            confidence: Math.round(confidence * 1000) / 1000,
            fieldScores,
            fieldsCompared: Object.keys(fieldScores).length,
          });
        }
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence);

    // Build merge clusters using union-find
    const parent = {};
    function find(x) {
      if (!(x in parent)) parent[x] = x;
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    }
    function union(x, y) {
      const px = find(x), py = find(y);
      if (px !== py) parent[px] = py;
    }

    for (const m of matches) {
      union(String(m.recordA), String(m.recordB));
    }

    const clusters = {};
    for (const rec of records) {
      const id = String(rec.id || records.indexOf(rec));
      const root = find(id);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(id);
    }

    const mergeGroups = Object.values(clusters)
      .filter(c => c.length > 1)
      .map((members, idx) => ({
        groupId: idx,
        memberCount: members.length,
        members,
        avgConfidence: Math.round(
          matches
            .filter(m => members.includes(String(m.recordA)) && members.includes(String(m.recordB)))
            .reduce((s, m) => s + m.confidence, 0) /
          Math.max(1, matches.filter(m => members.includes(String(m.recordA)) && members.includes(String(m.recordB))).length)
          * 1000
        ) / 1000,
      }));

    return {
      ok: true,
      result: {
        totalRecords: records.length,
        matchesFound: matches.length,
        mergeGroups: { count: mergeGroups.length, groups: mergeGroups },
        uniqueEntities: Object.keys(clusters).length,
        duplicateRate: Math.round(((records.length - Object.keys(clusters).length) / Math.max(records.length, 1)) * 10000) / 100,
        matches: matches.slice(0, 50),
        parameters: { threshold, matchFields: matchFields || "all" },
      },
    };
  });

  /**
   * relationshipGraph
   * Build entity relationship graph, detect cycles, compute centrality
   * measures, and identify key connectors.
   * artifact.data.entities = [{ id, name, type? }]
   * artifact.data.relationships = [{ from, to, type?, weight? }]
   */
  registerLensAction("entity", "relationshipGraph", (ctx, artifact, _params) => {
    const entities = artifact.data?.entities || [];
    const relationships = artifact.data?.relationships || [];

    if (entities.length === 0) {
      return { ok: true, result: { message: "No entities provided." } };
    }

    const entityMap = {};
    for (const e of entities) {
      entityMap[e.id] = { ...e, neighbors: new Set(), inDegree: 0, outDegree: 0 };
    }

    // Build adjacency
    const adjacency = {};
    const validRels = [];
    for (const rel of relationships) {
      if (!entityMap[rel.from] || !entityMap[rel.to]) continue;
      if (!adjacency[rel.from]) adjacency[rel.from] = [];
      adjacency[rel.from].push({ target: rel.to, type: rel.type, weight: rel.weight || 1 });
      entityMap[rel.from].neighbors.add(rel.to);
      entityMap[rel.to].neighbors.add(rel.from);
      entityMap[rel.from].outDegree++;
      entityMap[rel.to].inDegree++;
      validRels.push(rel);
    }

    const n = entities.length;

    // Degree centrality
    const degreeCentrality = {};
    for (const e of entities) {
      degreeCentrality[e.id] = n > 1
        ? Math.round((entityMap[e.id].neighbors.size / (n - 1)) * 10000) / 10000
        : 0;
    }

    // Betweenness centrality (BFS-based for unweighted)
    const betweenness = {};
    for (const e of entities) betweenness[e.id] = 0;

    for (const source of entities) {
      // BFS from source
      const dist = {};
      const sigma = {}; // number of shortest paths
      const pred = {};
      const queue = [];
      const stack = [];

      for (const e of entities) {
        dist[e.id] = -1;
        sigma[e.id] = 0;
        pred[e.id] = [];
      }
      dist[source.id] = 0;
      sigma[source.id] = 1;
      queue.push(source.id);

      while (queue.length > 0) {
        const v = queue.shift();
        stack.push(v);
        const neighbors = adjacency[v] || [];
        for (const { target: w } of neighbors) {
          if (dist[w] < 0) {
            dist[w] = dist[v] + 1;
            queue.push(w);
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            pred[w].push(v);
          }
        }
      }

      // Back-propagation
      const delta = {};
      for (const e of entities) delta[e.id] = 0;
      while (stack.length > 0) {
        const w = stack.pop();
        for (const v of pred[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== source.id) {
          betweenness[w] += delta[w];
        }
      }
    }

    // Normalize betweenness
    const normFactor = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
    for (const id of Object.keys(betweenness)) {
      betweenness[id] = Math.round(betweenness[id] * normFactor * 10000) / 10000;
    }

    // Closeness centrality
    const closeness = {};
    for (const source of entities) {
      // BFS distances
      const dist = {};
      const queue = [source.id];
      dist[source.id] = 0;
      while (queue.length > 0) {
        const v = queue.shift();
        for (const { target: w } of (adjacency[v] || [])) {
          if (!(w in dist)) {
            dist[w] = dist[v] + 1;
            queue.push(w);
          }
        }
      }
      const reachable = Object.values(dist).filter(d => d > 0);
      const totalDist = reachable.reduce((s, d) => s + d, 0);
      closeness[source.id] = totalDist > 0 && reachable.length > 0
        ? Math.round((reachable.length / totalDist) * 10000) / 10000
        : 0;
    }

    // Cycle detection (DFS)
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();

    function dfs(node, path) {
      visited.add(node);
      recStack.add(node);

      for (const { target } of (adjacency[node] || [])) {
        if (recStack.has(target)) {
          const cycleStart = path.indexOf(target);
          if (cycleStart >= 0) {
            const cycle = [...path.slice(cycleStart), target];
            const key = [...cycle].sort().join(",");
            if (!cycles.some(c => [...c.path].sort().join(",") === key)) {
              cycles.push({ path: cycle, length: cycle.length - 1 });
            }
          }
        } else if (!visited.has(target) && path.length < 15) {
          dfs(target, [...path, target]);
        }
      }

      recStack.delete(node);
    }

    for (const e of entities) {
      if (!visited.has(e.id)) {
        dfs(e.id, [e.id]);
      }
    }

    // Connected components
    const componentVisited = new Set();
    const components = [];
    function bfs(start) {
      const component = [];
      const queue = [start];
      componentVisited.add(start);
      while (queue.length > 0) {
        const v = queue.shift();
        component.push(v);
        for (const neighbor of (entityMap[v]?.neighbors || [])) {
          if (!componentVisited.has(neighbor)) {
            componentVisited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      return component;
    }
    for (const e of entities) {
      if (!componentVisited.has(e.id)) {
        components.push(bfs(e.id));
      }
    }

    // Identify key connectors (high betweenness + high degree)
    const entityScores = entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      degree: entityMap[e.id].neighbors.size,
      inDegree: entityMap[e.id].inDegree,
      outDegree: entityMap[e.id].outDegree,
      degreeCentrality: degreeCentrality[e.id],
      betweennessCentrality: betweenness[e.id],
      closenessCentrality: closeness[e.id],
      isKeyConnector: betweenness[e.id] > 0.05 && degreeCentrality[e.id] > 0.1,
    })).sort((a, b) => b.betweennessCentrality - a.betweennessCentrality);

    const keyConnectors = entityScores.filter(e => e.isKeyConnector);

    // Graph density
    const maxEdges = n * (n - 1);
    const density = maxEdges > 0 ? Math.round((validRels.length / maxEdges) * 10000) / 10000 : 0;

    return {
      ok: true,
      result: {
        entityCount: n,
        relationshipCount: validRels.length,
        graphDensity: density,
        connectedComponents: components.length,
        largestComponentSize: Math.max(...components.map(c => c.length), 0),
        cycles: { count: cycles.length, items: cycles.slice(0, 15) },
        keyConnectors: { count: keyConnectors.length, entities: keyConnectors.slice(0, 10) },
        entities: entityScores.slice(0, 30),
        relationshipTypes: [...new Set(validRels.map(r => r.type).filter(Boolean))],
      },
    };
  });

  /**
   * attributeValidation
   * Validate entity attributes against schemas: type checking, format
   * validation, and cross-field consistency rules.
   * artifact.data.entity = { id, fields: { key: value } }
   * artifact.data.schema = { fields: { key: { type, required?, format?, min?, max?, pattern?, oneOf?, dependsOn? } } }
   * artifact.data.consistencyRules = [{ rule, fields, condition }] (optional)
   */
  registerLensAction("entity", "attributeValidation", (ctx, artifact, _params) => {
    const entity = artifact.data?.entity || {};
    const schema = artifact.data?.schema || {};
    const rules = artifact.data?.consistencyRules || [];
    const fields = entity.fields || {};
    const schemaFields = schema.fields || {};

    const errors = [];
    const warnings = [];
    let validCount = 0;
    let checkedCount = 0;

    // Format validators
    const formatValidators = {
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      phone: (v) => /^\+?[\d\s()-]{7,20}$/.test(v),
      url: (v) => /^https?:\/\/[^\s]+$/.test(v),
      uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      date: (v) => !isNaN(Date.parse(v)),
      isoDate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      ipv4: (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every(n => Number(n) >= 0 && Number(n) <= 255),
      zipCode: (v) => /^\d{5}(-\d{4})?$/.test(v),
      ssn: (v) => /^\d{3}-?\d{2}-?\d{4}$/.test(v),
      creditCard: (v) => {
        const digits = v.replace(/\D/g, "");
        if (digits.length < 13 || digits.length > 19) return false;
        // Luhn algorithm
        let sum = 0;
        let alt = false;
        for (let i = digits.length - 1; i >= 0; i--) {
          let n = parseInt(digits[i], 10);
          if (alt) { n *= 2; if (n > 9) n -= 9; }
          sum += n;
          alt = !alt;
        }
        return sum % 10 === 0;
      },
    };

    // Type checkers
    function checkType(value, expectedType) {
      switch (expectedType) {
        case "string": return typeof value === "string";
        case "number": return typeof value === "number" || (typeof value === "string" && !isNaN(Number(value)));
        case "integer": return Number.isInteger(Number(value));
        case "boolean": return typeof value === "boolean" || value === "true" || value === "false";
        case "array": return Array.isArray(value);
        case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
        case "date": return !isNaN(Date.parse(String(value)));
        default: return true;
      }
    }

    // Validate each schema field
    for (const [fieldName, fieldSchema] of Object.entries(schemaFields)) {
      checkedCount++;
      const value = fields[fieldName];

      // Required check
      if (fieldSchema.required && (value == null || value === "")) {
        errors.push({
          field: fieldName,
          type: "required",
          message: `Required field "${fieldName}" is missing`,
        });
        continue;
      }

      if (value == null || value === "") {
        if (!fieldSchema.required) validCount++;
        continue;
      }

      let fieldValid = true;

      // Type check
      if (fieldSchema.type && !checkType(value, fieldSchema.type)) {
        errors.push({
          field: fieldName,
          type: "type",
          message: `Field "${fieldName}" expected type "${fieldSchema.type}", got "${typeof value}"`,
          value: String(value).slice(0, 50),
        });
        fieldValid = false;
      }

      // Format check
      if (fieldSchema.format && formatValidators[fieldSchema.format]) {
        if (!formatValidators[fieldSchema.format](String(value))) {
          errors.push({
            field: fieldName,
            type: "format",
            message: `Field "${fieldName}" does not match format "${fieldSchema.format}"`,
            value: String(value).slice(0, 50),
          });
          fieldValid = false;
        }
      }

      // Pattern check
      if (fieldSchema.pattern) {
        try {
          const re = new RegExp(fieldSchema.pattern);
          if (!re.test(String(value))) {
            errors.push({
              field: fieldName,
              type: "pattern",
              message: `Field "${fieldName}" does not match pattern "${fieldSchema.pattern}"`,
              value: String(value).slice(0, 50),
            });
            fieldValid = false;
          }
        } catch (e) {
          warnings.push({ field: fieldName, message: `Invalid pattern "${fieldSchema.pattern}"` });
        }
      }

      // Range checks
      if (fieldSchema.min != null) {
        const numVal = Number(value);
        if (!isNaN(numVal) && numVal < fieldSchema.min) {
          errors.push({
            field: fieldName,
            type: "range",
            message: `Field "${fieldName}" value ${numVal} is below minimum ${fieldSchema.min}`,
          });
          fieldValid = false;
        }
      }
      if (fieldSchema.max != null) {
        const numVal = Number(value);
        if (!isNaN(numVal) && numVal > fieldSchema.max) {
          errors.push({
            field: fieldName,
            type: "range",
            message: `Field "${fieldName}" value ${numVal} exceeds maximum ${fieldSchema.max}`,
          });
          fieldValid = false;
        }
      }

      // Enum check
      if (fieldSchema.oneOf && Array.isArray(fieldSchema.oneOf)) {
        if (!fieldSchema.oneOf.includes(value)) {
          errors.push({
            field: fieldName,
            type: "enum",
            message: `Field "${fieldName}" value "${value}" is not one of: ${fieldSchema.oneOf.join(", ")}`,
          });
          fieldValid = false;
        }
      }

      // Dependency check
      if (fieldSchema.dependsOn) {
        const depField = fieldSchema.dependsOn;
        if (fields[depField] == null || fields[depField] === "") {
          warnings.push({
            field: fieldName,
            type: "dependency",
            message: `Field "${fieldName}" is set but dependent field "${depField}" is missing`,
          });
        }
      }

      if (fieldValid) validCount++;
    }

    // Check for extra fields not in schema
    for (const fieldName of Object.keys(fields)) {
      if (!schemaFields[fieldName]) {
        warnings.push({
          field: fieldName,
          type: "extra",
          message: `Field "${fieldName}" is not defined in the schema`,
        });
      }
    }

    // Cross-field consistency rules
    const ruleResults = [];
    for (const rule of rules) {
      const ruleFields = rule.fields || [];
      const fieldValues = {};
      let allPresent = true;
      for (const f of ruleFields) {
        if (fields[f] != null) fieldValues[f] = fields[f];
        else allPresent = false;
      }

      if (!allPresent) {
        ruleResults.push({ rule: rule.rule, status: "skipped", reason: "Missing fields" });
        continue;
      }

      // Evaluate condition (simple expression support)
      let passed;
      const condition = rule.condition || "";
      try {
        if (condition.includes(">") || condition.includes("<") || condition.includes("===") || condition.includes("!==")) {
          // Replace field references with values
          let expr = condition;
          for (const [f, v] of Object.entries(fieldValues)) {
            expr = expr.replace(new RegExp(`\\b${f}\\b`, "g"), JSON.stringify(v));
          }
          // Safe-ish eval for simple comparisons
          // eslint-disable-next-line no-new-func
          passed = Function(`"use strict"; return (${expr})`)();
        } else if (condition === "not_empty") {
          passed = ruleFields.every(f => fields[f] != null && fields[f] !== "");
        } else if (condition === "all_equal") {
          const vals = ruleFields.map(f => String(fields[f]));
          passed = vals.every(v => v === vals[0]);
        } else {
          passed = true; // unknown condition type
        }
      } catch (e) {
        passed = false;
      }

      ruleResults.push({
        rule: rule.rule,
        fields: ruleFields,
        status: passed ? "passed" : "failed",
      });

      if (!passed) {
        errors.push({
          field: ruleFields.join(", "),
          type: "consistency",
          message: `Consistency rule failed: ${rule.rule}`,
        });
      }
    }

    const totalFields = Object.keys(schemaFields).length;
    const validationScore = checkedCount > 0
      ? Math.round((validCount / checkedCount) * 100)
      : 100;

    return {
      ok: true,
      result: {
        entityId: entity.id,
        validationScore,
        valid: errors.length === 0,
        totalFields: totalFields,
        fieldsChecked: checkedCount,
        fieldsValid: validCount,
        errors: { count: errors.length, items: errors },
        warnings: { count: warnings.length, items: warnings },
        consistencyRules: { count: ruleResults.length, results: ruleResults },
        status: errors.length === 0 ? "valid" : errors.some(e => e.type === "required") ? "incomplete" : "invalid",
      },
    };
  });

  // ───────────────────────────────────────────────────────────────────────
  // Knowledge-graph workbench: per-user persistent entity/relationship store,
  // typed schemas, attribute provenance, path-finding, merge/split, and
  // CSV/JSON + Wikidata import.
  // ───────────────────────────────────────────────────────────────────────

  function getGraphState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.entityGraph) STATE.entityGraph = {};
    const s = STATE.entityGraph;
    for (const k of ["nodes", "edges", "schemas"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveGraphState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const gid = () => `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const userNodes = (s, u) => { if (!s.nodes.has(u)) s.nodes.set(u, []); return s.nodes.get(u); };
  const userEdges = (s, u) => { if (!s.edges.has(u)) s.edges.set(u, []); return s.edges.get(u); };
  const userSchemas = (s, u) => { if (!s.schemas.has(u)) s.schemas.set(u, []); return s.schemas.get(u); };

  /** graph-get — full per-user graph (nodes + edges + schemas). */
  registerLensAction("entity", "graph-get", (ctx, _a, _p = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    return {
      ok: true,
      result: {
        nodes: userNodes(s, u),
        edges: userEdges(s, u),
        schemas: userSchemas(s, u),
      },
    };
  });

  /** node-create — add an entity node. params: { name, entityType?, attributes?:{key:{value,source}} } */
  registerLensAction("entity", "node-create", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const nodes = userNodes(s, u);
    // attributes: { key: { value, source? } }
    const attributes = {};
    if (params.attributes && typeof params.attributes === "object") {
      for (const [k, raw] of Object.entries(params.attributes)) {
        if (raw && typeof raw === "object" && "value" in raw) {
          attributes[k] = { value: raw.value, source: String(raw.source || "manual"), at: Date.now() };
        } else {
          attributes[k] = { value: raw, source: "manual", at: Date.now() };
        }
      }
    }
    const node = {
      id: gid(),
      name,
      entityType: String(params.entityType || "generic"),
      attributes,
      wikidataId: params.wikidataId ? String(params.wikidataId) : null,
      createdAt: Date.now(),
    };
    nodes.push(node);
    saveGraphState();
    return { ok: true, result: { node } };
  });

  /** node-update — rename / retype / set attribute (with provenance). */
  registerLensAction("entity", "node-update", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const node = userNodes(s, u).find(n => n.id === params.id);
    if (!node) return { ok: false, error: "node not found" };
    if (params.name != null) node.name = String(params.name).trim() || node.name;
    if (params.entityType != null) node.entityType = String(params.entityType);
    if (params.attributeKey != null) {
      const key = String(params.attributeKey).trim();
      if (key) {
        if (params.deleteAttribute) {
          delete node.attributes[key];
        } else {
          node.attributes[key] = {
            value: params.attributeValue,
            source: String(params.attributeSource || "manual"),
            at: Date.now(),
          };
        }
      }
    }
    saveGraphState();
    return { ok: true, result: { node } };
  });

  /** node-delete — remove a node and all incident edges. */
  registerLensAction("entity", "node-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    const idx = nodes.findIndex(n => n.id === params.id);
    if (idx < 0) return { ok: false, error: "node not found" };
    nodes.splice(idx, 1);
    const edges = userEdges(s, u);
    const before = edges.length;
    s.edges.set(u, edges.filter(e => e.from !== params.id && e.to !== params.id));
    saveGraphState();
    return { ok: true, result: { deleted: params.id, edgesRemoved: before - s.edges.get(u).length } };
  });

  /** edge-create — link two nodes. params: { from, to, relType?, weight? } */
  registerLensAction("entity", "edge-create", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    if (!nodes.find(n => n.id === params.from)) return { ok: false, error: "from node not found" };
    if (!nodes.find(n => n.id === params.to)) return { ok: false, error: "to node not found" };
    if (params.from === params.to) return { ok: false, error: "self-edge not allowed" };
    const edges = userEdges(s, u);
    if (edges.find(e => e.from === params.from && e.to === params.to && e.relType === String(params.relType || "related"))) {
      return { ok: false, error: "edge already exists" };
    }
    const edge = {
      id: gid(),
      from: String(params.from),
      to: String(params.to),
      relType: String(params.relType || "related"),
      weight: Number(params.weight) || 1,
      createdAt: Date.now(),
    };
    edges.push(edge);
    saveGraphState();
    return { ok: true, result: { edge } };
  });

  /** edge-delete — remove an edge by id. */
  registerLensAction("entity", "edge-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const edges = userEdges(s, u);
    const idx = edges.findIndex(e => e.id === params.id);
    if (idx < 0) return { ok: false, error: "edge not found" };
    const [removed] = edges.splice(idx, 1);
    saveGraphState();
    return { ok: true, result: { deleted: removed.id } };
  });

  /** schema-list — list typed entity-class schemas for the user. */
  registerLensAction("entity", "schema-list", (ctx, _a, _p = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { schemas: userSchemas(s, aid(ctx)) } };
  });

  /** schema-save — create or update an entity-class schema.
   *  params: { id?, className, attributes:[{ name, type, required? }] } */
  registerLensAction("entity", "schema-save", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const className = String(params.className || "").trim();
    if (!className) return { ok: false, error: "className required" };
    const validTypes = ["string", "number", "integer", "boolean", "date", "url", "email"];
    const attributes = Array.isArray(params.attributes)
      ? params.attributes
          .map(a => ({
            name: String(a.name || "").trim(),
            type: validTypes.includes(a.type) ? a.type : "string",
            required: !!a.required,
          }))
          .filter(a => a.name)
      : [];
    const schemas = userSchemas(s, u);
    if (params.id) {
      const existing = schemas.find(sc => sc.id === params.id);
      if (!existing) return { ok: false, error: "schema not found" };
      existing.className = className;
      existing.attributes = attributes;
      existing.updatedAt = Date.now();
      saveGraphState();
      return { ok: true, result: { schema: existing } };
    }
    const schema = { id: gid(), className, attributes, createdAt: Date.now() };
    schemas.push(schema);
    saveGraphState();
    return { ok: true, result: { schema } };
  });

  /** schema-delete — remove a schema. */
  registerLensAction("entity", "schema-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const schemas = userSchemas(s, u);
    const idx = schemas.findIndex(sc => sc.id === params.id);
    if (idx < 0) return { ok: false, error: "schema not found" };
    schemas.splice(idx, 1);
    saveGraphState();
    return { ok: true, result: { deleted: params.id } };
  });

  /** node-merge — merge a source node into a target node, reconciling
   *  attributes (keeps target's value on conflict, fills gaps from source),
   *  rewiring all source edges onto the target, then deleting the source.
   *  params: { sourceId, targetId, fieldChoices?:{key:'source'|'target'} } */
  registerLensAction("entity", "node-merge", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    const source = nodes.find(n => n.id === params.sourceId);
    const target = nodes.find(n => n.id === params.targetId);
    if (!source || !target) return { ok: false, error: "source or target node not found" };
    if (source.id === target.id) return { ok: false, error: "cannot merge node into itself" };
    const choices = params.fieldChoices && typeof params.fieldChoices === "object" ? params.fieldChoices : {};
    const reconciled = [];
    for (const [key, srcAttr] of Object.entries(source.attributes || {})) {
      const tgtAttr = target.attributes[key];
      const pick = choices[key];
      if (!tgtAttr) {
        target.attributes[key] = { ...srcAttr };
        reconciled.push({ key, resolution: "filled_from_source" });
      } else if (pick === "source") {
        target.attributes[key] = { ...srcAttr };
        reconciled.push({ key, resolution: "chose_source" });
      } else {
        reconciled.push({ key, resolution: "kept_target" });
      }
    }
    // Rewire edges: any edge touching source now points at target.
    const edges = userEdges(s, u);
    let rewired = 0;
    for (const e of edges) {
      if (e.from === source.id) { e.from = target.id; rewired++; }
      if (e.to === source.id) { e.to = target.id; rewired++; }
    }
    // Drop self-edges and exact duplicates produced by the rewire.
    const seen = new Set();
    s.edges.set(u, edges.filter(e => {
      if (e.from === e.to) return false;
      const k = `${e.from}|${e.to}|${e.relType}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }));
    // Delete the source node.
    s.nodes.set(u, nodes.filter(n => n.id !== source.id));
    saveGraphState();
    return {
      ok: true,
      result: {
        merged: source.id,
        into: target.id,
        node: target,
        reconciled,
        edgesRewired: rewired,
      },
    };
  });

  /** node-split — split selected attributes off a node into a new node,
   *  linked back by a 'split_from' edge.
   *  params: { id, splitName, attributeKeys:[...], splitEntityType? } */
  registerLensAction("entity", "node-split", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    const node = nodes.find(n => n.id === params.id);
    if (!node) return { ok: false, error: "node not found" };
    const splitName = String(params.splitName || "").trim();
    if (!splitName) return { ok: false, error: "splitName required" };
    const keys = Array.isArray(params.attributeKeys) ? params.attributeKeys : [];
    const moved = {};
    for (const k of keys) {
      if (node.attributes[k]) {
        moved[k] = { ...node.attributes[k] };
        delete node.attributes[k];
      }
    }
    const newNode = {
      id: gid(),
      name: splitName,
      entityType: String(params.splitEntityType || node.entityType),
      attributes: moved,
      wikidataId: null,
      createdAt: Date.now(),
    };
    nodes.push(newNode);
    const edge = {
      id: gid(),
      from: node.id,
      to: newNode.id,
      relType: "split_from",
      weight: 1,
      createdAt: Date.now(),
    };
    userEdges(s, u).push(edge);
    saveGraphState();
    return {
      ok: true,
      result: { original: node, newNode, edge, attributesMoved: Object.keys(moved) },
    };
  });

  /** path-find — shortest path between two nodes (BFS, treats edges as
   *  undirected). params: { from, to } */
  registerLensAction("entity", "path-find", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    const fromNode = nodes.find(n => n.id === params.from);
    const toNode = nodes.find(n => n.id === params.to);
    if (!fromNode || !toNode) return { ok: false, error: "from or to node not found" };
    if (params.from === params.to) {
      return { ok: true, result: { found: true, hops: 0, path: [{ nodeId: fromNode.id, name: fromNode.name }] } };
    }
    const edges = userEdges(s, u);
    const adj = {};
    for (const e of edges) {
      (adj[e.from] = adj[e.from] || []).push({ to: e.to, relType: e.relType });
      (adj[e.to] = adj[e.to] || []).push({ to: e.from, relType: e.relType });
    }
    const prev = {};
    const prevRel = {};
    const visited = new Set([params.from]);
    const queue = [params.from];
    let found = false;
    while (queue.length) {
      const v = queue.shift();
      if (v === params.to) { found = true; break; }
      for (const { to, relType } of (adj[v] || [])) {
        if (!visited.has(to)) {
          visited.add(to);
          prev[to] = v;
          prevRel[to] = relType;
          queue.push(to);
        }
      }
    }
    if (!found) {
      return { ok: true, result: { found: false, hops: 0, path: [], reason: "no path exists" } };
    }
    const path = [];
    let cur = params.to;
    while (cur != null) {
      const node = nodes.find(n => n.id === cur);
      path.unshift({ nodeId: cur, name: node?.name || cur, relTypeIn: prevRel[cur] || null });
      cur = prev[cur];
    }
    return { ok: true, result: { found: true, hops: path.length - 1, path } };
  });

  /** import-bulk — bulk-create nodes from parsed CSV/JSON rows.
   *  params: { rows:[{ name, entityType?, ...attrs }], source? } */
  registerLensAction("entity", "import-bulk", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const rows = Array.isArray(params.rows) ? params.rows : [];
    if (rows.length === 0) return { ok: false, error: "no rows provided" };
    const source = String(params.source || "import");
    const nodes = userNodes(s, u);
    const created = [];
    const skipped = [];
    for (const row of rows.slice(0, 2000)) {
      if (!row || typeof row !== "object") { skipped.push({ reason: "not an object" }); continue; }
      const name = String(row.name || row.Name || row.label || "").trim();
      if (!name) { skipped.push({ reason: "missing name", row }); continue; }
      const entityType = String(row.entityType || row.type || "generic");
      const attributes = {};
      for (const [k, v] of Object.entries(row)) {
        if (["name", "Name", "label", "entityType", "type"].includes(k)) continue;
        if (v == null || v === "") continue;
        attributes[k] = { value: v, source, at: Date.now() };
      }
      const node = {
        id: gid(),
        name,
        entityType,
        attributes,
        wikidataId: null,
        createdAt: Date.now(),
      };
      nodes.push(node);
      created.push(node);
    }
    saveGraphState();
    return {
      ok: true,
      result: { createdCount: created.length, skippedCount: skipped.length, created, skipped: skipped.slice(0, 20) },
    };
  });

  /** import-wikidata — import a Wikidata entity (already fetched client-side
   *  or here) as a graph node with provenance set to 'wikidata'.
   *  params: { wikidataId, label, description?, claims?:{key:value} } */
  registerLensAction("entity", "import-wikidata", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const wikidataId = String(params.wikidataId || "").trim();
    const label = String(params.label || "").trim();
    if (!wikidataId || !label) return { ok: false, error: "wikidataId and label required" };
    const nodes = userNodes(s, u);
    const existing = nodes.find(n => n.wikidataId === wikidataId);
    if (existing) return { ok: false, error: "wikidata entity already imported", existingId: existing.id };
    const attributes = {};
    if (params.description) {
      attributes.description = { value: String(params.description), source: "wikidata", at: Date.now() };
    }
    if (params.claims && typeof params.claims === "object") {
      for (const [k, v] of Object.entries(params.claims)) {
        if (v == null || v === "") continue;
        attributes[k] = { value: v, source: "wikidata", at: Date.now() };
      }
    }
    const node = {
      id: gid(),
      name: label,
      entityType: String(params.entityType || "wikidata-entity"),
      attributes,
      wikidataId,
      createdAt: Date.now(),
    };
    nodes.push(node);
    saveGraphState();
    return { ok: true, result: { node } };
  });

  /** provenance-report — aggregate which source asserted each attribute
   *  value, across the whole user graph. */
  registerLensAction("entity", "provenance-report", (ctx, _a, _p = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = aid(ctx);
    const nodes = userNodes(s, u);
    const bySource = {};
    let totalAttributes = 0;
    const entries = [];
    for (const n of nodes) {
      for (const [key, attr] of Object.entries(n.attributes || {})) {
        const src = (attr && attr.source) || "unknown";
        bySource[src] = (bySource[src] || 0) + 1;
        totalAttributes++;
        entries.push({
          nodeId: n.id,
          nodeName: n.name,
          attribute: key,
          value: attr && "value" in attr ? attr.value : attr,
          source: src,
          at: (attr && attr.at) || null,
        });
      }
    }
    entries.sort((a, b) => (b.at || 0) - (a.at || 0));
    return {
      ok: true,
      result: {
        totalAttributes,
        sourceCount: Object.keys(bySource).length,
        bySource: Object.entries(bySource)
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count),
        entries: entries.slice(0, 100),
      },
    };
  });
}
