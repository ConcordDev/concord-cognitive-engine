/**
 * ConKay NLP CAD smoke proof:
 *   free text → parseDesignIntent → partMesh-shaped mesh → Unity apply_mesh
 *   → mesh_applied. Honesty: NLP intent → deterministic mesh — NOT industrial CAD / GLB.
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
  intentToFeaModel,
} from '../../server/lib/conkay/nlp-design-intent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:3000/conkay-nlp-cad-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-nlp-cad-proof.json');
const WAIT_MS = 50000;
const FREE_TEXT = process.env.CONKAY_NLP_TEXT || 'simply supported steel I-beam 6m, 5kN midspan';

const parsed = parseDesignIntent(FREE_TEXT);
if (!parsed.ok) {
  console.error('NLP parse failed', parsed);
  process.exit(2);
}
const { kind, params } = intentToPartMeshParams(parsed.intent);
const meshBuilt = buildPartMesh(kind, params);

// Optional FEA tint via direct solver (same path as server route)
let utilColor = feaUtilToColor(0.125);
let feaSummary = null;
try {
  const { runFEA } = await import('../../server/lib/simulation/fea-solver.js');
  const model = intentToFeaModel(parsed.intent);
  const fea = runFEA(model);
  const maxU = Number(fea?.summary?.maxUtilization);
  if (Number.isFinite(maxU)) {
    utilColor = feaUtilToColor(maxU);
    feaSummary = { maxUtilization: maxU, band: utilColor.band, jobId: fea.jobId ?? null };
  }
} catch (e) {
  console.warn('FEA tint skipped:', e?.message || e);
}

const bundle = {
  freeText: FREE_TEXT,
  intent: parsed.intent,
  mesh: {
    ...meshBuilt,
    color: utilColor.hex,
    id: 'proof-nlp-ibeam',
    position: { x: 0, y: 1.2, z: 0 },
    scale: 1,
    source: 'nlp-design-intent→buildPartMesh',
  },
  fea: feaSummary,
  utilColor,
};

console.log('NLP text=', FREE_TEXT);
console.log('intent=', JSON.stringify({ part: parsed.intent.part, spans: parsed.intent.spans, material: parsed.intent.material, meshKind: parsed.intent.meshKind }));
console.log('mesh kind=', bundle.mesh.kind, 'verts=', bundle.mesh.vertexCount, 'tris=', bundle.mesh.triangleCount, 'color=', bundle.mesh.color);

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

await page.evaluate((b) => { window.__NLP_CAD__ = b; }, bundle);

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
  last = await page.evaluate(() => window.__CONKAY_NLP_CAD_SMOKE__ || null);
  const names = ((last && last.events) || []).map((e) => e && e.event);
  if (names.includes('mesh_applied') && last.ok) break;
  const elapsed = Date.now() - t0;
  if (elapsed > 9000 && elapsed < 22000) {
    await page.evaluate((b) => {
      window.__NLP_CAD__ = b;
      if (typeof window.__START_NLP_CAD__ === 'function') {
        const s = window.__CONKAY_NLP_CAD_SMOKE__;
        const posts = (s && s.posts) || [];
        const hasApply = posts.some((p) => p && p.cmd === 'apply_mesh');
        if (!hasApply) window.__START_NLP_CAD__(b);
      }
    }, bundle);
    await tryClickCanvas();
  }
  await page.waitForTimeout(500);
}

last = await page.evaluate(() => {
  const s = window.__CONKAY_NLP_CAD_SMOKE__ || { events: [], ok: false };
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
  && Number(payload.vertexCount) === bundle.mesh.vertexCount
  && Number(payload.triangleCount) === bundle.mesh.triangleCount);

const ok = appliedEvents.length > 0
  && vertsMatch
  && !!parsed.intent
  && bundle.mesh.vertexCount > 0
  && errorEvents.length === 0;

const proof = {
  status: ok ? 'LIVE' : (appliedEvents.length ? 'PARTIAL' : 'FAILED'),
  ok,
  slice: 'nlp-cad-free-text→intent→partMesh→apply_mesh',
  honesty: {
    meshMode: 'apply_mesh',
    note: 'Free-text NLP intent → deterministic FEA/partMesh → Unity apply_mesh. NOT industrial CAD suite. GLB not yet.',
    glb: false,
    nlp: 'regex/slot parser (no LLM required)',
  },
  freeText: FREE_TEXT,
  intent: parsed.intent,
  fea: feaSummary,
  utilColor,
  mesh: {
    source: bundle.mesh.source,
    kind: bundle.mesh.kind,
    vertexCount: bundle.mesh.vertexCount,
    triangleCount: bundle.mesh.triangleCount,
    positionsLen: bundle.mesh.positions.length,
    indicesLen: bundle.mesh.indices.length,
    color: bundle.mesh.color,
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
    ? 'nlp+apply_mesh+mesh_applied+verts-match'
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
