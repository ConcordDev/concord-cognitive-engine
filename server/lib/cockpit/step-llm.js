// One schema-constrained model call per step (CKPT-04).
import { brainChat } from "../byo-router.js";
import { parseToolCalls } from "../chat-agent.js";
import { MODEL_PROFILES } from "./model-caps.js";
import { pickSchema, fillSchema, nativeTools, safeName, ASK_USER_SCHEMA, DONE_SCHEMA } from "./call-schema.js";
import { getToolSpec } from "./tool-spec.js";
import { loadMockFromEnv } from "./mock-model.js";

const SYSTEM = [
  "You operate Concord one step at a time. Reply with JSON only.",
  'Use only the tools listed. Use values from "Known values" instead of inventing them.',
  'If you cannot do the step with these tools, pick "ask_user". If the step is already satisfied, pick "done".',
].join("\n");

/** Build the two chat messages for a packet. */
export function packetMessages(packet, { reask = null } = {}) {
  const lines = [];
  if (packet.runGoal) lines.push(`Task: ${packet.runGoal}`);
  if (packet.goal) lines.push(`Step: ${packet.goal}`);
  if (packet.doneWhen) lines.push(`Done when: ${packet.doneWhen}`);
  if (packet.constraints?.length) {
    lines.push("Rules:");
    for (const c of packet.constraints) lines.push(`- ${c}`);
  }
  const prior = (packet.prior || []).filter((p) => p && p.values && Object.keys(p.values).length);
  if (prior.length) {
    lines.push("Known values:");
    for (const p of prior) {
      lines.push(`- ${p.goal}: ${Object.entries(p.values).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  }
  if (packet.evidence?.length) {
    lines.push("Evidence:");
    packet.evidence.forEach((e, i) => lines.push(`[${i + 1}] ${e.title}: ${e.snippet}`));
  }
  if (packet.menu?.length) {
    lines.push("Tools:");
    for (const m of packet.menu) lines.push(`- ${m.id}: ${m.description}`);
  }
  if (reask) lines.push(reask);
  lines.push("Reply as JSON.");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

function parseJson(text) {
  const t = String(text || "").trim();
  if (!t) return { empty: true };
  try { return { value: JSON.parse(t) }; } catch { /* try the outermost braces */ }
  const a = t.indexOf("{"); const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return { value: JSON.parse(t.slice(a, b + 1)) }; } catch { /* fall through */ } }
  return { bad: true };
}

const isTimeout = (e) => /timeout|timed out|aborted/i.test(String(e || ""));

/**
 * @returns {Promise<{ ok: boolean, call?: {tool:string,args:object,why:string},
 *   transport: string, modelCalls: number, tokensIn: number, tokensOut: number,
 *   provider?: string|null, model?: string|null, errorClass?: string, raw?: string }>}
 */
export async function requestStepCall(a) {
  const mock = a.deps?.mock || loadMockFromEnv();
  if (mock) return mock.next(a);

  const p = MODEL_PROFILES[a.profile] || MODEL_PROFILES["marker-only"];
  const chat = a.deps?.brainChat || brainChat;
  const menu = a.packet.menu || [];
  const menuIds = menu.map((m) => m.id);
  const messages = packetMessages(a.packet, { reask: a.reask });
  const timeoutMs = a.timeoutMs || 60000;
  const acc = { modelCalls: 0, tokensIn: 0, tokensOut: 0, provider: null, model: null };
  const fail = (errorClass, transport, raw) => ({ ok: false, errorClass, transport, raw, ...acc });
  const call1 = async (msgs, opts) => {
    const r = await chat({ db: a.db, userId: a.userId, slot: p.slot, messages: msgs, opts: { timeoutMs, ...opts } });
    acc.modelCalls += 1;
    acc.tokensIn += r?.tokensIn || 0;
    acc.tokensOut += r?.tokensOut || 0;
    acc.provider = r?.provider ?? acc.provider;
    acc.model = r?.model ?? acc.model;
    return r || {};
  };
  const done = (call, transport) => ({ ok: true, call, transport, ...acc });
  const failFrom = (r, transport) => {
    if (isTimeout(r.error)) return fail("timeout", transport, r.error);
    return fail("model_empty", transport, r.error);
  };
  const thinkOpt = p.think === false ? { think: false } : {};
  const known = new Set([...menuIds, "ask_user", "done"]);

  // Native tools: one call returns tool and args together.
  if (p.nativeTools && !a.forcedTool) {
    const provider = a.profile === "byo-anthropic" ? "anthropic" : "openai";
    const r = await call1(messages, {
      temperature: 0, maxTokens: 400,
      tools: nativeTools(menu, provider), toolChoice: "required", parallelToolCalls: false,
    });
    if (!r.ok && !r.toolCalls?.length) return failFrom(r, "native");
    const tc = r.toolCalls?.[0];
    if (!tc) return fail(String(r.text || "").trim() ? "model_malformed" : "model_empty", "native", r.text);
    const back = new Map(menuIds.map((id) => [safeName(id), id]));
    const tool = back.get(tc.name) || tc.name;
    if (!known.has(tool)) return fail("model_malformed", "native", tc.name);
    let args = tc.args;
    if (typeof args === "string") { const j = parseJson(args); args = j.value || {}; }
    return done({ tool, args: args && typeof args === "object" ? args : {}, why: "" }, "native");
  }

  // Marker transport: the model writes [TOOL_CALL: {...}] and we parse the line.
  if (!p.jsonSchemaFormat && !a.forcedTool) {
    const msgs = messages.map((m, i) => i === 1
      ? { ...m, content: `${m.content}\nReply with exactly one line: [TOOL_CALL: {"tool":"<id>","params":{...}}]` }
      : m);
    const r = await call1(msgs, { temperature: 0, maxTokens: 400 });
    if (!r.ok && !r.text) return failFrom(r, "marker");
    if (!String(r.text || "").trim()) return fail("model_empty", "marker");
    const tc = parseToolCalls(r.text)[0];
    if (!tc || !known.has(tc.tool)) return fail("model_malformed", "marker", r.text);
    return done({ tool: tc.tool, args: tc.params || {}, why: "" }, "marker");
  }

  // Format transport, phase 1: pick the tool (skipped when the step names it).
  let tool = a.forcedTool || null;
  let why = "";
  if (!tool) {
    const r = await call1(messages, {
      temperature: 0, maxTokens: 120, format: pickSchema(menuIds), ...thinkOpt,
    });
    if (!r.ok && !r.text) return failFrom(r, "format");
    const j = parseJson(r.text);
    if (j.empty) return fail("model_empty", "format");
    if (j.bad || !j.value || typeof j.value !== "object") return fail("model_malformed", "format", r.text);
    tool = String(j.value.tool || "");
    why = String(j.value.why || "").slice(0, 120);
    if (!known.has(tool)) return fail("model_malformed", "format", r.text);
  } else if (!known.has(tool)) {
    return fail("model_malformed", "format", tool);
  }

  // Phase 2: fill the chosen tool's own schema.
  const schema = tool === "ask_user" ? ASK_USER_SCHEMA : tool === "done" ? DONE_SCHEMA : fillSchema(getToolSpec(tool) || menu.find((m) => m.id === tool));
  const msgs2 = messages.map((m, i) => i === 1 ? { ...m, content: `${m.content}\nChosen tool: ${tool}. Give its arguments as JSON.` } : m);
  const r2 = await call1(msgs2, { temperature: 0, maxTokens: 400, format: schema, ...thinkOpt });
  if (!r2.ok && !r2.text) return failFrom(r2, "format");
  const j2 = parseJson(r2.text);
  if (j2.empty) return fail("model_empty", "format");
  if (j2.bad || !j2.value || typeof j2.value !== "object" || Array.isArray(j2.value)) return fail("model_malformed", "format", r2.text);
  return done({ tool, args: j2.value, why }, "format");
}
