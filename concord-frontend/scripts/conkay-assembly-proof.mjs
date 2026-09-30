/**
 * ConKay CAD Wave 1 proof:
 *   Stage A: auth → create assembly → add 2 parts (NLP mesh) → transform part
 *   Stage B: Playwright smoke → 2× apply_mesh → revise transform → mesh_applied
 *
 * Honesty: ASSEMBLY LIVE — not full CAD suite.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseDesignIntent,
  intentToPartMeshParams,
  buildPartMesh,
  feaUtilToColor,
} from '../../server/lib/conkay/nlp-design-intent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SMOKE_URL = 'http://127.0.0.1:3000/conkay-assembly-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-cad-assembly-proof.json');
const WAIT_MS = 70000;
const API = 'http://127.0.0.1:5050';

function meshForText(text, id, position, color) {
  const parsed = parseDesignIntent(text);
  if (!parsed.ok) throw new Error(`NLP fail for ${text}: ${parsed.error}`);
  const { kind, params } = intentToPartMeshParams(parsed.intent);
  const mesh = buildPartMesh(kind, params);
  return {
    id,
    name: kind,
    kind,
    text,
    intent: parsed.intent,
    positions: mesh.positions,
    indices: mesh.indices,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    position,
    scale: 1,
    color: color || feaUtilToColor(0.125).hex,
  };
}

async function login() {
  const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
  if (!fs.existsSync(userFile)) return { ok: false, error: 'no_audit_user' };
  const creds = Object.fromEntries(
    fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
  );
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayAsmProof' },
    body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
  });
  const login = await loginRes.json();
  if (!login?.token) return { ok: false, error: 'login_failed', status: loginRes.status, body: login };
  return { ok: true, token: login.token, user: login.user || null };
}

async function apiJson(token, method, urlPath, body) {
  const r = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 ConKayAsmProof',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function stageApi() {
  const t0 = Date.now();
  const auth = await login();
  if (!auth.ok) return { ok: false, error: auth.error, auth };
  const token = auth.token;

  const created = await apiJson(token, 'POST', '/api/conkay/assemblies', { name: 'wave1-proof-assembly' });
  if (!created.data?.ok || !created.data?.assembly?.id) {
    return { ok: false, error: 'create_failed', created, ms: Date.now() - t0 };
  }
  const assemblyId = created.data.assembly.id;

  const add1 = await apiJson(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
    text: 'simply supported steel I-beam 6m, 5kN midspan',
    name: 'beam-a',
    transform: { position: { x: 0, y: 1.2, z: 0 } },
  });
  const add2 = await apiJson(token, 'POST', `/api/conkay/assemblies/${assemblyId}/parts`, {
    text: 'steel box beam 4m',
    name: 'beam-b',
    transform: { position: { x: 1.5, y: 1.2, z: 0 } },
  });

  const partsBefore = await apiJson(token, 'GET', `/api/conkay/assemblies/${assemblyId}/parts`);
  const partA = add1.data?.part;
  if (!partA?.id) {
    return { ok: false, error: 'add_parts_failed', add1, add2, ms: Date.now() - t0 };
  }

  const revisePos = { x: 2.5, y: 1.2, z: 0.5 };
  const xf = await apiJson(token, 'PATCH', `/api/conkay/assemblies/${assemblyId}/parts/${partA.id}`, {
    transform: { position: revisePos },
  });
  const reviseChat = await apiJson(token, 'POST', `/api/conkay/assemblies/${assemblyId}/revise`, {
    text: `move part ${partA.id} to 2.5,1.2,0.5`,
  });

  const listed = await apiJson(token, 'GET', `/api/conkay/assemblies/${assemblyId}`);
  const nParts = listed.data?.parts?.length ?? partsBefore.data?.parts?.length ?? 0;

  const ok =
    !!created.data?.ok &&
    !!add1.data?.ok &&
    !!add2.data?.ok &&
    nParts >= 2 &&
    (!!xf.data?.ok || !!reviseChat.data?.ok) &&
    Number(xf.data?.part?.transform?.position?.x) === 2.5;

  return {
    ok,
    ms: Date.now() - t0,
    assemblyId,
    partIds: (listed.data?.parts || []).map((p) => p.id),
    partsCount: nParts,
    create: { status: created.status, id: assemblyId },
    add1: { status: add1.status, ok: !!add1.data?.ok, kind: add1.data?.part?.kind, verts: add1.data?.part?.mesh?.vertexCount },
    add2: { status: add2.status, ok: !!add2.data?.ok, kind: add2.data?.part?.kind, verts: add2.data?.part?.mesh?.vertexCount },
    transform: {
      status: xf.status,
      ok: !!xf.data?.ok,
      position: xf.data?.part?.transform?.position,
      reviseChatOk: !!reviseChat.data?.ok,
      reviseAction: reviseChat.data?.action,
    },
    honesty: 'server assembly store + transform ack',
  };
}

async function stageUnity(apiStage) {
  const t0 = Date.now();
  const partA = meshForText(
    'simply supported steel I-beam 6m, 5kN midspan',
    (apiStage.partIds && apiStage.partIds[0]) || 'proof-part-a',
    { x: 0, y: 1.2, z: 0 },
    '#22c55e',
  );
  const partB = meshForText(
    'steel tube 3m',
    (apiStage.partIds && apiStage.partIds[1]) || 'proof-part-b',
    { x: 1.5, y: 1.2, z: 0 },
    '#3b82f6',
  );
  // box beam may fail NLP — tube is safer for part B client mesh; API may have used box
  const bundle = {
    assemblyId: apiStage.assemblyId || null,
    parts: [partA, partB],
    revisePosition: { x: 2.5, y: 1.2, z: 0.5 },
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleLines.push({ type: 'pageerror', text: String(err) }));

  const resp = await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const status = resp ? resp.status() : null;
  await page.evaluate((b) => { window.__ASSEMBLY_BUNDLE__ = b; }, bundle);

  let last = null;
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__CONKAY_ASSEMBLY_SMOKE__ || null);
    if (last?.ok) break;
    const elapsed = Date.now() - t0;
    if (elapsed > 8000 && elapsed < 25000) {
      await page.evaluate((b) => {
        window.__ASSEMBLY_BUNDLE__ = b;
        const s = window.__CONKAY_ASSEMBLY_SMOKE__;
        const posts = (s && s.posts) || [];
        const hasApply = posts.some((p) => p && p.cmd === 'apply_mesh');
        if (!hasApply && typeof window.__START_ASSEMBLY__ === 'function') {
          window.__START_ASSEMBLY__(b);
        }
      }, bundle);
    }
    try {
      const frame = page.frameLocator('#concordia-unity-webgl');
      const canvas = frame.locator('#unity-canvas, canvas').first();
      if (await canvas.count()) await canvas.click({ timeout: 1000 }).catch(() => {});
    } catch { /* ignore */ }
    await page.waitForTimeout(500);
  }

  await browser.close();

  const events = (last && last.events) || [];
  const names = events.map((e) => e && e.event);
  const meshApplied = events.filter((e) => e && e.event === 'mesh_applied');
  const ok = !!(last && last.ok && meshApplied.length >= 2 && last.reviseAck);

  return {
    ok,
    ms: Date.now() - t0,
    httpStatus: status,
    eventNames: names,
    meshAppliedCount: meshApplied.length,
    reviseAck: !!(last && last.reviseAck),
    reason: last?.reason || null,
    revisePosition: last?.revisePosition || bundle.revisePosition,
    posts: ((last && last.posts) || []).map((p) => ({ cmd: p.cmd, id: p.id })),
    sampleMeshApplied: meshApplied.slice(0, 3).map((e) => ({
      id: e.id,
      vertexCount: e.payload?.vertexCount,
      position: e.payload?.position,
      name: e.payload?.name,
    })),
    consoleTail: consoleLines.slice(-20),
    honesty: 'Unity multi-part apply_mesh + revise via re-apply/set_transform',
  };
}

const apiStage = await stageApi();
console.log('API stage', JSON.stringify({ ok: apiStage.ok, parts: apiStage.partsCount, xf: apiStage.transform }, null, 2));

let unityStage = { ok: false, error: 'skipped_api_failed' };
if (apiStage.ok || process.env.CONKAY_ASM_UNITY_ALWAYS === '1') {
  unityStage = await stageUnity(apiStage.ok ? apiStage : { partIds: ['proof-part-a', 'proof-part-b'] });
  console.log('Unity stage', JSON.stringify({ ok: unityStage.ok, meshApplied: unityStage.meshAppliedCount, reviseAck: unityStage.reviseAck }, null, 2));
} else {
  // Still try Unity with local meshes — assembly store may have failed independently
  unityStage = await stageUnity({ partIds: ['proof-part-a', 'proof-part-b'] });
}

const proof = {
  ok: !!(apiStage.ok && unityStage.ok),
  wave: 1,
  status: apiStage.ok && unityStage.ok ? 'LIVE' : 'PARTIAL_OR_FAIL',
  claim: 'ASSEMBLY LIVE — multi-part store + Unity apply_mesh + revise transform. NOT full CAD suite.',
  ts: new Date().toISOString(),
  api: apiStage,
  unity: unityStage,
  paths: {
    smoke: '/conkay-assembly-smoke.html',
    proof: OUT,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log('Wrote', OUT, 'ok=', proof.ok);
process.exit(proof.ok ? 0 : 1);
