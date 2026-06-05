/**
 * Repair brain (qwen2.5:0.5b) — fast, cheap pre-flight validation across the
 * platform. Runs against the dedicated 11437 instance so it never contends
 * with chat/utility traffic.
 *
 * Three primary hooks:
 *   • vetDTUForPublish(dtu)     — before listing on marketplace
 *   • vetNPCDialogue(text, npc) — before sending to LLM dialogue prompt
 *   • vetUserSkill(skill)       — before saving a user-authored skill DTU
 *
 * Each returns { ok, score: 0-100, flags: [...], reason: string|null }.
 * A network/timeout failure returns { ok: true, score: null, flags: ["repair_unavailable"] }
 * so we fail OPEN — repair-brain checks should never block a user action by
 * being down. The check is always advisory; callers decide enforcement.
 */

import { BRAIN } from "./brain-config.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

const REPAIR_TIMEOUT_MS = 8_000;

async function callRepairBrain(prompt, options = {}) {
  const cfg = BRAIN.repair;
  if (!cfg?.url || !cfg?.enabled) {
    return { ok: false, error: "repair_brain_disabled" };
  }
  // Count this call into the per-brain activity stats (aggregate only — no content).
  // This is a DIRECT fetch (not via callBrain), so without this bump the repair brain's
  // work was invisible to /api/admin/brain-activity. Mirrors callBrain's accounting.
  if (cfg.stats) { cfg.stats.requests = (cfg.stats.requests || 0) + 1; cfg.stats.lastCallAt = new Date().toISOString(); }
  const _t0 = Date.now();
  try {
    const res = await fetch(`${cfg.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 200,
        },
      }),
      signal: AbortSignal.timeout(options.timeout ?? REPAIR_TIMEOUT_MS),
    });
    if (cfg.stats) cfg.stats.totalMs = (cfg.stats.totalMs || 0) + (Date.now() - _t0);
    if (!res.ok) { if (cfg.stats) cfg.stats.errors = (cfg.stats.errors || 0) + 1; return { ok: false, error: `repair_status_${res.status}` }; }
    const data = await res.json();
    return { ok: true, content: data.response || "" };
  } catch (e) {
    if (cfg.stats) cfg.stats.errors = (cfg.stats.errors || 0) + 1;
    return { ok: false, error: String(e.message || e) };
  }
}

function parseRepairJSON(text) {
  if (!text) return null;
  // Repair brain often returns prose around the JSON; extract the first {...}.
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const PASSTHROUGH_OK = {
  ok: true,
  score: null,
  flags: ["repair_unavailable"],
  reason: null,
};

/**
 * Vet a DTU before marketplace publish.
 * Looks for: prompt-injection bait, broken citations, harmful instructions,
 * obvious low quality (gibberish, duplicate body).
 */
export async function vetDTUForPublish(dtu) {
  if (!dtu || typeof dtu !== "object") return PASSTHROUGH_OK;
  const sample = [
    `TITLE: ${String(dtu.title || "").slice(0, 200)}`,
    `BODY:  ${String(dtu.body || dtu.content?.human || "").slice(0, 1500)}`,
    `TAGS:  ${(dtu.tags || []).join(", ").slice(0, 200)}`,
  ].join("\n");

  const prompt = TASK_PROMPTS.repairContentValidator({ sample });

  const r = await callRepairBrain(prompt, { temperature: 0.1, maxTokens: 200 });
  if (!r.ok) return PASSTHROUGH_OK;
  const parsed = parseRepairJSON(r.content);
  if (!parsed) return PASSTHROUGH_OK;
  return {
    ok: true,
    score: clampScore(parsed.score),
    flags: Array.isArray(parsed.flags) ? parsed.flags.filter(f => typeof f === "string") : [],
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 280) : null,
  };
}

/**
 * Vet an NPC dialogue prompt before it's sent to the conscious brain.
 * The repair brain's job is to catch when the dialogue text itself
 * (not the LLM response, which we can't see yet) attempts to inject the
 * prompt — e.g. authored backstory containing "ignore prior instructions".
 */
export async function vetNPCDialogue(text, npc) {
  if (!text || typeof text !== "string") return PASSTHROUGH_OK;
  const npcName = npc?.name || npc?.id || "unknown";
  const sample = String(text).slice(0, 1500);

  const prompt = TASK_PROMPTS.repairSecurityValidator({ npcName, sample });

  const r = await callRepairBrain(prompt, { temperature: 0.05, maxTokens: 150 });
  if (!r.ok) return PASSTHROUGH_OK;
  const parsed = parseRepairJSON(r.content);
  if (!parsed) return PASSTHROUGH_OK;
  return {
    ok: true,
    score: clampScore(parsed.score),
    flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 280) : null,
  };
}

/**
 * Vet a user-authored skill DTU. We want skills to actually describe a
 * teachable, applicable practice — not lorem ipsum, not abusive, not
 * indistinguishable from another existing skill.
 */
export async function vetUserSkill(skill) {
  if (!skill || typeof skill !== "object") return PASSTHROUGH_OK;
  const desc = String(skill.body || skill.description || skill.content?.human || "").slice(0, 1200);
  const title = String(skill.title || skill.name || "").slice(0, 200);

  const prompt = TASK_PROMPTS.repairCurriculumReviewer({ title, desc });

  const r = await callRepairBrain(prompt, { temperature: 0.1, maxTokens: 200 });
  if (!r.ok) return PASSTHROUGH_OK;
  const parsed = parseRepairJSON(r.content);
  if (!parsed) return PASSTHROUGH_OK;
  return {
    ok: true,
    score: clampScore(parsed.score),
    flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 280) : null,
  };
}

function clampScore(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const REPAIR_DEFAULT_FLOOR = {
  publish: 40,   // below this we warn/hold
  dialogue: 30,  // below this we strip/replace before LLM call
  skill: 35,
};
