// server/emergent/career-cycle.js
//
// WAVE JOBS — the career heartbeat (the delegate-fidelity SIM tick). Active
// contracts run perpetually on SIM whether the player is there or not (the Sims
// timer / FM "resolve statistically, animate only if watched") — humans drop in
// to PLAY their moments interactively elsewhere; this pays the away/delegated
// work. Per pay-period it sims each active contract's session, computes the wage
// from performance × the delegate multiplier, and pays employer→worker in SPARKS
// via sparks-service (idempotent on a period-bucketed refId, so re-runs within a
// period don't double-pay). scope:'global' (user-global sparks). Never throws;
// no-ops unless CONCORD_LIVING_CAREER=1.

import crypto from "node:crypto";
import logger from "../logger.js";
import { transferSparks } from "../lib/sparks-service.js";
import { shiftPay } from "../lib/career-engine.js";
import { resolveSession, fidelityPayMultiplier } from "../lib/career-fidelity.js";

export const CAREER_CYCLE_FREQUENCY = 40; // ~10 min
const MAX_PER_PASS = 200;
const payPeriodS = () => Number(process.env.CONCORD_CAREER_PAY_PERIOD_S) || 3600; // 1h default

function careerEnabled() { return process.env.CONCORD_LIVING_CAREER === "1"; }

// Deterministic baseline attribute for the delegate sim: rises with tier, with a
// stable per-worker jitter (so the same worker sims consistently).
function attributeFor(workerId, tier) {
  const h = crypto.createHash("sha1").update(String(workerId || "")).digest()[0] / 255; // 0..1
  return Math.max(0, Math.min(1, 0.3 + (Number(tier) || 1) * 0.05 + (h - 0.5) * 0.2));
}

export async function runCareerCycle({ db } = {}) {
  if (!careerEnabled()) return { ok: true, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  const emit = (typeof globalThis.realtimeEmit === "function") ? globalThis.realtimeEmit : () => {};
  const period = Math.floor(Math.floor(Date.now() / 1000) / payPeriodS());

  let active = [];
  try {
    active = db.prepare(`SELECT * FROM career_contracts WHERE status='active' ORDER BY updated_at ASC LIMIT ?`).all(MAX_PER_PASS);
  } catch { return { ok: true, paid: 0, reason: "no_table" }; }

  let paid = 0, shifts = 0;
  for (const c of active) {
    try {
      const attribute = attributeFor(c.worker_id, c.tier);
      const sess = resolveSession("delegate", { attribute });
      const wage = Math.round(shiftPay(sess.performanceScore, c.track_id, c.tier) * fidelityPayMultiplier("delegate"));
      shifts++;
      if (wage <= 0) continue;
      const t = transferSparks(db, {
        fromKind: c.employer_kind, fromId: c.employer_id,
        toKind: c.worker_kind, toId: c.worker_id,
        amount: wage, refId: `contract:${c.id}:shift:${period}`, reason: "career_wage", worldId: c.world_id,
      });
      if (t?.ok && !t.idempotent) {
        paid++;
        try { emit("career:shift", { contractId: c.id, worker: c.worker_id, wage, performanceScore: sess.performanceScore }); } catch { /* noop */ }
      }
    } catch { /* per-contract isolation — a bad contract never stops the tick */ }
  }
  return { ok: true, active: active.length, shifts, paid, period };
}

// test seam
export const _testing = { attributeFor };
