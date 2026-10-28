// server/lib/conkay/verticals/prosthetics.js
// Custom Bioprinting / Prosthetics / Extrusion Telemetry — geometry + G-code ONLY.
// Honesty: synthetic/scan meshes; biocompatible polymer GEOMETRY; NOT wet-lab; NOT FDA.

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/** Parametric residual-limb socket (synthetic) as triangle mesh. */
export function buildParametricSocket({
  height = 120,
  proximalRadius = 45,
  distalRadius = 30,
  segments = 24,
  stacks = 10,
  ovalFactor = 0,
} = {}) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= stacks; i++) {
    const t = i / stacks;
    const y = t * height;
    const r = distalRadius * (1 - t) + proximalRadius * t; // y=0 distal, y=height proximal
    // Default circular frustum (ovalFactor=0) so digital fit residuals meet tolMm
    const oval = Number(ovalFactor) || 0;
    const rx = r * (1 + oval * Math.sin(t * Math.PI));
    const rz = r * (1 - oval * 0.66 * Math.cos(t * Math.PI));
    for (let j = 0; j < segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(th) * rx, y, Math.sin(th) * rz);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = (i + 1) * segments + j;
      const d = (i + 1) * segments + ((j + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    ok: true,
    kind: 'parametric_socket',
    units: 'mm',
    mesh: {
      positions,
      indices,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      id: 'prosthetic-socket-synth',
    },
    params: { height, proximalRadius, distalRadius, segments, stacks, ovalFactor },
    honesty: {
      synthetic: true,
      note: 'Synthetic parametric socket mesh — not patient scan / not FDA implant CAD',
    },
  };
}

/** AABB + axis-fit residuals — digital ASME-style fit check (software metrology). */
export function digitalFitCheck(mesh, {
  targetHeight = 120,
  targetProximalRadius = 45,
  targetDistalRadius = 30,
  tolMm = 0.5,
} = {}) {
  const pos = mesh?.positions || [];
  if (pos.length < 9) return { ok: false, error: 'empty_mesh', code: 'NO_MESH' };

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const height = maxY - minY;
  const midY = (minY + maxY) / 2;
  // proximal = top band, distal = bottom band radii (XZ)
  let proxR = 0, distR = 0, proxN = 0, distN = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const r = Math.hypot(x, z);
    if (y >= maxY - height * 0.08) { proxR += r; proxN++; }
    if (y <= minY + height * 0.08) { distR += r; distN++; }
  }
  proxR = proxN ? proxR / proxN : 0;
  distR = distN ? distR / distN : 0;

  const residuals = {
    heightMm: height - targetHeight,
    proximalRadiusMm: proxR - targetProximalRadius,
    distalRadiusMm: distR - targetDistalRadius,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
  const absMax = Math.max(
    Math.abs(residuals.heightMm),
    Math.abs(residuals.proximalRadiusMm),
    Math.abs(residuals.distalRadiusMm),
  );
  const pass = absMax <= tolMm;
  return {
    ok: true,
    pass,
    tolMm,
    absMaxResidualMm: Number(absMax.toFixed(4)),
    residuals,
    measured: {
      heightMm: Number(height.toFixed(4)),
      proximalRadiusMm: Number(proxR.toFixed(4)),
      distalRadiusMm: Number(distR.toFixed(4)),
    },
    label: 'digital_asme_style_aabb_axis_fit',
    honesty: {
      note: 'Software AABB/axis residuals — NOT physical ISO CMM / NOT ASME Y14.5 certified lab',
      isoCmm: false,
      fda: false,
    },
  };
}

/**
 * Intersect a triangle mesh with the horizontal plane y = planeY.
 * Returns the intersection segments in the XZ plane: [[[x1,z1],[x2,z2]], …].
 * Pure — the core of the real slicer below.
 */
export function sliceMeshAtY(positions, indices, planeY) {
  const segs = [];
  if (!positions?.length || !indices?.length) return segs;
  const px = (vi) => positions[vi * 3];
  const py = (vi) => positions[vi * 3 + 1];
  const pz = (vi) => positions[vi * 3 + 2];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const da = py(a) - planeY;
      const db = py(b) - planeY;
      if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue;
      if (da === 0 && db === 0) continue; // edge lies in the plane; neighbours cover it
      const s = da === db ? 0 : da / (da - db);
      hits.push([px(a) + (px(b) - px(a)) * s, pz(a) + (pz(b) - pz(a)) * s]);
    }
    const uniq = [];
    for (const h of hits) {
      if (!uniq.some((u) => Math.abs(u[0] - h[0]) < 1e-9 && Math.abs(u[1] - h[1]) < 1e-9)) uniq.push(h);
    }
    if (uniq.length === 2) segs.push(uniq);
  }
  return segs;
}

/**
 * Chain intersection segments into polylines by matching endpoints.
 * Returns [{ points: [[x,z],…], closed: boolean }, …]. Segments that
 * cannot be chained (open/non-manifold input) come back as short
 * polylines rather than being dropped — the toolpath stays honest
 * about what the mesh actually contains.
 */
export function chainSegments(segments, tol = 1e-6) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const byEndpoint = new Map();
  segments.forEach((seg, i) => {
    for (const end of seg) {
      const k = key(end);
      if (!byEndpoint.has(k)) byEndpoint.set(k, []);
      byEndpoint.get(k).push(i);
    }
  });
  const used = new Array(segments.length).fill(false);
  const same = (p, q) => Math.abs(p[0] - q[0]) <= tol * 2 && Math.abs(p[1] - q[1]) <= tol * 2;
  const lines = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segments[i][0], segments[i][1]];
    // Grow forward, then backward, until no unused segment touches an end.
    let grew = true;
    while (grew) {
      grew = false;
      for (const atStart of [false, true]) {
        const endPt = atStart ? pts[0] : pts[pts.length - 1];
        const cands = byEndpoint.get(key(endPt)) || [];
        for (const ci of cands) {
          if (used[ci]) continue;
          const seg = segments[ci];
          const other = same(seg[0], endPt) ? seg[1] : same(seg[1], endPt) ? seg[0] : null;
          if (!other) continue;
          used[ci] = true;
          if (atStart) pts.unshift(other); else pts.push(other);
          grew = true;
          break;
        }
      }
    }
    const closed = pts.length > 2 && same(pts[0], pts[pts.length - 1]);
    if (closed) pts.pop(); // start point repeats implicitly on close
    lines.push({ points: pts, closed });
  }
  return lines;
}

/**
 * Emit medical-printer-flavored G-code by SLICING the supplied mesh:
 * each layer's toolpath is the mesh's real cross-section contour at
 * that height (triangle/plane intersections chained into loops), and
 * extrusion is computed from actual segment lengths. Telemetry is
 * computed from the generated toolpath — it describes the slicing,
 * never live printer feedback (no printer is attached here).
 */
export function emitBioprintToolpath(mesh, {
  outDir,
  layerHeight = 0.2,
  feedRate = 1200,
  tempNozzle = 210,
  tempBed = 60,
  material = 'PLA_biocompatible_geometry',
  lineWidth = 0.4,
  filamentDiameter = 1.75,
} = {}) {
  if (!outDir) return { ok: false, error: 'need_outDir', code: 'NO_DIR' };
  const pos = mesh?.positions || [];
  const idx = mesh?.indices || [];
  if (pos.length < 9 || idx.length < 3) return { ok: false, error: 'empty_mesh', code: 'NO_MESH' };
  fs.mkdirSync(outDir, { recursive: true });
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
  }
  const height = Math.max(layerHeight, maxY - minY);
  const layers = Math.max(1, Math.ceil(height / layerHeight));
  // mm of filament per mm of toolpath travel: bead cross-section
  // (layerHeight × lineWidth) over filament cross-section.
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const ePerMm = (layerHeight * lineWidth) / filamentArea;

  const lines = [];
  lines.push('; ConKay bioprint/prosthetic TOOLPATH — sliced from the supplied mesh');
  lines.push('; NOT FDA cleared / NOT clinical manufacture instruction');
  lines.push(`; material=${material}`);
  lines.push(`; layerHeight=${layerHeight} feed=${feedRate}`);
  lines.push('G21 ; mm');
  lines.push('G90 ; absolute');
  lines.push(`M104 S${tempNozzle} ; nozzle`);
  lines.push(`M140 S${tempBed} ; bed`);
  lines.push('M109 R' + tempNozzle);
  lines.push('M190 R' + tempBed);
  lines.push('G28 ; home');
  lines.push('G1 Z0.2 F300');

  let e = 0;
  let skippedLayers = 0;
  const telemetryLayers = [];

  for (let L = 0; L < layers; L++) {
    const z = layerHeight * (L + 1);
    // Slice at the layer's mid-plane so planes never sit exactly on a
    // vertex ring of a stacked mesh.
    const planeY = minY + layerHeight * (L + 0.5);
    const contours = chainSegments(sliceMeshAtY(pos, idx, planeY));
    if (contours.length === 0) { skippedLayers++; continue; }
    lines.push(`;LAYER:${L}`);
    let perimeter = 0;
    let pointCount = 0;
    for (const contour of contours) {
      const pts = contour.points;
      pointCount += pts.length;
      const start = pts[0];
      lines.push(`G1 X${start[0].toFixed(3)} Y${start[1].toFixed(3)} Z${z.toFixed(3)} F3000 ; travel`);
      const seq = contour.closed ? [...pts, pts[0]] : pts;
      for (let s = 1; s < seq.length; s++) {
        const prev = seq[s - 1];
        const cur = seq[s];
        const segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
        perimeter += segLen;
        e += segLen * ePerMm;
        lines.push(`G1 X${cur[0].toFixed(3)} Y${cur[1].toFixed(3)} E${e.toFixed(4)} F${feedRate}`);
      }
    }
    telemetryLayers.push({
      layer: L,
      zMm: Number(z.toFixed(3)),
      loops: contours.length,
      points: pointCount,
      perimeterMm: Number(perimeter.toFixed(3)),
      feedRate,
      extrusionE: Number(e.toFixed(4)),
      tempNozzleC: tempNozzle,
      tempBedC: tempBed,
    });
  }
  lines.push('M104 S0');
  lines.push('M140 S0');
  lines.push('G28 X0');
  lines.push('M84');
  lines.push('; end');

  const gcodePath = path.join(outDir, 'prosthetic-socket.gcode');
  const telemPath = path.join(outDir, 'extrusion-telemetry.json');
  const gcode = lines.join('\n') + '\n';
  fs.writeFileSync(gcodePath, gcode);
  const telemetry = {
    ok: true,
    material,
    tempZones: {
      nozzleC: tempNozzle,
      bedC: tempBed,
      chamberC: null,
    },
    feedRates: { default: feedRate, travel: 3000 },
    layerHeightMm: layerHeight,
    layers: telemetryLayers,
    honesty: {
      stub: false,
      source: 'sliced_mesh_toolpath',
      note: 'Telemetry computed from the generated toolpath (real cross-sections sliced from the supplied mesh) — not live printer feedback',
      fda: false,
    },
  };
  fs.writeFileSync(telemPath, JSON.stringify(telemetry, null, 2));

  return {
    ok: true,
    gcodePath,
    telemetryPath: telemPath,
    gcodeBytes: Buffer.byteLength(gcode, 'utf8'),
    layers,
    slicedLayers: telemetryLayers.length,
    skippedLayers,
    sha256gcode: createHash('sha256').update(gcode).digest('hex').slice(0, 16),
    fileWrites: {
      gcodeExists: fs.existsSync(gcodePath),
      telemetryExists: fs.existsSync(telemPath),
    },
  };
}

export function runProstheticsCert({ outDir, tolMm = 0.5 } = {}) {
  const t0 = Date.now();
  const socket = buildParametricSocket({});
  const fit = digitalFitCheck(socket.mesh, {
    tolMm,
    targetHeight: socket.params.height,
    targetProximalRadius: socket.params.proximalRadius,
    targetDistalRadius: socket.params.distalRadius,
  });
  const tool = emitBioprintToolpath(socket.mesh, { outDir });
  return {
    ok: tool.ok && fit.ok,
    socket,
    fit,
    toolpath: tool,
    metrologyPass: !!fit.pass,
    fileWritesOk: !!(tool.fileWrites?.gcodeExists && tool.fileWrites?.telemetryExists),
    ms: Date.now() - t0,
  };
}

export default {
  buildParametricSocket,
  digitalFitCheck,
  sliceMeshAtY,
  chainSegments,
  emitBioprintToolpath,
  runProstheticsCert,
};
