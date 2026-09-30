/**
 * ConKay orthographic drawing views proof (API).
 * Honesty: projected mesh line segments / SVG — not drafting CAD.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-drawing-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayDrawingProof' },
    body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
  });
  const j = await r.json();
  if (!j?.token) throw new Error('login_failed');
  return j.token;
}

async function api(token, method, urlPath, body, { raw } = {}) {
  const r = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 ConKayDrawingProof',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: Object.fromEntries(r.headers), buf, text: buf.toString('utf8') };
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'drawing-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
});
const partId = a1.data?.part?.id;
const json = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.json`);
const svg = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.svg`, null, { raw: true });
const mats = await api(token, 'GET', '/api/conkay/materials');
const attach = partId
  ? await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts/${partId}/material`, { material: 'aluminum' })
  : { status: 0, data: {} };

const viewsOk =
  json.data?.ok &&
  Array.isArray(json.data?.views) &&
  json.data.views.length === 3 &&
  json.data.views.every((v) => v.edgeCount > 0 && Array.isArray(v.segments)) &&
  typeof json.data.svg === 'string' &&
  json.data.svg.includes('<svg');

const svgOk = svg.status === 200 && svg.text.includes('<svg') && svg.text.includes('FRONT');

const ok = created.status === 200 && a1.data?.ok && viewsOk && svgOk;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'orthographic-drawing-views',
  honesty: {
    note: 'Orthographic projected line segments / SVG from triangle meshes. NOT drafting CAD / GD&T sheets.',
  },
  assemblyId,
  partId,
  steps: {
    create: { status: created.status, ok: created.data?.ok },
    add: { status: a1.status, ok: a1.data?.ok, hasMesh: !!(a1.data?.part?.mesh?.positions?.length) },
    drawingJson: {
      status: json.status,
      ok: json.data?.ok,
      views: json.data?.views?.map((v) => ({ name: v.name, mode: v.mode, edgeCount: v.edgeCount })),
      svgLen: json.data?.svg?.length,
    },
    drawingSvg: {
      status: svg.status,
      bytes: svg.buf?.length,
      hasFront: svg.text?.includes('FRONT'),
      hasTop: svg.text?.includes('TOP'),
      hasSide: svg.text?.includes('SIDE'),
    },
    materials: {
      status: mats.status,
      count: mats.data?.materials?.length,
      attachOk: !!attach.data?.ok,
      material: attach.data?.material?.id,
    },
  },
  overlay: { buttons: ['ck-export-drawing', 'ck-material-picker'] },
  routes: [
    'GET /api/conkay/assemblies/:id/drawing.json',
    'GET /api/conkay/assemblies/:id/drawing.svg',
  ],
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, steps: proof.steps }, null, 2));
process.exit(ok ? 0 : 2);
