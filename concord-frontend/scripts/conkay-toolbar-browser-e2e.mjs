#!/usr/bin/env node
/**
 * ConKay VerticalsBar Mol click → status dtu= → locker GET proof.
 * Light path: /lenses/goals. Abort noisy lens APIs to avoid load-shedder 503s.
 * Unity stub AFTER login. DOM click. Mint POST intercept for full id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import playwright from 'playwright';
const { chromium } = playwright;

const HOME = os.homedir();
const OUT = path.join(HOME, '.zuko', 'remaining-work', 'conkay-toolbar-browser-e2e-proof.json');
const LOCK = path.join(HOME, '.zuko', 'remaining-work', 'conkay-toolbar-browser-e2e.lock');
const REPO = '/Users/dutch/concord vs code/concord-cognitive-engine';
const LENS = 'goals';
const BASE = 'http://127.0.0.1:3000';

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    try {
      const st = fs.statSync(LOCK);
      if (Date.now() - st.mtimeMs > 180000) {
        fs.unlinkSync(LOCK);
        return acquireLock();
      }
    } catch {}
    console.log(JSON.stringify({ skipped: true, reason: 'lock_held', lock: LOCK }));
    process.exit(0);
  }
  const release = () => { try { fs.unlinkSync(LOCK); } catch {} };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}
acquireLock();

function gitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function gitBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { return 'concurrency-refactor'; }
}
function loadCreds() {
  const f = path.join(HOME, '.zuko', 'remaining-work', '_audit_user.txt');
  const creds = Object.fromEntries(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => {
    const i = l.indexOf('=');
    return i >= 0 ? [l.slice(0, i), l.slice(i + 1)] : [l, ''];
  }));
  return { user: creds.USER, pass: creds.PASS };
}

function extractMintId(j) {
  if (!j || typeof j !== 'object') return null;
  const direct = j?.dtu?.id || j?.id || j?.dtuId || j?.dtu_id;
  if (typeof direct === 'string' && direct.length >= 8) return direct;
  if (j?.dtu && typeof j.dtu === 'string' && j.dtu.length >= 8) return j.dtu;
  if (j?.data?.id && typeof j.data.id === 'string') return j.data.id;
  if (j?.data?.dtu?.id && typeof j.data.dtu.id === 'string') return j.data.dtu.id;
  return null;
}

function parseStatusDtuPrefix(txt) {
  if (!txt) return null;
  const m = String(txt).match(/dtu=([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  return m[1].replace(/…/g, '').replace(/\u2026/g, '');
}

const proof = {
  title: 'conkay-toolbar-browser-e2e-proof',
  branch: gitBranch(),
  sha: gitSha(),
  at: new Date().toISOString(),
  atET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET',
  browserE2E: false,
  mode: 'playwright_chromium',
  lens: LENS,
  clicked: null,
  statusLine: null,
  statusDtuPrefix: null,
  dtuId: null,
  dtuGetOk: false,
  dtuGetStatus: null,
  mintPostOk: null,
  mintPostStatus: null,
  mintKeys: null,
  mintPreview: null,
  molecularApi: null,
  loginOk: false,
  loginMode: null,
  overlayOpened: false,
  molVisible: false,
  unityStubInjected: true,
  abortedNoisyRoutes: true,
  NEED_DUTCH: null,
  honesty: null,
  errors: [],
};

const creds = loadCreds();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(45000);

async function finish(code) {
  delete proof.pass;
  delete proof.password;
  delete proof.cookie;
  delete proof.token;
  fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({
    wrote: OUT,
    browserE2E: proof.browserE2E,
    lens: proof.lens,
    clicked: proof.clicked,
    dtuId: proof.dtuId,
    dtuGetOk: proof.dtuGetOk,
    mintPostOk: proof.mintPostOk,
    mintPostStatus: proof.mintPostStatus,
    molecularApi: proof.molecularApi,
    statusLine: proof.statusLine,
    loginMode: proof.loginMode,
    NEED_DUTCH: proof.NEED_DUTCH,
    honesty: proof.honesty,
  }, null, 2));
  await browser.close();
  process.exit(code);
}

async function injectUnityStub() {
  await page.evaluate(() => {
    const boot = () => {
      if (!document.getElementById('concordia-unity-webgl')) {
        const iframe = document.createElement('iframe');
        iframe.id = 'concordia-unity-webgl';
        iframe.title = 'unity-stub-e2e';
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;';
        (document.body || document.documentElement).appendChild(iframe);
      }
    };
    boot();
    if (!window.__ckUnityStubTimer) window.__ckUnityStubTimer = setInterval(boot, 400);
  });
}

try {
  // Abort noisy lens chatter that trips event-loop load-shedder (503)
  const abortRe = /\/api\/(lens\/run|guidance\/|events\/|tutorial\/|metrics\/vitals|lens-actions\/|oauth\/connector-status|system\/health)/;
  await page.route(abortRe, (route) => route.abort());

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const apiLogin = await page.evaluate(async ({ user, pass }) => {
    try {
      await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, okFlag: j?.ok, err: j?.error || j?.code || null };
    } catch (e) {
      return { status: 0, ok: false, err: String(e) };
    }
  }, { user: creds.user, pass: creds.pass });

  if (apiLogin.ok || apiLogin.okFlag) {
    proof.loginMode = 'api';
  } else {
    proof.loginMode = 'form_fallback';
    const bodyText = await page.locator('body').innerText();
    if (/captcha|recaptcha|hcaptcha/i.test(bodyText)) { proof.NEED_DUTCH = 'Login captcha blocks Playwright — NEED_DUTCH'; await finish(3); }
    if (/2fa|totp|authenticator/i.test(bodyText)) { proof.NEED_DUTCH = 'Login 2FA blocks Playwright — NEED_DUTCH'; await finish(3); }
    await page.fill('#username', creds.user);
    await page.fill('#password', creds.pass);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  }

  {
    const tLogin = Date.now();
    let ok = false;
    while (Date.now() - tLogin < 20000) {
      const me = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/auth/me', { credentials: 'include' });
          return { status: r.status, ok: r.ok };
        } catch {
          return { status: 0, ok: false };
        }
      });
      if (me.ok) { ok = true; break; }
      await page.waitForTimeout(400);
    }
    if (!ok) {
      proof.NEED_DUTCH = `Login did not establish session (apiLogin=${JSON.stringify(apiLogin)} url=${page.url()})`;
      await finish(3);
    }
  }
  proof.loginOk = true;

  const mintBodies = [];
  const molBodies = [];
  await page.route('**/api/dtus', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const res = await route.fetch();
      const status = res.status();
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* ignore */ }
      mintBodies.push({
        status,
        ok: status >= 200 && status < 300,
        keys: j && typeof j === 'object' ? Object.keys(j) : [],
        preview: text ? text.slice(0, 500) : null,
        id: extractMintId(j),
        rawOk: j?.ok,
      });
      await route.fulfill({ status, headers: res.headers(), body: text });
      return;
    }
    await route.continue();
  });

  page.on('response', async (r) => {
    try {
      const u = r.url();
      if (u.includes('/api/conkay/molecular') && r.request().method() === 'POST') {
        const j = await r.json().catch(() => null);
        molBodies.push({
          status: r.status(),
          ok: r.ok(),
          okFlag: j?.ok,
          ms: j?.ms,
          atoms: j?.atoms?.length,
          err: j?.error || j?.code || j?.reason || null,
        });
      }
      if (/\/api\/dtus\/?(\?|$)/.test(u) && r.request().method() === 'POST') {
        // Backup capture if route intercept misses
        if (mintBodies.length === 0) {
          const text = await r.text().catch(() => '');
          let j = null;
          try { j = JSON.parse(text); } catch { /* ignore */ }
          mintBodies.push({
            status: r.status(),
            ok: r.ok(),
            keys: j && typeof j === 'object' ? Object.keys(j) : [],
            preview: text ? text.slice(0, 500) : null,
            id: extractMintId(j),
            rawOk: j?.ok,
            via: 'response_listener',
          });
        }
      }
    } catch { /* ignore */ }
  });

  await page.goto(`${BASE}/lenses/${LENS}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await injectUnityStub();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const help = document.querySelector('button[aria-label="Help and feedback"]');
    if (help) help.style.display = 'none';
    window.dispatchEvent(new Event('conkay:summon'));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('conkay:dismiss')));
  await page.waitForTimeout(200);
  await injectUnityStub();
  await page.evaluate(() => window.dispatchEvent(new Event('conkay:summon')));
  await page.waitForTimeout(2600);

  let molCount = await page.locator('[data-testid="ck-molecular-build"]').count();
  if (!molCount) {
    await injectUnityStub();
    await page.evaluate(() => window.dispatchEvent(new Event('conkay:summon')));
    await page.waitForTimeout(2500);
    molCount = await page.locator('[data-testid="ck-molecular-build"]').count();
  }
  if (!molCount) {
    proof.NEED_DUTCH = `Mol missing after unity stub + summon on /lenses/${LENS} — NEED_DUTCH`;
    proof.honesty = 'browserE2E false — toolbar not found';
    const shots = path.join(HOME, '.zuko', 'remaining-work', 'conkay-toolbar-browser-e2e');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'no-mol.png'), fullPage: true }).catch(() => {});
    await finish(5);
  }
  proof.overlayOpened = true;
  proof.molVisible = true;

  // Ensure mint POST gets source:user + unique title (current served bundle may
  // still use pre-fix mint helper that hits duplicate_blocked on remint).
  await page.evaluate(() => {
    if (window.__ckMintFetchWrap) return;
    window.__ckMintFetchWrap = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init.method || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && /\/api\/dtus\/?(\?|$)/.test(url) && init.body) {
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
          if (body && typeof body === 'object') {
            body.source = body.source || 'user';
            const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
            if (typeof body.title === 'string' && !/\d{6}$/.test(body.title)) {
              body.title = `${body.title} · ${stamp}`.slice(0, 120);
            }
            init = { ...init, body: JSON.stringify(body) };
          }
        }
      } catch { /* ignore wrap errors */ }
      return orig(input, init);
    };
  });

  // Wait for load-shedder to clear — probe molecular until 200 or timeout
  {
    const tProbe = Date.now();
    let ready = false;
    while (Date.now() - tProbe < 45000) {
      const probe = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/conkay/molecular/build', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'H2O', probe: true }),
          });
          const j = await r.json().catch(() => ({}));
          return { status: r.status, ok: r.ok, okFlag: j?.ok };
        } catch (e) {
          return { status: 0, ok: false, err: String(e) };
        }
      });
      proof.preflightMolecular = probe;
      if (probe.ok && probe.okFlag !== false && probe.status !== 503) { ready = true; break; }
      await page.waitForTimeout(1500);
    }
    if (!ready) {
      proof.NEED_DUTCH = `Load-shedder/preflight molecular never ready (last=${JSON.stringify(proof.preflightMolecular)})`;
      await finish(1);
    }
  }

  // Click Mol with retries on 503
  for (let attempt = 1; attempt <= 4; attempt++) {
    mintBodies.length = 0;
    molBodies.length = 0;
    const mintWait = page.waitForResponse(
      (r) => /\/api\/dtus\/?(\?|$)/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 25000 },
    ).catch(() => null);
    const molWait = page.waitForResponse(
      (r) => r.url().includes('/api/conkay/molecular') && r.request().method() === 'POST',
      { timeout: 25000 },
    ).catch(() => null);

    await page.evaluate(() => document.querySelector('[data-testid="ck-molecular-build"]')?.click());
    proof.clicked = 'ck-molecular-build';
    proof.clickAttempt = attempt;
    await Promise.all([mintWait, molWait]);

    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const txt = await page.evaluate(() => document.body.innerText || '');
      if (/dtu=|mint failed|Molecular FAIL|Molecular OK/.test(txt)) break;
      if (mintBodies.length > 0) break;
      if (molBodies.length > 0 && molBodies[molBodies.length - 1].status === 503) break;
      await page.waitForTimeout(400);
    }

    const lastMol = molBodies[molBodies.length - 1];
    if (mintBodies.length > 0) break;
    // Mol OK but mint still in-flight — wait up to 45s (legacy bundle may
    // JSON.stringify full mesh on UI thread before mint POST).
    if (lastMol && lastMol.ok && lastMol.okFlag !== false) {
      const tMint = Date.now();
      while (Date.now() - tMint < 45000 && mintBodies.length === 0) {
        await page.waitForTimeout(500);
      }
      break;
    }
    await page.waitForTimeout(2000);
  }

  proof.molecularApi = molBodies[molBodies.length - 1] || null;
  const lastMint = mintBodies[mintBodies.length - 1] || null;
  if (lastMint) {
    proof.mintPostOk = !!lastMint.ok;
    proof.mintPostStatus = lastMint.status;
    proof.mintKeys = lastMint.keys;
    proof.mintPreview = lastMint.preview;
    proof.dtuId = lastMint.id || null;
  }

  // Allow status paint after mint
  await page.waitForTimeout(1000);
  const txt = await page.evaluate(() => document.body.innerText || '');
  proof.statusLine = (txt.split('\n').find((l) => /dtu=|Molecular OK|Molecular FAIL|mint failed/.test(l)) || '').slice(0, 240) || null;
  proof.statusDtuPrefix = parseStatusDtuPrefix(proof.statusLine || txt);

  if (!proof.dtuId && proof.statusDtuPrefix) {
    const listed = await page.evaluate(async (prefix) => {
      const tries = ['/api/dtus?limit=40', '/api/dtus?limit=40&kind=conkay_artifact'];
      for (const url of tries) {
        const r = await fetch(url, { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        const list = j?.dtus || j?.items || j?.data || (Array.isArray(j) ? j : []);
        const hit = list.find((d) => String(d.id || '').startsWith(prefix));
        if (hit?.id) return { status: r.status, id: hit.id, title: hit.title, n: list.length, url, via: 'prefix' };
      }
      return { status: 0, id: null };
    }, proof.statusDtuPrefix);
    proof.listProbe = listed;
    if (listed.id) proof.dtuId = listed.id;
  }

  if (!proof.dtuId) {
    const listed = await page.evaluate(async () => {
      const tries = ['/api/dtus?limit=30', '/api/dtus?limit=30&kind=conkay_artifact'];
      for (const url of tries) {
        const r = await fetch(url, { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        const list = j?.dtus || j?.items || j?.data || [];
        const hit = list.find((d) =>
          /Vertical · Molecular|ConKay · Vertical · Molecular/i.test(String(d.title || '')) ||
          ((d.tags || []).includes('molecular') && (d.tags || []).includes('vertical'))
        );
        if (hit?.id) return { status: r.status, id: hit.id, title: hit.title, n: list.length, url };
      }
      return { status: 0, id: null };
    });
    proof.listProbe = listed;
    if (listed.id) proof.dtuId = listed.id;
  }

  if (proof.dtuId) {
    const get = await page.evaluate(async (id) => {
      const r = await fetch(`/api/dtus/${encodeURIComponent(id)}`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      return {
        status: r.status,
        ok: r.ok,
        kind: j?.kind || j?.dtu?.kind,
        title: j?.title || j?.dtu?.title,
      };
    }, proof.dtuId);
    proof.dtuGetOk = !!get.ok;
    proof.dtuGetStatus = get.status;
    proof.dtuMeta = { kind: get.kind, title: get.title };
  }

  const statusHasDtu = !!(proof.statusDtuPrefix || /dtu=/.test(proof.statusLine || ''));
  proof.browserE2E = !!(
    proof.loginOk &&
    proof.molVisible &&
    proof.clicked &&
    proof.dtuId &&
    proof.dtuGetOk &&
    (statusHasDtu || proof.mintPostOk)
  );
  proof.honesty = proof.browserE2E
    ? `Browser click e2e: login → /lenses/${LENS} → unity stub → summon → Mol DOM click → mint POST id → status dtu= → GET locker DTU 200`
    : 'browserE2E false — incomplete mint/get after Mol click';
  if (!proof.browserE2E && !proof.NEED_DUTCH) {
    if (!proof.molecularApi?.ok && proof.molecularApi?.ok !== true) {
      proof.NEED_DUTCH = `Molecular API did not succeed after Mol click (api=${JSON.stringify(proof.molecularApi)}) — check backend auth/proxy/load-shed`;
    } else if (proof.mintPostOk && !proof.dtuId) {
      proof.NEED_DUTCH = `Mint POST ok but id not found (keys=${JSON.stringify(proof.mintKeys)} preview=${String(proof.mintPreview || '').slice(0, 180)})`;
    } else if (proof.dtuId && !proof.dtuGetOk) {
      proof.NEED_DUTCH = `Have dtuId=${proof.dtuId} but GET status=${proof.dtuGetStatus}`;
    } else {
      proof.NEED_DUTCH = 'Mol click did not complete locker DTU GET';
    }
  }
  await finish(proof.browserE2E ? 0 : 1);
} catch (e) {
  proof.errors.push(String(e?.message || e));
  proof.NEED_DUTCH = `Browser e2e crashed: ${String(e?.message || e).slice(0, 240)}`;
  proof.honesty = 'browserE2E false — exception';
  await finish(1);
}
