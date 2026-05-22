// server/domains/importdomain.js
// Domain actions for import: validate imports, map fields, detect duplicates, transform preview.
// File named importdomain.js to avoid JS keyword conflict; domain registered as "import".

export default function registerImportActions(registerLensAction) {
  /**
   * validateImport
   * Check required fields, data types, and detect malformed rows.
   * artifact.data.rows: [{ ... }]
   * artifact.data.schema: { fieldName: { type: "string"|"number"|"boolean"|"date", required?: boolean } }
   */
  registerLensAction("import", "validateImport", (ctx, artifact, _params) => {
    const rows = artifact.data?.rows || [];
    const schema = artifact.data?.schema || {};

    if (rows.length === 0) {
      return { ok: true, result: { message: "No rows provided. Supply artifact.data.rows as an array of objects and artifact.data.schema as { fieldName: { type, required? } }.", valid: 0, invalid: 0, errors: [] } };
    }

    const schemaFields = Object.keys(schema);
    const requiredFields = schemaFields.filter((f) => schema[f].required);

    // Type checking helpers
    function checkType(value, expectedType) {
      if (value === null || value === undefined || value === "") return { valid: false, reason: "empty" };
      switch (expectedType) {
        case "string":
          return { valid: typeof value === "string" || typeof value === "number", reason: typeof value !== "string" && typeof value !== "number" ? `expected string, got ${typeof value}` : null };
        case "number": {
          const num = Number(value);
          return { valid: !isNaN(num) && value !== "" && value !== null, reason: isNaN(Number(value)) ? `"${value}" is not a valid number` : null };
        }
        case "boolean": {
          const boolVals = new Set(["true", "false", "1", "0", "yes", "no"]);
          const isValid = typeof value === "boolean" || boolVals.has(String(value).toLowerCase());
          return { valid: isValid, reason: isValid ? null : `"${value}" is not a valid boolean` };
        }
        case "date": {
          const d = new Date(value);
          const isValid = !isNaN(d.getTime()) && String(value).trim().length > 0;
          return { valid: isValid, reason: isValid ? null : `"${value}" is not a valid date` };
        }
        default:
          return { valid: true, reason: null };
      }
    }

    let validCount = 0;
    let invalidCount = 0;
    const allErrors = [];
    const fieldErrorCounts = {};
    const rowsChecked = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowErrors = [];

      // Check if row is actually an object
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        rowErrors.push({ field: "_row", error: "Row is not a valid object", value: row });
        invalidCount++;
        allErrors.push({ rowIndex: i, errors: rowErrors });
        continue;
      }

      // Check required fields
      for (const field of requiredFields) {
        if (row[field] === undefined || row[field] === null || row[field] === "") {
          rowErrors.push({ field, error: "required field missing", value: row[field] ?? null });
          fieldErrorCounts[field] = (fieldErrorCounts[field] || 0) + 1;
        }
      }

      // Check types for all schema fields present
      for (const field of schemaFields) {
        if (row[field] !== undefined && row[field] !== null && row[field] !== "") {
          const typeCheck = checkType(row[field], schema[field].type);
          if (!typeCheck.valid && typeCheck.reason !== "empty") {
            rowErrors.push({ field, error: `type mismatch: ${typeCheck.reason}`, value: row[field] });
            fieldErrorCounts[field] = (fieldErrorCounts[field] || 0) + 1;
          }
        }
      }

      // Detect extra fields not in schema
      if (schemaFields.length > 0) {
        for (const key of Object.keys(row)) {
          if (!schema[key]) {
            rowErrors.push({ field: key, error: "unexpected field not in schema", value: row[key] });
          }
        }
      }

      if (rowErrors.length > 0) {
        invalidCount++;
        allErrors.push({ rowIndex: i, errors: rowErrors });
      } else {
        validCount++;
      }

      rowsChecked.push({
        rowIndex: i,
        isValid: rowErrors.length === 0,
        errorCount: rowErrors.length,
      });
    }

    // Summary of field-level issues
    const fieldSummary = Object.entries(fieldErrorCounts)
      .map(([field, count]) => ({
        field,
        errorCount: count,
        errorRate: Math.round((count / rows.length) * 10000) / 100,
      }))
      .sort((a, b) => b.errorCount - a.errorCount);

    const validationRate = Math.round((validCount / rows.length) * 10000) / 100;

    const result = {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      validationRate,
      status: invalidCount === 0 ? "pass" : invalidCount / rows.length < 0.1 ? "warning" : "fail",
      fieldSummary,
      errors: allErrors.slice(0, 50),
      errorsTruncated: allErrors.length > 50,
      totalErrorCount: allErrors.reduce((s, e) => s + e.errors.length, 0),
    };

    artifact.data.validationResult = result;
    return { ok: true, result };
  });

  /**
   * mapFields
   * Suggest source-to-target field mappings using name similarity.
   * artifact.data.sourceFields: [string]
   * artifact.data.targetFields: [string]
   */
  registerLensAction("import", "mapFields", (ctx, artifact, _params) => {
    const sourceFields = artifact.data?.sourceFields || [];
    const targetFields = artifact.data?.targetFields || [];

    if (sourceFields.length === 0 || targetFields.length === 0) {
      return { ok: true, result: { message: "Provide artifact.data.sourceFields and artifact.data.targetFields as arrays of field name strings.", mappings: [], unmapped: [] } };
    }

    // Normalize a field name for comparison
    function normalize(name) {
      return String(name)
        .toLowerCase()
        .replace(/[_\-\s.]+/g, "")
        .replace(/[^a-z0-9]/g, "");
    }

    // Tokenize a field name into words
    function tokenize(name) {
      return String(name)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[_\-\s.]+/)
        .filter((t) => t.length > 0);
    }

    // Levenshtein distance
    function levenshtein(a, b) {
      const m = a.length;
      const n = b.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
        }
      }
      return dp[m][n];
    }

    // Compute similarity score between two field names (0-1)
    function similarity(source, target) {
      const normS = normalize(source);
      const normT = normalize(target);

      // Exact match after normalization
      if (normS === normT) return 1.0;

      // Prefix/suffix match
      const prefixLen = Math.min(normS.length, normT.length);
      let prefixMatch = 0;
      for (let i = 0; i < prefixLen; i++) {
        if (normS[i] === normT[i]) prefixMatch++;
        else break;
      }
      const prefixScore = prefixMatch / Math.max(normS.length, normT.length, 1);

      // Containment
      const containsScore = normS.includes(normT) || normT.includes(normS) ? 0.7 : 0;

      // Levenshtein similarity
      const maxLen = Math.max(normS.length, normT.length, 1);
      const editDist = levenshtein(normS, normT);
      const editScore = 1 - editDist / maxLen;

      // Token overlap (Jaccard-like)
      const tokensS = new Set(tokenize(source));
      const tokensT = new Set(tokenize(target));
      let tokenOverlap = 0;
      for (const t of tokensS) {
        if (tokensT.has(t)) tokenOverlap++;
      }
      const tokenUnion = new Set([...tokensS, ...tokensT]).size;
      const tokenScore = tokenUnion > 0 ? tokenOverlap / tokenUnion : 0;

      // Weighted combination
      return Math.round(Math.max(
        editScore * 0.4 + tokenScore * 0.3 + prefixScore * 0.2 + containsScore * 0.1,
        containsScore,
        tokenScore
      ) * 10000) / 10000;
    }

    // Compute all pairwise similarities
    const scoreboard = [];
    for (const src of sourceFields) {
      for (const tgt of targetFields) {
        const score = similarity(src, tgt);
        scoreboard.push({ source: src, target: tgt, score });
      }
    }
    scoreboard.sort((a, b) => b.score - a.score);

    // Greedy assignment: pick best score, remove both source and target, repeat
    const usedSources = new Set();
    const usedTargets = new Set();
    const mappings = [];

    for (const entry of scoreboard) {
      if (usedSources.has(entry.source) || usedTargets.has(entry.target)) continue;
      if (entry.score < 0.2) continue; // threshold for minimum acceptable similarity
      mappings.push({
        source: entry.source,
        target: entry.target,
        confidence: entry.score,
        confidenceLabel: entry.score >= 0.9 ? "exact" : entry.score >= 0.7 ? "high" : entry.score >= 0.5 ? "medium" : "low",
      });
      usedSources.add(entry.source);
      usedTargets.add(entry.target);
    }

    const unmappedSources = sourceFields.filter((f) => !usedSources.has(f));
    const unmappedTargets = targetFields.filter((f) => !usedTargets.has(f));

    // For unmapped sources, show best partial matches
    const suggestions = unmappedSources.map((src) => {
      const best = scoreboard
        .filter((s) => s.source === src && !usedTargets.has(s.target))
        .slice(0, 3)
        .map((s) => ({ target: s.target, score: s.score }));
      return { source: src, possibleTargets: best };
    });

    const result = {
      mappingCount: mappings.length,
      mappings,
      unmappedSources,
      unmappedTargets,
      suggestions,
      coverage: {
        sourcesCovered: Math.round((usedSources.size / sourceFields.length) * 10000) / 100,
        targetsCovered: Math.round((usedTargets.size / targetFields.length) * 10000) / 100,
      },
      averageConfidence: mappings.length > 0
        ? Math.round((mappings.reduce((s, m) => s + m.confidence, 0) / mappings.length) * 10000) / 10000
        : 0,
    };

    artifact.data.fieldMappings = result;
    return { ok: true, result };
  });

  /**
   * detectDuplicates
   * Find duplicate rows by key fields using hash comparison.
   * artifact.data.rows: [{ ... }]
   * artifact.data.keyFields: [string] (fields to compare for uniqueness)
   * artifact.data.fuzzy: boolean (optional, use normalized comparison)
   */
  registerLensAction("import", "detectDuplicates", (ctx, artifact, _params) => {
    const rows = artifact.data?.rows || [];
    const keyFields = artifact.data?.keyFields || [];
    const fuzzy = artifact.data?.fuzzy || false;

    if (rows.length === 0) {
      return { ok: true, result: { message: "No rows provided. Supply artifact.data.rows and artifact.data.keyFields (array of field names to check for uniqueness).", duplicates: [], uniqueCount: 0 } };
    }

    // If no key fields specified, use all fields from the first row
    const effectiveKeys = keyFields.length > 0 ? keyFields : Object.keys(rows[0] || {});

    if (effectiveKeys.length === 0) {
      return { ok: true, result: { message: "No key fields could be determined. Supply artifact.data.keyFields.", duplicates: [], uniqueCount: 0 } };
    }

    // Build hash for each row
    function normalizeValue(val) {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (fuzzy) {
        return str.toLowerCase().trim().replace(/\s+/g, " ");
      }
      return str;
    }

    function hashRow(row) {
      return effectiveKeys.map((k) => normalizeValue(row[k])).join("|||");
    }

    // Group rows by hash
    const hashMap = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (typeof row !== "object" || row === null) continue;
      const hash = hashRow(row);
      if (!hashMap[hash]) hashMap[hash] = [];
      hashMap[hash].push(i);
    }

    // Find groups with more than one row
    const duplicateGroups = [];
    let duplicateRowCount = 0;
    let uniqueCount = 0;

    for (const [hash, indices] of Object.entries(hashMap)) {
      if (indices.length > 1) {
        const keyValues = {};
        for (const k of effectiveKeys) {
          keyValues[k] = rows[indices[0]][k];
        }
        duplicateGroups.push({
          keyValues,
          count: indices.length,
          rowIndices: indices,
          firstOccurrence: indices[0],
          duplicateIndices: indices.slice(1),
        });
        duplicateRowCount += indices.length - 1; // excess copies
      } else {
        uniqueCount++;
      }
    }

    // Sort by count descending
    duplicateGroups.sort((a, b) => b.count - a.count);

    // Field-level analysis: which fields have the most repeated values
    const fieldRepetition = effectiveKeys.map((field) => {
      const values = {};
      for (const row of rows) {
        if (typeof row !== "object" || row === null) continue;
        const val = normalizeValue(row[field]);
        values[val] = (values[val] || 0) + 1;
      }
      const uniqueValues = Object.keys(values).length;
      const maxRepeat = Math.max(0, ...Object.values(values));
      return {
        field,
        uniqueValues,
        uniquenessRatio: rows.length > 0 ? Math.round((uniqueValues / rows.length) * 10000) / 100 : 0,
        mostRepeatedCount: maxRepeat,
      };
    });

    const result = {
      totalRows: rows.length,
      uniqueRows: uniqueCount + duplicateGroups.length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateRowCount,
      deduplicationSavings: rows.length > 0 ? Math.round((duplicateRowCount / rows.length) * 10000) / 100 : 0,
      keyFields: effectiveKeys,
      fuzzyMatching: fuzzy,
      duplicateGroups: duplicateGroups.slice(0, 50),
      groupsTruncated: duplicateGroups.length > 50,
      fieldRepetition,
    };

    artifact.data.duplicateDetection = result;
    return { ok: true, result };
  });

  /**
   * transformPreview
   * Show first N rows with applied transformations like type coercion, trimming.
   * artifact.data.rows: [{ ... }]
   * artifact.data.transforms: [{ field, operation, ... }]
   *   operations: "trim", "lowercase", "uppercase", "toNumber", "toDate", "replace", "default", "truncate"
   * artifact.data.previewCount: number (default 5)
   */
  // ---------------------------------------------------------------------------
  // Per-user STATE substrate for parity macros (sessions, templates, connectors,
  // schedules, rollback snapshots). Keyed by ctx.userId in globalThis._concordSTATE.
  // ---------------------------------------------------------------------------
  function getImportState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.importLens) {
      STATE.importLens = {
        sessions: new Map(),   // userId -> Array<importSession>
        templates: new Map(),  // userId -> Array<mappingTemplate>
        connectors: new Map(), // userId -> Array<connector>
        schedules: new Map(),  // userId -> Array<schedule>
        snapshots: new Map(),  // userId -> Array<rollbackSnapshot>
      };
    }
    const s = STATE.importLens;
    if (!s.sessions) s.sessions = new Map();
    if (!s.templates) s.templates = new Map();
    if (!s.connectors) s.connectors = new Map();
    if (!s.schedules) s.schedules = new Map();
    if (!s.snapshots) s.snapshots = new Map();
    return s;
  }
  function importActId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function importList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function importNextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function importNowIso() { return new Date().toISOString(); }
  function importSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("import", "transformPreview", (ctx, artifact, _params) => {
    const rows = artifact.data?.rows || [];
    const transforms = artifact.data?.transforms || [];
    const previewCount = Math.min(parseInt(artifact.data?.previewCount) || 5, rows.length);

    if (rows.length === 0) {
      return { ok: true, result: { message: "No rows provided. Supply artifact.data.rows and artifact.data.transforms as [{ field, operation, ... }].", preview: [], transformsApplied: 0 } };
    }

    if (transforms.length === 0) {
      return { ok: true, result: { message: "No transforms specified. Supply artifact.data.transforms as [{ field, operation }]. Supported: trim, lowercase, uppercase, toNumber, toDate, replace, default, truncate.", preview: rows.slice(0, previewCount), transformsApplied: 0 } };
    }

    // Apply transforms to each row
    let totalTransformations = 0;
    let errorCount = 0;
    const transformLog = [];

    function applyTransform(value, transform) {
      const op = transform.operation;
      try {
        switch (op) {
          case "trim":
            return typeof value === "string" ? value.trim() : value;
          case "lowercase":
            return typeof value === "string" ? value.toLowerCase() : value;
          case "uppercase":
            return typeof value === "string" ? value.toUpperCase() : value;
          case "toNumber": {
            if (value === null || value === undefined || value === "") return transform.defaultValue !== undefined ? transform.defaultValue : null;
            const num = Number(value);
            return isNaN(num) ? (transform.defaultValue !== undefined ? transform.defaultValue : value) : num;
          }
          case "toDate": {
            if (!value) return null;
            const d = new Date(value);
            return isNaN(d.getTime()) ? value : d.toISOString();
          }
          case "replace": {
            if (typeof value !== "string") return value;
            const pattern = transform.pattern || "";
            const replacement = transform.replacement || "";
            if (transform.regex) {
              return value.replace(new RegExp(pattern, "g"), replacement);
            }
            return value.split(pattern).join(replacement);
          }
          case "default":
            return (value === null || value === undefined || value === "") ? transform.defaultValue : value;
          case "truncate": {
            const maxLen = parseInt(transform.maxLength) || 100;
            return typeof value === "string" && value.length > maxLen ? value.slice(0, maxLen) + "..." : value;
          }
          default:
            return value;
        }
      } catch (err) {
        errorCount++;
        return value;
      }
    }

    const allTransformed = rows.map((row, rowIdx) => {
      if (typeof row !== "object" || row === null) return row;
      const transformed = { ...row };
      for (const transform of transforms) {
        const field = transform.field;
        if (field && transformed[field] !== undefined) {
          const before = transformed[field];
          transformed[field] = applyTransform(transformed[field], transform);
          if (before !== transformed[field]) {
            totalTransformations++;
            if (rowIdx < previewCount) {
              transformLog.push({
                rowIndex: rowIdx,
                field,
                operation: transform.operation,
                before,
                after: transformed[field],
              });
            }
          }
        } else if (field && transform.operation === "default" && (transformed[field] === undefined || transformed[field] === null || transformed[field] === "")) {
          transformed[field] = transform.defaultValue;
          totalTransformations++;
          if (rowIdx < previewCount) {
            transformLog.push({
              rowIndex: rowIdx,
              field,
              operation: "default",
              before: transformed[field],
              after: transform.defaultValue,
            });
          }
        }
      }
      return transformed;
    });

    // Compute diff summary: how many values changed per field
    const fieldChangeCounts = {};
    for (let i = 0; i < rows.length; i++) {
      const original = rows[i];
      const transformed = allTransformed[i];
      if (typeof original !== "object" || typeof transformed !== "object") continue;
      for (const key of Object.keys(transformed)) {
        if (original[key] !== transformed[key]) {
          fieldChangeCounts[key] = (fieldChangeCounts[key] || 0) + 1;
        }
      }
    }

    const fieldImpact = Object.entries(fieldChangeCounts).map(([field, count]) => ({
      field,
      changedRows: count,
      changeRate: Math.round((count / rows.length) * 10000) / 100,
    })).sort((a, b) => b.changedRows - a.changedRows);

    const result = {
      totalRows: rows.length,
      previewCount,
      preview: allTransformed.slice(0, previewCount),
      originalPreview: rows.slice(0, previewCount),
      transformsApplied: transforms.length,
      totalValueChanges: totalTransformations,
      transformErrors: errorCount,
      changeLog: transformLog,
      fieldImpact,
    };

    artifact.data.transformPreview = result;
    return { ok: true, result };
  });

  // ===========================================================================
  // PARITY BACKLOG MACROS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // [M] Schema inference + auto-suggest target fields.
  // params.rows: [{...}]  — infers per-column type, nullability, sample values.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "inferSchema", (ctx, artifact, params) => {
    const rows = params.rows || artifact.data?.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, result: { message: "No rows yet. Supply params.rows as an array of objects to infer a schema.", fields: [], rowCount: 0 } };
    }
    const objRows = rows.filter((r) => r && typeof r === "object" && !Array.isArray(r));
    if (objRows.length === 0) {
      return { ok: false, error: "rows contain no valid objects" };
    }
    const colNames = new Set();
    for (const r of objRows) for (const k of Object.keys(r)) colNames.add(k);

    function classify(value) {
      if (value === null || value === undefined || value === "") return "empty";
      if (typeof value === "boolean") return "boolean";
      const str = String(value).trim();
      if (/^(true|false|yes|no)$/i.test(str)) return "boolean";
      if (str !== "" && !isNaN(Number(str))) return Number.isInteger(Number(str)) ? "integer" : "number";
      if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(str) || (!isNaN(new Date(str).getTime()) && /[-/:]/.test(str) && str.length >= 6)) return "date";
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str)) return "email";
      if (/^https?:\/\//i.test(str)) return "url";
      return "string";
    }

    const fields = [];
    for (const col of colNames) {
      const typeCounts = {};
      let nonEmpty = 0;
      let nullCount = 0;
      const samples = [];
      const seen = new Set();
      for (const r of objRows) {
        const v = r[col];
        const t = classify(v);
        if (t === "empty") { nullCount++; continue; }
        nonEmpty++;
        typeCounts[t] = (typeCounts[t] || 0) + 1;
        const sv = String(v);
        if (samples.length < 3 && !seen.has(sv)) { samples.push(v); seen.add(sv); }
      }
      // Dominant type — integer collapses into number, email/url collapse into string for the target.
      let dominant = "string";
      let max = -1;
      for (const [t, c] of Object.entries(typeCounts)) {
        if (c > max) { max = c; dominant = t; }
      }
      const baseType = dominant === "integer" ? "number" : (dominant === "email" || dominant === "url") ? "string" : dominant;
      const confidence = nonEmpty > 0 ? Math.round((max / nonEmpty) * 10000) / 10000 : 0;
      // Auto-suggest a snake_case target field name.
      const suggestedTarget = String(col)
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[\s.-]+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      fields.push({
        source: col,
        suggestedTarget: suggestedTarget || col,
        inferredType: baseType,
        semanticHint: dominant === "email" || dominant === "url" ? dominant : null,
        confidence,
        nullable: nullCount > 0,
        nullRate: Math.round((nullCount / objRows.length) * 10000) / 100,
        required: nullCount === 0,
        uniqueSamples: samples,
      });
    }
    fields.sort((a, b) => a.source.localeCompare(b.source));
    const result = {
      rowCount: objRows.length,
      fieldCount: fields.length,
      fields,
      schema: Object.fromEntries(fields.map((f) => [f.suggestedTarget, { type: f.inferredType, required: f.required }])),
    };
    return { ok: true, result };
  });

  // ---------------------------------------------------------------------------
  // [M] Interactive in-grid error correction.
  // Persists an editable correction session; row patches commit before import.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "startCorrectionSession", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const rows = params.rows || [];
    const schema = params.schema || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "params.rows must be a non-empty array" };
    }
    const userId = importActId(ctx);
    const sessions = importList(s.sessions, userId);
    const session = {
      id: importNextId("imps"),
      name: String(params.name || `Correction ${sessions.length + 1}`),
      schema,
      rows: rows.map((r, i) => ({ rowIndex: i, original: r, current: { ...r }, corrected: false })),
      createdAt: importNowIso(),
      updatedAt: importNowIso(),
      committed: false,
    };
    sessions.unshift(session);
    importSave();
    return { ok: true, result: { session: summarizeSession(session) } };
  });

  registerLensAction("import", "listCorrectionSessions", (ctx) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = importList(s.sessions, importActId(ctx));
    return { ok: true, result: { sessions: sessions.map(summarizeSession), count: sessions.length } };
  });

  registerLensAction("import", "getCorrectionSession", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = importList(s.sessions, importActId(ctx));
    const session = sessions.find((x) => x.id === params.id);
    if (!session) return { ok: false, error: "session not found" };
    return { ok: true, result: { session, validation: validateSessionRows(session) } };
  });

  registerLensAction("import", "correctCell", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = importList(s.sessions, importActId(ctx));
    const session = sessions.find((x) => x.id === params.id);
    if (!session) return { ok: false, error: "session not found" };
    if (session.committed) return { ok: false, error: "session already committed" };
    const rowIndex = Number(params.rowIndex);
    const field = params.field;
    if (!Number.isInteger(rowIndex) || !field) return { ok: false, error: "rowIndex and field required" };
    const row = session.rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return { ok: false, error: "row not found" };
    row.current = { ...row.current, [field]: params.value };
    row.corrected = JSON.stringify(row.current) !== JSON.stringify(row.original);
    session.updatedAt = importNowIso();
    importSave();
    return { ok: true, result: { row, validation: validateSessionRows(session) } };
  });

  registerLensAction("import", "commitCorrectionSession", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = importList(s.sessions, importActId(ctx));
    const session = sessions.find((x) => x.id === params.id);
    if (!session) return { ok: false, error: "session not found" };
    if (session.committed) return { ok: false, error: "session already committed" };
    const validation = validateSessionRows(session);
    if (validation.invalidRows > 0 && !params.force) {
      return { ok: false, error: `${validation.invalidRows} rows still have errors — fix them or pass force:true` };
    }
    session.committed = true;
    session.committedAt = importNowIso();
    session.updatedAt = importNowIso();
    importSave();
    return { ok: true, result: { committedRows: session.rows.map((r) => r.current), correctedCount: session.rows.filter((r) => r.corrected).length, validation } };
  });

  function summarizeSession(session) {
    const v = validateSessionRows(session);
    return {
      id: session.id,
      name: session.name,
      rowCount: session.rows.length,
      correctedCount: session.rows.filter((r) => r.corrected).length,
      invalidRows: v.invalidRows,
      committed: session.committed,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  function validateSessionRows(session) {
    const schema = session.schema || {};
    const schemaFields = Object.keys(schema);
    const requiredFields = schemaFields.filter((f) => schema[f].required);
    let invalidRows = 0;
    const cellErrors = [];
    for (const r of session.rows) {
      const row = r.current;
      let rowOk = true;
      for (const f of requiredFields) {
        if (row[f] === undefined || row[f] === null || row[f] === "") {
          cellErrors.push({ rowIndex: r.rowIndex, field: f, error: "required field missing" });
          rowOk = false;
        }
      }
      for (const f of schemaFields) {
        const val = row[f];
        if (val === undefined || val === null || val === "") continue;
        const type = schema[f].type;
        let bad = false;
        if (type === "number" && isNaN(Number(val))) bad = true;
        if (type === "boolean" && !/^(true|false|yes|no|1|0)$/i.test(String(val))) bad = true;
        if (type === "date" && isNaN(new Date(val).getTime())) bad = true;
        if (bad) {
          cellErrors.push({ rowIndex: r.rowIndex, field: f, error: `expected ${type}` });
          rowOk = false;
        }
      }
      if (!rowOk) invalidRows++;
    }
    return { totalRows: session.rows.length, invalidRows, validRows: session.rows.length - invalidRows, cellErrors };
  }

  // ---------------------------------------------------------------------------
  // [S] Custom transform rules editor — apply formula / find-replace / coercion
  // rules to a row set and return the transformed output + per-rule impact.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "applyTransformRules", (ctx, artifact, params) => {
    const rows = params.rows || [];
    const rules = params.rules || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "params.rows must be a non-empty array" };
    }
    if (!Array.isArray(rules) || rules.length === 0) {
      return { ok: true, result: { message: "No rules supplied. Pass params.rules as [{ field, kind, ... }]. Kinds: find_replace, coerce, formula, set_default, regex_extract.", output: rows, ruleImpact: [] } };
    }

    function coerce(value, to) {
      if (value === null || value === undefined || value === "") return value;
      switch (to) {
        case "number": { const n = Number(value); return isNaN(n) ? value : n; }
        case "string": return String(value);
        case "boolean": return /^(true|yes|1)$/i.test(String(value));
        case "date": { const d = new Date(value); return isNaN(d.getTime()) ? value : d.toISOString(); }
        case "uppercase": return String(value).toUpperCase();
        case "lowercase": return String(value).toLowerCase();
        case "trim": return String(value).trim();
        default: return value;
      }
    }
    function evalFormula(expr, row) {
      // Safe arithmetic over {field} placeholders — no eval, only +,-,*,/ tokens.
      const substituted = String(expr).replace(/\{([^}]+)\}/g, (_m, f) => {
        const v = Number(row[f.trim()]);
        return isNaN(v) ? "0" : String(v);
      });
      if (!/^[\d\s+\-*/().]+$/.test(substituted)) return null;
      const tokens = substituted.match(/\d+\.?\d*|[+\-*/()]/g) || [];
      try {
        // Shunting-yard → RPN evaluation (arithmetic only, fully sandboxed).
        const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
        const out = [];
        const ops = [];
        for (const tk of tokens) {
          if (/^\d/.test(tk)) out.push(Number(tk));
          else if (tk === "(") ops.push(tk);
          else if (tk === ")") { while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()); ops.pop(); }
          else { while (ops.length && prec[ops[ops.length - 1]] >= prec[tk]) out.push(ops.pop()); ops.push(tk); }
        }
        while (ops.length) out.push(ops.pop());
        const st = [];
        for (const tk of out) {
          if (typeof tk === "number") st.push(tk);
          else { const b = st.pop(); const a = st.pop(); st.push(tk === "+" ? a + b : tk === "-" ? a - b : tk === "*" ? a * b : b === 0 ? 0 : a / b); }
        }
        const r = st.pop();
        return Number.isFinite(r) ? Math.round(r * 1e6) / 1e6 : null;
      } catch (_e) { return null; }
    }

    const ruleImpact = rules.map((r) => ({ field: r.field, kind: r.kind, changed: 0 }));
    const output = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const next = { ...row };
      rules.forEach((rule, ri) => {
        const f = rule.field;
        if (!f) return;
        const before = next[f];
        let after = before;
        switch (rule.kind) {
          case "find_replace":
            if (typeof before === "string") {
              after = rule.regex
                ? before.replace(new RegExp(rule.find || "", rule.flags || "g"), rule.replace || "")
                : before.split(rule.find || "").join(rule.replace || "");
            }
            break;
          case "coerce":
            after = coerce(before, rule.to);
            break;
          case "formula": {
            const computed = evalFormula(rule.expression || "", next);
            if (computed !== null) after = computed;
            break;
          }
          case "set_default":
            if (before === undefined || before === null || before === "") after = rule.value;
            break;
          case "regex_extract":
            if (typeof before === "string" && rule.pattern) {
              const m = before.match(new RegExp(rule.pattern));
              after = m ? (m[1] !== undefined ? m[1] : m[0]) : before;
            }
            break;
          default:
            break;
        }
        if (after !== before) { next[f] = after; ruleImpact[ri].changed++; }
      });
      return next;
    });

    return {
      ok: true,
      result: {
        rowCount: rows.length,
        ruleCount: rules.length,
        output,
        totalChanges: ruleImpact.reduce((sum, r) => sum + r.changed, 0),
        ruleImpact,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // [S] Saved import templates / mapping presets.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "saveTemplate", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.name) return { ok: false, error: "params.name required" };
    const userId = importActId(ctx);
    const templates = importList(s.templates, userId);
    const template = {
      id: importNextId("impt"),
      name: String(params.name),
      description: String(params.description || ""),
      mappings: Array.isArray(params.mappings) ? params.mappings : [],
      transformRules: Array.isArray(params.transformRules) ? params.transformRules : [],
      schema: params.schema && typeof params.schema === "object" ? params.schema : {},
      keyFields: Array.isArray(params.keyFields) ? params.keyFields : [],
      usageCount: 0,
      createdAt: importNowIso(),
      updatedAt: importNowIso(),
    };
    templates.unshift(template);
    importSave();
    return { ok: true, result: { template } };
  });

  registerLensAction("import", "listTemplates", (ctx) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const templates = importList(s.templates, importActId(ctx));
    return { ok: true, result: { templates, count: templates.length } };
  });

  registerLensAction("import", "applyTemplate", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const templates = importList(s.templates, importActId(ctx));
    const template = templates.find((t) => t.id === params.id);
    if (!template) return { ok: false, error: "template not found" };
    template.usageCount += 1;
    template.lastUsedAt = importNowIso();
    importSave();
    return {
      ok: true,
      result: {
        template,
        mappings: template.mappings,
        transformRules: template.transformRules,
        schema: template.schema,
        keyFields: template.keyFields,
      },
    };
  });

  registerLensAction("import", "deleteTemplate", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = importActId(ctx);
    const templates = importList(s.templates, userId);
    const idx = templates.findIndex((t) => t.id === params.id);
    if (idx === -1) return { ok: false, error: "template not found" };
    const [removed] = templates.splice(idx, 1);
    importSave();
    return { ok: true, result: { deleted: removed.id, name: removed.name } };
  });

  // ---------------------------------------------------------------------------
  // [M] Connector library — import directly from Google Sheets / public APIs.
  // Uses keyless public endpoints via cachedFetchJson. Sheets via the gviz
  // public CSV/JSON endpoint (works on link-shared sheets, no key required).
  // ---------------------------------------------------------------------------
  registerLensAction("import", "listConnectors", (ctx) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const saved = importList(s.connectors, importActId(ctx));
    return {
      ok: true,
      result: {
        catalog: [
          { kind: "google_sheets", label: "Google Sheets", note: "Public / link-shared sheet — no API key", params: ["sheetId", "gid"] },
          { kind: "rest_api", label: "REST API (JSON)", note: "Any public keyless JSON endpoint", params: ["url", "rootPath"] },
          { kind: "csv_url", label: "CSV from URL", note: "Any public CSV file", params: ["url"] },
        ],
        saved,
        savedCount: saved.length,
      },
    };
  });

  registerLensAction("import", "saveConnector", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const kind = params.kind;
    if (!["google_sheets", "rest_api", "csv_url"].includes(kind)) {
      return { ok: false, error: "kind must be google_sheets, rest_api, or csv_url" };
    }
    if (!params.name) return { ok: false, error: "params.name required" };
    const userId = importActId(ctx);
    const connectors = importList(s.connectors, userId);
    const connector = {
      id: importNextId("impc"),
      name: String(params.name),
      kind,
      config: {
        sheetId: params.sheetId ? String(params.sheetId) : undefined,
        gid: params.gid ? String(params.gid) : undefined,
        url: params.url ? String(params.url) : undefined,
        rootPath: params.rootPath ? String(params.rootPath) : undefined,
      },
      createdAt: importNowIso(),
      lastFetchedAt: null,
      lastRowCount: 0,
    };
    connectors.unshift(connector);
    importSave();
    return { ok: true, result: { connector } };
  });

  registerLensAction("import", "fetchFromConnector", async (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = importActId(ctx);
    let kind = params.kind;
    let cfg = { sheetId: params.sheetId, gid: params.gid, url: params.url, rootPath: params.rootPath };
    let connector = null;
    if (params.connectorId) {
      const connectors = importList(s.connectors, userId);
      connector = connectors.find((c) => c.id === params.connectorId);
      if (!connector) return { ok: false, error: "connector not found" };
      kind = connector.kind;
      cfg = connector.config;
    }
    let rows = [];
    try {
      const { cachedFetchJson, fetchJsonWithTimeout } = await import("../lib/external-fetch.js");
      if (kind === "google_sheets") {
        if (!cfg.sheetId) return { ok: false, error: "sheetId required for google_sheets connector" };
        const gid = cfg.gid || "0";
        const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cfg.sheetId)}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}`;
        const res = await fetchJsonWithTimeout(url, {}, 12000).catch(async () => {
          // gviz returns JS-wrapped JSON; fetchJsonWithTimeout may need raw text.
          const r = await fetch(url);
          const txt = await r.text();
          const m = txt.match(/setResponse\(([\s\S]+)\);?\s*$/);
          return m ? JSON.parse(m[1]) : null;
        });
        const table = res?.table || (typeof res === "string" ? null : res);
        if (!table?.cols) return { ok: false, error: "could not parse Google Sheet — ensure it is link-shared/public" };
        const headers = table.cols.map((c, i) => c.label || `col_${i}`);
        rows = (table.rows || []).map((r) => {
          const obj = {};
          (r.c || []).forEach((cell, i) => { obj[headers[i]] = cell ? (cell.v ?? null) : null; });
          return obj;
        });
      } else if (kind === "rest_api") {
        if (!cfg.url) return { ok: false, error: "url required for rest_api connector" };
        const data = await cachedFetchJson(cfg.url, { ttlMs: 60000 });
        let payload = data;
        if (cfg.rootPath) {
          for (const seg of String(cfg.rootPath).split(".")) {
            if (payload && typeof payload === "object") payload = payload[seg];
          }
        }
        rows = Array.isArray(payload) ? payload : (payload && typeof payload === "object" ? [payload] : []);
      } else if (kind === "csv_url") {
        if (!cfg.url) return { ok: false, error: "url required for csv_url connector" };
        const r = await fetch(cfg.url);
        if (!r.ok) return { ok: false, error: `CSV fetch failed: HTTP ${r.status}` };
        const text = await r.text();
        rows = parseCsv(text);
      } else {
        return { ok: false, error: "unknown connector kind" };
      }
    } catch (e) {
      return { ok: false, error: `connector fetch failed: ${String(e?.message || e)}` };
    }
    if (connector) {
      connector.lastFetchedAt = importNowIso();
      connector.lastRowCount = rows.length;
      importSave();
    }
    return { ok: true, result: { kind, rowCount: rows.length, rows: rows.slice(0, 500), truncated: rows.length > 500 } };
  });

  function parseCsv(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) return [];
    function splitLine(line) {
      const out = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }
    const headers = splitLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = splitLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i].trim() : ""; });
      return obj;
    });
  }

  // ---------------------------------------------------------------------------
  // [S] Incremental / scheduled imports — a sync definition, not a one-shot.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "createSchedule", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.name) return { ok: false, error: "params.name required" };
    const cadence = params.cadence || "daily";
    if (!["hourly", "daily", "weekly", "manual"].includes(cadence)) {
      return { ok: false, error: "cadence must be hourly, daily, weekly, or manual" };
    }
    const mode = params.mode || "incremental";
    if (!["incremental", "full"].includes(mode)) {
      return { ok: false, error: "mode must be incremental or full" };
    }
    const userId = importActId(ctx);
    const schedules = importList(s.schedules, userId);
    const schedule = {
      id: importNextId("imps"),
      name: String(params.name),
      connectorId: params.connectorId ? String(params.connectorId) : null,
      cadence,
      mode,
      keyField: params.keyField ? String(params.keyField) : null,
      enabled: params.enabled !== false,
      runCount: 0,
      lastRunAt: null,
      lastRowCount: 0,
      lastNewCount: 0,
      knownKeys: [],
      createdAt: importNowIso(),
    };
    schedules.unshift(schedule);
    importSave();
    return { ok: true, result: { schedule } };
  });

  registerLensAction("import", "listSchedules", (ctx) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const schedules = importList(s.schedules, importActId(ctx));
    return { ok: true, result: { schedules, count: schedules.length } };
  });

  registerLensAction("import", "runSchedule", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const schedules = importList(s.schedules, importActId(ctx));
    const schedule = schedules.find((x) => x.id === params.id);
    if (!schedule) return { ok: false, error: "schedule not found" };
    if (!schedule.enabled) return { ok: false, error: "schedule is disabled" };
    const rows = params.rows || [];
    if (!Array.isArray(rows)) return { ok: false, error: "params.rows must be an array of fetched rows" };

    let newRows = rows;
    let skipped = 0;
    if (schedule.mode === "incremental" && schedule.keyField) {
      const known = new Set(schedule.knownKeys);
      newRows = [];
      for (const r of rows) {
        const key = r && typeof r === "object" ? String(r[schedule.keyField]) : null;
        if (key && known.has(key)) { skipped++; continue; }
        if (key) { known.add(key); }
        newRows.push(r);
      }
      schedule.knownKeys = Array.from(known).slice(-10000);
    }
    schedule.runCount += 1;
    schedule.lastRunAt = importNowIso();
    schedule.lastRowCount = rows.length;
    schedule.lastNewCount = newRows.length;
    importSave();
    return {
      ok: true,
      result: {
        scheduleId: schedule.id,
        mode: schedule.mode,
        totalFetched: rows.length,
        newRows,
        newCount: newRows.length,
        skippedExisting: skipped,
        runCount: schedule.runCount,
      },
    };
  });

  registerLensAction("import", "toggleSchedule", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const schedules = importList(s.schedules, importActId(ctx));
    const schedule = schedules.find((x) => x.id === params.id);
    if (!schedule) return { ok: false, error: "schedule not found" };
    schedule.enabled = !schedule.enabled;
    importSave();
    return { ok: true, result: { schedule } };
  });

  // ---------------------------------------------------------------------------
  // [M] Rollback an import — snapshot committed rows, then undo.
  // ---------------------------------------------------------------------------
  registerLensAction("import", "snapshotImport", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const rows = params.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "params.rows must be a non-empty array of imported rows" };
    }
    const userId = importActId(ctx);
    const snapshots = importList(s.snapshots, userId);
    const snapshot = {
      id: importNextId("impr"),
      label: String(params.label || `Import ${snapshots.length + 1}`),
      source: String(params.source || "manual"),
      rows,
      rowCount: rows.length,
      status: "applied",
      createdAt: importNowIso(),
      rolledBackAt: null,
    };
    snapshots.unshift(snapshot);
    importSave();
    return { ok: true, result: { snapshot: { ...snapshot, rows: undefined } } };
  });

  registerLensAction("import", "listSnapshots", (ctx) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const snapshots = importList(s.snapshots, importActId(ctx));
    return {
      ok: true,
      result: {
        snapshots: snapshots.map((sn) => ({ ...sn, rows: undefined })),
        count: snapshots.length,
      },
    };
  });

  registerLensAction("import", "rollbackImport", (ctx, artifact, params) => {
    const s = getImportState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const snapshots = importList(s.snapshots, importActId(ctx));
    const snapshot = snapshots.find((x) => x.id === params.id);
    if (!snapshot) return { ok: false, error: "snapshot not found" };
    if (snapshot.status === "rolled_back") return { ok: false, error: "import already rolled back" };
    snapshot.status = "rolled_back";
    snapshot.rolledBackAt = importNowIso();
    importSave();
    return {
      ok: true,
      result: {
        snapshotId: snapshot.id,
        label: snapshot.label,
        rolledBackRows: snapshot.rowCount,
        rolledBackAt: snapshot.rolledBackAt,
      },
    };
  });
}
