/**
 * World Consequence Graph — Phase A8.
 * Event-sourced record of meaningful acts. Heartbeats and dialogue read this
 * instead of each inventing "what happened." Does not replace economy_ledger
 * or opinions; those remain domain stores. This is the cross-domain bus.
 */
import { randomUUID } from "node:crypto";

const ACTIONS = new Set([
  "kill",
  "assault",
  "theft",
  "kindness",
  "betrayal",
  "promise",
  "gift",
  "insult",
  "romance",
  "loss",
  "discovery",
  "rumor",
  "trade",
  "succession",
  "war",
  "alliance",
  "build",
  "destroy",
  "crime",
  "world_event",
]);

function json(v) {
  if (v == null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

function parse(v) {
  if (v == null || v === "") return null;
  try { return JSON.parse(v); } catch { return v; }
}

export function recordConsequence(db, opts) {
  if (!db) throw new Error("world-consequence: db required");
  const actorKind = String(opts.actorKind || opts.actor_kind || "").trim();
  const actorId = String(opts.actorId || opts.actor_id || "").trim();
  const action = String(opts.action || "").trim();
  if (!actorKind || !actorId || !action) {
    throw new Error("world-consequence: actorKind, actorId, action required");
  }
  if (!ACTIONS.has(action)) {
    throw new Error(`world-consequence: unknown action '${action}'`);
  }
  const importance = Math.max(0, Math.min(1, Number(opts.importance ?? 0.5)));
  const id = opts.id || `wc_${randomUUID()}`;
  const createdAt = Number(opts.createdAt || opts.created_at || Date.now());
  db.prepare(`
    INSERT INTO world_consequences (
      id, world_id, actor_kind, actor_id, action,
      target_kind, target_id, location,
      evidence_json, witnesses_json, immediate_json, long_term_json,
      importance, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    opts.worldId || opts.world_id || "concordia-hub",
    actorKind,
    actorId,
    action,
    opts.targetKind || opts.target_kind || null,
    opts.targetId || opts.target_id || null,
    opts.location || null,
    json(opts.evidence),
    json(opts.witnesses),
    json(opts.immediate),
    json(opts.longTerm || opts.long_term),
    importance,
    createdAt,
  );
  return { ok: true, id, importance };
}

/** Best-effort stamp — never throws into a heartbeat or combat path. */
export function tryRecordConsequence(db, opts) {
  try {
    return recordConsequence(db, opts);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function listConsequences(db, q = {}) {
  const where = [];
  const args = [];
  if (q.worldId) { where.push("world_id = ?"); args.push(q.worldId); }
  if (q.actorId) { where.push("actor_id = ?"); args.push(q.actorId); }
  if (q.targetId) { where.push("target_id = ?"); args.push(q.targetId); }
  if (q.action) { where.push("action = ?"); args.push(q.action); }
  const limit = Math.min(200, Math.max(1, Number(q.limit || 50)));
  const sql = `SELECT * FROM world_consequences
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args).map(rowFromDb);
}

export function rowFromDb(r) {
  return {
    id: r.id,
    worldId: r.world_id,
    actorKind: r.actor_kind,
    actorId: r.actor_id,
    action: r.action,
    targetKind: r.target_kind,
    targetId: r.target_id,
    location: r.location,
    evidence: parse(r.evidence_json),
    witnesses: parse(r.witnesses_json),
    immediate: parse(r.immediate_json),
    longTerm: parse(r.long_term_json),
    importance: r.importance,
    createdAt: r.created_at,
  };
}

/** Named cascade for the spec's "kill a faction leader" example — records, does not invent faction ticks. */
export function recordLeaderDeath(db, opts) {
  const rec = recordConsequence(db, {
    ...opts,
    action: "kill",
    importance: opts.importance ?? 0.95,
    immediate: { ...(opts.immediate || {}), succession: true },
    longTerm: {
      schedule_rewrite: true,
      trade_routes: "pending",
      rumor: true,
      ...(opts.longTerm || {}),
    },
  });
  recordConsequence(db, {
    worldId: opts.worldId,
    actorKind: "faction",
    actorId: opts.factionId || "unknown_faction",
    action: "succession",
    targetKind: opts.targetKind || "npc",
    targetId: opts.targetId,
    importance: 0.9,
    immediate: { triggered_by: rec.id },
  });
  return rec;
}

export const CONSEQUENCE_ACTIONS = ACTIONS;
