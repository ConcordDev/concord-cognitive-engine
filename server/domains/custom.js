// server/domains/custom.js
//
// Custom Lens Builder backend. Pure-compute schema/template/validation
// macros (operate on the artifact) PLUS a per-user no-code lens builder
// substrate: a widget canvas, component palette, data-source bindings,
// live-preview renderer, publish-to-nav registry, import/export, and
// event/action wiring. Persistent per-user state lives on
// globalThis._concordSTATE keyed by userId.

import { cachedFetchJson } from "../lib/external-fetch.js";

// ── Component palette — prebuilt widget types with prop schemas ──────────────
const COMPONENT_PALETTE = [
  {
    type: "table",
    label: "Table",
    icon: "📋",
    description: "Tabular data grid bound to a list endpoint.",
    props: [
      { key: "title", type: "string", default: "Table" },
      { key: "columns", type: "string[]", default: ["id", "name"] },
      { key: "pageSize", type: "number", default: 10 },
    ],
    binds: true,
  },
  {
    type: "chart",
    label: "Chart",
    icon: "📊",
    description: "Line / bar / area chart over numeric series.",
    props: [
      { key: "title", type: "string", default: "Chart" },
      { key: "chartKind", type: "enum:line|bar|area|scatter", default: "bar" },
      { key: "xKey", type: "string", default: "label" },
      { key: "yKey", type: "string", default: "value" },
    ],
    binds: true,
  },
  {
    type: "form",
    label: "Form",
    icon: "📝",
    description: "Input form that POSTs to a macro on submit.",
    props: [
      { key: "title", type: "string", default: "Form" },
      { key: "fields", type: "field[]", default: [{ name: "name", type: "string" }] },
      { key: "submitLabel", type: "string", default: "Submit" },
    ],
    binds: true,
  },
  {
    type: "button",
    label: "Button",
    icon: "🔘",
    description: "Action button — fires a wired macro on click.",
    props: [
      { key: "label", type: "string", default: "Run" },
      { key: "variant", type: "enum:primary|ghost|danger", default: "primary" },
    ],
    binds: false,
  },
  {
    type: "metric",
    label: "Metric",
    icon: "🔢",
    description: "Single big-number KPI tile bound to a scalar field.",
    props: [
      { key: "title", type: "string", default: "Metric" },
      { key: "valueKey", type: "string", default: "value" },
      { key: "unit", type: "string", default: "" },
    ],
    binds: true,
  },
  {
    type: "text",
    label: "Text",
    icon: "📄",
    description: "Static markdown / rich-text block.",
    props: [
      { key: "content", type: "string", default: "Describe this panel…" },
    ],
    binds: false,
  },
  {
    type: "map",
    label: "Map",
    icon: "🗺️",
    description: "Marker map bound to a list of lat/lon points.",
    props: [
      { key: "title", type: "string", default: "Map" },
      { key: "latKey", type: "string", default: "lat" },
      { key: "lonKey", type: "string", default: "lon" },
    ],
    binds: true,
  },
];

const PALETTE_TYPES = new Set(COMPONENT_PALETTE.map((c) => c.type));
const CANVAS_KIND_LIMIT = 200;

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function getCustomState() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.customLens) {
    STATE.customLens = {
      canvases: new Map(),   // userId -> Map<canvasId, canvas>
      bindings: new Map(),   // userId -> Map<bindingId, binding>
      wirings: new Map(),    // userId -> Map<wiringId, wiring>
      published: new Map(),  // userId -> Map<canvasId, publishEntry>
    };
  }
  return STATE.customLens;
}

function userMap(s, bucket, userId) {
  if (!s[bucket].has(userId)) s[bucket].set(userId, new Map());
  return s[bucket].get(userId);
}

let _idSeq = 0;
function nextId(prefix) {
  _idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idSeq.toString(36)}`;
}

// Default props for a freshly-placed widget, derived from the palette schema.
function defaultPropsFor(type) {
  const def = COMPONENT_PALETTE.find((c) => c.type === type);
  if (!def) return {};
  const props = {};
  for (const p of def.props) props[p.key] = p.default;
  return props;
}

export default function registerCustomActions(registerLensAction) {
  // ════════════════════════════════════════════════════════════════════════
  // Pure-compute macros (operate on the artifact) — preserved from v1.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "evaluateSchema", (ctx, artifact, _params) => {
    const schema = artifact?.data?.schema || artifact?.data?.fields || [];
    if (schema.length === 0) return { ok: true, result: { message: "Define custom fields to evaluate schema." } };
    const fields = (Array.isArray(schema) ? schema : Object.entries(schema).map(([k, v]) => ({ name: k, type: v }))).map((f) => {
      const name = f.name || f.field || f;
      const type = f.type || "string";
      const required = f.required || false;
      return { name, type, required, valid: !!name && !!type };
    });
    return { ok: true, result: { fields, totalFields: fields.length, validFields: fields.filter((f) => f.valid).length, types: [...new Set(fields.map((f) => f.type))], requiredCount: fields.filter((f) => f.required).length, schemaValid: fields.every((f) => f.valid) } };
  });

  registerLensAction("custom", "templateRender", (ctx, artifact, _params) => {
    const template = artifact?.data?.template || "";
    const vars = artifact?.data?.variables || {};
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
    const data = artifact?.data?.values || artifact?.data || {};
    const rules = artifact?.data?.validationRules || [];
    if (rules.length === 0) return { ok: true, result: { message: "Define validation rules to check data." } };
    const results = rules.map((r) => {
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
    return { ok: true, result: { results, totalRules: rules.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, valid: results.every((r) => r.passed) } };
  });

  registerLensAction("custom", "transformData", (ctx, artifact, _params) => {
    const data = artifact?.data?.input || {};
    const transforms = artifact?.data?.transforms || [];
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

  // ════════════════════════════════════════════════════════════════════════
  // Component palette — prebuilt widget types with prop panels.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "palette", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { components: COMPONENT_PALETTE, count: COMPONENT_PALETTE.length } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // Visual drag-drop widget canvas — create / list / save a layout of widgets.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "canvasList", (ctx, _artifact, _params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "canvases", actorId(ctx));
      const canvases = Array.from(map.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      return { ok: true, result: { canvases, count: canvases.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "canvasGet", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "canvases", actorId(ctx));
      const canvas = map.get(String(params.canvasId || ""));
      if (!canvas) return { ok: false, error: "canvas not found" };
      return { ok: true, result: { canvas } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "canvasCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "canvases", actorId(ctx));
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const now = new Date().toISOString();
      const canvas = {
        id: nextId("cv"),
        name: name.slice(0, 80),
        description: String(params.description || "").slice(0, 240),
        layout: params.layout === "freeform" ? "freeform" : "grid",
        widgets: [],
        createdAt: now,
        updatedAt: now,
      };
      map.set(canvas.id, canvas);
      return { ok: true, result: { canvas } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Save the full widget list for a canvas — the drag-drop editor calls this.
  registerLensAction("custom", "canvasSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "canvases", actorId(ctx));
      const canvas = map.get(String(params.canvasId || ""));
      if (!canvas) return { ok: false, error: "canvas not found" };
      const incoming = Array.isArray(params.widgets) ? params.widgets : [];
      if (incoming.length > CANVAS_KIND_LIMIT) {
        return { ok: false, error: `too many widgets (max ${CANVAS_KIND_LIMIT})` };
      }
      const widgets = [];
      for (const w of incoming) {
        const type = String(w?.type || "");
        if (!PALETTE_TYPES.has(type)) {
          return { ok: false, error: `unknown widget type: ${type || "(empty)"}` };
        }
        widgets.push({
          id: String(w.id || nextId("wg")),
          type,
          x: Number.isFinite(+w.x) ? +w.x : 0,
          y: Number.isFinite(+w.y) ? +w.y : 0,
          w: Number.isFinite(+w.w) ? Math.max(1, +w.w) : 4,
          h: Number.isFinite(+w.h) ? Math.max(1, +w.h) : 3,
          props: { ...defaultPropsFor(type), ...(w.props && typeof w.props === "object" ? w.props : {}) },
          bindingId: w.bindingId ? String(w.bindingId) : null,
        });
      }
      canvas.widgets = widgets;
      if (typeof params.name === "string" && params.name.trim()) canvas.name = params.name.trim().slice(0, 80);
      if (params.layout === "grid" || params.layout === "freeform") canvas.layout = params.layout;
      canvas.updatedAt = new Date().toISOString();
      return { ok: true, result: { canvas } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "canvasDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const userId = actorId(ctx);
      const map = userMap(s, "canvases", userId);
      const id = String(params.canvasId || "");
      const existed = map.delete(id);
      userMap(s, "published", userId).delete(id);
      return { ok: true, result: { deleted: existed, canvasId: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Data-source binding — connect a widget to a macro or REST endpoint.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "bindingList", (ctx, _artifact, _params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "bindings", actorId(ctx));
      const bindings = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return { ok: true, result: { bindings, count: bindings.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "bindingCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "bindings", actorId(ctx));
      const kind = params.kind === "rest" ? "rest" : "macro";
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      let target;
      if (kind === "macro") {
        const domain = String(params.domain || "").trim();
        const macro = String(params.macro || "").trim();
        if (!domain || !macro) return { ok: false, error: "macro binding needs domain + macro" };
        target = { domain, macro, input: params.input && typeof params.input === "object" ? params.input : {} };
      } else {
        const url = String(params.url || "").trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: "rest binding needs a valid http(s) url" };
        target = { url };
      }
      const binding = {
        id: nextId("bd"),
        name: name.slice(0, 80),
        kind,
        target,
        resultPath: String(params.resultPath || "").slice(0, 120),
        createdAt: new Date().toISOString(),
      };
      map.set(binding.id, binding);
      return { ok: true, result: { binding } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "bindingDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "bindings", actorId(ctx));
      const id = String(params.bindingId || "");
      return { ok: true, result: { deleted: map.delete(id), bindingId: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Test a REST binding by actually fetching it — proves the binding works
  // before the builder wires a widget to it. (macro bindings are validated
  // by the live runMacro path; rest bindings need a live probe.)
  registerLensAction("custom", "bindingTest", async (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "bindings", actorId(ctx));
      const binding = map.get(String(params.bindingId || ""));
      if (!binding) return { ok: false, error: "binding not found" };
      if (binding.kind !== "rest") {
        return { ok: true, result: { tested: false, message: "macro bindings resolve at run time via /api/lens/run" } };
      }
      const data = await cachedFetchJson(binding.target.url, { ttlMs: 60_000 });
      const isArray = Array.isArray(data);
      const sample = isArray ? data.slice(0, 3) : data;
      const fields = isArray && data[0] && typeof data[0] === "object"
        ? Object.keys(data[0])
        : (data && typeof data === "object" ? Object.keys(data) : []);
      return { ok: true, result: { tested: true, isArray, rowCount: isArray ? data.length : 1, fields, sample } };
    } catch (e) {
      return { ok: false, error: `binding unreachable: ${String(e?.message || e)}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Live preview — render a canvas config into a resolved layout descriptor
  // (widgets + their default/sample data) the frontend draws as it edits.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "previewRender", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const userId = actorId(ctx);
      const cvMap = userMap(s, "canvases", userId);
      const bdMap = userMap(s, "bindings", userId);
      let canvas = params.canvasId ? cvMap.get(String(params.canvasId)) : null;
      // Allow previewing an unsaved draft passed inline.
      if (!canvas && params.draft && typeof params.draft === "object") {
        canvas = { id: "draft", name: "Draft", layout: "grid", widgets: params.draft.widgets || [] };
      }
      if (!canvas) return { ok: false, error: "canvas not found (pass canvasId or draft)" };
      const widgets = (canvas.widgets || []).map((w) => {
        const def = COMPONENT_PALETTE.find((c) => c.type === w.type);
        const binding = w.bindingId ? bdMap.get(w.bindingId) : null;
        const issues = [];
        if (!def) issues.push(`unknown type ${w.type}`);
        if (def && def.binds && !binding) issues.push("no data source bound");
        return {
          id: w.id,
          type: w.type,
          label: def?.label || w.type,
          icon: def?.icon || "❓",
          x: w.x, y: w.y, w: w.w, h: w.h,
          props: { ...defaultPropsFor(w.type), ...(w.props || {}) },
          binding: binding ? { id: binding.id, name: binding.name, kind: binding.kind } : null,
          issues,
          renderable: issues.length === 0,
        };
      });
      return {
        ok: true,
        result: {
          canvasId: canvas.id,
          name: canvas.name,
          layout: canvas.layout || "grid",
          widgets,
          widgetCount: widgets.length,
          renderableCount: widgets.filter((w) => w.renderable).length,
          issues: widgets.flatMap((w) => w.issues.map((i) => `${w.label}: ${i}`)),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Publish a custom lens into the main lens navigation.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "publish", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const userId = actorId(ctx);
      const cvMap = userMap(s, "canvases", userId);
      const canvas = cvMap.get(String(params.canvasId || ""));
      if (!canvas) return { ok: false, error: "canvas not found" };
      if ((canvas.widgets || []).length === 0) {
        return { ok: false, error: "cannot publish an empty canvas" };
      }
      const pubMap = userMap(s, "published", userId);
      const entry = {
        canvasId: canvas.id,
        name: canvas.name,
        icon: String(params.icon || "🔧").slice(0, 4),
        navLabel: String(params.navLabel || canvas.name).slice(0, 40),
        slug: canvas.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || canvas.id,
        publishedAt: new Date().toISOString(),
        widgetCount: canvas.widgets.length,
      };
      pubMap.set(canvas.id, entry);
      return { ok: true, result: { published: entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "unpublish", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "published", actorId(ctx));
      const id = String(params.canvasId || "");
      return { ok: true, result: { unpublished: map.delete(id), canvasId: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "publishedList", (ctx, _artifact, _params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "published", actorId(ctx));
      const published = Array.from(map.values()).sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
      return { ok: true, result: { published, count: published.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Import / export — a shareable lens-definition file.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "exportCanvas", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const userId = actorId(ctx);
      const cvMap = userMap(s, "canvases", userId);
      const bdMap = userMap(s, "bindings", userId);
      const canvas = cvMap.get(String(params.canvasId || ""));
      if (!canvas) return { ok: false, error: "canvas not found" };
      // Bundle only the bindings this canvas actually references.
      const usedBindingIds = new Set(
        (canvas.widgets || []).map((w) => w.bindingId).filter(Boolean),
      );
      const bindings = Array.from(usedBindingIds)
        .map((id) => bdMap.get(id))
        .filter(Boolean);
      const definition = {
        spec: "concord-custom-lens/v1",
        exportedAt: new Date().toISOString(),
        canvas: {
          name: canvas.name,
          description: canvas.description || "",
          layout: canvas.layout || "grid",
          widgets: canvas.widgets || [],
        },
        bindings,
      };
      return { ok: true, result: { definition, filename: `${canvas.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "lens"}.concord-lens.json` } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "importCanvas", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const userId = actorId(ctx);
      const def = params.definition;
      if (!def || typeof def !== "object") return { ok: false, error: "definition object required" };
      if (def.spec !== "concord-custom-lens/v1") return { ok: false, error: "unrecognized spec — expected concord-custom-lens/v1" };
      if (!def.canvas || typeof def.canvas !== "object") return { ok: false, error: "definition missing canvas" };
      const cvMap = userMap(s, "canvases", userId);
      const bdMap = userMap(s, "bindings", userId);
      // Re-key bindings so imports never collide with existing ids.
      const remap = new Map();
      for (const b of Array.isArray(def.bindings) ? def.bindings : []) {
        if (!b || typeof b !== "object") continue;
        const newId = nextId("bd");
        remap.set(b.id, newId);
        bdMap.set(newId, {
          id: newId,
          name: String(b.name || "imported").slice(0, 80),
          kind: b.kind === "rest" ? "rest" : "macro",
          target: b.target && typeof b.target === "object" ? b.target : {},
          resultPath: String(b.resultPath || ""),
          createdAt: new Date().toISOString(),
        });
      }
      const now = new Date().toISOString();
      const widgets = (Array.isArray(def.canvas.widgets) ? def.canvas.widgets : [])
        .filter((w) => w && PALETTE_TYPES.has(w.type))
        .map((w) => ({
          id: nextId("wg"),
          type: w.type,
          x: +w.x || 0, y: +w.y || 0,
          w: Math.max(1, +w.w || 4), h: Math.max(1, +w.h || 3),
          props: { ...defaultPropsFor(w.type), ...(w.props && typeof w.props === "object" ? w.props : {}) },
          bindingId: w.bindingId && remap.has(w.bindingId) ? remap.get(w.bindingId) : null,
        }));
      const canvas = {
        id: nextId("cv"),
        name: String(def.canvas.name || "Imported Lens").slice(0, 80),
        description: String(def.canvas.description || "").slice(0, 240),
        layout: def.canvas.layout === "freeform" ? "freeform" : "grid",
        widgets,
        createdAt: now,
        updatedAt: now,
      };
      cvMap.set(canvas.id, canvas);
      return { ok: true, result: { canvas, importedBindings: remap.size, importedWidgets: widgets.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Event/action wiring — button click → macro call → refresh a widget.
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("custom", "wiringList", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "wirings", actorId(ctx));
      let wirings = Array.from(map.values());
      if (params.canvasId) wirings = wirings.filter((w) => w.canvasId === String(params.canvasId));
      wirings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { ok: true, result: { wirings, count: wirings.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "wiringCreate", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "wirings", actorId(ctx));
      const canvasId = String(params.canvasId || "");
      const sourceWidgetId = String(params.sourceWidgetId || "");
      const event = String(params.event || "click");
      if (!canvasId) return { ok: false, error: "canvasId required" };
      if (!sourceWidgetId) return { ok: false, error: "sourceWidgetId required" };
      const action = params.action && typeof params.action === "object" ? params.action : {};
      const actionKind = action.kind === "rest" ? "rest" : action.kind === "refresh" ? "refresh" : "macro";
      if (actionKind === "macro" && (!action.domain || !action.macro)) {
        return { ok: false, error: "macro action needs domain + macro" };
      }
      const wiring = {
        id: nextId("wr"),
        canvasId,
        sourceWidgetId,
        event: ["click", "submit", "change"].includes(event) ? event : "click",
        action: {
          kind: actionKind,
          domain: action.domain ? String(action.domain) : null,
          macro: action.macro ? String(action.macro) : null,
          input: action.input && typeof action.input === "object" ? action.input : {},
        },
        refreshWidgetId: params.refreshWidgetId ? String(params.refreshWidgetId) : null,
        createdAt: new Date().toISOString(),
      };
      map.set(wiring.id, wiring);
      return { ok: true, result: { wiring } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("custom", "wiringDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getCustomState();
      const map = userMap(s, "wirings", actorId(ctx));
      const id = String(params.wiringId || "");
      return { ok: true, result: { deleted: map.delete(id), wiringId: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
