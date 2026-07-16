/**
 * E2E HTTP-level regression test — `/api/admin/liveness` role gate
 * (Wave 4 gap closure, `docs/lens-specs/ops-telemetry-capability-map.md`
 * "Real findings documented, not fixed").
 *
 * Prior to this fix, `/api/admin/liveness` (server/routes/helpers-extended.js)
 * was gated with `requireAuth()` only — a check that a caller is logged in at
 * all, with NO role check. Every sibling `/api/admin/*` route on the exact
 * same ops-telemetry page (`/api/admin/heartbeat-stats`, `/api/admin/worker-stats`,
 * `/api/admin/inference-costs`, `/api/admin/world-shards`, all in server.js)
 * is gated with `requireRole("owner", "admin", "sovereign", "founder")`. That
 * meant ANY logged-in user — not just an operator — could `curl` this one
 * operator metric, even though the ops-telemetry PAGE itself gates its whole
 * render behind the heartbeat-stats 403 check (i.e. the UI never exposed a
 * path to this data for a non-operator, but the API happily served it to one
 * anyway on direct request).
 *
 * The fix changes the route's middleware from `requireAuth()` to the exact
 * same `requireRole("owner", "admin", "sovereign", "founder")` used by its
 * siblings. This test proves:
 *   (a) a plain logged-in "member" gets 403 (the gap this fix closes — under
 *       the OLD `requireAuth()`-only code this same request would have
 *       returned 200, since requireAuth() only checks "is there a valid
 *       session", never the caller's role)
 *   (b) an "owner" (organically obtained: first registered user on a fresh
 *       DB, per routes/auth.js `role: userCount === 0 ? "owner" : "member"`)
 *       gets 200 with a real report body — no regression for a legitimate
 *       operator
 *   (c) "admin", "sovereign", and "founder" — the rest of the exact role
 *       list used by every sibling admin route — also get 200. These roles
 *       aren't reachable through ordinary signup, so the test promotes the
 *       same member user's `role` column directly in the isolated per-test
 *       SQLite DB between requests (role is read fresh from the `users`
 *       table on every request via `AuthDB.getUser` — server.js:5243 — not
 *       cached in the JWT, so this takes effect on the user's EXISTING
 *       token with no re-login needed) and re-requests with the same token.
 *   (d) a request with NO auth at all still gets 401 in AUTH_MODE=hybrid —
 *       proving auth is genuinely enforced in this test server (a green (a)
 *       against a server with auth globally off would prove nothing).
 *
 * Strategy mirrors tests/e2e/welding-portal-routes.test.js and
 * tests/e2e/time-loop-routes.test.js: spawn server.js as a real child
 * process with AUTH_MODE=hybrid, drive it with `fetch` + Bearer tokens
 * minted through the ordinary `/api/auth/register` flow.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

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

// Registers a fresh authenticated user, returns { headers, userId, username }.
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
  return {
    headers: { Authorization: 'Bearer ' + reg.body.token },
    userId: reg.body.user?.id,
    username: uniq,
  };
}

describe('E2E — /api/admin/liveness role gate', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;
  let ownerHeaders;
  let memberHeaders;
  let memberUserId;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-liveness-role-'));
    base = 'http://127.0.0.1:' + port;
    // Hybrid, NOT public — auth (and role checks) must be genuinely enforced,
    // or the 403/401 assertions below would be meaningless.
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);

    // First registration on a fresh DB becomes "owner" (routes/auth.js:
    // `role: userCount === 0 ? "owner" : "member"`); the second becomes
    // "member". Registration order here is intentional and load-bearing.
    const owner = await registerUser(base, 'lvOwner');
    ownerHeaders = owner.headers;

    const member = await registerUser(base, 'lvMember');
    memberHeaders = member.headers;
    memberUserId = member.userId;
    assert.ok(memberUserId, 'expected a real userId from registration: ' + JSON.stringify(member));
  });

  after(async function () {
    await stopServer(serverProc);
  });

  it('(d) no auth at all — 401 (proves auth is genuinely enforced in this server)', async function () {
    const res = await getJSON(base, '/api/admin/liveness', {});
    assert.equal(res.status, 401, 'expected 401 with zero Authorization header, got: ' + JSON.stringify(res));
  });

  it('(a) a plain "member" caller — 403, not the 200 the old requireAuth()-only gate would have returned', async function () {
    const res = await getJSON(base, '/api/admin/liveness', memberHeaders);
    // This is the exact gap the fix closes: under the OLD code
    // (`requireAuth()` only — see server/routes/helpers-extended.js history),
    // a "member" role with a perfectly valid session token would have
    // passed requireAuth() (it only checks "is there a valid user"), never
    // hit a role check at all, and received 200 with the full liveness
    // report body. requireRole() must now reject it with 403.
    assert.equal(res.status, 403, 'a non-operator "member" must be denied: ' + JSON.stringify(res));
    assert.match(
      String(res.body?.error || ''),
      /insufficient permission/i,
      'error body must match requireRole()\'s canonical shape: ' + JSON.stringify(res.body)
    );
    assert.deepEqual(res.body?.requiredRoles, ['owner', 'admin', 'sovereign', 'founder']);
  });

  it('(b) an "owner" (organic first-registered-user role) — 200 with a real liveness report body', async function () {
    const res = await getJSON(base, '/api/admin/liveness', ownerHeaders);
    assert.equal(res.status, 200, 'a real operator ("owner") must not be denied: ' + JSON.stringify(res));
    assert.equal(res.body?.ok, true);
    assert.ok(res.body?.headline && typeof res.body.headline === 'object', 'expected a headline sub-report: ' + JSON.stringify(res.body));
    assert.ok(res.body?.substrate && typeof res.body.substrate === 'object', 'expected a substrate sub-report: ' + JSON.stringify(res.body));
  });

  it('(c) "admin", "sovereign", and "founder" — 200 each, matching the exact sibling role list', async function () {
    // These three roles aren't reachable via ordinary signup (only "owner"
    // and "member" are). Role is read fresh from the `users` table on every
    // request (server.js AuthDB.getUser, called from authMiddleware) rather
    // than cached in the JWT, so flipping the DB row takes effect on the
    // member's EXISTING token with no re-login required.
    const db = new Database(join(dataDir, 'concord.db'));
    try {
      for (const role of ['admin', 'sovereign', 'founder']) {
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, memberUserId);
        const res = await getJSON(base, '/api/admin/liveness', memberHeaders);
        assert.equal(res.status, 200, `role="${role}" must be admitted: ` + JSON.stringify(res));
        assert.equal(res.body?.ok, true, `role="${role}" expected ok:true body: ` + JSON.stringify(res.body));
      }
    } finally {
      // Leave the row in a known, non-privileged state for hygiene even
      // though the DB is a throwaway per-test tmpdir.
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('member', memberUserId);
      db.close();
    }

    // Sanity: after restoring to "member", the gate is denying again — this
    // is what proves the 200s above came from the role flip, not from some
    // other accidental bypass (e.g. a stale cached session).
    const after1 = await getJSON(base, '/api/admin/liveness', memberHeaders);
    assert.equal(after1.status, 403, 'restoring role to "member" must re-deny: ' + JSON.stringify(after1));
  });
});
