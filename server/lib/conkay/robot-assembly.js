// server/lib/conkay/robot-assembly.js
//
// Concept assembly for a robot ask ("a small two-arm robot: wheeled base,
// torso, two arms, a head with a camera"). Places sized primitives for each
// named subsystem and merges them into one triangle mesh the ConKay chat
// shows in 3D, plus the parts list with sizes and positions. It is a layout
// concept, not a solved design: no structural or motor sizing is claimed.

export const ROBOT_RE = /\b(?:robot|robotic|droid|android|humanoid|rover|mech)s?\b/i;

const WORD_N = { one: 1, single: 1, two: 2, dual: 2, twin: 2, three: 3, four: 4, six: 6 };
const countOf = (text, nounRe, dflt) => {
  const m = new RegExp(String.raw`\b(\d+|one|single|two|dual|twin|three|four|six)[\s-]+(?:\w+[\s-]+)?${nounRe}`, "i").exec(text);
  if (!m) return dflt;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_N[m[1].toLowerCase()];
  return Math.max(0, Math.min(8, n || dflt));
};

const HUMANOID_RE = /\b(?:humanoids?|bipeds?|androids?|iron[\s-]*man|powered[\s-]*armou?r|exosuits?|exoskeletons?|two[\s-]+legs?|walking)\b|\blegs?\b/i;

/** Which subsystems the ask names, with defaults for a small mobile manipulator.
 *  A brief that is clearly a person-shaped machine (humanoid, biped, iron man)
 *  stands on legs. Explicit wheels or tracks still win. */
export function parseRobotAsk(text) {
  const t = String(text || "").toLowerCase();
  const tracked = /\btracks?\b|\btracked\b|\btreads?\b/.test(t);
  const wheeled = /\bwheels?\b|\bwheeled\b/.test(t);
  const legs = HUMANOID_RE.test(t) && !tracked && !wheeled;
  const scale = /\b(?:tiny|desk|desktop|toy)\b/.test(t) ? 0.5 : /\b(?:large|big|full[- ]size|human[- ]size)\b/.test(t) ? 2 : 1;
  return {
    scale,
    base: legs ? "legs" : tracked ? "tracks" : "wheels",
    // Default 4 wheels (2 per side); "3 wheels per side" means 6.
    wheels: legs || tracked ? 0 : countOf(t, "wheels?", 4) * (/\bwheels?\s+(?:per|on each|each)\s+side\b/.test(t) ? 2 : 1),
    arms: countOf(t, "arms?", /\barms?\b/.test(t) ? 2 : (legs ? 2 : 0)),
    head: /\bhead\b/.test(t) || /\bcamera\b/.test(t) || !/\bno head\b/.test(t),
    camera: /\bcamera|vision|eyes?\b/.test(t),
    gripper: !/\bno (?:gripper|hands?)\b/.test(t),
    scope: robotPartScope(t) || "full",
  };
}

const PART_WORD = "torso|chest|thorax|abdomen|arms?|heads?|legs?|hands?|grippers?";

function canonPart(word) {
  const s = String(word || "").toLowerCase();
  if (/^(?:torso|chest|thorax|abdomen)s?$/.test(s)) return "torso";
  if (/^arms?$/.test(s)) return "arm";
  if (/^heads?$/.test(s)) return "head";
  if (/^legs?$/.test(s)) return "leg";
  if (/^(?:hands?|grippers?)$/.test(s)) return "hand";
  return null;
}

function namedParts(text) {
  const found = [];
  const checks = [
    ["torso", /\btorsos?\b|\bchests?\b|\bthoraxes?\b|\babdomens?\b/i],
    ["arm", /\barms?\b/i],
    ["head", /\bheads?\b/i],
    ["leg", /\blegs?\b/i],
    ["hand", /\bhands?\b|\bgrippers?\b/i],
  ];
  for (const [name, re] of checks) if (re.test(text)) found.push(name);
  return found;
}

/**
 * The sub-assembly the user asked for, or null for a whole robot.
 * "robot torso" / "just the arm" / "a single part" (when one region is named)
 * is that part. A list of regions ("torso, arms, and a head") stays a whole robot.
 */
export function robotPartScope(text) {
  const t = String(text || "");
  if (!t.trim()) return null;
  const only = new RegExp(`\\b(?:just|only|solely|nothing but)\\s+(?:the\\s+|a\\s+|an\\s+)?(${PART_WORD})\\b`, "i").exec(t)
    || new RegExp(`\\b(${PART_WORD})\\s+only\\b`, "i").exec(t);
  if (only) {
    const c = canonPart(only[1]);
    if (c) return c;
  }
  if (/\bsingle\s+part\b/i.test(t)) {
    const named = namedParts(t);
    if (named.length === 1) return named[0];
  }
  // The part is the object ("robot torso", "arm of a robot"), not a modifier
  // ("two-arm robot") and not one item in a list of regions.
  const asObject = /\brobot(?:ic)?s?\s+(torsos?|chests?|thoraxes?|abdomens?|arms?|heads?|legs?|hands?|grippers?)\b/i.exec(t)
    || /\b(torsos?|chests?|thoraxes?|abdomens?|arms?|heads?|legs?|hands?|grippers?)\s+of\s+(?:a\s+|an\s+|the\s+)?(?:[\w-]+\s+){0,8}robots?\b/i.exec(t);
  if (!asObject) return null;
  const one = canonPart(asObject[1]);
  if (!one) return null;
  const named = namedParts(t);
  if (named.length > 1) return null;
  return one;
}

function normalizeScope(scope) {
  const s = String(scope || "").toLowerCase().trim();
  if (!s) return null;
  if (s === "full" || s === "robot" || s === "whole") return "full";
  if (s === "part" || s === "single" || s === "single part") return "part";
  return canonPart(s);
}

function resolveScope(explicit, parsed) {
  const fromOpt = normalizeScope(explicit);
  if (fromOpt === "full") return "full";
  if (fromOpt && fromOpt !== "part") return fromOpt;
  if (fromOpt === "part" && parsed && parsed !== "full") return parsed;
  return parsed || "full";
}

/** conkay_design params: the user's words, plus scope when they named one part. */
export function designTextParams(text, limit = 4000) {
  const t = String(text || "").slice(0, limit);
  const scope = robotPartScope(t);
  return scope ? { text: t, scope } : { text: t };
}

function scopeCount(text, noun) {
  const m = new RegExp(String.raw`\b(\d+|one|single|two|dual|twin|three|four|six)[\s-]+(?:\w+[\s-]+)?${noun}s?\b`, "i").exec(text);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_N[m[1].toLowerCase()];
    return Math.max(1, Math.min(2, n || 1));
  }
  if (new RegExp(String.raw`\b${noun}s\b`, "i").test(text)) return 2;
  return 1;
}

export function meshBuilder() {
  const positions = [], indices = [];
  const slices = [];
  let vertCursor = 0;
  let idxCursor = 0;
  // Claims the triangles `make` just drew. An empty maker claims triangles
  // drawn since the previous claim (phone-stand / truss segments that call
  // box() and then add() with an empty maker).
  const run = (meta, make) => {
    const beforeV = positions.length / 3;
    const beforeI = indices.length;
    if (typeof make === "function") make();
    const afterV = positions.length / 3;
    const afterI = indices.length;
    const drew = afterI > beforeI;
    slices.push({
      name: meta?.name ?? null,
      shape: meta?.shape ?? null,
      v0: drew ? beforeV : vertCursor,
      v1: afterV,
      i0: drew ? beforeI : idxCursor,
      i1: afterI,
    });
    vertCursor = afterV;
    idxCursor = afterI;
  };
  const quad = (a, b, c, d) => {
    const i = positions.length / 3;
    for (const v of [a, b, c, d]) positions.push(v[0], v[1], v[2]);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const box = ([cx, cy, cz], [sx, sy, sz]) => {
    const [x0, x1, y0, y1, z0, z1] = [cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2];
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    quad(v[3], v[2], v[1], v[0]); quad(v[4], v[5], v[6], v[7]); quad(v[0], v[4], v[7], v[3]);
    quad(v[2], v[6], v[5], v[1]); quad(v[7], v[6], v[2], v[3]); quad(v[0], v[1], v[5], v[4]);
  };
  // Capped cylinder along axis "x" | "y" | "z".
  const cyl = ([cx, cy, cz], r, len, axis = "y", seg = 20) => {
    const at = (a, h) => {
      const u = Math.cos(a) * r, w = Math.sin(a) * r;
      if (axis === "x") return [cx + h, cy + u, cz + w];
      if (axis === "z") return [cx + u, cy + w, cz + h];
      return [cx + u, cy + h, cz + w];
    };
    const h = len / 2;
    const c0 = axis === "x" ? [cx - h, cy, cz] : axis === "z" ? [cx, cy, cz - h] : [cx, cy - h, cz];
    const c1 = axis === "x" ? [cx + h, cy, cz] : axis === "z" ? [cx, cy, cz + h] : [cx, cy + h, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      quad(at(a0, -h), at(a1, -h), at(a1, h), at(a0, h));
      quad(c0, c0, at(a1, -h), at(a0, -h));
      quad(c1, c1, at(a0, h), at(a1, h));
    }
  };
  return { positions, indices, box, cyl, slices, run };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function finishAssembly(spec, parts, m, notes) {
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]); ys.push(m.positions[i + 1]); zs.push(m.positions[i + 2]); }
  const span = (a) => (a.length ? Math.round((Math.max(...a) - Math.min(...a)) * 1000) : 0);
  return {
    ok: true,
    spec,
    parts,
    bbox_mm: { length: span(xs), height: span(ys), width: span(zs) },
    mesh: { kind: "robot-assembly", positions: m.positions.map(r3), indices: m.indices, vertexCount: m.positions.length / 3, triangleCount: m.indices.length / 3, parts: m.slices },
    notes,
  };
}

function partAdder(m) {
  const parts = [];
  const add = (name, shape, center, size, make) => {
    m.run({ name, shape }, make);
    parts.push({ name, shape, center_mm: center.map((v) => Math.round(v * 1000)), size_mm: size.map((v) => Math.round(v * 1000)) });
  };
  return { parts, add };
}

/** One named sub-assembly. A torso ask does not grow legs, arms, or a head. */
function buildScopedAssembly(spec, text) {
  const s = spec.scale;
  const m = meshBuilder();
  const { parts, add } = partAdder(m);
  const scope = spec.scope;
  if (scope === "torso") {
    const waistH = 0.08 * s, waistL = 0.16 * s, waistW = 0.24 * s;
    const chestH = 0.36 * s, chestL = 0.22 * s, chestW = 0.34 * s;
    const waistC = [0, waistH / 2, 0];
    add("torso waist", "box", waistC, [waistL, waistH, waistW], () => m.box(waistC, [waistL, waistH, waistW]));
    const chestC = [0, waistH + chestH / 2, 0];
    add("torso chest", "box", chestC, [chestL, chestH, chestW], () => m.box(chestC, [chestL, chestH, chestW]));
    const plate = [chestL / 2 + 0.008 * s, chestC[1], 0];
    add("chest plate", "box", plate, [0.016 * s, chestH * 0.7, chestW * 0.7], () => m.box(plate, [0.016 * s, chestH * 0.7, chestW * 0.7]));
  } else if (scope === "arm") {
    const n = scopeCount(text, "arm");
    for (let a = 0; a < n; a++) {
      const side = n === 1 ? 0 : (a % 2 === 0 ? 1 : -1);
      const z = side * 0.18 * s;
      const label = n === 1 ? "" : (side > 0 ? " left" : " right");
      const shoulder = [0, 0.46 * s, z];
      add(`arm${label} shoulder`.replace("  ", " "), "cylinder", shoulder, [0.06 * s, 0.06 * s, 0.05 * s], () => m.cyl(shoulder, 0.03 * s, 0.05 * s, "z"));
      const upper = [0, 0.32 * s, z];
      add(`arm${label} upper`.trim(), "box", upper, [0.05 * s, 0.18 * s, 0.05 * s], () => m.box(upper, [0.05 * s, 0.18 * s, 0.05 * s]));
      const fore = [0.08 * s, 0.2 * s, z];
      add(`arm${label} forearm`.trim(), "box", fore, [0.16 * s, 0.045 * s, 0.045 * s], () => m.box(fore, [0.16 * s, 0.045 * s, 0.045 * s]));
      for (const f of [1, -1]) {
        const g = [0.18 * s, 0.2 * s, z + f * 0.015 * s];
        add(`arm${label} gripper finger`.trim(), "box", g, [0.05 * s, 0.02 * s, 0.01 * s], () => m.box(g, [0.05 * s, 0.02 * s, 0.01 * s]));
      }
    }
  } else if (scope === "head") {
    const neck = [0, 0.02 * s, 0];
    add("neck", "cylinder", neck, [0.04 * s, 0.04 * s, 0.04 * s], () => m.cyl(neck, 0.02 * s, 0.04 * s, "y"));
    const head = [0, 0.04 * s + 0.06 * s, 0];
    add("head", "box", head, [0.12 * s, 0.12 * s, 0.14 * s], () => m.box(head, [0.12 * s, 0.12 * s, 0.14 * s]));
    if (spec.camera || /\bcamera|vision|eyes?\b/i.test(text)) {
      const cam = [0.06 * s + 0.02 * s, head[1] + 0.01 * s, 0];
      add("camera", "cylinder", cam, [0.04 * s, 0.035 * s, 0.035 * s], () => m.cyl(cam, 0.0175 * s, 0.04 * s, "x"));
    }
  } else if (scope === "leg") {
    const n = scopeCount(text, "leg");
    const h = 0.42 * s;
    for (let i = 0; i < n; i++) {
      const side = n === 1 ? 0 : (i % 2 === 0 ? 1 : -1);
      const c = [0, h / 2, side * 0.08 * s];
      const name = n === 1 ? "leg" : `leg ${side > 0 ? "left" : "right"}`;
      add(name, "box", c, [0.08 * s, h, 0.08 * s], () => m.box(c, [0.08 * s, h, 0.08 * s]));
    }
  } else if (scope === "hand") {
    const n = scopeCount(text, "hand");
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? 0 : (i % 2 === 0 ? 0.06 * s : -0.06 * s);
      const label = n === 1 ? "hand" : `hand ${i % 2 === 0 ? "left" : "right"}`;
      const palm = [0, 0.02 * s, z];
      add(`${label} palm`, "box", palm, [0.08 * s, 0.04 * s, 0.06 * s], () => m.box(palm, [0.08 * s, 0.04 * s, 0.06 * s]));
      for (const f of [-1, 0, 1]) {
        const finger = [0.05 * s, 0.025 * s, z + f * 0.018 * s];
        add(`${label} finger`, "box", finger, [0.05 * s, 0.012 * s, 0.01 * s], () => m.box(finger, [0.05 * s, 0.012 * s, 0.01 * s]));
      }
    }
  }
  const label = scope === "torso" ? "torso" : scope;
  return finishAssembly(spec, parts, m, `Concept layout of the ${label} only (y up, x forward). Not a solved design: no structural, motor or battery sizing was run.`);
}

/** @returns {{ ok: true, spec, parts, mesh, bbox, notes }} */
export function buildRobotAssembly(text, opts = {}) {
  const spec = parseRobotAsk(text);
  spec.scope = resolveScope(opts.scope, spec.scope);
  if (spec.scope !== "full") return buildScopedAssembly(spec, text);
  const s = spec.scale;
  const m = meshBuilder();
  const { parts, add } = partAdder(m);
  // Units: metres. y up, x forward, z left.
  const base = { L: 0.40 * s, W: 0.30 * s, H: 0.10 * s };
  const wheelR = 0.065 * s, wheelT = 0.04 * s;
  const groundToBase = spec.base === "legs" ? 0.30 * s : wheelR;
  const baseC = [0, groundToBase + base.H / 2, 0];
  add("base", "box", baseC, [base.L, base.H, base.W], () => m.box(baseC, [base.L, base.H, base.W]));
  if (spec.base === "wheels") {
    const n = Math.max(2, spec.wheels || 4);
    const perSide = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const k = Math.floor(i / 2);
      const x = perSide === 1 ? 0 : -base.L / 2 + wheelR + (k * (base.L - 2 * wheelR)) / (perSide - 1);
      const c = [x, wheelR, side * (base.W / 2 + wheelT / 2 + 0.005 * s)];
      add(`wheel ${i + 1}`, "cylinder", c, [2 * wheelR, 2 * wheelR, wheelT], () => m.cyl(c, wheelR, wheelT, "z"));
    }
  } else if (spec.base === "tracks") {
    for (const side of [1, -1]) {
      const c = [0, wheelR, side * (base.W / 2 + wheelT / 2)];
      add(`track ${side > 0 ? "left" : "right"}`, "box", c, [base.L + 0.04 * s, 2 * wheelR, wheelT], () => m.box(c, [base.L + 0.04 * s, 2 * wheelR, wheelT]));
    }
  } else {
    for (const side of [1, -1]) {
      const c = [0, groundToBase / 2, side * base.W * 0.3];
      add(`leg ${side > 0 ? "left" : "right"}`, "box", c, [0.07 * s, groundToBase, 0.07 * s], () => m.box(c, [0.07 * s, groundToBase, 0.07 * s]));
    }
  }
  const torso = { L: 0.18 * s, W: 0.22 * s, H: 0.32 * s };
  const torsoC = [0, groundToBase + base.H + torso.H / 2, 0];
  add("torso", "box", torsoC, [torso.L, torso.H, torso.W], () => m.box(torsoC, [torso.L, torso.H, torso.W]));
  const shoulderY = torsoC[1] + torso.H / 2 - 0.04 * s;
  for (let a = 0; a < spec.arms; a++) {
    const side = a % 2 === 0 ? 1 : -1;
    const tier = Math.floor(a / 2);
    const z = side * (torso.W / 2 + 0.03 * s);
    const y = shoulderY - tier * 0.1 * s;
    const label = spec.arms === 2 ? (side > 0 ? "left" : "right") : `${a + 1}`;
    const shoulder = [0, y, z];
    add(`arm ${label} shoulder`, "cylinder", shoulder, [0.06 * s, 0.06 * s, 0.05 * s], () => m.cyl(shoulder, 0.03 * s, 0.05 * s, "z"));
    const upper = [0, y - 0.11 * s, z];
    add(`arm ${label} upper`, "box", upper, [0.05 * s, 0.18 * s, 0.05 * s], () => m.box(upper, [0.05 * s, 0.18 * s, 0.05 * s]));
    const fore = [0.08 * s, y - 0.2 * s, z];
    add(`arm ${label} forearm`, "box", fore, [0.16 * s, 0.045 * s, 0.045 * s], () => m.box(fore, [0.16 * s, 0.045 * s, 0.045 * s]));
    if (spec.gripper) {
      for (const f of [1, -1]) {
        const g = [0.18 * s, y - 0.2 * s, z + f * 0.015 * s];
        add(`arm ${label} gripper finger`, "box", g, [0.05 * s, 0.02 * s, 0.01 * s], () => m.box(g, [0.05 * s, 0.02 * s, 0.01 * s]));
      }
    }
  }
  let top = torsoC[1] + torso.H / 2;
  if (spec.head) {
    const neck = [0, top + 0.02 * s, 0];
    add("neck", "cylinder", neck, [0.04 * s, 0.04 * s, 0.04 * s], () => m.cyl(neck, 0.02 * s, 0.04 * s, "y"));
    const head = [0, top + 0.04 * s + 0.06 * s, 0];
    add("head", "box", head, [0.12 * s, 0.12 * s, 0.14 * s], () => m.box(head, [0.12 * s, 0.12 * s, 0.14 * s]));
    top = head[1] + 0.06 * s;
    if (spec.camera) {
      const cam = [0.06 * s + 0.02 * s, head[1] + 0.01 * s, 0];
      add("camera", "cylinder", cam, [0.04 * s, 0.035 * s, 0.035 * s], () => m.cyl(cam, 0.0175 * s, 0.04 * s, "x"));
    }
  }
  return finishAssembly(spec, parts, m, "Concept layout from sized primitives (y up, x forward). Not a solved design: no structural, motor or battery sizing was run.");
}
