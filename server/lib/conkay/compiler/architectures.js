// server/lib/conkay/compiler/architectures.js
//
// Brief → system tree. An architecture is a schema, not a generator: it
// lays out the subsystem tree for a kind of product and wires each parsed
// requirement to the solver output that judges it. It invents no geometry,
// materials or numbers, so a fresh design is mostly NOT_COMPUTED, and the
// reasons say exactly what has to be supplied next.
//
// Nodes that stand for a critical vehicle component carry props.critical
// (see CRITICAL_VEHICLE_COMPONENTS): the acceptance gate fails while any of
// them is a placeholder, and a critical category with no node at all
// (differential, steering, cooling, ...) counts as missing.

import { parseBrief } from "./requirement-parser.js";
import { solveDesignText, SUPPORTED_PARTS } from "../nlp-design-intent.js";

const SUPPORTED_ARCHITECTURES = "road vehicle (car, truck, suv, van, roadster, coupe, sedan); L-bracket (bracket, angle bracket)";

function libraryMaterialId(intent) {
  if (intent.material === "aluminum") return "aluminum-6061-t6";
  if (intent.material === "concrete") return "concrete-30mpa";
  if (intent.material === "steel" || intent.material === "unknown") return "steel-a36";
  return null;
}

/** L-bracket: real plate geometry, tip load, and the screening solve. */
function compileBracketBrief(brief, parsed, name) {
  const solved = solveDesignText(brief);
  if (!solved.ok) {
    return {
      error: solved.error,
      parsed,
      code: solved.code,
      supportedParts: [...SUPPORTED_PARTS],
    };
  }
  const s = solved.intent.section;
  const mat = libraryMaterialId(solved.intent);
  const P = solved.hand.loadN;
  const q = (m) => `${m} m`;
  const plate = (id, label, length) => ({
    id,
    kind: "Plate",
    name: label,
    ...(mat ? { material: mat } : {}),
    geometry: { shape: "plate", length: q(length), width: q(s.width), thickness: q(s.thickness) },
    ...(id === "ARM" ? { props: { support: "cantilever" } } : {}),
  });
  return {
    architecture: "l-bracket",
    parsed,
    unmapped: [],
    assumed: solved.intent.assumed,
    assumptions: solved.intent.assumptions,
    solve: { hand: solved.hand, fea: solved.fea, section: s },
    mesh: {
      positions: solved.mesh.positions,
      indices: solved.mesh.indices,
      kind: solved.mesh.kind,
      vertexCount: solved.mesh.vertexCount,
      triangleCount: solved.mesh.triangleCount,
    },
    ir: {
      design: { id: "l-bracket", name: name || "L-bracket" },
      nodes: [
        { id: "BRK", kind: "Assembly", name: "L-bracket" },
        plate("ARM", "Horizontal arm", s.length),
        plate("LEG", "Vertical leg", s.legHeight),
      ],
      edges: [
        { type: "CONTAINS", from: "BRK", to: "ARM" },
        { type: "CONTAINS", from: "BRK", to: "LEG" },
      ],
      loadCases: [{ id: "service", label: "Service load", loads: [{ target: "ARM", pointLoad: `${P} N` }] }],
      requirements: [{
        id: "REQ_yield",
        label: "Arm bending stress within yield",
        of: { solver: "bracket.plate", target: "ARM", output: "utilization" },
        max: { value: 1, unit: "1" },
      }],
      brief,
    },
  };
}

function roadVehicle(req) {
  const seats = Math.max(1, Math.round(req.seats?.min?.si || 0)) || null;
  const nodes = [
    { id: "VEH", kind: "Assembly", name: "Vehicle", props: { vehicle: {} } },
    { id: "BODY", kind: "Assembly", name: "Body and aero" },
    { id: "CHASSIS", kind: "Assembly", name: "Chassis and crash structure" },
    { id: "POWERTRAIN", kind: "Assembly", name: "Powertrain" },
    { id: "ENGINE", kind: "Actuator", name: "Engine or motor", props: { critical: "engine_or_motor" } },
    { id: "DRIVELINE", kind: "Assembly", name: "Transmission and driveline" },
    { id: "SUSPENSION", kind: "Assembly", name: "Suspension and steering", props: { critical: "suspension" } },
    { id: "BRAKES", kind: "Assembly", name: "Brakes", props: { critical: "brakes" } },
    { id: "WHEELS", kind: "Assembly", name: "Wheels and tyres" },
    ...["FL", "FR", "RL", "RR"].map((p) => ({ id: `TIRE_${p}`, kind: "Tire", name: `Tyre ${p}`, props: { critical: "tyres" } })),
    { id: "INTERIOR", kind: "Assembly", name: "Interior and occupant package" },
    ...Array.from({ length: seats || 0 }, (_, i) => ({ id: `SEAT_${i + 1}`, kind: "Seat", name: `Seat ${i + 1}`, props: { critical: "interior_seats" } })),
    // One occupant per seat for performance (gross mass) and CG; not in the
    // kerb mass the mass target is judged on.
    ...Array.from({ length: seats || 0 }, (_, i) => ({
      id: `OCCUPANT_${i + 1}`, kind: "Payload", name: `Occupant ${i + 1}`,
      props: { mass: "77 kg", massSource: "standard adult occupant (assumption)" },
    })),
    { id: "ELECTRICAL", kind: "Assembly", name: "Electrical", props: { critical: "wiring" } },
  ];
  const contains = {
    VEH: ["BODY", "CHASSIS", "POWERTRAIN", "DRIVELINE", "SUSPENSION", "BRAKES", "WHEELS", "INTERIOR", "ELECTRICAL"],
    POWERTRAIN: ["ENGINE"],
    WHEELS: ["TIRE_FL", "TIRE_FR", "TIRE_RL", "TIRE_RR"],
    INTERIOR: nodes.filter((n) => n.kind === "Seat" || n.kind === "Payload").map((n) => n.id),
  };
  const map = {
    mass: { solver: "mass.assembly", target: "VEH", output: "mass" },
    topSpeed: { solver: "vehicle.top-speed", target: "VEH", output: "topSpeed" },
    seats: { solver: "package.seat-count", target: "VEH", output: "seats" },
    budget: { solver: "cost.assembly", target: "VEH", output: "cost" },
  };
  return { id: "road-vehicle", nodes, contains, map };
}

const ARCHITECTURES = [
  { match: /\b(car|vehicle|truck|suv|van|roadster|coupe|sedan)\b/i, build: roadVehicle },
];

/**
 * Compile a brief to a Design IR skeleton. Returns { ir, architecture,
 * parsed, unmapped } or { error } when no architecture fits.
 */
export function compileBrief(brief, { name } = {}) {
  const parsed = parseBrief(brief);
  if (/\b(l[\s-]?bracket|angle\s+bracket|bracket|cantilever\s+plate)\b/i.test(brief)
    && !/\b(car|vehicle|truck|suv|van|roadster|coupe|sedan)\b/i.test(brief)) {
    return compileBracketBrief(brief, parsed, name);
  }
  const arch = ARCHITECTURES.find((a) => a.match.test(brief));
  if (!arch) {
    return {
      error: `no architecture for this kind of design yet. Supported: ${SUPPORTED_ARCHITECTURES}. Parts you can design directly: ${SUPPORTED_PARTS.join(", ")}.`,
      parsed,
      supportedParts: [...SUPPORTED_PARTS],
    };
  }
  const req = Object.fromEntries(parsed.requirements.map((r) => [r.metric, r]));
  const a = arch.build(req);
  const requirements = [];
  const unmapped = [];
  for (const r of parsed.requirements) {
    const of = a.map[r.metric];
    if (!of) { unmapped.push({ metric: r.metric, source: r.source, reason: `no solver judges ${r.metric} for a ${a.id} yet` }); continue; }
    const q = r.max || r.min;
    const bound = { value: q.si, unit: { mass: "kg", velocity: "m/s", ratio: "1", money: "USD", length: "m", power: "W" }[q.dim] || "1" };
    requirements.push({ id: `REQ_${r.metric}`, label: r.source, of, ...(r.max ? { max: bound } : { min: bound }) });
  }
  const edges = Object.entries(a.contains).flatMap(([from, tos]) => tos.map((to) => ({ type: "CONTAINS", from, to })));
  return {
    architecture: a.id,
    parsed,
    unmapped,
    ir: { design: { id: a.id, name: name || brief.slice(0, 120) }, nodes: a.nodes, edges, requirements, brief },
  };
}
