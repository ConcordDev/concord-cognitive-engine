// server/lib/conkay/cad/show-solid.js
//
// Visual polish (c): the apertures cut into a show copy of the analysed body
// (cad/conkay_show_occ.py), and the receipts that re-check it. The analysed
// body (cad.body) is never replaced: every other solver keeps reading it.
//
// Apertures come from cad.design-surface's layers, on the same projections as
// the Studio overlays (assembly/surface-overlays.js): side glass along y above
// the solid's shoulder line, windscreen and backlight along the tub glazing
// quad's outward normal, lamp slots along x from ahead, door gaps along y.
// Glass and lamp apertures are refilled by their panes (show ∪ panes = body);
// door gaps are grooves and are not refilled.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestKernel, rememberKernel, runPythonKernel } from "./kernel-queue.js";
import { resolveKernelPython, ensurePrivateDir, writePrivateFile, UNAVAILABLE, BODY_SCRIPT_HASH } from "./body-kernel.js";
import { shoulderLine, columnSpan } from "../assembly/surface-overlays.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHOW_SCRIPT = path.join(HERE, "conkay_show_occ.py");
// the show script imports the body kernel's functions: a change to either is a different run
export const SHOW_SCRIPT_HASH = createHash("sha256").update(fs.readFileSync(SHOW_SCRIPT)).update(BODY_SCRIPT_HASH).digest("hex");

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** Every size here is a design choice for the show solid. None is a sourced glazing, lamp or gap specification. */
export const SHOW_CHOICES = Object.freeze({
  glazingDepthM: { value: 0.005, basis: "design choice: each glass pane is the 5 mm slab of the body under the aperture, measured along the aperture direction. Not a sourced glazing thickness." },
  lampDepthM: { value: 0.005, basis: "design choice: each lamp lens is the 5 mm slab of the nose under the lamp slot, measured along x. Not a sourced lens thickness." },
  doorGapWidthM: { value: 0.004, basis: "design choice: a 4 mm door gap around each tub door aperture. Not a sourced shut-line specification." },
  doorGapDepthM: { value: 0.01, basis: "design choice: the door gap is a 10 mm deep groove along y, not refilled. The skin offset (40 mm) is what the packaging re-check holds it to." },
  glassToGapM: { value: 0.002, basis: "design choice: side glass stops 2 mm beyond half the door gap inside the door outline, so a pane and a gap groove never overlap (where design-surface could not inset the glass, its outline is the door aperture itself)." },
});

/** How far side glass stays inside its door outline: half the gap plus glassToGap. */
export const GLASS_EDGE_INSET_M = SHOW_CHOICES.doorGapWidthM.value / 2 + SHOW_CHOICES.glassToGapM.value;

const SIDE_STEP = 0.02;

/**
 * The side-glass outline above the shoulder and at least `inset` inside the door outline (ends in x, top in z):
 * an x-monotone polygon in (x, z), or null when nothing is left.
 */
export function sideGlassOutline(outline, solid, inset = GLASS_EDGE_INSET_M) {
  const x0 = Math.min(...outline.map((p) => p[0])) + inset, x1 = Math.max(...outline.map((p) => p[0])) - inset;
  if (!(x1 > x0)) return null;
  const n = Math.max(2, Math.ceil((x1 - x0) / SIDE_STEP));
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * Math.min(Math.max(i, 1e-4), n - 1e-4)) / n);
  const sh = shoulderLine(solid, xs);
  const cols = xs.map((x, i) => {
    const s = columnSpan(outline, x);
    // the higher shoulder of this and the next sample, as the overlay does: never dip below it between samples
    const z = Math.max(sh[i]?.z ?? -Infinity, sh[i + 1]?.z ?? -Infinity);
    if (!s || !Number.isFinite(z)) return null;
    // the vertical inset: the door outline's top and bottom edges here are near-horizontal, so this is close to
    // the normal inset; the ends are inset in x above
    const lo = Math.max(s[0] + inset, z), hi = s[1] - inset;
    return hi - lo > 0.005 ? { x, lo, hi } : null;
  });
  // the longest contiguous run of columns with glass
  let best = [], run = [];
  for (const c of cols) {
    if (c) run.push(c); else { if (run.length > best.length) best = run; run = []; }
  }
  if (run.length > best.length) best = run;
  if (best.length < 2) return null;
  return [...best.map((c) => [r4(c.x), r4(c.lo)]), ...best.slice().reverse().map((c) => [r4(c.x), r4(c.hi)])];
}

function quadNormal(q, solid) {
  const [p0, p1, , p3] = q;
  const e1 = p1.map((c, i) => c - p0[i]), e2 = p3.map((c, i) => c - p0[i]);
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const L = Math.hypot(...n);
  n = n.map((c) => c / L);
  const { min, max } = solid.bounds;
  const centre = [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2 - 0.2];
  const mid = [0, 1, 2].map((i) => q.reduce((s, p) => s + p[i], 0) / q.length);
  if ((mid[0] - centre[0]) * n[0] + (mid[1] - centre[1]) * n[1] + (mid[2] - centre[2]) * n[2] < 0) n = n.map((c) => -c);
  return { n, mid };
}

/**
 * The apertures for the kernel: { id, kind, outline3d (planar polygon), dir (unit, outward), lengthM, depthM, gapWidthM? }.
 * layers: cad.design-surface layers. solid: cadSkinSolid of the body STL (for the shoulder line and the nose).
 * Returns { apertures, skipped: [{ id, reason }] }.
 */
export function showApertures(layers, solid) {
  const apertures = [];
  const skipped = [];
  const glazingDepth = SHOW_CHOICES.glazingDepthM.value;
  for (const g of layers?.glazing || []) {
    if (g.outlineXYZ) {
      const { n, mid } = quadNormal(g.outlineXYZ, solid);
      // project the quad onto the plane through its centroid, normal n: a planar polygon for the prism
      const flat = g.outlineXYZ.map((p) => {
        const d = (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1] + (p[2] - mid[2]) * n[2];
        return p.map((c, i) => r4(c - d * n[i]));
      });
      apertures.push({ id: g.id, kind: "glazing", outline3d: flat, dir: n.map(r4), lengthM: 1.5, depthM: glazingDepth });
      continue;
    }
    if (!g.outline || !g.inDoor) continue;
    const sign = /-L$/.test(g.inDoor) ? 1 : -1;
    const o = sideGlassOutline(g.outline, solid);
    if (!o) { skipped.push({ id: g.id, reason: "the aperture is below the solid's shoulder line: no glass" }); continue; }
    apertures.push({ id: g.id, kind: "glazing", outline3d: o.map(([x, z]) => [x, 0, z]), dir: [0, sign, 0], lengthM: 3, depthM: glazingDepth });
  }
  if (layers?.lamps?.state === "placed") {
    const xIn = r4(solid.bounds.min[0] + 0.5);
    for (const s of layers.lamps.slots) {
      apertures.push({ id: s.id, kind: "lamp", outline3d: s.outlineYZ.map(([y, z]) => [xIn, y, z]), dir: [-1, 0, 0], lengthM: 1.0, depthM: SHOW_CHOICES.lampDepthM.value });
    }
  } else {
    skipped.push({ id: "lamps", reason: layers?.lamps?.reason || "no lamp slots on the design surface" });
  }
  for (const d of layers?.panelCuts || []) {
    const sign = d.side === "L" ? 1 : -1;
    apertures.push({ id: `gap-${d.id}`, kind: "door-gap", outline3d: d.outline.map(([x, z]) => [x, 0, z]), dir: [0, sign, 0], lengthM: 3, depthM: SHOW_CHOICES.doorGapDepthM.value, gapWidthM: SHOW_CHOICES.doorGapWidthM.value });
  }
  return { apertures, skipped };
}

// ---------- the kernel run (cached like cad.body's, in its own directory) ----------

export function showCacheDir() {
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "conkay-cad-show");
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

export function showRequestHash(request) {
  return createHash("sha256").update(SHOW_SCRIPT_HASH).update(JSON.stringify(canonical(request))).digest("hex").slice(0, 24);
}

export async function runShowKernelAsync(request, { timeoutMs = 3600000 } = {}) {
  const python = await resolveKernelPython();
  if (!python) return { ok: false, unavailable: UNAVAILABLE };
  const hash = showRequestHash(request);
  const useCache = await ensurePrivateDir(showCacheDir());
  const dir = useCache ? path.join(showCacheDir(), hash) : await fsp.mkdtemp(path.join(os.tmpdir(), `conkay-cad-show-${hash}-`));
  const cached = path.join(dir, "result.json");
  if (useCache) {
    try {
      const r = JSON.parse(await fsp.readFile(cached, "utf8"));
      rememberKernel(`show:${hash}`, r);
      return r;
    } catch { /* not cached: run */ }
  }
  const out = await runPythonKernel({ python, script: SHOW_SCRIPT, input: { ...request, outDir: dir }, timeoutMs });
  out.requestHash = hash;
  if (out.ok) {
    if (useCache && await ensurePrivateDir(dir)) {
      await writePrivateFile(cached, JSON.stringify(out));
      await writePrivateFile(path.join(dir, "request.json"), JSON.stringify({ ...request, outDir: dir }));
    }
    rememberKernel(`show:${hash}`, out);
  }
  return out;
}

/** For the synchronous solver: the result if this process has it, else queued ({ pending: true }). */
export function runShowKernel(request) {
  const hash = showRequestHash(request);
  return requestKernel(`show:${hash}`, () => runShowKernelAsync(request), `show solid ${hash}`);
}
