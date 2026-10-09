// server/lib/conkay/graph/design-graph.js
//
// The Design Graph: typed nodes and typed edges compiled from the Design IR,
// plus the revision history of every edit. Values are SI. Edits address a
// node property by path ("material", "geometry.diameter") and return the
// dependency key the engine uses to find what to rerun.

import { compileDesignIR, SHAPES, TYPED_PROPS, paramDim } from "../compiler/design-ir.js";
import { getMaterial } from "../materials/index.js";

export function nodeKey(id, path) {
  return `node:${id}/${path}`;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export class DesignGraph {
  static fromIR(ir) {
    const c = compileDesignIR(ir);
    if (!c.ok) return { ok: false, errors: c.errors };
    return { ok: true, graph: new DesignGraph(c.design) };
  }

  constructor(compiled) {
    this.design = compiled.design;
    this.materialOverrides = compiled.materialOverrides;
    this.nodes = new Map(compiled.nodes.map((n) => [n.id, n]));
    this.edgeList = compiled.edges;
    this.loadCases = compiled.loadCases;
    this.requirements = compiled.requirements;
    this.revision = 0;
    this.history = [];
  }

  node(id) {
    return this.nodes.get(id) || null;
  }

  nodesOfKind(kind) {
    return [...this.nodes.values()].filter((n) => n.kind === kind);
  }

  edges(type) {
    return type ? this.edgeList.filter((e) => e.type === type) : this.edgeList;
  }

  /** Nodes reached from `id` by `type` edges (from → to). */
  children(id, type = "CONTAINS") {
    return this.edgeList.filter((e) => e.type === type && e.from === id).map((e) => this.node(e.to));
  }

  /** Loads on a target from every load case: [{ loadCase, shear?, tension? }]. */
  loadsOn(id) {
    const out = [];
    for (const lc of this.loadCases) {
      for (const l of lc.loads) if (l.target === id) out.push({ loadCase: lc.id, ...l });
    }
    return out;
  }

  get(id, path) {
    const n = this.node(id);
    return n ? getPath(n, path) : undefined;
  }

  /**
   * Set one node property. Validates the value against what the IR allows.
   * Returns { ok, key, before, after } or { ok:false, error }.
   */
  set(id, path, value) {
    const n = this.node(id);
    if (!n) return { ok: false, error: `no node "${id}"` };
    const before = getPath(n, path);
    if (path === "material") {
      if (!getMaterial(value)) return { ok: false, error: `unknown material "${value}"` };
      n.material = value;
    } else if (path.startsWith("geometry.")) {
      const param = path.slice("geometry.".length);
      if (!n.geometry || !SHAPES[n.geometry.shape].includes(param)) {
        return { ok: false, error: `${id} has no geometry parameter "${param}"` };
      }
      if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
        return { ok: false, error: `${param} must be a positive ${paramDim(param)}` };
      }
      n.geometry[param] = value;
    } else if (/^position\.[xyz]$/.test(path)) {
      if (!n.position) return { ok: false, error: `${id} has no position` };
      if (!(typeof value === "number" && Number.isFinite(value))) return { ok: false, error: "position must be a length" };
      n.position[path.slice(-1)] = value;
    } else if (path.startsWith("props.")) {
      const keys = path.slice("props.".length).split(".");
      if (TYPED_PROPS[keys[0]] && keys.length === 1 && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
        return { ok: false, error: `${keys[0]} must be a positive ${TYPED_PROPS[keys[0]]} in SI units` };
      }
      let o = n.props;
      for (const k of keys.slice(0, -1)) {
        if (o[k] == null || typeof o[k] !== "object") o[k] = {};
        o = o[k];
      }
      o[keys.at(-1)] = value;
    } else {
      return { ok: false, error: `cannot edit "${path}"` };
    }
    return { ok: true, key: nodeKey(id, path), before, after: getPath(n, path) };
  }

  /**
   * Add a node (Design IR node spec, validated like the IR) under a parent
   * with a CONTAINS edge. Returns { ok, node } or { ok:false, error }.
   */
  addNode(spec, parentId) {
    if (spec?.id && this.nodes.has(spec.id)) return { ok: false, error: `a node "${spec.id}" already exists` };
    if (parentId != null && !this.nodes.has(parentId)) return { ok: false, error: `no parent "${parentId}"` };
    const c = compileDesignIR({ nodes: [spec] });
    if (!c.ok) return { ok: false, error: c.errors.join("; ") };
    const node = c.design.nodes[0];
    this.nodes.set(node.id, node);
    if (parentId != null) this.edgeList.push({ type: "CONTAINS", from: parentId, to: node.id, props: {} });
    return { ok: true, node };
  }

  /**
   * Remove a node and every edge touching it. Refused while loads or
   * requirements still point at it. Returns what was removed, for undo.
   */
  removeNode(id) {
    if (!this.nodes.has(id)) return { ok: false, error: `no node "${id}"` };
    if (this.loadCases.some((lc) => lc.loads.some((l) => l.target === id))) return { ok: false, error: `${id} still carries loads` };
    if (this.requirements.some((r) => r.of.target === id)) return { ok: false, error: `a requirement still points at ${id}` };
    const node = this.nodes.get(id);
    const edges = this.edgeList.filter((e) => e.from === id || e.to === id);
    this.nodes.delete(id);
    this.edgeList = this.edgeList.filter((e) => e.from !== id && e.to !== id);
    return { ok: true, node, edges };
  }

  /** Put back what removeNode took out. */
  restoreNode(node, edges) {
    this.nodes.set(node.id, node);
    this.edgeList.push(...edges);
  }

  /** Effective material for a node: library properties plus user overrides. */
  materialOf(id) {
    const n = this.node(id);
    const m = n?.material ? getMaterial(n.material) : null;
    if (!m) return null;
    const o = this.materialOverrides[m.id];
    if (!o) return m;
    return { ...m, ...(o.costPerKgUsd != null ? { costPerKgUsd: o.costPerKgUsd, costSource: o.source } : {}) };
  }

  toJSON() {
    return {
      design: this.design,
      revision: this.revision,
      nodes: [...this.nodes.values()],
      edges: this.edgeList,
      loadCases: this.loadCases,
      requirements: this.requirements,
      history: this.history,
    };
  }
}
