// server/tests/whiteboard-diagram.test.js
//
// Tier-2 contract tests for Whiteboard Sprint B Item #8.
// Real Sugiyama / radial / grid layouter + real Mermaid parser.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { layoutDiagram, parseMermaid } from "../lib/whiteboard/diagram-layout.js";
import registerWhiteboardDiagramMacros from "../domains/whiteboard-diagram.js";

const macros = new Map();
registerWhiteboardDiagramMacros((_d, n, h) => macros.set(n, h));

describe("diagram-layout: layered DAG (flowchart)", () => {
  it("layered layout places source above target", () => {
    const out = layoutDiagram({
      kind: "flowchart",
      nodes: [{ id: "a", label: "Start" }, { id: "b", label: "End" }],
      edges: [{ from: "a", to: "b" }],
    });
    const a = out.elements.find((e) => e.sourceId === "a");
    const b = out.elements.find((e) => e.sourceId === "b");
    assert.ok(a && b);
    assert.ok(a.y < b.y, "source should be in a higher layer than target");
  });

  it("two-source merge places merge node in layer 1", () => {
    const out = layoutDiagram({
      kind: "flowchart",
      nodes: [{ id: "a" }, { id: "b" }, { id: "m" }],
      edges: [{ from: "a", to: "m" }, { from: "b", to: "m" }],
    });
    const a = out.elements.find((e) => e.sourceId === "a");
    const b = out.elements.find((e) => e.sourceId === "b");
    const m = out.elements.find((e) => e.sourceId === "m");
    assert.equal(a.y, b.y, "two sources in same layer");
    assert.ok(m.y > a.y);
  });

  it("edges produce arrow elements with from/to coords", () => {
    const out = layoutDiagram({
      kind: "flowchart",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b", label: "next" }],
    });
    assert.equal(out.edgesElements.length, 1);
    assert.equal(out.edgesElements[0].kind, "arrow");
    assert.equal(out.edgesElements[0].text, "next");
  });
});

describe("diagram-layout: radial mindmap", () => {
  it("puts root at origin, children on a ring", () => {
    const out = layoutDiagram({
      kind: "mindmap",
      nodes: [{ id: "root" }, { id: "c1" }, { id: "c2" }, { id: "c3" }],
      edges: [{ from: "root", to: "c1" }, { from: "root", to: "c2" }, { from: "root", to: "c3" }],
    });
    const root = out.elements.find((e) => e.sourceId === "root");
    assert.equal(root.x, 0);
    assert.equal(root.y, 0);
    // Children are non-zero coords.
    for (const id of ["c1", "c2", "c3"]) {
      const c = out.elements.find((e) => e.sourceId === id);
      const dist = Math.hypot(c.x, c.y);
      assert.ok(dist > 100, `${id} should be off-origin (got ${dist})`);
    }
  });
});

describe("diagram-layout: swot grid", () => {
  it("places first 4 nodes in quadrants", () => {
    const out = layoutDiagram({
      kind: "swot",
      nodes: [{ id: "s" }, { id: "w" }, { id: "o" }, { id: "t" }],
      edges: [],
    });
    const s = out.elements.find((e) => e.sourceId === "s");
    const w = out.elements.find((e) => e.sourceId === "w");
    const o = out.elements.find((e) => e.sourceId === "o");
    const t = out.elements.find((e) => e.sourceId === "t");
    assert.equal(s.x, 0); assert.equal(s.y, 0);
    assert.equal(w.x, 400); assert.equal(w.y, 0);
    assert.equal(o.x, 0); assert.equal(o.y, 300);
    assert.equal(t.x, 400); assert.equal(t.y, 300);
  });
});

describe("parseMermaid", () => {
  it("parses a basic flowchart with labels and edges", () => {
    const r = parseMermaid(`flowchart TD
A[Start] --> B[Middle]
B --> C[End]`);
    assert.equal(r.ok, true);
    assert.equal(r.graph.kind, "flowchart");
    assert.equal(r.graph.nodes.length, 3);
    assert.equal(r.graph.edges.length, 2);
    const start = r.graph.nodes.find((n) => n.id === "A");
    assert.equal(start.label, "Start");
  });

  it("parses sequenceDiagram with participants + messages", () => {
    const r = parseMermaid(`sequenceDiagram
participant Alice
participant Bob
Alice->>Bob: hi
Bob->>Alice: hello`);
    assert.equal(r.ok, true);
    assert.equal(r.graph.kind, "sequence");
    assert.equal(r.graph.nodes.length, 2);
    assert.equal(r.graph.edges.length, 2);
    assert.equal(r.graph.edges[0].label, "hi");
  });

  it("returns reason when no parseable nodes", () => {
    const r = parseMermaid("flowchart TD\nrandom nonsense line");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_nodes_parsed");
  });
});

describe("prompt_to_diagram macro", () => {
  it("Mermaid path returns elements without an LLM", async () => {
    const r = await macros.get("prompt_to_diagram")({}, {
      mermaid: "flowchart TD\nA[Start] --> B[End]",
      kind: "flowchart",
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, "mermaid");
    assert.ok(r.elements.length >= 3); // 2 nodes + 1 edge
  });

  it("Rejects invalid kind", async () => {
    const r = await macros.get("prompt_to_diagram")({}, { prompt: "x", kind: "spiral" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });

  it("Rejects empty prompt + no mermaid", async () => {
    const r = await macros.get("prompt_to_diagram")({}, { kind: "flowchart" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "prompt_or_mermaid_required");
  });

  it("LLM path returns elements when brain returns valid JSON", async () => {
    const ctx = { llm: { chat: async () => ({ text: JSON.stringify({
      kind: "flowchart",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    }) }) } };
    const r = await macros.get("prompt_to_diagram")(ctx, { prompt: "a simple flow", kind: "flowchart" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "llm");
    assert.equal(r.nodeCount, 2);
  });

  it("LLM garbage returns parse_failed without throwing", async () => {
    const ctx = { llm: { chat: async () => ({ text: "no json here" }) } };
    const r = await macros.get("prompt_to_diagram")(ctx, { prompt: "x", kind: "flowchart" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "graph_not_object");
  });
});
