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
      if (actualType === "number" && expectedType === "integer") {
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
  });

  /**
   * schemaEvolution
   * Plan schema evolution: backward compatibility check, versioning strategy,
   * and data migration path planning.
   * artifact.data.versions = [{ version: string, schema: { fields: { ... } }, timestamp? }]
   */
  registerLensAction("schema", "schemaEvolution", (ctx, artifact, params) => {
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
  });
}
