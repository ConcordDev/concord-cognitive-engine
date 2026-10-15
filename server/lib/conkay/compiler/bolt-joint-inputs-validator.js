// server/lib/conkay/compiler/bolt-joint-inputs-validator.js
//
// Validator for the bolt-joint input contract (server/lib/conkay/compiler/
// schemas/bolt-joint-inputs.v1.json). Called by the IR compiler with each
// Joint, Plate, and Bolt node. Reports structured errors that the
// compiler can append to its error list, and the verdict guard can
// surface to the user.
//
// The validator is non-mutating: it only checks, it does not invent
// defaults. Absent fields stay absent. This is the explicit honesty
// contract: the user supplies the geometry, the solver refuses to
// guess.
//
// Validation is ordered: cheap type checks first, then range, then
// inter-field constraints, then applicability (does the field's
// presence make sense for this joint kind?).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const boltJointInputsSchema = JSON.parse(readFileSync(join(__dirname, "schemas", "bolt-joint-inputs.v1.json"), "utf8"));

const SCHEMA_VERSION = "v1";

// Fields the validator knows how to check. Anything not in this map is
// passed through (the compiler's unit conversion still applies if it's
// in TYPED_JOINT_PROPS). The validator's job is the *structural* checks
// beyond unit conversion.
const KNOWN_FIELDS = new Set(Object.keys(boltJointInputsSchema.fields));

// Field-level rules extracted from the schema. Each entry says how to
// validate a single field. The validator composes these into one
// pass over the design IR.
const RULES = {
  // ── Joint props ──────────────────────────────────────────────────────
  "Joint.props.kind": {
    type: "enum",
    values: boltJointInputsSchema.applicability_rules && Object.keys(boltJointInputsSchema.applicability_rules),
  },
  "Joint.props.shearPlanes": { type: "integer", min: 1, max: 2 },
  "Joint.props.threadsExcluded": { type: "boolean" },
  "Joint.props.edgeDistance": { type: "length", positive: true, pairedWith: "Joint.props.holeDiameter" },
  "Joint.props.holeDiameter": { type: "length", positive: true },
  "Joint.props.edgeDistancePerpendicular": { type: "length", positive: true },
  "Joint.props.spacing": { type: "length", positive: true },
  "Joint.props.holeCountLoadDirection": { type: "integer", min: 1 },
  "Joint.props.fayingSurface": { type: "enum", values: ["A", "B", "C"] },
  "Joint.props.holeType": { type: "enum", values: ["standard", "oversized", "short-slotted", "long-slotted", "parallel-to-load", "perpendicular-to-load"] },
  "Joint.props.boltPretension": { type: "force", positive: true },
  "Joint.props.flangeThickness": { type: "length", positive: true },
  "Joint.props.plateGrossWidth": { type: "length", positive: true },
  "Joint.props.shearLagFactor": { type: "number", min: 0, max: 1.0 },
  "Joint.props.environment": { type: "enum", values: boltJointInputsSchema.fields["Joint.props.environment"].values },
  "Joint.props.fatigueCategory": { type: "enum", values: boltJointInputsSchema.fields["Joint.props.fatigueCategory"].values },
  "Joint.props.fatigueCycles": { type: "number", positive: true },
  "Joint.props.fatigueStressRange": { type: "stress", positive: true },
  "Joint.props.boltCoordinates": { type: "array", itemShape: { x: "length", y: "length" } },
  "Joint.props.loadVector": { type: "object", keys: { x: "force", y: "force", z: "force" } },
  "Joint.props.eccentricity": { type: "object", keys: { x: "length", y: "length" } },
  // ── Bolt ─────────────────────────────────────────────────────────────
  "Bolt.props.grade": { type: "enum", values: boltJointInputsSchema.fields["Bolt.props.grade"].values },
  "Bolt.props.qty": { type: "integer", min: 1 },
  "Bolt.geometry.diameter": { type: "length", positive: true },
  "Bolt.geometry.stressArea": { type: "area", positive: true },
  "Bolt.geometry.length": { type: "length", positive: true },
  // ── Plate ────────────────────────────────────────────────────────────
  "Plate.geometry.thickness": { type: "length", positive: true },
  "Plate.geometry.length": { type: "length", positive: true },
  "Plate.geometry.width": { type: "length", positive: true },
  // ── LoadCase ─────────────────────────────────────────────────────────
  "LoadCase.loads[].shear": { type: "force", positive: true },
  "LoadCase.loads[].tension": { type: "force", positive: true },
  "LoadCase.loads[].axial": { type: "force", positive: true },
  "LoadCase.loads[].moment": { type: "moment" },
  "LoadCase.loads[].target": { type: "string" },
};

/**
 * Validate a single field's already-parsed SI value against the rule.
 * Returns null on pass, or a structured error code on fail.
 *
 * The validator does NOT check units — the IR compiler does that with
 * parseQuantity. By the time we get here, the value is a number in SI
 * (or a string for an enum).
 */
function checkRule(rule, value) {
  if (value === undefined || value === null) return null; // absence is not a validator error
  switch (rule.type) {
    case "enum":
      if (!rule.values.includes(value)) {
        return { code: "IRR_OUT_OF_RANGE", message: `value "${value}" is not one of [${rule.values.join(", ")}]` };
      }
      return null;
    case "integer":
      if (!Number.isInteger(value)) return { code: "IRR_TYPE", message: `expected integer, got ${typeof value}` };
      if (rule.min != null && value < rule.min) return { code: "IRR_OUT_OF_RANGE", message: `must be >= ${rule.min}` };
      if (rule.max != null && value > rule.max) return { code: "IRR_OUT_OF_RANGE", message: `must be <= ${rule.max}` };
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return { code: "IRR_TYPE", message: `expected number, got ${typeof value}` };
      if (rule.positive && value <= 0) return { code: "IRR_OUT_OF_RANGE", message: `must be positive` };
      if (rule.min != null && value < rule.min) return { code: "IRR_OUT_OF_RANGE", message: `must be >= ${rule.min}` };
      if (rule.max != null && value > rule.max) return { code: "IRR_OUT_OF_RANGE", message: `must be <= ${rule.max}` };
      return null;
    case "boolean":
      if (typeof value !== "boolean") return { code: "IRR_TYPE", message: `expected boolean, got ${typeof value}` };
      return null;
    case "string":
      if (typeof value !== "string") return { code: "IRR_TYPE", message: `expected string, got ${typeof value}` };
      return null;
    case "length":
    case "force":
    case "stress":
    case "area":
    case "moment":
      // The compiler already did unit conversion; we just check the SI number.
      if (typeof value !== "number" || !Number.isFinite(value)) return { code: "IRR_TYPE", message: `expected SI number, got ${typeof value}` };
      if (rule.positive && value <= 0) return { code: "IRR_OUT_OF_RANGE", message: `must be positive` };
      return null;
    case "array":
      if (!Array.isArray(value)) return { code: "IRR_TYPE", message: `expected array, got ${typeof value}` };
      // Optional: deep-check each element
      if (rule.itemShape) {
        for (let i = 0; i < value.length; i++) {
          for (const [k, dim] of Object.entries(rule.itemShape)) {
            if (value[i]?.[k] != null) {
              const sub = checkRule({ type: dim, positive: true }, value[i][k]);
              if (sub) return { code: sub.code, message: `[${i}].${k}: ${sub.message}` };
            }
          }
        }
      }
      return null;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) return { code: "IRR_TYPE", message: `expected object, got ${typeof value}` };
      if (rule.keys) {
        for (const [k, dim] of Object.entries(rule.keys)) {
          if (value[k] != null) {
            const sub = checkRule({ type: dim }, value[k]);
            if (sub) return { code: sub.code, message: `.${k}: ${sub.message}` };
          }
        }
      }
      return null;
    default:
      return null;
  }
}

/**
 * Validate the bolt-joint-relevant fields of a design IR. Returns
 * an array of structured error objects:
 *   [{ where, field, code, message }, ...]
 * Empty array means valid.
 *
 * This is a *non-mutating* check. The IR compiler still does unit
 * conversion and structural checks. The validator catches: type errors,
 * range errors, and inter-field geometric constraints.
 *
 * The validator does NOT check "required for this joint kind" — that's
 * the verdict guard's job, which reads the existing solver envelopes
 * after the design runs. The validator only checks "this field, if
 * present, is well-formed."
 */
export function validateBoltJointInputs(ir) {
  const errors = [];
  const push = (where, field, code, message) => errors.push({ where, field, code, message });

  for (const n of (ir.nodes || [])) {
    // Compiled graph nodes use { id, kind, props, geometry }. Input IR
    // nodes use { id, kind, props, geometry } too — same shape post-
    // compile, but the validator is structural so this works for both.
    const where = `nodes[${n.id}]`;
    if (n.kind === "Joint") {
      for (const [k, v] of Object.entries(n.props || {})) {
        const rule = RULES[`Joint.props.${k}`];
        if (!rule) continue; // unknown prop — pass through, compiler will accept it as a plain value
        const err = checkRule(rule, v);
        if (err) push(where, `props.${k}`, err.code, err.message);
      }
      // Inter-field: edgeDistance > holeDiameter/2
      if (Number.isFinite(n.props?.edgeDistance) && Number.isFinite(n.props?.holeDiameter) && n.props.edgeDistance <= n.props.holeDiameter / 2) {
        push(where, "props.edgeDistance", "IRR_GEOMETRY", `edgeDistance (${n.props.edgeDistance}) must exceed half of holeDiameter (${n.props.holeDiameter / 2})`);
      }
      // holePattern: array of {x: length, y: length}. The compiler has
      // already converted units and rejected negatives. The schema
      // validator mirrors that: x=0 and y=0 are valid (a hole on the
      // joint's reference axis is normal for a centered bolt group),
      // and the array length is the solver's responsibility to match
      // against Bolt children. Negative coordinates are still rejected.
      if (n.props?.holePattern != null) {
        if (!Array.isArray(n.props.holePattern)) {
          push(where, "props.holePattern", "IRR_TYPE", "holePattern must be an array of {x, y} coordinate pairs");
        } else {
          for (let i = 0; i < n.props.holePattern.length; i++) {
            const entry = n.props.holePattern[i];
            if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
              push(where, `props.holePattern[${i}]`, "IRR_TYPE", "holePattern entry must be an object with x and y lengths");
              continue;
            }
            if (typeof entry.x !== "number" || !Number.isFinite(entry.x) || entry.x < 0) {
              push(where, `props.holePattern[${i}].x`, "IRR_OUT_OF_RANGE", `x must be a non-negative number (got ${entry.x})`);
            }
            if (typeof entry.y !== "number" || !Number.isFinite(entry.y) || entry.y < 0) {
              push(where, `props.holePattern[${i}].y`, "IRR_OUT_OF_RANGE", `y must be a non-negative number (got ${entry.y})`);
            }
          }
        }
      }
    }
    if (n.kind === "Bolt") {
      for (const [k, v] of Object.entries(n.props || {})) {
        const rule = RULES[`Bolt.props.${k}`];
        if (!rule) continue;
        const err = checkRule(rule, v);
        if (err) push(where, `props.${k}`, err.code, err.message);
      }
      for (const [k, v] of Object.entries(n.geometry || {})) {
        const rule = RULES[`Bolt.geometry.${k}`];
        if (!rule) continue;
        const err = checkRule(rule, v);
        if (err) push(where, `geometry.${k}`, err.code, err.message);
      }
    }
    if (n.kind === "Plate") {
      for (const [k, v] of Object.entries(n.geometry || {})) {
        const rule = RULES[`Plate.geometry.${k}`];
        if (!rule) continue;
        const err = checkRule(rule, v);
        if (err) push(where, `geometry.${k}`, err.code, err.message);
      }
    }
  }

  for (const [i, lc] of (ir.loadCases || []).entries()) {
    const where = `loadCases[${i}]`;
    for (const [j, l] of (lc.loads || []).entries()) {
      const loadWhere = `${where}.loads[${j}]`;
      for (const [k, v] of Object.entries(l)) {
        if (k === "target") continue;
        const rule = RULES[`LoadCase.loads[].${k}`];
        if (!rule) continue;
        const err = checkRule(rule, v);
        if (err) push(loadWhere, k, err.code, err.message);
      }
    }
  }

  return errors;
}

export { boltJointInputsSchema, SCHEMA_VERSION, KNOWN_FIELDS };