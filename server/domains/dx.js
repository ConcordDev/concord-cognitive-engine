// server/domains/dx.js
//
// DX Platform Phase A2 — read-mostly macros for the editor plugin's
// codebase + repair-feedback surface.
//
// Macros:
//   dx.register_codebase     — UPSERT (user, repo_root) → codebase row.
//                              Returns codebase id + created flag.
//                              Plugin calls this on activation.
//   dx.touch_codebase        — Refresh last_seen_at on file events.
//   dx.list_codebases        — Caller's recent codebases (recent-first).
//   dx.record_fix_decision   — Log a (accepted|rejected|ignored) decision
//                              for a finding. Adjusts the per-codebase
//                              severity weight (after MIN_SAMPLES).
//   dx.list_weights          — Read-only snapshot of all weights for a
//                              codebase (for the plugin tuning sidebar).
//   dx.weighted_findings     — Apply per-codebase weights to a list of
//                              findings (helpful for repair-cortex callers).
//   dx.upsert_shadow         — Idempotent per-(codebase, path) shadow
//                              DTU upsert. STATE.shadowDtus only — no DB
//                              row written; shadow tier persists via the
//                              existing backup path.
//
// Auth: all macros require a user-bound ctx (ctx.actor.userId). The
// codebase_id passed in any mutating call must belong to the caller.

import crypto from "node:crypto";
import {
  ensureCodebase,
  touchCodebase,
  listCodebasesForUser,
  attachShadowDtu,
  getCodebase,
} from "../lib/dx/codebase-registry.js";
import {
  recordDecision,
  getWeight,
  applyWeights,
  listWeightsForCodebase,
} from "../lib/dx/severity-evo.js";

function _ownsCodebase(db, userId, codebaseId) {
  if (!db || !userId || !codebaseId) return false;
  const row = getCodebase(db, codebaseId);
  return !!row && row.user_id === userId;
}

export default function registerDxMacros(register, STATE) {
  register("dx", "register_codebase", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.repoRoot) return { ok: false, reason: "missing_repo_root" };
    return ensureCodebase(db, userId, input.repoRoot, {
      detectorVersion: input.detectorVersion,
    });
  }, { note: "register a codebase or refresh last_seen_at" });

  register("dx", "touch_codebase", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId) return { ok: false, reason: "missing_codebase_id" };
    if (!_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    return touchCodebase(db, input.codebaseId);
  }, { note: "bump codebase.last_seen_at" });

  register("dx", "list_codebases", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.max(1, Math.min(input.limit || 50, 200));
    return { ok: true, codebases: listCodebasesForUser(db, userId, limit) };
  }, { note: "caller's recent codebases" });

  register("dx", "record_fix_decision", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId || !input.detectorId || !input.ruleId || !input.decision) {
      return { ok: false, reason: "missing_args" };
    }
    if (!_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    return recordDecision(db, {
      codebaseId: input.codebaseId,
      repairId: input.repairId,
      detectorId: input.detectorId,
      ruleId: input.ruleId,
      decision: input.decision,
      detectorVersion: input.detectorVersion,
    });
  }, { note: "record accept/reject/ignore — bumps per-codebase weight" });

  register("dx", "list_weights", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId) return { ok: false, reason: "missing_codebase_id" };
    if (!_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    return { ok: true, weights: listWeightsForCodebase(db, input.codebaseId) };
  }, { note: "per-codebase severity weight snapshot" });

  register("dx", "weighted_findings", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId || !Array.isArray(input.findings)) {
      return { ok: false, reason: "missing_args" };
    }
    if (!_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    return { ok: true, findings: applyWeights(input.findings, db, input.codebaseId) };
  }, { note: "apply per-codebase severity weights to a list of findings" });

  // dx.upsert_shadow — idempotent per-(codebase, path) shadow DTU upsert.
  // Written into STATE.shadowDtus (Map<id, dtu>) under the same `tier:
  // 'shadow'` shape the cross-reference path at server.js:2940/2954
  // already expects. Dedup key is sha1(codebaseId + path); content hash
  // updates the existing entry rather than creating a new one.
  register("dx", "upsert_shadow", async (ctx, input = {}) => {
    const db = ctx?.db;
    const state = STATE || ctx?.state;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!state?.shadowDtus) return { ok: false, reason: "no_shadow_store" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId || !input.path) return { ok: false, reason: "missing_args" };
    if (db && !_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    const content = String(input.content ?? "");
    const tags = Array.isArray(input.tags) ? input.tags.slice(0, 32) : [];
    const contentHash = crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);
    const id = `shadow_dx_${input.codebaseId}_${crypto.createHash("sha1")
      .update(input.path).digest("hex").slice(0, 12)}`;

    const prior = state.shadowDtus.get(id);
    if (prior && prior.meta?.contentHash === contentHash) {
      return { ok: true, id, deduped: true };
    }
    const shadowDtu = {
      id,
      tier: "shadow",
      kind: "code_shadow",
      title: input.path,
      summary: input.path,
      tags,
      content,
      meta: {
        codebase_id: input.codebaseId,
        path: input.path,
        contentHash,
        userId,
        upsertedAt: Math.floor(Date.now() / 1000),
      },
      created_at: Math.floor(Date.now() / 1000),
    };
    state.shadowDtus.set(id, shadowDtu);

    // First time we see a shadow for this codebase, attach it as the
    // codebase's primary shadow_dtu_id. Cheap UPDATE — no-op on retry.
    if (db) {
      try {
        const cb = getCodebase(db, input.codebaseId);
        if (cb && !cb.shadow_dtu_id) attachShadowDtu(db, input.codebaseId, id);
      } catch { /* best-effort */ }
    }

    return { ok: true, id, deduped: false, contentHash };
  }, { note: "idempotent shadow DTU upsert keyed by (codebase, path)" });

  // Convenience read so the plugin can inspect what shadows it has
  // written. Caller-scoped via codebase ownership.
  register("dx", "list_shadows", async (ctx, input = {}) => {
    const state = STATE || ctx?.state;
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!state?.shadowDtus) return { ok: false, reason: "no_shadow_store" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId) return { ok: false, reason: "missing_codebase_id" };
    if (db && !_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    const out = [];
    for (const dtu of state.shadowDtus.values()) {
      if (dtu?.meta?.codebase_id === input.codebaseId && dtu?.kind === "code_shadow") {
        out.push({
          id: dtu.id,
          path: dtu.meta.path,
          contentHash: dtu.meta.contentHash,
          upsertedAt: dtu.meta.upsertedAt,
          contentLength: (dtu.content || "").length,
        });
      }
    }
    return { ok: true, shadows: out, count: out.length };
  }, { note: "list shadow DTUs for a codebase" });

  // Pure read for getWeight — useful for cheap UI peeks without a full
  // weights-list call.
  register("dx", "get_weight", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.codebaseId || !input.detectorId || !input.ruleId) {
      return { ok: false, reason: "missing_args" };
    }
    if (!_ownsCodebase(db, userId, input.codebaseId)) {
      return { ok: false, reason: "not_owner" };
    }
    return { ok: true, weight: getWeight(db, input.codebaseId, input.detectorId, input.ruleId) };
  }, { note: "single (codebase, detector, rule) weight lookup" });
}
