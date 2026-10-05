// scripts/lens-proof-lib.mjs — shared helpers for the real-browser lens proofs.
//
// Every proof drives the real Next route in Chrome (Playwright,
// channel: 'chrome'), clicks the real controls, and then proves:
//   keep  -> the lens KeepMenu saved a private DTU and read it back
//   read  -> the DTU is fetched again by id (dtu.get) from the page session
//   hand  -> a Thread draft citing that DTU exists (thread.draft-detail) and
//            is visible in the Thread lens Composer
//   reload-> the lens's own record survives a full page reload
// Nothing here invents data; every id is read off the screen or the API.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
export const { chromium } = require('../server/node_modules/playwright-core/index.js');

export const BASE = process.env.PROOF_BASE_URL || 'http://localhost:5399';
export const PROOF_DIR = join(homedir(), '.zuko/lens-northstar/proof');
const PROOF_USER = process.env.PROOF_USER || 'wbproof_muv96clt';
const PROOF_PASS = process.env.PROOF_PASS || 'TestPass123!';

export function mkLog(tag) { return (...a) => console.log(`[${tag}-proof]`, ...a); }

export async function openBrowser(log) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log('console error:', m.text().slice(0, 160)); });
  page.on('response', (r) => {
    if (/\/api\/lens\/run/.test(r.url()) && r.request().method() === 'POST') {
      let act = '';
      try { const b = JSON.parse(r.request().postData() || '{}'); act = `${b.domain}.${b.action}`; } catch {}
      r.text().then((t) => log('LENS', r.status(), act, t.slice(0, 160).replace(/\s+/g, ' '))).catch(() => {});
    }
  });
  return { browser, ctx, page };
}

export async function login(ctx, log, attempt = 0) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username: PROOF_USER, password: PROOF_PASS }, timeout: 120000,
  });
  const body = await res.json().catch(() => ({}));
  if (body?.ok) { log('login ok as', PROOF_USER); return body; }
  if (attempt < 8 && (res.status() >= 500 || body?.error === 'service_overloaded')) {
    log(`login retry ${attempt + 1} (${body?.error || res.status()})`);
    await new Promise((r) => setTimeout(r, 8000));
    return login(ctx, log, attempt + 1);
  }
  throw new Error('login failed: ' + (body?.error || res.status()));
}

export async function gotoLens(page, path, log) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (/\/(login|onboarding)/.test(page.url())) throw new Error(`${path} redirected to ${page.url()}`);
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => /csrf_token=/.test(document.cookie))) break;
    await page.evaluate(async () => { try { await fetch('/api/auth/csrf-token', { credentials: 'include' }); } catch {} });
    await page.waitForTimeout(2000);
  }
  log('opened', page.url());
}

/** Run a lens macro from inside the page session (same cookie + CSRF as the UI). */
export async function pageLensRun(page, domain, action, input = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await pageLensRunOnce(page, domain, action, input);
    if (r.ok === false && /service_overloaded|service_warming/.test(String(r.error || ''))) {
      await page.waitForTimeout(5000);
      continue;
    }
    return r;
  }
  return { ok: false, error: 'service stayed overloaded' };
}

async function pageLensRunOnce(page, domain, action, input) {
  return page.evaluate(async ({ domain, action, input }) => {
    const m = document.cookie.match(/csrf_token=([^;]+)/);
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {}) },
      body: JSON.stringify({ domain, action, input }),
    });
    let node = await r.json().catch(() => null);
    while (node && typeof node === 'object' && 'ok' in node && 'result' in node) {
      if (node.ok === false) return { ok: false, error: node.error };
      node = node.result;
    }
    if (node && typeof node === 'object' && node.ok === false) return { ok: false, error: node.code || node.error };
    return { ok: true, result: node };
  }, { domain, action, input });
}

/**
 * Inside `menu` (the rendered "Keep this …" card) click Save-as-DTU, wait for
 * the read-back status, click Draft in Thread, wait for the draft status.
 * Returns { dtuId, draftId } read off the screen.
 */
export async function keepToDtuAndThread(page, menu, log) {
  const saveBtn = menu.getByRole('button', { name: /as DTU/i }).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 20000 });
  await saveBtn.click();
  const savedStatus = menu.locator('[role="status"]', { hasText: /Saved as private DTU|Not saved|read-back did not/ }).first();
  await savedStatus.waitFor({ state: 'visible', timeout: 60000 });
  const savedText = (await savedStatus.innerText()).trim();
  log('save status:', savedText);
  const dtuId = (savedText.match(/Saved as private DTU (\S+?)\.?\s/) || savedText.match(/(dtu_[A-Za-z0-9]+)/) || [])[1];
  if (!dtuId || !/Saved as private DTU/.test(savedText)) throw new Error('DTU not saved: ' + savedText);

  const draftBtn = menu.getByRole('button', { name: /Draft in Thread/i }).first();
  await draftBtn.waitFor({ state: 'visible', timeout: 10000 });
  await draftBtn.click();
  const draftStatus = menu.locator('[role="status"]', { hasText: /Drafted in Thread as|Not drafted/ }).first();
  await draftStatus.waitFor({ state: 'visible', timeout: 60000 });
  const draftText = (await draftStatus.innerText()).trim();
  log('draft status:', draftText);
  const draftId = (draftText.match(/Drafted in Thread as (\S+?),/) || [])[1];
  if (!draftId) throw new Error('Thread draft not created: ' + draftText);
  return { dtuId, draftId };
}

/** Independent read-back of the DTU and the Thread draft by id. */
export async function verifyReadBack(page, { dtuId, draftId }, expectSource, log) {
  const d = await pageLensRun(page, 'dtu', 'get', { id: dtuId });
  const dtu = d.result?.dtu || d.result;
  const dtuOk = d.ok && (dtu?.id === dtuId) ;
  const src = dtu?.source || dtu?.meta?.source || '';
  const vis = dtu?.meta?.visibility || dtu?.visibility || '';
  log('dtu.get', dtuId, 'ok?', dtuOk, 'source:', src, 'visibility:', vis);
  const t = await pageLensRun(page, 'thread', 'draft-detail', { id: draftId });
  const draft = t.result?.draft || t.result;
  const draftOk = t.ok && draft?.id === draftId && draft?.citedDtuId === dtuId && draft?.status === 'draft';
  log('thread.draft-detail', draftId, 'ok?', draftOk, 'cites:', draft?.citedDtuId, 'status:', draft?.status);
  if (!dtuOk) throw new Error('DTU read-back failed: ' + JSON.stringify(d).slice(0, 300));
  if (expectSource && src && src !== expectSource) throw new Error(`DTU source ${src} != ${expectSource}`);
  if (!draftOk) throw new Error('Thread draft read-back failed: ' + JSON.stringify(t).slice(0, 300));
  return { source: src, visibility: vis, draftTitle: draft?.title };
}

/** Open the Thread lens Composer and confirm the draft citing the DTU is listed. */
export async function verifyThreadHandoff(page, { dtuId, draftId }, shotPath, log) {
  await gotoLens(page, '/lenses/thread', log);
  const composerTab = page.getByRole('button', { name: /Composer/i }).first();
  await composerTab.waitFor({ state: 'visible', timeout: 60000 });
  await composerTab.click();
  const cite = page.getByText(dtuId, { exact: true }).first();
  await cite.waitFor({ state: 'visible', timeout: 60000 });
  log('Thread Composer lists a draft citing', dtuId);
  if (shotPath) { await page.screenshot({ path: shotPath }); log('thread screenshot:', shotPath); }
  return true;
}

export function shot(name) { mkdirSync(PROOF_DIR, { recursive: true }); return join(PROOF_DIR, name); }

/** The KeepMenu card: the h4 heading's grandparent (header row → card). */
export function keepMenu(scope, heading) {
  return scope.locator('h4', { hasText: heading }).first().locator('xpath=../..');
}
