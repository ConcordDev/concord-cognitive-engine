/**
 * server/lib/creature-portrait.js
 *
 * Honest procedural creature imagery. Concord has no art-asset pipeline and
 * no real-world reference photography for fictional procedural species — an
 * image model here would be pure fabrication (there is nothing real for it
 * to be grounded in). What DOES exist, real and already-computed, is the
 * body-plan output of `server/lib/procedural-creature.js#generateCreature`:
 * a topology, a mass, a height, and a tree of body PARTS with real 3D
 * attach-point offsets and half-extent dimensions that
 * `validateCreaturePhysics` already checked for coherence (wings sized to
 * lift the mass, legs sized to bear it, etc — see that file's comments).
 *
 * `buildCreaturePortraitSvg()` renders THAT geometry directly: every part's
 * real (x,y,z) attach offset and real (x,y,z) half-extent is projected into
 * a 2D schematic. Nothing here is invented — there is no per-topology art
 * template and no decorative flourish. The function doesn't even branch on
 * `topology` for its drawing logic; it draws whatever tree of `parts` it is
 * given, so a 20-segment serpentine body and a 4-legged quadruped fall out
 * of the SAME code path, differing only because their real geometry differs.
 * No `Math.random()`, no `Date.now()`, no external state — the same
 * blueprint input always produces the byte-identical SVG string.
 *
 * What maps to what (the honesty contract this file exists to keep):
 *   - `parts[].attach` / `parts[].dimensions` (real 3D geometry from the
 *     generator) -> every ellipse's position and radius. This IS the body
 *     plan, obliquely projected — not a redrawing or approximation of it.
 *   - `massKg` / `heightM` -> feed the upstream part dimensions (already,
 *     via `generateCreature`) AND the rendered scale (a physically bigger
 *     bounding box in meters produces a numerically bigger SVG viewBox/
 *     radii — see `PX_PER_METER` below; this is a fixed real-world scale,
 *     not a per-instance "fit to frame" normalization, so mass/height
 *     genuinely drive rendered size).
 *   - `parts[].kind` -> only used for (a) z-order (torso/head drawn over
 *     limbs) and (b) a deterministic shading factor. `kind` is real data
 *     from the generator; the shading is a pure function of it, not an
 *     invented biological detail.
 *   - `parts.length` / kind counts -> the number of rendered ellipses IS
 *     the number of real body parts. A 2-part amorphous blob and an
 *     8-legged polyped render visibly different limb counts because they
 *     ARE different limb counts.
 *   - `coatColor` -> the real deterministic tint computed upstream
 *     (`domains/creatures.js#coatFor` — species-id hash, or elemental
 *     affinity for a bred hybrid) tints every part's fill.
 *   - `variant` -> if present (a real bred-hybrid label), appended to the
 *     caption + aria-label. Never invented when absent.
 *
 * Framing: this is a PROCEDURAL SCHEMATIC of a real body plan, not concept
 * art and not a photographic "portrait" implying real likeness — callers
 * (the `creatures.portrait` macro, the creatures lens UI) present it that
 * way in copy and alt text.
 */

// Fixed real-world scale: pixels per meter. NOT recomputed per creature —
// keeping this constant is what makes "heavier/taller creature renders
// bigger" a true statement about the output instead of an illusion created
// by normalizing every creature to fill the same frame.
const PX_PER_METER = 20;
const CANVAS_PAD_PX = 14;
const MIN_VB = 56;
const MAX_VB = 640;
const MIN_RADIUS_PX = 1.2;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shade(hex, factor) {
  const clean = String(hex || "#8b5e3c").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num16 = parseInt(full, 16);
  if (!Number.isFinite(num16) || full.length !== 6) return "#8b5e3c";
  const r = clamp(Math.round(((num16 >> 16) & 255) * factor), 0, 255);
  const g = clamp(Math.round(((num16 >> 8) & 255) * factor), 0, 255);
  const b = clamp(Math.round((num16 & 255) * factor), 0, 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// kind -> shading factor applied to the real coatColor (1.0 = as-is).
// A pure function of the real `kind` field the body-plan generator already
// assigns to every part — not an invented anatomical detail.
const KIND_SHADE = Object.freeze({
  head: 1.18, torso: 1.0, core: 1.0, leg: 0.72, arm: 0.8, wing: 0.92, tail: 0.68,
});
// kind -> draw order (limbs drawn behind torso/head).
const KIND_ORDER = Object.freeze({ leg: 0, wing: 0, tail: 0, arm: 1, torso: 2, core: 2, head: 3 });

/** Count real parts by kind — used both for rendering and for the macro's
 * reported params (leg/wing/arm/tail counts a caller can display as text). */
export function summarizePartCounts(parts) {
  const counts = {};
  for (const p of Array.isArray(parts) ? parts : []) {
    const kind = (p && p.kind) || "limb";
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

// Walk the real parent/attach chain (exactly as authored by
// procedural-creature.js's builders) to an absolute position per part.
// Depth-guarded against malformed/cyclic input; real blueprints are trees.
function computeAbsolutePositions(parts) {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const cache = new Map();
  function resolve(part, depth) {
    if (!part) return { x: 0, y: 0, z: 0 };
    if (cache.has(part.name)) return cache.get(part.name);
    if (depth > 64) return { x: 0, y: 0, z: 0 }; // cycle/malformed guard
    const attach = part.attach || {};
    const parentPart = part.parent ? byName.get(part.parent) : null;
    const parentPos = parentPart ? resolve(parentPart, depth + 1) : { x: 0, y: 0, z: 0 };
    const pos = {
      x: parentPos.x + num(attach.x),
      y: parentPos.y + num(attach.y),
      z: parentPos.z + num(attach.z),
    };
    cache.set(part.name, pos);
    return pos;
  }
  const out = new Map();
  for (const p of parts) out.set(p.name, resolve(p, 0));
  return out;
}

// Oblique ("cavalier") projection of the real 3D attach position into 2D —
// captures left/right (x), up/down (y), and front/back-or-length (z) in one
// view instead of picking a single axis pair that would flatten some
// topologies (a purely front-on view collapses serpentine's z-chained
// segments onto one point; a purely top-down view collapses humanoid's
// z=0 limbs onto one line). Purely a projection choice, not fabricated data.
const SKEW_X = 0.6;
const SKEW_Y = 0.35;
function project(pos) {
  return { sx: pos.x + pos.z * SKEW_X, sy: -pos.y - pos.z * SKEW_Y };
}

/**
 * Render a deterministic SVG schematic of a real creature body plan.
 *
 * @param {object} blueprint
 * @param {string} [blueprint.topology]   real topology id (caption only —
 *                                        drawing logic never branches on it)
 * @param {number} [blueprint.massKg]     real mass (caption only; the parts'
 *                                        real dimensions already encode it)
 * @param {number} [blueprint.heightM]    real height (caption + fallback)
 * @param {Array}  [blueprint.parts]      the real body-plan parts array
 *                                        from generateCreature() — each
 *                                        {name, kind, massKg, dimensions,
 *                                        parent, attach}
 * @param {string} [blueprint.coatColor]  real deterministic tint (#rrggbb)
 * @param {string|null} [blueprint.variant] real bred-hybrid label, if any
 * @returns {string} a complete, self-contained SVG document string
 */
export function buildCreaturePortraitSvg(blueprint) {
  const topology = String((blueprint && blueprint.topology) || "creature");
  const massKg = num(blueprint && blueprint.massKg, 50);
  const heightM = num(blueprint && blueprint.heightM, 1.5);
  const coatColorRaw = (blueprint && blueprint.coatColor) || "#8b5e3c";
  const coatColor = /^#[0-9a-fA-F]{6}$/.test(coatColorRaw) || /^#[0-9a-fA-F]{3}$/.test(coatColorRaw)
    ? coatColorRaw : "#8b5e3c";
  const variant = blueprint && blueprint.variant ? String(blueprint.variant) : null;
  const rawParts = Array.isArray(blueprint && blueprint.parts) ? blueprint.parts : [];
  const parts = rawParts.filter((p) => p && typeof p === "object" && p.name);

  const positions = computeAbsolutePositions(parts);
  const partCounts = summarizePartCounts(parts);

  const projected = parts.map((p) => {
    const pos = positions.get(p.name) || { x: 0, y: 0, z: 0 };
    const { sx, sy } = project(pos);
    const dims = p.dimensions || {};
    const rx = Math.max(num(dims.x, 0.05), 0.02);
    const ry = Math.max(num(dims.y, 0.05), 0.02);
    const rz = Math.max(num(dims.z, 0.05), 0.02);
    return {
      kind: p.kind || "limb",
      sx, sy,
      screenRx: rx + rz * SKEW_X,
      screenRy: ry + rz * SKEW_Y,
    };
  });

  // Real-meter bounding box of the projected geometry.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pr of projected) {
    minX = Math.min(minX, pr.sx - pr.screenRx);
    maxX = Math.max(maxX, pr.sx + pr.screenRx);
    minY = Math.min(minY, pr.sy - pr.screenRy);
    maxY = Math.max(maxY, pr.sy + pr.screenRy);
  }
  if (!Number.isFinite(minX)) { minX = -0.3; maxX = 0.3; minY = -0.3; maxY = 0.3; }
  const bboxWm = Math.max(maxX - minX, 0.05);
  const bboxHm = Math.max(maxY - minY, 0.05);
  const cxWorld = (minX + maxX) / 2;
  const cyWorld = (minY + maxY) / 2;

  // Fixed px/meter scale (not per-instance normalized) — a bigger real
  // bounding box genuinely produces a bigger viewBox + bigger part radii.
  const vbW = clamp(bboxWm * PX_PER_METER + CANVAS_PAD_PX * 2, MIN_VB, MAX_VB);
  const vbH = clamp(bboxHm * PX_PER_METER + CANVAS_PAD_PX * 2, MIN_VB, MAX_VB);

  const sorted = [...projected].sort((a, b) => (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2));
  const stroke = shade(coatColor, 0.45);
  const ellipses = sorted.map((pr) => {
    const cx = (vbW / 2 + (pr.sx - cxWorld) * PX_PER_METER).toFixed(2);
    const cy = (vbH / 2 + (pr.sy - cyWorld) * PX_PER_METER).toFixed(2);
    const rx = Math.max(pr.screenRx * PX_PER_METER, MIN_RADIUS_PX).toFixed(2);
    const ry = Math.max(pr.screenRy * PX_PER_METER, MIN_RADIUS_PX).toFixed(2);
    const fill = shade(coatColor, KIND_SHADE[pr.kind] ?? 0.85);
    const opacity = pr.kind === "head" ? 1 : 0.92;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1" opacity="${opacity}"/>`;
  }).join("");

  const legCount = partCounts.leg || 0;
  const armCount = partCounts.arm || 0;
  const wingCount = partCounts.wing || 0;
  const tailCount = partCounts.tail || 0;
  const bodySegCount = (partCounts.torso || 0) + (partCounts.core || 0);

  const massLabel = massKg >= 1000 ? `${(massKg / 1000).toFixed(1)}t` : `${Math.round(massKg)}kg`;
  const captionBits = [topology.replace(/_/g, " "), massLabel, `${heightM.toFixed(1)}m`];
  if (variant) captionBits.push(variant);
  const caption = captionBits.join(" · ");

  const ariaBits = ["Procedural body-plan schematic", topology.replace(/_/g, " "), massLabel, `${heightM.toFixed(2)}m tall`];
  if (legCount) ariaBits.push(`${legCount} leg${legCount === 1 ? "" : "s"}`);
  if (armCount) ariaBits.push(`${armCount} arm${armCount === 1 ? "" : "s"}`);
  if (wingCount) ariaBits.push(`${wingCount} wing${wingCount === 1 ? "" : "s"}`);
  if (tailCount) ariaBits.push("tail");
  if (bodySegCount > 1) ariaBits.push(`${bodySegCount} body segments`);
  if (variant) ariaBits.push(`variant ${variant}`);
  const ariaLabel = ariaBits.join(", ");

  const vbWs = vbW.toFixed(2);
  const vbHs = vbH.toFixed(2);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbWs} ${vbHs}" width="${vbWs}" height="${vbHs}" ` +
    `role="img" aria-label="${escapeXml(ariaLabel)}">` +
    `<rect width="${vbWs}" height="${vbHs}" rx="10" fill="#0b0b12"/>` +
    ellipses +
    `<text x="8" y="${(vbH - 8).toFixed(2)}" font-family="ui-monospace,monospace" font-size="9" fill="#9ca3af">${escapeXml(caption)}</text>` +
    `</svg>`
  );
}
