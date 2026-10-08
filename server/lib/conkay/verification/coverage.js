// server/lib/conkay/verification/coverage.js
//
// Physics coverage per node: which domains apply to a node of this kind,
// which solver covered each one and at what fidelity, and which were not
// computed and why. A domain with no solver is reported as a gap, never
// treated as passing.

import { listSolvers } from "../physics/registry.js";

export const KIND_DOMAINS = {
  Bolt: ["mass", "cost", "structural.shear", "structural.tension", "fatigue", "corrosion"],
  Plate: ["mass", "cost", "structural.bearing", "structural.tearout", "corrosion"],
  Joint: ["structural.shear", "structural.bearing", "structural.tearout", "structural.slip", "corrosion.galvanic"],
  Assembly: ["mass", "mass.cg", "cost"],
  Actuator: ["mass", "cost", "thermal", "fatigue"],
  Part: ["mass", "cost"],
  Beam: ["mass", "cost", "structural.bending", "structural.buckling", "structural.deflection"],
};

export function coverage(graph, envelopes) {
  const solverDomains = new Set(listSolvers().flatMap((s) => s.domains));
  const out = [];
  for (const node of graph.nodes.values()) {
    const domains = KIND_DOMAINS[node.kind];
    if (!domains) {
      out.push({ node: node.id, kind: node.kind, domains: [], note: `no applicability table for ${node.kind} yet` });
      continue;
    }
    const rows = domains.map((domain) => {
      const hits = envelopes.filter((e) => (e?.solver?.domains || [e?.solver?.domain]).includes(domain) && (e.covers || [e.target]).includes(node.id));
      if (!hits.length) {
        return { domain, status: "not computed", reason: solverDomains.has(domain) ? "solver did not apply to this node" : `no ${domain} solver yet` };
      }
      return hits.map((e) => ({
        domain,
        status: e.status,
        solver: e.solver.id,
        fidelity: e.solver.fidelity,
        ...(e.status === "NOT_COMPUTED" ? { reason: e.reason } : {}),
        ...(e.status === "ERROR" ? { reason: e.error } : {}),
      }));
    }).flat();
    out.push({ node: node.id, kind: node.kind, domains: rows });
  }
  return out;
}
