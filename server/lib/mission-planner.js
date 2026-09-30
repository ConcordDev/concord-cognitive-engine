// server/lib/mission-planner.js
//
// P1 — Dynamic mission planner. LLM proposes steps when enabled;
// deterministic keyword/template routing always available as fallback.

import { AUTONOMOUS_SAFE_TOOLS, expandTemplate, getTemplate, listTemplateNames } from "./mission-templates.js";

const GOAL_TEMPLATE_MAP = [
  { re: /\b(fleet|health|verify|assemble)\b/i, template: "fleet_health" },
  { re: /\b(incident|watch|detect|alert)\b/i, template: "watch_detect" },
  { re: /\b(opportunit|pipeline|compose)\b/i, template: "opportunity_pipeline" },
  { re: /\b(research|proactive|predict)\b/i, template: "proactive_research" },
  { re: /\b(initiative|submit|monitor)\b/i, template: "initiative_monitor" },
  { re: /\b(experience|memory|consolidat|learn)\b/i, template: "experience_consolidate" },
  { re: /\b(edit|implement|refactor|fix bug|coding loop|patch|add export)\b/i, template: "coding_loop_closed" },
  { re: /\b(code|repo|symbol|depend|audit)\b/i, template: "coding_audit" },
  { re: /\b(marathon|long.?running|delegate)\b/i, template: "marathon_delegate" },
];

/**
 * Deterministic planner — maps goal text to template or builds read-only organ sweep.
 * @param {string} goal
 * @param {object} [opts]
 * @returns {{ title: string, goal: string, steps: Array, planner: string }}
 */
export function planDeterministic(goal, opts = {}) {
  const g = String(goal || "").trim();
  if (!g) return { ok: false, reason: "missing_goal" };

  for (const { re, template } of GOAL_TEMPLATE_MAP) {
    if (re.test(g) && getTemplate(template)) {
      const expanded = expandTemplate(template, opts.spawnContext || {});
      if (expanded) {
        return { ok: true, ...expanded, template, planner: "deterministic_keyword" };
      }
    }
  }

  if (opts.templateHint && getTemplate(opts.templateHint)) {
    const expanded = expandTemplate(opts.templateHint, opts.spawnContext || {});
    if (expanded) {
      return { ok: true, ...expanded, template: opts.templateHint, planner: "deterministic_hint" };
    }
  }

  // Default: minimal safe organ sweep
  const steps = [
    { tool: "sentinel_sweep", args: {} },
    { tool: "concordia_assemble", args: {} },
    { tool: "economic_check", args: {} },
  ];
  return {
    ok: true,
    title: g.slice(0, 80),
    goal: g,
    template: "dynamic_default",
    steps,
    planner: "deterministic_default",
  };
}

/**
 * Parse LLM JSON plan output. Expected: { steps: [{ tool, args? }] }
 */
export function parseLLMPlan(text, allowedTools = AUTONOMOUS_SAFE_TOOLS) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const clean = [];
    for (const s of steps) {
      const tool = String(s?.tool || "").trim();
      if (!tool || !allowedTools.has(tool)) continue;
      clean.push({ tool, args: s.args && typeof s.args === "object" ? s.args : {} });
    }
    if (!clean.length) return null;
    return clean;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.goal
 * @param {object} [opts.ctx] — may carry llm.chat
 * @param {string} [opts.templateHint]
 */
export async function planMission(opts = {}) {
  const goal = String(opts.goal || "").trim();
  if (!goal) return { ok: false, reason: "missing_goal" };

  const deterministic = planDeterministic(goal, opts);
  if (opts.plannerMode === "deterministic") {
    return deterministic;
  }

  const useLlm = opts.plannerMode === "llm"
    || (opts.plannerMode !== "template" && process.env.CONCORD_MISSION_PLANNER_LLM === "true");

  if (!useLlm) return deterministic;

  const toolList = [...AUTONOMOUS_SAFE_TOOLS].sort().join(", ");

  let systemPrompt = "You are the Concord mission planner. Output ONLY valid JSON.";
  let userPrompt = `{"steps":[{"tool":"<mcp_tool_name>","args":{}}]}
Use ONLY these tools: ${toolList}
Goal: ${goal}
Max 6 steps. Read-only observation tools preferred. No trade/deploy/execute.`;

  try {
    const { compileExecutiveCognition, buildDhtpMessages } = await import("./runtime/dhtp-compiler.js");
    const compiled = await compileExecutiveCognition({
      db: opts.db,
      mission: { id: "plan", goal, title: goal.slice(0, 80), template: "dynamic_llm", status: "planning" },
      step: { tool: "mission_plan" },
      stepIndex: 0,
      route: { taskClass: "reasoning" },
      request: "plan_mission_steps",
      expectedOutput: "json_steps",
      bumpRecall: false,
    });
    if (compiled?.ok) {
      const msgs = buildDhtpMessages(compiled, {
        userContent: `${userPrompt}\nRespond with JSON only.`,
      });
      systemPrompt = msgs[0].content;
      userPrompt = msgs[1].content;
    }
  } catch { /* fall through to raw prompt */ }

  try {
    const llm = opts.ctx?.llm;
    if (typeof llm?.chat === "function") {
      const res = await llm.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        brain: "utility",
        maxTokens: 512,
        timeoutMs: 8000,
      });
      const steps = parseLLMPlan(res?.text || res?.content || "");
      if (steps) {
        return {
          ok: true,
          title: goal.slice(0, 80),
          goal,
          template: "dynamic_llm",
          steps,
          planner: "llm",
        };
      }
    }
  } catch { /* fall through */ }

  return { ...deterministic, plannerFallback: true };
}

export function listPlannerModes() {
  return ["template", "deterministic", "llm", "dynamic"];
}

export function listAvailableTemplates() {
  return listTemplateNames();
}
