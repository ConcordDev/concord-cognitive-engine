/**
 * DC Circuit Solver — Nodal Analysis (Kirchhoff's Current Law)
 *
 * Cross-System Multi-Physics CAD, electrical leg. Sibling to this same
 * directory's fea-solver.js (direct-stiffness beam-frame solver): pure
 * JavaScript, no external dependencies, a genuine textbook method rather
 * than an invented approximation.
 *
 * ── The physics (textbook, not invented) ────────────────────────────────
 * Plain nodal analysis (Sadiku, "Fundamentals of Electric Circuits";
 * Nilsson & Riedel, "Electric Circuits" — nodal analysis via KCL is a
 * standard first-course circuits result, not derived here). Pick one node
 * as the reference/ground (V=0 by definition) and write one Kirchhoff's
 * Current Law equation per remaining node: the sum of currents LEAVING a
 * node through resistors equals the sum of currents INJECTED into that
 * node by independent current sources:
 *
 *     G · V = I
 *
 * where G is the conductance matrix (G[i][i] = sum of 1/R for every
 * resistor touching node i; G[i][j] = -1/R for a resistor directly
 * between i and j), V is the vector of unknown node voltages, and I is
 * the vector of net injected currents. This module builds G and I by
 * "stamping" each element into the matrix (the standard nodal-analysis
 * assembly procedure) and solves for V via Gaussian elimination with
 * partial pivoting — reusing server/lib/compute/numerical.js's existing
 * `solveLinearSystem` rather than duplicating a second Gaussian
 * eliminator (fea-solver.js's own `solveSystem` operates on a flat
 * Float64Array with a fixed 6-DOF-per-node convention baked in; it is
 * the wrong shape for a plain per-node admittance matrix, so this module
 * does not import it).
 *
 * ── Honest scope limitation — read before wiring up a floating source ──
 * This is PLAIN nodal analysis, not the more general Modified Nodal
 * Analysis (MNA). Plain nodal analysis has no unknown-current variable
 * for an ideal voltage source, so it can only place a voltage source
 * whose current can be resolved by inspection: one where at least one
 * terminal is the ground node. A voltage source floating between two
 * non-ground nodes (needed for a "supernode") requires the full MNA
 * branch-current augmentation, which this module does NOT implement —
 * doing it correctly is more machinery (an augmented B/C/D block and a
 * combined (n+m)×(n+m) solve) than a half-finished attempt is worth, so
 * a floating source is refused with an honest `floating_voltage_source_
 * unsupported` reason rather than silently mishandled. Every voltage
 * source in a solvable network here must have its negative (or positive)
 * terminal tied directly to the declared ground node.
 *
 * ── Input shape ──────────────────────────────────────────────────────────
 *   nodes:       [{ id }]
 *   elements:    [{ id?, type: 'resistor'|'voltage_source'|'current_source',
 *                    nodeA, nodeB, value }]
 *   groundNodeId: the id of the node fixed at 0V (reference node)
 *
 *   resistor:        value = resistance in ohms, R > 0.
 *   current_source:  value = current in amps, DEFINED as flowing from
 *                     nodeA to nodeB through the source (i.e. the source
 *                     pushes current out of nodeA and into nodeB — an
 *                     ideal current source's branch current IS its value,
 *                     by definition, so no solve is needed to know it).
 *   voltage_source:  value = V(nodeA) − V(nodeB), with EXACTLY ONE of
 *                    nodeA/nodeB equal to groundNodeId (see scope note).
 *
 * ── Output shape ─────────────────────────────────────────────────────────
 *   { ok:true,
 *     nodeVoltages:   { [nodeId]: volts },
 *     branchCurrents: { [elementId]: amps },   // A→B per the value convention above
 *     powerByElement: { [elementId]: watts } }
 *   or an honest { ok:false, reason } — NEVER a fabricated numeric result
 *   for a singular, disconnected, or malformed network.
 */

import { solveLinearSystem } from "../compute/numerical.js";

const VALID_TYPES = new Set(["resistor", "voltage_source", "current_source"]);
const VOLTAGE_TIE_EPS = 1e-9; // volts — tolerance for "two sources agree on this node's fixed voltage"

function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate the raw input shape. Returns { ok:true } or an honest
 * { ok:false, reason } — never throws, and never partially validates
 * (every element is checked before any matrix assembly begins).
 */
function validateInput(nodes, elements, groundNodeId) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (!Array.isArray(elements) || elements.length === 0) {
    return { ok: false, reason: "bad_model_input" };
  }
  const ids = new Set();
  for (const n of nodes) {
    if (n == null || n.id === undefined || n.id === null) {
      return { ok: false, reason: "invalid_node_reference" };
    }
    const key = String(n.id);
    if (ids.has(key)) return { ok: false, reason: "duplicate_node_id" };
    ids.add(key);
  }
  if (groundNodeId === undefined || groundNodeId === null || !ids.has(String(groundNodeId))) {
    return { ok: false, reason: "ground_node_not_found" };
  }
  for (const el of elements) {
    if (!el || !VALID_TYPES.has(el.type)) {
      return { ok: false, reason: "invalid_element_type" };
    }
    if (!ids.has(String(el.nodeA)) || !ids.has(String(el.nodeB))) {
      return { ok: false, reason: "invalid_node_reference" };
    }
    if (!isFiniteNum(el.value)) {
      return { ok: false, reason: "invalid_element_value" };
    }
    if (el.type === "resistor" && !(el.value > 0)) {
      return { ok: false, reason: "invalid_resistor_value" };
    }
  }
  return { ok: true };
}

/**
 * Resolve the fixed voltage each non-ground node is pinned to by any
 * grounded voltage source touching it. Returns
 * { ok:true, fixedVoltageByNode: Map<string, number> } or an honest
 * failure reason (floating source, degenerate source, or two sources
 * disagreeing about the same node's voltage).
 */
function resolveVoltageSourceConstraints(elements, groundNodeId) {
  const groundKey = String(groundNodeId);
  const fixedVoltageByNode = new Map();
  for (const el of elements) {
    if (el.type !== "voltage_source") continue;
    const aKey = String(el.nodeA);
    const bKey = String(el.nodeB);
    if (aKey === bKey) {
      return { ok: false, reason: "degenerate_voltage_source" };
    }
    const aIsGround = aKey === groundKey;
    const bIsGround = bKey === groundKey;
    if (aIsGround && bIsGround) {
      return { ok: false, reason: "degenerate_voltage_source" };
    }
    if (!aIsGround && !bIsGround) {
      return { ok: false, reason: "floating_voltage_source_unsupported" };
    }
    // value = V(nodeA) - V(nodeB). Exactly one side is ground (=0V).
    const fixedKey = aIsGround ? bKey : aKey;
    const fixedValue = aIsGround ? -el.value : el.value;
    const prior = fixedVoltageByNode.get(fixedKey);
    if (prior !== undefined && Math.abs(prior - fixedValue) > VOLTAGE_TIE_EPS) {
      return { ok: false, reason: "conflicting_voltage_constraints" };
    }
    fixedVoltageByNode.set(fixedKey, fixedValue);
  }
  return { ok: true, fixedVoltageByNode };
}

/**
 * Every non-ground node must be referenced by at least one element, or
 * it is a genuinely disconnected/floating node with no defined voltage —
 * an honest failure rather than a fabricated 0V or NaN.
 */
function findDisconnectedNode(nodes, elements, groundNodeId) {
  const groundKey = String(groundNodeId);
  const touched = new Set();
  for (const el of elements) {
    touched.add(String(el.nodeA));
    touched.add(String(el.nodeB));
  }
  for (const n of nodes) {
    const key = String(n.id);
    if (key === groundKey) continue;
    if (!touched.has(key)) return key;
  }
  return null;
}

/**
 * Assemble + solve the reduced (ground-excluded) nodal system and label
 * an element index for each result key. Internal helper shared by
 * solveCircuit; kept separate so the assembly step (pure, deterministic)
 * is easy to unit-test independently of the public honest-failure wrapper.
 */
function assembleAndSolve(nodes, elements, groundNodeId, fixedVoltageByNode) {
  const groundKey = String(groundNodeId);
  const reducedNodes = nodes.filter((n) => String(n.id) !== groundKey);
  const size = reducedNodes.length;
  const indexOf = new Map(reducedNodes.map((n, i) => [String(n.id), i]));
  const idx = (nodeId) => {
    const key = String(nodeId);
    return key === groundKey ? -1 : indexOf.get(key);
  };

  const G = Array.from({ length: size }, () => new Array(size).fill(0));
  const I = new Array(size).fill(0);

  for (const el of elements) {
    const i = idx(el.nodeA);
    const j = idx(el.nodeB);
    if (el.type === "resistor") {
      const g = 1 / el.value;
      if (i >= 0) G[i][i] += g;
      if (j >= 0) G[j][j] += g;
      if (i >= 0 && j >= 0) {
        G[i][j] -= g;
        G[j][i] -= g;
      }
    } else if (el.type === "current_source") {
      // Current leaves nodeA, enters nodeB (this module's A→B convention).
      if (i >= 0) I[i] -= el.value;
      if (j >= 0) I[j] += el.value;
    }
    // voltage_source contributes no resistor/current stamp here — its
    // constraint is enforced below via row replacement (Dirichlet
    // elimination), the standard trick also used by fea-solver.js's own
    // applyBoundaryConditions for fixed-DOF supports.
  }

  for (const [fixedKey, fixedValue] of fixedVoltageByNode) {
    const row = indexOf.get(fixedKey);
    if (row === undefined) continue; // (fixedKey guaranteed to be a real non-ground node by validateInput)
    for (let c = 0; c < size; c++) G[row][c] = 0;
    G[row][row] = 1;
    I[row] = fixedValue;
  }

  const x = solveLinearSystem(G, I);
  if (x === null) return { ok: false, reason: "singular_matrix" };

  const nodeVoltages = { [groundKey]: 0 };
  for (const n of reducedNodes) {
    nodeVoltages[String(n.id)] = x[indexOf.get(String(n.id))];
  }
  return { ok: true, nodeVoltages };
}

/**
 * Recover the current an ideal grounded voltage source SUPPLIES into the
 * circuit, via KCL residual at its fixed (non-ground) terminal: whatever
 * current leaves that node through every OTHER (non-source) element must
 * be supplied by the source itself (an ideal voltage source can source or
 * sink any current needed to hold its terminal at the fixed voltage).
 *
 * Sign convention — deliberately NOT the resistor/current-source A→B
 * convention: a voltage source's two terminals are not symmetric the way
 * a resistor's are (one is always the ground reference), so "current
 * from nodeA to nodeB" is ambiguous/unintuitive depending on which side
 * happens to be ground. Instead this returns "current supplied by the
 * source out of its ungrounded terminal, into the rest of the circuit" —
 * positive means the source is actively driving current into the
 * network (the everyday reading of "how much current is this battery
 * delivering"). Combined with the terminal's own signed voltage, this
 * gives P = V·I = real delivered power with a physically legible sign
 * (see `powerByElement` in solveCircuit, and the energy-conservation
 * assertions in server/tests/circuit-solver.test.js that verify it).
 *
 * Honest limitation: if more than one voltage source is tied to the SAME
 * fixed node, plain nodal analysis cannot uniquely split the aggregate
 * current between them (that split is exactly what MNA's per-source
 * branch-current unknowns are for) — this function returns the shared
 * aggregate for each such source rather than fabricating a split.
 */
function voltageSourceSuppliedCurrent(el, nodeVoltages, elements, groundNodeId) {
  const groundKey = String(groundNodeId);
  const aKey = String(el.nodeA);
  const bKey = String(el.nodeB);
  const fixedKey = aKey === groundKey ? bKey : aKey;
  const vFixed = nodeVoltages[fixedKey];

  let leaving = 0;
  for (const other of elements) {
    if (other === el) continue;
    const oaKey = String(other.nodeA);
    const obKey = String(other.nodeB);
    if (oaKey !== fixedKey && obKey !== fixedKey) continue;
    if (other.type === "resistor") {
      const otherEndKey = oaKey === fixedKey ? obKey : oaKey;
      leaving += (vFixed - nodeVoltages[otherEndKey]) / other.value;
    } else if (other.type === "current_source") {
      // Defined as leaving nodeA, entering nodeB.
      if (oaKey === fixedKey) leaving += other.value;
      else leaving -= other.value;
    }
    // A second voltage_source sharing this node contributes to the same
    // aggregate below by construction (its own current is what's left
    // after this loop), so it is intentionally skipped here.
  }

  // By KCL, whatever current leaves the fixed node through every other
  // element must be exactly what the source supplies into that node.
  return leaving;
}

/**
 * Solve a DC resistor/source network via nodal analysis. Never throws;
 * always returns a plain object. See this file's header for the input/
 * output shape and the grounded-voltage-source scope limitation.
 *
 * @param {{nodes:Array<{id:*}>, elements:Array<object>, groundNodeId:*}} model
 * @returns {{ok:boolean, reason?:string, nodeVoltages?:object, branchCurrents?:object, powerByElement?:object}}
 */
export function solveCircuit(model) {
  const nodes = model && model.nodes;
  const elements = model && model.elements;
  const groundNodeId = model && model.groundNodeId;

  const inputCheck = validateInput(nodes, elements, groundNodeId);
  if (!inputCheck.ok) return inputCheck;

  const disconnected = findDisconnectedNode(nodes, elements, groundNodeId);
  if (disconnected !== null) {
    return { ok: false, reason: "disconnected_node", nodeId: disconnected };
  }

  const constraintCheck = resolveVoltageSourceConstraints(elements, groundNodeId);
  if (!constraintCheck.ok) return constraintCheck;

  const solved = assembleAndSolve(nodes, elements, groundNodeId, constraintCheck.fixedVoltageByNode);
  if (!solved.ok) return solved;

  const { nodeVoltages } = solved;
  const branchCurrents = {};
  const powerByElement = {};

  elements.forEach((el, i) => {
    const key = el.id !== undefined && el.id !== null ? String(el.id) : `${el.type}_${i}`;
    const va = nodeVoltages[String(el.nodeA)];
    const vb = nodeVoltages[String(el.nodeB)];
    if (el.type === "resistor") {
      const current = (va - vb) / el.value;
      branchCurrents[key] = current;
      powerByElement[key] = current * current * el.value; // I²R, always ≥ 0 (dissipated)
    } else if (el.type === "current_source") {
      branchCurrents[key] = el.value; // defined, not derived
      powerByElement[key] = el.value * (va - vb);
    } else {
      // voltage_source — see voltageSourceSuppliedCurrent's header for
      // why this uses a different sign convention than A→B: `current` is
      // signed current SUPPLIED by the source into its ungrounded
      // terminal, and `vFixed` is that terminal's own real signed
      // voltage, so P = vFixed·current is genuine delivered power (never
      // el.value·current, which would double up two different terminals'
      // worth of sign information into one product).
      const current = voltageSourceSuppliedCurrent(el, nodeVoltages, elements, groundNodeId);
      const groundKey = String(groundNodeId);
      const fixedKey = String(el.nodeA) === groundKey ? String(el.nodeB) : String(el.nodeA);
      const vFixed = nodeVoltages[fixedKey];
      branchCurrents[key] = current;
      powerByElement[key] = vFixed * current;
    }
  });

  return { ok: true, nodeVoltages, branchCurrents, powerByElement };
}
