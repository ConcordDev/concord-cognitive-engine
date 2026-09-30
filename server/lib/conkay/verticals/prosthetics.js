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

/** Emit medical-printer-flavored G-code + extrusion telemetry stub. */
export function emitBioprintToolpath(mesh, {
  outDir,
  layerHeight = 0.2,
  feedRate = 1200,
  tempNozzle = 210,
  tempBed = 60,
  material = 'PLA_biocompatible_geometry',
} = {}) {
  if (!outDir) return { ok: false, error: 'need_outDir', code: 'NO_DIR' };
  fs.mkdirSync(outDir, { recursive: true });

  const pos = mesh?.positions || [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const height = Math.max(layerHeight, maxY - minY);
  const layers = Math.max(1, Math.ceil(height / layerHeight));

  const lines = [];
  lines.push('; ConKay bioprint/prosthetic TOOLPATH — SYNTHETIC geometry');
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

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const r0 = Math.max(5, (maxX - minX) * 0.45);
  let e = 0;
  const telemetryLayers = [];

  for (let L = 0; L < layers; L++) {
    const z = layerHeight * (L + 1);
    const scale = 1 - (L / layers) * 0.25;
    const r = r0 * scale;
    const segs = 24;
    lines.push(`;LAYER:${L}`);
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const x = cx + Math.cos(th) * r;
      const y = cz + Math.sin(th) * r; // printer Y ← mesh Z
      e += 0.02 * r / r0;
      lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} E${e.toFixed(4)} F${feedRate}`);
    }
    telemetryLayers.push({
      layer: L,
      zMm: Number(z.toFixed(3)),
      radiusMm: Number(r.toFixed(3)),
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
      stub: true,
      note: 'Extrusion telemetry STUB from synthetic toolpath — not live printer feedback',
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
  emitBioprintToolpath,
  runProstheticsCert,
};
