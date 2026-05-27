// server/lib/city-engine.js
//
// Phase II Wave 18 — city institution: budgets, policies, happiness.

import crypto from "node:crypto";

const HAPPINESS_DRIFT_PER_TICK = 1.5;
const TARGET_PER_DEPT_FROM_ALLOC = 100;
const POLICY_EFFECTS = Object.freeze({
  curfew:             { safety: +6,  culture: -3, faction_security: +0.04 },
  free_healthcare:    { health: +10, welfare: +3, treasury_delta_pct: -0.04 },
  open_borders:       { culture: +5, safety: -3, faction_progressive: +0.05 },
  progressive_tax:    { welfare: +6, culture: +2, treasury_delta_pct: +0.06 },
  martial_law:        { safety: +12, culture: -8, faction_security: +0.10, faction_progressive: -0.06 },
  arts_subsidy:       { culture: +10, welfare: +1, treasury_delta_pct: -0.03 },
  industrial_subsidy: { infra: +8, culture: -2, treasury_delta_pct: -0.03 },
  rent_control:       { housing: +12, welfare: +3, treasury_delta_pct: -0.02 },
});

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── Budget CRUD ─────────────────────────────────────────────── */

export function ensureBudget(db, worldId) {
  if (!worldId) throw new Error("worldId required");
  let row = db.prepare("SELECT * FROM city_budgets WHERE world_id = ?").get(worldId);
  if (!row) {
    db.prepare("INSERT INTO city_budgets (world_id) VALUES (?)").run(worldId);
    row = db.prepare("SELECT * FROM city_budgets WHERE world_id = ?").get(worldId);
  }
  return row;
}

export function getBudget(db, worldId) {
  return db.prepare("SELECT * FROM city_budgets WHERE world_id = ?").get(worldId) || null;
}

export function setTaxRate(db, worldId, ratePct) {
  ensureBudget(db, worldId);
  const r = Math.max(0, Math.min(90, Number(ratePct)));
  db.prepare(`UPDATE city_budgets SET tax_rate_pct = ? WHERE world_id = ?`).run(r, worldId);
  return { ok: true, taxRatePct: r };
}

export function setAllocations(db, worldId, allocations = {}) {
  ensureBudget(db, worldId);
  const valid = ['housing','health','safety','infra','culture','welfare'];
  const next = {};
  let totalSpecified = 0;
  for (const k of valid) {
    if (k in allocations) {
      next[k] = Math.max(0, Math.min(100, Number(allocations[k]) || 0));
      totalSpecified += next[k];
    }
  }
  // Normalize when total > 100; partial specs leave others unchanged
  if (totalSpecified > 100) {
    const scale = 100 / totalSpecified;
    for (const k of Object.keys(next)) next[k] *= scale;
  }
  const fields = Object.entries(next).map(([k]) => `${k}_alloc_pct = ?`).join(", ");
  const vals = Object.values(next);
  if (!fields.length) return { ok: true, unchanged: true };
  db.prepare(`UPDATE city_budgets SET ${fields} WHERE world_id = ?`).run(...vals, worldId);
  return { ok: true, allocations: next };
}

/* ───────── Policies ────────────────────────────────────────────────── */

export function enactPolicy(db, worldId, kind, options = {}) {
  if (!POLICY_EFFECTS[kind]) return { ok: false, reason: "invalid_kind" };
  const existing = db.prepare(`
    SELECT id FROM city_policies WHERE world_id = ? AND kind = ? AND repealed_at IS NULL
  `).get(worldId, kind);
  if (existing) return { ok: true, alreadyEnacted: true, policyId: existing.id };
  const id = uid("pol");
  db.prepare(`
    INSERT INTO city_policies (id, world_id, kind, enacted_by_user, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, worldId, kind, options.enactedByUser || null, JSON.stringify(options.payload || {}));
  return { ok: true, policyId: id };
}

export function repealPolicy(db, worldId, kind) {
  const r = db.prepare(`
    UPDATE city_policies SET repealed_at = unixepoch()
    WHERE world_id = ? AND kind = ? AND repealed_at IS NULL
  `).run(worldId, kind);
  return { ok: r.changes > 0 };
}

export function listActivePolicies(db, worldId) {
  return db.prepare(`
    SELECT * FROM city_policies WHERE world_id = ? AND repealed_at IS NULL ORDER BY enacted_at DESC
  `).all(worldId);
}

/* ───────── Happiness tick ──────────────────────────────────────────── */

/**
 * Compute current happiness by department + overall, write a snapshot
 * row, and return the deltas vs the previous snapshot.
 *
 * Per-department score:
 *   alloc_pct → target_score: alloc=20 → target=100;
 *                              the heartbeat drifts the score 1.5/tick
 *                              toward the target.
 *
 * Policy modifiers add a one-time bump per enacted policy on each
 * snapshot (idempotent — adding the policy twice has no effect since
 * the snapshot is per-tick).
 */
export function snapshotHappiness(db, worldId) {
  const budget = ensureBudget(db, worldId);
  const prev = db.prepare(`
    SELECT * FROM city_happiness_snapshot WHERE world_id = ? ORDER BY tick_at DESC LIMIT 1
  `).get(worldId);

  const allocations = {
    housing: budget.housing_alloc_pct,
    health:  budget.health_alloc_pct,
    safety:  budget.safety_alloc_pct,
    infra:   budget.infra_alloc_pct,
    culture: budget.culture_alloc_pct,
    welfare: budget.welfare_alloc_pct,
  };

  const activePolicies = listActivePolicies(db, worldId);
  const policyBumps = {};
  const factionBumps = {};
  for (const p of activePolicies) {
    const fx = POLICY_EFFECTS[p.kind] || {};
    for (const [k, v] of Object.entries(fx)) {
      if (k.startsWith("faction_")) {
        factionBumps[k.slice(8)] = (factionBumps[k.slice(8)] || 0) + v;
      } else if (k !== "treasury_delta_pct") {
        policyBumps[k] = (policyBumps[k] || 0) + v;
      }
    }
  }

  const next = {};
  for (const dept of ['housing','health','safety','infra','culture','welfare']) {
    const allocPct = allocations[dept];
    const target = allocPct / 20 * TARGET_PER_DEPT_FROM_ALLOC;
    const prevScore = prev?.[`${dept}_pct`] ?? 50;
    const drift = Math.sign(target - prevScore) * Math.min(Math.abs(target - prevScore), HAPPINESS_DRIFT_PER_TICK);
    const policyBump = policyBumps[dept] || 0;
    next[dept] = Math.max(0, Math.min(100, prevScore + drift + policyBump * 0.1));
  }
  const overall = (next.housing + next.health + next.safety + next.infra + next.culture + next.welfare) / 6;

  const id = uid("hsnap");
  db.prepare(`
    INSERT INTO city_happiness_snapshot
      (id, world_id, overall_pct, housing_pct, health_pct, safety_pct, infra_pct, culture_pct, welfare_pct,
       faction_alignments_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, worldId, overall,
    next.housing, next.health, next.safety, next.infra, next.culture, next.welfare,
    JSON.stringify(factionBumps),
  );

  db.prepare("UPDATE city_budgets SET last_tick_at = unixepoch() WHERE world_id = ?").run(worldId);

  return {
    ok: true,
    snapshotId: id,
    overall,
    departments: next,
    factionBumps,
    prevOverall: prev?.overall_pct ?? null,
    delta: prev ? overall - prev.overall_pct : null,
  };
}

export function latestSnapshot(db, worldId) {
  return db.prepare(`
    SELECT * FROM city_happiness_snapshot WHERE world_id = ? ORDER BY tick_at DESC LIMIT 1
  `).get(worldId) || null;
}

export const CITY_CONSTANTS = Object.freeze({
  HAPPINESS_DRIFT_PER_TICK,
  TARGET_PER_DEPT_FROM_ALLOC,
  POLICY_EFFECTS,
});
