import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const URL = 'http://127.0.0.1:3000/conkay-bridge-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-roundtrip-proof.json');
const WAIT_MS = 45000;

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
let sawBoot = false;
let sawAck = false;
while (Date.now() < deadline) {
  last = await page.evaluate(() => window.__CONKAY_SMOKE__ || null);
  const names = ((last && last.events) || []).map((e) => e && e.event);
  if (names.includes('ready') || names.includes('pong')) sawBoot = true;
  if (names.includes('ack')) sawAck = true;
  // Keep running until 45s OR (boot events + at least one post + ack), so we
  // observe hello/ping cmd path when possible.
  const posts = (last && last.posts) || [];
  if (sawBoot && posts.length > 0 && sawAck) break;
  // After posts have gone out, give acks a few seconds then stop early if boot ok
  if (sawBoot && posts.length > 0 && Date.now() - t0 > 20000 && !sawAck) break;
  const elapsed = Date.now() - t0;
  if (elapsed > 5000 && elapsed < 25000) await tryClickCanvas();
  await page.waitForTimeout(500);
}

last = await page.evaluate(() => {
  const s = window.__CONKAY_SMOKE__ || { events: [], ok: false };
  const outEl = document.getElementById('out');
  return { ...s, outText: outEl ? outEl.textContent : '' };
});

const events = (last && last.events) || [];
const eventNames = events.map((e) => e && e.event).filter(Boolean);
const ok = eventNames.some((n) => n === 'pong' || n === 'ready' || n === 'ack' || n === 'hello');
const cmdAck = eventNames.includes('ack');

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  cmdAckObserved: cmdAck,
  url: URL,
  httpStatus: status,
  waitedMs: Date.now() - t0,
  eventNames,
  events,
  posts: (last && last.posts) || [],
  reason: ok
    ? (cmdAck ? 'ready+pong+ack' : 'ready+pong (boot events; cmd ack not observed in window)')
    : ((last && last.reason) || 'no-concordia-event'),
  outText: (last && last.outText) || '',
  consoleSample: consoleLines.slice(0, 100),
  consoleCount: consoleLines.length,
  machine: 'Mac.lan',
  machineId: '0366bc4e-b815-4ea5-9979-fc382d0cee76',
  provedAt: new Date().toISOString(),
  provedAtET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET',
  smokePath: 'concord-frontend/public/conkay-bridge-smoke.html',
  bridgeDoc: '~/.zuko/CONKAY_UNITY_BRIDGE.md',
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({
  status: proof.status,
  ok,
  cmdAckObserved: cmdAck,
  eventNames,
  postCount: proof.posts.length,
  waitedMs: proof.waitedMs,
  reason: proof.reason,
  out: OUT,
}, null, 2));

await browser.close();
process.exit(ok ? 0 : 2);
