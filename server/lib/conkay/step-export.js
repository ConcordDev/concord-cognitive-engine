// server/lib/conkay/step-export.js
// Faceted ASCII STEP (AP214-style FACETED_BREP) from triangle meshes.
// Honesty: encodes CLOSED_SHELL / MANIFOLD_SOLID_BREP from positions+indices.
// NOT a SolidWorks/OCC B-rep kernel — no cadquery/OpenCascade. Same mesh as STL.

/**
 * @param {Float32Array|number[]|{positions:any,indices:any}} positionsOrMesh
 * @param {Uint32Array|number[]|object} [indicesOrOpts]
 * @param {{ name?: string, units?: string, headerNote?: string }} [opts]
 * @returns {{ ok:boolean, step?:string, buffer?:Buffer, vertexCount?:number, triangleCount?:number, reason?:string, honesty?:object }}
 */
export function meshToSTEP(positionsOrMesh, indicesOrOpts, opts) {
  let positions;
  let indices;
  let options = opts || {};

  if (
    positionsOrMesh &&
    typeof positionsOrMesh === 'object' &&
    !Array.isArray(positionsOrMesh) &&
    !(positionsOrMesh instanceof Float32Array) &&
    positionsOrMesh.positions
  ) {
    positions = positionsOrMesh.positions;
    indices = positionsOrMesh.indices;
    if (indicesOrOpts && typeof indicesOrOpts === 'object' && !Array.isArray(indicesOrOpts) && !(indicesOrOpts instanceof Uint32Array)) {
      options = indicesOrOpts;
    }
  } else {
    positions = positionsOrMesh;
    indices = indicesOrOpts;
  }

  if (!positions?.length || !indices?.length) {
    return { ok: false, reason: 'empty_mesh' };
  }
  if (positions.length % 3 !== 0) {
    return { ok: false, reason: 'malformed_mesh', detail: 'positions.length % 3 !== 0' };
  }
  if (indices.length % 3 !== 0) {
    return { ok: false, reason: 'non_triangular_indices' };
  }

  const vertCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] | 0;
    if (idx < 0 || idx >= vertCount) {
      return { ok: false, reason: 'malformed_mesh', detail: `index ${idx} out of range` };
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(Number(positions[i]))) {
      return { ok: false, reason: 'non_finite_coordinate', at: i };
    }
  }

  const name = String(options.name || 'conkay_part').replace(/[^A-Za-z0-9_\-.]/g, '_').slice(0, 64);
  const note = options.headerNote || 'Concord ConKay faceted STEP (triangle mesh → FACETED_BREP). NOT OCC/SolidWorks B-rep.';
  const isoTs = new Date().toISOString().replace(/\.\d{3}Z$/, '');

  const lines = [];
  let id = 1;
  const nextId = () => id++;

  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('${esc(note)}'),'2;1');`);
  lines.push(
    `FILE_NAME('${esc(name)}.step','${isoTs}',('Concord ConKay'),(''),'ConKay faceted STEP export','Concord Cognitive Engine','');`,
  );
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  const appCtx = nextId();
  lines.push(`#${appCtx}=APPLICATION_CONTEXT('core data for automotive mechanical design processes');`);
  const apd = nextId();
  lines.push(`#${apd}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx});`);
  const prodCtx = nextId();
  lines.push(`#${prodCtx}=PRODUCT_CONTEXT('',#${appCtx},'mechanical');`);
  const defCtx = nextId();
  lines.push(`#${defCtx}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design');`);
  const product = nextId();
  lines.push(`#${product}=PRODUCT('${esc(name)}','${esc(name)}','faceted mesh export',(#${prodCtx}));`);
  const pdf = nextId();
  lines.push(`#${pdf}=PRODUCT_DEFINITION_FORMATION('','',#${product});`);
  const pd = nextId();
  lines.push(`#${pd}=PRODUCT_DEFINITION('design','',#${pdf},#${defCtx});`);
  const pds = nextId();
  lines.push(`#${pds}=PRODUCT_DEFINITION_SHAPE('','',#${pd});`);

  // Reserve shape representation ids (written after geom context + solid)
  const sdr = nextId();
  const shapeRep = nextId();
  const geomCtx = nextId();
  const unc = nextId();
  const lenUnit = nextId();
  const angUnit = nextId();
  const solidAng = nextId();

  // Vertices: CARTESIAN_POINT + VERTEX_POINT
  const vertexIds = new Array(vertCount);
  for (let v = 0; v < vertCount; v++) {
    const x = fmt(positions[v * 3]);
    const y = fmt(positions[v * 3 + 1]);
    const z = fmt(positions[v * 3 + 2]);
    const cp = nextId();
    lines.push(`#${cp}=CARTESIAN_POINT('',(${x},${y},${z}));`);
    const vp = nextId();
    lines.push(`#${vp}=VERTEX_POINT('',#${cp});`);
    vertexIds[v] = vp;
  }

  // Faces: POLY_LOOP → FACE_OUTER_BOUND → FACE
  const faceIds = [];
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] | 0;
    const i1 = indices[t * 3 + 1] | 0;
    const i2 = indices[t * 3 + 2] | 0;
    // Skip degenerate (duplicate verts)
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const loop = nextId();
    lines.push(`#${loop}=POLY_LOOP('',(#${vertexIds[i0]},#${vertexIds[i1]},#${vertexIds[i2]}));`);
    const bound = nextId();
    lines.push(`#${bound}=FACE_OUTER_BOUND('',#${loop},.T.);`);
    const face = nextId();
    lines.push(`#${face}=FACE('',(#${bound}));`);
    faceIds.push(face);
  }

  if (!faceIds.length) {
    return { ok: false, reason: 'no_exportable_faces', detail: 'all triangles degenerate' };
  }

  const shell = nextId();
  lines.push(`#${shell}=CLOSED_SHELL('',(${faceIds.map((f) => `#${f}`).join(',')}));`);
  const solid = nextId();
  lines.push(`#${solid}=MANIFOLD_SOLID_BREP('${esc(name)}',#${shell});`);

  // Units / context (millimetres — common for STEP viewers; mesh coords are as-stored)
  lines.push(
    `#${lenUnit}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`,
  );
  lines.push(`#${angUnit}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));`);
  lines.push(`#${solidAng}=(NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.));`);
  lines.push(
    `#${unc}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${lenUnit},'distance_accuracy_value','confusion accuracy');`,
  );
  lines.push(
    `#${geomCtx}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${angUnit},#${solidAng})));`,
  );
  lines.push(`#${shapeRep}=ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(name)}',(#${solid}),#${geomCtx});`);
  lines.push(`#${sdr}=SHAPE_DEFINITION_REPRESENTATION(#${pds},#${shapeRep});`);

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  lines.push('');

  const step = lines.join('\n');
  const buffer = Buffer.from(step, 'utf8');
  return {
    ok: true,
    step,
    buffer,
    vertexCount: vertCount,
    triangleCount: faceIds.length,
    honesty: {
      format: 'ASCII STEP AP214-style FACETED_BREP (POLY_LOOP triangles)',
      note: 'Faceted mesh export — NOT industrial B-rep CAD kernel / cadquery / OCC',
    },
  };
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0.';
  if (Object.is(x, -0)) return '0.';
  // STEP prefers decimal point
  let s = x.toString();
  if (!/[.eE]/.test(s)) s += '.';
  return s;
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export default meshToSTEP;
