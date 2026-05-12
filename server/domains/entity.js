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
}
