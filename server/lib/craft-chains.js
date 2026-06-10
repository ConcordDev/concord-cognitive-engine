// server/lib/craft-chains.js
//
// Concordia Phase 11 — multi-step crafting chain engine.
//
// Sits on top of the existing craft-engine.js — each step is a single
// recipe execution. The chain engine just sequences them, with
// duration + season gates between steps.
//
// Chain JSON shape:
//   {
//     id: "textile_cactem",
//     name: "Cactem Textile",
//     output_item: "cactem_bolt",
//     author_faction: "fluxom",
//     steps: [
//       { kind: "gather", name: "breed dye-bugs", duration_s: 3600 },
//       { kind: "process", name: "salt-mix", duration_s: 1800, season_gate: null },
//       { kind: "cure", name: "dye fabric", duration_s: 86400, season_gate: null },
//       { kind: "process", name: "weave", duration_s: 7200 },
//       { kind: "finish", name: "cut + market", duration_s: 1800 }
//     ]
//   }
//
// Engine surface:
//   - registerChain(db, def)            — idempotent insert
//   - listChains(db, worldId)
//   - startChain(db, userId, worldId, chainId)
//   - advanceStep(db, userId, jobId, currentSeason)
//   - listJobsForUser(db, userId, worldId)
//   - abandonJob(db, userId, jobId)

import crypto from "node:crypto";
import logger from "../logger.js";
import { resolveCraft } from "./craft-resolve.js";

const VALID_STEP_KINDS = new Set(["gather", "process", "cure", "assemble", "finish"]);

function makeJobId() {
  return `pcj_${crypto.randomUUID().slice(0, 16)}`;
}

export function registerChain(db, def = {}) {
  if (!db || !def?.id || !def?.name || !def?.output_item) return { ok: false, reason: "missing_inputs" };
  const steps = Array.isArray(def.steps) ? def.steps : [];
  if (steps.length === 0) return { ok: false, reason: "no_steps" };
  for (const s of steps) {
    if (!s?.kind || !VALID_STEP_KINDS.has(s.kind)) return { ok: false, reason: "bad_step_kind", offending: s };
    if (!Number.isFinite(Number(s.duration_s)) || Number(s.duration_s) < 0) return { ok: false, reason: "bad_duration", offending: s };
  }
  const total = steps.reduce((a, s) => a + Number(s.duration_s), 0);
  try {
    db.prepare(`
      INSERT INTO craft_chains (id, name, world_id, steps_json, total_duration_s, output_item, author_faction)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE
        SET name = excluded.name, world_id = excluded.world_id,
            steps_json = excluded.steps_json, total_duration_s = excluded.total_duration_s,
            output_item = excluded.output_item, author_faction = excluded.author_faction
    `).run(def.id, def.name, def.world_id || "concordia-hub", JSON.stringify(steps), total, def.output_item, def.author_faction || null);
    // Living Society P0 — optional resource bill. Written separately + guarded
    // so the chain registers cleanly whether or not migration 279 (inputs_json)
    // has run.
    if (Array.isArray(def.inputs) && def.inputs.length > 0) {
      try {
        db.prepare(`UPDATE craft_chains SET inputs_json = ? WHERE id = ?`)
          .run(JSON.stringify(def.inputs), def.id);
      } catch { /* inputs_json column absent (mig 279 not yet applied) */ }
    }
    return { ok: true, action: "registered", chainId: def.id, steps: steps.length };
  } catch (err) {
    try { logger.warn?.("chain_register_failed", { id: def.id, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

export function listChains(db, worldId = null) {
  if (!db) return [];
  try {
    const stmt = worldId
      ? db.prepare(`SELECT id, name, world_id, steps_json, total_duration_s, output_item, author_faction FROM craft_chains WHERE world_id = ?`)
      : db.prepare(`SELECT id, name, world_id, steps_json, total_duration_s, output_item, author_faction FROM craft_chains`);
    const rows = worldId ? stmt.all(worldId) : stmt.all();
    return rows.map((r) => ({ ...r, steps: tryParse(r.steps_json) || [] }));
  } catch { return []; }
}

export function getChain(db, chainId) {
  if (!db || !chainId) return null;
  try {
    const row = db.prepare(`SELECT id, name, world_id, steps_json, total_duration_s, output_item, author_faction FROM craft_chains WHERE id = ?`).get(chainId);
    if (!row) return null;
    let inputs = [];
    try {
      const ir = db.prepare(`SELECT inputs_json FROM craft_chains WHERE id = ?`).get(chainId);
      inputs = tryParse(ir?.inputs_json) || [];
    } catch { /* inputs_json column absent */ }
    return { ...row, steps: tryParse(row.steps_json) || [], inputs };
  } catch { return null; }
}

export function startChain(db, userId, worldId, chainId) {
  if (!db || !userId || !worldId || !chainId) return { ok: false, reason: "missing_inputs" };
  const chain = getChain(db, chainId);
  if (!chain) return { ok: false, reason: "chain_not_found" };

  // Living Society P0 — if the chain carries a resource bill, verify the player
  // owns it (world-scoped) and consume it up-front. The matter is committed to
  // the chain the moment it starts (it's a long process). Guarded for builds
  // where player_inventory is absent.
  const inputs = Array.isArray(chain.inputs) ? chain.inputs : [];
  if (inputs.length > 0) {
    try {
      const sumQty = db.prepare(`
          SELECT COALESCE(SUM(quantity),0) AS qty FROM player_inventory
          WHERE user_id = ? AND world_id = ? AND item_id = ?
        `);
      for (const inp of inputs) {
        const need = Math.max(1, Number(inp.quantity) || 1);
        const row = sumQty.get(userId, worldId, inp.id);
        if ((row?.qty ?? 0) < need) {
          return { ok: false, reason: "missing_material", material: inp.id, needed: need, have: row?.qty ?? 0 };
        }
      }
    } catch { /* inventory table absent → treat as no-bill */ }
  }

  const id = makeJobId();
  const tx = db.transaction(() => {
    if (inputs.length > 0) {
      const selSlots = db.prepare(`
          SELECT id, quantity FROM player_inventory
          WHERE user_id = ? AND world_id = ? AND item_id = ? AND quantity > 0
          ORDER BY acquired_at ASC
        `);
      const delSlot = db.prepare(`DELETE FROM player_inventory WHERE id = ?`);
      const decSlot = db.prepare(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`);
      for (const inp of inputs) {
        let remaining = Math.max(1, Number(inp.quantity) || 1);
        const slots = selSlots.all(userId, worldId, inp.id);
        for (const slot of slots) {
          if (remaining <= 0) break;
          if (slot.quantity <= remaining) {
            delSlot.run(slot.id);
            remaining -= slot.quantity;
          } else {
            decSlot.run(remaining, slot.id);
            remaining = 0;
          }
        }
      }
    }
    db.prepare(`
      INSERT INTO player_craft_jobs (id, user_id, world_id, chain_id, current_step, step_started_at)
      VALUES (?, ?, ?, ?, 0, unixepoch())
    `).run(id, userId, worldId, chainId);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "start_failed", error: err?.message }; }
  return { ok: true, jobId: id, chainId, totalSteps: chain.steps.length, consumedInputs: inputs.length };
}

/**
 * Advance the player's current step if its duration has elapsed and
 * its season gate is satisfied. Returns either:
 *   { ok, advanced: true, nextStep, finished? }
 *   { ok, advanced: false, reason: 'not_yet' | 'blocked_by_season' | 'already_complete' }
 */
export function advanceStep(db, userId, jobId, { currentSeason = null, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!db || !userId || !jobId) return { ok: false, reason: "missing_inputs" };
  const job = db.prepare(`
    SELECT id, user_id, world_id, chain_id, current_step, status, step_started_at
    FROM player_craft_jobs WHERE id = ? AND user_id = ?
  `).get(jobId, userId);
  if (!job) return { ok: false, reason: "job_not_found" };
  if (job.status !== "active") return { ok: false, reason: "job_inactive", status: job.status };
  const chain = getChain(db, job.chain_id);
  if (!chain) return { ok: false, reason: "chain_missing" };
  const step = chain.steps[job.current_step];
  if (!step) return { ok: false, reason: "step_out_of_range" };

  // Season gate.
  if (step.season_gate && currentSeason && String(step.season_gate) !== String(currentSeason)) {
    db.prepare(`UPDATE player_craft_jobs SET status = 'blocked_by_season' WHERE id = ?`).run(jobId);
    return { ok: false, reason: "blocked_by_season", required: step.season_gate, current: currentSeason };
  }

  // Duration gate.
  const elapsed = now - job.step_started_at;
  if (elapsed < Number(step.duration_s)) {
    return { ok: false, reason: "not_yet", remaining_s: Number(step.duration_s) - elapsed };
  }

  // Advance.
  const nextIndex = job.current_step + 1;
  if (nextIndex >= chain.steps.length) {
    // Living Society P0 — resolve the finished item's quality from the chain's
    // resource bill (the same single craft-resolve layer). Steps acted as the
    // "station + process"; the inputs carry the propertied potency. Guarded.
    let outputQuality = null;
    let resolved = null;
    const inputs = Array.isArray(chain.inputs) ? chain.inputs : [];
    if (inputs.length > 0 && process.env.CONCORD_CRAFT_RESOLVE !== "0") {
      try {
        resolved = resolveCraft({
          inputs: inputs.map((i) => ({ itemId: i.id, qty: Math.max(1, Number(i.quantity) || 1) })),
          // A completed multi-step chain implies process mastery → treat the
          // chain length as a station-quality proxy (more steps = finer work).
          stationQuality: Math.min(100, chain.steps.length * 20),
          db,
        });
        if (resolved?.ok) outputQuality = resolved.qualityMultiplier;
      } catch { resolved = null; }
    }
    db.prepare(`
      UPDATE player_craft_jobs
      SET status = 'complete', current_step = ?, step_done_at = ?, finished_at = ?
      WHERE id = ?
    `).run(nextIndex, now, now, jobId);
    if (outputQuality != null) {
      try { db.prepare(`UPDATE player_craft_jobs SET output_quality = ? WHERE id = ?`).run(outputQuality, jobId); }
      catch { /* output_quality column absent (mig 279 not applied) */ }
    }
    const out = { ok: true, advanced: true, finished: true, output: chain.output_item };
    if (resolved?.ok) {
      out.outputQuality = outputQuality;
      out.resolved = {
        outputPotency: resolved.outputPotency,
        outputAffinity: resolved.outputAffinity,
        outputStability: resolved.outputStability,
      };
    }
    return out;
  }
  db.prepare(`
    UPDATE player_craft_jobs
    SET current_step = ?, step_started_at = ?, step_done_at = NULL
    WHERE id = ?
  `).run(nextIndex, now, jobId);
  return { ok: true, advanced: true, nextStep: nextIndex, totalSteps: chain.steps.length };
}

export function listJobsForUser(db, userId, worldId = null) {
  if (!db || !userId) return [];
  try {
    const stmt = worldId
      ? db.prepare(`SELECT id, user_id, world_id, chain_id, current_step, status, started_at, step_started_at, finished_at FROM player_craft_jobs WHERE user_id = ? AND world_id = ? ORDER BY started_at DESC`)
      : db.prepare(`SELECT id, user_id, world_id, chain_id, current_step, status, started_at, step_started_at, finished_at FROM player_craft_jobs WHERE user_id = ? ORDER BY started_at DESC`);
    return worldId ? stmt.all(userId, worldId) : stmt.all(userId);
  } catch { return []; }
}

export function abandonJob(db, userId, jobId) {
  if (!db || !userId || !jobId) return { ok: false, reason: "missing_inputs" };
  const r = db.prepare(`
    UPDATE player_craft_jobs SET status = 'abandoned', finished_at = unixepoch()
    WHERE id = ? AND user_id = ? AND status = 'active'
  `).run(jobId, userId);
  if (r.changes === 0) return { ok: false, reason: "not_active" };
  return { ok: true, action: "abandoned" };
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export const CHAIN_CONSTANTS = Object.freeze({
  VALID_STEP_KINDS: Array.from(VALID_STEP_KINDS),
});
