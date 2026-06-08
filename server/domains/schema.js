// server/domains/schema.js
// Domain actions for schema management: validation, diffing, and
// evolution planning with backward compatibility checks.

export default function registerSchemaActions(registerLensAction) {
  /**
   * schemaValidate
   * Validate data against schema: type checking, required fields, pattern
   * matching, and nested object validation.
   * artifact.data.schema = { fields: { fieldName: { type, required?, pattern?, min?, max?, enum?, items?, properties? } } }
   * artifact.data.records = [{ fieldName: value, ... }]
   */
  registerLensAction("schema", "schemaValidate", (ctx, artifact, params) => {
    const schema = artifact.data?.schema || {};
    const records = artifact.data?.records || [];
    const fields = schema.fields || {};

    if (Object.keys(fields).length === 0) return { ok: true, result: { message: "No schema fields defined." } };
    if (records.length === 0) return { ok: true, result: { message: "No records to validate." } };

    function validateValue(value, fieldDef, path) {
      const errors = [];

      // Null/undefined check
      if (value === null || value === undefined) {
        if (fieldDef.required) errors.push({ path, error: "required_field_missing", message: `${path} is required` });
        return errors;
      }

      // Type checking
      const expectedType = (fieldDef.type || "string").toLowerCase();
      let actualType = typeof value;
      if (Array.isArray(value)) actualType = "array";
      if (value === null) actualType = "null";
      if (expectedType === "integer" && actualType !== "number") {
        errors.push({ path, error: "type_mismatch", expected: "integer", got: actualType, value });
      } else if (actualType === "number" && expectedType === "integer") {
        if (!Number.isInteger(value)) {
          errors.push({ path, error: "type_mismatch", expected: "integer", got: "float", value });
        }
      } else if (expectedType === "number" && actualType !== "number") {
        errors.push({ path, error: "type_mismatch", expected: expectedType, got: actualType, value });
      } else if (expectedType === "string" && actualType !== "string") {
        errors.push({ path, error: "type_mismatch", expected: expectedType, got: actualType, value });
      } else if (expectedType === "boolean" && actualType !== "boolean") {
        errors.push({ path, error: "type_mismatch", expected: expectedType, got: actualType, value });
      } else if (expectedType === "array" && !Array.isArray(value)) {
        errors.push({ path, error: "type_mismatch", expected: "array", got: actualType, value });
      } else if (expectedType === "object" && (actualType !== "object" || Array.isArray(value))) {
        errors.push({ path, error: "type_mismatch", expected: "object", got: actualType, value });
      }

      // Pattern matching (string only)
      if (fieldDef.pattern && typeof value === "string") {
        try {
          const re = new RegExp(fieldDef.pattern);
          if (!re.test(value)) {
            errors.push({ path, error: "pattern_mismatch", pattern: fieldDef.pattern, value });
          }
        } catch {
          errors.push({ path, error: "invalid_pattern", pattern: fieldDef.pattern });
        }
      }

      // Range checks (numbers)
      if (typeof value === "number") {
        if (fieldDef.min !== undefined && value < fieldDef.min) {
          errors.push({ path, error: "below_minimum", min: fieldDef.min, value });
        }
        if (fieldDef.max !== undefined && value > fieldDef.max) {
          errors.push({ path, error: "above_maximum", max: fieldDef.max, value });
        }
      }

      // String length checks
      if (typeof value === "string") {
        if (fieldDef.minLength !== undefined && value.length < fieldDef.minLength) {
          errors.push({ path, error: "string_too_short", minLength: fieldDef.minLength, length: value.length });
        }
        if (fieldDef.maxLength !== undefined && value.length > fieldDef.maxLength) {
          errors.push({ path, error: "string_too_long", maxLength: fieldDef.maxLength, length: value.length });
        }
      }

      // Enum validation
      if (fieldDef.enum && !fieldDef.enum.includes(value)) {
        errors.push({ path, error: "invalid_enum_value", allowedValues: fieldDef.enum, value });
      }

      // Nested object validation
      if (expectedType === "object" && fieldDef.properties && typeof value === "object" && !Array.isArray(value)) {
        for (const [propName, propDef] of Object.entries(fieldDef.properties)) {
          errors.push(...validateValue(value[propName], propDef, `${path}.${propName}`));
        }
      }

      // Array items validation
      if (expectedType === "array" && fieldDef.items && Array.isArray(value)) {
        if (fieldDef.minItems !== undefined && value.length < fieldDef.minItems) {
          errors.push({ path, error: "array_too_short", minItems: fieldDef.minItems, length: value.length });
        }
        if (fieldDef.maxItems !== undefined && value.length > fieldDef.maxItems) {
          errors.push({ path, error: "array_too_long", maxItems: fieldDef.maxItems, length: value.length });
        }
        for (let i = 0; i < Math.min(value.length, 100); i++) {
          errors.push(...validateValue(value[i], fieldDef.items, `${path}[${i}]`));
        }
      }

      return errors;
    }

    // Validate each record
    const recordResults = records.map((record, idx) => {
      const errors = [];

      // Check all schema fields
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        errors.push(...validateValue(record[fieldName], fieldDef, fieldName));
      }

      // Check for unknown fields
      const schemaFieldNames = new Set(Object.keys(fields));
      const unknownFields = Object.keys(record).filter(k => !schemaFieldNames.has(k));
      if (unknownFields.length > 0 && params.strictMode !== false) {
        errors.push({ path: "", error: "unknown_fields", fields: unknownFields });
      }

      return { recordIndex: idx, valid: errors.length === 0, errorCount: errors.length, errors: errors.slice(0, 20) };
    });

    const validCount = recordResults.filter(r => r.valid).length;
    const invalidCount = recordResults.filter(r => !r.valid).length;

    // Error frequency analysis
    const errorFrequency = {};
    for (const result of recordResults) {
      for (const error of result.errors) {
        const key = `${error.path}:${error.error}`;
        errorFrequency[key] = (errorFrequency[key] || 0) + 1;
      }
    }
    const topErrors = Object.entries(errorFrequency)
      .map(([key, count]) => ({ issue: key, occurrences: count }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);

    return {
      ok: true, result: {
        valid: invalidCount === 0,
        summary: {
          totalRecords: records.length,
          validRecords: validCount,
          invalidRecords: invalidCount,
          validationRate: Math.round((validCount / records.length) * 10000) / 100,
          schemaFieldCount: Object.keys(fields).length,
        },
        topErrors,
        records: recordResults.filter(r => !r.valid).slice(0, 20),
      },
    };
  });

  /**
   * schemaDiff
   * Diff two schemas: added/removed/changed fields, breaking vs non-breaking
   * changes, and migration complexity score.
   * artifact.data.schemaA = { fields: { fieldName: { type, required?, ... } } }
   * artifact.data.schemaB = { fields: { fieldName: { type, required?, ... } } }
   */
  registerLensAction("schema", "schemaDiff", (ctx, artifact, params) => {
  try {
    const schemaA = artifact.data?.schemaA || {};
    const schemaB = artifact.data?.schemaB || {};
    const fieldsA = schemaA.fields || {};
    const fieldsB = schemaB.fields || {};

    const keysA = new Set(Object.keys(fieldsA));
    const keysB = new Set(Object.keys(fieldsB));

    const changes = [];

    // Added fields (in B but not A)
    for (const key of keysB) {
      if (!keysA.has(key)) {
        const isBreaking = fieldsB[key].required === true;
        changes.push({
          field: key,
          changeType: "added",
          breaking: isBreaking,
          reason: isBreaking ? "New required field — existing data won't have it" : null,
          newDefinition: fieldsB[key],
        });
      }
    }

    // Removed fields (in A but not B)
    for (const key of keysA) {
      if (!keysB.has(key)) {
        changes.push({
          field: key,
          changeType: "removed",
          breaking: true,
          reason: "Removed field — consumers depending on it will break",
          oldDefinition: fieldsA[key],
        });
      }
    }

    // Modified fields (in both but different)
    for (const key of keysA) {
      if (!keysB.has(key)) continue;
      const a = fieldsA[key];
      const b = fieldsB[key];

      const fieldChanges = [];
      let isBreaking = false;

      // Type change
      if (a.type !== b.type) {
        fieldChanges.push({ property: "type", from: a.type, to: b.type });
        isBreaking = true;
      }

      // Required change
      if (!a.required && b.required) {
        fieldChanges.push({ property: "required", from: false, to: true });
        isBreaking = true;
      } else if (a.required && !b.required) {
        fieldChanges.push({ property: "required", from: true, to: false });
      }

      // Pattern change
      if (a.pattern !== b.pattern) {
        fieldChanges.push({ property: "pattern", from: a.pattern, to: b.pattern });
        if (b.pattern && !a.pattern) isBreaking = true; // adding constraint
      }

      // Range changes (tightening is breaking)
      if (a.min !== b.min) {
        fieldChanges.push({ property: "min", from: a.min, to: b.min });
        if (b.min !== undefined && (a.min === undefined || b.min > a.min)) isBreaking = true;
      }
      if (a.max !== b.max) {
        fieldChanges.push({ property: "max", from: a.max, to: b.max });
        if (b.max !== undefined && (a.max === undefined || b.max < a.max)) isBreaking = true;
      }

      // Enum changes
      if (JSON.stringify(a.enum) !== JSON.stringify(b.enum)) {
        const removedValues = (a.enum || []).filter(v => !(b.enum || []).includes(v));
        const addedValues = (b.enum || []).filter(v => !(a.enum || []).includes(v));
        fieldChanges.push({ property: "enum", removedValues, addedValues });
        if (removedValues.length > 0) isBreaking = true;
      }

      if (fieldChanges.length > 0) {
        changes.push({
          field: key,
          changeType: "modified",
          breaking: isBreaking,
          reason: isBreaking ? "Constraint tightened or type changed" : null,
          modifications: fieldChanges,
        });
      }
    }

    // Migration complexity score
    const breakingCount = changes.filter(c => c.breaking).length;
    const nonBreakingCount = changes.filter(c => !c.breaking).length;
    const removedCount = changes.filter(c => c.changeType === "removed").length;
    const typeChanges = changes.filter(c => c.modifications?.some(m => m.property === "type")).length;

    const complexityScore = Math.min(100,
      breakingCount * 15 +
      removedCount * 10 +
      typeChanges * 20 +
      nonBreakingCount * 3
    );

    const complexityLevel = complexityScore >= 60 ? "high" : complexityScore >= 30 ? "moderate" : complexityScore >= 10 ? "low" : "trivial";

    return {
      ok: true, result: {
        changes,
        summary: {
          totalChanges: changes.length,
          added: changes.filter(c => c.changeType === "added").length,
          removed: removedCount,
          modified: changes.filter(c => c.changeType === "modified").length,
          breakingChanges: breakingCount,
          nonBreakingChanges: nonBreakingCount,
          backwardCompatible: breakingCount === 0,
        },
        migration: {
          complexityScore,
          complexityLevel,
          estimatedEffortHours: Math.round(complexityScore * 0.3 * 10) / 10,
          requiredActions: [
            ...(removedCount > 0 ? [`Migrate ${removedCount} removed field(s) — update all consumers`] : []),
            ...(typeChanges > 0 ? [`Handle ${typeChanges} type change(s) — data transformation required`] : []),
            ...(changes.some(c => c.changeType === "added" && c.breaking) ? ["Backfill new required fields in existing data"] : []),
          ],
        },
        fieldsA: keysA.size,
        fieldsB: keysB.size,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * schemaEvolution
   * Plan schema evolution: backward compatibility check, versioning strategy,
   * and data migration path planning.
   * artifact.data.versions = [{ version: string, schema: { fields: { ... } }, timestamp? }]
   */
  registerLensAction("schema", "schemaEvolution", (ctx, artifact, params) => {
  try {
    const versions = artifact.data?.versions || [];
    if (versions.length < 2) return { ok: true, result: { message: "Need at least 2 schema versions for evolution planning." } };

    // Sort by version
    const sorted = [...versions].sort((a, b) => {
      const av = String(a.version || "0").split(".").map(Number);
      const bv = String(b.version || "0").split(".").map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const diff = (av[i] || 0) - (bv[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    // Compute diffs between consecutive versions
    const transitions = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevFields = prev.schema?.fields || {};
      const currFields = curr.schema?.fields || {};
      const prevKeys = new Set(Object.keys(prevFields));
      const currKeys = new Set(Object.keys(currFields));

      const added = [...currKeys].filter(k => !prevKeys.has(k));
      const removed = [...prevKeys].filter(k => !currKeys.has(k));
      const modified = [...currKeys].filter(k => prevKeys.has(k) && JSON.stringify(prevFields[k]) !== JSON.stringify(currFields[k]));

      // Detect breaking changes
      const breaking = [];
      for (const field of removed) {
        breaking.push({ field, reason: "field_removed" });
      }
      for (const field of added) {
        if (currFields[field].required) breaking.push({ field, reason: "required_field_added" });
      }
      for (const field of modified) {
        if (prevFields[field].type !== currFields[field].type) {
          breaking.push({ field, reason: "type_changed" });
        }
        if (!prevFields[field].required && currFields[field].required) {
          breaking.push({ field, reason: "made_required" });
        }
      }

      const isBackwardCompatible = breaking.length === 0;

      transitions.push({
        from: prev.version,
        to: curr.version,
        added,
        removed,
        modified,
        breakingChanges: breaking,
        backwardCompatible: isBackwardCompatible,
        changeCount: added.length + removed.length + modified.length,
      });
    }

    // Versioning strategy recommendation
    const totalBreaking = transitions.reduce((s, t) => s + t.breakingChanges.length, 0);
    const allBackwardCompatible = transitions.every(t => t.backwardCompatible);
    let versioningStrategy;
    if (allBackwardCompatible) {
      versioningStrategy = {
        type: "additive",
        description: "All changes are backward compatible — additive versioning works well",
        recommendations: ["Use content negotiation or URL versioning", "Support multiple versions simultaneously"],
      };
    } else if (totalBreaking <= 3) {
      versioningStrategy = {
        type: "semantic",
        description: "Few breaking changes — semantic versioning with deprecation periods",
        recommendations: ["Deprecate before removing", "Provide migration guides for each breaking change", "Support N-1 version for transition period"],
      };
    } else {
      versioningStrategy = {
        type: "epoch",
        description: "Significant breaking changes — consider epoch-based versioning",
        recommendations: ["Group breaking changes into major releases", "Provide automated migration tooling", "Consider parallel API support during transition"],
      };
    }

    // Migration path: for each version pair, estimate effort and plan
    const migrationPaths = transitions.map(t => {
      const steps = [];
      for (const field of t.added) {
        const def = sorted.find(v => v.version === t.to)?.schema?.fields?.[field];
        steps.push({
          action: "add_field",
          field,
          defaultValue: def?.default !== undefined ? def.default : (def?.type === "string" ? "" : def?.type === "number" ? 0 : null),
          required: def?.required || false,
        });
      }
      for (const field of t.removed) {
        steps.push({ action: "remove_field", field, backupRequired: true });
      }
      for (const field of t.modified) {
        const from = sorted.find(v => v.version === t.from)?.schema?.fields?.[field];
        const to = sorted.find(v => v.version === t.to)?.schema?.fields?.[field];
        steps.push({ action: "transform_field", field, fromType: from?.type, toType: to?.type });
      }
      return {
        from: t.from,
        to: t.to,
        steps,
        estimatedRecordsAffected: t.changeCount > 0 ? "all" : "none",
        rollbackPossible: t.backwardCompatible,
      };
    });

    // Field evolution tracking
    const fieldTimeline = {};
    for (const version of sorted) {
      for (const [field, def] of Object.entries(version.schema?.fields || {})) {
        if (!fieldTimeline[field]) fieldTimeline[field] = { introduced: version.version, versions: [] };
        fieldTimeline[field].versions.push(version.version);
        fieldTimeline[field].latest = version.version;
        fieldTimeline[field].currentType = def.type;
      }
    }

    // Fields that were removed
    for (const [field, timeline] of Object.entries(fieldTimeline)) {
      const lastVersion = sorted[sorted.length - 1];
      if (!lastVersion.schema?.fields?.[field]) {
        timeline.removed = true;
        timeline.removedIn = sorted.find((v, i) => {
          return i > 0 && sorted[i - 1].schema?.fields?.[field] && !v.schema?.fields?.[field];
        })?.version;
      }
    }

    return {
      ok: true, result: {
        transitions,
        versioningStrategy,
        migrationPaths,
        fieldTimeline,
        summary: {
          totalVersions: sorted.length,
          totalTransitions: transitions.length,
          breakingTransitions: transitions.filter(t => !t.backwardCompatible).length,
          compatibleTransitions: transitions.filter(t => t.backwardCompatible).length,
          totalBreakingChanges: totalBreaking,
          allBackwardCompatible,
          latestVersion: sorted[sorted.length - 1].version,
          oldestVersion: sorted[0].version,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  //  JSON-Schema-tooling / Hasura / dbdiagram parity — versioned schema
  //  registry, visual editor backing, sample-data generation, migration
  //  codegen, conformance against live data, ER visualization, and
  //  schema inference from JSON/SQL.
  // ════════════════════════════════════════════════════════════════════

  // ── per-user persistent state ──────────────────────────────────────
  function getSchemaState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.schemaLens) {
      STATE.schemaLens = {
        registry: new Map(), // userId -> Array<{ id, name, description, versions: [{ version, schema, note, createdAt }], createdAt, updatedAt }>
        seq: new Map(),      // userId -> next numeric id
      };
    }
    return STATE.schemaLens;
  }
  function saveSchema() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* persistence best-effort */ }
    }
  }
  function aid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nowIso() { return new Date().toISOString(); }
  function listFor(s, userId) {
    if (!s.registry.has(userId)) s.registry.set(userId, []);
    return s.registry.get(userId);
  }
  function nextId(s, userId) {
    const cur = s.seq.get(userId) || 1;
    s.seq.set(userId, cur + 1);
    return `sch_${userId.slice(0, 8)}_${cur}`;
  }

  // A schema "definition" is { fields: { name: { type, required?, pattern?, min?, max?,
  //   minLength?, maxLength?, enum?, default?, ref?, items?, properties? } } }.
  function normalizeSchema(raw) {
    const out = { fields: {} };
    const fields = raw?.fields || {};
    for (const [name, def] of Object.entries(fields)) {
      if (!def || typeof def !== "object") continue;
      const f = { type: String(def.type || "string").toLowerCase() };
      if (def.required) f.required = true;
      if (def.pattern) f.pattern = String(def.pattern);
      if (def.min !== undefined) f.min = Number(def.min);
      if (def.max !== undefined) f.max = Number(def.max);
      if (def.minLength !== undefined) f.minLength = Number(def.minLength);
      if (def.maxLength !== undefined) f.maxLength = Number(def.maxLength);
      if (Array.isArray(def.enum) && def.enum.length) f.enum = def.enum;
      if (def.default !== undefined) f.default = def.default;
      if (def.ref) f.ref = String(def.ref);
      if (def.description) f.description = String(def.description);
      if (def.items) f.items = def.items;
      if (def.properties) f.properties = def.properties;
      out.fields[String(name)] = f;
    }
    return out;
  }

  // ── registry: create / list / get / save-version / delete ──────────

  /**
   * registryCreate — store a named schema with its first version.
   * params: { name, description?, schema:{fields}, note? }
   */
  registerLensAction("schema", "registryCreate", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const s = getSchemaState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const name = String(p.name || "").trim();
      if (!name) return { ok: false, error: "name_required" };
      const userId = aid(ctx);
      const list = listFor(s, userId);
      if (list.some(e => e.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: "duplicate_name" };
      }
      const schema = normalizeSchema(p.schema || {});
      const id = nextId(s, userId);
      const entry = {
        id,
        name,
        description: String(p.description || ""),
        versions: [{
          version: "1.0.0",
          schema,
          note: String(p.note || "initial version"),
          createdAt: nowIso(),
        }],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      list.push(entry);
      saveSchema();
      return { ok: true, result: { id, name, version: "1.0.0", fieldCount: Object.keys(schema.fields).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registryList — browse the user's schema catalog.
   */
  registerLensAction("schema", "registryList", (ctx, artifact, _params) => {
    try {
      const s = getSchemaState();
      if (!s) return { ok: true, result: { schemas: [], count: 0 } };
      const list = listFor(s, aid(ctx));
      const schemas = list.map(e => {
        const latest = e.versions[e.versions.length - 1];
        return {
          id: e.id,
          name: e.name,
          description: e.description,
          versionCount: e.versions.length,
          latestVersion: latest.version,
          fieldCount: Object.keys(latest.schema.fields).length,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        };
      });
      return { ok: true, result: { schemas, count: schemas.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registryGet — fetch a single schema with full version history.
   * params: { id }
   */
  registerLensAction("schema", "registryGet", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const s = getSchemaState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const list = listFor(s, aid(ctx));
      const entry = list.find(e => e.id === p.id);
      if (!entry) return { ok: false, error: "not_found" };
      return { ok: true, result: { ...entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registrySaveVersion — append a new version to an existing schema. The
   * semver bump is auto-computed from a diff against the current latest:
   * breaking → major, additive → minor, otherwise patch.
   * params: { id, schema:{fields}, note? }
   */
  registerLensAction("schema", "registrySaveVersion", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const s = getSchemaState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const list = listFor(s, aid(ctx));
      const entry = list.find(e => e.id === p.id);
      if (!entry) return { ok: false, error: "not_found" };
      const prev = entry.versions[entry.versions.length - 1];
      const next = normalizeSchema(p.schema || {});

      const prevFields = prev.schema.fields;
      const nextFields = next.fields;
      const prevKeys = new Set(Object.keys(prevFields));
      const nextKeys = new Set(Object.keys(nextFields));
      let breaking = false, additive = false;
      for (const k of nextKeys) {
        if (!prevKeys.has(k)) { additive = true; if (nextFields[k].required) breaking = true; }
      }
      for (const k of prevKeys) {
        if (!nextKeys.has(k)) { breaking = true; continue; }
        const a = prevFields[k], b = nextFields[k];
        if (a.type !== b.type) breaking = true;
        if (!a.required && b.required) breaking = true;
        if (JSON.stringify(a) !== JSON.stringify(b)) additive = true;
      }

      const cur = String(prev.version || "1.0.0").split(".").map(n => parseInt(n, 10) || 0);
      while (cur.length < 3) cur.push(0);
      let bump;
      if (breaking) { cur[0]++; cur[1] = 0; cur[2] = 0; bump = "major"; }
      else if (additive) { cur[1]++; cur[2] = 0; bump = "minor"; }
      else { cur[2]++; bump = "patch"; }
      const version = cur.join(".");

      entry.versions.push({ version, schema: next, note: String(p.note || ""), createdAt: nowIso() });
      entry.updatedAt = nowIso();
      saveSchema();
      return { ok: true, result: { id: entry.id, version, bump, breaking, additive } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registryDelete — remove a schema from the catalog.
   * params: { id }
   */
  registerLensAction("schema", "registryDelete", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const s = getSchemaState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const list = listFor(s, aid(ctx));
      const idx = list.findIndex(e => e.id === p.id);
      if (idx === -1) return { ok: false, error: "not_found" };
      const [removed] = list.splice(idx, 1);
      saveSchema();
      return { ok: true, result: { id: removed.id, name: removed.name, deleted: true } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── sample-data generator ──────────────────────────────────────────

  function genValue(def, seed) {
    // deterministic-ish pseudo-random keyed by seed
    const rnd = (() => { let x = seed * 2654435761 % 2147483647; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    const type = String(def.type || "string").toLowerCase();
    if (def.default !== undefined) return def.default;
    if (Array.isArray(def.enum) && def.enum.length) {
      return def.enum[Math.floor(rnd() * def.enum.length)];
    }
    if (type === "integer" || type === "number") {
      const min = def.min !== undefined ? def.min : 0;
      const max = def.max !== undefined ? def.max : min + 100;
      const v = min + rnd() * (max - min);
      return type === "integer" ? Math.round(v) : Math.round(v * 100) / 100;
    }
    if (type === "boolean") return rnd() > 0.5;
    if (type === "array") {
      const n = (def.minItems || 1) + Math.floor(rnd() * 2);
      const items = [];
      for (let i = 0; i < n; i++) items.push(def.items ? genValue(def.items, seed + i + 1) : i);
      return items;
    }
    if (type === "object" && def.properties) {
      const obj = {};
      let i = 0;
      for (const [k, pd] of Object.entries(def.properties)) obj[k] = genValue(pd, seed + (++i));
      return obj;
    }
    // string
    if (def.pattern) {
      // best-effort: emit common pattern matches
      const pat = def.pattern;
      if (/@/.test(pat) || /email/i.test(pat)) return `user${seed}@example.com`;
      if (/\d/.test(pat) && /\^\\d/.test(pat)) return String(1000 + (seed % 9000));
    }
    const words = ["alpha", "bravo", "delta", "echo", "nova", "orbit", "vector", "zenith"];
    let str = `${words[seed % words.length]}-${seed}`;
    if (def.minLength !== undefined && str.length < def.minLength) str = str.padEnd(def.minLength, "x");
    if (def.maxLength !== undefined && str.length > def.maxLength) str = str.slice(0, def.maxLength);
    return str;
  }

  /**
   * sampleGenerate — produce valid example records from a schema.
   * params: { schema:{fields}, count? }  OR  { id, count? } to use a registry schema
   */
  registerLensAction("schema", "sampleGenerate", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      let schema = p.schema;
      if (!schema && p.id) {
        const s = getSchemaState();
        const entry = s && listFor(s, aid(ctx)).find(e => e.id === p.id);
        if (!entry) return { ok: false, error: "not_found" };
        schema = entry.versions[entry.versions.length - 1].schema;
      }
      const norm = normalizeSchema(schema || {});
      const fields = norm.fields;
      if (Object.keys(fields).length === 0) return { ok: false, error: "no_fields" };
      const count = Math.max(1, Math.min(200, Number(p.count) || 5));
      const records = [];
      for (let r = 0; r < count; r++) {
        const rec = {};
        let fi = 0;
        for (const [name, def] of Object.entries(fields)) {
          fi++;
          // optional fields populated ~80% of the time
          if (!def.required && ((r * 31 + fi) % 5 === 0)) continue;
          rec[name] = genValue(def, r * 97 + fi * 13 + 1);
        }
        records.push(rec);
      }
      return { ok: true, result: { records, count: records.length, fieldCount: Object.keys(fields).length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── migration generator ────────────────────────────────────────────

  /**
   * migrationGenerate — emit a migration script from a schema diff.
   * params: { schemaA:{fields}, schemaB:{fields}, dialect?, table? }
   *         dialect ∈ sql | json
   */
  registerLensAction("schema", "migrationGenerate", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const a = normalizeSchema(p.schemaA || {}).fields;
      const b = normalizeSchema(p.schemaB || {}).fields;
      const table = String(p.table || "records").replace(/[^a-zA-Z0-9_]/g, "_");
      const dialect = String(p.dialect || "sql").toLowerCase();
      const keysA = new Set(Object.keys(a));
      const keysB = new Set(Object.keys(b));

      const SQL_TYPE = { string: "TEXT", integer: "INTEGER", number: "REAL", boolean: "BOOLEAN", array: "TEXT", object: "TEXT" };
      const ops = [];
      const upSql = [], downSql = [];

      for (const k of keysB) {
        if (!keysA.has(k)) {
          const t = SQL_TYPE[b[k].type] || "TEXT";
          const nn = b[k].required ? " NOT NULL" : "";
          const def = b[k].default !== undefined ? ` DEFAULT ${JSON.stringify(b[k].default)}` : "";
          ops.push({ op: "add_column", field: k, type: b[k].type, breaking: b[k].required && b[k].default === undefined });
          upSql.push(`ALTER TABLE ${table} ADD COLUMN ${k} ${t}${def}${nn};`);
          downSql.push(`ALTER TABLE ${table} DROP COLUMN ${k};`);
        }
      }
      for (const k of keysA) {
        if (!keysB.has(k)) {
          ops.push({ op: "drop_column", field: k, type: a[k].type, breaking: true });
          upSql.push(`ALTER TABLE ${table} DROP COLUMN ${k};`);
          const t = SQL_TYPE[a[k].type] || "TEXT";
          downSql.push(`ALTER TABLE ${table} ADD COLUMN ${k} ${t};`);
        }
      }
      for (const k of keysA) {
        if (!keysB.has(k)) continue;
        if (a[k].type !== b[k].type) {
          const tNew = SQL_TYPE[b[k].type] || "TEXT";
          const tOld = SQL_TYPE[a[k].type] || "TEXT";
          ops.push({ op: "alter_type", field: k, from: a[k].type, to: b[k].type, breaking: true });
          // SQLite-safe column re-type via add/copy/drop/rename pattern note
          upSql.push(`-- type change ${k}: ${a[k].type} -> ${b[k].type} (verify data cast)`);
          upSql.push(`ALTER TABLE ${table} ADD COLUMN ${k}__new ${tNew};`);
          upSql.push(`UPDATE ${table} SET ${k}__new = CAST(${k} AS ${tNew});`);
          upSql.push(`ALTER TABLE ${table} DROP COLUMN ${k};`);
          upSql.push(`ALTER TABLE ${table} RENAME COLUMN ${k}__new TO ${k};`);
          downSql.push(`ALTER TABLE ${table} ADD COLUMN ${k}__old ${tOld};`);
          downSql.push(`UPDATE ${table} SET ${k}__old = CAST(${k} AS ${tOld});`);
          downSql.push(`ALTER TABLE ${table} DROP COLUMN ${k};`);
          downSql.push(`ALTER TABLE ${table} RENAME COLUMN ${k}__old TO ${k};`);
        }
      }

      const breakingCount = ops.filter(o => o.breaking).length;
      let script;
      if (dialect === "json") {
        script = JSON.stringify({ table, up: ops, generatedAt: nowIso() }, null, 2);
      } else {
        script = [
          `-- Migration generated from schema diff`,
          `-- table: ${table}  |  operations: ${ops.length}  |  breaking: ${breakingCount}`,
          ``,
          `-- == UP ==`,
          ...(upSql.length ? upSql : ["-- (no changes)"]),
          ``,
          `-- == DOWN ==`,
          ...(downSql.length ? downSql : ["-- (no changes)"]),
        ].join("\n");
      }

      return {
        ok: true,
        result: {
          dialect,
          table,
          operations: ops,
          operationCount: ops.length,
          breakingCount,
          reversible: ops.every(o => o.op !== "drop_column"),
          script,
          up: upSql,
          down: downSql,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── conformance against live data ──────────────────────────────────

  /**
   * conformanceCheck — point a schema at a dataset and report conformance
   * with per-field statistics: presence rate, null rate, type drift.
   * params: { schema:{fields}, records:[...] }  OR  { id, records }
   */
  registerLensAction("schema", "conformanceCheck", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      let schema = p.schema;
      if (!schema && p.id) {
        const s = getSchemaState();
        const entry = s && listFor(s, aid(ctx)).find(e => e.id === p.id);
        if (!entry) return { ok: false, error: "not_found" };
        schema = entry.versions[entry.versions.length - 1].schema;
      }
      const fields = normalizeSchema(schema || {}).fields;
      const records = Array.isArray(p.records) ? p.records : [];
      if (Object.keys(fields).length === 0) return { ok: false, error: "no_fields" };
      if (records.length === 0) return { ok: false, error: "no_records" };

      function jsType(v) {
        if (v === null || v === undefined) return "null";
        if (Array.isArray(v)) return "array";
        if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
        return typeof v;
      }
      function typeMatches(expected, actual) {
        if (expected === actual) return true;
        if (expected === "number" && actual === "integer") return true;
        return false;
      }

      const fieldStats = {};
      for (const [name, def] of Object.entries(fields)) {
        let present = 0, nulls = 0, typeMismatch = 0, valid = 0;
        const typeCounts = {};
        for (const rec of records) {
          const has = rec && Object.prototype.hasOwnProperty.call(rec, name);
          const v = has ? rec[name] : undefined;
          if (!has || v === undefined) { continue; }
          present++;
          if (v === null) { nulls++; continue; }
          const t = jsType(v);
          typeCounts[t] = (typeCounts[t] || 0) + 1;
          if (!typeMatches(def.type, t)) typeMismatch++;
          else valid++;
        }
        fieldStats[name] = {
          declaredType: def.type,
          required: !!def.required,
          presenceRate: Math.round((present / records.length) * 10000) / 100,
          nullCount: nulls,
          typeMismatchCount: typeMismatch,
          observedTypes: typeCounts,
          conformingCount: valid,
          missingViolations: def.required ? records.length - present : 0,
        };
      }

      const totalCells = records.length * Object.keys(fields).length;
      const violations = Object.values(fieldStats).reduce(
        (acc, fs) => acc + fs.typeMismatchCount + fs.missingViolations, 0);
      const undeclared = new Set();
      for (const rec of records) {
        if (!rec || typeof rec !== "object") continue;
        for (const k of Object.keys(rec)) if (!fields[k]) undeclared.add(k);
      }

      return {
        ok: true,
        result: {
          recordCount: records.length,
          fieldCount: Object.keys(fields).length,
          conformanceRate: totalCells > 0
            ? Math.round((1 - violations / totalCells) * 10000) / 100 : 100,
          totalViolations: violations,
          undeclaredFields: [...undeclared],
          fieldStats,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── ER visualization ───────────────────────────────────────────────

  /**
   * erDiagram — build an entity-relationship graph (nodes + edges) from a
   * set of named schemas. Reference edges come from field defs carrying a
   * `ref` (target schema name) or an object/array shape.
   * params: { schemas: [{ name, schema:{fields} }] }  OR  {} to use registry
   */
  registerLensAction("schema", "erDiagram", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      let entities = Array.isArray(p.schemas) ? p.schemas : null;
      if (!entities) {
        const s = getSchemaState();
        const list = s ? listFor(s, aid(ctx)) : [];
        entities = list.map(e => ({
          name: e.name,
          schema: e.versions[e.versions.length - 1].schema,
        }));
      }
      if (!entities.length) return { ok: false, error: "no_schemas" };

      const nameSet = new Set(entities.map(e => String(e.name).toLowerCase()));
      const nodes = [];
      const edges = [];
      for (const ent of entities) {
        const fields = normalizeSchema(ent.schema || {}).fields;
        const fieldList = Object.entries(fields).map(([n, d]) => ({
          name: n, type: d.type, required: !!d.required, ref: d.ref || null,
        }));
        nodes.push({
          id: String(ent.name),
          label: String(ent.name),
          fieldCount: fieldList.length,
          fields: fieldList,
        });
        for (const [fname, fdef] of Object.entries(fields)) {
          let target = null, kind = null;
          if (fdef.ref) { target = fdef.ref; kind = "reference"; }
          else if (fdef.type === "array" && fdef.items && fdef.items.ref) { target = fdef.items.ref; kind = "has_many"; }
          if (target) {
            edges.push({
              from: String(ent.name),
              to: String(target),
              field: fname,
              kind,
              resolved: nameSet.has(String(target).toLowerCase()),
            });
          }
        }
      }
      return {
        ok: true,
        result: {
          nodes,
          edges,
          entityCount: nodes.length,
          relationCount: edges.length,
          danglingRefs: edges.filter(e => !e.resolved).map(e => `${e.from}.${e.field} -> ${e.to}`),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── schema inference (import) ──────────────────────────────────────

  function inferTypeFromValue(v) {
    if (v === null || v === undefined) return "string";
    if (Array.isArray(v)) return "array";
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "object") return "object";
    return "string";
  }

  function inferFromJson(records) {
    const fieldMeta = {};
    for (const rec of records) {
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
      for (const [k, v] of Object.entries(rec)) {
        if (!fieldMeta[k]) fieldMeta[k] = { types: new Set(), present: 0, nulls: 0, samples: [] };
        const m = fieldMeta[k];
        m.present++;
        if (v === null || v === undefined) { m.nulls++; continue; }
        m.types.add(inferTypeFromValue(v));
        if (m.samples.length < 5) m.samples.push(v);
      }
    }
    const fields = {};
    for (const [k, m] of Object.entries(fieldMeta)) {
      const types = [...m.types];
      // integer + number collapse to number
      let type = types[0] || "string";
      if (types.includes("number") && types.includes("integer")) type = "number";
      else if (types.length > 1) type = "string"; // mixed → widen
      const def = { type };
      if (m.present === records.length && m.nulls === 0) def.required = true;
      // enum detection: small set of distinct primitive samples
      if ((type === "string" || type === "integer") && m.samples.length) {
        const distinct = [...new Set(m.samples)];
        if (distinct.length <= 5 && distinct.length < records.length) def.enum = distinct;
      }
      fields[k] = def;
    }
    return { fields };
  }

  function inferFromSql(ddl) {
    // parse a single CREATE TABLE statement
    const SQL_MAP = [
      [/\b(int|integer|bigint|smallint|serial)\b/i, "integer"],
      [/\b(real|float|double|decimal|numeric)\b/i, "number"],
      [/\b(bool|boolean)\b/i, "boolean"],
      [/\b(json|jsonb)\b/i, "object"],
      [/\b(text|char|varchar|uuid|date|time|timestamp)\b/i, "string"],
    ];
    const m = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?\s*\(([\s\S]+)\)/i);
    if (!m) return { table: null, schema: { fields: {} } };
    const table = m[1];
    const body = m[2];
    // split top-level commas
    const parts = [];
    let depth = 0, buf = "";
    for (const ch of body) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(buf); buf = ""; }
      else buf += ch;
    }
    if (buf.trim()) parts.push(buf);
    const fields = {};
    for (const raw of parts) {
      const line = raw.trim();
      if (!line) continue;
      if (/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|KEY)\b/i.test(line)) continue;
      const cm = line.match(/^["'`]?([a-zA-Z0-9_]+)["'`]?\s+(.+)$/);
      if (!cm) continue;
      const col = cm[1];
      const rest = cm[2];
      let type = "string";
      for (const [re, t] of SQL_MAP) { if (re.test(rest)) { type = t; break; } }
      const def = { type };
      if (/\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest)) def.required = true;
      const dm = rest.match(/\bDEFAULT\s+('[^']*'|"[^"]*"|[0-9.]+|TRUE|FALSE)/i);
      if (dm) {
        let dv = dm[1].replace(/^['"]|['"]$/g, "");
        if (type === "integer" || type === "number") dv = Number(dv);
        else if (type === "boolean") dv = /true/i.test(dv);
        def.default = dv;
      }
      const lm = rest.match(/(?:varchar|char)\s*\(\s*(\d+)\s*\)/i);
      if (lm) def.maxLength = Number(lm[1]);
      fields[col] = def;
    }
    return { table, schema: { fields } };
  }

  /**
   * inferSchema — infer a schema from existing JSON records or a SQL DDL.
   * params: { source: 'json'|'sql', records?:[...], ddl?:string }
   */
  registerLensAction("schema", "inferSchema", (ctx, artifact, params) => {
    try {
      const p = params || artifact.data || {};
      const source = String(p.source || (p.ddl ? "sql" : "json")).toLowerCase();
      if (source === "sql") {
        const ddl = String(p.ddl || "");
        if (!ddl.trim()) return { ok: false, error: "ddl_required" };
        const { table, schema } = inferFromSql(ddl);
        if (!schema.fields || Object.keys(schema.fields).length === 0) {
          return { ok: false, error: "no_columns_parsed" };
        }
        return {
          ok: true,
          result: { source: "sql", table, schema, fieldCount: Object.keys(schema.fields).length },
        };
      }
      // json
      let records = p.records;
      if (typeof records === "string") {
        try { records = JSON.parse(records); } catch { return { ok: false, error: "invalid_json" }; }
      }
      if (!Array.isArray(records)) records = records ? [records] : [];
      if (records.length === 0) return { ok: false, error: "no_records" };
      const schema = inferFromJson(records);
      if (Object.keys(schema.fields).length === 0) return { ok: false, error: "no_fields_inferred" };
      return {
        ok: true,
        result: {
          source: "json",
          schema,
          fieldCount: Object.keys(schema.fields).length,
          sampledRecords: records.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
