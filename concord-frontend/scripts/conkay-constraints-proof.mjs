/**
 * ConKay CAD Wave 3 proof: mates (fixed/coincident/offset) + material attach.
 * Honesty: kinematic stubs + material library — NOT full constraint solver.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-constraints-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayMateProof' },
    body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
  });
  const j = await r.json();
  if (!j?.token) throw new Error('login_failed');
  return j.token;
}

async function api(token, method, urlPath, body) {
  const r = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 ConKayMateProof',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const mats = await api(token, 'GET', '/api/conkay/materials');
const types = await api(token, 'GET', '/api/conkay/mate-types');

const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'wave3-mates-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
  transform: { position: { x: 0, y: 1.2, z: 0 } },
});
const a2 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel tube 3m',
  name: 'tube-b',
  transform: { position: { x: 3, y: 2, z: 1 } },
});
const idA = a1.data?.part?.id;
const idB = a2.data?.part?.id;

const matAttach = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts/${idA}/material`, {
  material: 'aluminum',
});

const coincident = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'coincident',
  aPartId: idA,
  bPartId: idB,
  axis: 'y',
});
const offset = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'offset',
  aPartId: idA,
  bPartId: idB,
  axis: 'x',
  offset: 0.5,
});
const fixed = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'fixed',
  aPartId: idB,
  bPartId: null,
});

const listed = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}`);
const parts = listed.data?.parts || [];
const partA = parts.find((p) => p.id === idA);
const partB = parts.find((p) => p.id === idB);

// Mate order: coincident (A.y←B.y) → offset (A.x←B.x+0.5) → fixed (B→origin).
// Fixed mutates B only, so do NOT assert A.x === B.x+0.5 after fixed.
// Expected final: A.x=3.5 (from offset vs pre-fixed B), B at origin.
const matesAppliedOk =
  !!coincident.data?.ok && !!offset.data?.ok && !!fixed.data?.ok;
const expectedAx = 3.5;
const transformOk = Math.abs(Number(partA?.transform?.position?.x) - expectedAx) < 1e-6;
const materialOk = !!(matAttach.data?.ok && matAttach.data?.material?.id === 'aluminum');
const catalogOk = !!(mats.data?.ok && Array.isArray(mats.data?.materials) && mats.data.materials.length >= 3);
const typesOk = !!(types.data?.ok && Array.isArray(types.data?.types) && types.data.types.includes('fixed'));
const allOk = !!(matesAppliedOk && transformOk && materialOk && catalogOk && typesOk);

const proof = {
  ok: allOk,
  wave: 3,
  status: allOk ? 'LIVE' : 'FAIL',
  claim: 'Mates (fixed/coincident/offset) kinematic stubs + material library LIVE. NOT full constraint solver / CAD suite.',
  ts: new Date().toISOString(),
  assemblyId,
  materialsCatalog: (mats.data?.materials || []).map((m) => m.id),
  mateTypes: types.data?.types,
  materialAttach: {
    ok: materialOk,
    material: matAttach.data?.material,
  },
  mates: {
    coincident: { ok: !!coincident.data?.ok, position: coincident.data?.part?.transform?.position },
    offset: { ok: !!offset.data?.ok, position: offset.data?.part?.transform?.position },
    fixed: { ok: !!fixed.data?.ok, position: fixed.data?.part?.transform?.position },
  },
  finalTransforms: {
    a: partA?.transform?.position,
    b: partB?.transform?.position,
    expectedAx,
    transformOk,
  },
  honesty: {
    wave: 3,
    note: 'Kinematic stubs write transforms; material library attach beyond FEA tint. Not industrial mates solver.',
  },
};

fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: proof.ok, status: proof.status, materialOk, matesAppliedOk, transformOk, catalogOk, typesOk, a: partA?.transform?.position, b: partB?.transform?.position }, null, 2));
process.exit(proof.ok ? 0 : 1);
