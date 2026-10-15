// server/lib/conkay/verification/coverage.js
//
// Physics coverage per node: which domains apply to a node of this kind,
// which solver covered each one and at what fidelity, and which were not
// computed and why. A domain with no solver is reported as a gap, never
// treated as passing.
//
// The Joint applicability table reflects the 8 known limit states for
// a bolted-joint design (the list assembled 2026-10-12 with explicit
// AISC references for each):
//   structural.shear            → AISC §J3.6  (bolt shear)
//   structural.bearing          → AISC §J3-6a (bolt bearing on plate)
//   structural.tearout          → AISC §J3-6c (bolt tear-out / edge shear)
//   structural.tension          → AISC §J3.6  (bolt tension on Ab)
//   structural.combined         → AISC §J3.7  (shear + tension interaction)
//   structural.gross-section    → AISC §D2-1  (member gross yielding)
//   structural.net-section      → AISC §D2-2  (member net rupture)
//   structural.block-shear      → AISC §J4-3  (block shear rupture, Eq. J4-5)
//   structural.bolt-group       → Crawford-Kulak elastic method
//   structural.slip-critical    → AISC §J3.8  (Eq. J3-4, friction capacity)
//   structural.prying           → AISC §9 / DG9 (T-stub model)
//
// Each domain has a real solver registered. A domain is reported as
// "not computed" when (a) no solver is registered, or (b) the solver
// ran but returned NOT_COMPUTED with a reason (e.g. missing inputs).
// This matches the verdict semantics in `docs/engineering-workflow/
// verdict-semantics.md` — the verdict guard never silently lets a
// missing check pass.

import { listSolvers } from "../physics/registry.js";

export const KIND_DOMAINS = {
  Bolt: ["mass", "cost", "structural.shear", "structural.tension", "fatigue", "corrosion"],
  Plate: ["mass", "cost", "structural.bearing", "structural.tearout", "structural.gross-section", "structural.net-section", "structural.block-shear", "corrosion"],
  Joint: [
    // The 8 known bolted-joint limit states (bearing-type connection defaults)
    "structural.shear",          // AISC §J3.6
    "structural.bearing",        // AISC §J3-6a
    "structural.tearout",        // AISC §J3-6c
    "structural.tension",        // AISC §J3.6 (when joint has a tension demand)
    "structural.combined",       // AISC §J3.7 (when both shear + tension)
    "structural.gross-section",  // AISC §D2-1 (tension member yielding)
    "structural.net-section",    // AISC §D2-2 (tension member rupture)
    "structural.block-shear",    // AISC §J4-3 (block shear)
    "structural.bolt-group",     // Crawford-Kulak distribution
    // Slip-critical only applies when the joint is friction-grip
    "structural.slip-critical",  // AISC §J3.8
    // Prying only applies to T-stub geometries
    "structural.prying",         // AISC §9 / DG9
    // Long-term limit states (not yet implemented; listed so the gap
    // is visible to the user, not hidden)
    "corrosion.galvanic",
  ],
  Assembly: ["mass", "mass.cg", "cost"],
  Actuator: ["mass", "cost", "thermal", "fatigue"],
  Tire: ["mass", "cost", "safety.tire-speed", "structural.load-index"],
  Seat: ["mass", "cost", "package.ergonomics", "safety.restraint"],
  Part: ["mass", "cost"],
  Beam: ["mass", "cost", "structural.bending", "structural.buckling", "structural.deflection", "structural.chassis"],
};

// How many of the listed Joint domains are *required* (always must be
// checked) vs *conditional* (only when the design declares the
// corresponding demand or geometry). This is the denominator the
// verdict guard uses — it does NOT count a conditional domain as
// required if the design has no such demand.
//
// "Required" limit states: every bolted-joint design must check these,
// regardless of loading. They are the basic strength checks.
// "Conditional" limit states: only required if the design declares the
// relevant demand (tension, slip-critical, prying, etc.). Without the
// demand, the domain is reported as N/A, not as a gap.
export const JOINT_REQUIRED_DOMAINS = [
  "structural.shear",
  "structural.bearing",
  "structural.tearout",
  "structural.gross-section",
  "structural.net-section",
  "structural.block-shear",
  "structural.bolt-group",
];
export const JOINT_CONDITIONAL_DOMAINS = {
  "structural.tension": "design declares a tension load (load.tension > 0)",
  "structural.combined": "design declares both shear AND tension (load.shear > 0 AND load.tension > 0)",
  "structural.slip-critical": "design declares a slip-critical joint (props.fayingSurface set)",
  "structural.prying": "design declares a T-stub geometry (props.flangeThickness, tStubA, tStubB)",
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
