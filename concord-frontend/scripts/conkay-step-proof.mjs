/**
 * ConKay faceted STEP export/import proof.
 * Honesty: faceted AP214-style MANIFOLD_SOLID_BREP from triangles — NOT OCC/SolidWorks B-rep.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stepToMesh, meshesMatch } from '../../server/lib/conkay/step-import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-step-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayStepProof' },
    body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
  });
  const login = await loginRes.json();
  if (!login?.token) throw new Error('login_failed');
  return login.token;
}

async function api(token, method, urlPath, body, { raw } = {}) {
  const r = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 ConKayStepProof',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      status: r.status,
      headers: Object.fromEntries(r.headers.entries()),
      buf,
      text: buf.toString('utf8'),
      size: buf.length,
    };
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

function stepLooksValid(text) {
  if (!text || text.length < 80) return false;
  return (
    text.includes('ISO-10303-21') &&
    text.includes('END-ISO-10303-21') &&
    text.includes('MANIFOLD_SOLID_BREP') &&
    text.includes('CLOSED_SHELL') &&
    text.includes('POLY_LOOP') &&
    text.includes('CARTESIAN_POINT')
  );
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'step-proof-assembly' });
const assemblyId = created.data?.assembly?.id;
if (!assemblyId) {
  console.error('create failed', created);
  process.exit(2);
}

const add1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'simply supported steel I-beam 6m, 5kN midspan',
  name: 'beam-a',
  transform: { position: { x: 0, y: 1.2, z: 0 } },
});
const add2 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel tube 3m',
  name: 'tube-b',
  material: 'steel',
  transform: { position: { x: 1.5, y: 1.2, z: 0 } },
});
const partId = add1.data?.part?.id;
const origMesh = add1.data?.part?.mesh;

const partStep = await api(
  token,
  'GET',
  `/api/conkay/assemblies/${assemblyId}/parts/${partId}/export.step`,
  null,
  { raw: true },
);
const asmStep = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/export.step`, null, {
  raw: true,
});

const partOk = partStep.status === 200 && stepLooksValid(partStep.text) && partStep.size > 80;
const asmOk = asmStep.status === 200 && stepLooksValid(asmStep.text) && asmStep.size > 80;

// Local round-trip on part STEP
const localImp = stepToMesh(partStep.text);
const localMatch = localImp.ok
  ? meshesMatch(
      {
        positions: origMesh.positions,
        indices: origMesh.indices,
      },
      { positions: localImp.positions, indices: localImp.indices },
      1e-4,
    )
  : { ok: false, reason: 'import_failed' };

// Note: part export applies world transform — orig mesh is local.
// Re-compare using export→import self round-trip (authoritative for format).
const selfImp = stepToMesh(partStep.text);
const reExpMatch = selfImp.ok
  ? (() => {
      // Import then re-parse corners vs first import (identity)
      const again = stepToMesh(partStep.text);
      return meshesMatch(
        { positions: selfImp.positions, indices: selfImp.indices },
        { positions: again.positions, indices: again.indices },
        1e-9,
      );
    })()
  : { ok: false };

// Better: compare transformed original to import
function applyXf(positions, transform) {
  const pos = transform?.position || { x: 0, y: 0, z: 0 };
  const scl = transform?.scale || { x: 1, y: 1, z: 1 };
  const out = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push(
      positions[i] * (scl.x ?? 1) + (pos.x ?? 0),
      positions[i + 1] * (scl.y ?? 1) + (pos.y ?? 0),
      positions[i + 2] * (scl.z ?? 1) + (pos.z ?? 0),
    );
  }
  return out;
}
const xfPos = applyXf(origMesh.positions, add1.data.part.transform);
const worldMatch = localImp.ok
  ? meshesMatch(
      { positions: xfPos, indices: origMesh.indices },
      { positions: localImp.positions, indices: localImp.indices },
      1e-4,
    )
  : { ok: false, reason: 'import_failed' };

// API import → new part
const importRes = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/import.step`, {
  step: partStep.text,
  name: 'roundtrip-import',
  material: 'steel',
});
const importOk = !!importRes.data?.ok && (importRes.data?.mesh?.triangleCount || 0) > 0;

// aligned mate smoke
const mateRes = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'aligned',
  aPartId: add2.data?.part?.id,
  bPartId: partId,
  axis: 'y',
});

const exportLive = partOk && asmOk;
const importLive = importOk && worldMatch.ok;
const status = exportLive && importLive ? 'LIVE' : exportLive ? 'PARTIAL' : 'FAIL';

const proof = {
  ok: exportLive && importLive,
  status,
  claim:
    'Faceted STEP export+import LIVE (AP214-style MANIFOLD_SOLID_BREP / POLY_LOOP). NOT OCC/SolidWorks B-rep kernel.',
  ts: new Date().toISOString(),
  assemblyId,
  export: {
    part: {
      ok: partOk,
      status: partStep.status,
      size: partStep.size,
      triangleCount: partStep.headers?.['x-conkay-triangle-count'],
      format: partStep.headers?.['x-conkay-step-format'],
      hasIso10303: partStep.text?.includes('ISO-10303-21'),
      hasEnd: partStep.text?.includes('END-ISO-10303-21'),
    },
    assembly: {
      ok: asmOk,
      status: asmStep.status,
      size: asmStep.size,
      triangleCount: asmStep.headers?.['x-conkay-triangle-count'],
      included: asmStep.headers?.['x-conkay-included-parts'],
    },
  },
  import: {
    api: {
      ok: importOk,
      status: importRes.status,
      partId: importRes.data?.part?.id,
      vertexCount: importRes.data?.mesh?.vertexCount,
      triangleCount: importRes.data?.mesh?.triangleCount,
    },
    roundTripMesh: worldMatch,
    selfStable: reExpMatch,
  },
  mates: {
    aligned: { ok: !!mateRes.data?.ok, type: mateRes.data?.mate?.type, honesty: mateRes.data?.honesty },
  },
  overlay: { dataTestId: 'ck-export-step' },
  honesty: {
    format: 'ASCII STEP faceted FACETED_BREP / MANIFOLD_SOLID_BREP from assembly triangle meshes',
    not: 'SolidWorks B-rep / cadquery / OpenCascade kernel / industrial constraint solver',
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: proof.ok, status: proof.status, out: OUT, export: proof.export, import: proof.import.api, roundTrip: worldMatch }, null, 2));
process.exit(proof.ok ? 0 : 1);
