// The small typed input for one step (CKPT-07).
import { selectPreset } from "../dhtp.js";
import { MODEL_PROFILES } from "./model-caps.js";
import { packetMessages } from "./step-llm.js";
import { defang } from "./result-summary.js";

export function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

function describeExpects(expects) {
  const parts = [];
  for (const e of expects || []) {
    if (e.kind === "ok") parts.push("the tool succeeds");
    else if (e.kind === "nonempty") parts.push(`${e.path || "the result"} is not empty`);
    else if (e.kind === "range") parts.push(`${e.path || "the value"} is between ${e.min} and ${e.max}`);
    else if (e.kind === "schema") parts.push("the result has the expected fields");
  }
  return parts.length ? parts.join(" and ") : "The tool returns a result without an error.";
}

async function withTimeout(promise, ms) {
  let t;
  try {
    return await Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("recall_timeout")), ms); })]);
  } finally { clearTimeout(t); }
}

const measure = (packet) => packetMessages(packet).reduce((n, m) => n + m.content.length, 0);

/**
 * @param {{ run: object, step: object, priorSteps: object[], menu: object[], profile: string,
 *           userId: string, constraints?: string[], lensEvidence?: object[], deps?: { recall?: Function } }} a
 */
export async function buildContextPacket(a) {
  const budget = (MODEL_PROFILES[a.profile] || MODEL_PROFILES["marker-only"]).packetBudgetIn;
  const dependsOn = new Set(a.step.dependsOn || []);

  // Prior values: depended-on steps first, then recent done steps, newest first.
  const done = (a.priorSteps || []).filter((s) => s.status === "done" && s.id !== a.step.id);
  const deps = done.filter((s) => dependsOn.has(s.id));
  const rest = done.filter((s) => !dependsOn.has(s.id)).sort((x, y) => (y.seq || 0) - (x.seq || 0));
  const toPrior = (s) => ({ stepId: s.id, goal: s.goal, values: s.resultSummary?.values || {} });
  const prior = [...deps, ...rest].slice(0, 6).map(toPrior).filter((p) => Object.keys(p.values).length);

  // Evidence: lens first, then the user's own recalled notes. Recall is always user-scoped.
  const evidence = (a.lensEvidence || []).slice(0, 3).map((e) => ({ ...e, snippet: defang(e.snippet) }));
  const recall = a.deps?.recall || globalThis.__concordRecallMemory;
  if (typeof recall === "function") {
    try {
      const mem = await withTimeout(Promise.resolve(recall({
        query: a.step.goal, userId: a.userId, sessionId: a.run.chatSessionId || null, limit: 5,
      })), 3000);
      for (const d of mem?.dtus || []) {
        if (evidence.length >= 8) break;
        if (!d?.id) continue;
        evidence.push({ id: d.id, title: defang(String(d.title || d.id).slice(0, 120)), snippet: defang(String(d.snippet || "").slice(0, 240)), source: "dtu" });
      }
    } catch { /* recall is optional */ }
  }

  const constraints = [...(a.constraints || []), "Use ids and values from Known values. Do not invent ids."].slice(0, 6);
  const packet = {
    presetId: selectPreset(a.run.goal)?.preset?.id || "cockpit.step",
    goal: a.step.goal,
    runGoal: String(a.run.goal || "").slice(0, 300),
    evidence: evidence.slice(0, 8),
    prior,
    constraints,
    doneWhen: describeExpects(a.step.expects),
    menu: a.menu,
    tokenBudgetIn: budget,
    estTokens: 0,
  };

  // Trim to budget; never drop the menu, the step goal, doneWhen, or a depended-on prior.
  const over = () => estimateTokens("x".repeat(measure(packet))) > budget;
  while (over() && packet.evidence.length) packet.evidence.pop();
  if (over()) packet.evidence.forEach((e) => { e.snippet = e.snippet.slice(0, 120); });
  while (over()) {
    let i = packet.prior.length - 1;
    while (i >= 0 && dependsOn.has(packet.prior[i].stepId)) i--;
    if (i < 0) break;
    packet.prior.splice(i, 1);
  }
  if (over()) packet.runGoal = packet.runGoal.slice(0, 150);
  packet.estTokens = estimateTokens("x".repeat(measure(packet)));
  if (packet.estTokens > budget) packet.overBudget = true;
  return packet;
}
