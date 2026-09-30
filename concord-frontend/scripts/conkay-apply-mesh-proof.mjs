/**
 * ConKay apply_mesh smoke proof:
 *   engineering.partMesh (i-beam) positions/indices → Unity apply_mesh
 *   → mesh_applied event with vertex/triangle counts.
 *
 * Honesty: real MeshFilter triangle push — NOT full CAD / GLB / free-text.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:3000/conkay-apply-mesh-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-apply-mesh-proof.json');
const WAIT_MS = 50000;

/** Mirror server/domains/engineering.js partMesh i-beam (deterministic). */
function buildIBeamMesh(params = {}) {
  const bf = params.flangeWidth || 0.1;
  const dh = params.height || 0.2;
  const tf = params.flangeThickness || 0.012;
  const tw = params.webThickness || 0.008;
  const len = params.length || 1.0;
  const L = len / 2;
  const positions = [];
  const indices = [];
  const pushQuad = (a, b, c, d) => {
    const base = positions.length / 3;
    for (const v of [a, b, c, d]) positions.push(v[0], v[1], v[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const flange = (yc) => {
    const verts = [
      [-bf / 2, yc - tf / 2, -L], [bf / 2, yc - tf / 2, -L],
      [bf / 2, yc + tf / 2, -L], [-bf / 2, yc + tf / 2, -L],
      [-bf / 2, yc - tf / 2, L], [bf / 2, yc - tf / 2, L],
      [bf / 2, yc + tf / 2, L], [-bf / 2, yc + tf / 2, L],
    ];
    pushQuad(verts[0], verts[1], verts[2], verts[3]);
    pushQuad(verts[5], verts[4], verts[7], verts[6]);
    pushQuad(verts[4], verts[0], verts[3], verts[7]);
    pushQuad(verts[1], verts[5], verts[6], verts[2]);
    pushQuad(verts[3], verts[2], verts[6], verts[7]);
    pushQuad(verts[4], verts[5], verts[1], verts[0]);
  };
  flange(dh / 2 - tf / 2);
  flange(-dh / 2 + tf / 2);
  const wy = (dh - 2 * tf) / 2;
  const webV = [
    [-tw / 2, -wy, -L], [tw / 2, -wy, -L], [tw / 2, wy, -L], [-tw / 2, wy, -L],
    [-tw / 2, -wy, L], [tw / 2, -wy, L], [tw / 2, wy, L], [-tw / 2, wy, L],
  ];
  pushQuad(webV[0], webV[1], webV[2], webV[3]);
  pushQuad(webV[5], webV[4], webV[7], webV[6]);
  pushQuad(webV[4], webV[0], webV[3], webV[7]);
  pushQuad(webV[1], webV[5], webV[6], webV[2]);
  const round = (v) => Math.round(v * 1e6) / 1e6;
  return {
    kind: 'i-beam',
    positions: positions.map(round),
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    source: 'mirrored-engineering.partMesh-i-beam',
    color: '#22c55e',
    id: 'proof-i-beam',
    position: { x: 0, y: 1.2, z: 0 },
    scale: 1,
  };
}

const mesh = buildIBeamMesh();
console.log('mesh kind=', mesh.kind, 'verts=', mesh.vertexCount, 'tris=', mesh.triangleCount);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

const consoleLines = [];
page.on('console', (msg) => consoleLines.push({ type: msg.type(), text: msg.text() }));
page.on('pageerror', (err) => consoleLines.push({ type: 'pageerror', text: String(err) }));

const t0 = Date.now();
const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
const status = resp ? resp.status() : null;

await page.evaluate((m) => { window.__APPLY_MESH__ = m; }, mesh);

async function tryClickCanvas() {
  try {
    const frame = page.frameLocator('#concordia-unity-webgl');
    const canvas = frame.locator('#unity-canvas, canvas').first();
    if (await canvas.count()) {
      await canvas.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  } catch {}
  try { await page.locator('#concordia-unity-webgl').click({ timeout: 1000 }); } catch {}
  return false;
}

let last = null;
const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  last = await page.evaluate(() => window.__CONKAY_APPLY_MESH_SMOKE__ || null);
  const names = ((last && last.events) || []).map((e) => e && e.event);
  if (names.includes('mesh_applied') && last.ok) break;
  const elapsed = Date.now() - t0;
  if (elapsed > 9000 && elapsed < 22000) {
    await page.evaluate((m) => {
      window.__APPLY_MESH__ = m;
      if (typeof window.__START_APPLY_MESH__ === 'function') {
        const s = window.__CONKAY_APPLY_MESH_SMOKE__;
        const posts = (s && s.posts) || [];
        const hasApply = posts.some((p) => p && p.cmd === 'apply_mesh');
        if (!hasApply) window.__START_APPLY_MESH__(m);
      }
    }, mesh);
    await tryClickCanvas();
  }
  await page.waitForTimeout(500);
}

last = await page.evaluate(() => {
  const s = window.__CONKAY_APPLY_MESH_SMOKE__ || { events: [], ok: false };
  const outEl = document.getElementById('out');
  return { ...s, outText: outEl ? outEl.textContent : '' };
});

const events = (last && last.events) || [];
const eventNames = events.map((e) => e && e.event).filter(Boolean);
const appliedEvents = events.filter((e) => e && e.event === 'mesh_applied');
const ackEvents = events.filter((e) => e && e.event === 'ack');
const errorEvents = events.filter((e) => e && e.event === 'error');
const posts = (last && last.posts) || [];

const sample = appliedEvents[0] || null;
const payload = sample && sample.payload ? sample.payload : null;
const vertsMatch = !!(payload
  && Number(payload.vertexCount) === mesh.vertexCount
  && Number(payload.triangleCount) === mesh.triangleCount);

const ok = appliedEvents.length > 0
  && vertsMatch
  && mesh.vertexCount > 0
  && mesh.triangleCount > 0
  && errorEvents.length === 0;

const proof = {
  status: ok ? 'LIVE' : (appliedEvents.length ? 'PARTIAL' : 'FAILED'),
  ok,
  slice: 'industrial-apply_mesh-partMesh-i-beam',
  honesty: {
    meshMode: 'apply_mesh',
    note: 'Real Unity MeshFilter from engineering.partMesh-shaped positions/indices. Not full CAD / GLB / free-text. Cube proxy superseded for this path.',
    webglRebuild: true,
    cmds: ['apply_mesh', 'spawn_from_spec'],
  },
  mesh: {
    source: mesh.source,
    kind: mesh.kind,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    positionsLen: mesh.positions.length,
    indicesLen: mesh.indices.length,
    color: mesh.color,
  },
  unity: {
    meshAppliedCount: appliedEvents.length,
    meshAppliedSample: sample,
    ackCount: ackEvents.length,
    errorCount: errorEvents.length,
    errorSample: errorEvents[0] || null,
    eventNames,
    vertsMatch,
  },
  url: URL,
  httpStatus: status,
  waitedMs: Date.now() - t0,
  posts: posts.map((p) => p.cmd),
  reason: ok
    ? 'apply_mesh+mesh_applied+verts-match'
    : (!appliedEvents.length
      ? 'no-mesh_applied'
      : (!vertsMatch ? 'mesh_applied-but-count-mismatch' : 'unknown')),
  outText: (last && last.outText) || '',
  consoleSample: consoleLines.slice(0, 40),
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: proof.ok, status: proof.status, reason: proof.reason, eventNames, out: OUT }, null, 2));

await browser.close();
process.exit(ok ? 0 : 2);
