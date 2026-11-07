/**
 * System: App Maker
 *
 * Users create apps ON Concord by composing existing primitives (Artifact,
 * Execution, Governance) with custom UI extensions. A fitness tracker is just
 * Artifact (logs) + Execution (macros) + custom view. No new core objects —
 * ever. Just new compositions of existing ones.
 *
 * Lifecycle: DRAFT → PUBLISHED → MARKETPLACE → GLOBAL
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "app") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_FIELD_TYPES = ["string", "number", "boolean", "date", "array", "object", "reference"];
const PROMOTION_STAGES = ["draft", "published", "marketplace", "global"];

// ── Module State ────────────────────────────────────────────────────────────

const _apps = new Map();

// ── Validation ──────────────────────────────────────────────────────────────

function macroExists(macroName) {
  const MACROS = globalThis._concordMACROS;
  if (!MACROS) return false;
  for (const [, domainMap] of MACROS.entries()) {
    if (domainMap.has(macroName)) return true;
  }
  return false;
}

export function validateApp(appSpec) {
  const violations = [];

  if (!appSpec.name) violations.push("App name is required");
  if (!appSpec.primitives) violations.push("Primitives section is required");

  // Every field must map to an existing primitive type
  if (appSpec.primitives?.artifacts?.schema) {
    for (const [artifactType, schema] of Object.entries(appSpec.primitives.artifacts.schema)) {
      if (!schema.fields || !Array.isArray(schema.fields)) {
        violations.push(`Schema for ${artifactType} must have a fields array`);
        continue;
      }
      for (const field of schema.fields) {
        if (!ALLOWED_FIELD_TYPES.includes(field.type)) {
          violations.push(`Field ${field.name} has invalid type ${field.type}`);
        }
      }
    }
  }

  // Every macro must either exist or be defined in-app
  if (appSpec.primitives?.execution?.macros) {
    for (const macro of appSpec.primitives.execution.macros) {
      if (!macroExists(macro) && !appSpec._inlineMacros?.[macro]) {
        violations.push(`Macro ${macro} not found`);
      }
    }
  }

  // UI panels must reference defined artifact types
  if (appSpec.ui?.panels && appSpec.primitives?.artifacts?.types) {
    for (const panel of appSpec.ui.panels) {
      if (panel.source && !appSpec.primitives.artifacts.types.includes(panel.source)) {
        violations.push(`Panel references undefined type ${panel.source}`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createApp(spec) {
  const id = uid("app");
  const app = {
    id,
    name: spec.name || "Untitled App",
    version: spec.version || "1.0.0",
    author: spec.author || "anonymous",
    status: "draft",
    _promotionStage: "draft",
    primitives: spec.primitives || { artifacts: { types: [], schema: {} }, execution: { macros: [] }, governance: { council_gated: false } },
    ui: spec.ui || { lens: "custom", layout: "dashboard", panels: [] },
    _inlineMacros: spec._inlineMacros || {},
    _invariant: "All fields map to Identity, Artifact, Execution, Governance, Memory, or Economy primitives. No new core objects.",
    _useCount: 0,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    publishedAt: null,
  };

  // Validate before saving
  const validation = validateApp(app);
  app._lastValidation = validation;

  _apps.set(id, app);

  // Emit
  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("app:created", { id, name: app.name });
  }

  return { ok: true, app: { id, name: app.name, status: app.status, valid: validation.valid } };
}

export function getApp(id) {
  const app = _apps.get(id);
  if (!app) return { ok: false, error: "App not found" };
  return { ok: true, app };
}

export function listApps(filter = {}) {
  let apps = Array.from(_apps.values());
  if (filter.status) apps = apps.filter(a => a.status === filter.status);
  if (filter.author) apps = apps.filter(a => a.author === filter.author);

  return {
    ok: true,
    apps: apps.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      author: a.author,
      version: a.version,
      createdAt: a.createdAt,
    })),
  };
}

export function updateApp(id, updates) {
  const app = _apps.get(id);
  if (!app) return { ok: false, error: "App not found" };
  if (app.status !== "draft") return { ok: false, error: "Can only edit draft apps" };

  if (updates.name) app.name = updates.name;
  if (updates.version) app.version = updates.version;
  if (updates.primitives) app.primitives = updates.primitives;
  if (updates.ui) app.ui = updates.ui;
  if (updates._inlineMacros) app._inlineMacros = updates._inlineMacros;
  app.updatedAt = nowISO();

  const validation = validateApp(app);
  app._lastValidation = validation;

  return { ok: true, app: { id, name: app.name, valid: validation.valid, violations: validation.violations } };
}

export function deleteApp(id) {
  const app = _apps.get(id);
  if (!app) return { ok: false, error: "App not found" };
  if (app.status !== "draft") return { ok: false, error: "Can only delete draft apps" };
  _apps.delete(id);
  return { ok: true, deleted: id };
}

// ── Promote ─────────────────────────────────────────────────────────────────

export function promoteApp(id) {
  const app = _apps.get(id);
  if (!app) return { ok: false, error: "App not found" };

  const currentIdx = PROMOTION_STAGES.indexOf(app._promotionStage || "draft");
  if (currentIdx < 0 || currentIdx >= PROMOTION_STAGES.length - 1) {
    return { ok: false, error: "Already at max stage" };
  }

  // Validate before promotion
  const validation = validateApp(app);
  if (!validation.valid) {
    return { ok: false, error: "App has validation errors", violations: validation.violations };
  }

  const nextStage = PROMOTION_STAGES[currentIdx + 1];
  app._promotionStage = nextStage;
  app.status = nextStage;
  app.updatedAt = nowISO();
  if (nextStage === "published" && !app.publishedAt) app.publishedAt = nowISO();

  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("app:published", { id, name: app.name, stage: nextStage });
  }

  return { ok: true, id, stage: nextStage };
}

export function demoteApp(id) {
  const app = _apps.get(id);
  if (!app) return { ok: false, error: "App not found" };

  const currentIdx = PROMOTION_STAGES.indexOf(app._promotionStage || "draft");
  if (currentIdx <= 0) return { ok: false, error: "Already at draft" };

  const prevStage = PROMOTION_STAGES[currentIdx - 1];
  app._promotionStage = prevStage;
  app.status = prevStage;
  app.updatedAt = nowISO();

  return { ok: true, id, stage: prevStage };
}

// ── Pipeline ownership + the Studio projection (B7) ─────────────────────────
// Founder ruling (decision walk #1, Decision 11): promote is an OWNER
// action, checked against ownership — never a platform role. The REST layer
// in server.js enforces it with these helpers; the check compares the app's
// recorded author against the authenticated caller's key. The create route
// stamps that author from the session, so the field is a record of who was
// authenticated — never a value the request body asserted.

/** The identity key an app record's `author` is stamped and checked with. */
export function appCallerKey(user) {
  if (!user || typeof user !== "object") return null;
  for (const k of [user.userId, user.id, user.username]) {
    if (typeof k === "string" && k.trim()) return k;
    if (typeof k === "number") return String(k);
  }
  return null;
}

export function isAppOwner(app, callerKey) {
  return !!app && typeof callerKey === "string" && callerKey !== "" && app.author === callerKey;
}

// Studio projects (the appmaker domain's per-user store) are app objects in
// the same pipeline. Their deployment vocabulary maps onto the promotion
// stages exactly once, here: undeployed -> draft, snapshotted -> published.
// Nothing in the mapping claims a hosted URL — deploy stays a snapshot verb.
// A project's own stage, once advanced past what its deployment implies,
// lives on the record as _pipelineStage and wins.
export function projectStage(project) {
  if (!project) return "draft";
  if (project._pipelineStage && PROMOTION_STAGES.includes(project._pipelineStage)) return project._pipelineStage;
  return project.deployment?.status === "snapshotted" ? "published" : "draft";
}

export function projectAsApp(project, ownerKey) {
  return {
    id: project.id,
    name: project.name,
    status: projectStage(project),
    author: ownerKey,
    // Projects predate per-project versioning; the platform's own default
    // version (createApp's) is the baseline, and the snapshot count rides
    // separately rather than dressing itself as a version.
    version: "1.0.0",
    createdAt: project.createdAt,
    source: "studio",
    deploymentStatus: project.deployment?.status || "undeployed",
    snapshotCount: Array.isArray(project.versions) ? project.versions.length : 0,
  };
}

/**
 * Collect a caller's Studio projects from the appmaker domain store
 * (STATE.appMakerLens.projects: userId -> project[]). The domain keys its
 * map by the lens actor's userId; the REST caller's key candidates are
 * tried in order, so the projection finds the caller's own shelf whichever
 * identity form was recorded. Other accounts' shelves are never read.
 */
export function collectCallerProjects(appMakerState, user) {
  const out = [];
  const projects = appMakerState?.projects;
  if (!(projects instanceof Map)) return out;
  const keys = [];
  for (const k of [user?.userId, user?.id, user?.username]) {
    if (typeof k === "string" && k && !keys.includes(k)) keys.push(k);
  }
  const seenIds = new Set();
  for (const key of keys) {
    const shelf = projects.get(key);
    if (!Array.isArray(shelf)) continue;
    for (const project of shelf) {
      if (!project?.id || seenIds.has(project.id)) continue;
      seenIds.add(project.id);
      out.push({ project, ownerKey: key });
    }
  }
  return out;
}

/**
 * Advance a Studio project's pipeline stage by one. Leaving draft requires
 * the snapshot that 'published' names: a project with no snapshot refuses
 * in words rather than claiming a published state nothing backs.
 */
export function promoteProject(project) {
  if (!project) return { ok: false, error: "Project not found" };
  const current = projectStage(project);
  const idx = PROMOTION_STAGES.indexOf(current);
  if (idx < 0 || idx >= PROMOTION_STAGES.length - 1) return { ok: false, error: "Already at max stage" };
  const next = PROMOTION_STAGES[idx + 1];
  if (current === "draft" && next === "published" && project.deployment?.status !== "snapshotted") {
    return { ok: false, error: "Deploy (snapshot) the project in Studio before promoting it to published" };
  }
  project._pipelineStage = next;
  project.updatedAt = nowISO();
  return { ok: true, id: project.id, stage: next };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function countApps() {
  return _apps.size;
}

export function countAppsByStage() {
  const counts = {};
  for (const stage of PROMOTION_STAGES) counts[stage] = 0;
  for (const app of _apps.values()) {
    const stage = app._promotionStage || "draft";
    counts[stage] = (counts[stage] || 0) + 1;
  }
  return counts;
}

export function getAppMetrics() {
  return {
    ok: true,
    total: _apps.size,
    byStage: countAppsByStage(),
  };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleAppCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "app-list":
      return listApps();
    case "app-status":
      return getApp(parts[1]);
    case "app-promote":
      return promoteApp(parts[1]);
    case "app-demote":
      return demoteApp(parts[1]);
    case "app-validate":
      return getApp(parts[1]).ok ? validateApp(_apps.get(parts[1])) : { ok: false, error: "App not found" };
    default:
      return { ok: false, error: `Unknown app command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// No-op lifecycle hook: this module needs no init-time wiring. The
// parameters it used to destructure were never referenced, which read as
// though STATE/helpers were used here. Callers still pass them; extra
// arguments are simply ignored, so the interface is unchanged.
export function init() {
  return { ok: true };
}
