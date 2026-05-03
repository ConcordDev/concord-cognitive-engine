// server/emergent/heartbeat-registry.js
//
// Runtime tick-scheduling registry. Heartbeat modules register a frequency
// and handler; the governor tick iterates registered modules and fires
// the ones whose `tickCount % frequency === 0`.
//
// This is orthogonal to module-registry.js (which is auto-generated metadata
// describing the emergent module dependency graph). The runtime registry
// here lets new heartbeat modules slot in with a one-liner instead of
// editing governorTick() directly.
//
// Per the project invariant in CLAUDE.md: a module crash must never stop
// the tick. Every handler is wrapped in try/catch.

import logger from "../logger.js";

/** @typedef {{ id: string, frequency: number, handler: Function, neverDisable?: boolean }} RegistryEntry */

/** @type {Map<string, RegistryEntry>} */
const REGISTRY = new Map();

/**
 * Register a heartbeat module.
 * @param {string} id - Stable identifier (used in logs and disable lists).
 * @param {object} opts
 * @param {number} opts.frequency - Run on every Nth tick (1 = every tick).
 * @param {(ctx: { state: object, db: object, tickCount: number, reason: string }) => Promise<void>|void} opts.handler
 * @param {boolean} [opts.neverDisable] - If true, runs even when STATE.settings.disabledHeartbeats includes id.
 */
export function registerHeartbeat(id, { frequency, handler, neverDisable = false }) {
  if (!id || typeof id !== "string") throw new Error("registerHeartbeat: id required");
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`registerHeartbeat(${id}): frequency must be a positive integer`);
  }
  if (typeof handler !== "function") throw new Error(`registerHeartbeat(${id}): handler must be a function`);
  REGISTRY.set(id, { id, frequency, handler, neverDisable });
}

/**
 * Iterate all registered modules and run those whose tick is due.
 * Each handler is independently try/caught — one failure cannot stop others.
 *
 * @param {{ state: object, db: object, tickCount: number, reason?: string }} ctx
 */
export async function tickAllRegistered(ctx) {
  const tickCount = Number.isInteger(ctx?.tickCount) ? ctx.tickCount : 0;
  const reason = ctx?.reason ?? "heartbeat";
  const disabled = new Set(ctx?.state?.settings?.disabledHeartbeats ?? []);

  for (const entry of REGISTRY.values()) {
    if (tickCount % entry.frequency !== 0) continue;
    if (!entry.neverDisable && disabled.has(entry.id)) continue;

    try {
      await entry.handler({
        state: ctx.state,
        db: ctx.db,
        tickCount,
        reason,
      });
    } catch (err) {
      try {
        logger.warn("heartbeat-registry", `module_failed:${entry.id}`, {
          tickCount,
          frequency: entry.frequency,
          error: err?.message ?? String(err),
        });
      } catch { /* logging best-effort — tick must continue */ }
    }
  }
}

/** Return a snapshot of registered modules — used by health/observability endpoints. */
export function listHeartbeatModules() {
  return Array.from(REGISTRY.values()).map((e) => ({
    id: e.id,
    frequency: e.frequency,
    neverDisable: !!e.neverDisable,
  }));
}

/** Test-only helper: clear the registry between tests. */
export function _resetHeartbeatRegistry() {
  REGISTRY.clear();
}
