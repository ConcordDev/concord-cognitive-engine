/**
 * ConKay mates v2 proof — distance/offset/align_axis solve for B given A.
 * Honesty: kinematic — NOT industrial solver / OCC.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-mates-v2-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayMatesV2' },
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
      'User-Agent': 'Mozilla/5.0 ConKayMatesV2',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const types = await api(token, 'GET', '/api/conkay/mate-types');
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'mates-v2-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
  transform: { position: { x: 1, y: 2, z: 3 } },
});
const a2 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel tube 3m',
  name: 'tube-b',
  transform: { position: { x: 9, y: 9, z: 9 } },
});
const idA = a1.data?.part?.id;
const idB = a2.data?.part?.id;

const distance = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'distance',
  aPartId: idA,
  bPartId: idB,
  axis: 'x',
  offset: 2.5,
  drive: 'b',
});
const bAfterDist = distance.data?.parts?.find((p) => p.id === idB)?.transform?.position;
const aAfterDist = distance.data?.parts?.find((p) => p.id === idA)?.transform?.position;

const offset = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'offset',
  aPartId: idA,
  bPartId: idB,
  axis: 'y',
  offset: 1,
  drive: 'b',
});
const bAfterOff = offset.data?.parts?.find((p) => p.id === idB)?.transform?.position;

const align = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/mates`, {
  type: 'align_axis',
  aPartId: idA,
  bPartId: idB,
  axis: 'y',
  offset: 0.5,
  drive: 'b',
});
const bAfterAlign = align.data?.parts?.find((p) => p.id === idB);

const ok =
  types.data?.types?.includes('distance') &&
  types.data?.types?.includes('align_axis') &&
  distance.data?.ok &&
  distance.data?.drivenPartId === idB &&
  aAfterDist?.x === 1 &&
  aAfterDist?.y === 2 &&
  bAfterDist?.x === 3.5 &&
  bAfterDist?.y === 2 &&
  bAfterDist?.z === 3 &&
  offset.data?.ok &&
  bAfterOff?.y === 3 &&
  align.data?.ok &&
  bAfterAlign?.transform?.position?.x === 1 &&
  bAfterAlign?.transform?.position?.z === 3;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'mates-v2-kinematic-solve',
  honesty: {
    wave: '3-v2',
    note: 'Kinematic solve for B given A (distance/offset/align_axis) — NOT industrial solver / OCC',
  },
  assemblyId,
  types: types.data?.types,
  distance: { status: distance.status, driven: distance.data?.drivenPartId, a: aAfterDist, b: bAfterDist },
  offset: { status: offset.status, b: bAfterOff },
  align_axis: {
    status: align.status,
    bPos: bAfterAlign?.transform?.position,
    bRot: bAfterAlign?.transform?.rotation,
  },
  unitTests: 'server/tests/conkay-assembly-mates-v2.test.js',
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok }, null, 2));
process.exit(ok ? 0 : 2);
