/**
 * ConKay assembly undo/redo history proof (API).
 * Honesty: revision stack of parts+transforms — not parametric CAD history.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-undo-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayUndoProof' },
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
      'User-Agent': 'Mozilla/5.0 ConKayUndoProof',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'undo-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
  transform: { position: { x: 0, y: 1.2, z: 0 } },
});
const partId = a1.data?.part?.id;
const moved = await api(token, 'PATCH', `/api/conkay/assemblies/${assemblyId}/parts/${partId}`, {
  transform: { position: { x: 4, y: 1.2, z: 0 } },
});
const hist1 = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/history`);
const undo = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/undo`);
const afterUndoX = undo.data?.parts?.find((p) => p.id === partId)?.transform?.position?.x;
const redo = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/redo`);
const afterRedoX = redo.data?.parts?.find((p) => p.id === partId)?.transform?.position?.x;
const chatUndo = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/revise`, { text: 'undo' });

const ok =
  created.status === 200 &&
  moved.data?.ok &&
  hist1.data?.canUndo === true &&
  undo.data?.ok &&
  afterUndoX === 0 &&
  redo.data?.ok &&
  afterRedoX === 4;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'assembly-undo-redo-history',
  honesty: {
    note: 'Revision stack per assembly (parts+transforms). NOT parametric CAD history.',
  },
  assemblyId,
  steps: {
    create: { status: created.status, ok: created.data?.ok },
    add: { status: a1.status, partId },
    move: { status: moved.status, x: moved.data?.part?.transform?.position?.x },
    history: hist1.data,
    undo: { status: undo.status, x: afterUndoX, canRedo: undo.data?.canRedo },
    redo: { status: redo.status, x: afterRedoX, canUndo: redo.data?.canUndo },
    chatUndo: { status: chatUndo.status, action: chatUndo.data?.action, ok: chatUndo.data?.ok },
  },
  overlay: { buttons: ['ck-assembly-undo', 'ck-assembly-redo'], chat: ['undo', 'redo'] },
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, steps: proof.steps }, null, 2));
process.exit(ok ? 0 : 2);
