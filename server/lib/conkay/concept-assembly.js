// server/lib/conkay/concept-assembly.js
//
// Concept 3D assemblies for everyday CAD asks the ConKay solver has no part
// for (cockpit audit 2026-10-19: "make a CAD model of a phone stand",
// "design a truss", "3d model of a gearbox" all came back "unsupported part"
// and ended the reply). Same approach as robot-assembly.js: sized primitives
// merged into one triangle mesh the chat shows in 3D, plus the parts list.
// It is a layout concept, not a solved design: no stress, gear-tooth or
// tolerance analysis is claimed. Sizes come from the user's numbers when
// given ("for a 6.7 inch phone", "3 m span"), otherwise stated defaults.

import { meshBuilder } from "./robot-assembly.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const mm = (v) => Math.round(v * 1000);

/** First length in the text with its unit, in metres; null when none. */
function lengthIn(text, re) {
  const m = re.exec(String(text || ""));
  if (!m) return null;
  const n = Number(m[1]);
  const u = String(m[2] || "").toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/^(?:mm|millimet)/.test(u)) return n / 1000;
  if (/^(?:cm|centimet)/.test(u)) return n / 100;
  if (/^(?:in|inch|")/.test(u)) return n * 0.0254;
  if (/^(?:ft|feet|foot|')/.test(u)) return n * 0.3048;
  return n; // metres
}
const LEN = String.raw`(\d+(?:\.\d+)?)\s*(mm|millimet\w*|cm|centimet\w*|m\b|met(?:er|re)s?|in\b|inch(?:es)?|"|ft|feet|foot|')`;

const TEMPLATES = [
  {
    kind: "phone-stand",
    re: /\b(?:phone|tablet|ipad|mobile)\s*(?:stand|holder|dock|cradle)\b|\bstand\s+for\s+(?:my\s+|a\s+)?(?:phone|tablet)\b/i,
    build(text, m, add) {
      const tablet = /\b(?:tablet|ipad)\b/i.test(text);
      const W = tablet ? 0.16 : 0.08; // width across the device
      const angleDeg = Number(/\b(\d{2})\s*(?:°|deg|degrees?)\b/i.exec(text)?.[1]) || 65;
      const a = (Math.min(80, Math.max(45, angleDeg)) * Math.PI) / 180;
      const t = 0.005;
      const baseL = tablet ? 0.14 : 0.10;
      add("base plate", "box", [0, t / 2, 0], [baseL, t, W], () => m.box([0, t / 2, 0], [baseL, t, W]));
      // Back rest: a plate leaned at the viewing angle, built as stacked thin boxes.
      const restL = tablet ? 0.16 : 0.11;
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        const s0 = (i + 0.5) / steps;
        const cx = -baseL / 2 + 0.02 + Math.cos(a) * restL * s0;
        const cy = t + Math.sin(a) * restL * s0;
        m.box([cx, cy, 0], [t * 1.6, restL / steps + 0.002, W]);
      }
      add("back rest", "plate", [-baseL / 2 + 0.02 + (Math.cos(a) * restL) / 2, t + (Math.sin(a) * restL) / 2, 0], [t, restL, W], () => {});
      const lipX = -baseL / 2 + 0.02 + Math.cos(a) * 0.012 + 0.012;
      add("front lip", "box", [lipX, t + 0.006, 0], [0.004, 0.012, W], () => m.box([lipX, t + 0.006, 0], [0.004, 0.012, W]));
      const braceX = -baseL / 2 + 0.02 + Math.cos(a) * restL * 0.55 + 0.02;
      add("rear brace", "box", [braceX, t + 0.025, 0], [t, 0.05, W * 0.6], () => m.box([braceX, t + 0.025, 0], [t, 0.05, W * 0.6]));
      return { notes: `Viewing angle ${Math.round((a * 180) / Math.PI)}°, ${mm(t)} mm plates. Print flat on the base; PLA or PETG at 20% infill is typical.` };
    },
  },
  {
    kind: "truss",
    re: /\btruss(?:es)?\b/i,
    build(text, m, add) {
      const span = lengthIn(text, new RegExp(String.raw`${LEN}\s*(?:long|span|wide)?`, "i")) || 3;
      const bays = Math.max(2, Math.min(12, Math.round(span / 0.5)));
      const h = Math.max(0.15, span / 8);
      const b = Math.max(0.02, span / 120);
      const bay = span / bays;
      add("bottom chord", "box", [0, b / 2, 0], [span, b, b], () => m.box([0, b / 2, 0], [span, b, b]));
      add("top chord", "box", [0, h, 0], [span, b, b], () => m.box([0, h, 0], [span, b, b]));
      for (let i = 0; i <= bays; i++) {
        const x = -span / 2 + i * bay;
        add(`vertical ${i + 1}`, "box", [x, h / 2, 0], [b, h, b], () => m.box([x, h / 2, 0], [b, h, b]));
      }
      // Diagonals as short stacked segments (Pratt pattern).
      for (let i = 0; i < bays; i++) {
        const x0 = -span / 2 + i * bay, x1 = x0 + bay;
        const up = i < bays / 2;
        const seg = 8;
        for (let k = 0; k < seg; k++) {
          const f = (k + 0.5) / seg;
          const x = x0 + (x1 - x0) * f;
          const y = up ? h * (1 - f) : h * f;
          m.box([x, y, 0], [bay / seg + b * 0.5, b * 0.8, b * 0.8]);
        }
        parts_push_diag(add, i, [(x0 + x1) / 2, h / 2, 0], [bay, h, b]);
      }
      return { notes: `Pratt truss, ${bays} bays of ${mm(bay)} mm, depth ${mm(h)} mm (span/8). Member sizes are placeholders: run conkay_design or engineering.runFEA with the real loads before building.` };
    },
  },
  {
    kind: "gearbox",
    re: /\bgear\s*-?\s*box(?:es)?\b|\bgear\s+(?:train|reducer|reduction)\b|\bspeed reducer\b/i,
    build(text, m, add) {
      const ratio = Number(/\b(\d+(?:\.\d+)?)\s*(?::|to)\s*1\b/.exec(text)?.[1]) || 3;
      const r1 = 0.02, r2 = Math.min(0.08, r1 * ratio), w = 0.015;
      const c = r1 + r2;
      const H = 2 * r2 + 0.03, L = c + r1 + r2 + 0.03, D = w * 3;
      add("housing (shown as base + walls)", "box", [c / 2, 0.005, 0], [L, 0.01, D], () => m.box([c / 2, 0.005, 0], [L, 0.01, D]));
      add("rear wall", "box", [c / 2, H / 2, -D / 2], [L, H, 0.004], () => m.box([c / 2, H / 2, -D / 2], [L, H, 0.004]));
      const y = r2 + 0.015;
      add(`pinion (r ${mm(r1)} mm)`, "cylinder", [0, y, 0], [2 * r1, 2 * r1, w], () => m.cyl([0, y, 0], r1, w, "z", 18));
      add(`gear (r ${mm(r2)} mm)`, "cylinder", [c, y, 0], [2 * r2, 2 * r2, w], () => m.cyl([c, y, 0], r2, w, "z", 36));
      add("input shaft", "cylinder", [0, y, 0], [0.008, 0.008, D + 0.03], () => m.cyl([0, y, 0], 0.004, D + 0.03, "z", 12));
      add("output shaft", "cylinder", [c, y, 0], [0.012, 0.012, D + 0.03], () => m.cyl([c, y, 0], 0.006, D + 0.03, "z", 12));
      return { notes: `Single-stage ${ratio}:1 spur reduction, centre distance ${mm(c)} mm. Gears are shown as pitch cylinders; tooth count, module and bearing sizing were not run.` };
    },
  },
  {
    kind: "shelf",
    re: /\b(?:shelf|shelves|bookshelf|bookcase)\b/i,
    build(text, m, add) {
      const W = lengthIn(text, new RegExp(String.raw`${LEN}\s*(?:wide|width)`, "i")) || 0.8;
      const H = lengthIn(text, new RegExp(String.raw`${LEN}\s*(?:tall|high|height)`, "i")) || 1.2;
      const D = 0.3, t = 0.018;
      const n = Math.max(2, Math.min(8, Number(/\b(\d)\s*(?:shelves|levels|tiers)\b/i.exec(text)?.[1]) || 4));
      for (const side of [-1, 1]) add(`side panel ${side < 0 ? "left" : "right"}`, "box", [side * (W / 2 - t / 2), H / 2, 0], [t, H, D], () => m.box([side * (W / 2 - t / 2), H / 2, 0], [t, H, D]));
      for (let i = 0; i < n; i++) {
        const y = t / 2 + (i * (H - t)) / (n - 1);
        add(`shelf ${i + 1}`, "box", [0, y, 0], [W - 2 * t, t, D], () => m.box([0, y, 0], [W - 2 * t, t, D]));
      }
      return { notes: `${n} shelves, ${mm(t)} mm boards, ${mm(D)} mm deep.` };
    },
  },
  {
    kind: "table",
    re: /\b(?:table|desk|workbench)\b/i,
    build(text, m, add) {
      const L = lengthIn(text, new RegExp(String.raw`${LEN}\s*(?:long|length)`, "i")) || 1.2;
      const D = lengthIn(text, new RegExp(String.raw`${LEN}\s*(?:deep|wide|depth|width)`, "i")) || 0.6;
      const H = 0.75, t = 0.03, leg = 0.05;
      add("top", "box", [0, H - t / 2, 0], [L, t, D], () => m.box([0, H - t / 2, 0], [L, t, D]));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const c = [sx * (L / 2 - leg), (H - t) / 2, sz * (D / 2 - leg)];
        add("leg", "box", c, [leg, H - t, leg], () => m.box(c, [leg, H - t, leg]));
      }
      return { notes: `Top ${mm(t)} mm, ${mm(leg)} mm square legs, ${mm(H)} mm working height.` };
    },
  },
  {
    kind: "chair",
    re: /\b(?:chair|stool|seat)\b/i,
    build(text, m, add) {
      const S = 0.45, Hs = 0.45, t = 0.025, leg = 0.035;
      add("seat", "box", [0, Hs, 0], [S, t, S], () => m.box([0, Hs, 0], [S, t, S]));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const c = [sx * (S / 2 - leg), Hs / 2, sz * (S / 2 - leg)];
        add("leg", "box", c, [leg, Hs, leg], () => m.box(c, [leg, Hs, leg]));
      }
      if (!/\bstool\b/i.test(text)) add("backrest", "box", [-S / 2 + t / 2, Hs + 0.22, 0], [t, 0.4, S], () => m.box([-S / 2 + t / 2, Hs + 0.22, 0], [t, 0.4, S]));
      return { notes: `Seat ${mm(S)} mm square at ${mm(Hs)} mm.` };
    },
  },
  {
    kind: "enclosure",
    re: /\b(?:enclosure|project box|electronics box|housing|case)\b/i,
    build(text, m, add) {
      const L = 0.12, W = 0.08, H = 0.04, t = 0.002;
      add("floor", "box", [0, t / 2, 0], [L, t, W], () => m.box([0, t / 2, 0], [L, t, W]));
      for (const s of [-1, 1]) {
        add("long wall", "box", [0, H / 2, s * (W / 2 - t / 2)], [L, H, t], () => m.box([0, H / 2, s * (W / 2 - t / 2)], [L, H, t]));
        add("short wall", "box", [s * (L / 2 - t / 2), H / 2, 0], [t, H, W], () => m.box([s * (L / 2 - t / 2), H / 2, 0], [t, H, W]));
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const c = [sx * (L / 2 - 0.008), H / 2, sz * (W / 2 - 0.008)];
        add("screw boss", "cylinder", c, [0.006, H, 0.006], () => m.cyl(c, 0.003, H, "y", 12));
      }
      return { notes: `${mm(t)} mm walls, four M2.5 screw bosses; lid not shown.` };
    },
  },
];

function parts_push_diag(add, i, center, size) {
  add(`diagonal ${i + 1}`, "box", center, size, () => {});
}

/** The concept template for an ask, or null. */
export function conceptKind(text) {
  const t = String(text || "");
  return TEMPLATES.find((x) => x.re.test(t))?.kind || null;
}

/** @returns {null | { ok: true, kind, parts, bbox_mm, mesh, notes }} */
export function buildConceptAssembly(text) {
  const t = String(text || "");
  const tpl = TEMPLATES.find((x) => x.re.test(t));
  if (!tpl) return null;
  const m = meshBuilder();
  const parts = [];
  const add = (name, shape, center, size, make) => {
    make();
    parts.push({ name, shape, center_mm: center.map(mm), size_mm: size.map(mm) });
  };
  const extra = tpl.build(t, m, add) || {};
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]); ys.push(m.positions[i + 1]); zs.push(m.positions[i + 2]); }
  const span = (a) => (a.length ? Math.round((Math.max(...a) - Math.min(...a)) * 1000) : 0);
  return {
    ok: true,
    kind: tpl.kind,
    parts,
    bbox_mm: { length: span(xs), height: span(ys), width: span(zs) },
    mesh: { kind: `${tpl.kind}-concept`, positions: m.positions.map(r3), indices: m.indices, vertexCount: m.positions.length / 3, triangleCount: m.indices.length / 3 },
    notes: `Concept layout from sized primitives (y up). ${extra.notes || ""} Not a solved design: no structural or tolerance analysis was run.`.trim(),
  };
}
