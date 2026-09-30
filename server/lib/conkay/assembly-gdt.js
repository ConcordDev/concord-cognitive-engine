// server/lib/conkay/assembly-gdt.js
// GD&T drafting annotations + user dimensions stored on assembly meta.
// Honesty: feature control frames as drafting overlays — NOT CMM-certified GD&T solver.

import { randomUUID } from 'crypto';
import { getAssembly, updateAssemblyMeta } from './assembly-store.js';
import { GDT_SYMBOLS, resolveGdtSymbol } from './assembly-drawing.js';

function readList(asm, key) {
  const arr = asm?.meta?.[key];
  return Array.isArray(arr) ? arr : [];
}

export function listGdt(db, assemblyId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  return {
    ok: true,
    assemblyId,
    gdt: readList(asm, 'gdt'),
    symbols: GDT_SYMBOLS,
    honesty: {
      note: 'Drafting feature control frames on projected views — NOT CMM-certified GD&T solver',
    },
  };
}

export function addGdt(db, assemblyId, body = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const symbol = resolveGdtSymbol(body.symbol || body.type || 'position');
  const ann = {
    id: randomUUID(),
    symbol,
    tolerance: body.tolerance != null ? String(body.tolerance) : '',
    datums: Array.isArray(body.datums) ? body.datums.map(String) : body.datum ? [String(body.datum)] : [],
    view: body.view || 'front',
    anchor: {
      u: Number(body.anchor?.u ?? body.u ?? 0) || 0,
      v: Number(body.anchor?.v ?? body.v ?? 0) || 0,
    },
    partId: body.partId || null,
    note: body.note || null,
    createdAt: new Date().toISOString(),
  };
  const gdt = [...readList(asm, 'gdt'), ann];
  const out = updateAssemblyMeta(db, assemblyId, { gdt });
  if (!out.ok) return out;
  return {
    ok: true,
    annotation: ann,
    gdt,
    honesty: {
      note: 'Drafting annotation stored on assembly meta — NOT CMM-certified GD&T solver',
    },
  };
}

export function updateGdt(db, assemblyId, annId, patch = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const gdt = readList(asm, 'gdt');
  const idx = gdt.findIndex((a) => a.id === annId);
  if (idx < 0) return { ok: false, error: 'annotation_not_found', code: 'NOT_FOUND' };
  const prev = gdt[idx];
  const next = {
    ...prev,
    ...patch,
    id: prev.id,
    symbol: patch.symbol != null ? resolveGdtSymbol(patch.symbol) : prev.symbol,
    datums: patch.datums != null ? patch.datums.map(String) : prev.datums,
    anchor:
      patch.anchor || patch.u != null || patch.v != null
        ? {
            u: Number(patch.anchor?.u ?? patch.u ?? prev.anchor?.u ?? 0) || 0,
            v: Number(patch.anchor?.v ?? patch.v ?? prev.anchor?.v ?? 0) || 0,
          }
        : prev.anchor,
    updatedAt: new Date().toISOString(),
  };
  gdt[idx] = next;
  const out = updateAssemblyMeta(db, assemblyId, { gdt });
  if (!out.ok) return out;
  return { ok: true, annotation: next, gdt };
}

export function removeGdt(db, assemblyId, annId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const prev = readList(asm, 'gdt');
  const gdt = prev.filter((a) => a.id !== annId);
  if (gdt.length === prev.length) return { ok: false, error: 'annotation_not_found', code: 'NOT_FOUND' };
  const out = updateAssemblyMeta(db, assemblyId, { gdt });
  if (!out.ok) return out;
  return { ok: true, removed: annId, gdt };
}

export function listDimensions(db, assemblyId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  return {
    ok: true,
    assemblyId,
    dimensions: readList(asm, 'dimensions'),
    honesty: { note: 'User dimensions in model/view space — overall auto dims computed at draw time' },
  };
}

export function addDimension(db, assemblyId, body = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const x1 = Number(body.x1);
  const y1 = Number(body.y1);
  const x2 = Number(body.x2);
  const y2 = Number(body.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return { ok: false, error: 'need_numeric_x1_y1_x2_y2', code: 'BAD_DIM' };
  }
  const value = Math.hypot(x2 - x1, y2 - y1);
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3)).replace(/\.?0+$/, '') || '0';
  const dim = {
    id: randomUUID(),
    kind: 'user',
    view: body.view || 'front',
    x1,
    y1,
    x2,
    y2,
    value,
    label: body.label != null ? String(body.label) : fmt(value),
    partId: body.partId || null,
    auto: false,
    createdAt: new Date().toISOString(),
  };
  const dimensions = [...readList(asm, 'dimensions'), dim];
  const out = updateAssemblyMeta(db, assemblyId, { dimensions });
  if (!out.ok) return out;
  return { ok: true, dimension: dim, dimensions };
}

export function removeDimension(db, assemblyId, dimId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const prev = readList(asm, 'dimensions');
  const dimensions = prev.filter((d) => d.id !== dimId);
  if (dimensions.length === prev.length) return { ok: false, error: 'dimension_not_found', code: 'NOT_FOUND' };
  const out = updateAssemblyMeta(db, assemblyId, { dimensions });
  if (!out.ok) return out;
  return { ok: true, removed: dimId, dimensions };
}

/**
 * Gate D — geometry verification harness (NOT ISO CMM lab certification).
 * Delegates measured value to OCC measure when features/kind available; else bbox from mesh.
 */
export async function verifyGeometryCallout(db, assemblyId, body = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const callout = body.callout || body.gdt || body;
  let features = body.features || null;
  if (!features && body.partId) {
    const { getPart } = await import('./assembly-store.js');
    const part = getPart(db, assemblyId, body.partId);
    features = part?.meta?.featureTree || null;
  }
  try {
    const { measureGeometry } = await import('./occ-bridge.js');
    const measured = await measureGeometry({
      features: features || undefined,
      kind: body.kind,
      params: body.params,
      partId: body.occPartId || body.featurePartId,
      callout,
    });
    if (measured?.ok) {
      return {
        ...measured,
        assemblyId,
        honesty: {
          harness: 'geometry verification harness',
          note: 'Measured from OCC solid/feature geometry vs callout ±tol. NOT ISO CMM lab certification.',
        },
      };
    }
    return measured;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      honesty: {
        harness: 'geometry verification harness',
        note: 'NOT ISO CMM lab certification',
      },
    };
  }
}
