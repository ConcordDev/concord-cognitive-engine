// server/lib/conkay/select.js
//
// solver.select — the fidelity router (SX-XC-01, ConKay solver catalogue).
//
// A catalogue solver is one id with several fidelity tiers: an in-process
// fast path at a low tier, the full numerical tier above it, an
// engine-backed tier (SXE-00) at the top. The registry holds one entry
// per (solver, tier); this router decides which tier serves a request:
//
//   - The highest AVAILABLE tier at or below the requested tier serves.
//     A tier is available when it needs no engine, or its engine is
//     present on this host (SXE-00 manifest + binary resolution).
//   - Serving below the requested tier is always labelled: the envelope
//     carries the tier actually used and screening: true. There is no
//     quiet downgrade.
//   - When the requested (top) tier is engine-blocked but a lower tier
//     can serve, the result follows the registry's own convention: the
//     status stays NOT_COMPUTED with reason engine_unavailable:<id>,
//     and the labelled fast path's outputs ride beside it.
//   - When every tier in range needs an absent engine, the answer is
//     NOT_COMPUTED engine_unavailable:<id> with no outputs — never a
//     fallback number labelled as the engine tier's result.
//   - Nothing serves above the requested tier, and an unknown solver
//     is NOT_COMPUTED solver_unknown:<id>.
//
// Every pre-existing registry solver is implicitly a tier at its
// declared fidelity with no engine, so the router covers the whole
// registry from day one; catalogue solvers register their extra tiers
// explicitly with registerTier.

import { getSolver, listSolvers, envelope } from "./physics/registry.js";
import { getEngine, resolveEngineBinary } from "./engines/index.js";

const TIERS = new Map(); // solverId -> Map(tier -> entry)

export function registerTier(entry) {
  for (const k of ["solverId", "tier", "run"]) {
    if (entry[k] == null) throw new Error(`tier ${entry.solverId || "?"}: ${k} required`);
  }
  if (![0, 1, 2, 3, 4].includes(entry.tier)) {
    throw new Error(`tier ${entry.solverId}: tier must be 0-4`);
  }
  if (!TIERS.has(entry.solverId)) TIERS.set(entry.solverId, new Map());
  TIERS.get(entry.solverId).set(entry.tier, Object.freeze({ ...entry }));
  return entry.solverId;
}

export function _clearTiers() {
  TIERS.clear();
}

function engineAvailable(engineId, env) {
  if (!engineId) return true;
  const entry = getEngine(engineId);
  if (!entry) return false;
  return resolveEngineBinary(entry, env) != null;
}

/** All tiers known for a solver: explicit tiers + its registry entry. */
export function tiersFor(solverId) {
  const tiers = new Map();
  const reg = getSolver(solverId);
  if (reg) {
    tiers.set(reg.fidelity, {
      solverId,
      tier: reg.fidelity,
      engineId: null,
      run: reg.run,
      version: reg.version,
      domain: reg.domain,
      domains: reg.domains,
      method: reg.method,
      reference: reg.reference || null,
      screening: reg.screening != null ? Boolean(reg.screening) : reg.fidelity <= 1,
      source: "registry",
    });
  }
  for (const [tier, entry] of TIERS.get(solverId) || []) {
    tiers.set(tier, { ...entry, source: "tier" });
  }
  return [...tiers.values()].sort((a, b) => a.tier - b.tier);
}

export function listTieredSolvers(env = process.env) {
  const ids = new Set([...listSolvers().map((s) => s.id), ...TIERS.keys()]);
  return [...ids].map((id) => {
    const tiers = tiersFor(id).map((t) => ({
      tier: t.tier,
      engineId: t.engineId || null,
      engineDependent: Boolean(t.engineId),
      available: engineAvailable(t.engineId, env),
    }));
    return { id, tiers, engineDependent: tiers.some((t) => t.engineDependent) };
  });
}

/**
 * Resolve which tier serves (solverId, wantedTier). Pure decision, no
 * run — the shape the walker and the list surfaces inspect.
 */
export function selectTier(solverId, wantedTier, env = process.env) {
  const tiers = tiersFor(solverId);
  if (tiers.length === 0) {
    return { status: "NOT_COMPUTED", reason: `solver_unknown:${solverId}` };
  }
  const inRange = tiers.filter((t) => t.tier <= wantedTier);
  if (inRange.length === 0) {
    return { status: "NOT_COMPUTED", reason: `tier_unavailable:${solverId}:L${wantedTier}` };
  }
  const available = inRange.filter((t) => engineAvailable(t.engineId, env));
  const top = inRange[inRange.length - 1];
  if (available.length === 0) {
    return { status: "NOT_COMPUTED", reason: `engine_unavailable:${top.engineId}`, blockedTier: top.tier };
  }
  const served = available[available.length - 1];
  const topBlocked = top.tier !== served.tier && !engineAvailable(top.engineId, env);
  return {
    status: "OK",
    served,
    requestedTier: wantedTier,
    screening: served.tier < wantedTier ? true : Boolean(served.screening),
    ...(topBlocked
      ? { topTierBlocked: { tier: top.tier, reason: `engine_unavailable:${top.engineId}` } }
      : {}),
  };
}

/**
 * Select and run. Returns the registry envelope for the served tier.
 * When the requested tier is engine-blocked and a fast path served,
 * the envelope's status stays NOT_COMPUTED (engine_unavailable:<id>)
 * with the fast path's labelled outputs beside it — the catalogue's
 * reference case, in the registry's own convention.
 */
export async function runSelected(solverId, ctx, target, opts = {}) {
  const wantedTier = opts.tier ?? 4;
  const sel = selectTier(solverId, wantedTier, opts.env ?? process.env);
  const started = Date.now();
  const solverView = (t) => ({
    id: solverId,
    version: t?.version || "0",
    domain: t?.domain || "unknown",
    domains: t?.domains,
    fidelity: t ? t.tier : wantedTier,
    method: t?.method || "solver.select",
    reference: t?.reference || null,
    screening: sel.screening ?? (t ? Boolean(t.screening) : undefined),
  });
  if (sel.status !== "OK") {
    const raw = { notComputed: sel.reason, inputs: ctx?.inputs || {} };
    return envelope(solverView(null), target, raw, {
      runtimeMs: Date.now() - started,
      revision: opts.revision,
      supplied: opts.supplied,
      ignored: opts.ignored,
    });
  }
  const raw = await sel.served.run(ctx, target);
  const runtimeMs = Date.now() - started;
  if (sel.topTierBlocked) {
    const blockedRaw = {
      ...raw,
      notComputed: sel.topTierBlocked.reason,
      warnings: [
        ...(raw.warnings || []),
        `top tier L${sel.topTierBlocked.tier} unavailable (${sel.topTierBlocked.reason}); ` +
          `served L${sel.served.tier} as a labelled screening fast path`,
      ],
    };
    return envelope(solverView(sel.served), target, blockedRaw, {
      runtimeMs, revision: opts.revision, supplied: opts.supplied, ignored: opts.ignored,
    });
  }
  return envelope(solverView(sel.served), target, raw, {
    runtimeMs, revision: opts.revision, supplied: opts.supplied, ignored: opts.ignored,
  });
}
