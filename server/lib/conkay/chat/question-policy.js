// server/lib/conkay/chat/question-policy.js
//
// The deterministic question policy, per domain: for each field of the design, what reads it (the checks it
// blocks while unknown), whether it is ASKED, and the only defaults allowed. The rule:
//
//   ASK      the field is a requirement, a safety-relevant load or support with no sound default, or defines the
//            structure (nothing can be computed without it)
//   DEFAULT  only from a cited standard or library entry, recorded as status "default" with that source
//   UNKNOWN  anything else: stays unknown and blocks only the checks that read it
//
// At most MAX_QUESTIONS per turn, ordered by how many checks each answer unblocks (ties: table order).

export const QUESTION_POLICY_VERSION = "1.0.0";
export const MAX_QUESTIONS = 3;

export const STATUS = Object.freeze({
  INPUT: "design input", DEFAULT: "default", UNKNOWN: "unknown", COMPUTED: "computed", SOURCED: "sourced",
});

export const CITED_DEFAULTS = Object.freeze({
  steelFlexureOmega: {
    value: 1.67,
    source: "ANSI/AISC 360-16, Specification for Structural Steel Buildings, Chapter F (F1): Ωb = 1.67 (ASD) for flexure",
    applies: "steel members in bending, allowable strength design",
  },
  trussSupports: {
    value: "pin + roller",
    source: "R. C. Hibbeler, Structural Analysis: a planar truss on one pin and one roller has three independent reactions and is externally statically determinate",
    applies: "a simple planar truss",
  },
  standardGravity: {
    value: 9.80665,
    source: "3rd CGPM (1901): standard acceleration of gravity gn = 9.80665 m/s²",
    applies: "a load given as a mass is that mass's weight at gn",
  },
});

/**
 * fields[domain] = [{ field, label, ask: reason | null, question, blocks: [check ids] }]
 * ask: "requirement" | "safety load" | "safety support" | "defines the structure" | null (never asked)
 */
export const FIELDS = Object.freeze({
  car: [
    { field: "topSpeed", label: "top speed", ask: "requirement", question: "What top speed must it hold? (for example 180 mph or 290 km/h)", blocks: ["vehicle.top-speed", "vehicle.required-power", "tire.speed-rating", "vehicle.traction-battery", "aero.drag-buildup", "component.engine_or_motor"] },
    { field: "seats", label: "seats", ask: "requirement", question: "How many people must it seat?", blocks: ["package.occupant-fit", "package.interference", "structure.tub-layout", "mass.assembly"] },
    { field: "fuelType", label: "powertrain", ask: "defines the structure", question: "Electric or gasoline?", blocks: ["component.engine_or_motor", "component.fuel_or_battery", "vehicle.traction-battery"] },
    { field: "mass", label: "mass limit", ask: null, blocks: ["requirement.mass"] },
    { field: "range", label: "range", ask: null, blocks: ["requirement.range"] },
    { field: "budget", label: "budget", ask: null, blocks: ["requirement.budget"] },
  ],
  bracket: [
    { field: "load", label: "load", ask: "safety load", question: "What load does the bracket carry, and where? (for example 500 N at the tip)", blocks: ["beam.bending-stress", "beam.tip-deflection", "fea.utilization"] },
    { field: "length", label: "arm length", ask: "defines the structure", question: "How long is the arm, from the wall to the load?", blocks: ["beam.bending-stress", "beam.tip-deflection", "fea.utilization", "part.mesh"] },
    { field: "material", label: "material", ask: null, blocks: ["beam.allowable-stress", "beam.tip-deflection"] },
    { field: "safetyFactor", label: "safety factor", ask: null, blocks: ["beam.utilization-verdict"] },
    { field: "support", label: "support", ask: null, blocks: [] },
    { field: "section", label: "section", ask: null, blocks: [], note: "sized by the solver from the load and the allowable" },
  ],
  beam: [
    { field: "loads", label: "loads", ask: "safety load", question: "What loads act on the beam? (point loads in N or kN and where; distributed loads in kN/m)", blocks: ["beam.reactions", "beam.bending-stress", "beam.deflection", "fea.utilization"] },
    { field: "span", label: "span", ask: "defines the structure", question: "What is the span?", blocks: ["beam.reactions", "beam.bending-stress", "beam.deflection", "fea.utilization", "part.mesh"] },
    { field: "support", label: "supports", ask: "safety support", question: "How is it supported: simply supported, cantilever, or fixed at both ends?", blocks: ["beam.reactions", "beam.bending-stress", "beam.deflection"] },
    { field: "material", label: "material", ask: null, blocks: ["beam.allowable-stress", "beam.deflection"] },
    { field: "safetyFactor", label: "safety factor", ask: null, blocks: ["beam.utilization-verdict"] },
    { field: "section", label: "section", ask: null, blocks: [], note: "sized by the solver from the loads and the allowable" },
  ],
  truss: [
    { field: "loads", label: "joint loads", ask: "safety load", question: "What loads act on the truss, and at which joints? (for example 10 kN at each top joint)", blocks: ["truss.reactions", "truss.member-forces", "truss.member-stress"] },
    { field: "span", label: "span", ask: "defines the structure", question: "What is the span?", blocks: ["truss.geometry", "truss.reactions", "truss.member-forces"] },
    { field: "height", label: "height", ask: "defines the structure", question: "How tall is the truss?", blocks: ["truss.geometry", "truss.member-forces"] },
    { field: "panels", label: "panels", ask: "defines the structure", question: "How many panels (bays) along the span?", blocks: ["truss.geometry", "truss.member-forces"] },
    { field: "type", label: "truss type", ask: "defines the structure", question: "Which truss: Warren, Pratt or Howe?", blocks: ["truss.geometry", "truss.member-forces"] },
    { field: "support", label: "supports", ask: null, blocks: [] },
    { field: "material", label: "material", ask: null, blocks: ["truss.member-stress"] },
  ],
  "sentinel-part": [
    { field: "joint", label: "joint", ask: "defines the structure", question: "Which joint's part: hip, knee or ankle?", blocks: ["sentinel.load-case", "part.stress"] },
    { field: "loadCase", label: "load case", ask: "safety load", question: "Which load case: the gait-cycle peak torque from the Sentinel motion check?", blocks: ["part.stress", "part.deflection"] },
    { field: "part", label: "part", ask: "defines the structure", question: "Which part: the actuator bracket, a mount or a link?", blocks: ["part.geometry", "part.stress"] },
    { field: "material", label: "material", ask: null, blocks: ["part.allowable-stress"] },
    { field: "robot", label: "robot", ask: null, blocks: [] },
  ],
});

/** The questions to ask now and the unknowns left, from the claims (field -> claim). */
export function questionsFor(domain, claims) {
  const fields = FIELDS[domain] || [];
  const missing = fields.filter((f) => !claims[f.field] || claims[f.field].status === STATUS.UNKNOWN);
  const asked = missing.filter((f) => f.ask).map((f, i) => ({ field: f.field, question: f.question, reason: f.ask, unblocks: f.blocks, order: i }));
  asked.sort((a, b) => b.unblocks.length - a.unblocks.length || a.order - b.order);
  return {
    questions: asked.slice(0, MAX_QUESTIONS).map(({ order: _o, ...q }) => q),
    later: asked.slice(MAX_QUESTIONS).map(({ order: _o, ...q }) => q),
    unknowns: missing.filter((f) => !f.ask && !f.note).map((f) => ({ field: f.field, label: f.label, blocks: f.blocks })),
  };
}
