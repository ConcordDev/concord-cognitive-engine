// server/lib/whiteboard/canvas-agent.js
//
// Whiteboard Sprint B Item #9 — agent-on-canvas (tldraw-computer parity).
//
// One step per heartbeat tick (~1min). Agent has six tools:
//   add_sticky({text, x?, y?, color?})
//   add_shape({kind, label?, x?, y?, w?, h?})
//   connect({fromId, toId, label?})
//   cluster({ids, color?, label?})
//   summarize({})  → returns summary used in next prompt
//   read_canvas({}) → returns current elements snapshot
//
// Each step: read snapshot → prompt brain with goal + canvas state +
// tool catalogue → parse JSON tool call → execute against the board
// scene (via appendDelta) → emit realtime event.
//
// Real brain call (conscious slot, 20s timeout). Real DB writes. No
// fake tool stubs.

import { randomUUID } from "node:crypto";
import { getBoard, appendDelta, hasRole } from "./persistence.js";

const TOOL_CATALOGUE = [
  { name: "add_sticky", description: "Add a sticky note. {text: string, x?: number, y?: number, color?: string}" },
  { name: "add_shape", description: "Add a shape. {kind: rectangle|ellipse|notecard|frame, label?: string, x?: number, y?: number, w?: number, h?: number}" },
  { name: "connect", description: "Draw an arrow between two elements. {fromId: string, toId: string, label?: string}" },
  { name: "cluster", description: "Color-tag a group of elements as a cluster. {ids: string[], color?: string, label?: string}" },
  { name: "summarize", description: "Summarise current canvas. {} → returns summary" },
  { name: "read_canvas", description: "Read current canvas state. {} → returns elements" },
  { name: "done", description: "Signal task completed. {reason?: string}" },
];

const STEP_TIMEOUT_MS = 20_000;
const MAX_ELEMENTS_VISIBLE = 80;

function _withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

function _extractJsonObject(raw) {
  const stripped = String(raw || "").replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "$1").trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try regex */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

function _summariseScene(scene, limit = MAX_ELEMENTS_VISIBLE) {
  const els = Array.isArray(scene?.elements) ? scene.elements : [];
  return els.slice(0, limit).map((e) => ({
    id: e.id, kind: e.kind || e.type, text: e.text || e.label || "",
    x: Math.round(e.x || 0), y: Math.round(e.y || 0),
  }));
}

/**
 * Apply a single tool call to the scene + persist a delta.
 * Returns { ok, updatedScene, observation } — observation is what
 * the agent sees in the next prompt.
 */
function _applyTool(db, { boardId, userId, scene, toolName, toolArgs }) {
  const els = Array.isArray(scene?.elements) ? scene.elements : [];
  if (toolName === "add_sticky") {
    const id = `agent_sticky_${randomUUID().slice(0, 8)}`;
    const el = {
      id, kind: "notecard", type: "notecard",
      x: Number(toolArgs?.x) || Math.round(Math.random() * 600),
      y: Number(toolArgs?.y) || Math.round(Math.random() * 400),
      width: 160, height: 80,
      text: String(toolArgs?.text || "").slice(0, 400),
      stroke: String(toolArgs?.color || "#fbbf24"), fill: "transparent", strokeWidth: 2,
      authoredBy: "agent",
    };
    const newScene = { ...scene, elements: [...els, el] };
    appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    return { ok: true, updatedScene: newScene, observation: `Added sticky ${id} at (${el.x}, ${el.y})` };
  }
  if (toolName === "add_shape") {
    const id = `agent_shape_${randomUUID().slice(0, 8)}`;
    const el = {
      id, kind: String(toolArgs?.kind || "rectangle"), type: String(toolArgs?.kind || "rectangle"),
      x: Number(toolArgs?.x) || Math.round(Math.random() * 600),
      y: Number(toolArgs?.y) || Math.round(Math.random() * 400),
      width: Number(toolArgs?.w) || 160, height: Number(toolArgs?.h) || 80,
      text: String(toolArgs?.label || "").slice(0, 200),
      stroke: "#9ca3af", fill: "transparent", strokeWidth: 2,
      authoredBy: "agent",
    };
    const newScene = { ...scene, elements: [...els, el] };
    appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    return { ok: true, updatedScene: newScene, observation: `Added shape ${id} (${el.kind}) at (${el.x}, ${el.y})` };
  }
  if (toolName === "connect") {
    const fromEl = els.find((e) => e.id === toolArgs?.fromId);
    const toEl = els.find((e) => e.id === toolArgs?.toId);
    if (!fromEl || !toEl) return { ok: false, observation: "connect failed: unknown fromId or toId" };
    const id = `agent_arrow_${randomUUID().slice(0, 8)}`;
    const el = {
      id, kind: "arrow", type: "arrow",
      x: (fromEl.x || 0) + (fromEl.width || 50) / 2,
      y: (fromEl.y || 0) + (fromEl.height || 50),
      x2: (toEl.x || 0) + (toEl.width || 50) / 2,
      y2: (toEl.y || 0),
      stroke: "#9ca3af", strokeWidth: 2,
      text: toolArgs?.label || undefined,
      authoredBy: "agent",
    };
    const newScene = { ...scene, elements: [...els, el] };
    appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    return { ok: true, updatedScene: newScene, observation: `Connected ${toolArgs.fromId} → ${toolArgs.toId}` };
  }
  if (toolName === "cluster") {
    const ids = Array.isArray(toolArgs?.ids) ? toolArgs.ids : [];
    const color = String(toolArgs?.color || "rgba(124,58,237,0.18)");
    const label = String(toolArgs?.label || "Cluster");
    const targets = els.filter((e) => ids.includes(e.id));
    if (targets.length === 0) return { ok: false, observation: "cluster failed: no matching ids" };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of targets) {
      const x = t.x || 0, y = t.y || 0, w = t.width || 50, h = t.height || 50;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    const id = `agent_cluster_${randomUUID().slice(0, 8)}`;
    const pad = 16;
    const el = {
      id, kind: "frame", type: "frame",
      x: minX - pad, y: minY - pad,
      width: maxX - minX + pad * 2, height: maxY - minY + pad * 2,
      text: label, stroke: color, fill: color, strokeWidth: 1,
      authoredBy: "agent", behind: true,
    };
    const newScene = { ...scene, elements: [el, ...els] };
    appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    return { ok: true, updatedScene: newScene, observation: `Clustered ${ids.length} elements as "${label}"` };
  }
  if (toolName === "summarize") {
    const text = _summariseScene(scene).map((e) => `[${e.id}] ${e.kind} "${e.text || ""}"`).join("\n");
    return { ok: true, updatedScene: scene, observation: `Canvas summary:\n${text || "(empty)"}` };
  }
  if (toolName === "read_canvas") {
    return { ok: true, updatedScene: scene, observation: `Canvas has ${els.length} elements: ${JSON.stringify(_summariseScene(scene).slice(0, 30))}` };
  }
  if (toolName === "done") {
    return { ok: true, updatedScene: scene, observation: `Done: ${toolArgs?.reason || "agent signalled completion"}`, done: true };
  }
  return { ok: false, observation: `unknown tool: ${toolName}` };
}

/**
 * Run a single step of the agent on the given board. Read state,
 * prompt brain, parse tool call, execute. Returns { ok, observation,
 * done, toolCalled }.
 */
export async function runAgentStep({ ctx, boardId, task, sessionId, history = [] }) {
  const db = ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db;
  const userId = ctx?.actor?.userId || ctx?.userId;
  if (!db || !userId) return { ok: false, reason: "auth_required" };
  if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
  const row = getBoard(db, boardId);
  if (!row) return { ok: false, reason: "board_not_found" };
  const scene = row.scene || { elements: [] };
  const summary = _summariseScene(scene);

  const llm = ctx?.llm;
  if (!llm?.chat) {
    // No-LLM fallback: place a single sticky describing the task.
    const res = _applyTool(db, { boardId, userId, scene, toolName: "add_sticky", toolArgs: { text: `Agent fallback (LLM offline): ${task}` } });
    return { ok: true, toolCalled: "add_sticky", observation: res.observation, done: true };
  }

  const sys = `You are a whiteboard collaboration agent. ONE tool call per turn.
Respond ONLY with JSON: { "tool": "<name>", "args": {...} }.
Available tools:
${TOOL_CATALOGUE.map((t) => `- ${t.name}: ${t.description}`).join("\n")}
After several rounds of useful work, call "done".`;

  const historyMsg = history.slice(-6).map((h, i) => `Step ${i + 1}: tool=${h.toolCalled} obs="${(h.observation || "").slice(0, 200)}"`).join("\n");
  const user = `Goal: ${task}\n\nCanvas (${scene.elements?.length || 0} elements):\n${JSON.stringify(summary.slice(0, 40))}\n\nHistory:\n${historyMsg || "(no prior steps)"}\n\nReturn next tool call as JSON.`;

  let raw = "";
  try {
    const r = await _withTimeout(llm.chat({
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.4, maxTokens: 600, slot: "conscious",
    }), STEP_TIMEOUT_MS);
    raw = String(r?.text || r?.content || r?.message?.content || "");
  } catch (e) {
    return { ok: false, reason: "llm_error", error: e?.message };
  }
  const parsed = _extractJsonObject(raw);
  if (!parsed || typeof parsed.tool !== "string") {
    return { ok: false, reason: "parse_failed", raw: raw.slice(0, 300) };
  }
  const toolArgs = parsed.args && typeof parsed.args === "object" ? parsed.args : {};
  const result = _applyTool(db, { boardId, userId, scene, toolName: parsed.tool, toolArgs });
  // Realtime ping so the canvas updates without polling.
  try {
    globalThis._concordREALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:agent-step", {
      boardId, sessionId, toolCalled: parsed.tool, observation: result.observation, ts: Date.now(),
    });
  } catch { /* best effort */ }
  return { ok: true, toolCalled: parsed.tool, toolArgs, observation: result.observation, done: !!result.done };
}
