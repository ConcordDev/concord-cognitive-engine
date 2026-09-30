/**
 * ConKay set_transform player-LIVE proof:
 *   apply_mesh → mesh_applied → set_transform → transform_set
 * Honesty: transform_set event (not clear+redraw / re-apply_mesh).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SMOKE_URL = process.env.CONKAY_SMOKE_URL || 'http://127.0.0.1:3001/conkay-set-transform-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-set-transform-proof.json');
const WAIT_MS = 70000;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleSample = [];
page.on('console', (msg) => {
  if (consoleSample.length < 20) consoleSample.push({ type: msg.type(), text: msg.text().slice(0, 240) });
});

const t0 = Date.now();
const resp = await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const httpStatus = resp?.status() ?? 0;

let state = null;
try {
  await page.waitForFunction(() => {
    const s = window.__CONKAY_SET_TRANSFORM_SMOKE__;
    return s && (s.ok === true || (s.finishedAt != null));
  }, { timeout: WAIT_MS });
  state = await page.evaluate(() => window.__CONKAY_SET_TRANSFORM_SMOKE__);
} catch (e) {
  state = await page.evaluate(() => window.__CONKAY_SET_TRANSFORM_SMOKE__ || { ok: false, reason: 'wait_failed:' + String(e) });
}

const outText = await page.locator('#out').innerText().catch(() => '');
const eventNames = (state?.events || []).map((e) => e.event);
const transformEvents = (state?.events || []).filter((e) => e.event === 'transform_set');
const meshEvents = (state?.events || []).filter((e) => e.event === 'mesh_applied');
const reApplyAfterTransform = (state?.posts || []).filter((p) => p.cmd === 'apply_mesh').length > 1;

const ok =
  !!state?.ok &&
  meshEvents.length >= 1 &&
  transformEvents.length >= 1 &&
  eventNames.includes('transform_set') &&
  !reApplyAfterTransform;

const proof = {
  status: ok ? 'LIVE' : 'PARTIAL',
  ok,
  slice: 'set_transform-player-LIVE',
  honesty: {
    note: 'apply_mesh → set_transform → transform_set (not re-apply_mesh revise path)',
    webglRebuild: true,
    cmds: ['apply_mesh', 'set_transform'],
    events: ['mesh_applied', 'transform_set'],
  },
  unity: {
    meshAppliedCount: meshEvents.length,
    transformSetCount: transformEvents.length,
    transformSetSample: transformEvents[0] || null,
    meshAppliedSample: meshEvents[0] || null,
    eventNames,
    reApplyAfterTransform,
    errorCount: (state?.events || []).filter((e) => e.event === 'error').length,
  },
  url: SMOKE_URL,
  httpStatus,
  waitedMs: Date.now() - t0,
  posts: (state?.posts || []).map((p) => p.cmd),
  reason: state?.reason || (ok ? 'ok' : 'failed'),
  outText: outText.slice(0, 4000),
  consoleSample,
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
await browser.close();
console.log(JSON.stringify({ out: OUT, status: proof.status, ok: proof.ok, reason: proof.reason, events: eventNames }, null, 2));
process.exit(ok ? 0 : 2);
