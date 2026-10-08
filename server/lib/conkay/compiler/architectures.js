// server/lib/conkay/compiler/architectures.js
//
// Brief → system tree. An architecture is a schema, not a generator: it
// lays out the subsystem tree for a kind of product and wires each parsed
// requirement to the solver output that judges it. It invents no geometry,
// materials or numbers, so a fresh design is mostly NOT_COMPUTED, and the
// reasons say exactly what has to be supplied next.

import { parseBrief } from "./requirement-parser.js";

function roadVehicle(req) {
  const seats = Math.max(1, Math.round(req.seats?.min?.si || 0)) || null;
  const nodes = [
    { id: "VEH", kind: "Assembly", name: "Vehicle", props: { vehicle: {} } },
    { id: "BODY", kind: "Assembly", name: "Body and aero" },
    { id: "CHASSIS", kind: "Assembly", name: "Chassis and crash structure" },
    { id: "POWERTRAIN", kind: "Assembly", name: "Powertrain" },
    { id: "ENGINE", kind: "Actuator", name: "Engine or motor" },
    { id: "DRIVELINE", kind: "Assembly", name: "Transmission and driveline" },
    { id: "SUSPENSION", kind: "Assembly", name: "Suspension and steering" },
    { id: "BRAKES", kind: "Assembly", name: "Brakes" },
    { id: "WHEELS", kind: "Assembly", name: "Wheels and tyres" },
    ...["FL", "FR", "RL", "RR"].map((p) => ({ id: `TIRE_${p}`, kind: "Tire", name: `Tyre ${p}` })),
    { id: "INTERIOR", kind: "Assembly", name: "Interior and occupant package" },
    ...Array.from({ length: seats || 0 }, (_, i) => ({ id: `SEAT_${i + 1}`, kind: "Seat", name: `Seat ${i + 1}` })),
    { id: "ELECTRICAL", kind: "Assembly", name: "Electrical" },
  ];
  const contains = {
    VEH: ["BODY", "CHASSIS", "POWERTRAIN", "DRIVELINE", "SUSPENSION", "BRAKES", "WHEELS", "INTERIOR", "ELECTRICAL"],
    POWERTRAIN: ["ENGINE"],
    WHEELS: ["TIRE_FL", "TIRE_FR", "TIRE_RL", "TIRE_RR"],
    INTERIOR: nodes.filter((n) => n.kind === "Seat").map((n) => n.id),
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
  const arch = ARCHITECTURES.find((a) => a.match.test(brief));
  if (!arch) return { error: "no architecture for this kind of design yet", parsed };
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
