/**
 * E2E HTTP-level tests — the public chat share-viewer route
 * ("shared conversations are the #1 organic loop for an AI product" gap
 * closure — the frontend page and share-create/share-view macros already
 * existed, but the only path to `chat.share-view` was the cookie-
 * authenticated `/api/lens/run` surface, so every copied `/share/chat/:token`
 * link required the *recipient* to already have a Concord account).
 *
 * Strategy mirrors `tests/e2e/animation-share-routes.test.js` exactly: spawn
 * server.js as a real child process with AUTH_MODE=hybrid (auth is genuinely
 * enforced elsewhere in this mode), register an authenticated user to mint a
 * real share token via the ordinary authenticated `/api/lens/run` path, then
 * drive the new public route with a bare `fetch` carrying ZERO Authorization
 * header and ZERO cookie — the exact shape a logged-out visitor's browser
 * uses from a shared link.
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

describe('E2E — chat public share viewer (/api/chat/share/:token)', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;
  let ownerHeaders;
  let shareToken, threadTitle;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-chatshare-'));
    base = 'http://127.0.0.1:' + port;
    // Hybrid, NOT public — auth must be genuinely enforced elsewhere in this
    // server for the "no auth required" assertions below to mean anything.
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);

    ownerHeaders = await registerUser(base, 'chatOwner');

    threadTitle = 'A conversation about welding';
    const shareRes = await postJSON(base, '/api/lens/run', {
      domain: 'chat', action: 'share-create',
      input: {
        threadId: 'thread-1',
        title: threadTitle,
        messages: [
          { role: 'user', content: 'What throat size for a 6mm fillet weld?' },
          { role: 'assistant', content: '6 × 0.707 = 4.2mm.' },
        ],
      },
    }, ownerHeaders);
    assert.equal(shareRes.status, 200, 'share-create failed: ' + JSON.stringify(shareRes));
    shareToken = shareRes.body?.result?.token;
    assert.ok(typeof shareToken === 'string' && shareToken.length > 0, 'expected a share token: ' + JSON.stringify(shareRes.body));
    assert.equal(shareRes.body?.result?.url, `/share/chat/${shareToken}`);
  });

  after(function() {
    const stopped = stopServer(serverProc);
    rmSync(dataDir, { recursive: true, force: true });
    return stopped;
  });

  it('GET /api/chat/share/:token — valid token, no auth headers/cookies, returns the exact thread', async function () {
    const { status, body } = await getJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken));
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.title, threadTitle);
    assert.equal(body?.result?.messageCount, 2);
    assert.equal(body?.result?.messages?.[0]?.content, 'What throat size for a 6mm fillet weld?');
    assert.equal(body?.result?.messages?.[1]?.content, '6 × 0.707 = 4.2mm.');
  });

  it('view counter increments across repeated anonymous requests (proves the real macro ran, not a static echo)', async function () {
    const first = await getJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken));
    const second = await getJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken));
    assert.equal(first.body?.ok, true);
    assert.equal(second.body?.ok, true);
    assert.ok(second.body.result.viewCount > first.body.result.viewCount,
      `expected viewCount to increment: first=${first.body.result.viewCount} second=${second.body.result.viewCount}`);
  });

  it('GET /api/chat/share/:token — unknown token returns 404, honest error, never a fabricated 200', async function () {
    const { status, body } = await getJSON(base, '/api/chat/share/definitely-not-a-real-token-xyz');
    assert.equal(status, 404, 'expected 404, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, false);
    assert.ok(typeof body?.error === 'string' && body.error.length > 0);
  });

  it('the route ignores any smuggled "action" override and never performs a mutating action (e.g. revoke)', async function () {
    const attempt = await getJSON(
      base,
      '/api/chat/share/' + encodeURIComponent(shareToken) + '?action=share-revoke&domain=chat'
    );
    assert.equal(attempt.status, 200, JSON.stringify(attempt));
    assert.equal(attempt.body?.ok, true);
    assert.equal(attempt.body?.result?.title, threadTitle);

    // Proof the share was NOT revoked: the ordinary token still resolves
    // afterward. A real share-revoke would have made every subsequent GET
    // fail (share-view checks `link.revoked`).
    const after1 = await getJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken));
    assert.equal(after1.status, 200, 'share must still be live — smuggled action must not have revoked it: ' + JSON.stringify(after1));
    assert.equal(after1.body?.ok, true);
  });

  it('POST to the share route itself is not handled (only GET is registered)', async function () {
    const postToGet = await postJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken), {});
    assert.notEqual(postToGet.status, 200, 'POST to the share route itself must not be handled: ' + JSON.stringify(postToGet));
  });

  it('the share route never returns 401 unauthenticated, in AUTH_MODE=hybrid', async function () {
    const res = await getJSON(base, '/api/chat/share/' + encodeURIComponent(shareToken));
    assert.notEqual(res.status, 401, 'GET share route must never require auth: ' + JSON.stringify(res));
  });

  it('sanity: a genuinely auth-protected route in this SAME hybrid-mode server still 401s unauthenticated', async function () {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'expected the known-protected route to 401, got ' + status);
  });
});

describe('Static source checks — the chat share route stays narrowly scoped', function () {
  it('publicReadDomains was NOT widened to include "chat" share-view — the narrow route bypass was used instead', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const m = src.match(/const publicReadDomains = \{[\s\S]*?\n {2}\};/);
    assert.ok(m, 'publicReadDomains block not found');
    // "chat" may legitimately appear for OTHER read macros (timeline/summary);
    // what must never happen is "share-view" being added to that allowlist,
    // since that would let anon callers reach it through the generic
    // /api/lens/run surface too, not just this one narrow route.
    assert.ok(!/share-view/.test(m[0]),
      'publicReadDomains must NOT list share-view — the narrow dedicated route is the only public path to it');
  });

  it('the new helper hardcodes "chat.share-view" and never reads an action name from the request', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const fnMatch = src.match(/function _runChatShareAction\([\s\S]*?\n\}/);
    assert.ok(fnMatch, '_runChatShareAction helper not found');
    const body = fnMatch[0];
    assert.match(body, /LENS_ACTIONS\.get\("chat\.share-view"\)/,
      'the helper must hardcode the exact "chat.share-view" key');
    assert.ok(!/req\.(body|query|params)\.action/.test(body),
      'the helper must never accept a caller-supplied action name');
  });

  it('/api/chat/share/:token is registered as GET only, with no sibling mutating route', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    assert.match(src, /app\.get\("\/api\/chat\/share\/:token"/);
    assert.ok(!/app\.(post|put|delete|patch)\("\/api\/chat\/share\//.test(src),
      'no mutating HTTP verb should ever be registered under /api/chat/share/');
  });

  it('"/api/chat/share/" is intentionally ABSENT from WRITE_AUTH_PUBLIC_PATHS — it is GET-only, no bypass needed', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const m = src.match(/const WRITE_AUTH_PUBLIC_PATHS = \[([^\]]*)\]/);
    assert.ok(m, 'WRITE_AUTH_PUBLIC_PATHS not found');
    assert.ok(!/["']\/api\/chat\/share\/["']/.test(m[1]),
      'no /api/chat/share/ entry should be added to the write-auth bypass allowlist — the GET-only route does not need it');
  });

  it('"/share/chat/" is now in the frontend middleware\'s PUBLIC_PREFIXES', async function () {
    const { readFileSync } = await import('node:fs');
    const mwPath = join(__dirname, '../../../concord-frontend/middleware.ts');
    const src = readFileSync(mwPath, 'utf8');
    assert.match(src, /'\/share\/chat\/'/, 'expected \'/share/chat/\' in PUBLIC_PREFIXES');
  });
});
