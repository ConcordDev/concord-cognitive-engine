// server/lib/conkay/compiler/soften-ir.js
//
// Preprocess a Design IR so common agent traps compile instead of burning
// 30 trial-and-error runs. Mutations are shallow-cloned; warnings describe
// every auto-fix so callers can surface them.
//
// Traps fixed:
//   • props.mass / unitCost without massSource / unitCostSource
//   • massState.estimated without uncertainty
//   • requirements as a bare string array
//   • aluminum-5052 / aluminum-7075-t6 / abs aliases → registry ids that
//     already carry a price (5052-H32, 7075-T6, ABS), so cost checks compute

import { getMaterial, resolveMaterialName } from "../materials/index.js";

/** Tiny worked IR used in tool descriptions and soft error tips. */
export const CONKAY_IR_MINI_EXAMPLE = Object.freeze({
  design: { id: "demo-plate", name: "Demo plate" },
  nodes: [
    {
      id: "P1",
      kind: "Part",
      name: "plate",
      material: "steel-a36",
      position: { x: "0 m", y: "0 m", z: "0 m" },
      geometry: { shape: "box", x: "200 mm", y: "100 mm", z: "10 mm" },
      props: {
        mass: "1.5 kg",
        massSource: "caller assumption (catalogue TBD)",
      },
    },
  ],
  edges: [],
  loadCases: [],
  requirements: [],
});

export const CONKAY_IR_HINTS = Object.freeze([
  'Quantities are strings with units: "20 mm", "1.5 kg", "40 kN" (bare SI numbers are also accepted).',
  'A stated props.mass needs props.massSource (or massState): e.g. massSource: "caller assumption".',
  'Positions are lengths: position: { x: "0 m", y: "0 m", z: "0 m" } (or bare 0 = 0 m).',
  "Materials must be registry ids (steel-a36, aluminum-6061-t6, aluminum-5052-h32, aluminum-7075-t6, abs-plastic). Common aliases are auto-mapped.",
  "requirements is an array of { id, metric, max|min, ... } objects, not bare strings.",
]);

/**
 * Soften a Design IR in place on a deep-ish clone of nodes/materials.
 * Returns { ir, warnings }.
 */
export function softenDesignIR(input) {
  if (!input || typeof input !== "object") {
    return { ir: input, warnings: [] };
  }
  const warnings = [];
  const ir = {
    ...input,
    nodes: Array.isArray(input.nodes) ? input.nodes.map((n) => softenNode(n, warnings)) : input.nodes,
    materials: input.materials && typeof input.materials === "object"
      ? softenMaterials(input.materials, warnings)
      : input.materials,
    requirements: softenRequirements(input.requirements, warnings),
  };

  // Alias material on nodes after clone
  if (Array.isArray(ir.nodes)) {
    for (const n of ir.nodes) {
      if (n && typeof n.material === "string") {
        const alias = canonicalMaterial(n.material);
        if (alias && alias !== n.material) {
          warnings.push(`nodes(${n.id || "?"}): material "${n.material}" aliased to "${alias}"`);
          n.material = alias;
        }
      }
    }
  }

  return { ir, warnings };
}

/** Registry id for a caller material name. Already-valid ids stay put (7075 is not rewritten to 6061). */
export function canonicalMaterial(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (getMaterial(raw)) return raw;
  const lower = raw.toLowerCase();
  if (getMaterial(lower)) return lower;
  const resolved = resolveMaterialName(lower);
  return resolved?.id || null;
}

function softenMaterials(materials, warnings) {
  const out = {};
  for (const [id, val] of Object.entries(materials)) {
    const alias = canonicalMaterial(id);
    if (alias && alias !== id) {
      warnings.push(`materials.${id}: aliased to ${alias}`);
      out[alias] = val;
    } else {
      out[id] = val;
    }
  }
  return out;
}

function softenRequirements(reqs, warnings) {
  if (reqs == null) return reqs;
  if (!Array.isArray(reqs)) return reqs;
  if (reqs.length === 0) return reqs;
  // Bare strings → skip with warning (cannot invent metric)
  if (reqs.every((r) => typeof r === "string")) {
    warnings.push(
      "requirements: got string list; expected objects like { id, metric, max: \"10 kg\" }. Dropped for compile — add structured requirements."
    );
    return [];
  }
  return reqs;
}

function softenNode(n, warnings) {
  if (!n || typeof n !== "object") return n;
  const node = { ...n, props: { ...(n.props || {}) } };
  const where = `nodes(${node.id || "?"})`;

  // mass without massSource / massState → assume caller assumption
  if (node.props.mass != null && node.props.massState == null) {
    const src = node.props.massSource;
    if (!(typeof src === "string" && src.trim())) {
      node.props.massSource = "caller assumption (auto-filled; replace with datasheet/catalogue when known)";
      warnings.push(`${where}.props.mass: auto-filled massSource (was missing)`);
    }
  }
  // unitCost without unitCostSource
  if (node.props.unitCost != null) {
    const src = node.props.unitCostSource;
    if (!(typeof src === "string" && src.trim())) {
      node.props.unitCostSource = "caller assumption (auto-filled)";
      warnings.push(`${where}.props.unitCost: auto-filled unitCostSource (was missing)`);
    }
  }
  // massState.estimated without uncertainty
  const ms = node.props.massState;
  if (ms && typeof ms === "object" && ms.state === "estimated" && ms.uncertainty == null) {
    const massNum = typeof node.props.mass === "number"
      ? node.props.mass
      : (typeof node.props.mass === "string" ? Number(String(node.props.mass).replace(/[^\d.eE+-]/g, "")) : NaN);
    if (Number.isFinite(massNum) && massNum > 0) {
      node.props.massState = {
        ...ms,
        uncertainty: { lowKg: massNum * 0.8, highKg: massNum * 1.2 },
      };
      warnings.push(`${where}.props.massState: auto-filled ±20% uncertainty for estimated mass`);
    }
  }

  return node;
}

/**
 * Format compile errors with worked-example tips for MCP/chat callers.
 */
export function formatIrErrors(errors, warnings = []) {
  const list = Array.isArray(errors) ? errors.map(String) : [String(errors || "unknown")];
  const tips = [];
  const joined = list.join("\n");
  if (/massSource|stated mass/i.test(joined)) {
    tips.push('Add props.massSource: "caller assumption" (or a datasheet URL) next to props.mass.');
  }
  if (/expected a (length|mass|force)|Quantity|cannot read quantity/i.test(joined)) {
    tips.push('Use unit strings: "0 m", "1.5 kg", "40 kN". Bare SI numbers are also accepted.');
  }
  if (/unknown material/i.test(joined)) {
    tips.push("Use a registry material id (steel-a36, aluminum-6061-t6, aluminum-5052-h32, abs-plastic). Aliases like aluminum-5052 and abs are auto-mapped.");
  }
  if (/requirements/i.test(joined)) {
    tips.push("requirements entries are objects, e.g. { id: \"R1\", metric: \"mass.total\", max: \"80 kg\" }.");
  }
  return {
    errors: list,
    warnings: warnings.map(String),
    hints: tips.length ? tips : [...CONKAY_IR_HINTS.slice(0, 3)],
    example: CONKAY_IR_MINI_EXAMPLE,
  };
}
