// server/lib/tasks/workflow.js
//
// Default workflow seeder + status / transition validation.
//
// Each project gets a default workflow on creation. Statuses live in
// task_workflows.statuses_json so swapping the pipeline is a JSON
// edit, not a migration. Transitions can be free (any-to-any when
// transitions_json is null/empty) or constrained to the listed pairs.

import { randomUUID } from "node:crypto";

export const STATUS_CATEGORIES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];

export function defaultStatuses() {
  return [
    { id: "st:backlog",     name: "Backlog",     category: "backlog",     color: "#94a3b8" },
    { id: "st:todo",        name: "Todo",        category: "todo",        color: "#60a5fa" },
    { id: "st:in_progress", name: "In progress", category: "in_progress", color: "#fbbf24" },
    { id: "st:in_review",   name: "In review",   category: "in_review",   color: "#a78bfa" },
    { id: "st:done",        name: "Done",        category: "done",        color: "#22c55e" },
    { id: "st:cancelled",   name: "Cancelled",   category: "cancelled",   color: "#ef4444" },
  ];
}

export function defaultWorkflow(projectId) {
  return {
    id: `wf:${randomUUID()}`,
    project_id: projectId,
    name: "Default workflow",
    statuses_json: JSON.stringify(defaultStatuses()),
    transitions_json: null,         // any-to-any
    default_status_id: "st:backlog",
    is_default: 1,
  };
}

export function validateStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return { ok: false, reason: "statuses_must_be_nonempty_array" };
  const seen = new Set();
  for (const s of statuses) {
    if (!s?.id || !s?.name) return { ok: false, reason: "status_needs_id_and_name" };
    if (!STATUS_CATEGORIES.includes(s.category)) return { ok: false, reason: `unknown_category_${s.category}` };
    if (seen.has(s.id)) return { ok: false, reason: `duplicate_status_id_${s.id}` };
    seen.add(s.id);
  }
  return { ok: true };
}

export function validateTransition(workflow, fromStatusId, toStatusId) {
  if (!workflow) return { ok: false, reason: "no_workflow" };
  const statuses = (() => { try { return JSON.parse(workflow.statuses_json || "[]"); } catch { return []; } })();
  const validIds = new Set(statuses.map((s) => s.id));
  if (!validIds.has(toStatusId)) return { ok: false, reason: "unknown_to_status" };
  if (fromStatusId === toStatusId) return { ok: true, noop: true };
  let transitions = null;
  try { transitions = JSON.parse(workflow.transitions_json || "null"); } catch { /* no constraints */ }
  if (!Array.isArray(transitions) || transitions.length === 0) return { ok: true };
  const allowed = transitions.some((t) => t.from === fromStatusId && t.to === toStatusId);
  if (!allowed) return { ok: false, reason: "transition_not_allowed" };
  return { ok: true };
}

export function statusById(workflow, statusId) {
  if (!workflow) return null;
  try {
    const statuses = JSON.parse(workflow.statuses_json || "[]");
    return statuses.find((s) => s.id === statusId) || null;
  } catch { return null; }
}

export function statusesAsArray(workflow) {
  if (!workflow) return [];
  try { return JSON.parse(workflow.statuses_json || "[]"); } catch { return []; }
}
