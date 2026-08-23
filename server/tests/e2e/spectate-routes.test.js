/**
 * E2E HTTP-level tests — the public spectate viewer routes
 * (`/spectate/:worldId`'s "read-only live world feed, no account required,
 * always-on embeddable" gap closure).
 *
 * Before these routes existed, every call the frontend page made
 * (`spectator.subscribe`/`heartbeat`/`list_for_world` via the authenticated
 * `/api/lens/run`) 401'd for a genuinely anonymous visitor — confirmed
 * empirically, including for `spectator.list_for_world`, which WAS already
 * listed in Gate 2 (`publicReadDomains`) but that never mattered because
 * Gate 1 (authMiddleware) hard-401s any unauthenticated POST to
 * `/api/lens/run` with no matching bypass, before Gate 2 is ever consulted.
 *
 * Strategy mirrors `tests/e2e/animation-share-routes.test.js` /
 * `tests/e2e/chat-share-routes.test.js`: spawn server.js as a real child
 * process with AUTH_MODE=hybrid, then drive the new public routes with a
 * bare `fetch` carrying ZERO Authorization header and ZERO cookie.
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

async function getJSON(base, path) {
  const res = await apiFetch(base, path, {});
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
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
  try { body = await res.json(); } catch (_e) { body = null; }
  return { status: res.status, body: body };
}

describe('E2E — spectate public viewer (/api/spectate/*)', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;
  const worldId = 'concordia-hub';

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-spectate-'));
    base = 'http://127.0.0.1:' + port;
    // Hybrid, NOT public — auth must be genuinely enforced elsewhere in this
    // server for the "no auth required" assertions below to mean anything.
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
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
    rmSync(dataDir, { recursive: true, force: true });
  });

  let sessionToken;

  it('POST /api/spectate/:worldId/subscribe — no auth headers/cookies, returns a session token', async function () {
    const { status, body } = await postJSON(base, `/api/spectate/${encodeURIComponent(worldId)}/subscribe`);
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.ok(typeof body?.sessionToken === 'string' && body.sessionToken.length > 0, 'expected a session token: ' + JSON.stringify(body));
    sessionToken = body.sessionToken;
  });

  it('POST /api/spectate/heartbeat — no auth, refreshes the session', async function () {
    const { status, body } = await postJSON(base, '/api/spectate/heartbeat', { sessionToken });
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
  });

  it('POST /api/spectate/heartbeat — missing token is rejected honestly, not a fabricated 200', async function () {
    const { status, body } = await postJSON(base, '/api/spectate/heartbeat', {});
    assert.notEqual(status, 200, JSON.stringify(body));
    assert.equal(body?.ok, false);
  });

  it('GET /api/spectate/:worldId/feed — no auth, returns spectators + dispatches, and the subscribed session is counted', async function () {
    const { status, body } = await getJSON(base, `/api/spectate/${encodeURIComponent(worldId)}/feed`);
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.worldId, worldId);
    assert.ok(Array.isArray(body?.spectators));
    assert.ok(Array.isArray(body?.dispatches));
    assert.ok(body.spectators.some((s) => s.viewer_user_id === null),
      'expected the anonymous session just opened to appear with viewer_user_id:null: ' + JSON.stringify(body.spectators));
  });

  it('the subscribe route never returns 401 unauthenticated, in AUTH_MODE=hybrid', async function () {
    const res = await postJSON(base, `/api/spectate/${encodeURIComponent(worldId)}/subscribe`);
    assert.notEqual(res.status, 401, 'subscribe must never require auth: ' + JSON.stringify(res));
  });

  it('sanity: a genuinely auth-protected route in this SAME hybrid-mode server still 401s unauthenticated', async function () {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'expected the known-protected route to 401, got ' + status);
  });
});

describe('Static source checks — the spectate routes stay narrowly scoped', function () {
  it('the helper hardcodes MACROS lookups and never reads a domain/action name from the request', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const fnMatch = src.match(/function _runSpectateMacro\([\s\S]*?\n\}/);
    assert.ok(fnMatch, '_runSpectateMacro helper not found');
    assert.ok(!/req\.(body|query|params)\.(domain|name|action)/.test(fnMatch[0]),
      'the helper must never accept a caller-supplied domain/action name');

    // Only the 3 known-safe calls exist, none of them reach betting.place_bet
    // (a real-money SPARKS debit on the same MACROS map).
    assert.match(src, /_runSpectateMacro\("spectator", "subscribe"/);
    assert.match(src, /_runSpectateMacro\("spectator", "heartbeat"/);
    assert.match(src, /_runSpectateMacro\("spectator", "list_for_world"/);
    assert.match(src, /_runSpectateMacro\("goddess", "recent"/);
    assert.ok(!/_runSpectateMacro\("betting"/.test(src), 'must never reach the betting domain');
  });

  it('"/api/spectate/" is in WRITE_AUTH_PUBLIC_PATHS (the two POST routes need it; GET does not)', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const m = src.match(/const WRITE_AUTH_PUBLIC_PATHS = \[([^\]]*)\]/);
    assert.ok(m, 'WRITE_AUTH_PUBLIC_PATHS not found');
    assert.match(m[1], /["']\/api\/spectate\/["']/);
  });

  it('"/spectate/" is in the frontend middleware\'s PUBLIC_PREFIXES', async function () {
    const { readFileSync } = await import('node:fs');
    const mwPath = join(__dirname, '../../../concord-frontend/middleware.ts');
    const src = readFileSync(mwPath, 'utf8');
    assert.match(src, /'\/spectate\/'/, 'expected \'/spectate/\' in PUBLIC_PREFIXES');
  });
});
