// server/lib/conkay/material-library.js
// Wave 3 — small material library attachable to assembly parts (beyond FEA tint).

export const MATERIAL_LIBRARY = Object.freeze({
  steel: {
    id: 'steel',
    name: 'Structural steel',
    densityKgM3: 7850,
    youngsModulusPa: 200e9,
    color: '#94a3b8',
  },
  aluminum: {
    id: 'aluminum',
    name: 'Aluminum 6061',
    densityKgM3: 2700,
    youngsModulusPa: 69e9,
    color: '#cbd5e1',
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete',
    densityKgM3: 2400,
    youngsModulusPa: 30e9,
    color: '#a8a29e',
  },
  timber: {
    id: 'timber',
    name: 'Structural timber',
    densityKgM3: 500,
    youngsModulusPa: 11e9,
    color: '#b45309',
  },
  plastic: {
    id: 'plastic',
    name: 'ABS plastic',
    densityKgM3: 1040,
    youngsModulusPa: 2.3e9,
    color: '#67e8f9',
  },
});

export function listMaterials() {
  return Object.values(MATERIAL_LIBRARY);
}

export function resolveMaterial(idOrName) {
  const key = String(idOrName || '').trim().toLowerCase();
  if (!key) return null;
  if (MATERIAL_LIBRARY[key]) return MATERIAL_LIBRARY[key];
  const hit = Object.values(MATERIAL_LIBRARY).find(
    (m) => m.name.toLowerCase() === key || m.id === key,
  );
  return hit || null;
}

export function attachMaterialToPart(db, assemblyId, partId, materialId) {
  const mat = resolveMaterial(materialId);
  if (!mat) {
    return {
      ok: false,
      error: `unknown_material — need one of: ${Object.keys(MATERIAL_LIBRARY).join(', ')}`,
      code: 'UNKNOWN_MATERIAL',
    };
  }
  const row = db
    .prepare(`SELECT * FROM conkay_assembly_parts WHERE assembly_id = ? AND id = ?`)
    .get(assemblyId, partId);
  if (!row) return { ok: false, error: 'part_not_found', code: 'NOT_FOUND' };
  let meta = {};
  try {
    meta = row.meta_json ? JSON.parse(row.meta_json) : {};
  } catch {
    meta = {};
  }
  meta.materialLib = mat;
  const ts = new Date().toISOString();
  db.prepare(
    `UPDATE conkay_assembly_parts SET material = ?, meta_json = ?, updated_at = ? WHERE assembly_id = ? AND id = ?`,
  ).run(mat.id, JSON.stringify(meta), ts, assemblyId, partId);
  const updated = db
    .prepare(`SELECT * FROM conkay_assembly_parts WHERE assembly_id = ? AND id = ?`)
    .get(assemblyId, partId);
  return {
    ok: true,
    material: mat,
    partId,
    assemblyId,
    honesty: { wave: 3, note: 'Material library attach — not full FEM material model' },
  };
}
