// server/lib/conkay/knowledge/extensions/disciplines.js
//
// The discipline extensions beyond materials (Q43/A#29). Each carries
// a real JSON Schema in the json-schema-lite dialect, built from the
// field list the spec planned for that discipline, plus cross-field
// rules where a genuine invariant exists. Validation is structural:
// it proves a record is well-formed and self-consistent, not that its
// claims are true (that is the claim/evidence layer's job).

const nullableStr = { type: ["string", "null"] };
const strList = { type: "array", items: { type: "string" } };
const qty = { anyOf: [{ type: "object", required: ["value", "unit"], additionalProperties: false, properties: { value: { type: "number" }, unit: { type: "string" } } }, { type: "null" }] };
const qtyMap = { type: "object", additionalProperties: qty };

export const chemistryExtension = {
  status: "implemented",
  description: "Chemical substances and reactions. Atom/charge balance and the other solvers remain the solver layer's job; this schema validates the record those solvers consume.",
  plannedFields: ["identifiers (CAS, PubChem CID, InChIKey)", "formula", "structure", "purity", "concentration", "phase", "stoichiometry", "products", "conditions", "kinetics", "thermodynamics", "compatibility", "hazards"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      identifiers: {
        anyOf: [{
          type: "object", additionalProperties: false,
          properties: {
            cas: { type: ["string", "null"], pattern: "^\\d{2,7}-\\d{2}-\\d$" },
            pubchemCid: { type: ["integer", "null"], minimum: 1 },
            inchiKey: { type: ["string", "null"], pattern: "^[A-Z]{14}-[A-Z]{10}-[A-Z]$" },
          },
        }, { type: "null" }],
      },
      formula: { type: ["string", "null"], minLength: 1 },
      structure: nullableStr,
      purity: qty,
      concentration: qty,
      phase: { enum: ["solid", "liquid", "gas", "aqueous", "plasma", "supercritical", null] },
      stoichiometry: {
        type: "array",
        items: { type: "object", required: ["species", "coefficient"], additionalProperties: false, properties: { species: { type: "string", minLength: 1 }, coefficient: { type: "number" } } },
      },
      products: strList,
      conditions: { type: ["object", "null"] },
      kinetics: { type: ["object", "null"] },
      thermodynamics: { type: ["object", "null"] },
      compatibility: strList,
      hazards: strList,
    },
  },
  rules(data) {
    const errors = [];
    for (const s of data.stoichiometry || []) {
      if (!(s.coefficient > 0)) errors.push(`$.extensions.chemistry: stoichiometric coefficient for "${s.species}" must be positive`);
    }
    if (data.purity && data.purity.unit === "%" && data.purity.value > 100) {
      errors.push("$.extensions.chemistry: purity cannot exceed 100%");
    }
    return errors;
  },
};

export const fluidsExtension = {
  status: "implemented",
  description: "Fluids, mixtures and fuels; sources NIST Chemistry WebBook, REFPROP.",
  plannedFields: ["composition", "basis", "density", "viscosity", "vapor pressure", "Cp", "thermal conductivity", "phase behavior", "compressibility", "flash point", "T/P dependence"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      composition: {
        type: "array",
        items: { type: "object", required: ["component", "fraction"], additionalProperties: false, properties: { component: { type: "string", minLength: 1 }, fraction: { type: "number", minimum: 0, maximum: 1 } } },
      },
      basis: { enum: ["mass", "mole", "volume", null] },
      density: qty, viscosity: qty, vaporPressure: qty, heatCapacity: qty,
      thermalConductivity: qty, flashPoint: qty, compressibility: qty,
      phaseBehavior: nullableStr,
      tpDependence: nullableStr,
    },
  },
  rules(data) {
    const errors = [];
    if (Array.isArray(data.composition) && data.composition.length) {
      const sum = data.composition.reduce((s, c) => s + c.fraction, 0);
      if (sum > 1.0001) errors.push(`$.extensions.fluids: composition fractions sum to ${sum.toFixed(4)} (> 1)`);
    }
    return errors;
  },
};

export const recipesExtension = {
  status: "implemented",
  description: "Recipes. Scaling is not linear when heat transfer, mixing, evaporation or safety changes; culinary-tested vs lab-tested vs calculated are distinct statuses.",
  plannedFields: ["quantities", "yield", "serving size", "sequence", "time", "temperature", "equipment", "substitutions", "storage", "allergens", "nutrition", "tested_as (culinary|lab|calculated)"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      quantities: {
        type: "array",
        items: { type: "object", required: ["ingredient", "amount"], additionalProperties: false, properties: { ingredient: { type: "string", minLength: 1 }, amount: { type: "object", required: ["value", "unit"], additionalProperties: false, properties: { value: { type: "number" }, unit: { type: "string" } } } } },
      },
      yield: qty,
      servingSize: qty,
      sequence: strList,
      time: qty,
      temperature: qty,
      equipment: strList,
      substitutions: { type: "array", items: { type: "object", required: ["from", "to"], additionalProperties: false, properties: { from: { type: "string" }, to: { type: "string" } } } },
      storage: nullableStr,
      allergens: strList,
      nutrition: { type: ["object", "null"] },
      testedAs: { enum: ["culinary", "lab", "calculated", null] },
    },
  },
  rules(data) {
    const errors = [];
    if (data.yield && !(data.yield.value > 0)) errors.push("$.extensions.recipes: yield must be positive");
    return errors;
  },
};

export const engineeringExtension = {
  status: "implemented",
  description: "Engineered objects (bridges to the #1032 design graph and #1037 component library).",
  plannedFields: ["geometry", "materials", "dimensions", "tolerances", "joints", "mass properties", "loads", "boundary conditions", "operating envelope", "manufacturing", "service life", "standards"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      geometry: nullableStr,
      materials: strList,
      dimensions: qtyMap,
      tolerances: { type: ["object", "null"] },
      joints: strList,
      massProperties: { type: ["object", "null"] },
      loads: { type: "array", items: { type: "object", required: ["name", "magnitude"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, magnitude: qty } } },
      boundaryConditions: strList,
      operatingEnvelope: { type: ["object", "null"] },
      manufacturing: nullableStr,
      serviceLife: qty,
      standards: strList,
    },
  },
};

export const mathExtension = {
  status: "implemented",
  description: "Formulas and algorithms. Every formula executable and tested against known solutions before it drives a decision.",
  plannedFields: ["equations", "variable definitions", "units", "assumptions", "domain of validity", "initial/boundary conditions", "solver requirements", "tolerances", "reference cases", "error bounds"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      equations: strList,
      variables: {
        type: "array",
        items: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, definition: nullableStr, unit: nullableStr } },
      },
      units: nullableStr,
      assumptions: strList,
      domainOfValidity: nullableStr,
      conditions: nullableStr,
      solverRequirements: nullableStr,
      tolerance: { type: ["number", "null"], minimum: 0 },
      referenceCases: { type: "array", items: { type: "object", required: ["description"], additionalProperties: false, properties: { description: { type: "string" } } } },
      errorBounds: nullableStr,
    },
  },
  rules(data) {
    const errors = [];
    const seen = new Set();
    for (const v of data.variables || []) {
      if (seen.has(v.name)) errors.push(`$.extensions.math: variable "${v.name}" is defined twice`);
      seen.add(v.name);
    }
    return errors;
  },
};

export const electronicsExtension = {
  status: "implemented",
  description: "Electronics: components and assemblies with rated electrical limits.",
  plannedFields: ["component type", "specifications", "connections", "ratings (voltage/current/power)"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      componentType: nullableStr,
      specifications: qtyMap,
      connections: strList,
      ratings: {
        anyOf: [{ type: "object", additionalProperties: false, properties: { voltage: qty, current: qty, power: qty } }, { type: "null" }],
      },
    },
  },
};

export const biologyExtension = {
  status: "implemented",
  description: "Biological systems: organisms and their classification.",
  plannedFields: ["organism", "taxonomy", "habitat", "traits", "life cycle"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      organism: nullableStr,
      taxonomy: {
        anyOf: [{
          type: "object", additionalProperties: false,
          properties: { kingdom: nullableStr, phylum: nullableStr, class: nullableStr, order: nullableStr, family: nullableStr, genus: nullableStr, species: nullableStr },
        }, { type: "null" }],
      },
      habitat: nullableStr,
      traits: strList,
      lifeCycle: nullableStr,
    },
  },
};

export const energyExtension = {
  status: "implemented",
  description: "Energy systems: generation, storage, transmission, conversion, consumption.",
  plannedFields: ["system type", "capacity", "efficiency", "fuel/source", "emissions"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      systemType: { enum: ["generation", "storage", "transmission", "conversion", "consumption", null] },
      capacity: qty,
      efficiency: { type: ["number", "null"], minimum: 0, maximum: 1 },
      fuelOrSource: nullableStr,
      emissions: { type: ["object", "null"] },
    },
  },
};

export const agricultureExtension = {
  status: "implemented",
  description: "Agriculture: crops and livestock production records.",
  plannedFields: ["crop/livestock", "soil type", "climate zone", "season", "inputs", "yield per area"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cropOrLivestock: nullableStr,
      soilType: nullableStr,
      climateZone: nullableStr,
      season: nullableStr,
      inputs: strList,
      yieldPerArea: qty,
    },
  },
};

export const geologyExtension = {
  status: "implemented",
  description: "Geology: formations, rocks and minerals.",
  plannedFields: ["formation", "mineral composition", "rock type", "age (Ma)", "location"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      formation: nullableStr,
      mineralComposition: strList,
      rockType: { enum: ["igneous", "sedimentary", "metamorphic", null] },
      ageMa: { type: ["number", "null"], minimum: 0 },
      location: nullableStr,
    },
  },
};

export const softwareExtension = {
  status: "implemented",
  description: "Software: programs, libraries and services.",
  plannedFields: ["language", "runtime", "interfaces", "dependencies", "license"],
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      language: nullableStr,
      runtime: nullableStr,
      interfaces: strList,
      dependencies: strList,
      license: nullableStr,
    },
  },
};

export const disciplineExtensions = {
  chemistry: chemistryExtension,
  fluids: fluidsExtension,
  recipes: recipesExtension,
  engineering: engineeringExtension,
  math: mathExtension,
  electronics: electronicsExtension,
  biology: biologyExtension,
  energy: energyExtension,
  agriculture: agricultureExtension,
  geology: geologyExtension,
  software: softwareExtension,
};
