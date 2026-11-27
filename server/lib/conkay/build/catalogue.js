// server/lib/conkay/build/catalogue.js
//
// What Kay can check, family by family, written for the model that plans a
// build. Each family is: when it applies, the exact props shape its solver
// reads, and a worked example node that compiles and runs (pinned by
// tests/conkay-build-anything.test.js). The planner shows the model the families the
// brief touches plus the always-on basics, so it composes a design graph from
// real solver inputs instead of reaching for a fixed beam or bracket.
//
// Quantities may be unit strings in any unit ("3/4 in", "2 fl oz", "70 °F").
// Constants (strength, density, resistivity, conductivity…) come from the
// material library or carry a source; a missing one is a lookup or a question.

export const FAMILIES = Object.freeze([
  {
    id: "parts",
    always: true,
    title: "Parts: geometry, material, mass and cost",
    when: "every physical thing; each part is a node with a shape and a material",
    guide: [
      'Each physical part is { id, kind: "Part", name, material, geometry, position? }. Group parts under an { kind: "Assembly" } node with CONTAINS edges { from: assemblyId, to: partId, type: "CONTAINS" } so the assembly mass adds up.',
      "Shapes and their keys: box { length, width, height }, plate { length, width, thickness }, rod | cylinder | bolt { diameter, length }, round-tube { length, outerDiameter, wall }, rect-tube { length, width, height, wall }, i-beam { length, height, flangeWidth, flangeThickness, webThickness }.",
      "Real shapes beyond blocks: extrude { length, profile: [[a, b], ...] (a closed outline, any units), holes?: [[[a, b], ...] | { circle: { at: [a, b], diameter } }], fillet? } pushed along props.axis (default x) — brackets, rails, custom extrusions, plates with holes; an extruded part can be a frame member (its exact section properties are used). revolve { outline: [[r, z], ...] from the axis outward then up, wall } — a cup, bowl, bottle, lamp shade, pot (it reports what it holds); or revolve { profile: [[r, z], ...] closed } — a knob, a wheel, a bushing. loft { sections: [{ at, shape: \"naca\", chord, naca: \"2412\", twist? } | { at, shape: \"rect\" | \"ellipse\", width, height }], skin? } along props.axis — a wing, a blade, a hull, a fuselage.",
      "position { x, y, z } is the part's centre; z is up. A box or plate runs its length along x, its width along y and its height (thickness) along z. A rod, cylinder or tube runs along props.axis: \"x\", \"y\" or \"z\" (z for a vertical post).",
      "Library materials: steel-a36, steel-a992, steel-4140, stainless-304, aluminum-6061-t6, aluminum-5052-h32, aluminum-7075-t6, titanium-ti6al4v, copper-c11000, cast-iron-gray-30, douglas-fir, concrete-30mpa, abs-plastic, pla-plastic, polycarbonate, cfrp, gfrp-quasi-iso, rubber-natural, glass-soda-lime, foam-eps-30.",
      'Anything else is your own material under materials: { "<id>": { label, density: { value, source }, youngsModulus: { value, source }, poisson: { value, source }, yield: { value, source }, costPerKg?: { value, source } } } (a frame needs density, youngsModulus, poisson and yield) — every value with the book, table or datasheet it came from. Never a value without a source.',
    ],
    example: {
      materials: { "red-oak": { label: "Red oak", density: { value: "45 lb/ft^3", source: "USDA Wood Handbook FPL-GTR-282, Table 5-3a" } } },
      nodes: [
        { id: "SHELF", kind: "Assembly", name: "shelf" },
        { id: "BOARD", kind: "Part", name: "board", material: "red-oak", geometry: { shape: "box", length: "3 ft", width: "10 in", height: "3/4 in" } },
      ],
      edges: [{ from: "SHELF", to: "BOARD", type: "CONTAINS" }],
    },
  },
  {
    id: "frame",
    keywords: /\b(?:shelf|shelves|shelving|bracket|stand|frame|truss|rack|table|desk|bench|chair|stool|beam|joist|rafter|post|column|leg|arm|cantilever|span|hold|holds|carry|carries|support|supports|load|weight|kg|lb|lbs|pounds?|kn|n\b|bridge|ladder|deck|pergola|gantry|mount|hanger|hook|crane|cart|trolley)\b/i,
    title: "Load-bearing frames (beams, brackets, shelves, stands, trusses, tables)",
    when: "anything that holds weight or force: check stress in every member and stability",
    guide: [
      "Put props.frameModel on the Assembly. nodes: [{ id, x, y, z }] (lengths). members: [{ id, i, j, part }] where part is a Part node id — its section comes from that part's geometry (box → rectangle width × height, plate → width × thickness, rod/cylinder → solid round, round-tube, rect-tube, i-beam) and its material from the part.",
      'supports: [{ node, fix: "fixed" | "pinned" | ["x","y","z","rx","ry","rz"] }]. A simply supported span holds ["x","y","z","rx"] at one end and ["y","z"] at the other (rx stops it spinning about its own axis).',
      "loadCases: [{ id, nodal: [{ node, F: [Fx, Fy, Fz] }], udl: [{ member, w: [wx, wy, wz] }] }]. z is up, so a weight is F: [0, 0, \"-490 N\"] and a spread load is w: [0, 0, \"-200 N/m\"]. A mass the person states (\"holds 50 kg\") becomes its weight, mass × 9.81 m/s².",
      'factorOfSafety: { value: 2, basis: "the person" } when they give one; otherwise state the factor you use and why in assumptions.',
      "Add buckling: { cases: [\"<case id>\"], requiredFactor: { value: 3, basis: \"…\" } } for slender members in compression (legs, posts, struts).",
    ],
    example: {
      nodes: [
        { id: "SHELF", kind: "Assembly", name: "wall shelf", props: { frameModel: {
          nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: "0.9 m", y: 0, z: 0 }],
          members: [{ id: "M1", i: "A", j: "B", part: "BOARD" }],
          supports: [{ node: "A", fix: ["x", "y", "z", "rx"] }, { node: "B", fix: ["y", "z"] }],
          loadCases: [{ id: "books", udl: [{ member: "M1", w: [0, 0, "-545 N/m"] }] }],
          factorOfSafety: { value: 2, basis: "the person" },
        } } },
        { id: "BOARD", kind: "Part", name: "board", material: "steel-a36", geometry: { shape: "plate", length: "0.9 m", width: "250 mm", thickness: "5 mm" } },
      ],
      edges: [{ from: "SHELF", to: "BOARD", type: "CONTAINS" }],
    },
  },
  {
    id: "vessel",
    keywords: /\b(?:cup|mug|bowl|glass|tumbler|bottle|jar|vase|pot|planter|bucket|pitcher|jug|kettle|carafe|flask|container|lamp\s*shade|shade|funnel|cone|bell)\b/i,
    title: "Turned shapes and vessels (cups, bowls, bottles, shades, planters)",
    when: "anything round that holds something or is turned on a lathe: real profile, mass, and what it holds",
    guide: [
      "A vessel is a revolve with an outline from the axis outward then up and a wall: { shape: \"revolve\", outline: [[0, 0], [\"40 mm\", 0], [\"42 mm\", \"95 mm\"]], wall: \"3 mm\" }. Its position is the centre of its base; z is up.",
      "What it should hold goes on props.capacity: { min: \"12 fl oz\", source: \"the person\" } — geometry.capacity checks it against the volume to the rim.",
      "A handle is its own part (an extrude of its outline, or a box) placed beside the body.",
    ],
    example: {
      materials: { stoneware: { label: "Stoneware", density: { value: "2.3 g/cm3", source: "CRC Handbook of Chemistry and Physics, ceramics table" } } },
      nodes: [
        { id: "MUG", kind: "Assembly", name: "mug" },
        { id: "BODY", kind: "Part", name: "mug body", material: "stoneware", position: { x: 0, y: 0, z: 0 },
          geometry: { shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["42 mm", "95 mm"]], wall: "4 mm" },
          props: { capacity: { min: "12 fl oz", source: "the person" } } },
      ],
      edges: [{ from: "MUG", to: "BODY", type: "CONTAINS" }],
    },
  },
  {
    id: "pressure",
    keywords: /\b(?:tank|vessel|cylinder|bottle|boiler|pressure|pressuri[sz]ed|psi|bar|air\s+tank|co2|propane|hydrogen|keg|canister|pipe\s+wall)\b/i,
    title: "Pressure vessels (tanks, bottles, pressurised cylinders)",
    when: "a closed container holding gas or liquid under pressure: hoop stress and burst margin",
    guide: [
      "props.pressureVessel on the shell part: { innerRadius, wallThickness, length, workingPressure, wallStrength?: { lo, hi, source } }. Wall strength comes from the part's material when it is a library material; otherwise give it with its source.",
    ],
    example: {
      nodes: [{ id: "TANK", kind: "Part", name: "air tank shell", material: "steel-a36", geometry: { shape: "round-tube", length: "500 mm", outerDiameter: "200 mm", wall: "3 mm" },
        props: { pressureVessel: { innerRadius: "97 mm", wallThickness: "3 mm", length: "500 mm", workingPressure: "150 psi" } } }],
    },
  },
  {
    id: "flow",
    keywords: /\b(?:pipe|piping|plumbing|hose|tube|duct|pump|flow|gpm|l\/min|litres?\s+per|water|coolant|irrigation|sprinkler|drain|fountain|aquarium|hydroponic|siphon|faucet|valve)\b/i,
    title: "Fluid flow (pipes, hoses, pumps, plumbing)",
    when: "liquid moving through pipes: flow rates, velocities, pressure losses, a pump's operating point",
    guide: [
      "props.pipeNetwork: { fluid: { density, viscosity, source }, nodes: [{ id, head? (fixed level, a length), demand? (flow out) }], links: [{ id, from, to, type: \"pipe\", diameter, length, roughness?, K?: [{ name, K }] } | { id, from, to, type: \"pump\", points: [{ flow, pressureRise }] (from the pump's datasheet) }], maxVelocity?: { value, source }, minFlow?: [{ link, value, source }] }.",
      "At least one node has a fixed head (a tank level or an outlet at 0 m). Fluid properties and fitting K values need a source (a textbook table).",
    ],
    example: {
      nodes: [{ id: "LOOP", kind: "Part", name: "garden line", props: { pipeNetwork: {
        fluid: { density: "998 kg/m3", viscosity: "1 cP", source: "water at 20 °C, OpenStax University Physics 1, Table 14.1 / 14.4" },
        nodes: [{ id: "TANK", head: "2 m" }, { id: "OUT", head: "0 m" }],
        links: [{ id: "HOSE", from: "TANK", to: "OUT", type: "pipe", diameter: "3/4 in", length: "20 ft", roughness: "0.0015 mm" }],
        minFlow: [{ link: "HOSE", value: "5 gpm", source: "the person" }],
      } } }],
    },
  },
  {
    id: "heat",
    keywords: /\b(?:heat|hot|warm|cold|insulat\w*|temperature|°[cf]|degrees|thermal|oven|kiln|freezer|fridge|cooler|wall|enclosure|box|cooking|sous|brew|smoker|burn|cool|cooling|heater)\b/i,
    title: "Heat through a wall or rod (insulation, heaters, enclosures)",
    when: "heat conducting through a layer or a rod: temperatures and heat flow",
    guide: [
      "props.conduction: { length (the thickness heat crosses), conductivity: { value, source } (or the part's material), area?, left: BC, right: BC, generation?, maxTemperature?: { value, source } }.",
      'BC: { type: "T", T } fixed temperature, { type: "q", q } heat flux, { type: "conv", h, Tinf } air or water on that face, { type: "adiabatic" }. Typical h values need a source.',
    ],
    example: {
      nodes: [{ id: "WALL", kind: "Part", name: "cooler wall", props: { conduction: {
        length: "2 in", conductivity: { value: "0.033 W/(m·K)", source: "polystyrene foam, OpenStax University Physics 2, Table 1.5" },
        left: { type: "T", T: "35 °F" }, right: { type: "conv", h: "10 W/m²K", Tinf: "90 °F" },
      } } }],
    },
  },
  {
    id: "electrical",
    keywords: /\d\s*(?:v|a|w|mah|ah|wh)\b|\b(?:battery|batteries|volt|volts|amp|amps|watt|watts|wire|wiring|led|leds|motor|charger|solar|circuit|power|usb|arduino|raspberry|light|lamp|fan|runtime|run\s+time)\b/i,
    title: "DC power (batteries, wiring, loads, runtime)",
    when: "a battery or supply feeding loads: current, wire voltage drop, runtime",
    guide: [
      "props.dcBudget: { supply: { voltage, maxCurrent?, capacity? (Ah or Wh) }, loads: [{ name, power | current, duty? (0..1) }], wire?: { length (one way), crossSection | awg, resistivity: { value, source } }, maxVoltageDrop?: { value, source }, minRuntime?: { value, source } }.",
      "Loads come from labels or datasheets; the wire's resistivity from a textbook table (copper 1.68e-8 Ω·m is OpenStax University Physics 2, Table 9.1).",
    ],
    example: {
      nodes: [{ id: "PACK", kind: "Part", name: "lamp power", props: { dcBudget: {
        supply: { voltage: "12 V", capacity: "7 Ah" }, loads: [{ name: "LED strip", power: "24 W" }],
        wire: { length: "2 m", awg: 18, resistivity: { value: "1.68e-8 Ω·m", source: "copper, OpenStax University Physics 2, Table 9.1" } },
        maxVoltageDrop: { value: "3 %", source: "common low-voltage practice" }, minRuntime: { value: "3 h", source: "the person" },
      } } }],
    },
  },
  {
    id: "mixture",
    keywords: /\b(?:mix|mixture|solution|recipe|brine|cleaner|soap|fertili[sz]er|dilut\w*|concentration|molar|ppm|oz|ounces?|cups?|tbsp|tsp|gallons?|litres?|liters?|ml|grams?|salt|sugar|bleach|vinegar|alcohol|resin|epoxy|glaze|nutrient|chemical|chemicals|acid|base|ph)\b/i,
    title: "Mixtures and solutions (recipes, cleaners, fertiliser, resin)",
    when: "combining ingredients: mass fractions, concentrations, molarity, total volume",
    guide: [
      "props.solution: { components: [{ name, mass | volume | amount (mol), density?: { value, source }, molarMass?: { value, source } }], targets?: [{ component, metric: \"mass_fraction\" | \"molarity\" | \"mass_concentration\", min?, max?, source }] }.",
      "Volumes need a density to become masses; moles need a molar mass. A safety limit (a dilution on a label, an exposure limit) is a target with its source.",
    ],
    example: {
      nodes: [{ id: "BRINE", kind: "Part", name: "pickling brine", props: { solution: {
        components: [
          { name: "salt", mass: "1 oz", molarMass: { value: "58.44 g/mol", source: "NaCl, OpenStax Chemistry 2e, Appendix" } },
          { name: "water", volume: "1 cup", density: { value: "998 kg/m3", source: "water at 20 °C, OpenStax University Physics 1, Table 14.1" } },
        ],
      } } }],
    },
  },
  {
    id: "combustion",
    keywords: /\b(?:combust\w*|flame|burn\w*|fuel|ignit\w*|propane|methane|natural\s+gas|hydrogen|engine|burner|stove|torch|rocket|equilibrium|adiabatic\s+flame)\b/i,
    title: "Combustion and gas chemistry (needs the Cantera kernel)",
    when: "flames, burners, fuels: equilibrium temperature and products, ignition delay, flame speed",
    guide: [
      'props.chemistry: { op: "equilibrium" | "ignition" | "flameSpeed", mechanism: "gri30.yaml" (natural gas, methane, propane-light) | "h2o2.yaml" (hydrogen), fuel: "CH4:1", oxidizer: "O2:1, N2:3.76", phi, T0, P0 }. Runs only where Cantera is installed; otherwise it is reported as not computed.',
    ],
    example: {
      nodes: [{ id: "BURNER", kind: "Part", name: "burner flame", props: { chemistry: { op: "equilibrium", mechanism: "gri30.yaml", fuel: "CH4:1", oxidizer: "O2:1, N2:3.76", phi: 1, T0: "300 K", P0: "1 atm" } } }],
    },
  },
]);

/** The families a brief touches, basics first. Text is the brief plus any answers. */
export function selectFamilies(text) {
  const t = String(text || "");
  const picked = FAMILIES.filter((f) => f.always || f.keywords?.test(t));
  // A physical thing that holds nothing and moves nothing still gets a frame
  // check when it is a structure word; if nothing but parts matched, offer the
  // frame family too so a load stated later has somewhere to go.
  if (picked.length === 1) picked.push(FAMILIES.find((f) => f.id === "frame"));
  return picked;
}

/** The catalogue text the planner shows the model. */
export function catalogueText(families) {
  return families.map((f) => [
    `## ${f.title}`,
    `Use when: ${f.when}.`,
    ...f.guide.map((g) => `- ${g}`),
    `Example: ${JSON.stringify(f.example)}`,
  ].join("\n")).join("\n\n");
}
