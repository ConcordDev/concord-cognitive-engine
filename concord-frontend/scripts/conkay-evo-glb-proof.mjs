/**
 * ConKay evo-asset → load_glb proof (two stages, one JSON):
 *   Stage A: generateValidatedAsset + register (or POST /api/conkay/design-glb)
 *            → GET /api/evo-asset/resolve → absolute same-origin GLB URL on :3000
 *   Stage B: Playwright smoke → load_glb → glb_loaded
 *
 * Honesty: archetypes only (sword/…). Not full free-text CAD suite.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Match live backend DATA_DIR so generated GLBs land where /api/evo-asset/file can read them.
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(REPO, 'server/data');
}
const SMOKE_URL = 'http://127.0.0.1:3000/conkay-evo-glb-smoke.html';
const OUT = path.join(process.env.HOME, '.zuko/remaining-work/conkay-evo-glb-proof.json');
const WAIT_MS = 70000;
const ARCHETYPE = process.env.CONKAY_EVO_ARCHETYPE || 'sword';
const PROMPT = process.env.CONKAY_EVO_TEXT || 'steel sword';

async function findLiveDb() {
  const { default: Database } = await import(path.join(REPO, 'server/node_modules/better-sqlite3/lib/index.js').replace(/\\/g, '/')).catch(async () => {
    // Resolve from server package root
    const { createRequire } = await import('module');
    const require = createRequire(path.join(REPO, 'server/package.json'));
    return { default: require('better-sqlite3') };
  });
  const candidates = [
    path.join(REPO, 'server/data/concord.db'),
    path.join(REPO, 'data/concord.db'),
    process.env.DB_PATH,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const db = new Database(p, { readonly: false });
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='evo_assets'`).get();
      if (row) return { db, path: p };
      db.close();
    } catch {
      /* try next */
    }
  }
  return null;
}

async function stageGenerate() {
  const t0 = Date.now();
  const mode = process.env.CONKAY_EVO_MODE || 'lib'; // 'lib' | 'api'
  let generateLive = true;
  let via = 'generateValidatedAsset+registerGeneratedAsset';
  let apiStatus = null;
  let result = {
    ok: false,
  };

  if (mode === 'api') {
    via = 'POST /api/conkay/design-glb';
    const userFile = path.join(process.env.HOME, '.zuko/remaining-work/_audit_user.txt');
    if (!fs.existsSync(userFile)) {
      return { ok: false, error: 'no_audit_user_for_api_mode', via };
    }
    const creds = Object.fromEntries(
      fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => l.split('=')),
    );
    const loginRes = await fetch('http://127.0.0.1:5050/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayEvoProof' },
      body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
    });
    const login = await loginRes.json();
    if (!login?.token) {
      return { ok: false, error: 'login_failed', status: loginRes.status, via };
    }
    const r = await fetch('http://127.0.0.1:5050/api/conkay/design-glb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 ConKayEvoProof',
        Authorization: `Bearer ${login.token}`,
        Origin: 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({ text: PROMPT, archetype: ARCHETYPE }),
    });
    apiStatus = r.status;
    const j = await r.json();
    if (!j?.ok) {
      return { ok: false, error: j?.error || j?.reason || 'design-glb_failed', apiStatus, body: j, via, ms: Date.now() - t0 };
    }
    const relative = j.glbUrl;
    const glbUrl = `http://127.0.0.1:3000${relative.startsWith('/') ? relative : `/${relative}`}`;
    result = {
      ok: true,
      via,
      generateLive: true,
      apiStatus,
      archetype: j.archetype,
      assetId: j.assetId,
      sourceId: j.sourceId,
      promoted: j.promoted,
      relativeUrl: relative,
      glbUrl,
      fea: j.fea,
      massProps: j.massProps,
      honesty: j.honesty,
      ms: Date.now() - t0,
    };
  } else {
    const { generateValidatedAsset, registerGeneratedAsset } = await import('../../server/lib/asset-gen/generate-asset.js');
    const { promoteVersion, resolveCurrentBest } = await import('../../server/lib/evo-asset/registry.js');
    const found = await findLiveDb();
    if (!found) return { ok: false, error: 'live_db_not_found', via };
    const { db, path: dbPath } = found;
    const params = ARCHETYPE === 'sword' || ARCHETYPE === 'spear'
      ? { bladeBaseThickness: 0.012 }
      : {};
    const seed = {
      ...params,
      _proofStamp: Number(process.env.CONKAY_EVO_STAMP || Date.now() % 100000),
    };
    const gen = await generateValidatedAsset({
      archetype: ARCHETYPE,
      params,
      maxIters: 8,
      outDir: path.join(process.env.DATA_DIR, 'evo-assets', 'generated'),
    });
    if (!gen.ok) {
      db.close();
      return { ok: false, error: gen.reason || 'generate_failed', detail: gen, via, ms: Date.now() - t0 };
    }
    const reg = registerGeneratedAsset(db, {
      archetype: ARCHETYPE,
      params: gen.params,
      glbPath: gen.glbPath,
      massProps: gen.massProps,
      feaResult: gen.feaResult,
    });
    let promoted = false;
    try {
      promoteVersion(db, reg.versionId);
      promoted = true;
    } catch {
      promoted = false;
    }
    const resolved = resolveCurrentBest(db, { source: 'evolved', sourceId: reg.sourceId });
    db.close();
    if (!resolved?.assetId) {
      return { ok: false, error: 'resolve_failed_after_register', reg, via, dbPath, ms: Date.now() - t0 };
    }
    const relativeUrl = `/api/evo-asset/file/${resolved.assetId}?v=${resolved.qualityLevel ?? 0}`;
    const glbUrl = `http://127.0.0.1:3000${relativeUrl}`;
    result = {
      ok: true,
      via,
      generateLive: true,
      dbPath,
      archetype: ARCHETYPE,
      assetId: resolved.assetId,
      sourceId: reg.sourceId,
      created: reg.created,
      promoted,
      glbPath: gen.glbPath,
      relativeUrl,
      glbUrl,
      fea: gen.feaResult
        ? { ok: !!gen.feaResult.ok, maxUtilization: gen.feaResult.maxUtilization }
        : null,
      massProps: gen.massProps,
      honesty: {
        path: 'archetype→generateValidatedAsset→register→resolve→load_glb',
        note: 'Archetypes only (sword/spear/staff/mace/shield). Not full free-text CAD / industrial suite.',
        glb: true,
      },
      ms: Date.now() - t0,
      unusedSeed: seed,
    };
  }

  // Probe same-origin fetch on :3000
  const probe = await fetch(result.glbUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 ConKayEvoProof' },
  });
  const buf = Buffer.from(await probe.arrayBuffer());
  const magic = buf.slice(0, 4).toString('utf8');
  result.probe = {
    httpStatus: probe.status,
    contentType: probe.headers.get('content-type'),
    bytes: buf.length,
    glbMagicOk: magic === 'glTF',
  };
  if (!(probe.status === 200 && magic === 'glTF')) {
    result.ok = false;
    result.error = 'glb_probe_failed';
  }
  return result;
}

console.log('Stage A: generate → register → resolve → probe');
const stageA = await stageGenerate();
console.log(JSON.stringify({
  ok: stageA.ok,
  via: stageA.via,
  assetId: stageA.assetId,
  glbUrl: stageA.glbUrl,
  probe: stageA.probe,
  error: stageA.error,
  ms: stageA.ms,
}, null, 2));

if (!stageA.ok) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    status: 'FAILED',
    ok: false,
    slice: 'conkay-evo-asset-generate-load_glb',
    stageA,
    ts: new Date().toISOString(),
  }, null, 2));
  console.error('Stage A failed — see', OUT);
  process.exit(2);
}

console.log('Stage B: Playwright load_glb → glb_loaded');
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
const resp = await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
const httpStatus = resp ? resp.status() : null;

await page.evaluate(({ u, n }) => {
  window.__GLB_URL__ = u;
  window.__GLB_NAME__ = n;
}, { u: stageA.glbUrl, n: stageA.archetype || 'sword' });

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
  last = await page.evaluate(() => window.__CONKAY_EVO_GLB_SMOKE__ || null);
  const names = ((last && last.events) || []).map((e) => e && e.event);
  if (names.includes('glb_loaded') && last.ok) break;
  const elapsed = Date.now() - t0;
  if (elapsed > 9000 && elapsed < 40000) {
    await page.evaluate(({ u, n }) => {
      window.__GLB_URL__ = u;
      window.__GLB_NAME__ = n;
      if (typeof window.__START_EVO_GLB_LOAD__ === 'function') {
        const s = window.__CONKAY_EVO_GLB_SMOKE__;
        const posts = (s && s.posts) || [];
        const hasLoad = posts.some((p) => p && p.cmd === 'load_glb');
        const hasLoaded = ((s && s.events) || []).some((e) => e && e.event === 'glb_loaded');
        if (!hasLoad && !hasLoaded) window.__START_EVO_GLB_LOAD__(u, n);
      }
    }, { u: stageA.glbUrl, n: stageA.archetype || 'sword' });
    await tryClickCanvas();
  }
  await page.waitForTimeout(500);
}

const outText = await page.locator('#out').innerText().catch(() => '');
await browser.close();

const events = (last && last.events) || [];
const names = events.map((e) => e && e.event);
const loaded = events.filter((e) => e && e.event === 'glb_loaded');
const glbLoadedSample = loaded[0] || null;
const urlMatch = !!(
  glbLoadedSample?.payload?.url &&
  (glbLoadedSample.payload.url === stageA.glbUrl ||
    String(glbLoadedSample.payload.url).includes('/api/evo-asset/file/'))
);
const ok = !!(last?.ok && loaded.length && glbLoadedSample?.payload?.ok === true);

const proof = {
  status: ok ? 'LIVE' : 'FAILED',
  ok,
  slice: 'conkay-evo-asset-generate-load_glb',
  honesty: {
    meshMode: 'load_glb',
    note: 'Archetype keyword → generateValidatedAsset (parametric FEA gate → pack GLB) → register/resolve → Unity glTFast load_glb. NOT full free-text CAD / industrial suite.',
    archetypesOnly: true,
    generateInProof: stageA.generateLive === true,
    via: stageA.via,
    cmds: ['load_glb'],
  },
  stageA: {
    ok: stageA.ok,
    via: stageA.via,
    generateLive: stageA.generateLive,
    archetype: stageA.archetype,
    assetId: stageA.assetId,
    sourceId: stageA.sourceId,
    promoted: stageA.promoted,
    glbUrl: stageA.glbUrl,
    relativeUrl: stageA.relativeUrl,
    probe: stageA.probe,
    fea: stageA.fea,
    massProps: stageA.massProps
      ? { mass_kg: stageA.massProps.mass_kg }
      : null,
    ms: stageA.ms,
  },
  glb: {
    url: stageA.glbUrl,
    postedUrl: stageA.glbUrl,
  },
  unity: {
    glbLoadedCount: loaded.length,
    glbLoadedSample,
    ackCount: names.filter((n) => n === 'ack').length,
    errorCount: names.filter((n) => n === 'error').length,
    errorSample: events.find((e) => e && e.event === 'error') || null,
    eventNames: names,
    urlMatch,
    payloadOk: glbLoadedSample?.payload?.ok === true,
  },
  url: SMOKE_URL,
  httpStatus,
  waitedMs: Date.now() - t0,
  posts: ((last && last.posts) || []).map((p) => p && p.cmd),
  reason: ok ? 'generate+resolve+load_glb+glb_loaded' : (last?.reason || 'failed'),
  outText,
  consoleSample: consoleLines.slice(0, 40),
  ts: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
console.log(JSON.stringify({
  ok: proof.ok,
  status: proof.status,
  reason: proof.reason,
  assetId: stageA.assetId,
  glbUrl: stageA.glbUrl,
  glbLoadedCount: proof.unity.glbLoadedCount,
  out: OUT,
}, null, 2));
process.exit(ok ? 0 : 1);
