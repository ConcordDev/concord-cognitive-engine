// Fill named slots from one sentence with a single constrained call (CKPT-18). No free text.
import { requestStepCall } from "./step-llm.js";

const MAX_SLOT_CHARS = 80;

/**
 * @param {{ text: string, slots: { name: string, description: string, required: boolean }[], profile: string,
 *           db?: object, userId?: string, deps?: object }} a
 * @returns {Promise<{ ok: boolean, values: Record<string,string|null>, reason?: string }>}
 */
export async function extractSlots(a) {
  const text = String(a.text || "").trim();
  const slots = a.slots || [];
  const values = Object.fromEntries(slots.map((s) => [s.name, null]));
  const inputSchema = {
    type: "object",
    additionalProperties: false,
    required: slots.filter((s) => s.required).map((s) => s.name),
    properties: Object.fromEntries(slots.map((s) => [s.name, { type: ["string", "null"], description: s.description }])),
  };
  const menu = [{
    id: "extract_slots",
    description: `Copy these out of the sentence, exactly as short values: ${slots.map((s) => `${s.name} (${s.description})`).join("; ")}. Use null when it is not there.`,
    inputSchema,
  }];
  const packet = {
    goal: "Pull the named values out of the sentence.", runGoal: text.slice(0, 300),
    evidence: [], prior: [], constraints: ["Give only the short value, never the whole sentence."],
    doneWhen: "Every required value is filled.", menu, tokenBudgetIn: 1000,
  };
  let r;
  try {
    r = await requestStepCall({ db: a.db, userId: a.userId, profile: a.profile, packet, forcedTool: "extract_slots", deps: a.deps });
  } catch {
    return { ok: false, values, reason: "model_failed" };
  }
  if (!r?.ok) return { ok: false, values, reason: "model_failed" };
  const got = r.call?.args && typeof r.call.args === "object" ? r.call.args : {};
  let ok = true;
  for (const s of slots) {
    const v = typeof got[s.name] === "string" ? got[s.name].trim() : "";
    const bad = !v || v.length > MAX_SLOT_CHARS || v.toLowerCase() === text.toLowerCase();
    if (bad) { if (s.required) ok = false; continue; }
    values[s.name] = v;
  }
  return ok ? { ok: true, values } : { ok: false, values, reason: "slot_missing" };
}
