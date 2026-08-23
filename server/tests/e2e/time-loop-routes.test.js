/**
 * E2E HTTP-level route test for the time-loop mode family.
 *
 * Wave-4 backlog item (docs/concordia-specs/runmodes-endgame-social-capability-map.md)
 * claimed: "Time-loop mode: 3 of 5 HTTP routes 404 due to a missing `/` before
 * path params — the HUD never renders and loops can't be ended from the UI."
 *
 * A static grep of server.js showed all 5 routes registered with a correct
 * leading `/` before every `:param`:
 *   POST /api/time-loop/start
 *   POST /api/time-loop/:sessionId/end
 *   POST /api/time-loop/memory
 *   GET  /api/time-loop/memories/:worldId
 *   GET  /api/time-loop/active/:worldId
 *
 * This test spawns the real server and hits all 5 routes over real HTTP to
 * confirm (or refute) the claim at the actual routing layer, not via a
 * second static read. Uses AUTH_MODE=public (same pattern as Suite A in
 * server/tests/e2e/api-routes.test.js) so requireAuth() passes without a
 * JWT — a 401 here would be an auth-config artifact, not the routing bug
 * under test.
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

async function postJSON(base, path, payload, headers) {
  payload = payload || {};
  const res = await apiFetch(base, path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

async function getJSONAuth(base, path, headers) {
  const res = await apiFetch(base, path, { headers: headers || {} });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

describe('E2E — /api/time-loop/* route family', { timeout: 120000 }, function() {
  let base;
  let serverProc;
  let dataDir;
  let authHeaders;
  const WORLD_ID = 'concordia-hub';

  before(async function() {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-timeloop-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'public' }, 90000);

    // Register a real user so start->end can be exercised with a genuine
    // userId (time-loop macros honestly reject a missing userId — that's
    // not the routing bug under test). `_t` is backdated past the route's
    // 2s bot-timing guard.
    const reg = await postJSON(base, '/api/auth/register', {
      username: 'timeloope2e' + Date.now(),
      email: 'timeloope2e' + Date.now() + '@example.com',
      password: 'CorrectHorseBattery9!',
      dateOfBirth: '1990-01-01',
      _t: Date.now() - 5000,
    });
    if (reg.status !== 201 || !reg.body || !reg.body.token) {
      throw new Error('Setup failed: could not register a test user: ' + JSON.stringify(reg));
    }
    authHeaders = { Authorization: 'Bearer ' + reg.body.token };
  });

  after(async function() {
    // Await the server's real exit BEFORE removing its data dir — rmSync
    // previously ran synchronously right after kicking off the (unawaited)
    // stopServer() promise, racing the still-alive server process, which was
    // still writing SQLite -wal/-shm files into dataDir. rmSync's recursive
    // directory walk would then throw ENOTEMPTY when a file reappeared
    // between its readdir and unlink calls. force:true only suppresses a
    // MISSING path (ENOENT), not this "still being written to" race.
    await stopServer(serverProc);
    // Remove the spawned server's data dir. Each of these e2e tests boots a
    // REAL server against a fresh mkdtemp dir that migrates a full ~118MB
    // SQLite DB. Without this the dir outlives the run, so one full suite
    // stranded ~800MB in /tmp and twice filled the disk mid-run.
    rmSync(dataDir, { recursive: true, force: true });
  });

  // None of these 5 assertions should ever see 404 — a 404 here is exactly
  // the "missing leading slash before a path param" defect class the audit
  // claimed. 200/400/500 (application-level outcomes) are all acceptable;
  // only 404 (route not found) falsifies "the route is registered".

  it('POST /api/time-loop/start is routed (not 404)', async function() {
    const { status, body } = await postJSON(base, '/api/time-loop/start', { worldId: WORLD_ID }, authHeaders);
    assert.notEqual(status, 404, 'POST /api/time-loop/start 404d — route not registered: ' + JSON.stringify(body));
  });

  it('GET /api/time-loop/active/:worldId is routed (not 404)', async function() {
    const { status, body } = await getJSONAuth(base, '/api/time-loop/active/' + WORLD_ID, authHeaders);
    assert.notEqual(status, 404, 'GET /api/time-loop/active/:worldId 404d — route not registered: ' + JSON.stringify(body));
  });

  it('GET /api/time-loop/memories/:worldId is routed (not 404)', async function() {
    const { status, body } = await getJSONAuth(base, '/api/time-loop/memories/' + WORLD_ID, authHeaders);
    assert.notEqual(status, 404, 'GET /api/time-loop/memories/:worldId 404d — route not registered: ' + JSON.stringify(body));
  });

  it('POST /api/time-loop/memory is routed (not 404)', async function() {
    const { status, body } = await postJSON(base, '/api/time-loop/memory', {
      worldId: WORLD_ID, summary: 'e2e test memory',
    }, authHeaders);
    assert.notEqual(status, 404, 'POST /api/time-loop/memory 404d — route not registered: ' + JSON.stringify(body));
  });

  it('POST /api/time-loop/:sessionId/end is routed (not 404), full start->end flow', async function() {
    // Drive a real start -> end round trip (with a real authenticated user)
    // so the :sessionId param path is exercised with a genuine, valid id
    // (not just a throwaway string), which proves the path-param route
    // matches AND the handler resolves it end to end.
    const startRes = await postJSON(base, '/api/time-loop/start', { worldId: WORLD_ID }, authHeaders);
    assert.notEqual(startRes.status, 404, 'start route 404d, cannot continue flow: ' + JSON.stringify(startRes.body));
    assert.equal(startRes.body && startRes.body.ok, true, 'expected ok:true from a real authenticated start: ' + JSON.stringify(startRes.body));
    const sessionId = startRes.body && startRes.body.sessionId;
    assert.ok(sessionId, 'expected a sessionId from a successful start: ' + JSON.stringify(startRes.body));

    const endRes = await postJSON(base, '/api/time-loop/' + sessionId + '/end', { reason: 'manual_exit' }, authHeaders);
    assert.notEqual(endRes.status, 404, 'POST /api/time-loop/:sessionId/end 404d — route not registered: ' + JSON.stringify(endRes.body));
    assert.equal(endRes.status, 200, 'expected 200 from end, got ' + endRes.status + ': ' + JSON.stringify(endRes.body));
    assert.equal(endRes.body && endRes.body.ok, true, 'expected ok:true from a real end call: ' + JSON.stringify(endRes.body));
  });

  // Sanity control: an actually-mistyped route (no leading slash before the
  // param segment would 404 the same way a genuinely unregistered path
  // does) should still 404, proving our "not 404" assertions above are
  // discriminating and not just a permissive test.
  it('control: a genuinely nonexistent time-loop path returns 404', async function() {
    const { status } = await getJSON(base, '/api/time-loop/this-does-not-exist-xyz');
    assert.equal(status, 404, 'Expected 404 for a bogus time-loop path, got ' + status);
  });
});
