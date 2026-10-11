/**
 * E2E HTTP-level tests — no-login ConKay demo (/api/conkay/demo/*)
 *
 * A real server in AUTH_MODE=hybrid. Every demo call is a bare fetch with no
 * Authorization header and no cookie, the way a visitor who never signed up
 * would hit it. Proves: (a) materials, a beam solve and a sweep work with no
 * account, (b) the numbers are the engine's own (same as calling the solver
 * directly, hand check agreeing), (c) bad input is a 400 with the solver's
 * reason, never a made-up result, (d) the bypass is GET-only and limited to
 * the demo paths: POST to them, the signed-in ConKay routes and an
 * anonymous lens-run of the saving macro are still refused, (e) the results
 * page's showcase snapshots are readable with no account and only files a
 * snapshot lists are served.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armOrphanGuard } from '../lib/e2e-orphan-guard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, '../../server.js');
const SERVER_CWD = join(__dirname, '../..');

// ── Boilerplate (same shape as tests/e2e/time-loop-routes.test.js) ─────────

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function spawnServer(port, dataDir, extraEnv, timeoutMs) {
  timeoutMs = timeoutMs || 90000;
  extraEnv = extraEnv || {};
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      NODE_ENV: 'e2e-test',
      CONCORD_NO_LISTEN: 'false',
      // lib/request-admission.js sheds requests with an immediate 503 when
      // event-loop lag exceeds 300ms for roughly the first ~20s of boot, and
      // full-suite parallelism (many test files each spawning their own
      // server.js concurrently) compounds that well past isolated-run levels
      // -- observed directly on this exact shared spawnServer() shape wholesale
      // failing under full-suite contention while passing 13/13 in isolation.
      // Disable shedding for e2e spawns; they exist to test real behaviour,
      // not admission control.
      CONCORD_LOAD_SHED_ENABLED: '0',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    }, extraEnv);

    // The spawned server MUST derive its own DB/state from DATA_DIR above.
    // `Object.assign({}, process.env, ...)` inherits everything we do not
    // explicitly override, and tests/preload/no-egress.mjs sets DB_PATH +
    // STATE_PATH on THIS (parent) process for per-test-file isolation. Those
    // are absolute paths that take precedence over DATA_DIR, so leaving them
    // in the child env silently points the spawned server at the PARENT's
    // throwaway database -- defeating the isolation this dataDir exists to
    // provide, and making parent and child write the same file concurrently.
    // Found 2026-07-25: cross-world-potency-routes went 6/6 -> 1/6 the moment
    // the preload's isolation started actually taking effect, because the
    // child booted against an empty inherited DB instead of seeding its own.
    delete env.DB_PATH;
    delete env.STATE_PATH;

    const child = spawn(process.execPath, [SERVER_JS], {
      env: env,
      cwd: SERVER_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The after() hook below tears this child (and dataDir) down on the happy
    // path, but it never runs when `node --test` SIGTERMs a file that blew its
    // --test-timeout — which orphans a real, CPU-burning server process and
    // strands its migrated SQLite tree. See tests/lib/e2e-orphan-guard.js.
    armOrphanGuard(child, dataDir);

    let resolved = false;
    const timer = setTimeout(function () {
      if (!resolved) {
        child.kill('SIGKILL');
        reject(new Error('Server on port ' + port + ' did not become ready within ' + timeoutMs + 'ms'));
      }
    }, timeoutMs);

    function checkLine(line) {
      if (
        line.indexOf('server_listening') !== -1 ||
        line.indexOf('http://localhost:' + port) !== -1 ||
        line.indexOf('"url":"http://localhost:' + port + '"') !== -1 ||
        line.indexOf('Listening on port ' + port) !== -1 ||
        line.indexOf('listening on') !== -1
      ) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(child);
        }
      }
    }

    let stdoutBuf = '';
    child.stdout.on('data', function (chunk) {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      lines.forEach(checkLine);
    });

    let stderrBuf = '';
    child.stderr.on('data', function (chunk) {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(checkLine);
    });

    child.on('exit', function (code, signal) {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error('Server exited early (code=' + code + ' signal=' + signal + ')'));
      }
    });

    child.on('error', function (err) {
      if (!resolved) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function stopServer(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise(function (resolve) {
    child.kill('SIGTERM');
    const t = setTimeout(function () { child.kill('SIGKILL'); resolve(); }, 5000);
    child.on('exit', function () { clearTimeout(t); resolve(); });
  });
}

async function apiFetch(base, path, options) {
  options = options || {};
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);
  try {
    const res = await fetch(base + path, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON(base, path, headers) {
  const res = await apiFetch(base, path, { headers: headers || {} });
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  return { status: res.status, body: body };
}

async function postJSON(base, path, payload, headers) {
  payload = payload || {};
  const res = await apiFetch(base, path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  return { status: res.status, body: body };
}

// Registers a fresh authenticated "welder" user and returns Bearer headers.
async function registerUser(base, label) {
  const uniq = label + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const reg = await postJSON(base, '/api/auth/register', {
    username: uniq,
    email: uniq + '@example.com',
    password: 'CorrectHorseBattery9!',
    dateOfBirth: '1990-01-01',
    _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body || !reg.body.token) {
    throw new Error('Setup failed: could not register user ' + label + ': ' + JSON.stringify(reg));
  }
  return { Authorization: 'Bearer ' + reg.body.token };
}


async function lensRun(base, headers, domain, action, input) {
  const r = await postJSON(base, '/api/lens/run', { domain, action, input }, headers);
  const res = r.body && r.body.result ? r.body.result : r.body;
  return { status: r.status, body: r.body, res };
}

import { solveBeamStudy } from '../../domains/engineering.js';

const BEAM = 'length=4000&height=300&flangeWidth=150&flangeThickness=12&webThickness=8&loadN=20000&support=simply-supported&material=steel-a992';

describe('E2E — no-login ConKay demo (/api/conkay/demo/*)', { timeout: 150000 }, function () {
  let base, serverProc, dataDir;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-conkay-demo-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
  });

  after(async function () {
    await stopServer(serverProc);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  });

  it('lists materials with no account', async function () {
    const r = await getJSON(base, '/api/conkay/demo/materials');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    const steel = r.body.materials.find((m) => m.id === 'steel-a992');
    assert.ok(steel, 'steel-a992 present');
    assert.equal(steel.yield, 345);
  });

  it('solves a beam with no account and returns the engine numbers', async function () {
    const r = await getJSON(base, '/api/conkay/demo/beam?' + BEAM);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.saved, false);
    const res = r.body.result;
    const direct = solveBeamStudy({
      dims: { length: 4000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 },
      loadN: 20000, support: 'simply-supported', material: 'steel-a992',
    });
    assert.equal(direct.ok, true);
    assert.equal(res.maxStressMPa, direct.result.maxStressMPa);
    assert.equal(res.maxDeflectionMm, direct.result.maxDeflectionMm);
    assert.equal(res.handCheck.agrees, true, 'FEA agrees with the closed-form hand check');
    assert.ok(res.analysisReceipt, 'carries the analysis receipt');
    assert.equal(res.jobId, undefined, 'no sim job is recorded');
  });

  it('runs a sweep with no account', async function () {
    const r = await getJSON(base, '/api/conkay/demo/sweep?' + BEAM + '&param=height&values=200,300,400');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result.rows.length, 3);
    assert.ok(r.body.result.rows.every((row) => row.ok && Number.isFinite(row.maxStressMPa)));
    const [a, b, c] = r.body.result.rows.map((row) => row.maxStressMPa);
    assert.ok(a > b && b > c, 'a deeper beam is less stressed');
  });

  it('bad input is a 400 with the solver reason', async function () {
    const r = await getJSON(base, '/api/conkay/demo/beam?length=4000&height=20&flangeWidth=150&flangeThickness=12&webThickness=8&loadN=20000');
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /flanges are thicker/);
    const m = await getJSON(base, '/api/conkay/demo/beam?' + BEAM.replace('steel-a992', 'unobtainium'));
    assert.equal(m.status, 400);
    assert.match(m.body.error, /unknown material/);
  });

  it('serves the results page snapshots with no account (precomputed, nothing solved)', async function () {
    const idx = await getJSON(base, '/api/conkay/demo/designs');
    assert.equal(idx.status, 200, JSON.stringify(idx.body));
    const ids = idx.body.designs.map((d) => d.id);
    assert.deepEqual(ids, ['car', 'sentinel-m1', 'usb-blend-d', 'methanol-water', 'nuscale-us600']);
    assert.ok(idx.body.designs.every((d) => d.available), 'every showcase snapshot is built');
    const s = await getJSON(base, '/api/conkay/demo/designs/sentinel-m1');
    assert.equal(s.status, 200);
    assert.equal(s.body.design.id, 'sentinel-m1');
    assert.ok(s.body.design.checks.length > 0 && s.body.design.values.length > 0);
    const svg = s.body.design.files.find((f) => f.name.endsWith('.svg'));
    const f = await apiFetch(base, '/api/conkay/demo/designs/sentinel-m1/files/' + svg.name);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-type'), 'image/svg+xml');
    assert.match(f.headers.get('content-security-policy') || '', /default-src 'none'/);
    const n = await getJSON(base, '/api/conkay/demo/designs/nuscale-us600');
    assert.ok(n.body.design.disclaimers.some((d) => /screening-only/.test(d)), 'nuclear snapshot carries the screening disclaimer');
  });

  it('the snapshot routes serve only listed files', async function () {
    assert.equal((await getJSON(base, '/api/conkay/demo/designs/nope')).status, 404);
    assert.equal((await getJSON(base, '/api/conkay/demo/designs/car/files/server.js')).status, 404);
    assert.notEqual((await getJSON(base, '/api/conkay/demo/designs/car/files/..%2F..%2Fserver.js')).status, 200);
    assert.notEqual((await postJSON(base, '/api/conkay/demo/designs', {})).status, 200, 'POST not served');
  });

  it('the bypass is narrow', async function () {
    const post = await postJSON(base, '/api/conkay/demo/beam', {});
    assert.notEqual(post.status, 200, 'POST to the demo path is not served');
    const design = await postJSON(base, '/api/conkay/design', { text: 'a beam' });
    assert.ok(design.status === 401 || design.status === 403, 'signed-in ConKay route still refused: ' + design.status);
    const other = await getJSON(base, '/api/conkay/demo/../assemblies');
    assert.notEqual(other.status, 200);
    const run = await postJSON(base, '/api/lens/run', { domain: 'engineering', name: 'beamStudy', input: { dims: {} } });
    assert.ok(run.status === 401 || run.status === 403 || (run.body && run.body.ok === false), 'anonymous lens run of the saving macro refused: ' + run.status);
  });
});
