// server/lib/long-horizon-planner.js
//
// Long-Horizon Planner (#14) — time-phases a goal tree's actionable leaves into
// dated milestones across a horizon and attaches contingencies ("if this slips,
// do that"). The plan-horizon-cycle heartbeat detects overdue milestones and
// fires their fallbacks. Distinct from the decomposition tree (#10): the tree is
// the structure; the plan is WHEN and WHAT-IF. Pure, bounded reads/writes; the
// overdue sweep is a single query, no N+1.

import { nextActionable } from "./goal-decomposition.js";

const DAY = 86400; // seconds
let _idc = 0;
function pid(p) { return `${p}_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/**
 * Draft a plan from a goal tree: spread its actionable leaves evenly across the
 * horizon as dated milestones. When no tree is given, accept an explicit
 * `milestones:[{title}]` list. Returns { ok, planId, milestones:[{id,title,dueTs}] }.
 */
export function draftPlan(db, { userId, treeId = null, title, horizonDays = 30, startTs = null, milestones = [] } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const uid = String(userId || "");
  if (!uid || !title) return { ok: false, reason: "missing_user_or_title" };
  const horizon = Math.min(Math.max(Number(horizonDays) || 30, 1), 3650);
  const start = Number(startTs) || Math.floor(Date.now() / 1000);

  // Source the milestone titles: from the tree's actionable leaves, or explicit.
  let items = [];
  if (treeId) {
    items = nextActionable(db, treeId, 100).map((n) => ({ title: n.title, nodeId: n.id }));
  }
  if (!items.length && Array.isArray(milestones)) {
    items = milestones.map((m) => (typeof m === "string" ? { title: m } : m)).filter((m) => m && m.title);
  }
  if (!items.length) return { ok: false, reason: "no_milestones" };

  const planId = pid("lhp");
  const created = [];
  try {
    const insMs = db.prepare(`INSERT INTO lh_milestones (id, plan_id, node_id, title, due_ts, ordinal) VALUES (?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      db.prepare(`INSERT INTO lh_plans (id, user_id, tree_id, title, horizon_days, start_ts) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(planId, uid, treeId, title, horizon, start);
      // Evenly phase: milestone i due at start + (i+1)/(n) * horizon.
      const n = items.length;
      items.forEach((it, i) => {
        const dueTs = start + Math.round(((i + 1) / n) * horizon * DAY);
        const id = pid("lhm");
        insMs.run(id, planId, it.nodeId || null, String(it.title), dueTs, i);
        created.push({ id, title: String(it.title), dueTs });
      });
    })();
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, planId, milestones: created };
}

/** Attach a contingency to a milestone. Returns { ok, id }. */
export function addContingency(db, { milestoneId, condition = "overdue", fallback } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!milestoneId || !fallback) return { ok: false, reason: "missing_milestone_or_fallback" };
  if (!["overdue", "blocked"].includes(condition)) return { ok: false, reason: "bad_condition" };
  const ms = db.prepare(`SELECT id FROM lh_milestones WHERE id = ?`).get(milestoneId);
  if (!ms) return { ok: false, reason: "milestone_not_found" };
  const id = pid("lhc");
  try {
    db.prepare(`INSERT INTO lh_contingencies (id, milestone_id, condition, fallback) VALUES (?, ?, ?, ?)`)
      .run(id, milestoneId, condition, String(fallback));
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, id };
}

/** Mark a milestone done/abandoned. Completing all live milestones completes the plan. */
export function setMilestoneStatus(db, { planId, milestoneId, status } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!["pending", "done", "slipped", "abandoned"].includes(status)) return { ok: false, reason: "bad_status" };
  const ms = db.prepare(`SELECT id, plan_id FROM lh_milestones WHERE id = ?`).get(milestoneId);
  if (!ms) return { ok: false, reason: "milestone_not_found" };
  let planDone = false;
  try {
    db.transaction(() => {
      db.prepare(`UPDATE lh_milestones SET status = ?, updated_at = unixepoch() WHERE id = ?`).run(status, milestoneId);
      const open = db.prepare(`SELECT COUNT(*) AS n FROM lh_milestones WHERE plan_id = ? AND status NOT IN ('done','abandoned')`).get(ms.plan_id).n;
      if (open === 0) {
        db.prepare(`UPDATE lh_plans SET status = 'done' WHERE id = ?`).run(ms.plan_id);
        planDone = true;
      }
    })();
  } catch (e) {
    return { ok: false, reason: "update_failed", error: String(e?.message || e) };
  }
  return { ok: true, planDone };
}

/** Full plan view (no N+1): plan + milestones + contingencies + overdue flags. */
export function getPlan(db, planId, { nowTs = null } = {}) {
  if (!db || !planId) return { ok: false, reason: "missing_plan" };
  const plan = db.prepare(`SELECT id, user_id AS userId, tree_id AS treeId, title, horizon_days AS horizonDays, start_ts AS startTs, status FROM lh_plans WHERE id = ?`).get(planId);
  if (!plan) return { ok: false, reason: "plan_not_found" };
  const now = Number(nowTs) || Math.floor(Date.now() / 1000);
  const milestones = db.prepare(`SELECT id, node_id AS nodeId, title, due_ts AS dueTs, status, ordinal FROM lh_milestones WHERE plan_id = ? ORDER BY ordinal`).all(planId)
    .map((m) => ({ ...m, overdue: m.status === "pending" && m.dueTs < now }));
  const msIds = milestones.map((m) => m.id);
  let cons = [];
  if (msIds.length) {
    const ph = msIds.map(() => "?").join(",");
    cons = db.prepare(`SELECT id, milestone_id AS milestoneId, condition, fallback, triggered_at AS triggeredAt FROM lh_contingencies WHERE milestone_id IN (${ph})`).all(...msIds);
  }
  const done = milestones.filter((m) => m.status === "done").length;
  const progress = milestones.length ? Math.round((done / milestones.length) * 100) / 100 : 0;
  return { ok: true, plan, milestones, contingencies: cons, progress, overdueCount: milestones.filter((m) => m.overdue).length };
}

/**
 * Sweep overdue milestones across ALL active plans, mark them 'slipped', and
 * fire any 'overdue' contingencies (stamp triggered_at). One bounded query set;
 * returns { slipped, triggered }.
 */
export function sweepOverdue(db, { nowTs = null, limit = 200 } = {}) {
  if (!db) return { slipped: 0, triggered: 0 };
  const now = Number(nowTs) || Math.floor(Date.now() / 1000);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  let slipped = 0, triggered = 0;
  try {
    const due = db.prepare(
      `SELECT m.id FROM lh_milestones m JOIN lh_plans p ON p.id = m.plan_id
       WHERE p.status = 'active' AND m.status = 'pending' AND m.due_ts < ? LIMIT ?`
    ).all(now, lim);
    if (!due.length) return { slipped: 0, triggered: 0 };
    const markSlip = db.prepare(`UPDATE lh_milestones SET status = 'slipped', updated_at = unixepoch() WHERE id = ?`);
    const fireCon = db.prepare(`UPDATE lh_contingencies SET triggered_at = ? WHERE milestone_id = ? AND condition = 'overdue' AND triggered_at IS NULL`);
    db.transaction(() => {
      for (const m of due) {
        markSlip.run(m.id);
        slipped += 1;
        triggered += fireCon.run(now, m.id).changes;
      }
    })();
  } catch { /* sweep is best-effort */ }
  return { slipped, triggered };
}

export default { draftPlan, addContingency, setMilestoneStatus, getPlan, sweepOverdue };
