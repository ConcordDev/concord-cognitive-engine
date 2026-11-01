// server/lib/verify-gate/service.js
//
// The verification gate as a running service: submit candidates, drain the queue off the hot path, apply
// outcomes, re-check existing megas/hypers that have no receipt in small budgeted batches, expose metrics.
//
// Mode (CONCORD_VERIFY_GATE_MODE):
//   off      nothing is queued or checked
//   observe  (default) candidates are checked and the receipt is attached to the DTU, but nothing is demoted
//            or hidden: the owner reads the numbers before turning enforcement on
//   enforce  VERIFIED stays; PARTIAL -> demoted to a "hypothesis" regular DTU; UNTESTABLE -> a "speculative"
//            regular DTU (never mega/hyper, never cited as fact); REFUTED -> quarantined (hidden from lists and
//            retrieval, kept for review); PENDING -> untouched until a checker is back.
// Nothing is ever deleted by the gate: an existing node that fails is demoted, and deletion is the owner's call.
//
// All state access goes through a `store` adapter, so this file knows nothing about server.js:
//   store.get(id) -> dtu | null
//   store.annotate(id, verification) -> void          (writes dtu.meta.verification)
//   store.demote(id, { tier, tag, from }) -> void
//   store.quarantine(id, reason) -> void
//   store.scan(maxExamine) -> { examined, found: dtu[] }   (resumable cursor over consolidated nodes)

import { createHash } from "node:crypto";
import { verifyCandidate } from "./gate.js";
import { createVerifyQueue } from "./queue.js";

export function verifyGateMode(env = process.env) {
  const m = String(env.CONCORD_VERIFY_GATE_MODE || "observe").toLowerCase();
  return m === "off" || m === "enforce" ? m : "observe";
}

const text = (v) => (typeof v === "string" ? v : "");

/** The statements a node asserts: title, core claims and definitions, and its written body. */
export function candidateOf(dtu) {
  const core = dtu?.core || {};
  const parts = [
    text(dtu?.title).replace(/^\s*(?:MEGA|HYPER)\s*[—–-]\s*/i, ""),
    ...(Array.isArray(core.claims) ? core.claims.map(String) : []),
    ...(Array.isArray(core.definitions) ? core.definitions.map(String) : []),
    text(dtu?.cretiHuman), text(dtu?.human?.summary), text(dtu?.body),
  ].filter(Boolean);
  return { id: dtu?.id, title: text(dtu?.title), tier: dtu?.tier, body: parts.join("\n") };
}

export function createVerifyGateService({ store, deps = {}, mode = verifyGateMode, queueOpts = {}, retention = {}, now = Date.now } = {}) {
  const queue = createVerifyQueue({ now, ...queueOpts });
  const cfg = { examinePerCycle: 300, submitPerCycle: 20, maxQueueForRetention: 50, ...retention };
  const stats = { retentionExamined: 0, retentionSubmitted: 0, applied: { annotated: 0, demoted: 0, quarantined: 0 } };
  const curMode = () => (typeof mode === "function" ? mode() : mode);

  function submit(dtuOrId, { force = false } = {}) {
    if (curMode() === "off") return { queued: false, reason: "off" };
    const dtu = typeof dtuOrId === "string" ? store.get(dtuOrId) : dtuOrId;
    if (!dtu?.id) return { queued: false, reason: "not found" };
    const cand = candidateOf(dtu);
    if (!cand.body.trim()) return { queued: false, reason: "empty" };
    const prior = dtu.meta?.verification;
    if (!force && prior?.outcome && prior.outcome !== "PENDING" && prior.bodyHash && prior.bodyHash === bodyHashOf(cand.body)) return { queued: false, reason: "already verified" };
    return queue.submit(cand);
  }

  async function apply(candidate, { outcome, receipt }) {
    const dtu = store.get(candidate.id);
    if (!dtu) return;
    store.annotate(candidate.id, {
      outcome, mode: curMode(), checkedAt: receipt.checkedAt, version: receipt.version, bodyHash: receipt.bodyHash,
      unverified: receipt.unverified?.slice(0, 10) || [],
      claims: (receipt.claims || []).slice(0, 40).map((c) => ({ id: c.claimId, kind: c.kind, checker: c.checker, result: c.result, detail: String(c.detail || "").slice(0, 200), text: String(c.text || "").slice(0, 200), ...(c.leanSource ? { leanSource: String(c.leanSource).slice(0, 4000) } : {}) })),
    });
    stats.applied.annotated++;
    if (curMode() !== "enforce") return;
    const consolidated = dtu.tier === "mega" || dtu.tier === "hyper";
    if (outcome === "PARTIAL" && consolidated) { store.demote(dtu.id, { tier: "regular", tag: "hypothesis", from: dtu.tier }); stats.applied.demoted++; }
    else if (outcome === "UNTESTABLE" && consolidated) { store.demote(dtu.id, { tier: "regular", tag: "speculative", from: dtu.tier }); stats.applied.demoted++; }
    else if (outcome === "REFUTED") { store.quarantine(dtu.id, "unverified-refuted"); stats.applied.quarantined++; }
  }

  async function cycle() {
    if (curMode() === "off") return { skipped: "off" };
    const drained = await queue.drain((cand) => verifyCandidate(cand, deps), { onOutcome: apply });
    const r = await retentionBatch();
    return { ...drained, retention: r };
  }

  /** Existing megas/hypers without a receipt: a few per cycle, never a full scan in one go. */
  async function retentionBatch() {
    if (curMode() === "off" || queue.size() >= cfg.maxQueueForRetention || typeof store.scan !== "function") return { submitted: 0 };
    const { examined, found } = store.scan(cfg.examinePerCycle);
    stats.retentionExamined += examined;
    let submitted = 0;
    for (const dtu of found) {
      if (submitted >= cfg.submitPerCycle) break;
      if (dtu.meta?.verification?.outcome && dtu.meta.verification.outcome !== "PENDING") continue;
      if (submit(dtu).queued) submitted++;
    }
    stats.retentionSubmitted += submitted;
    return { examined, submitted };
  }

  return { submit, cycle, retentionBatch, metrics: () => ({ mode: curMode(), ...queue.metrics(), retention: { ...stats, ...cfg }, applied: stats.applied }), rejected: queue.rejected, queue };
}

function bodyHashOf(body) { return createHash("sha256").update(String(body || "")).digest("hex"); }
