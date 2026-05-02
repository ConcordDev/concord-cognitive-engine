/**
 * E2E HTTP-level API route tests
 *
 * Strategy: spawn server.js as a child process on a free port, wait for it
 * to confirm it is listening, run fetch-based assertions, then kill the
 * process in the after() hook.
 *
 * Why child-process instead of direct import?
 *   server.js is a 62 k-line monolith that does NOT export `app`. Importing
 *   it directly in test scope would require patching internals. Spawning it
 *   is the cleanest, most realistic test surface: it exercises the real boot
 *   sequence end-to-end.
 *
 * Two server instances are started:
 *   - Suite A: AUTH_MODE=public — tests GET routes freely
 *   - Suite B: AUTH_MODE=hybrid — tests auth-protection of routes
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, '../../server.js');
const SERVER_CWD = join(__dirname, '../..');

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      // "e2e-test" — NOT "test" (which triggers SHOULD_LISTEN=false in server.js)
      NODE_ENV: 'e2e-test',
      CONCORD_NO_LISTEN: 'false',
      DATA_DIR: dataDir,
      // info level required so "server_listening" event is emitted to stdout
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    }, extraEnv);

    const child = spawn(process.execPath, [SERVER_JS], {
      env: env,
      cwd: SERVER_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timer = setTimeout(function() {
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
    child.stdout.on('data', function(chunk) {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      lines.forEach(checkLine);
    });

    let stderrBuf = '';
    child.stderr.on('data', function(chunk) {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(checkLine);
    });

    child.on('exit', function(code, signal) {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error('Server exited early (code=' + code + ' signal=' + signal + ')'));
      }
    });

    child.on('error', function(err) {
      if (!resolved) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function stopServer(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise(function(resolve) {
    child.kill('SIGTERM');
    const t = setTimeout(function() { child.kill('SIGKILL'); resolve(); }, 5000);
    child.on('exit', function() { clearTimeout(t); resolve(); });
  });
}

async function apiFetch(base, path, options) {
  options = options || {};
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, 5000);
  try {
    const res = await fetch(base + path, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON(base, path) {
  const res = await apiFetch(base, path);
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

async function postJSON(base, path, payload) {
  payload = payload || {};
  const res = await apiFetch(base, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

// ── Suite A: Public routes ────────────────────────────────────────────────────

describe('E2E API routes — public auth mode', { timeout: 120000 }, function() {
  let base;
  let serverProc;

  before(async function() {
    const port = await getFreePort();
    const dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-pub-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'public' }, 90000);
  });

  after(function() { return stopServer(serverProc); });

  // ── /health ──────────────────────────────────────────────────────────────

  it('GET /health returns 200 or 503 (not 404 or 500)', async function() {
    const { status } = await getJSON(base, '/health');
    assert.ok(
      status === 200 || status === 503,
      'Expected 200 or 503 from /health, got ' + status,
    );
  });

  // ── /api/status ──────────────────────────────────────────────────────────

  it('GET /api/status returns 200 with ok:true', async function() {
    const { status, body } = await getJSON(base, '/api/status');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true in body');
  });

  it('GET /api/status has a version string', async function() {
    const { status, body } = await getJSON(base, '/api/status');
    assert.equal(status, 200);
    assert.equal(typeof body.version, 'string', 'Expected version string');
    assert.ok(body.version.length > 0, 'version must be non-empty');
  });

  it('GET /api/status has numeric uptime', async function() {
    const { status, body } = await getJSON(base, '/api/status');
    assert.equal(status, 200);
    assert.ok(typeof body.uptime === 'number' && body.uptime >= 0, 'Expected non-negative uptime');
  });

  it('GET /api/status has counts object', async function() {
    const { status, body } = await getJSON(base, '/api/status');
    assert.equal(status, 200);
    assert.ok(body.counts && typeof body.counts === 'object', 'Expected counts object');
  });

  // ── /api/lenses ──────────────────────────────────────────────────────────

  it('GET /api/lenses/templates returns 200 with ok:true and templates array', async function() {
    const { status, body } = await getJSON(base, '/api/lenses/templates');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(Array.isArray(body && body.templates), 'Expected templates array');
    assert.ok(body.templates.length > 0, 'Expected at least one template');
  });

  it('GET /api/lenses/custom returns 200 with ok:true and lenses array', async function() {
    const { status, body } = await getJSON(base, '/api/lenses/custom');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(Array.isArray(body && body.lenses), 'Expected lenses array');
  });

  // ── /api/lattice/beacon ──────────────────────────────────────────────────

  it('GET /api/lattice/beacon returns 200 with ok:true and rootHash', async function() {
    const { status, body } = await getJSON(base, '/api/lattice/beacon');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(typeof body.rootHash === 'string', 'Expected rootHash string');
  });

  // ── /api/worlds ──────────────────────────────────────────────────────────

  it('GET /api/worlds returns 200 with worlds array', async function() {
    const { status, body } = await getJSON(base, '/api/worlds');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
    assert.ok(
      Array.isArray(body && body.worlds) || Array.isArray(body),
      'Expected worlds array in response',
    );
  });

  // ── /api/dtus ────────────────────────────────────────────────────────────

  it('GET /api/dtus returns 200 with ok:true', async function() {
    const { status, body } = await getJSON(base, '/api/dtus');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
  });

  // ── /api/bridge ──────────────────────────────────────────────────────────

  it('GET /api/bridge/organisms returns 200 with ok:true and organisms array', async function() {
    const { status, body } = await getJSON(base, '/api/bridge/organisms');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(Array.isArray(body && body.organisms), 'Expected organisms array');
  });

  it('GET /api/bridge/emergents returns 200', async function() {
    const { status, body } = await getJSON(base, '/api/bridge/emergents');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
  });

  it('GET /api/bridge/log returns 200 with ok:true and log array', async function() {
    const { status, body } = await getJSON(base, '/api/bridge/log');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(Array.isArray(body && body.log), 'Expected log array');
  });

  it('GET /api/bridge/debates returns 200', async function() {
    const { status, body } = await getJSON(base, '/api/bridge/debates');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
  });

  it('GET /api/bridge/births returns 200', async function() {
    const { status, body } = await getJSON(base, '/api/bridge/births');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
  });

  // ── /api/emergent ────────────────────────────────────────────────────────

  it('GET /api/emergent/status returns 200 with ok:true', async function() {
    const { status, body } = await getJSON(base, '/api/emergent/status');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
  });

  it('GET /api/emergent/status has numeric emergentCount', async function() {
    const { status, body } = await getJSON(base, '/api/emergent/status');
    assert.equal(status, 200);
    assert.ok(
      typeof body.emergentCount === 'number',
      'Expected numeric emergentCount',
    );
  });

  it('GET /api/emergent/lattice/proposals returns 200 (not 500)', async function() {
    // The lattice system may still be initializing at startup: ok may be false
    // until the macro registry is ready. We assert status is 200 (not 500) and
    // that a JSON body was returned.
    const { status, body } = await getJSON(base, '/api/emergent/lattice/proposals');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
    assert.notEqual(status, 500, 'Should not be a 500 error');
    // When initialized, the response includes a proposals array
    if (body && body.ok === true) {
      assert.ok(Array.isArray(body.proposals), 'Expected proposals array when ok:true');
    }
  });

  // ── /api/lens-features ───────────────────────────────────────────────────

  it('GET /api/lens-features/stats returns 200 with ok:true and totalFeatures', async function() {
    const { status, body } = await getJSON(base, '/api/lens-features/stats');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(
      typeof body.totalFeatures === 'number',
      'Expected totalFeatures field',
    );
  });

  it('GET /api/lens-features/universal returns 200 with ok:true and features array', async function() {
    const { status, body } = await getJSON(base, '/api/lens-features/universal');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
    assert.ok(Array.isArray(body && body.features), 'Expected features array');
  });

  it('GET /api/lens-features/summaries returns 200', async function() {
    const { status, body } = await getJSON(base, '/api/lens-features/summaries');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.ok(body !== null, 'Expected JSON body');
  });

  // ── 404 handling ─────────────────────────────────────────────────────────

  it('GET /api/this-route-does-not-exist returns 404', async function() {
    const { status } = await getJSON(base, '/api/this-route-does-not-exist');
    assert.equal(status, 404, 'Expected 404, got ' + status);
  });

  it('GET /api/xyzzy-nonexistent-route returns 404', async function() {
    const { status } = await getJSON(base, '/api/xyzzy-nonexistent-route');
    assert.equal(status, 404, 'Expected 404, got ' + status);
  });
});

// ── Suite B: Auth protection ──────────────────────────────────────────────────

describe('E2E API routes — hybrid auth (auth protection)', { timeout: 120000 }, function() {
  let base;
  let serverProc;

  before(async function() {
    const port = await getFreePort();
    const dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-hyb-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
  });

  after(function() { return stopServer(serverProc); });

  // ── Always-public routes still work ──────────────────────────────────────

  it('GET /api/status returns 200 in hybrid mode', async function() {
    const { status, body } = await getJSON(base, '/api/status');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
  });

  it('GET /health returns 200 or 503 in hybrid mode (not 401)', async function() {
    const { status } = await getJSON(base, '/health');
    assert.ok(
      status === 200 || status === 503,
      'Expected 200 or 503 from /health, got ' + status,
    );
  });

  it('GET /api/emergent/status returns 200 in hybrid mode (public GET path)', async function() {
    const { status } = await getJSON(base, '/api/emergent/status');
    assert.equal(status, 200, 'Expected 200, got ' + status);
  });

  it('GET /api/lattice/beacon returns 200 in hybrid mode', async function() {
    const { status, body } = await getJSON(base, '/api/lattice/beacon');
    assert.equal(status, 200, 'Expected 200, got ' + status);
    assert.equal(body && body.ok, true, 'Expected ok:true');
  });

  // ── Auth-protected routes return 401 ─────────────────────────────────────

  it('POST /api/dtus/:id/fork (unauthenticated) returns 401', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/fork', {});
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/dtus/:id/vote (unauthenticated) returns 401', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/dtus/:id/like (unauthenticated) returns 401', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/like', {});
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/worlds (unauthenticated) returns 401', async function() {
    const { status } = await postJSON(base, '/api/worlds', { name: 'TestWorld' });
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/storage/upload (unauthenticated) returns 401', async function() {
    const { status } = await postJSON(base, '/api/storage/upload', {});
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  // ── Auth responses are 401, never 500 or 200 ─────────────────────────────

  it('POST /api/dtus/:id/fork returns 401 not 500', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/fork', {});
    assert.notEqual(status, 500, 'Should not return 500 for unauthed request');
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/dtus/:id/vote returns 401 not 200', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.notEqual(status, 200, 'Should not return 200 for unauthed request');
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });

  it('POST /api/dtus/:id/like returns 401 not 200', async function() {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/like', {});
    assert.notEqual(status, 200, 'Should not return 200 for unauthed request');
    assert.equal(status, 401, 'Expected 401, got ' + status);
  });
});
