/**
 * E2E — the marketing email beacons (/api/marketing/track/{open,click}/:sendId)
 * were removed; Concord does not track email. Spawns server.js in
 * AUTH_MODE=hybrid and checks both old paths no longer serve anything to an
 * anonymous GET. The global auth gate answers 401 before routing reaches a
 * missing route (auth mode is unchanged), so 401 or 404 both mean "gone".
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
      // See animation-share-routes.test.js for why this is disabled for e2e
      // spawns: the front-door lag shedder trips under full-suite parallelism
      // and these tests exist to test real behaviour, not admission control.
      CONCORD_LOAD_SHED_ENABLED: '0',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    }, extraEnv);

    delete env.DB_PATH;
    delete env.STATE_PATH;

    const child = spawn(process.execPath, [SERVER_JS], {
      env: env,
      cwd: SERVER_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

describe('E2E — marketing email beacons are gone', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-mkttrack-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
  });

  after(async function () {
    await stopServer(serverProc);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('anonymous GET of the old open pixel serves nothing (401/404, no GIF)', async function () {
    const res = await apiFetch(base, '/api/marketing/track/open/snd_x', {});
    assert.ok([401, 404].includes(res.status), 'got ' + res.status);
    assert.notEqual(res.headers.get('content-type'), 'image/gif');
  });

  it('anonymous GET of the old click redirect serves nothing and never redirects', async function () {
    const res = await apiFetch(base, '/api/marketing/track/click/snd_x?u=' + encodeURIComponent('https://example.com/'), { redirect: 'manual' });
    assert.ok([401, 404].includes(res.status), 'got ' + res.status);
    assert.equal(res.headers.get('location'), null);
  });

  it('sanity: a genuinely auth-protected route in this SAME hybrid-mode server still 401s unauthenticated', async function () {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'expected the known-protected route to 401, got ' + status);
  });
});
