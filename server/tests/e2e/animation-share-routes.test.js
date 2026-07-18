/**
 * E2E HTTP-level tests — the public animation share-viewer route
 * (Wave 4 gap closure, `docs/lens-specs/animation-capability-map.md`
 * checklist item 17, "Fully public (logged-out) share viewing").
 *
 * `animation.share-get` (server/domains/animation.js) already implemented
 * a token-based public share (minted by `animation.share-create`), but
 * nothing exposed it publicly — the only way to reach a
 * `registerLensAction` handler was the authenticated `/api/lens/run`
 * surface, which `_lensActionForbiddenForAnon` hard-rejects for anonymous
 * callers in production regardless of `publicReadDomains`. This test
 * drives the new dedicated public route:
 *   GET /api/animation/share/:token
 *
 * Strategy mirrors `tests/e2e/welding-portal-routes.test.js`: spawn
 * server.js as a real child process with AUTH_MODE=hybrid (auth is
 * genuinely enforced elsewhere in this mode — a false "works" from
 * AUTH_MODE=public turning every gate off would prove nothing), register
 * an authenticated user to mint a real share token via the ordinary
 * authenticated `/api/lens/run` path, then drive the new public route with
 * a bare `fetch` carrying ZERO Authorization header and ZERO cookie — the
 * exact shape a logged-out visitor's browser uses from a shared link.
 *
 * Required properties (per task):
 *   (a) a valid token views the EXACT animation it was issued for, with NO
 *       auth at all
 *   (b) an invalid/unknown token is rejected (404, honest error — never a
 *       fabricated 200)
 *   (c) the route can only ever invoke `animation.share-get` — never any
 *       other animation action (mutating or otherwise), proven by
 *       attempting to smuggle an alternate action name in and confirming
 *       it has zero effect (the share is never revoked, no other domain
 *       action fires)
 * Plus: allowDownload=false redaction is preserved end-to-end through the
 * new route, and the route never returns 401 unauthenticated in a server
 * where a genuinely auth-protected route in the SAME process still does
 * (proving this is a narrow, deliberate bypass, not auth being globally
 * off).
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

// ── Boilerplate (same shape as tests/e2e/welding-portal-routes.test.js) ────

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
      DATA_DIR: dataDir,
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

// Registers a fresh authenticated user and returns Bearer headers.
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

describe('E2E — animation public share viewer (/api/animation/share/:token)', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let ownerHeaders;

  let animId, animToken, animTitle;
  let noDownloadAnimId, noDownloadToken;

  before(async function () {
    const port = await getFreePort();
    const dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-animshare-'));
    base = 'http://127.0.0.1:' + port;
    // Hybrid, NOT public — auth must be genuinely enforced elsewhere in
    // this server for the "no auth required" assertions below to mean
    // anything.
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);

    ownerHeaders = await registerUser(base, 'animOwner');

    // ── Create an animation + a downloadable share token ────────────────
    animTitle = 'Bouncing Ball — Wave 4';
    const createRes = await postJSON(base, '/api/lens/run', {
      domain: 'animation', action: 'anim-create',
      input: { title: animTitle, width: 320, height: 240, fps: 24 },
    }, ownerHeaders);
    assert.equal(createRes.status, 200, 'anim-create failed: ' + JSON.stringify(createRes));
    animId = createRes.body?.result?.animation?.id;
    assert.ok(animId, 'expected a real animation id: ' + JSON.stringify(createRes.body));

    const shareRes = await postJSON(base, '/api/lens/run', {
      domain: 'animation', action: 'share-create',
      input: { animId, allowDownload: true },
    }, ownerHeaders);
    assert.equal(shareRes.status, 200, 'share-create failed: ' + JSON.stringify(shareRes));
    animToken = shareRes.body?.result?.share?.token;
    assert.ok(typeof animToken === 'string' && animToken.length > 0, 'expected a share token: ' + JSON.stringify(shareRes.body));
    assert.equal(shareRes.body?.result?.share?.url, `/share/animation/${animToken}`);

    // ── A second animation, shared with downloads disabled ──────────────
    const createRes2 = await postJSON(base, '/api/lens/run', {
      domain: 'animation', action: 'anim-create',
      input: { title: 'No-download demo', width: 100, height: 100, fps: 12 },
    }, ownerHeaders);
    assert.equal(createRes2.status, 200);
    noDownloadAnimId = createRes2.body?.result?.animation?.id;

    const shareRes2 = await postJSON(base, '/api/lens/run', {
      domain: 'animation', action: 'share-create',
      input: { animId: noDownloadAnimId, allowDownload: false },
    }, ownerHeaders);
    assert.equal(shareRes2.status, 200);
    noDownloadToken = shareRes2.body?.result?.share?.token;
    assert.ok(typeof noDownloadToken === 'string' && noDownloadToken.length > 0);
  });

  after(function () { return stopServer(serverProc); });

  // ── (a) a valid token views the EXACT animation it was issued for, with
  //        NO auth at all ────────────────────────────────────────────────

  it('GET /api/animation/share/:token — valid token, no auth headers/cookies, returns the exact animation', async function () {
    const { status, body } = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animToken));
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.animation?.id, animId);
    assert.equal(body?.result?.animation?.title, animTitle);
    assert.equal(body?.result?.animation?.width, 320);
    assert.equal(body?.result?.animation?.height, 240);
    assert.equal(body?.result?.share?.token, animToken);
    assert.equal(body?.result?.share?.allowDownload, true);
    // allowDownload:true → frames are present (not redacted).
    assert.ok(Array.isArray(body?.result?.animation?.frames), 'expected frames to be present when allowDownload is true');
  });

  it('view counter increments across repeated anonymous requests (proves the real macro ran, not a static echo)', async function () {
    const first = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animToken));
    const second = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animToken));
    assert.equal(first.body?.ok, true);
    assert.equal(second.body?.ok, true);
    assert.ok(second.body.result.share.views > first.body.result.share.views,
      `expected views to increment: first=${first.body.result.share.views} second=${second.body.result.share.views}`);
  });

  it('allowDownload:false is honored end-to-end — frames are redacted, thumbnail/metadata still present', async function () {
    const { status, body } = await getJSON(base, '/api/animation/share/' + encodeURIComponent(noDownloadToken));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.animation?.id, noDownloadAnimId);
    assert.equal(body?.result?.share?.allowDownload, false);
    assert.equal(body?.result?.animation?.frames, undefined, 'frames must be redacted when the owner disabled downloads');
    // frameCount (metadata) is still exposed — only raw stroke data is withheld.
    assert.equal(typeof body?.result?.animation?.frameCount, 'number');
  });

  // ── (b) an invalid/unknown token is rejected, never a fabricated 200 ────

  it('GET /api/animation/share/:token — unknown token returns 404, honest error, never a fabricated 200', async function () {
    const { status, body } = await getJSON(base, '/api/animation/share/definitely-not-a-real-token-xyz');
    assert.equal(status, 404, 'expected 404, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, false);
    assert.ok(typeof body?.error === 'string' && body.error.length > 0);
  });

  it('a raw animation id (not a token) never resolves via the share route — no id-based access path exists', async function () {
    const attempt = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animId));
    assert.notEqual(attempt.status, 200, 'a raw animation id must never resolve via the token route: ' + JSON.stringify(attempt));
    assert.equal(attempt.body?.ok, false);
  });

  // ── (c) the route can ONLY ever invoke `animation.share-get` — never any
  //        other action, mutating or otherwise ─────────────────────────────

  it('the route ignores any smuggled "action" override and never performs a mutating action (e.g. revoke)', async function () {
    // Attempt to smuggle an alternate action name via query string — the
    // server-side helper hardcodes "animation.share-get" and never reads an
    // action/method field from the request at all, so this must have zero
    // effect: no revoke, no other mutation, response shape unchanged.
    const attempt = await getJSON(
      base,
      '/api/animation/share/' + encodeURIComponent(animToken) + '?action=share-revoke&domain=animation'
    );
    assert.equal(attempt.status, 200, JSON.stringify(attempt));
    assert.equal(attempt.body?.ok, true);
    assert.equal(attempt.body?.result?.animation?.id, animId);

    // Proof the share was NOT revoked: the ordinary token still resolves
    // afterward. A real share-revoke would have deleted the token and every
    // subsequent GET would 404.
    const after1 = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animToken));
    assert.equal(after1.status, 200, 'share must still be live — smuggled action must not have revoked it: ' + JSON.stringify(after1));
    assert.equal(after1.body?.ok, true);
    assert.equal(after1.body?.result?.animation?.id, animId);
  });

  it('there is no route registered for any other animation action under this prefix (POST/other actions 404 or are method-not-allowed)', async function () {
    // Only GET /api/animation/share/:token exists. Attempting to reach a
    // sibling mutating action (e.g. a hypothetical /revoke or /approve
    // suffix, mirroring the welding portal's action-suffix shape) must not
    // resolve to anything — proving no other animation action was
    // accidentally exposed on this prefix.
    const revokeAttempt = await postJSON(base, '/api/animation/share/' + encodeURIComponent(animToken) + '/revoke', {});
    assert.notEqual(revokeAttempt.status, 200, 'no mutating suffix route should exist under /api/animation/share/: ' + JSON.stringify(revokeAttempt));

    const postToGet = await postJSON(base, '/api/animation/share/' + encodeURIComponent(animToken), {});
    assert.notEqual(postToGet.status, 200, 'POST to the share route itself must not be handled (only GET is registered): ' + JSON.stringify(postToGet));
  });

  // ── auth-bypass is narrow and deliberate, not global ─────────────────────

  it('the share route never returns 401 unauthenticated, in AUTH_MODE=hybrid', async function () {
    const res = await getJSON(base, '/api/animation/share/' + encodeURIComponent(animToken));
    assert.notEqual(res.status, 401, 'GET share route must never require auth: ' + JSON.stringify(res));
  });

  it('sanity: a genuinely auth-protected route in this SAME hybrid-mode server still 401s unauthenticated', async function () {
    // Proves AUTH_MODE=hybrid really is enforcing auth elsewhere — so the
    // share route's 200s above are a deliberate, narrow bypass, not a
    // symptom of auth being globally disabled for this whole test run.
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'expected the known-protected route to 401, got ' + status);
  });

  // Note: the generic `/api/lens/run` anon gate (`_lensActionForbiddenForAnon`)
  // is a production-only check (see `server/tests/lens-auth-gate.test.js`,
  // which locks it statically) — it is a deliberate no-op outside
  // NODE_ENV=production, so this e2e process (NODE_ENV=e2e-test) can't
  // exercise "anon /api/lens/run 401s" at runtime without standing up a full
  // production boot. The static-source assertions below (in the companion
  // describe block) instead pin the two things that actually matter here:
  // `animation` was never added to `publicReadDomains`, and the new public
  // route can only ever invoke `animation.share-get`.
});

describe('Static source checks — the animation share route stays narrowly scoped', function () {
  it('publicReadDomains was NOT widened to include "animation" (the doc\'s wrong fix was not taken)', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const m = src.match(/const publicReadDomains = \{[\s\S]*?\n {2}\};/);
    assert.ok(m, 'publicReadDomains block not found');
    assert.ok(!/\n\s*animation:\s*new Set/.test(m[0]),
      'publicReadDomains must NOT gain an "animation" key — that would expose every animation macro to anon callers, not just share-get');
  });

  it('the new helper hardcodes "animation.share-get" and never reads an action name from the request', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const fnMatch = src.match(/function _runAnimationShareAction\([\s\S]*?\n\}/);
    assert.ok(fnMatch, '_runAnimationShareAction helper not found');
    const body = fnMatch[0];
    assert.match(body, /LENS_ACTIONS\.get\("animation\.share-get"\)/,
      'the helper must hardcode the exact "animation.share-get" key');
    // The action string must not be assembled from any caller-supplied field
    // (no req.body.action / req.query.action / params.action reaching the key).
    assert.ok(!/req\.(body|query|params)\.action/.test(body),
      'the helper must never accept a caller-supplied action name');
  });

  it('/api/animation/share/:token is registered as GET only, with no sibling mutating route', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    assert.match(src, /app\.get\("\/api\/animation\/share\/:token"/);
    assert.ok(!/app\.(post|put|delete|patch)\("\/api\/animation\/share\//.test(src),
      'no mutating HTTP verb should ever be registered under /api/animation/share/');
  });

  it('"/api/animation/share/" is present in WRITE_AUTH_PUBLIC_PATHS, mirroring the welding portal precedent', async function () {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SERVER_JS, 'utf8');
    const m = src.match(/const WRITE_AUTH_PUBLIC_PATHS = \[([^\]]*)\]/);
    assert.ok(m, 'WRITE_AUTH_PUBLIC_PATHS not found');
    assert.ok(/["']\/api\/animation\/share\/["']/.test(m[1]));
  });
});
