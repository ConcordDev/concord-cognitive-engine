// server/domains/transfer.js
// Domain actions for data/knowledge transfer: schema mapping, data quality
// assessment, and migration plan generation.

export default function registerTransferActions(registerLensAction) {
  /**
   * schemaMapping
   * Map fields between source and target schemas using Levenshtein similarity,
   * type compatibility, and hierarchical matching.
   * artifact.data.sourceSchema = [{ name, type?, path?, description?, required? }]
   * artifact.data.targetSchema = [{ name, type?, path?, description?, required? }]
   * params.similarityThreshold (default: 0.5)
   */
  registerLensAction("transfer", "schemaMapping", (ctx, artifact, params) => {
  try {
    const source = artifact.data?.sourceSchema || [];
    const target = artifact.data?.targetSchema || [];
    if (source.length === 0 || target.length === 0) {
      return { ok: false, error: "Both sourceSchema and targetSchema are required." };
    }

    const threshold = params.similarityThreshold || 0.5;
    const r = (v) => Math.round(v * 1000) / 1000;

    // Levenshtein distance
    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[m][n];
    }

    function levenshteinSimilarity(a, b) {
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) return 1;
      return 1 - levenshtein(a, b) / maxLen;
    }

    // Normalize field name for comparison
    function normalize(name) {
      return (name || "")
        .toLowerCase()
        .replace(/[_\-\s]+/g, "")
        .replace(/id$/i, "")
        .replace(/^(get|set|is|has)/i, "");
    }

    // Type compatibility scoring
    const typeGroups = {
      string: ["string", "text", "varchar", "char", "nvarchar"],
      number: ["number", "int", "integer", "float", "double", "decimal", "numeric", "bigint"],
      boolean: ["boolean", "bool", "bit"],
      date: ["date", "datetime", "timestamp", "time"],
      array: ["array", "list", "collection"],
      object: ["object", "map", "struct", "record"],
    };

    function typeCompatibility(t1, t2) {
      if (!t1 || !t2) return 0.5; // unknown types get neutral score
      const norm1 = (t1 || "").toLowerCase();
      const norm2 = (t2 || "").toLowerCase();
      if (norm1 === norm2) return 1;
      for (const group of Object.values(typeGroups)) {
        if (group.includes(norm1) && group.includes(norm2)) return 0.9;
      }
      return 0.1;
    }

    // Hierarchical path similarity
    function pathSimilarity(p1, p2) {
      if (!p1 || !p2) return 0;
      const parts1 = p1.split(/[./]/).map(normalize);
      const parts2 = p2.split(/[./]/).map(normalize);
      // Check if terminal segments match
      const termSim = levenshteinSimilarity(parts1[parts1.length - 1] || "", parts2[parts2.length - 1] || "");
      // Check parent path overlap
      let pathOverlap = 0;
      const minLen = Math.min(parts1.length, parts2.length);
      for (let i = 0; i < minLen; i++) {
        if (levenshteinSimilarity(parts1[i], parts2[i]) > 0.7) pathOverlap++;
      }
      const pathScore = minLen > 0 ? pathOverlap / Math.max(parts1.length, parts2.length) : 0;
      return termSim * 0.6 + pathScore * 0.4;
    }

    // Compute similarity matrix
    const mappings = [];
    const usedTargets = new Set();

    // Score all source-target pairs
    const allPairs = [];
    for (const s of source) {
      for (const t of target) {
        const nameSim = levenshteinSimilarity(normalize(s.name), normalize(t.name));
        const typeSim = typeCompatibility(s.type, t.type);
        const pathSim = pathSimilarity(s.path, t.path);

        // Combined score: weighted average
        const score = nameSim * 0.5 + typeSim * 0.3 + pathSim * 0.2;

        allPairs.push({
          source: s.name,
          target: t.name,
          nameSimilarity: r(nameSim),
          typeCompatibility: r(typeSim),
          pathSimilarity: r(pathSim),
          combinedScore: r(score),
          sourceType: s.type || "unknown",
          targetType: t.type || "unknown",
        });
      }
    }

    // Greedy best-match assignment
    allPairs.sort((a, b) => b.combinedScore - a.combinedScore);
    const usedSources = new Set();
    for (const pair of allPairs) {
      if (usedSources.has(pair.source) || usedTargets.has(pair.target)) continue;
      if (pair.combinedScore >= threshold) {
        mappings.push({
          ...pair,
          confidence: pair.combinedScore > 0.8 ? "high" : pair.combinedScore > 0.6 ? "medium" : "low",
          requiresTransform: pair.typeCompatibility < 0.9,
        });
        usedSources.add(pair.source);
        usedTargets.add(pair.target);
      }
    }

    // Unmapped fields
    const unmappedSource = source.filter(s => !usedSources.has(s.name)).map(s => ({
      name: s.name, type: s.type, required: s.required,
      bestCandidate: allPairs.filter(p => p.source === s.name).sort((a, b) => b.combinedScore - a.combinedScore)[0] || null,
    }));
    const unmappedTarget = target.filter(t => !usedTargets.has(t.name)).map(t => ({
      name: t.name, type: t.type, required: t.required,
    }));

    // Coverage metrics
    const mappedSourcePercent = source.length > 0 ? (usedSources.size / source.length) * 100 : 0;
    const mappedTargetPercent = target.length > 0 ? (usedTargets.size / target.length) * 100 : 0;
    const requiredTargetsMapped = target.filter(t => t.required).every(t => usedTargets.has(t.name));

    return {
      ok: true,
      result: {
        mappings,
        mappingCount: mappings.length,
        unmappedSource,
        unmappedTarget,
        coverage: {
          sourceFieldsMapped: r(mappedSourcePercent) + "%",
          targetFieldsMapped: r(mappedTargetPercent) + "%",
          allRequiredMapped: requiredTargetsMapped,
        },
        averageConfidence: r(mappings.length > 0 ? mappings.reduce((s, m) => s + m.combinedScore, 0) / mappings.length : 0),
        transformsRequired: mappings.filter(m => m.requiresTransform).length,
        threshold,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * dataQuality
   * Assess data quality for transfer — completeness, accuracy, consistency,
   * timeliness scoring with field-level breakdown.
   * artifact.data.records = [{ ...fields }]
   * artifact.data.schema = [{ name, type?, required?, pattern?, validValues?, maxAge? }]
   */
  registerLensAction("transfer", "dataQuality", (ctx, artifact, _params) => {
    const records = artifact.data?.records || [];
    const schema = artifact.data?.schema || [];
    if (records.length === 0) return { ok: false, error: "No records to assess." };

    const r = (v) => Math.round(v * 1000) / 1000;
    const n = records.length;

    // Detect all fields if schema not provided
    const allFields = new Set();
    for (const rec of records) {
      for (const key of Object.keys(rec)) allFields.add(key);
    }
    for (const s of schema) allFields.add(s.name);
    const fields = [...allFields];

    const schemaMap = {};
    for (const s of schema) schemaMap[s.name] = s;

    const fieldReports = {};
    let totalCompleteness = 0;
    let totalAccuracy = 0;
    let totalConsistency = 0;
    let fieldCount = 0;

    for (const field of fields) {
      const spec = schemaMap[field] || {};
      const values = records.map(rec => rec[field]);
      const nonNull = values.filter(v => v !== null && v !== undefined && v !== "");
      const nullCount = n - nonNull.length;

      // Completeness: fraction of non-null values
      const completeness = n > 0 ? nonNull.length / n : 0;

      // Accuracy: type checking and pattern/valid value matching
      let accurateCount = 0;
      for (const val of nonNull) {
        let isAccurate = true;

        // Type check
        if (spec.type) {
          const t = spec.type.toLowerCase();
          if (t === "number" || t === "int" || t === "integer" || t === "float") {
            if (isNaN(Number(val))) isAccurate = false;
          } else if (t === "boolean" || t === "bool") {
            if (typeof val !== "boolean" && val !== "true" && val !== "false" && val !== 0 && val !== 1) isAccurate = false;
          } else if (t === "date" || t === "datetime") {
            if (isNaN(new Date(val).getTime())) isAccurate = false;
          }
        }

        // Pattern check (regex)
        if (spec.pattern && isAccurate) {
          try {
            if (!new RegExp(spec.pattern).test(String(val))) isAccurate = false;
          } catch (e) { /* ignore invalid regex */ }
        }

        // Valid values check
        if (spec.validValues && isAccurate) {
          if (!spec.validValues.includes(val)) isAccurate = false;
        }

        if (isAccurate) accurateCount++;
      }
      const accuracy = nonNull.length > 0 ? accurateCount / nonNull.length : 1;

      // Consistency: check for inconsistent formats/casing within the field
      const stringVals = nonNull.filter(v => typeof v === "string").map(v => String(v));
      let consistency = 1;
      if (stringVals.length > 1) {
        // Check casing consistency
        const allUpper = stringVals.every(v => v === v.toUpperCase());
        const allLower = stringVals.every(v => v === v.toLowerCase());
        const allTitle = stringVals.every(v => v[0] === v[0].toUpperCase());
        const casingConsistent = allUpper || allLower || allTitle;

        // Check format consistency (e.g., all same length for codes)
        const lengths = stringVals.map(v => v.length);
        const lengthSet = new Set(lengths);
        const lengthConsistent = lengthSet.size <= Math.ceil(stringVals.length * 0.1) + 1;

        consistency = (casingConsistent ? 0.5 : 0) + (lengthConsistent ? 0.5 : 0);
      }

      // Uniqueness
      const uniqueValues = new Set(nonNull.map(v => JSON.stringify(v)));
      const uniqueness = nonNull.length > 0 ? uniqueValues.size / nonNull.length : 1;

      // Duplicate detection
      const duplicates = nonNull.length - uniqueValues.size;

      fieldReports[field] = {
        completeness: r(completeness),
        accuracy: r(accuracy),
        consistency: r(consistency),
        uniqueness: r(uniqueness),
        nullCount,
        duplicates,
        totalValues: n,
        nonNullValues: nonNull.length,
        isRequired: spec.required || false,
        qualityScore: r((completeness * 0.3 + accuracy * 0.3 + consistency * 0.2 + uniqueness * 0.2)),
      };

      totalCompleteness += completeness;
      totalAccuracy += accuracy;
      totalConsistency += consistency;
      fieldCount++;
    }

    const avgCompleteness = fieldCount > 0 ? totalCompleteness / fieldCount : 0;
    const avgAccuracy = fieldCount > 0 ? totalAccuracy / fieldCount : 0;
    const avgConsistency = fieldCount > 0 ? totalConsistency / fieldCount : 0;

    // Timeliness: check date fields for freshness
    let timeliness = null;
    const now = Date.now();
    for (const field of fields) {
      const spec = schemaMap[field] || {};
      if (spec.type === "date" || spec.type === "datetime") {
        const dates = records
          .map(rec => new Date(rec[field]).getTime())
          .filter(t => !isNaN(t));
        if (dates.length > 0) {
          const maxDate = Math.max(...dates);
          const ageMs = now - maxDate;
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          const maxAgeDays = spec.maxAge || 365;
          timeliness = {
            field,
            mostRecentDate: new Date(maxDate).toISOString(),
            ageDays: r(ageDays),
            maxAcceptableAgeDays: maxAgeDays,
            isFresh: ageDays <= maxAgeDays,
            score: r(Math.max(0, 1 - ageDays / maxAgeDays)),
          };
          break;
        }
      }
    }

    // Overall quality score
    const overallScore = avgCompleteness * 0.3 + avgAccuracy * 0.3 + avgConsistency * 0.2 + (timeliness?.score ?? 1) * 0.2;

    // Critical issues
    const criticalIssues = [];
    for (const [field, report] of Object.entries(fieldReports)) {
      if (report.isRequired && report.completeness < 1) {
        criticalIssues.push({ field, issue: "required_field_incomplete", completeness: report.completeness });
      }
      if (report.accuracy < 0.5) {
        criticalIssues.push({ field, issue: "low_accuracy", accuracy: report.accuracy });
      }
    }

    return {
      ok: true,
      result: {
        recordCount: n,
        fieldCount: fields.length,
        fieldReports,
        overallQuality: {
          completeness: r(avgCompleteness),
          accuracy: r(avgAccuracy),
          consistency: r(avgConsistency),
          timeliness: timeliness || { note: "No date fields to assess" },
          compositeScore: r(overallScore),
          grade: overallScore > 0.9 ? "A" : overallScore > 0.8 ? "B" : overallScore > 0.7 ? "C" : overallScore > 0.5 ? "D" : "F",
        },
        criticalIssues,
        transferReadiness: criticalIssues.length === 0 && overallScore > 0.7 ? "ready" : "needs_remediation",
      },
    };
  });

  /**
   * migrationPlan
   * Generate migration plan with dependency ordering (topological sort),
   * batch sizing, and rollback checkpoints.
   * artifact.data.entities = [{ id, name, size?, dependencies?: string[], priority? }]
   * params.batchSizeLimit (max records per batch, default: 1000)
   * params.checkpointInterval (batches between checkpoints, default: 5)
   */
  registerLensAction("transfer", "migrationPlan", (ctx, artifact, params) => {
  try {
    const entities = artifact.data?.entities || [];
    if (entities.length === 0) return { ok: false, error: "No entities to migrate." };

    const batchSizeLimit = params.batchSizeLimit || 1000;
    const checkpointInterval = params.checkpointInterval || 5;
    const r = (v) => Math.round(v * 1000) / 1000;

    // Build dependency graph
    const entityMap = {};
    const adj = {}; // entity -> dependencies
    for (const e of entities) {
      entityMap[e.id] = { ...e, size: e.size || 100, dependencies: e.dependencies || [], priority: e.priority || 5 };
      adj[e.id] = e.dependencies || [];
    }

    // Topological sort (Kahn's algorithm)
    const inDegree = {};
    for (const e of entities) inDegree[e.id] = 0;
    for (const e of entities) {
      for (const dep of (e.dependencies || [])) {
        if (inDegree[dep] !== undefined) {
          // dep must come before e, so e has an incoming edge from dep
        }
        inDegree[e.id] = (inDegree[e.id] || 0);
      }
    }
    // Recompute: count how many entities depend on each
    for (const e of entities) {
      for (const dep of (e.dependencies || [])) {
        // e depends on dep, so e has in-degree from dep
      }
    }
    // Proper in-degree: for each entity, count its dependencies that are in our set
    for (const e of entities) {
      inDegree[e.id] = (e.dependencies || []).filter(d => entityMap[d]).length;
    }

    const sorted = [];
    const queue = entities.filter(e => inDegree[e.id] === 0).map(e => e.id);
    // Sort queue by priority (lower = higher priority)
    queue.sort((a, b) => (entityMap[a].priority || 5) - (entityMap[b].priority || 5));

    const visited = new Set();
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      sorted.push(id);

      // Find entities that depend on this one
      for (const e of entities) {
        if (e.dependencies?.includes(id) && !visited.has(e.id)) {
          inDegree[e.id]--;
          if (inDegree[e.id] <= 0) {
            queue.push(e.id);
            queue.sort((a, b) => (entityMap[a].priority || 5) - (entityMap[b].priority || 5));
          }
        }
      }
    }

    // Detect circular dependencies
    const circularDeps = entities.filter(e => !visited.has(e.id)).map(e => e.id);
    if (circularDeps.length > 0) {
      // Still include them at the end with a warning
      for (const id of circularDeps) sorted.push(id);
    }

    // Batch sizing
    const batches = [];
    let currentBatch = { entities: [], totalSize: 0, batchNumber: 1 };

    for (const id of sorted) {
      const entity = entityMap[id];
      const size = entity.size;

      if (currentBatch.totalSize + size > batchSizeLimit && currentBatch.entities.length > 0) {
        batches.push(currentBatch);
        currentBatch = { entities: [], totalSize: 0, batchNumber: batches.length + 1 };
      }

      currentBatch.entities.push({
        id,
        name: entity.name,
        size,
        dependencies: entity.dependencies.filter(d => entityMap[d]),
      });
      currentBatch.totalSize += size;
    }
    if (currentBatch.entities.length > 0) batches.push(currentBatch);

    // Add rollback checkpoints
    const plan = [];
    let phase = 1;
    for (let i = 0; i < batches.length; i++) {
      plan.push({
        step: plan.length + 1,
        type: "migrate",
        batch: batches[i].batchNumber,
        entities: batches[i].entities.map(e => ({ id: e.id, name: e.name, size: e.size })),
        totalSize: batches[i].totalSize,
        phase,
      });

      if ((i + 1) % checkpointInterval === 0 || i === batches.length - 1) {
        plan.push({
          step: plan.length + 1,
          type: "checkpoint",
          description: `Rollback checkpoint after batch ${batches[i].batchNumber}`,
          entitiesMigrated: sorted.slice(0, batches.slice(0, i + 1).reduce((s, b) => s + b.entities.length, 0)).length,
          phase,
        });
        phase++;
      }
    }

    // Add validation step at end
    plan.push({
      step: plan.length + 1,
      type: "validate",
      description: "Validate all migrated entities for integrity and completeness",
      checks: ["referential_integrity", "record_count_match", "data_checksum", "constraint_validation"],
    });

    // Summary statistics
    const totalSize = entities.reduce((s, e) => s + (e.size || 100), 0);
    const totalBatches = batches.length;
    const totalCheckpoints = plan.filter(s => s.type === "checkpoint").length;

    // Dependency depth analysis. `inProgress` guards against circular
    // dependencies: a node currently on the recursion stack contributes depth 0
    // for the back-edge, so a true cycle (a→b→a) resolves to a bounded depth
    // instead of recursing until the call stack overflows (the plan promises to
    // "still produce a plan" for cycles — without this guard it threw instead).
    function depthOf(id, cache = {}, inProgress = new Set()) {
      if (cache[id] !== undefined) return cache[id];
      if (inProgress.has(id)) return 0; // cycle back-edge — don't recurse
      const deps = entityMap[id]?.dependencies?.filter(d => entityMap[d]) || [];
      if (deps.length === 0) { cache[id] = 0; return 0; }
      inProgress.add(id);
      const maxDepth = Math.max(...deps.map(d => depthOf(d, cache, inProgress)));
      inProgress.delete(id);
      cache[id] = maxDepth + 1;
      return cache[id];
    }
    const depths = sorted.map(id => ({ id, name: entityMap[id].name, depth: depthOf(id) }));
    const maxDepth = Math.max(...depths.map(d => d.depth), 0);

    // Critical path: entities with maximum dependency depth
    const criticalPath = depths.filter(d => d.depth === maxDepth);

    return {
      ok: true,
      result: {
        migrationOrder: sorted.map((id, i) => ({ order: i + 1, id, name: entityMap[id].name, size: entityMap[id].size, dependencyDepth: depthOf(id) })),
        plan,
        summary: {
          totalEntities: entities.length,
          totalSize,
          totalBatches,
          totalCheckpoints,
          totalPhases: phase - 1,
          batchSizeLimit,
          maxDependencyDepth: maxDepth,
        },
        criticalPath: criticalPath.map(d => d.name),
        circularDependencies: circularDeps.length > 0 ? { detected: true, entities: circularDeps } : { detected: false },
        estimatedSteps: plan.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ───────────────────────────────────────────────────────────────────────
  // 2026 ETL parity — Fivetran / Airbyte
  //
  // Real connectors (CSV / JSON / inline rows), a transformation pipeline
  // engine, scheduled / incremental sync with change-data-capture, a
  // persisted mapping editor, validation rules with row-level quarantine,
  // dry-run preview, a transfer run log, and schema drift detection.
  // All state is per-user, persisted via _concordSTATE.
  // ───────────────────────────────────────────────────────────────────────

  function getXferState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.transferLens) {
      STATE.transferLens = {
        connectors: new Map(), // userId -> Map<connectorId, connector>
        pipelines: new Map(),  // userId -> Map<pipelineId, pipeline>
        runs: new Map(),       // userId -> Array<run>
        snapshots: new Map(),  // userId -> Map<connectorId, schemaSnapshot>
      };
    }
    return STATE.transferLens;
  }
  function saveXferState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function xferActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function xferId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIso() { return new Date().toISOString(); }

  // ── Connector record helpers ──────────────────────────────────────────

  // Parse a CSV string into [{...}] rows. Handles quoted fields + commas.
  function parseCsv(text) {
    const rows = [];
    let cur = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || cur.length > 0) { cur.push(field); rows.push(cur); }
    if (rows.length === 0) return [];
    const header = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : null; });
      return obj;
    });
  }

  // Infer a field type from a sample of values.
  function inferType(values) {
    const sample = values.filter(v => v !== null && v !== undefined && v !== "").slice(0, 50);
    if (sample.length === 0) return "unknown";
    let allNum = true, allBool = true, allDate = true;
    for (const v of sample) {
      if (allNum && (typeof v === "number" || (!isNaN(Number(v)) && String(v).trim() !== ""))) { /* ok */ } else allNum = false;
      const sv = String(v).toLowerCase();
      if (!(typeof v === "boolean" || sv === "true" || sv === "false")) allBool = false;
      if (allDate && isNaN(new Date(v).getTime())) allDate = false;
    }
    if (allBool) return "boolean";
    if (allNum) return "number";
    if (allDate && !allNum) return "date";
    return "string";
  }

  // Derive a schema [{name,type}] from a set of rows.
  function deriveSchema(rows) {
    const fields = new Set();
    for (const row of rows) for (const k of Object.keys(row || {})) fields.add(k);
    return [...fields].map(name => ({
      name,
      type: inferType(rows.map(r => (r || {})[name])),
    }));
  }

  // Read raw rows out of a connector definition.
  function readConnectorRows(connector) {
    if (!connector) return [];
    if (connector.kind === "csv") return parseCsv(connector.payload || "");
    if (connector.kind === "json") {
      try {
        const parsed = JSON.parse(connector.payload || "[]");
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.rows) ? parsed.rows : [parsed]);
      } catch (_e) { return []; }
    }
    if (connector.kind === "inline") return Array.isArray(connector.rows) ? connector.rows : [];
    return [];
  }

  /**
   * connector-upsert — register or update a source/destination connector.
   * A connector is a real readable/writable endpoint: a CSV blob, a JSON
   * blob, or inline rows. params: { id?, name, role (source|destination),
   * kind (csv|json|inline), payload?, rows? }
   */
  registerLensAction("transfer", "connector-upsert", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "Connector name is required." };
      const role = params.role === "destination" ? "destination" : "source";
      const kind = ["csv", "json", "inline"].includes(params.kind) ? params.kind : "csv";
      if (!s.connectors.has(userId)) s.connectors.set(userId, new Map());
      const map = s.connectors.get(userId);
      const id = params.id && map.has(params.id) ? params.id : xferId("conn");
      const existing = map.get(id);
      const connector = {
        id, name, role, kind,
        payload: params.payload !== undefined ? String(params.payload) : (existing?.payload || ""),
        rows: Array.isArray(params.rows) ? params.rows : (existing?.rows || []),
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      // Probe the connector so the UI can show row/field counts immediately.
      const rows = readConnectorRows(connector);
      connector.schema = deriveSchema(rows);
      connector.rowCount = rows.length;
      map.set(id, connector);
      saveXferState();
      return { ok: true, result: { connector } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector-list — list this user's connectors.
   */
  registerLensAction("transfer", "connector-list", (ctx) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = s.connectors.get(xferActor(ctx));
      const connectors = map ? Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
      return {
        ok: true,
        result: {
          connectors,
          sources: connectors.filter(c => c.role === "source").length,
          destinations: connectors.filter(c => c.role === "destination").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector-read — actually read rows out of a connector (real connector).
   * params: { id, limit? }
   */
  registerLensAction("transfer", "connector-read", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = s.connectors.get(xferActor(ctx));
      const connector = map?.get(params.id);
      if (!connector) return { ok: false, error: "Connector not found." };
      const rows = readConnectorRows(connector);
      const limit = Math.max(1, Math.min(Number(params.limit) || 100, 1000));
      return {
        ok: true,
        result: {
          connectorId: connector.id,
          name: connector.name,
          kind: connector.kind,
          schema: deriveSchema(rows),
          rowCount: rows.length,
          rows: rows.slice(0, limit),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector-delete — remove a connector.
   */
  registerLensAction("transfer", "connector-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = s.connectors.get(xferActor(ctx));
      if (!map || !map.has(params.id)) return { ok: false, error: "Connector not found." };
      map.delete(params.id);
      saveXferState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Transformation engine ─────────────────────────────────────────────

  // Apply a single transform op to a value.
  function applyTransform(op, value, row) {
    switch (op.type) {
      case "rename": return value; // handled at field-mapping level
      case "cast": {
        if (value === null || value === undefined || value === "") return null;
        if (op.to === "number") { const n = Number(value); return isNaN(n) ? null : n; }
        if (op.to === "string") return String(value);
        if (op.to === "boolean") { const sv = String(value).toLowerCase(); return sv === "true" || sv === "1" || value === true || value === 1; }
        if (op.to === "date") { const d = new Date(value); return isNaN(d.getTime()) ? null : d.toISOString(); }
        return value;
      }
      case "uppercase": return value == null ? value : String(value).toUpperCase();
      case "lowercase": return value == null ? value : String(value).toLowerCase();
      case "trim": return value == null ? value : String(value).trim();
      case "default": return (value === null || value === undefined || value === "") ? op.value : value;
      case "concat": {
        const parts = (op.fields || []).map(f => row[f] ?? "");
        return parts.join(op.separator !== undefined ? op.separator : " ");
      }
      case "multiply": { const n = Number(value); return isNaN(n) ? value : n * Number(op.factor || 1); }
      case "replace": return value == null ? value : String(value).split(op.search || "").join(op.replacement || "");
      case "extract": {
        try { const m = String(value ?? "").match(new RegExp(op.pattern)); return m ? (m[1] ?? m[0]) : null; }
        catch (_e) { return value; }
      }
      default: return value;
    }
  }

  // Run a pipeline (mappings + transforms + derived columns) over rows.
  // Returns { output, derivedColumns } — no validation here.
  function runPipeline(pipeline, rows) {
    const mappings = pipeline.mappings || [];
    const derived = pipeline.derivedColumns || [];
    return rows.map(row => {
      const out = {};
      for (const m of mappings) {
        let v = row[m.source];
        for (const op of (m.transforms || [])) v = applyTransform(op, v, row);
        out[m.target || m.source] = v;
      }
      for (const d of derived) {
        let v = d.from ? row[d.from] : (d.constant !== undefined ? d.constant : null);
        for (const op of (d.transforms || [])) v = applyTransform(op, v, { ...row, ...out });
        out[d.name] = v;
      }
      return out;
    });
  }

  // Validate one transformed row against rules. Returns { passed, failures }.
  function validateRow(row, rules) {
    const failures = [];
    for (const rule of (rules || [])) {
      const v = row[rule.field];
      if (rule.type === "required" && (v === null || v === undefined || v === "")) {
        failures.push({ field: rule.field, rule: "required", message: `${rule.field} is required` });
      } else if (rule.type === "type" && v !== null && v !== undefined && v !== "") {
        let bad = false;
        if (rule.dataType === "number" && isNaN(Number(v))) bad = true;
        if (rule.dataType === "date" && isNaN(new Date(v).getTime())) bad = true;
        if (rule.dataType === "boolean" && typeof v !== "boolean" && !["true", "false"].includes(String(v).toLowerCase())) bad = true;
        if (bad) failures.push({ field: rule.field, rule: "type", message: `${rule.field} is not a valid ${rule.dataType}` });
      } else if (rule.type === "range" && v !== null && v !== undefined && v !== "") {
        const n = Number(v);
        if (!isNaN(n)) {
          if (rule.min !== undefined && n < rule.min) failures.push({ field: rule.field, rule: "range", message: `${rule.field} below min ${rule.min}` });
          if (rule.max !== undefined && n > rule.max) failures.push({ field: rule.field, rule: "range", message: `${rule.field} above max ${rule.max}` });
        }
      } else if (rule.type === "pattern" && v !== null && v !== undefined && v !== "") {
        try { if (!new RegExp(rule.pattern).test(String(v))) failures.push({ field: rule.field, rule: "pattern", message: `${rule.field} fails pattern` }); }
        catch (_e) { /* skip bad regex */ }
      } else if (rule.type === "enum" && v !== null && v !== undefined && v !== "") {
        if (!(rule.values || []).map(String).includes(String(v))) failures.push({ field: rule.field, rule: "enum", message: `${rule.field} not in allowed set` });
      }
    }
    return { passed: failures.length === 0, failures };
  }

  /**
   * pipeline-upsert — create or update a transfer pipeline. A pipeline ties
   * a source connector to a destination, with field mappings (each carrying
   * transforms), derived columns, validation rules, and a sync schedule.
   * params: { id?, name, sourceConnectorId, destConnectorId?, mappings?,
   *   derivedColumns?, validationRules?, schedule? }
   */
  registerLensAction("transfer", "pipeline-upsert", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "Pipeline name is required." };
      if (!params.sourceConnectorId) return { ok: false, error: "sourceConnectorId is required." };
      if (!s.pipelines.has(userId)) s.pipelines.set(userId, new Map());
      const map = s.pipelines.get(userId);
      const id = params.id && map.has(params.id) ? params.id : xferId("pipe");
      const existing = map.get(id);
      const sched = params.schedule || existing?.schedule || { mode: "manual" };
      const pipeline = {
        id, name,
        sourceConnectorId: params.sourceConnectorId,
        destConnectorId: params.destConnectorId || existing?.destConnectorId || null,
        mappings: Array.isArray(params.mappings) ? params.mappings : (existing?.mappings || []),
        derivedColumns: Array.isArray(params.derivedColumns) ? params.derivedColumns : (existing?.derivedColumns || []),
        validationRules: Array.isArray(params.validationRules) ? params.validationRules : (existing?.validationRules || []),
        schedule: {
          mode: ["manual", "interval", "incremental"].includes(sched.mode) ? sched.mode : "manual",
          intervalMinutes: Number(sched.intervalMinutes) || 60,
          cdcKey: sched.cdcKey || null, // change-data-capture cursor field
        },
        cdcCursor: existing?.cdcCursor || null,
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      map.set(id, pipeline);
      saveXferState();
      return { ok: true, result: { pipeline } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pipeline-list — list this user's pipelines with last-run summaries.
   */
  registerLensAction("transfer", "pipeline-list", (ctx) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const map = s.pipelines.get(userId);
      const runs = s.runs.get(userId) || [];
      const pipelines = map ? Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
      const withRuns = pipelines.map(p => {
        const pruns = runs.filter(r => r.pipelineId === p.id);
        const last = pruns[pruns.length - 1] || null;
        return {
          ...p,
          runCount: pruns.length,
          lastRun: last ? { id: last.id, startedAt: last.startedAt, status: last.status, rowsWritten: last.rowsWritten, rowsQuarantined: last.rowsQuarantined } : null,
        };
      });
      return { ok: true, result: { pipelines: withRuns } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pipeline-delete — remove a pipeline.
   */
  registerLensAction("transfer", "pipeline-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = s.pipelines.get(xferActor(ctx));
      if (!map || !map.has(params.id)) return { ok: false, error: "Pipeline not found." };
      map.delete(params.id);
      saveXferState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * mapping-suggest — auto-propose field mappings between a pipeline's
   * source connector and a target schema (reuses schemaMapping math).
   * For the drag-connect mapping editor's "auto-fill" button.
   * params: { pipelineId, targetSchema? } — targetSchema falls back to the
   * destination connector's inferred schema.
   */
  registerLensAction("transfer", "mapping-suggest", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const pipe = s.pipelines.get(userId)?.get(params.pipelineId);
      if (!pipe) return { ok: false, error: "Pipeline not found." };
      const connMap = s.connectors.get(userId);
      const src = connMap?.get(pipe.sourceConnectorId);
      if (!src) return { ok: false, error: "Source connector not found." };
      const srcSchema = src.schema || deriveSchema(readConnectorRows(src));
      let tgtSchema = Array.isArray(params.targetSchema) ? params.targetSchema : null;
      if (!tgtSchema && pipe.destConnectorId) {
        const dst = connMap?.get(pipe.destConnectorId);
        if (dst) tgtSchema = dst.schema || deriveSchema(readConnectorRows(dst));
      }
      // If no target schema, mirror the source (identity mapping).
      if (!tgtSchema || tgtSchema.length === 0) tgtSchema = srcSchema;

      function lev(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {for (let j = 1; j <= n; j++)
          {dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);}}
        return dp[m][n];
      }
      const norm = (x) => (x || "").toLowerCase().replace(/[_\-\s]+/g, "");
      const sim = (a, b) => { const ml = Math.max(a.length, b.length); return ml === 0 ? 1 : 1 - lev(a, b) / ml; };

      const usedTargets = new Set();
      const suggested = [];
      const pairs = [];
      for (const sf of srcSchema) {for (const tf of tgtSchema) {
        pairs.push({ source: sf.name, target: tf.name, srcType: sf.type, tgtType: tf.type, score: sim(norm(sf.name), norm(tf.name)) });
      }}
      pairs.sort((a, b) => b.score - a.score);
      const usedSrc = new Set();
      for (const p of pairs) {
        if (usedSrc.has(p.source) || usedTargets.has(p.target) || p.score < 0.4) continue;
        const transforms = [];
        if (p.srcType && p.tgtType && p.srcType !== p.tgtType && p.tgtType !== "unknown") {
          transforms.push({ type: "cast", to: p.tgtType });
        }
        suggested.push({ source: p.source, target: p.target, confidence: Math.round(p.score * 1000) / 1000, transforms });
        usedSrc.add(p.source);
        usedTargets.add(p.target);
      }
      return {
        ok: true,
        result: {
          mappings: suggested,
          sourceSchema: srcSchema,
          targetSchema: tgtSchema,
          unmappedSource: srcSchema.filter(f => !usedSrc.has(f.name)).map(f => f.name),
          unmappedTarget: tgtSchema.filter(f => !usedTargets.has(f.name)).map(f => f.name),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * dry-run — apply a pipeline's mappings/transforms/validation to a small
   * sample of source rows WITHOUT writing anything. For the preview panel.
   * params: { pipelineId, sampleSize? }
   */
  registerLensAction("transfer", "dry-run", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const pipe = s.pipelines.get(userId)?.get(params.pipelineId);
      if (!pipe) return { ok: false, error: "Pipeline not found." };
      const src = s.connectors.get(userId)?.get(pipe.sourceConnectorId);
      if (!src) return { ok: false, error: "Source connector not found." };
      const allRows = readConnectorRows(src);
      const sampleSize = Math.max(1, Math.min(Number(params.sampleSize) || 10, 50));
      const sample = allRows.slice(0, sampleSize);
      const transformed = runPipeline(pipe, sample);
      const preview = transformed.map((out, i) => {
        const v = validateRow(out, pipe.validationRules);
        return { sourceRow: sample[i], outputRow: out, passed: v.passed, failures: v.failures };
      });
      return {
        ok: true,
        result: {
          pipelineId: pipe.id,
          totalSourceRows: allRows.length,
          sampled: sample.length,
          preview,
          wouldPass: preview.filter(p => p.passed).length,
          wouldQuarantine: preview.filter(p => !p.passed).length,
          outputColumns: transformed[0] ? Object.keys(transformed[0]) : [],
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * run-sync — actually execute a pipeline: read source rows, transform,
   * validate, route good rows to the destination connector and bad rows to
   * quarantine. Honors incremental change-data-capture via schedule.cdcKey.
   * Records a run-log entry. params: { pipelineId, mode? (full|incremental) }
   */
  registerLensAction("transfer", "run-sync", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const pipe = s.pipelines.get(userId)?.get(params.pipelineId);
      if (!pipe) return { ok: false, error: "Pipeline not found." };
      const connMap = s.connectors.get(userId);
      const src = connMap?.get(pipe.sourceConnectorId);
      if (!src) return { ok: false, error: "Source connector not found." };

      const startedAt = nowIso();
      let allRows = readConnectorRows(src);
      const totalRead = allRows.length;

      // Incremental change-data-capture: only rows newer than the cursor.
      const incremental = params.mode === "incremental" || (pipe.schedule.mode === "incremental" && params.mode !== "full");
      const cdcKey = pipe.schedule.cdcKey;
      let nextCursor = pipe.cdcCursor;
      if (incremental && cdcKey) {
        const prev = pipe.cdcCursor;
        allRows = allRows.filter(r => {
          const cv = r[cdcKey];
          if (cv === undefined || cv === null) return true;
          if (prev === null || prev === undefined) return true;
          return String(cv) > String(prev);
        });
        for (const r of readConnectorRows(src)) {
          const cv = r[cdcKey];
          if (cv !== undefined && cv !== null && (nextCursor === null || String(cv) > String(nextCursor))) nextCursor = cv;
        }
      }

      // Transform + validate.
      const transformed = runPipeline(pipe, allRows);
      const written = [];
      const quarantined = [];
      transformed.forEach((out, i) => {
        const v = validateRow(out, pipe.validationRules);
        if (v.passed) written.push(out);
        else quarantined.push({ row: out, sourceRow: allRows[i], failures: v.failures });
      });

      // Route good rows to the destination connector (a real write).
      if (pipe.destConnectorId) {
        const dst = connMap?.get(pipe.destConnectorId);
        if (dst) {
          const existingDst = readConnectorRows(dst);
          const merged = existingDst.concat(written);
          if (dst.kind === "json") dst.payload = JSON.stringify(merged, null, 2);
          else if (dst.kind === "inline") dst.rows = merged;
          else if (dst.kind === "csv") {
            const cols = merged.length ? [...new Set(merged.flatMap(r => Object.keys(r)))] : [];
            const esc = (x) => { const sv = x == null ? "" : String(x); return /[",\n]/.test(sv) ? `"${sv.replace(/"/g, '""')}"` : sv; };
            dst.payload = [cols.join(",")].concat(merged.map(r => cols.map(c => esc(r[c])).join(","))).join("\n");
          }
          dst.schema = deriveSchema(merged);
          dst.rowCount = merged.length;
          dst.updatedAt = nowIso();
        }
      }

      if (incremental && cdcKey) pipe.cdcCursor = nextCursor;
      pipe.updatedAt = nowIso();

      const run = {
        id: xferId("run"),
        pipelineId: pipe.id,
        pipelineName: pipe.name,
        startedAt,
        finishedAt: nowIso(),
        mode: incremental && cdcKey ? "incremental" : "full",
        status: quarantined.length === 0 ? "success" : (written.length === 0 ? "failed" : "partial"),
        rowsRead: incremental && cdcKey ? totalRead : totalRead,
        rowsProcessed: allRows.length,
        rowsWritten: written.length,
        rowsQuarantined: quarantined.length,
        cdcCursor: pipe.cdcCursor,
        errors: quarantined.slice(0, 25).map(q => ({ failures: q.failures, sourceRow: q.sourceRow })),
        quarantineSample: quarantined.slice(0, 25),
      };
      if (!s.runs.has(userId)) s.runs.set(userId, []);
      const runs = s.runs.get(userId);
      runs.push(run);
      if (runs.length > 200) runs.splice(0, runs.length - 200);
      saveXferState();

      return {
        ok: true,
        result: {
          run,
          writtenSample: written.slice(0, 10),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * run-log — list past sync runs (transfer history with row counts/errors).
   * params: { pipelineId? } — filter to one pipeline if given.
   */
  registerLensAction("transfer", "run-log", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      let runs = (s.runs.get(xferActor(ctx)) || []).slice().reverse();
      if (params.pipelineId) runs = runs.filter(r => r.pipelineId === params.pipelineId);
      const totalRows = runs.reduce((a, r) => a + (r.rowsWritten || 0), 0);
      const totalQuarantined = runs.reduce((a, r) => a + (r.rowsQuarantined || 0), 0);
      return {
        ok: true,
        result: {
          runs,
          summary: {
            totalRuns: runs.length,
            successRuns: runs.filter(r => r.status === "success").length,
            partialRuns: runs.filter(r => r.status === "partial").length,
            failedRuns: runs.filter(r => r.status === "failed").length,
            totalRowsTransferred: totalRows,
            totalRowsQuarantined: totalQuarantined,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * schedule-due — return pipelines whose interval/incremental schedule is
   * due to run (cadence engine; the heartbeat/UI poller calls this then
   * fires run-sync). params: { now? } — ISO timestamp override for tests.
   */
  registerLensAction("transfer", "schedule-due", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const map = s.pipelines.get(userId);
      if (!map) return { ok: true, result: { due: [] } };
      const runs = s.runs.get(userId) || [];
      const nowMs = params.now ? new Date(params.now).getTime() : Date.now();
      const due = [];
      for (const p of map.values()) {
        if (p.schedule.mode === "manual") continue;
        const pruns = runs.filter(r => r.pipelineId === p.id);
        const last = pruns[pruns.length - 1];
        const lastMs = last ? new Date(last.finishedAt).getTime() : 0;
        const intervalMs = (p.schedule.intervalMinutes || 60) * 60 * 1000;
        if (nowMs - lastMs >= intervalMs) {
          due.push({
            pipelineId: p.id,
            name: p.name,
            mode: p.schedule.mode,
            lastRunAt: last ? last.finishedAt : null,
            overdueMinutes: Math.round((nowMs - lastMs - intervalMs) / 60000),
          });
        }
      }
      return { ok: true, result: { due, checkedAt: new Date(nowMs).toISOString() } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * schema-drift — compare a connector's CURRENT inferred schema against the
   * last saved snapshot; report added / removed / type-changed fields, then
   * update the snapshot. params: { connectorId }
   */
  registerLensAction("transfer", "schema-drift", (ctx, _artifact, params = {}) => {
    try {
      const s = getXferState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = xferActor(ctx);
      const conn = s.connectors.get(userId)?.get(params.connectorId);
      if (!conn) return { ok: false, error: "Connector not found." };
      const current = deriveSchema(readConnectorRows(conn));
      if (!s.snapshots.has(userId)) s.snapshots.set(userId, new Map());
      const snaps = s.snapshots.get(userId);
      const prev = snaps.get(conn.id);

      const curMap = new Map(current.map(f => [f.name, f.type]));
      let drift;
      if (!prev) {
        drift = {
          firstSnapshot: true,
          added: [], removed: [], typeChanged: [],
          hasDrift: false,
        };
      } else {
        const prevMap = new Map(prev.schema.map(f => [f.name, f.type]));
        const added = [...curMap.keys()].filter(k => !prevMap.has(k)).map(k => ({ field: k, type: curMap.get(k) }));
        const removed = [...prevMap.keys()].filter(k => !curMap.has(k)).map(k => ({ field: k, type: prevMap.get(k) }));
        const typeChanged = [...curMap.keys()].filter(k => prevMap.has(k) && prevMap.get(k) !== curMap.get(k))
          .map(k => ({ field: k, from: prevMap.get(k), to: curMap.get(k) }));
        drift = {
          firstSnapshot: false,
          comparedAgainst: prev.capturedAt,
          added, removed, typeChanged,
          hasDrift: added.length + removed.length + typeChanged.length > 0,
        };
      }
      // Update the snapshot to current.
      snaps.set(conn.id, { schema: current, capturedAt: nowIso() });
      saveXferState();
      return { ok: true, result: { connectorId: conn.id, currentSchema: current, drift } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
