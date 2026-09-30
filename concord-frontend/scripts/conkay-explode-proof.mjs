/**
 * ConKay assembly explode proof.
 * Honesty: centroid-from-COM transform deltas — undoable; not physics explode.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-explode-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayExplode' },
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
      'User-Agent': 'Mozilla/5.0 ConKayExplode',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'explode-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
  transform: { position: { x: 0, y: 1.2, z: 0 } },
});
const a2 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel tube 3m',
  name: 'tube-b',
  transform: { position: { x: 4, y: 1.2, z: 0 } },
});
const idA = a1.data?.part?.id;
const idB = a2.data?.part?.id;
const before = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/parts`);
const posBefore = Object.fromEntries(
  (before.data?.parts || []).map((p) => [p.id, { ...p.transform.position }]),
);
const explode = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/explode`, { factor: 1 });
const after = explode.data?.parts || [];
const moved = after.filter((p) => {
  const b = posBefore[p.id];
  const a = p.transform?.position;
  return b && a && (a.x !== b.x || a.y !== b.y || a.z !== b.z);
});
const hist = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/history`);
const undo = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/undo`);
const afterUndo = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/parts`);
const restored = (afterUndo.data?.parts || []).every((p) => {
  const b = posBefore[p.id];
  const a = p.transform?.position;
  return b && a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;
});

const ok =
  created.data?.ok &&
  a1.data?.ok &&
  a2.data?.ok &&
  explode.data?.ok &&
  moved.length >= 1 &&
  hist.data?.canUndo &&
  undo.data?.ok &&
  restored;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'assembly-explode-view',
  honesty: {
    note: 'Centroid-from-COM explode of transforms; undoable via history. NOT physics / SolidWorks explode-table.',
  },
  assemblyId,
  partIds: [idA, idB],
  steps: {
    create: { status: created.status, ok: created.data?.ok },
    add: { a: a1.data?.ok, b: a2.data?.ok },
    explode: {
      status: explode.status,
      ok: explode.data?.ok,
      factor: explode.data?.factor,
      com: explode.data?.com,
      updateCount: explode.data?.updates?.length,
      movedCount: moved.length,
    },
    history: { canUndo: hist.data?.canUndo, undoLabels: hist.data?.undo?.map((u) => u.label) },
    undo: { status: undo.status, ok: undo.data?.ok, restored },
  },
  overlay: { buttons: ['ck-assembly-explode'], unity: 'set_transform/redraw' },
  routes: ['POST /api/conkay/assemblies/:id/explode'],
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, steps: proof.steps }, null, 2));
process.exit(ok ? 0 : 2);
