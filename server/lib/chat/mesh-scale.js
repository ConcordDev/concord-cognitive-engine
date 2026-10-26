// Requested size on a TRELLIS mesh. The pod's GLB has no units. A size in
// the prompt ("a 30 cm dragon", "a 2 m tall robot") scales the mesh so that
// dimension matches, in millimetres. No size stays unitless — dimensions
// are not invented.

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(millimet(?:re|er)s?|millimeters?|centimet(?:re|er)s?|centimeters?|feet|foot|ft|inches|inch|mm|cm|in|m)\b/gi;

function factorOf(unit) {
  const u = String(unit || "").toLowerCase();
  if (/^(?:mm|millimet)/.test(u)) return 1;
  if (/^(?:cm|centimet)/.test(u)) return 10;
  if (/^(?:in|inch)/.test(u)) return 25.4;
  if (/^(?:ft|feet|foot)/.test(u)) return 304.8;
  if (/^m/.test(u)) return 1000;
  return null;
}

function axisNear(text, index, length) {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  const window = text.slice(start, end);
  if (/tall|high|height/i.test(window)) return "y";
  if (/long|length|deep|depth/i.test(window)) return "x";
  if (/wide|width/i.test(window)) return "z";
  return null;
}

/** @returns {{ mm: number, axis: "x"|"y"|"z"|null, raw: string }[]} */
export function parseRequestedSize(text) {
  const src = String(text || "");
  const hits = [];
  for (const m of src.matchAll(SIZE_RE)) {
    const factor = factorOf(m[2]);
    const n = Number(m[1]);
    if (!factor || !(n > 0)) continue;
    const axis = axisNear(src, m.index, m[0].length);
    const axisWord = axis === "y" ? "tall" : axis === "x" ? "long" : axis === "z" ? "wide" : "";
    hits.push({
      mm: n * factor,
      axis,
      raw: axisWord ? `${m[0]} ${axisWord}` : m[0],
    });
  }
  return hits;
}

function bboxOf(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  if (!Array.isArray(positions)) return null;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX, minY, minZ, maxX, maxY, maxZ,
    sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
  };
}

function longestAxis(sx, sy, sz) {
  if (sy >= sx && sy >= sz) return "y";
  if (sz >= sx) return "z";
  return "x";
}

const AXIS_NAME = { x: "length", y: "height", z: "width" };
const round3 = (n) => Math.round(n * 1000) / 1000;

const UNITLESS = {
  units: "unitless",
  geometryUnits: "unitless",
  bbox_mm: null,
  scale: 1,
  scaleNote: "unitless (not to scale)",
};

/**
 * Scale `mesh` so the requested dimension is that many millimetres.
 * Uniform scale about the centroid. Positions are millimetres afterwards.
 * No requested size, or a zero span on the requested axis, leaves the
 * coordinates alone and reports unitless.
 */
export function applyRequestedScale(mesh, text) {
  const positions = mesh?.positions;
  const hits = parseRequestedSize(text);
  if (!hits.length || !Array.isArray(positions) || positions.length < 9) {
    return { mesh, ...UNITLESS };
  }
  const bb = bboxOf(positions);
  if (!bb) return { mesh, ...UNITLESS };
  const first = hits[0];
  const axis = first.axis || longestAxis(bb.sx, bb.sy, bb.sz);
  const span = axis === "y" ? bb.sy : axis === "z" ? bb.sz : bb.sx;
  if (!(span > 0)) {
    return {
      mesh,
      ...UNITLESS,
      scaleNote: "unitless (not to scale). The requested size was not applied: that axis has no span.",
    };
  }
  const factor = first.mm / span;
  const out = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push(
      round3(bb.cx + (positions[i] - bb.cx) * factor),
      round3(bb.cy + (positions[i + 1] - bb.cy) * factor),
      round3(bb.cz + (positions[i + 2] - bb.cz) * factor),
    );
  }
  const sized = bboxOf(out);
  const bbox_mm = {
    length: round3(sized.sx),
    height: round3(sized.sy),
    width: round3(sized.sz),
  };
  const label = AXIS_NAME[axis];
  let scaleNote = first.axis
    ? `Scaled so the ${label} is ${round3(first.mm)} mm.`
    : `Scaled so the longest side is ${round3(first.mm)} mm.`;
  if (hits.length > 1) {
    const rest = hits.slice(1).map((h) => h.raw).join(", ");
    scaleNote += ` ${rest} was not set independently; one uniform scale cannot satisfy every requested size.`;
  }
  return {
    mesh: { ...mesh, positions: out },
    units: "mm",
    geometryUnits: "mm",
    bbox_mm,
    scale: factor,
    scaleNote,
  };
}
