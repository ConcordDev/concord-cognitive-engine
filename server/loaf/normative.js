import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF III.4 — Normative Modules (No Drift)
 *
 * - Ethics (non-valence)
 * - Legal rule sets
 * - Domain norms
 *
 * Properties:
 * - Versioned
 * - Forkable
 * - Council-governed
 * - Never auto-learned
 */

const NORMATIVE_TYPES = Object.freeze({
  ETHICS: "ethics",
  LEGAL: "legal",
  DOMAIN_NORM: "domain_norm",
});

// Normative module store
const modules = new LruMap(); // moduleId -> NormativeModule

/**
 * Create a normative module.
 * Normative modules are NEVER auto-learned — they require explicit creation.
 */
function createModule(type, name, rules, actor) {
  if (!actor || !["owner", "founder", "admin", "council"].includes(actor.role)) {
    return { ok: false, error: "normative_modules_require_council_governance" };
  }

  if (!Object.values(NORMATIVE_TYPES).includes(type)) {
    return { ok: false, error: `invalid_type: must be one of ${Object.values(NORMATIVE_TYPES).join(", ")}` };
  }

  const id = `norm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const mod = {
    id,
    type,
    name: String(name),
    version: 1,
    rules: Array.isArray(rules) ? rules.map(r => ({
      id: `rule_${Math.random().toString(36).slice(2, 8)}`,
      text: String(r.text || r),
      severity: r.severity || "must",  // "must" | "should" | "may"
      active: true,
    })) : [],
    forks: [],
    history: [{
      version: 1,
      action: "created",
      actor: actor.id || "unknown",
      ts: new Date().toISOString(),
      rules: null, // initial — no previous
    }],
    autoLearn: false,  // ALWAYS false — normative modules are never auto-learned
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: actor.id || "unknown",
  };

  modules.set(id, mod);
  return { ok: true, module: sanitizeModule(mod) };
}

/**
 * Update a normative module's rules. Council-governed: requires authorized actor.
 */
function updateModule(moduleId, updatedRules, actor) {
  if (!actor || !["owner", "founder", "admin", "council"].includes(actor.role)) {
    return { ok: false, error: "council_governance_required" };
  }

  const mod = modules.get(moduleId);
  if (!mod) return { ok: false, error: "module_not_found" };

  // Save history before update
  mod.history.push({
    version: mod.version,
    action: "updated",
    actor: actor.id || "unknown",
    ts: new Date().toISOString(),
    previousRules: mod.rules.map(r => ({ ...r })),
  });

  mod.version++;
  mod.rules = Array.isArray(updatedRules) ? updatedRules.map(r => ({
    id: r.id || `rule_${Math.random().toString(36).slice(2, 8)}`,
    text: String(r.text || r),
    severity: r.severity || "must",
    active: r.active !== false,
  })) : mod.rules;
  mod.updatedAt = new Date().toISOString();

  return { ok: true, module: sanitizeModule(mod) };
}

/**
 * Fork a normative module (creates an independent copy).
 */
function forkModule(moduleId, newName, actor) {
  if (!actor || !["owner", "founder", "admin", "council"].includes(actor.role)) {
    return { ok: false, error: "council_governance_required" };
  }

  const source = modules.get(moduleId);
  if (!source) return { ok: false, error: "module_not_found" };

  const forkId = `norm_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const forked = {
    id: forkId,
    type: source.type,
    name: String(newName || `Fork of ${source.name}`),
    version: 1,
    rules: source.rules.map(r => ({ ...r, id: `rule_${Math.random().toString(36).slice(2, 8)}` })),
    forks: [],
    history: [{
      version: 1,
      action: "forked",
      actor: actor.id || "unknown",
      ts: new Date().toISOString(),
      sourceModule: moduleId,
      sourceVersion: source.version,
    }],
    autoLearn: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: actor.id || "unknown",
    sourceModule: moduleId,
  };

  modules.set(forkId, forked);
  source.forks.push({ forkId, forkedAt: forked.createdAt, forkedBy: actor.id });

  return { ok: true, module: sanitizeModule(forked), sourceModule: moduleId };
}

/**
 * Evaluate content against a normative module.
 * Returns violations and compliance report.
 */
function evaluate(moduleId, content) {
  const mod = modules.get(moduleId);
  if (!mod) return { ok: false, error: "module_not_found" };

  const text = String(content.text || content.content || content).toLowerCase();
  const violations = [];
  const compliant = [];

  for (const rule of mod.rules) {
    if (!rule.active) continue;

    const ruleText = rule.text.toLowerCase();

    // Simple rule evaluation: check if content violates the rule's intent
    // Negative rules (prohibitions)
    const prohibitionMatch = ruleText.match(/\b(must not|shall not|cannot|prohibited|forbidden|never)\b/);
    const requirementMatch = ruleText.match(/\b(must|shall|required|always|mandatory)\b/);

    if (prohibitionMatch) {
      // Extract the prohibited action
      const actionWords = ruleText.split(/must not|shall not|cannot|prohibited|forbidden|never/)
        .pop()?.trim().split(/\s+/).filter(w => w.length > 3) || [];
      const violates = actionWords.some(w => text.includes(w));
      if (violates) {
        violations.push({ rule: rule.text, severity: rule.severity, ruleId: rule.id });
      } else {
        compliant.push({ rule: rule.text, ruleId: rule.id });
      }
    } else if (requirementMatch) {
      // Requirement rules — harder to check automatically
      compliant.push({ rule: rule.text, ruleId: rule.id, note: "requirement_assumed_met" });
    } else {
      compliant.push({ rule: rule.text, ruleId: rule.id, note: "advisory" });
    }
  }

  return {
    ok: true,
    moduleId,
    moduleName: mod.name,
    moduleType: mod.type,
    violations,
    compliant,
    isCompliant: violations.length === 0,
    mustViolations: violations.filter(v => v.severity === "must").length,
    shouldViolations: violations.filter(v => v.severity === "should").length,
  };
}

/**
 * Revert a module to a previous version.
 */
function revertModule(moduleId, toVersion, actor) {
  if (!actor || !["owner", "founder", "admin", "council"].includes(actor.role)) {
    return { ok: false, error: "council_governance_required" };
  }

  const mod = modules.get(moduleId);
  if (!mod) return { ok: false, error: "module_not_found" };

  const targetHistory = mod.history.find(h => h.version === toVersion && h.previousRules);
  if (!targetHistory) return { ok: false, error: "version_not_found_or_no_previous_rules" };

  mod.history.push({
    version: mod.version,
    action: "reverted",
    actor: actor.id || "unknown",
    ts: new Date().toISOString(),
    revertedTo: toVersion,
    previousRules: mod.rules.map(r => ({ ...r })),
  });

  mod.rules = targetHistory.previousRules.map(r => ({ ...r }));
  mod.version++;
  mod.updatedAt = new Date().toISOString();

  return { ok: true, module: sanitizeModule(mod), revertedToVersion: toVersion };
}

function sanitizeModule(mod) {
  return {
    id: mod.id,
    type: mod.type,
    name: mod.name,
    version: mod.version,
    ruleCount: mod.rules.length,
    activeRules: mod.rules.filter(r => r.active).length,
    forkCount: mod.forks.length,
    autoLearn: mod.autoLearn,
    createdAt: mod.createdAt,
    updatedAt: mod.updatedAt,
    createdBy: mod.createdBy,
  };
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.normative = {
    stats: { modulesCreated: 0, modulesUpdated: 0, modulesForks: 0, evaluations: 0, violations: 0 },
  };

  register("loaf.normative", "status", (ctx) => {
    const n = ctx.state.__loaf.normative;
    const byType = {};
    for (const type of Object.values(NORMATIVE_TYPES)) {
      byType[type] = Array.from(modules.values()).filter(m => m.type === type).length;
    }
    return {
      ok: true,
      totalModules: modules.size,
      byType,
      types: NORMATIVE_TYPES,
      stats: n.stats,
    };
  }, { public: true });

  register("loaf.normative", "create", (ctx, input = {}) => {
    const n = ctx.state.__loaf.normative;
    const result = createModule(input.type, input.name, input.rules, ctx.actor);
    if (result.ok) n.stats.modulesCreated++;
    return result;
  }, { public: false });

  register("loaf.normative", "update", (ctx, input = {}) => {
    const n = ctx.state.__loaf.normative;
    const result = updateModule(String(input.moduleId || ""), input.rules, ctx.actor);
    if (result.ok) n.stats.modulesUpdated++;
    return result;
  }, { public: false });

  register("loaf.normative", "fork", (ctx, input = {}) => {
    const n = ctx.state.__loaf.normative;
    const result = forkModule(String(input.moduleId || ""), input.name, ctx.actor);
    if (result.ok) n.stats.modulesForks++;
    return result;
  }, { public: false });

  register("loaf.normative", "evaluate", (ctx, input = {}) => {
    const n = ctx.state.__loaf.normative;
    n.stats.evaluations++;
    const result = evaluate(String(input.moduleId || ""), input.content || input);
    if (result.ok && result.violations.length > 0) n.stats.violations += result.violations.length;
    return result;
  }, { public: true });

  register("loaf.normative", "revert", (ctx, input = {}) => {
    return revertModule(String(input.moduleId || ""), input.toVersion, ctx.actor);
  }, { public: false });

  register("loaf.normative", "get", (_ctx, input = {}) => {
    const mod = modules.get(String(input.moduleId || ""));
    if (!mod) return { ok: false, error: "module_not_found" };
    return { ok: true, module: sanitizeModule(mod), rules: mod.rules, history: mod.history };
  }, { public: true });

  register("loaf.normative", "list", (_ctx, input = {}) => {
    let list = Array.from(modules.values());
    if (input.type) list = list.filter(m => m.type === input.type);
    return { ok: true, modules: list.map(sanitizeModule) };
  }, { public: true });
}

export {
  NORMATIVE_TYPES,
  createModule,
  updateModule,
  forkModule,
  evaluate,
  revertModule,
  init,
};
