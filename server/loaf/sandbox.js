import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF II.6 — Agent & App Sandboxes
 *
 * Agents run with:
 *   explicit budgets, scoped memory, explicit permissions,
 *   forced audit trails, kill switch
 *
 * Apps defined by:
 *   manifest, uiSchema, logicSchema, stateSchema,
 *   safety limits, wrapper allowlist
 */

const SANDBOX_DEFAULTS = Object.freeze({
  maxBudget: 1000,
  maxMemoryItems: 500,
  maxExecutionTimeMs: 60000,       // 1 minute
  defaultPermissions: ["read"],
  auditEnabled: true,
});

// Active sandboxes
const sandboxes = new LruMap();  // sandboxId -> Sandbox

/**
 * Create an agent sandbox.
 */
function createAgentSandbox(agentId, config = {}) {
  const id = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const sandbox = {
    id,
    type: "agent",
    agentId: String(agentId),
    budget: {
      total: Number(config.budget || SANDBOX_DEFAULTS.maxBudget),
      used: 0,
      remaining: Number(config.budget || SANDBOX_DEFAULTS.maxBudget),
    },
    memory: {
      items: new Map(),
      maxItems: Number(config.maxMemoryItems || SANDBOX_DEFAULTS.maxMemoryItems),
    },
    permissions: Array.isArray(config.permissions)
      ? config.permissions
      : [...SANDBOX_DEFAULTS.defaultPermissions],
    auditTrail: [],
    status: "active",  // "active" | "suspended" | "killed"
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    maxExecutionTimeMs: Number(config.maxExecutionTimeMs || SANDBOX_DEFAULTS.maxExecutionTimeMs),
    killSwitch: { enabled: true, reason: null, killedAt: null },
  };

  sandboxes.set(id, sandbox);
  return { ok: true, sandbox: sanitizeSandbox(sandbox) };
}

/**
 * Create an app sandbox from a manifest.
 */
function createAppSandbox(manifest) {
  if (!manifest || !manifest.name) return { ok: false, error: "manifest with name required" };

  const id = `app_sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const sandbox = {
    id,
    type: "app",
    appName: String(manifest.name),
    manifest: {
      name: String(manifest.name),
      version: String(manifest.version || "1.0"),
      description: String(manifest.description || ""),
    },
    uiSchema: manifest.uiSchema || {},
    logicSchema: manifest.logicSchema || {},
    stateSchema: manifest.stateSchema || {},
    safetyLimits: {
      maxStateSize: Number(manifest.safetyLimits?.maxStateSize || 10000),
      maxOpsPerSecond: Number(manifest.safetyLimits?.maxOpsPerSecond || 100),
      maxMemoryMb: Number(manifest.safetyLimits?.maxMemoryMb || 50),
    },
    wrapperAllowlist: Array.isArray(manifest.wrapperAllowlist)
      ? manifest.wrapperAllowlist.map(String)
      : [],
    budget: {
      total: Number(manifest.budget || SANDBOX_DEFAULTS.maxBudget),
      used: 0,
      remaining: Number(manifest.budget || SANDBOX_DEFAULTS.maxBudget),
    },
    memory: {
      items: new Map(),
      maxItems: Number(manifest.maxMemoryItems || SANDBOX_DEFAULTS.maxMemoryItems),
    },
    permissions: Array.isArray(manifest.permissions)
      ? manifest.permissions
      : [...SANDBOX_DEFAULTS.defaultPermissions],
    auditTrail: [],
    status: "active",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    killSwitch: { enabled: true, reason: null, killedAt: null },
  };

  sandboxes.set(id, sandbox);
  return { ok: true, sandbox: sanitizeSandbox(sandbox) };
}

/**
 * Consume budget within a sandbox.
 */
function consumeSandboxBudget(sandboxId, cost) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox) return { ok: false, error: "sandbox_not_found" };
  if (sandbox.status !== "active") return { ok: false, error: `sandbox_${sandbox.status}` };

  const effectiveCost = Math.max(0, Number(cost || 1));
  if (sandbox.budget.used + effectiveCost > sandbox.budget.total) {
    audit(sandbox, "budget_exceeded", { cost: effectiveCost, used: sandbox.budget.used, total: sandbox.budget.total });
    return { ok: false, error: "budget_exceeded", remaining: sandbox.budget.remaining };
  }

  sandbox.budget.used += effectiveCost;
  sandbox.budget.remaining = sandbox.budget.total - sandbox.budget.used;
  audit(sandbox, "budget_consumed", { cost: effectiveCost });
  return { ok: true, remaining: sandbox.budget.remaining };
}

/**
 * Check if a sandbox has a permission.
 */
function checkPermission(sandboxId, permission) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox) return { ok: false, error: "sandbox_not_found" };
  if (sandbox.status !== "active") return { ok: false, error: `sandbox_${sandbox.status}` };

  const has = sandbox.permissions.includes("*") || sandbox.permissions.includes(permission);
  if (!has) {
    audit(sandbox, "permission_denied", { permission });
  }
  return { ok: true, allowed: has, permission };
}

/**
 * Write to scoped memory.
 */
function writeMemory(sandboxId, key, value) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox) return { ok: false, error: "sandbox_not_found" };
  if (sandbox.status !== "active") return { ok: false, error: `sandbox_${sandbox.status}` };

  if (sandbox.memory.items.size >= sandbox.memory.maxItems && !sandbox.memory.items.has(key)) {
    return { ok: false, error: "memory_limit_reached" };
  }

  sandbox.memory.items.set(key, { value, updatedAt: new Date().toISOString() });
  audit(sandbox, "memory_write", { key });
  return { ok: true };
}

/**
 * Read from scoped memory.
 */
function readMemory(sandboxId, key) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox) return { ok: false, error: "sandbox_not_found" };

  const item = sandbox.memory.items.get(key);
  return item ? { ok: true, value: item.value } : { ok: false, error: "key_not_found" };
}

/**
 * Kill switch — immediately terminate a sandbox.
 */
function killSandbox(sandboxId, reason) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox) return { ok: false, error: "sandbox_not_found" };

  sandbox.status = "killed";
  sandbox.killSwitch.reason = String(reason || "manual");
  sandbox.killSwitch.killedAt = new Date().toISOString();
  audit(sandbox, "killed", { reason: sandbox.killSwitch.reason });
  return { ok: true, sandbox: sanitizeSandbox(sandbox) };
}

/**
 * Add an audit trail entry.
 */
function audit(sandbox, action, details = {}) {
  if (!SANDBOX_DEFAULTS.auditEnabled) return;
  sandbox.auditTrail.push({
    action,
    details,
    ts: new Date().toISOString(),
  });
  // Cap audit trail
  if (sandbox.auditTrail.length > 1000) {
    sandbox.auditTrail.splice(0, sandbox.auditTrail.length - 1000);
  }
}

/**
 * Check execution time limit.
 */
function enforceTimeLimit(sandboxId) {
  const sandbox = sandboxes.get(sandboxId);
  if (!sandbox || sandbox.status !== "active") return { ok: true, expired: false };

  const elapsed = Date.now() - new Date(sandbox.startedAt).getTime();
  if (elapsed > sandbox.maxExecutionTimeMs) {
    sandbox.status = "killed";
    sandbox.killSwitch.reason = "execution_time_exceeded";
    sandbox.killSwitch.killedAt = new Date().toISOString();
    audit(sandbox, "time_limit_exceeded", { elapsed, limit: sandbox.maxExecutionTimeMs });
    return { ok: true, expired: true, elapsed };
  }

  return { ok: true, expired: false, elapsed, remaining: sandbox.maxExecutionTimeMs - elapsed };
}

/**
 * Sanitize sandbox for external output (strip internal Maps).
 */
function sanitizeSandbox(sandbox) {
  return {
    id: sandbox.id,
    type: sandbox.type,
    agentId: sandbox.agentId,
    appName: sandbox.appName,
    budget: { ...sandbox.budget },
    memorySize: sandbox.memory.items.size,
    memoryMax: sandbox.memory.maxItems,
    permissions: sandbox.permissions,
    status: sandbox.status,
    createdAt: sandbox.createdAt,
    killSwitch: { ...sandbox.killSwitch },
    auditCount: sandbox.auditTrail.length,
  };
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.sandbox = {
    stats: { agentsCreated: 0, appsCreated: 0, killed: 0, budgetExceeded: 0 },
  };

  register("loaf.sandbox", "status", (ctx) => {
    const s = ctx.state.__loaf.sandbox;
    const active = Array.from(sandboxes.values()).filter(s => s.status === "active");
    return {
      ok: true,
      totalSandboxes: sandboxes.size,
      activeSandboxes: active.length,
      stats: s.stats,
    };
  }, { public: true });

  register("loaf.sandbox", "create_agent", (ctx, input = {}) => {
    const s = ctx.state.__loaf.sandbox;
    const result = createAgentSandbox(input.agentId || "agent", input);
    if (result.ok) s.stats.agentsCreated++;
    return result;
  }, { public: false });

  register("loaf.sandbox", "create_app", (ctx, input = {}) => {
    const s = ctx.state.__loaf.sandbox;
    const result = createAppSandbox(input.manifest || input);
    if (result.ok) s.stats.appsCreated++;
    return result;
  }, { public: false });

  register("loaf.sandbox", "consume_budget", (_ctx, input = {}) => {
    return consumeSandboxBudget(String(input.sandboxId || ""), input.cost);
  }, { public: false });

  register("loaf.sandbox", "check_permission", (_ctx, input = {}) => {
    return checkPermission(String(input.sandboxId || ""), String(input.permission || ""));
  }, { public: true });

  register("loaf.sandbox", "write_memory", (_ctx, input = {}) => {
    return writeMemory(String(input.sandboxId || ""), String(input.key || ""), input.value);
  }, { public: false });

  register("loaf.sandbox", "read_memory", (_ctx, input = {}) => {
    return readMemory(String(input.sandboxId || ""), String(input.key || ""));
  }, { public: true });

  register("loaf.sandbox", "kill", (ctx, input = {}) => {
    const s = ctx.state.__loaf.sandbox;
    const result = killSandbox(String(input.sandboxId || ""), input.reason);
    if (result.ok) s.stats.killed++;
    return result;
  }, { public: false });

  register("loaf.sandbox", "list", (_ctx) => {
    const list = Array.from(sandboxes.values()).map(sanitizeSandbox);
    return { ok: true, sandboxes: list };
  }, { public: true });

  register("loaf.sandbox", "audit_trail", (_ctx, input = {}) => {
    const sandbox = sandboxes.get(String(input.sandboxId || ""));
    if (!sandbox) return { ok: false, error: "sandbox_not_found" };
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, trail: sandbox.auditTrail.slice(-limit) };
  }, { public: true });
}

export {
  SANDBOX_DEFAULTS,
  createAgentSandbox,
  createAppSandbox,
  consumeSandboxBudget,
  checkPermission,
  writeMemory,
  readMemory,
  killSandbox,
  enforceTimeLimit,
  init,
};
