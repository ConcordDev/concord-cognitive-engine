// server/lib/usb-framework.js
//
// Unified Skill/Bus (USB) registry — minimal LIVE implementation.
// register / list / invoke with optional F0 AuthGate hook on invoke.

/** @typedef {{ id: string, description?: string, handler: Function, risk?: string, meta?: object }} UsbSkill */

/** @type {Map<string, UsbSkill>} */
const SKILLS = new Map();

let _evaluate = null;
let _buildEnvelope = null;
let _f0Loaded = false;

async function loadF0() {
  if (_f0Loaded) return;
  _f0Loaded = true;
  try {
    const ag = await import("./auth-gate/index.js");
    _evaluate = ag.evaluate || null;
    _buildEnvelope = ag.buildEnvelope || null;
  } catch {
    _evaluate = null;
    _buildEnvelope = null;
  }
}

/**
 * Register a skill on the unified bus.
 * @param {string} id
 * @param {Function} handler
 * @param {{ description?: string, risk?: string, meta?: object }} [opts]
 */
export function register(id, handler, opts = {}) {
  if (!id || typeof id !== "string") throw new Error("usb.register: id required");
  if (typeof handler !== "function") throw new Error(`usb.register(${id}): handler must be a function`);
  SKILLS.set(id, {
    id,
    description: opts.description || "",
    handler,
    risk: opts.risk || "read",
    meta: opts.meta || {},
  });
  return { ok: true, id };
}

/** List registered skills (metadata only). */
export function list() {
  return [...SKILLS.values()].map((s) => ({
    id: s.id,
    description: s.description,
    risk: s.risk,
    meta: s.meta,
  }));
}

export function has(id) {
  return SKILLS.has(id);
}

export function clear() {
  SKILLS.clear();
}

/**
 * Optional F0 gate before invoke. Soft-fail to OBSERVE when AuthGate is
 * unavailable so unit/smoke still works offline.
 */
async function f0Gate(id, args, ctx = {}) {
  await loadF0();
  if (!_evaluate || !_buildEnvelope) {
    return { allowed: true, decision: "OBSERVE", reason: "f0_unavailable_observe" };
  }
  try {
    const envelope = _buildEnvelope({
      tool: `usb.invoke.${id}`,
      why: ctx.why || "usb_skill_invoke",
      scope: ctx.scope || [`usb:${id}`],
      resource: ctx.resource || { tool_budget: 1 },
      ctx: ctx.f0Ctx || { actor: { id: ctx.who || "usb-framework" } },
      provenance: { source: "usb-framework", skill: id },
      ttlMs: ctx.ttlMs || 60_000,
    });
    const result = await _evaluate(envelope, {
      ...(ctx.f0Ctx || {}),
      observe_only: ctx.observe_only !== false,
    });
    const decision = result?.decision || "DENY";
    const allowed =
      decision === "ALLOW" ||
      decision === "OBSERVE" ||
      (ctx.observe_only !== false && decision !== "DENY");
    return {
      allowed: !!allowed,
      decision,
      reason: result?.reason_code || null,
      gates_run: result?.gates_run,
    };
  } catch (e) {
    return { allowed: true, decision: "OBSERVE", reason: `f0_error:${e?.message || e}` };
  }
}

/**
 * Invoke a registered skill (after F0 gate hook).
 */
export async function invoke(id, args = {}, ctx = {}) {
  if (!SKILLS.has(id)) {
    return { ok: false, error: "skill_not_found", id };
  }
  const gate = await f0Gate(id, args, ctx);
  if (!gate.allowed) {
    return { ok: false, error: "f0_denied", id, gate };
  }
  const skill = SKILLS.get(id);
  try {
    const result = await skill.handler(args, ctx);
    return { ok: true, id, result, gate };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), id, gate };
  }
}

/** Sync invoke for smoke/tests (no F0). Prefer invoke(). */
export function invokeSync(id, args = {}, ctx = {}) {
  if (!SKILLS.has(id)) return { ok: false, error: "skill_not_found", id };
  const skill = SKILLS.get(id);
  try {
    const result = skill.handler(args, ctx);
    return { ok: true, id, result, gate: { allowed: true, decision: "OBSERVE", reason: "sync_no_f0" } };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), id };
  }
}

export const usb = { register, list, has, clear, invoke, invokeSync };
export default usb;

export const listSkills = list;
export const registerSkill = register;
export const invokeSkill = invoke;
