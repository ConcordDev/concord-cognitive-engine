// server/lib/conkay/erp-bom.js
// ERP-shaped BOM export beyond basic Wave-2 JSON.
// Honesty: ERP-shaped BOM export LIVE — NOT SAP/Oracle/NetSuite integration.

import { buildBom } from './assembly-export.js';
import { getPart } from './assembly-store.js';
import { resolveMaterial } from './material-library.js';

/**
 * Vendor price source (Q45/A#28/B#27). Costs in a BOM come ONLY from
 * real data the caller supplies — an imported vendor price list
 * (opts.priceList: array of rows, a JSON string, or CSV text) or a
 * per-part override in part.meta.erp. There is deliberately NO
 * built-in $/kg table: a line with no price source is reported
 * `unpriced` with a null cost instead of a hard-coded estimate.
 *
 * Price-list row shape (all fields optional except a price):
 *   partNumber   — matches a BOM line's part number (unit price)
 *   material     — material id the row prices (per-kg rate and/or
 *                  vendor defaults for that material)
 *   unitCostUsd  — price per unit (partNumber rows)
 *   costPerKgUsd — price per kg (material rows)
 *   vendorId, vendorName, leadTimeDays — vendor defaults for matches
 */
export function parseVendorPriceList(input) {
  if (input == null) return { rows: [], errors: [] };
  let rawRows = null;
  if (Array.isArray(input)) rawRows = input;
  else if (typeof input === "string") {
    const text = input.trim();
    if (!text) return { rows: [], errors: [] };
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        rawRows = Array.isArray(parsed) ? parsed : parsed?.rows || parsed?.prices || null;
      } catch (e) { return { rows: [], errors: [`price list JSON did not parse: ${e.message}`] }; }
    } else {
      rawRows = parsePriceListCsv(text);
      if (!rawRows) return { rows: [], errors: ["price list CSV needs a header row (partNumber, material, unitCostUsd, costPerKgUsd, …)"] };
    }
  }
  if (!Array.isArray(rawRows)) return { rows: [], errors: ["price list must be an array of rows, JSON, or CSV text"] };
  const rows = [];
  const errors = [];
  rawRows.forEach((r, i) => {
    if (!r || typeof r !== "object") { errors.push(`row ${i + 1}: not an object`); return; }
    const num = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const row = {
      partNumber: r.partNumber ? String(r.partNumber) : null,
      material: r.material ? String(r.material).toLowerCase() : null,
      unitCostUsd: num(r.unitCostUsd),
      costPerKgUsd: num(r.costPerKgUsd ?? r.costPerKg ?? r.usdPerKg),
      vendorId: r.vendorId ? String(r.vendorId) : null,
      vendorName: r.vendorName ? String(r.vendorName) : null,
      leadTimeDays: num(r.leadTimeDays),
    };
    if (!row.partNumber && !row.material) { errors.push(`row ${i + 1}: needs partNumber or material`); return; }
    if (row.unitCostUsd == null && row.costPerKgUsd == null && !row.vendorId && !row.vendorName && row.leadTimeDays == null) {
      errors.push(`row ${i + 1}: carries no price or vendor data`);
      return;
    }
    rows.push(row);
  });
  return { rows, errors };
}

function parsePriceListCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 1) return null;
  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  if (!headers.some((h) => ["partNumber", "material", "unitCostUsd", "costPerKgUsd"].includes(h))) return null;
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { if (cells[i] !== undefined && cells[i] !== "") row[h] = cells[i]; });
    return row;
  });
}

function indexPriceRows(rows) {
  const byPartNumber = new Map();
  const byMaterial = new Map();
  for (const row of rows) {
    if (row.partNumber && !byPartNumber.has(row.partNumber)) byPartNumber.set(row.partNumber, row);
    if (row.material && !byMaterial.has(row.material)) byMaterial.set(row.material, row);
  }
  return { byPartNumber, byMaterial };
}

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
  // No stand-in density: a part whose material isn't known has no mass, and
  // the BOM says why, instead of weighing it as 1000 kg/m³.
  const mat = resolveMaterial(matId) || { id: String(matId).toLowerCase(), name: String(matId), densityKgM3: null };
  const rawDensity = Number(mat.densityKgM3 || part.meta?.materialLib?.densityKgM3);
  const density = Number.isFinite(rawDensity) && rawDensity > 0 ? rawDensity : null;
  const fromOcc = occBboxVolumeM3(part.meta);
  const fromMesh = meshAabbVolumeM3(part.mesh, part.transform);
  const fromIntent = intentVolumeM3(part.meta?.intent);
  const vol = fromOcc || fromMesh || fromIntent || { volumeM3: null, source: 'unavailable' };
  const volumeM3 = vol.volumeM3 == null ? null : Number(vol.volumeM3);
  const massKg = volumeM3 == null || density == null ? null : volumeM3 * density;
  return {
    ...(density == null ? { massUnavailable: `no density for material "${matId}"` } : {}),
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

function vendorFor(part, priceIdx, massProps, partNumber) {
  const erp = part.meta?.erp || {};
  const partRow = priceIdx.byPartNumber.get(partNumber) || null;
  const matRow = priceIdx.byMaterial.get(massProps.materialId) || null;
  const pick = (...vals) => vals.find((v) => v != null && v !== "") ?? null;
  return {
    partRow,
    matRow,
    vendorId: pick(erp.vendorId, partRow?.vendorId, matRow?.vendorId),
    vendorName: pick(erp.vendorName, partRow?.vendorName, matRow?.vendorName),
    leadTimeDays: pick(
      Number.isFinite(Number(erp.leadTimeDays)) && erp.leadTimeDays != null ? Number(erp.leadTimeDays) : null,
      partRow?.leadTimeDays, matRow?.leadTimeDays),
    unitCostUsdOverride: erp.unitCostUsd != null && Number.isFinite(Number(erp.unitCostUsd)) ? Number(erp.unitCostUsd) : null,
  };
}

/**
 * ERP-shaped BOM: part numbers, revisions, qty, material, mass/volume,
 * vendor + cost data from an imported price list or per-part
 * overrides only (see parseVendorPriceList). NOT SAP/Oracle.
 *
 * opts.priceList — array of rows | JSON string | CSV text.
 */
export function buildErpBom(db, assemblyId, opts = {}) {
  const base = buildBom(db, assemblyId);
  if (!base.ok) return base;
  const overheadPct = Number.isFinite(Number(opts.overheadPct)) ? Number(opts.overheadPct) : 0.15;
  const priceList = parseVendorPriceList(opts.priceList);
  const priceIdx = indexPriceRows(priceList.rows);
  const lines = [];
  let totalMassKg = 0;
  let totalMaterialCostUsd = 0;
  let massKnown = 0;
  let pricedLines = 0;

  for (const p of base.parts) {
    const full = getPart(db, assemblyId, p.id) || p;
    const massProps = estimatePartMassProps(full);
    const partNumber = partNumberFor(full);
    const vendor = vendorFor(full, priceIdx, massProps, partNumber);
    const qty = Number(full.meta?.erp?.qty || p.qty || 1) || 1;
    // Cost resolution, in precedence order. No source → unpriced.
    let unitCostUsd = null;
    let costBasis = 'unpriced';
    if (vendor.partRow?.unitCostUsd != null) {
      unitCostUsd = vendor.partRow.unitCostUsd;
      costBasis = 'vendor_price_list';
    } else if (vendor.unitCostUsdOverride != null) {
      unitCostUsd = vendor.unitCostUsdOverride;
      costBasis = 'part_override';
    } else if (vendor.matRow?.costPerKgUsd != null && massProps.massKg != null) {
      unitCostUsd = massProps.massKg * vendor.matRow.costPerKgUsd;
      costBasis = 'vendor_price_list_rate';
    }
    const extendedCostUsd = unitCostUsd == null ? null : unitCostUsd * qty;
    if (unitCostUsd != null) pricedLines += 1;
    if (massProps.massKg != null) {
      totalMassKg += massProps.massKg * qty;
      massKnown += 1;
    }
    if (extendedCostUsd != null) totalMaterialCostUsd += extendedCostUsd;

    const tri =
      full.mesh?.triangleCount ??
      (full.mesh?.indices?.length ? Math.floor(full.mesh.indices.length / 3) : null);

    lines.push({
      partNumber,
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
      costBasis,
      hasMesh: !!(full.mesh?.positions?.length),
      advanced_brep: !!full.meta?.advanced_brep,
      triangleCount: tri,
    });
  }

  const overheadUsd = totalMaterialCostUsd * overheadPct;
  const rollupCostUsd = totalMaterialCostUsd + overheadUsd;
  const unpricedLines = lines.length - pricedLines;

  return {
    ok: true,
    schema: 'conkay.erp-bom.v1',
    assemblyId: base.assemblyId,
    assemblyName: base.assemblyName,
    totalParts: base.totalParts,
    lines,
    priceList: { rows: priceList.rows.length, errors: priceList.errors },
    rollup: {
      totalMassKg: massKnown ? totalMassKg : null,
      massLinesKnown: massKnown,
      materialCostUsd: totalMaterialCostUsd,
      pricedLines,
      unpricedLines,
      overheadPct,
      overheadUsd,
      rollupCostUsd,
      currency: 'USD',
    },
    exports: { json: true, csv: true },
    honesty: {
      wave: 'ERP-BOM',
      status: 'LIVE',
      note: 'ERP-shaped BOM export LIVE — part numbers, revisions, qty, material, mass/volume estimates, CSV+JSON. Costs and vendors come only from an imported vendor price list or per-part overrides; lines without a price source are unpriced (null cost), never estimated from hard-coded rates.',
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
  rows.push(`# rollup.pricedLines,${erpBom.rollup?.pricedLines ?? ''}`);
  rows.push(`# rollup.unpricedLines,${erpBom.rollup?.unpricedLines ?? ''}`);
  rows.push('# honesty,ERP-shaped BOM export LIVE — not SAP/Oracle');
  return {
    ok: true,
    csv: `${rows.join('\n')}\n`,
    filename: `conkay-erp-bom-${String(erpBom.assemblyId || 'asm').slice(0, 8)}.csv`,
  };
}

export default { buildErpBom, erpBomToCsv, estimatePartMassProps, parseVendorPriceList };
