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

/** Which subsystems the ask names, with defaults for a small mobile manipulator. */
export function parseRobotAsk(text) {
  const t = String(text || "").toLowerCase();
  const legs = /\blegs?\b|\bbiped|\bwalking\b/.test(t);
  const tracked = /\btracks?\b|\btracked\b|\btreads?\b/.test(t);
  const scale = /\b(?:tiny|desk|desktop|toy)\b/.test(t) ? 0.5 : /\b(?:large|big|full[- ]size|human[- ]size)\b/.test(t) ? 2 : 1;
  return {
    scale,
    base: legs ? "legs" : tracked ? "tracks" : "wheels",
    // Default 4 wheels (2 per side); "3 wheels per side" means 6.
    wheels: legs || tracked ? 0 : countOf(t, "wheels?", 4) * (/\bwheels?\s+(?:per|on each|each)\s+side\b/.test(t) ? 2 : 1),
    arms: countOf(t, "arms?", /\barms?\b/.test(t) ? 2 : 0),
    head: /\bhead\b/.test(t) || /\bcamera\b/.test(t) || !/\bno head\b/.test(t),
    camera: /\bcamera|vision|eyes?\b/.test(t),
    gripper: !/\bno (?:gripper|hands?)\b/.test(t),
  };
}

export function meshBuilder() {
  const positions = [], indices = [];
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
  return { positions, indices, box, cyl };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** @returns {{ ok: true, spec, parts, mesh, bbox, notes }} */
export function buildRobotAssembly(text) {
  const spec = parseRobotAsk(text);
  const s = spec.scale;
  const m = meshBuilder();
  const parts = [];
  const add = (name, shape, center, size, make) => {
    make();
    parts.push({ name, shape, center_mm: center.map((v) => Math.round(v * 1000)), size_mm: size.map((v) => Math.round(v * 1000)) });
  };
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
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]); ys.push(m.positions[i + 1]); zs.push(m.positions[i + 2]); }
  const span = (a) => Math.round((Math.max(...a) - Math.min(...a)) * 1000);
  return {
    ok: true,
    spec,
    parts,
    bbox_mm: { length: span(xs), height: span(ys), width: span(zs) },
    mesh: { kind: "robot-assembly", positions: m.positions.map(r3), indices: m.indices, vertexCount: m.positions.length / 3, triangleCount: m.indices.length / 3 },
    notes: "Concept layout from sized primitives (y up, x forward). Not a solved design: no structural, motor or battery sizing was run.",
  };
}
