// server/lib/conkay/compiler/design-brief.js
//
// A short design brief → Design IR, using the same registry ids and quantity
// strings as conkay_ir_schema. The caller does not have to invent node kinds.
//
// A robot brief becomes Joint + Actuator + Limb nodes and a walk block.
// Anything else is handed to compileBrief (car, L-bracket). Missing numbers
// stay missing: the IR does not invent a foot width or a link mass.

import { compileBrief } from "./architectures.js";
import { CONKAY_IR_HINTS } from "./soften-ir.js";

const ROBOT_RE = /\b(?:robot|biped|humanoid|quadruped|legged|walker)\b/i;

function num(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function firstNum(text, ...res) {
  for (const re of res) {
    const n = num(text, re);
    if (n != null) return n;
  }
  return null;
}

/** Pull the numbers a robot brief actually states. No defaults for sizes. */
export function parseRobotBrief(text) {
  const t = String(text || "");
  const massKg = firstNum(t, /(\d+(?:\.\d+)?)\s*kg\b/i, /\bmass\s+(\d+(?:\.\d+)?)\b/i);
  const linkMassKg = firstNum(t, /\b(?:link|limb|thigh)\s+mass\s+(\d+(?:\.\d+)?)\s*kg\b/i);
  const thighM = firstNum(t, /\bthigh\s+(\d+(?:\.\d+)?)\s*m\b/i);
  const shinM = firstNum(t, /\bshin\s+(\d+(?:\.\d+)?)\s*m\b/i);
  const limbM = firstNum(t, /\b(?:limb|arm)\s+(?:length\s+)?(\d+(?:\.\d+)?)\s*m\b/i);
  const stanceWidthM = firstNum(t, /\bstance(?:\s+width)?\s+(\d+(?:\.\d+)?)\s*m\b/i);
  const footWidthM = firstNum(t, /\bfoot(?:\s+width)?\s+(\d+(?:\.\d+)?)\s*m\b/i);
  const footLengthM = firstNum(t, /\bfoot\s+length\s+(\d+(?:\.\d+)?)\s*m\b/i, /\bfoot\s+\d+(?:\.\d+)?\s*(?:m)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\b/i);
  const ratedTorqueNm = firstNum(t, /(\d+(?:\.\d+)?)\s*n(?:·|\*)?m\b/i, /\btorque\s+(\d+(?:\.\d+)?)\b/i);
  const comHeightM = firstNum(t, /\bcom(?:\s+height)?\s+(\d+(?:\.\d+)?)\s*m\b/i);
  const horizontal = /\bhorizontal\b/i.test(t);
  const vertical = /\bvertical\b/i.test(t) && !horizontal;
  return {
    massKg, linkMassKg, thighM, shinM, limbM, stanceWidthM, footWidthM, footLengthM, ratedTorqueNm, comHeightM,
    angleFromVerticalRad: vertical ? 0 : horizontal ? Math.PI / 2 : null,
    biped: /\b(?:biped|two\s+legs|humanoid|walker)\b/i.test(t) || (thighM != null && shinM != null),
  };
}

function q(n, unit) {
  return `${n} ${unit}`;
}

/**
 * Compile a simplified brief to Design IR.
 * @param {string|{brief?: string, text?: string}} input
 * @returns {{ ok: true, ir: object, architecture: string, warnings: string[], assumptions: string[] }|{ ok: false, error: string, missing?: string[], hints?: string[] }}
 */
export function compileDesignBrief(input) {
  const brief = typeof input === "string" ? input : String(input?.brief || input?.text || "");
  const trimmed = brief.trim();
  if (!trimmed) {
    return { ok: false, error: "brief required", hints: [...CONKAY_IR_HINTS] };
  }
  if (!ROBOT_RE.test(trimmed) && !/\b(?:limb|actuator|thigh|shin)\b/i.test(trimmed)) {
    const other = compileBrief(trimmed);
    if (other.error) return { ok: false, error: other.error, parsed: other.parsed, hints: [...CONKAY_IR_HINTS] };
    return {
      ok: true,
      architecture: other.architecture,
      ir: other.ir,
      warnings: [],
      assumptions: other.assumptions || [],
      unmapped: other.unmapped || [],
    };
  }
  const spec = parseRobotBrief(trimmed);
  const lengthM = spec.thighM || spec.limbM;
  const missing = [];
  if (!(spec.massKg > 0) && !(spec.linkMassKg > 0)) missing.push("mass in kg (robot total, or 'link mass N kg')");
  if (!(lengthM > 0)) missing.push("a limb length ('thigh 0.4 m' or 'limb 0.4 m')");
  if (missing.length) {
    return {
      ok: false,
      error: `robot brief is missing ${missing.join("; ")}`,
      missing,
      hints: [
        'Example: "biped robot 60 kg, thigh 0.4 m, shin 0.4 m, stance 0.2 m, foot 0.08 m, foot length 0.22 m, actuator 48 Nm"',
        "Link mass is not invented. Without 'link mass N kg', limb torque uses the whole stated mass as an upper bound.",
        ...CONKAY_IR_HINTS,
      ],
    };
  }
  const massKg = spec.linkMassKg || spec.massKg;
  const massBasis = spec.linkMassKg ? "stated" : "upper-bound";
  const angle = spec.angleFromVerticalRad == null ? Math.PI / 2 : spec.angleFromVerticalRad;
  const warnings = [];
  const assumptions = [];
  if (!spec.linkMassKg) {
    assumptions.push("No link mass was stated. Limb torque uses the whole robot mass as an upper bound.");
    warnings.push("limb mass is the whole stated robot mass (upper bound), not a weighed link");
  }
  if (spec.angleFromVerticalRad == null) {
    assumptions.push("No pose was stated. Limb angle is horizontal (θ = π/2), the largest static gravity moment.");
    warnings.push("angle defaulted to horizontal (π/2); say 'vertical' or 'horizontal' to override");
  }
  const limbProps = (length) => ({
    length: q(length, "m"),
    massKg: q(massKg, "kg"),
    massBasis,
    comFraction: 0.5,
    angleFromVertical: q(angle, "rad"),
    ...(spec.ratedTorqueNm ? { ratedTorqueNm: q(spec.ratedTorqueNm, "Nm"), source: "design brief" } : {}),
  });
  const nodes = [
    {
      id: "ROBOT",
      kind: "Assembly",
      name: trimmed.slice(0, 80),
      props: {
        massBudget: true,
        ...(spec.massKg ? { walk: {
          massKg: q(spec.massKg, "kg"),
          ...(spec.stanceWidthM ? { stanceWidth: q(spec.stanceWidthM, "m") } : {}),
          ...(spec.footWidthM ? { footWidth: q(spec.footWidthM, "m") } : {}),
          ...(spec.footLengthM ? { footLength: q(spec.footLengthM, "m") } : {}),
          ...(spec.comHeightM ? { comHeight: q(spec.comHeightM, "m") } : {}),
          ...(spec.ratedTorqueNm ? { ratedAnkleTorqueNm: q(spec.ratedTorqueNm, "Nm") } : {}),
        } } : {}),
      },
    },
    {
      id: "BODY",
      kind: "Part",
      name: "body",
      material: "aluminum-6061-t6",
      position: { x: "0 m", y: "0 m", z: q(spec.comHeightM || lengthM, "m") },
      props: {
        mass: q(spec.massKg || massKg, "kg"),
        massSource: "design brief",
      },
    },
  ];
  const edges = [{ type: "CONTAINS", from: "ROBOT", to: "BODY" }];
  const addLimb = (id, name, length) => {
    nodes.push({
      id,
      kind: "Limb",
      name,
      material: "aluminum-6061-t6",
      props: { logical: true, limb: limbProps(length) },
    });
    nodes.push({
      id: `${id}_JOINT`,
      kind: "Joint",
      name: `${name} joint`,
      props: { limb: limbProps(length) },
    });
    nodes.push({
      id: `${id}_ACT`,
      kind: "Actuator",
      name: `${name} actuator`,
      props: {
        logical: true,
        actuator: {
          ratedTorqueNm: spec.ratedTorqueNm || null,
          source: spec.ratedTorqueNm ? "design brief" : "not stated",
        },
        limb: limbProps(length),
      },
    });
    for (const to of [id, `${id}_JOINT`, `${id}_ACT`]) {
      edges.push({ type: "CONTAINS", from: "ROBOT", to });
    }
  };
  addLimb("LIMB_L", spec.biped ? "left thigh" : "limb", lengthM);
  if (spec.shinM) addLimb("SHIN_L", "left shin", spec.shinM);
  if (spec.biped) {
    addLimb("LIMB_R", "right thigh", lengthM);
    if (spec.shinM) addLimb("SHIN_R", "right shin", spec.shinM);
  }
  if (!spec.stanceWidthM || !spec.footWidthM) {
    warnings.push("walk check needs stance width and foot width; they were not in the brief, so robotics.walk-balance will be NOT_COMPUTED");
  }
  return {
    ok: true,
    architecture: spec.biped ? "biped-robot" : "limb",
    ir: {
      design: { id: spec.biped ? "biped" : "limb", name: trimmed.slice(0, 120) },
      nodes,
      edges,
      loadCases: [],
      requirements: [],
      brief: trimmed,
    },
    warnings,
    assumptions,
    spec,
  };
}
