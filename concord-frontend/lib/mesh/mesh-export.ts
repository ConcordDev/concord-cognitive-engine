/** STL, GLB, and faceted STEP at the viewer's millimetre coordinates. */

import { STEP_EXPORT } from './engineering-view';

const textEncoder = new TextEncoder();

export function meshToStl(positions: number[], indices: number[]): ArrayBuffer {
  const tris = Math.floor(indices.length / 3);
  const buf = new ArrayBuffer(84 + 50 * tris);
  const view = new DataView(buf);
  const header = 'Concord STL millimetres';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, tris, true);
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    view.setFloat32(o + 12, ax, true); view.setFloat32(o + 16, ay, true); view.setFloat32(o + 20, az, true);
    view.setFloat32(o + 24, bx, true); view.setFloat32(o + 28, by, true); view.setFloat32(o + 32, bz, true);
    view.setFloat32(o + 36, cx, true); view.setFloat32(o + 40, cy, true); view.setFloat32(o + 44, cz, true);
    view.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buf;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function bounds(positions: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** One named mesh. Positions are already in the file unit (millimetres for CAD). */
export function meshToGlb(positions: number[], indices: number[], nodeName = 'mesh'): Uint8Array {
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const { min, max } = bounds(positions);
  const binBytes = pos.byteLength + idx.byteLength;
  const json = {
    asset: { version: '2.0', generator: 'concord-mesh-export' },
    scene: 0,
    scenes: [{ nodes: [0], extras: { units: 'mm', metersPerUnit: 0.001, concord: 'conkay-cad' } }],
    nodes: [{ name: nodeName, mesh: 0 }],
    meshes: [{ name: nodeName, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, byteOffset: 0, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binBytes }],
  };
  let jsonText = JSON.stringify(json);
  const jsonPad = pad4(jsonText.length) - jsonText.length;
  jsonText += ' '.repeat(jsonPad);
  const jsonBytes = textEncoder.encode(jsonText);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binAt = 20 + jsonBytes.length;
  view.setUint32(binAt, binBytes, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(new Uint8Array(pos.buffer), binAt + 8);
  out.set(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), binAt + 8 + pos.byteLength);
  return out;
}

/**
 * Faceted triangle STEP in millimetres. This is not a B-rep solid.
 * The note is part of the file header so it is visible in the text.
 */
export function meshToStep(positions: number[], indices: number[]): string {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${STEP_EXPORT.note}'),'2;1');`,
    "FILE_NAME('concord-faceted.stp','',('Concord'),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    '#1=SI_UNIT(.MILLI.,.METRE.);',
    '#2=FACETED_BREP(\'Concord faceted body\',());',
  ];
  let id = 10;
  const tris = Math.floor(indices.length / 3);
  for (let t = 0; t < Math.min(tris, 20000); t++) {
    const coords = [0, 1, 2].map((k) => {
      const i = indices[t * 3 + k] * 3;
      return `(${positions[i]},${positions[i + 1]},${positions[i + 2]})`;
    });
    lines.push(`#${id}=CARTESIAN_POINT('',${coords[0]});`);
    id += 1;
  }
  lines.push('ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}
