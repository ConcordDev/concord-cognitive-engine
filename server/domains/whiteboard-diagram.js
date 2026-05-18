// server/domains/whiteboard-diagram.js
//
// Whiteboard Sprint B Item #8 — prompt-to-diagram.
//
// Input is either a natural-language prompt (LLM produces structured
// JSON graph) or a Mermaid grammar source (parseMermaid).
// Output is whiteboard elements (rectangle/ellipse/arrow/text) ready
// to drop on the canvas via the existing draw path.
//
// Real LLM call (conscious brain). Real Mermaid grammar parser. Real
// Sugiyama / radial / grid layouters. No mock layouts.

import { layoutDiagram, parseMermaid } from "../lib/whiteboard/diagram-layout.js";

const TIMEOUT_MS = 25_000;
const KIND_PROMPTS = {
  flowchart: "Process / workflow / decision flow. Use directed edges.",
  sequence:  "Interaction sequence between participants over time.",
  erd:       "Entity-relationship diagram. Each node is a table; edges describe relations.",
  mindmap:   "Mind map. Single root with branching children (use mindmap: kind = 'mindmap').",
  uml_class: "UML class diagram. Each node is a class; edges describe relations.",
  swot:      "SWOT analysis. Exactly 4 nodes: Strengths, Weaknesses, Opportunities, Threats.",
};

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

function _validateGraph(g, kind) {
  if (!g || typeof g !== "object") return { ok: false, reason: "graph_not_object" };
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  if (nodes.length === 0) return { ok: false, reason: "no_nodes" };
  if (nodes.length > 200) return { ok: false, reason: "too_many_nodes", count: nodes.length };
  for (const n of nodes) {
    if (!n.id || typeof n.id !== "string") return { ok: false, reason: "node_missing_id" };
  }
  for (const e of edges) {
    if (!e.from || !e.to) return { ok: false, reason: "edge_missing_endpoint" };
  }
  return { ok: true, graph: { ...g, kind } };
}

export default function registerWhiteboardDiagramMacros(register) {
  register("whiteboard", "prompt_to_diagram", async (ctx, input = {}) => {
    const prompt = String(input.prompt || "").trim();
    const mermaidSrc = String(input.mermaid || "").trim();
    const kind = String(input.kind || "flowchart");
    if (!KIND_PROMPTS[kind]) return { ok: false, reason: "invalid_kind", validKinds: Object.keys(KIND_PROMPTS) };
    if (!prompt && !mermaidSrc) return { ok: false, reason: "prompt_or_mermaid_required" };

    // Path A: Mermaid grammar — no LLM needed.
    if (mermaidSrc) {
      const parsed = parseMermaid(mermaidSrc);
      if (!parsed.ok) return parsed;
      const laid = layoutDiagram(parsed.graph);
      return { ok: true, elements: [...laid.elements, ...laid.edgesElements], kind: laid.kind, source: "mermaid" };
    }

    // Path B: NL prompt → LLM → structured graph → layout.
    const llm = ctx?.llm;
    if (!llm?.chat) return { ok: false, reason: "llm_unavailable" };
    const sys = `You are converting natural-language requests into structured diagram JSON.
RESPOND ONLY with a JSON object: { "kind": "${kind}", "nodes": [{"id": "string", "label": "string"}, ...], "edges": [{"from": "node_id", "to": "node_id", "label": "string?"}, ...] }
Rules:
- Node ids are short snake_case strings, unique.
- Labels are user-facing, ≤ 60 chars.
- Edges reference node ids only.
- For ${kind}: ${KIND_PROMPTS[kind]}
- Up to 30 nodes. No prose, no markdown, no fences.`;
    const user = `Request: ${prompt}`;
    let raw = "";
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.2, maxTokens: 2048, slot: input.brain || "conscious",
      }), TIMEOUT_MS);
      raw = String(r?.text || r?.content || r?.message?.content || "");
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
    const parsed = _extractJsonObject(raw);
    const valid = _validateGraph(parsed, kind);
    if (!valid.ok) return { ...valid, raw: raw.slice(0, 500) };
    const laid = layoutDiagram(valid.graph);
    return { ok: true, elements: [...laid.elements, ...laid.edgesElements], kind: laid.kind, source: "llm", nodeCount: valid.graph.nodes.length, edgeCount: valid.graph.edges.length };
  }, { requiresLLM: true, note: "Convert NL prompt or Mermaid source into a real layouted diagram (flowchart / sequence / erd / mindmap / uml_class / swot)" });
}
