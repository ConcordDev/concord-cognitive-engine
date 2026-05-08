// server/domains/custom.js
export default function registerCustomActions(registerLensAction) {
  registerLensAction("custom", "evaluateSchema", (ctx, artifact, _params) => {
    const schema = artifact.data?.schema || artifact.data?.fields || [];
    if (schema.length === 0) return { ok: true, result: { message: "Define custom fields to evaluate schema." } };
    const fields = (Array.isArray(schema) ? schema : Object.entries(schema).map(([k, v]) => ({ name: k, type: v }))).map(f => {
      const name = f.name || f.field || f;
      const type = f.type || "string";
      const required = f.required || false;
      return { name, type, required, valid: !!name && !!type };
    });
    return { ok: true, result: { fields, totalFields: fields.length, validFields: fields.filter(f => f.valid).length, types: [...new Set(fields.map(f => f.type))], requiredCount: fields.filter(f => f.required).length, schemaValid: fields.every(f => f.valid) } };
  });
  registerLensAction("custom", "templateRender", (ctx, artifact, _params) => {
    const template = artifact.data?.template || "";
    const vars = artifact.data?.variables || {};
    if (!template) return { ok: true, result: { message: "Provide a template string with {{variable}} placeholders." } };
    let rendered = template;
    const found = []; const missing = [];
    const placeholders = template.match(/\{\{(\w+)\}\}/g) || [];
    for (const ph of placeholders) {
      const key = ph.replace(/[{}]/g, "");
      if (vars[key] !== undefined) { rendered = rendered.replace(ph, String(vars[key])); found.push(key); }
      else missing.push(key);
    }
    return { ok: true, result: { rendered, variablesFound: found, variablesMissing: missing, complete: missing.length === 0 } };
  });
  registerLensAction("custom", "validateData", (ctx, artifact, _params) => {
    const data = artifact.data?.values || artifact.data || {};
    const rules = artifact.data?.validationRules || [];
    if (rules.length === 0) return { ok: true, result: { message: "Define validation rules to check data." } };
    const results = rules.map(r => {
      const field = r.field;
      const value = data[field];
      let passed = true; let reason = "OK";
      if (r.required && (value === undefined || value === null || value === "")) { passed = false; reason = "Required field is empty"; }
      if (r.minLength && typeof value === "string" && value.length < r.minLength) { passed = false; reason = `Min length ${r.minLength}, got ${value.length}`; }
      if (r.maxLength && typeof value === "string" && value.length > r.maxLength) { passed = false; reason = `Max length ${r.maxLength}, got ${value.length}`; }
      if (r.min !== undefined && parseFloat(value) < r.min) { passed = false; reason = `Min ${r.min}, got ${value}`; }
      if (r.max !== undefined && parseFloat(value) > r.max) { passed = false; reason = `Max ${r.max}, got ${value}`; }
      if (r.pattern && typeof value === "string" && !new RegExp(r.pattern).test(value)) { passed = false; reason = `Does not match pattern ${r.pattern}`; }
      return { field, value, rule: r.type || "custom", passed, reason };
    });
    return { ok: true, result: { results, totalRules: rules.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, valid: results.every(r => r.passed) } };
  });
  registerLensAction("custom", "transformData", (ctx, artifact, _params) => {
    const data = artifact.data?.input || {};
    const transforms = artifact.data?.transforms || [];
    if (transforms.length === 0) return { ok: true, result: { message: "Define transform operations." } };
    const output = { ...data };
    const log = [];
    for (const t of transforms) {
      const field = t.field;
      const op = (t.operation || "").toLowerCase();
      if (op === "uppercase" && typeof output[field] === "string") { output[field] = output[field].toUpperCase(); log.push(`${field}: uppercase`); }
      else if (op === "lowercase" && typeof output[field] === "string") { output[field] = output[field].toLowerCase(); log.push(`${field}: lowercase`); }
      else if (op === "trim" && typeof output[field] === "string") { output[field] = output[field].trim(); log.push(`${field}: trim`); }
      else if (op === "round" && typeof output[field] === "number") { output[field] = Math.round(output[field]); log.push(`${field}: round`); }
      else if (op === "rename" && t.newName) { output[t.newName] = output[field]; delete output[field]; log.push(`${field} -> ${t.newName}`); }
      else if (op === "default" && (output[field] === undefined || output[field] === null)) { output[field] = t.defaultValue; log.push(`${field}: default=${t.defaultValue}`); }
      else { log.push(`${field}: skipped (${op})`); }
    }
    return { ok: true, result: { output, transformsApplied: log.length, log } };
  });
}
