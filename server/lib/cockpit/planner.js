// Turn a request into steps: a template when one fits, a constrained model call otherwise (CKPT-10).
import { brainChat } from "../byo-router.js";
import { validateDag } from "../macro-dag.js";
import { PLAN_TEMPLATES } from "./plan-templates.js";
import { buildToolMenu } from "./tool-menu.js";
import { MODEL_PROFILES } from "./model-caps.js";
import { getToolSpec } from "./tool-spec.js";
import { insertSteps, newStepId } from "./run-store.js";
import { createMockModel } from "./mock-model.js";

const PLAN_SYSTEM = 'Break the task into the fewest steps that finish it. Each step uses one tool. Use "auto" when unsure which tool. "after" lists earlier step numbers (starting at 1) this step needs. Reply with JSON only.';

/**
 * Validate and normalize a list of plan steps.
 * @returns {{ ok: true, steps: object[] } | { ok: false, reason: string }}
 */
export function normalizePlan(rawSteps, { candidateIds = [], maxSteps = 60 } = {}) {
  const cand = new Set(candidateIds);
  let steps = (Array.isArray(rawSteps) ? rawSteps : [])
    .filter((s) => s && typeof s === "object" && s.key && s.goal)
    .filter((s) => s.tool === null || s.tool === undefined || cand.has(s.tool) || !!getToolSpec(s.tool))
    .map((s) => ({
      key: String(s.key), goal: String(s.goal).slice(0, 200), tool: s.tool || null,
      args: s.args ?? null, expects: Array.isArray(s.expects) && s.expects.length ? s.expects : [{ kind: "ok" }],
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [], required: s.required !== false,
    }));
  if (!steps.length) return { ok: false, reason: "empty_plan" };
  const keys = new Set(steps.map((s) => s.key));
  for (const s of steps) s.dependsOn = s.dependsOn.filter((k) => keys.has(k));
  const dag = validateDag({ steps: steps.map((s) => ({ id: s.key, macro: "plan.step", dependsOn: s.dependsOn })) });
  if (!dag.ok) return { ok: false, reason: "cycle" };
  const order = new Map(steps.map((s, i) => [s.key, i]));
  for (const s of steps) s.dependsOn = s.dependsOn.filter((k) => order.get(k) < order.get(s.key));
  steps = steps.slice(0, maxSteps);
  const kept = new Set(steps.map((s) => s.key));
  for (const s of steps) s.dependsOn = s.dependsOn.filter((k) => kept.has(k));
  return { ok: true, steps };
}

function planSchema(candidateIds) {
  return {
    type: "object", additionalProperties: false, required: ["steps"],
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["goal", "tool"],
          properties: {
            goal: { type: "string" },
            tool: { type: "string", enum: [...candidateIds, "auto"] },
            after: { type: "array", items: { type: "integer" } },
          },
        },
      },
    },
  };
}

const single = (goal) => ({
  ok: true, source: "single",
  steps: [{ key: "s1", goal: String(goal).slice(0, 200), tool: null, args: null, expects: [{ kind: "ok" }], dependsOn: [], required: true }],
});

/**
 * @returns {Promise<{ ok: boolean, source: "template"|"model"|"single", steps: object[], reason?: string }>}
 */
export async function planRun(a) {
  const goal = String(a.goal || "").trim();
  if (!goal) return { ok: false, source: "single", steps: [], reason: "empty_goal" };

  for (const t of PLAN_TEMPLATES) {
    let hit = false;
    try { hit = t.match(goal); } catch { hit = false; }
    if (!hit) continue;
    const built = t.build(goal);
    const norm = normalizePlan(built, { candidateIds: built.map((s) => s.tool).filter(Boolean) });
    if (norm.ok) return { ok: true, source: "template", templateId: t.id, steps: norm.steps };
  }

  try {
    const { menu } = await buildToolMenu({ goal, profile: "local-30b", lensContext: a.lensContext, lensActions: a.lensActions });
    const candidateIds = menu.map((m) => m.id).slice(0, 8);
    const slot = (MODEL_PROFILES[a.profile] || MODEL_PROFILES["local-2b"]).slot;
    const messages = [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: `Task: ${goal}\nTools:\n${menu.map((m) => `- ${m.id}: ${m.description}`).join("\n")}` },
    ];
    let parsed = null;
    if (a.deps?.mock) {
      const m = a.deps.mock.next ? a.deps.mock : createMockModel(a.deps.mock);
      const r = m.next({ packet: { goal: "plan" } });
      parsed = r.ok ? r.call.args : null;
    } else {
      const chat = a.deps?.brainChat || brainChat;
      const r = await chat({ db: a.db, userId: a.userId, slot, messages, opts: { temperature: 0, maxTokens: 900, format: planSchema(candidateIds) } });
      try { parsed = JSON.parse(String(r?.text || "")); } catch { parsed = null; }
    }
    const raw = Array.isArray(parsed?.steps) ? parsed.steps : [];
    const planSteps = raw.map((s, i) => ({
      key: `s${i + 1}`, goal: String(s?.goal || ""), tool: s?.tool === "auto" || !s?.tool ? null : String(s.tool),
      args: null, expects: [{ kind: "ok" }],
      dependsOn: Array.isArray(s?.after) ? s.after.map((n) => `s${n}`) : [], required: true,
    })).filter((s) => s.goal);
    const norm = normalizePlan(planSteps, { candidateIds });
    if (norm.ok) return { ok: true, source: "model", steps: norm.steps };
  } catch { /* fall through to the single-step plan */ }

  return single(goal);
}

/** Store a plan: assign step ids, rewrite dependsOn from keys to ids, insert. */
export function materializePlan(db, runId, planVersion, planSteps) {
  const idByKey = new Map(planSteps.map((s) => [s.key, newStepId()]));
  return insertSteps(db, runId, planVersion, planSteps.map((s) => ({
    id: idByKey.get(s.key), goal: s.goal, tool: s.tool, args: s.args, expects: s.expects,
    dependsOn: (s.dependsOn || []).map((k) => idByKey.get(k)).filter(Boolean), required: s.required,
  })));
}
