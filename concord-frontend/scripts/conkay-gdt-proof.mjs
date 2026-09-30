/**
 * ConKay GD&T drafting annotation proof.
 * Honesty: feature control frames on projected views — NOT CMM-certified GD&T solver.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-gdt-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayGdt' },
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
      'User-Agent': 'Mozilla/5.0 ConKayGdt',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf, text: buf.toString('utf8') };
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'gdt-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
});
const add1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/gdt`, {
  symbol: 'perpendicular',
  tolerance: '0.05',
  datums: ['A', 'B'],
  view: 'front',
  anchor: { u: 0.5, v: 0.2 },
});
const add2 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/gdt`, {
  symbol: '⌖',
  tolerance: '0.1',
  datums: ['A'],
  view: 'top',
  anchor: { u: 0.1, v: -0.1 },
});
const list = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/gdt`);
const annId = add1.data?.annotation?.id;
const patch = await api(token, 'PATCH', `/api/conkay/assemblies/${assemblyId}/gdt/${annId}`, {
  tolerance: '0.02',
});
const drawing = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.json`);
const svg = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.svg`, null, { raw: true });
const del = await api(token, 'DELETE', `/api/conkay/assemblies/${assemblyId}/gdt/${add2.data?.annotation?.id}`);

const gdtInDrawing = (drawing.data?.gdt || []).length >= 1;
const svgHasGdt = svg.text?.includes('class="gdt"') && (svg.text?.includes('⊥') || svg.text?.includes('⌖'));

const ok =
  created.data?.ok &&
  a1.data?.ok &&
  add1.data?.ok &&
  add1.data?.annotation?.symbol === '⊥' &&
  add2.data?.ok &&
  list.data?.ok &&
  (list.data?.gdt?.length || 0) >= 2 &&
  patch.data?.ok &&
  patch.data?.annotation?.tolerance === '0.02' &&
  drawing.data?.ok &&
  gdtInDrawing &&
  svg.status === 200 &&
  svgHasGdt &&
  del.data?.ok;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'gdt-drafting-annotations',
  honesty: {
    note: 'Feature control frames as drafting overlays on projected views. NOT CMM-certified GD&T solver.',
  },
  assemblyId,
  steps: {
    create: { status: created.status, ok: created.data?.ok },
    addPart: { ok: a1.data?.ok },
    addGdt: {
      ok: add1.data?.ok,
      symbol: add1.data?.annotation?.symbol,
      second: add2.data?.annotation?.symbol,
    },
    list: { ok: list.data?.ok, count: list.data?.gdt?.length, symbols: list.data?.symbols },
    patch: { ok: patch.data?.ok, tolerance: patch.data?.annotation?.tolerance },
    drawing: {
      ok: drawing.data?.ok,
      gdtCount: drawing.data?.gdt?.length,
      viewGdt: drawing.data?.views?.map((v) => ({ name: v.name, gdt: v.gdt?.length })),
    },
    svg: { status: svg.status, hasGdtClass: svg.text?.includes('class="gdt"'), hasPerp: svg.text?.includes('⊥') },
    delete: { ok: del.data?.ok },
  },
  routes: [
    'GET/POST /api/conkay/assemblies/:id/gdt',
    'PATCH/DELETE /api/conkay/assemblies/:id/gdt/:annId',
  ],
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, steps: proof.steps }, null, 2));
process.exit(ok ? 0 : 2);
