/**
 * ConKay CAD Wave 2 proof: assembly → STL download + BOM JSON.
 * Honesty: STL+BOM LIVE for triangle-mesh parts — not full CAD suite / STEP.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-export-bom-proof.json');
const API = 'http://127.0.0.1:5050';

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayExportProof' },
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
      'User-Agent': 'Mozilla/5.0 ConKayExportProof',
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
      size: buf.length,
    };
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const token = await login();
const created = await api(token, 'POST', '/api/conkay/assemblies', { name: 'wave2-export-proof' });
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

const bom = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/bom`);
const partStl = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/parts/${partId}/stl`, null, { raw: true });
const asmStl = await api(token, 'GET', `/api/conkay/assemblies/${assemblyId}/stl`, null, { raw: true });

function stlLooksBinary(buf) {
  if (!buf || buf.length < 84) return false;
  const tri = buf.readUInt32LE(80);
  const expected = 84 + tri * 50;
  return tri > 0 && buf.length === expected;
}

const partStlOk = partStl.status === 200 && stlLooksBinary(partStl.buf);
const asmStlOk = asmStl.status === 200 && stlLooksBinary(asmStl.buf);
const bomOk = !!bom.data?.ok && (bom.data?.totalParts || 0) >= 2 && Array.isArray(bom.data?.lines);

const proof = {
  ok: !!(partStlOk && asmStlOk && bomOk && add1.data?.ok && add2.data?.ok),
  wave: 2,
  status: partStlOk && asmStlOk && bomOk ? 'LIVE' : 'FAIL',
  claim: 'STL+BOM LIVE for triangle-mesh assembly parts. NOT full CAD suite / STEP import.',
  ts: new Date().toISOString(),
  assemblyId,
  parts: {
    add1: { ok: !!add1.data?.ok, kind: add1.data?.part?.kind, verts: add1.data?.part?.mesh?.vertexCount },
    add2: { ok: !!add2.data?.ok, kind: add2.data?.part?.kind, verts: add2.data?.part?.mesh?.vertexCount },
  },
  bom: {
    ok: bomOk,
    status: bom.status,
    totalParts: bom.data?.totalParts,
    lines: bom.data?.lines,
    sampleParts: (bom.data?.parts || []).map((p) => ({
      id: p.id,
      kind: p.kind,
      material: p.material,
      qty: p.qty,
    })),
  },
  stl: {
    part: {
      ok: partStlOk,
      status: partStl.status,
      size: partStl.size,
      triangleCount: partStl.headers?.['x-conkay-triangle-count'],
      contentType: partStl.headers?.['content-type'],
    },
    assembly: {
      ok: asmStlOk,
      status: asmStl.status,
      size: asmStl.size,
      triangleCount: asmStl.headers?.['x-conkay-triangle-count'],
      included: asmStl.headers?.['x-conkay-included-parts'],
      contentType: asmStl.headers?.['content-type'],
    },
  },
  honesty: {
    wave: 2,
    note: 'Binary STL via meshToSTL; BOM grouped by kind+material. GLB-only parts skipped for STL.',
    notClaimed: ['STEP import/export', 'full mates', 'ERP BOM'],
  },
};

fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: proof.ok, bom: bomOk, partStl: partStlOk, asmStl: asmStlOk, sizes: { part: partStl.size, asm: asmStl.size } }, null, 2));
console.log('Wrote', OUT);
process.exit(proof.ok ? 0 : 1);
