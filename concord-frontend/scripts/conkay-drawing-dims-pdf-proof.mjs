/**
 * ConKay drawing dims + PDF pack proof.
 * Honesty: auto overall dims + user dims + PDF — not CMM GD&T / industrial sheets.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-drawing-dims-pdf-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayDimsPdf' },
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
      'User-Agent': 'Mozilla/5.0 ConKayDimsPdf',
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
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'dims-pdf-proof' });
const assemblyId = created.data?.assembly?.id;
const a1 = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
  text: 'steel I-beam 6m',
  name: 'beam-a',
});
const userDim = await api(token, 'POST', `/api/conkay/assemblies/${assemblyId}/dimensions`, {
  view: 'front',
  x1: 0,
  y1: 0,
  x2: 1.5,
  y2: 0,
  label: '1.5',
});
const json = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.json`);
const svg = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.svg`, null, { raw: true });
const pdf = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/drawing.pdf`, null, { raw: true });

const views = json.data?.views || [];
const hasAutoDims = views.every((v) => Array.isArray(v.dimensions) && v.dimensions.some((d) => d.auto));
const hasUserDim = Array.isArray(json.data?.dimensions) && json.data.dimensions.length >= 1;
const svgOk =
  svg.status === 200 &&
  svg.text.includes('<svg') &&
  svg.text.includes('class="dim"') &&
  svg.text.includes('polygon');
const pdfOk = pdf.status === 200 && pdf.buf?.length > 500 && pdf.buf.slice(0, 4).toString() === '%PDF';

const ok =
  created.status === 200 &&
  a1.data?.ok &&
  userDim.data?.ok &&
  json.data?.ok &&
  hasAutoDims &&
  hasUserDim &&
  svgOk &&
  pdfOk;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'drawing-dims-pdf-pack',
  honesty: {
    note: 'Auto overall X/Y dims + user dims API + multi-page PDF. NOT CMM GD&T / industrial drafting CAD.',
  },
  assemblyId,
  steps: {
    create: { status: created.status, ok: created.data?.ok },
    add: { status: a1.status, ok: a1.data?.ok },
    userDim: { status: userDim.status, ok: userDim.data?.ok, id: userDim.data?.dimension?.id },
    drawingJson: {
      status: json.status,
      ok: json.data?.ok,
      views: views.map((v) => ({
        name: v.name,
        edgeCount: v.edgeCount,
        dimCount: v.dimensions?.length,
        autoDims: v.dimensions?.filter((d) => d.auto).length,
      })),
      userDims: json.data?.dimensions?.length,
    },
    drawingSvg: {
      status: svg.status,
      bytes: svg.buf?.length,
      hasDimClass: svg.text?.includes('class="dim"'),
      hasArrows: svg.text?.includes('polygon'),
    },
    drawingPdf: {
      status: pdf.status,
      bytes: pdf.buf?.length,
      isPdf: pdf.buf?.slice(0, 4).toString() === '%PDF',
      pagesHeader: pdf.headers?.['x-conkay-drawing-pages'],
    },
  },
  overlay: { buttons: ['ck-export-drawing', 'ck-export-drawing-pdf'] },
  routes: [
    'GET /api/conkay/assemblies/:id/drawing.json',
    'GET /api/conkay/assemblies/:id/drawing.svg',
    'GET /api/conkay/assemblies/:id/drawing.pdf',
    'POST /api/conkay/assemblies/:id/dimensions',
  ],
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, steps: proof.steps }, null, 2));
process.exit(ok ? 0 : 2);
