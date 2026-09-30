// server/lib/conkay/erp-bom.js
// ERP-shaped BOM export beyond basic Wave-2 JSON.
// Honesty: ERP-shaped BOM export LIVE — NOT SAP/Oracle/NetSuite integration.

import { buildBom } from './assembly-export.js';
import { getPart } from './assembly-store.js';
import { resolveMaterial } from './material-library.js';

/** Stub unit costs ($/kg) for rollup — NOT live vendor pricing. */
export const MATERIAL_COST_USD_PER_KG = Object.freeze({
  steel: 0.85,
  aluminum: 2.4,
  concrete: 0.12,
  timber: 1.1,
  plastic: 1.8,
  unspecified: 1.0,
});

function meshAabbVolumeM3(mesh, transform) {
  const p = mesh?.positions;
  if (!p?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const scl = transform?.scale || { x: 1, y: 1, z: 1 };
  for (let i = 0; i < p.length; i += 3) {
    const x = Number(p[i]) * (scl.x ?? 1);
    const y = Number(p[i + 1]) * (scl.y ?? 1);
    const z = Number(p[i + 2]) * (scl.z ?? 1);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const dx = Math.max(0, maxX - minX);
  const dy = Math.max(0, maxY - minY);
  const dz = Math.max(0, maxZ - minZ);
  return {
    volumeM3: dx * dy * dz,
    bbox: { dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ },
    source: 'mesh_aabb',
  };
}

function intentVolumeM3(intent) {
  if (!intent || typeof intent !== 'object') return null;
  const dx = Number(intent.width || intent.dx || intent.x);
  const dy = Number(intent.depth || intent.dy || intent.y);
  const dz = Number(intent.height || intent.dz || intent.z || intent.length || intent.h);
  const r = Number(intent.radius || intent.r);
  const h = Number(intent.height || intent.h || intent.length);
  if (Number.isFinite(r) && Number.isFinite(h) && r > 0 && h > 0) {
    return { volumeM3: Math.PI * r * r * h, source: 'intent_cylinder' };
  }
  if ([dx, dy, dz].every((n) => Number.isFinite(n) && n > 0)) {
    return { volumeM3: dx * dy * dz, source: 'intent_box' };
  }
  return null;
}

function occBboxVolumeM3(meta) {
  const bb = meta?.bbox;
  if (!bb) return null;
  const dx = Number(bb.dx ?? (bb.maxX - bb.minX));
  const dy = Number(bb.dy ?? (bb.maxY - bb.minY));
  const dz = Number(bb.dz ?? (bb.maxZ - bb.minZ));
  if (![dx, dy, dz].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { volumeM3: dx * dy * dz, bbox: { dx, dy, dz, ...bb }, source: 'occ_bbox' };
}

export function estimatePartMassProps(part) {
  const matId = part.material || part.meta?.intent?.material || part.meta?.materialLib?.id || 'unspecified';
  const mat = resolveMaterial(matId) || {
    id: String(matId).toLowerCase(),
    name: String(matId),
    densityKgM3: 1000,
  };
  const density = Number(mat.densityKgM3 || part.meta?.materialLib?.densityKgM3 || 1000);
  const fromOcc = occBboxVolumeM3(part.meta);
  const fromMesh = meshAabbVolumeM3(part.mesh, part.transform);
  const fromIntent = intentVolumeM3(part.meta?.intent);
  const vol = fromOcc || fromMesh || fromIntent || { volumeM3: null, source: 'unavailable' };
  const volumeM3 = vol.volumeM3 == null ? null : Number(vol.volumeM3);
  const massKg = volumeM3 == null ? null : volumeM3 * density;
  return {
    materialId: mat.id,
    materialName: mat.name || mat.id,
    densityKgM3: density,
    volumeM3,
    massKg,
    volumeSource: vol.source,
    bbox: vol.bbox || null,
  };
}

function partNumberFor(part) {
  if (part.meta?.partNumber) return String(part.meta.partNumber);
  if (part.meta?.erp?.partNumber) return String(part.meta.erp.partNumber);
  const kind = String(part.kind || 'part').replace(/[^\w]+/g, '-').slice(0, 24);
  return `CK-${kind}-${String(part.id).slice(0, 8)}`.toUpperCase();
}

function revisionFor(part) {
  return String(part.meta?.revision || part.meta?.erp?.revision || 'A');
}

function vendorStubFor(part) {
  const erp = part.meta?.erp || {};
  return {
    vendorId: erp.vendorId || 'STUB-VENDOR',
    vendorName: erp.vendorName || 'Stub Industrial Supply',
    leadTimeDays: Number.isFinite(Number(erp.leadTimeDays)) ? Number(erp.leadTimeDays) : 14,
    unitCostUsdOverride: erp.unitCostUsd != null ? Number(erp.unitCostUsd) : null,
  };
}

/**
 * ERP-shaped BOM: part numbers, revisions, qty, material, mass/volume,
 * vendor stubs, rollup cost stub. NOT SAP/Oracle.
 */
export function buildErpBom(db, assemblyId, opts = {}) {
  const base = buildBom(db, assemblyId);
  if (!base.ok) return base;
  const overheadPct = Number.isFinite(Number(opts.overheadPct)) ? Number(opts.overheadPct) : 0.15;
  const lines = [];
  let totalMassKg = 0;
  let totalMaterialCostUsd = 0;
  let massKnown = 0;

  for (const p of base.parts) {
    const full = getPart(db, assemblyId, p.id) || p;
    const massProps = estimatePartMassProps(full);
    const vendor = vendorStubFor(full);
    const qty = Number(full.meta?.erp?.qty || p.qty || 1) || 1;
    const costPerKg =
      MATERIAL_COST_USD_PER_KG[massProps.materialId] ?? MATERIAL_COST_USD_PER_KG.unspecified;
    const unitCostUsd =
      vendor.unitCostUsdOverride != null && Number.isFinite(vendor.unitCostUsdOverride)
        ? vendor.unitCostUsdOverride
        : massProps.massKg == null
          ? null
          : massProps.massKg * costPerKg;
    const extendedCostUsd = unitCostUsd == null ? null : unitCostUsd * qty;
    if (massProps.massKg != null) {
      totalMassKg += massProps.massKg * qty;
      massKnown += 1;
    }
    if (extendedCostUsd != null) totalMaterialCostUsd += extendedCostUsd;

    const tri =
      full.mesh?.triangleCount ??
      (full.mesh?.indices?.length ? Math.floor(full.mesh.indices.length / 3) : null);

    lines.push({
      partNumber: partNumberFor(full),
      revision: revisionFor(full),
      name: full.name || p.name,
      partId: full.id || p.id,
      kind: full.kind || p.kind,
      qty,
      uom: full.meta?.erp?.uom || 'EA',
      material: massProps.materialId,
      materialName: massProps.materialName,
      densityKgM3: massProps.densityKgM3,
      volumeM3: massProps.volumeM3,
      massKg: massProps.massKg,
      volumeSource: massProps.volumeSource,
      vendorId: vendor.vendorId,
      vendorName: vendor.vendorName,
      leadTimeDays: vendor.leadTimeDays,
      unitCostUsd,
      extendedCostUsd,
      costBasis:
        vendor.unitCostUsdOverride != null ? 'vendor_override_stub' : 'mass_x_material_rate_stub',
      hasMesh: !!(full.mesh?.positions?.length),
      advanced_brep: !!full.meta?.advanced_brep,
      triangleCount: tri,
    });
  }

  const overheadUsd = totalMaterialCostUsd * overheadPct;
  const rollupCostUsd = totalMaterialCostUsd + overheadUsd;

  return {
    ok: true,
    schema: 'conkay.erp-bom.v1',
    assemblyId: base.assemblyId,
    assemblyName: base.assemblyName,
    totalParts: base.totalParts,
    lines,
    rollup: {
      totalMassKg: massKnown ? totalMassKg : null,
      massLinesKnown: massKnown,
      materialCostUsd: totalMaterialCostUsd,
      overheadPct,
      overheadUsd,
      rollupCostUsd,
      currency: 'USD',
    },
    exports: { json: true, csv: true },
    honesty: {
      wave: 'ERP-BOM',
      status: 'LIVE',
      note: 'ERP-shaped BOM export LIVE — part numbers, revisions, qty, material, mass/volume estimates, vendor stubs, CSV+JSON, rollup cost stub.',
      not: 'SAP / Oracle / NetSuite / live vendor EDI / ISO weighing',
      volumeNote:
        'Volume from OCC bbox when present, else mesh AABB, else intent dims — not CAD kernel mass props API.',
    },
  };
}

/** CSV string for ERP BOM lines (+ rollup footer as comments). */
export function erpBomToCsv(erpBom) {
  if (!erpBom?.ok) return { ok: false, reason: erpBom?.reason || 'bad_bom' };
  const headers = [
    'partNumber',
    'revision',
    'name',
    'partId',
    'kind',
    'qty',
    'uom',
    'material',
    'materialName',
    'densityKgM3',
    'volumeM3',
    'massKg',
    'volumeSource',
    'vendorId',
    'vendorName',
    'leadTimeDays',
    'unitCostUsd',
    'extendedCostUsd',
    'costBasis',
    'triangleCount',
    'advanced_brep',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [headers.join(',')];
  for (const line of erpBom.lines || []) {
    rows.push(headers.map((h) => esc(line[h])).join(','));
  }
  rows.push('');
  rows.push(`# rollup.materialCostUsd,${erpBom.rollup?.materialCostUsd ?? ''}`);
  rows.push(`# rollup.overheadPct,${erpBom.rollup?.overheadPct ?? ''}`);
  rows.push(`# rollup.overheadUsd,${erpBom.rollup?.overheadUsd ?? ''}`);
  rows.push(`# rollup.rollupCostUsd,${erpBom.rollup?.rollupCostUsd ?? ''}`);
  rows.push(`# rollup.totalMassKg,${erpBom.rollup?.totalMassKg ?? ''}`);
  rows.push('# honesty,ERP-shaped BOM export LIVE — not SAP/Oracle');
  return {
    ok: true,
    csv: `${rows.join('\n')}\n`,
    filename: `conkay-erp-bom-${String(erpBom.assemblyId || 'asm').slice(0, 8)}.csv`,
  };
}

export default { buildErpBom, erpBomToCsv, estimatePartMassProps, MATERIAL_COST_USD_PER_KG };
