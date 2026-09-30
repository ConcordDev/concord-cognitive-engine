/**
 * ConKay load_glb smoke proof:
 *   hello/ping → load_glb(absolute same-origin furniture_table.glb)
 *   → wait glb_loaded { ok, name, url }.
 *
 * Honesty: runtime URL fetch via Unity glTFast — NOT evo-asset.generate→world auto-wire.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:3000/conkay-glb-smoke.html';
const GLB_URL = 'http://127.0.0.1:3000/models/prop/furniture_table.glb';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-glb-load-proof.json');
const WAIT_MS = 70000;

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

await page.evaluate((u) => { window.__GLB_URL__ = u; }, GLB_URL);

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
  last = await page.evaluate(() => window.__CONKAY_GLB_SMOKE__ || null);
  const names = ((last && last.events) || []).map((e) => e && e.event);
  if (names.includes('glb_loaded') && last.ok) break;
  const elapsed = Date.now() - t0;
  if (elapsed > 9000 && elapsed < 35000) {
    await page.evaluate((u) => {
      window.__GLB_URL__ = u;
      if (typeof window.__START_GLB_LOAD__ === 'function') {
        const s = window.__CONKAY_GLB_SMOKE__;
        const posts = (s && s.posts) || [];
        const hasLoad = posts.some((p) => p && p.cmd === 'load_glb');
        const hasLoaded = ((s && s.events) || []).some((e) => e && e.event === 'glb_loaded');
        if (!hasLoad && !hasLoaded) window.__START_GLB_LOAD__(u);
      }
    }, GLB_URL);
    await tryClickCanvas();
  }
  await page.waitForTimeout(500);
}

last = await page.evaluate(() => {
  const s = window.__CONKAY_GLB_SMOKE__ || { events: [], ok: false };
  const outEl = document.getElementById('out');
  return { ...s, outText: outEl ? outEl.textContent : '' };
});

const events = (last && last.events) || [];
const eventNames = events.map((e) => e && e.event).filter(Boolean);
const loadedEvents = events.filter((e) => e && e.event === 'glb_loaded');
const ackEvents = events.filter((e) => e && e.event === 'ack');
const errorEvents = events.filter((e) => e && e.event === 'error');
const posts = (last && last.posts) || [];

const sample = loadedEvents[0] || null;
const payload = sample && sample.payload ? sample.payload : null;
const urlMatch = !!(payload && typeof payload.url === 'string' && payload.url.includes('furniture_table.glb'));
const payloadOk = !!(payload && payload.ok === true && payload.name);

const ok = loadedEvents.length > 0
  && payloadOk
  && urlMatch
  && errorEvents.length === 0;

const proof = {
  status: ok ? 'LIVE' : (loadedEvents.length || errorEvents.length ? 'PARTIAL' : 'FAILED'),
  ok,
  slice: 'conkay-load_glb-gltfast-url',
  honesty: {
    meshMode: 'load_glb',
    note: 'Runtime Unity glTFast URL fetch → GameObject under ConKayTemp. Not full evo-asset.generate→world auto-wire. apply_mesh path unchanged.',
    webglRebuild: true,
    cmds: ['load_glb'],
    package: 'com.unity.cloud.gltfast 6.14.1',
  },
  glb: {
    url: GLB_URL,
    postedUrl: (posts.find((p) => p && p.cmd === 'load_glb') || {}).payload?.url || null,
  },
  unity: {
    glbLoadedCount: loadedEvents.length,
    glbLoadedSample: sample,
    ackCount: ackEvents.length,
    errorCount: errorEvents.length,
    errorSample: errorEvents[0] || null,
    eventNames,
    urlMatch,
    payloadOk,
  },
  url: URL,
  httpStatus: status,
  waitedMs: Date.now() - t0,
  posts: posts.map((p) => p.cmd),
  reason: ok
    ? 'load_glb+glb_loaded+url-match'
    : (!loadedEvents.length
      ? (errorEvents.length ? `error:${(errorEvents[0].payload && errorEvents[0].payload.reason) || 'unknown'}` : 'no-glb_loaded')
      : (!urlMatch ? 'glb_loaded-but-url-mismatch' : 'unknown')),
  outText: (last && last.outText) || '',
  consoleSample: consoleLines.slice(0, 50),
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: proof.ok, status: proof.status, reason: proof.reason, eventNames, out: OUT }, null, 2));

await browser.close();
process.exit(ok ? 0 : 2);
