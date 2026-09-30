// server/lib/conkay/assembly-drawing.js
// Orthographic 2D drawing views from triangle meshes (front/top/side).
// Dimensions + GD&T annotation overlays + multi-page PDF pack.
// Honesty: projected line segments / drafting-style annotations on views —
// NOT industrial drafting CAD / CMM-certified GD&T solver / OCC sheets.

import { listParts, getAssembly } from './assembly-store.js';
import { buildBom } from './assembly-export.js';
import PDFDocument from 'pdfkit';

function applyTransformToPositions(positions, transform) {
  const pos = transform?.position || { x: 0, y: 0, z: 0 };
  const scl = transform?.scale || { x: 1, y: 1, z: 1 };
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * (scl.x ?? 1) + (pos.x ?? 0);
    out[i + 1] = positions[i + 1] * (scl.y ?? 1) + (pos.y ?? 0);
    out[i + 2] = positions[i + 2] * (scl.z ?? 1) + (pos.z ?? 0);
  }
  return out;
}

/** Project 3D → 2D for orthographic views. */
export function projectPoint(x, y, z, view) {
  switch (view) {
    case 'front':
      return { u: x, v: y };
    case 'top':
      return { u: x, v: -z };
    case 'side':
      return { u: z, v: y };
    default:
      return { u: x, v: y };
  }
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Extract unique triangle edges (wireframe). Optional silhouette: edges with face count === 1.
 */
export function projectMeshView(positions, indices, view = 'front', { silhouette = true } = {}) {
  const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const idx = indices;
  const faceCount = new Map();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = edgeKey(i, j);
      faceCount.set(k, (faceCount.get(k) || 0) + 1);
    }
  }

  const segments = [];
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;

  for (const [k, count] of faceCount) {
    if (silhouette && count > 1) continue;
    const [ia, ib] = k.split('|').map(Number);
    const ax = pos[ia * 3];
    const ay = pos[ia * 3 + 1];
    const az = pos[ia * 3 + 2];
    const bx = pos[ib * 3];
    const by = pos[ib * 3 + 1];
    const bz = pos[ib * 3 + 2];
    const p1 = projectPoint(ax, ay, az, view);
    const p2 = projectPoint(bx, by, bz, view);
    segments.push({ x1: p1.u, y1: p1.v, x2: p2.u, y2: p2.v });
    minU = Math.min(minU, p1.u, p2.u);
    minV = Math.min(minV, p1.v, p2.v);
    maxU = Math.max(maxU, p1.u, p2.u);
    maxV = Math.max(maxV, p1.v, p2.v);
  }

  if (!segments.length) {
    for (const [k] of faceCount) {
      const [ia, ib] = k.split('|').map(Number);
      const ax = pos[ia * 3];
      const ay = pos[ia * 3 + 1];
      const az = pos[ia * 3 + 2];
      const bx = pos[ib * 3];
      const by = pos[ib * 3 + 1];
      const bz = pos[ib * 3 + 2];
      const p1 = projectPoint(ax, ay, az, view);
      const p2 = projectPoint(bx, by, bz, view);
      segments.push({ x1: p1.u, y1: p1.v, x2: p2.u, y2: p2.v });
      minU = Math.min(minU, p1.u, p2.u);
      minV = Math.min(minV, p1.v, p2.v);
      maxU = Math.max(maxU, p1.u, p2.u);
      maxV = Math.max(maxV, p1.v, p2.v);
    }
  }

  if (!Number.isFinite(minU)) {
    minU = 0;
    minV = 0;
    maxU = 1;
    maxV = 1;
  }

  return {
    view,
    segments,
    bounds: { minU, minV, maxU, maxV },
    edgeCount: segments.length,
    mode: silhouette && faceCount.size && [...faceCount.values()].some((c) => c === 1) ? 'silhouette' : 'wireframe',
  };
}


/**
 * Gate E — pull dimensions from solid feature params when present.
 * box → dx/dy/dz; cylinder → diameter + height; extrude → distance.
 */
export function buildFeatureDimensions(features, view = 'front', { origin = { x: 0, y: 0 } } = {}) {
  if (!Array.isArray(features) || !features.length) return [];
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3)).replace(/\.?0+$/, '') || '0';
  const dims = [];
  let cursor = 0;
  for (const f of features) {
    const type = String(f.type || f.op || f.kind || '').toLowerCase();
    const params = f.params || f;
    const idBase = f.id || `feat-${cursor}`;
    if (type === 'box' || type === 'cube' || type === 'beam' || type === 'rect') {
      const dx = Number(params.dx || params.width || 0);
      const dy = Number(params.dy || params.depth || 0);
      const dz = Number(params.dz || params.height || 0);
      if (view === 'front' || view === 'top') {
        if (dx > 0) {
          dims.push({
            id: `${idBase}-dx`,
            kind: 'feature',
            featureType: 'box',
            axis: 'x',
            view,
            x1: origin.x,
            y1: origin.y - 8 - cursor * 6,
            x2: origin.x + dx,
            y2: origin.y - 8 - cursor * 6,
            value: dx,
            label: `box.dx ${fmt(dx)}`,
            auto: true,
            fromFeature: true,
          });
        }
      }
      if (view === 'front' || view === 'side') {
        const vspan = view === 'side' ? dy : dz;
        const label = view === 'side' ? 'box.dy' : 'box.dz';
        if (vspan > 0) {
          dims.push({
            id: `${idBase}-dv`,
            kind: 'feature',
            featureType: 'box',
            axis: 'y',
            view,
            x1: origin.x - 8 - cursor * 6,
            y1: origin.y,
            x2: origin.x - 8 - cursor * 6,
            y2: origin.y + vspan,
            value: vspan,
            label: `${label} ${fmt(vspan)}`,
            auto: true,
            fromFeature: true,
          });
        }
      }
    } else if (type === 'cylinder' || type === 'cyl') {
      const r = Number(params.r || params.radius || 0);
      const h = Number(params.h || params.height || 0);
      if (r > 0) {
        dims.push({
          id: `${idBase}-dia`,
          kind: 'feature',
          featureType: 'cylinder',
          axis: 'x',
          view,
          x1: origin.x,
          y1: origin.y + h + 6 + cursor * 4,
          x2: origin.x + 2 * r,
          y2: origin.y + h + 6 + cursor * 4,
          value: 2 * r,
          label: `⌀${fmt(2 * r)}`,
          auto: true,
          fromFeature: true,
        });
      }
      if (h > 0 && (view === 'front' || view === 'side')) {
        dims.push({
          id: `${idBase}-h`,
          kind: 'feature',
          featureType: 'cylinder',
          axis: 'y',
          view,
          x1: origin.x + 2 * r + 6,
          y1: origin.y,
          x2: origin.x + 2 * r + 6,
          y2: origin.y + h,
          value: h,
          label: `cyl.h ${fmt(h)}`,
          auto: true,
          fromFeature: true,
        });
      }
    } else if (type === 'extrude' || type === 'pad') {
      const dist = Number(f.distance || f.dz || f.height || params.distance || 0);
      if (dist > 0) {
        dims.push({
          id: `${idBase}-ex`,
          kind: 'feature',
          featureType: 'extrude',
          axis: 'y',
          view,
          x1: origin.x - 12,
          y1: origin.y,
          x2: origin.x - 12,
          y2: origin.y + dist,
          value: dist,
          label: `extrude ${fmt(dist)}`,
          auto: true,
          fromFeature: true,
        });
      }
    }
    cursor += 1;
  }
  return dims;
}

/** Auto overall X (horizontal) + Y (vertical) dimensions from view bounds. */
export function buildOverallDimensions(bounds, view) {
  const { minU, minV, maxU, maxV } = bounds;
  const spanU = Math.max(0, maxU - minU);
  const spanV = Math.max(0, maxV - minV);
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3)).replace(/\.?0+$/, '') || '0';
  return [
    {
      id: `auto-${view}-x`,
      kind: 'overall',
      axis: 'x',
      view,
      x1: minU,
      y1: minV,
      x2: maxU,
      y2: minV,
      value: spanU,
      label: fmt(spanU),
      auto: true,
    },
    {
      id: `auto-${view}-y`,
      kind: 'overall',
      axis: 'y',
      view,
      x1: minU,
      y1: minV,
      x2: minU,
      y2: maxV,
      value: spanV,
      label: fmt(spanV),
      auto: true,
    },
  ];
}

function panelTransform(view, panel) {
  const { minU, minV, maxU, maxV } = view.bounds;
  const spanU = Math.max(1e-9, maxU - minU);
  const spanV = Math.max(1e-9, maxV - minV);
  const scale = Math.min(panel.w / spanU, panel.h / spanV) * 0.82;
  const cx = panel.ox + panel.w / 2;
  const cy = panel.oy + panel.h / 2;
  const midU = (minU + maxU) / 2;
  const midV = (minV + maxV) / 2;
  return {
    toScreen(u, v) {
      return { x: cx + (u - midU) * scale, y: cy - (v - midV) * scale };
    },
    scale,
    cx,
    cy,
  };
}

function arrowHead(x1, y1, x2, y2, size = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  return `${x2.toFixed(2)},${y2.toFixed(2)} ${(bx + px * size * 0.45).toFixed(2)},${(by + py * size * 0.45).toFixed(2)} ${(bx - px * size * 0.45).toFixed(2)},${(by - py * size * 0.45).toFixed(2)}`;
}

/** SVG markup for one dimension (model-space endpoints → screen via xf). */
export function dimensionToSvg(dim, xf, { offset = 18 } = {}) {
  const a = xf.toScreen(dim.x1, dim.y1);
  const b = xf.toScreen(dim.x2, dim.y2);
  const horizontal = Math.abs(dim.x2 - dim.x1) >= Math.abs(dim.y2 - dim.y1);
  let ax = a.x;
  let ay = a.y;
  let bx = b.x;
  let by = b.y;
  if (horizontal) {
    ay += offset;
    by += offset;
  } else {
    ax -= offset;
    bx -= offset;
  }
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const label = dim.label != null ? String(dim.label) : '';
  const ext1 = horizontal
    ? `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${ax.toFixed(2)}" y2="${ay.toFixed(2)}" />`
    : `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${ax.toFixed(2)}" y2="${ay.toFixed(2)}" />`;
  const ext2 = horizontal
    ? `<line x1="${b.x.toFixed(2)}" y1="${b.y.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" />`
    : `<line x1="${b.x.toFixed(2)}" y1="${b.y.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" />`;
  return `<g class="dim" data-id="${escapeXml(dim.id || '')}">
    <g stroke="#fbbf24" stroke-width="0.8" fill="none">${ext1}${ext2}</g>
    <line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="#fbbf24" stroke-width="1.1"/>
    <polygon points="${arrowHead(bx, by, ax, ay)}" fill="#fbbf24" stroke="none"/>
    <polygon points="${arrowHead(ax, ay, bx, by)}" fill="#fbbf24" stroke="none"/>
    <text x="${mx.toFixed(2)}" y="${(my - 3).toFixed(2)}" fill="#fde68a" font-size="10" font-family="monospace" text-anchor="middle">${escapeXml(label)}</text>
  </g>`;
}

const GDT_SYMBOLS = Object.freeze({
  perpendicular: '⊥',
  parallel: '∥',
  position: '⌖',
  concentricity: '◎',
  flatness: '▱',
  circularity: '○',
  cylindricity: '⌭',
  angularity: '∠',
  symmetry: '⌯',
  runout: '↗',
  total_runout: '⇉',
  straightness: '⏤',
  profile_line: '⌒',
  profile_surface: '⌓',
});

export function resolveGdtSymbol(symbolOrKey) {
  const s = String(symbolOrKey || '').trim();
  if (!s) return '⌖';
  if (Object.values(GDT_SYMBOLS).includes(s)) return s;
  const key = s.toLowerCase().replace(/[\s-]+/g, '_');
  return GDT_SYMBOLS[key] || s;
}

export { GDT_SYMBOLS };

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Feature control frame SVG at view-space anchor (u,v). */
export function gdtAnnotationToSvg(ann, xf) {
  const u = ann.anchor?.u ?? ann.u ?? 0;
  const v = ann.anchor?.v ?? ann.v ?? 0;
  const p = xf.toScreen(u, v);
  const sym = resolveGdtSymbol(ann.symbol);
  const tol = ann.tolerance != null ? String(ann.tolerance) : '';
  const datums = Array.isArray(ann.datums) ? ann.datums.filter(Boolean) : [];
  const cells = [sym, tol, ...datums.map((d) => String(d).toUpperCase())];
  const cellW = 22;
  const cellH = 18;
  const w = cells.length * cellW;
  let x = p.x;
  let boxes = '';
  let texts = '';
  cells.forEach((c, i) => {
    boxes += `<rect x="${x.toFixed(2)}" y="${p.y.toFixed(2)}" width="${cellW}" height="${cellH}" fill="#0f172a" stroke="#a5f3fc" stroke-width="1"/>`;
    texts += `<text x="${(x + cellW / 2).toFixed(2)}" y="${(p.y + 13).toFixed(2)}" fill="#ecfeff" font-size="11" font-family="monospace" text-anchor="middle">${escapeXml(c)}</text>`;
    x += cellW;
  });
  const leader = `<line x1="${p.x.toFixed(2)}" y1="${(p.y + cellH).toFixed(2)}" x2="${p.x.toFixed(2)}" y2="${(p.y + cellH + 10).toFixed(2)}" stroke="#a5f3fc" stroke-width="1"/>`;
  return `<g class="gdt" data-id="${escapeXml(ann.id || '')}">${leader}${boxes}${texts}</g>`;
}

/** Build SVG string for one or more views (with dims + GD&T overlays). */
export function viewsToSvg(
  views,
  {
    width = 960,
    height = 360,
    padding = 24,
    dimensionsByView = {},
    gdtByView = {},
    autoOverall = true,
    footerNote = 'ConKay orthographic drawing — projected mesh lines + drafting annotations (not CMM GD&T / industrial CAD)',
  } = {},
) {
  const panelW = (width - padding * (views.length + 1)) / views.length;
  const panelH = height - padding * 2 - 28;
  const labels = { front: 'FRONT', top: 'TOP', side: 'SIDE' };
  let bodies = '';
  views.forEach((view, i) => {
    const ox = padding + i * (panelW + padding);
    const oy = padding + 16;
    const panel = { ox, oy, w: panelW, h: panelH };
    const xf = panelTransform(view, panel);
    const lines = view.segments
      .map((s) => {
        const p1 = xf.toScreen(s.x1, s.y1);
        const p2 = xf.toScreen(s.x2, s.y2);
        return `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" />`;
      })
      .join('\n');

    const autoDims = autoOverall ? buildOverallDimensions(view.bounds, view.view) : [];
    const userDims = dimensionsByView[view.view] || [];
    const dims = [...autoDims, ...userDims];
    const dimSvg = dims.map((d) => dimensionToSvg(d, xf, { offset: d.axis === 'y' ? 22 : 16 })).join('\n');
    const gdtList = gdtByView[view.view] || [];
    const gdtSvg = gdtList.map((a) => gdtAnnotationToSvg(a, xf)).join('\n');

    bodies += `
  <g class="view-${view.view}">
    <text x="${ox + 4}" y="${oy - 4}" fill="#67e8f9" font-size="12" font-family="monospace">${labels[view.view] || view.view.toUpperCase()} (${view.mode})</text>
    <rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}" fill="none" stroke="#164e63" stroke-width="1"/>
    <g stroke="#e2e8f0" stroke-width="1.2" fill="none">${lines}</g>
    <g class="dimensions">${dimSvg}</g>
    <g class="gdt-annotations">${gdtSvg}</g>
  </g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${padding}" y="${height - 8}" fill="#64748b" font-size="10" font-family="monospace">${escapeXml(footerNote)}</text>
  ${bodies}
</svg>
`;
}

function meshFromParts(parts) {
  const allPos = [];
  const allIdx = [];
  let vertOffset = 0;
  const included = [];
  const skipped = [];
  for (const p of parts) {
    if (!p.mesh?.positions?.length || !p.mesh?.indices?.length) {
      skipped.push({ id: p.id, name: p.name, reason: p.glbUrl ? 'glb_only' : 'no_mesh' });
      continue;
    }
    const positions = applyTransformToPositions(p.mesh.positions, p.transform);
    for (let i = 0; i < positions.length; i++) allPos.push(positions[i]);
    for (const ix of p.mesh.indices) allIdx.push(ix + vertOffset);
    vertOffset += positions.length / 3;
    included.push({ id: p.id, name: p.name, kind: p.kind });
  }
  return { allPos, allIdx, included, skipped };
}

function collectAnnotationOpts(asm, opts = {}, parts = []) {
  const meta = asm?.meta || {};
  const userDims = Array.isArray(opts.dimensions)
    ? opts.dimensions
    : Array.isArray(meta.dimensions)
      ? meta.dimensions
      : [];
  const gdt = Array.isArray(opts.gdt)
    ? opts.gdt
    : Array.isArray(meta.gdt)
      ? meta.gdt
      : Array.isArray(meta.gdtAnnotations)
        ? meta.gdtAnnotations
        : [];
  const dimensionsByView = { front: [], top: [], side: [] };
  // Gate E — solid feature dims first (when featureTree present), then user dims
  if (opts.featureDims !== false) {
    for (const part of parts || []) {
      const feats = part?.meta?.featureTree || part?.featureTree || opts.features || [];
      if (!Array.isArray(feats) || !feats.length) continue;
      for (const view of ['front', 'top', 'side']) {
        const fd = buildFeatureDimensions(feats, view);
        for (const d of fd) {
          dimensionsByView[view].push({ ...d, partId: part.id || null });
        }
      }
    }
    // bare features on opts (no part)
    if ((!parts || !parts.length) && Array.isArray(opts.features) && opts.features.length) {
      for (const view of ['front', 'top', 'side']) {
        for (const d of buildFeatureDimensions(opts.features, view)) {
          dimensionsByView[view].push(d);
        }
      }
    }
  }
  for (const d of userDims) {
    const v = d.view || 'front';
    if (!dimensionsByView[v]) dimensionsByView[v] = [];
    dimensionsByView[v].push(d);
  }
  const gdtByView = { front: [], top: [], side: [] };
  for (const a of gdt) {
    const v = a.view || 'front';
    if (!gdtByView[v]) gdtByView[v] = [];
    gdtByView[v].push(a);
  }
  return {
    dimensionsByView,
    gdtByView,
    userDims,
    gdt,
    autoOverall: opts.autoOverall !== false,
  };
}

function enrichViewsWithDims(views, ann) {
  return views.map((v) => {
    const auto = ann.autoOverall ? buildOverallDimensions(v.bounds, v.view) : [];
    const user = ann.dimensionsByView[v.view] || [];
    return {
      name: v.view,
      mode: v.mode,
      edgeCount: v.edgeCount,
      bounds: v.bounds,
      segments: v.segments,
      dimensions: [...auto, ...user],
      gdt: ann.gdtByView[v.view] || [],
    };
  });
}

/** Build drawing JSON + SVG for a single part. */
export function exportPartDrawing(part, opts = {}) {
  if (!part) return { ok: false, reason: 'part_not_found' };
  if (!part.mesh?.positions?.length || !part.mesh?.indices?.length) {
    return {
      ok: false,
      reason: 'no_triangle_mesh',
      detail: part.glbUrl ? 'GLB parts need mesh arrays for drawing' : 'part has no mesh',
    };
  }
  const positions = applyTransformToPositions(part.mesh.positions, part.transform);
  const views = ['front', 'top', 'side'].map((v) =>
    projectMeshView(positions, part.mesh.indices, v, { silhouette: opts.silhouette !== false }),
  );
  const fakeAsm = { meta: part.meta || {} };
  const ann = collectAnnotationOpts(fakeAsm, opts, part ? [part] : []);
  const svg = viewsToSvg(views, {
    ...opts,
    dimensionsByView: ann.dimensionsByView,
    gdtByView: ann.gdtByView,
    autoOverall: ann.autoOverall,
  });
  return {
    ok: true,
    format: 'conkay-drawing/v1',
    partId: part.id,
    views: enrichViewsWithDims(views, ann),
    dimensions: ann.userDims,
    gdt: ann.gdt,
    svg,
    honesty: {
      note: 'Orthographic projected lines + drafting dims/GD&T overlays — NOT CMM-certified GD&T solver / industrial sheets',
    },
  };
}

/** Build drawing JSON + SVG for an assembly (merged meshes). */
export function exportAssemblyDrawing(db, assemblyId, opts = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };
  const parts = listParts(db, assemblyId);
  const { allPos, allIdx, included, skipped } = meshFromParts(parts);
  if (!allIdx.length) {
    return { ok: false, reason: 'no_exportable_mesh_parts', skipped };
  }
  const views = ['front', 'top', 'side'].map((v) =>
    projectMeshView(allPos, allIdx, v, { silhouette: opts.silhouette !== false }),
  );
  const ann = collectAnnotationOpts(asm, opts, parts);
  const svg = viewsToSvg(views, {
    ...opts,
    dimensionsByView: ann.dimensionsByView,
    gdtByView: ann.gdtByView,
    autoOverall: ann.autoOverall,
  });
  return {
    ok: true,
    format: 'conkay-drawing/v1',
    assemblyId,
    assemblyName: asm.name,
    included,
    skipped,
    views: enrichViewsWithDims(views, ann),
    dimensions: ann.userDims,
    gdt: ann.gdt,
    svg,
    honesty: {
      note: 'Orthographic projected lines + drafting dims/GD&T overlays — NOT CMM-certified GD&T solver / industrial sheets',
    },
  };
}

function drawViewOnPdf(doc, view, box, dims, gdtList) {
  const { x, y, w, h } = box;
  doc.save();
  doc.rect(x, y, w, h).stroke('#334155');
  const xf = panelTransform(view, { ox: x, oy: y, w, h });
  doc.strokeColor('#1e293b').lineWidth(0.6);
  for (const s of view.segments) {
    const p1 = xf.toScreen(s.x1, s.y1);
    const p2 = xf.toScreen(s.x2, s.y2);
    doc.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke();
  }
  doc.strokeColor('#b45309').fillColor('#b45309').lineWidth(0.8);
  const allDims = [...(dims || [])];
  for (const dim of allDims) {
    const a = xf.toScreen(dim.x1, dim.y1);
    const b = xf.toScreen(dim.x2, dim.y2);
    const horizontal = Math.abs(dim.x2 - dim.x1) >= Math.abs(dim.y2 - dim.y1);
    const off = 14;
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    if (horizontal) {
      ay += off;
      by += off;
    } else {
      ax -= off;
      bx -= off;
    }
    doc.moveTo(a.x, a.y).lineTo(ax, ay).stroke();
    doc.moveTo(b.x, b.y).lineTo(bx, by).stroke();
    doc.moveTo(ax, ay).lineTo(bx, by).stroke();
    doc.fontSize(8).fillColor('#92400e').text(String(dim.label || ''), (ax + bx) / 2 - 12, (ay + by) / 2 - 10, {
      width: 40,
      align: 'center',
    });
  }
  doc.fillColor('#0e7490').strokeColor('#0e7490');
  for (const ann of gdtList || []) {
    const u = ann.anchor?.u ?? 0;
    const v = ann.anchor?.v ?? 0;
    const p = xf.toScreen(u, v);
    const sym = resolveGdtSymbol(ann.symbol);
    const label = [sym, ann.tolerance || '', ...(ann.datums || [])].filter(Boolean).join(' | ');
    doc.fontSize(8).text(label, p.x, p.y, { width: 80 });
  }
  doc.restore();
}

/**
 * Multi-page PDF: title+BOM page, then one page per orthographic view.
 * Returns { ok, buffer, pages, filename }.
 */
export async function exportAssemblyDrawingPdf(db, assemblyId, opts = {}) {
  const drawing = exportAssemblyDrawing(db, assemblyId, opts);
  if (!drawing.ok) return drawing;
  const bom = buildBom(db, assemblyId);
  const asm = getAssembly(db, assemblyId);

  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 36, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Page 1 — title block + BOM
    doc.addPage();
    doc.fontSize(16).fillColor('#0f172a').text('ConKay Assembly Drawing Pack', { align: 'left' });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155');
    doc.text(`Assembly: ${asm?.name || assemblyId}`);
    doc.text(`ID: ${assemblyId}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.text('Honesty: projected mesh views + drafting annotations — NOT CMM GD&T / OCC sheets');
    doc.moveDown(0.8);
    // Title block box
    const tbY = doc.y;
    doc.rect(36, tbY, 540, 56).stroke('#64748b');
    doc.fontSize(9).text(`Title: ${asm?.name || 'Untitled'}`, 44, tbY + 8);
    doc.text('Scale: orthographic fit', 44, tbY + 22);
    doc.text('Sheet: 1 / 4 (title+BOM)', 44, tbY + 36);
    doc.text('Rev: A', 320, tbY + 8);
    doc.text('Units: model units', 320, tbY + 22);
    doc.y = tbY + 70;
    doc.fontSize(12).fillColor('#0f172a').text('Bill of Materials');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#334155');
    const lines = bom.ok ? bom.lines : [];
    doc.text('Kind'.padEnd(16) + 'Material'.padEnd(16) + 'Qty'.padEnd(6) + 'Names');
    doc.moveTo(36, doc.y).lineTo(576, doc.y).stroke('#94a3b8');
    doc.moveDown(0.2);
    for (const line of lines) {
      const names = (line.names || []).join(', ').slice(0, 48);
      doc.text(
        `${String(line.kind || '').slice(0, 14).padEnd(16)}${String(line.material || '').slice(0, 14).padEnd(16)}${String(line.qty).padEnd(6)}${names}`,
      );
    }
    if (!lines.length) doc.text('(no parts)');
    doc.moveDown(0.6);
    doc.fontSize(8).fillColor('#64748b').text(`Total parts: ${bom.totalParts ?? 0}`);

    // Pages 2–4 — views
    const viewObjs = ['front', 'top', 'side'].map((name) => {
      const v = drawing.views.find((x) => x.name === name);
      return {
        view: name,
        segments: v.segments,
        bounds: v.bounds,
        mode: v.mode,
        dimensions: v.dimensions,
        gdt: v.gdt,
      };
    });

    for (const v of viewObjs) {
      doc.addPage();
      doc.fontSize(14).fillColor('#0f172a').text(`${v.view.toUpperCase()} VIEW (${v.mode})`);
      doc.fontSize(8).fillColor('#64748b').text('Projected mesh edges + overall dims / user dims / GD&T frames');
      drawViewOnPdf(
        doc,
        v,
        { x: 36, y: 72, w: 540, h: 620 },
        v.dimensions,
        v.gdt,
      );
    }

    doc.end();
  });

  return {
    ok: true,
    buffer,
    pages: 4,
    filename: `conkay-assembly-${assemblyId.slice(0, 8)}-drawing.pdf`,
    assemblyId,
    assemblyName: asm?.name,
    honesty: {
      note: 'Multi-page PDF pack (title+BOM + 3 orthographic views). Drafting annotations — NOT CMM-certified GD&T.',
    },
  };
}
