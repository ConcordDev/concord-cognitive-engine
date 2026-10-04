/**
 * E2E HTTP-level tests — public e-signature signing links
 *   GET  /api/esign/:token
 *   POST /api/esign/:token/sign
 *
 * A real server in AUTH_MODE=hybrid. Two signed-in senders create envelopes
 * through /api/lens/run; the recipient then views and signs with a bare
 * fetch — no Authorization header, no cookie — exactly like someone opening
 * an emailed link. Proves: (a) the link works with no account, (b) an
 * unknown token is a 404, never a fake success, (c) one sender's link can't
 * reach the other sender's envelope, (d) the sender can't sign the
 * recipient's slot themselves, (e) the bypass is narrow: a normal write
 * route still 401s anonymously in the same server, and (f) nothing claims
 * an email went out when no Gmail is connected.
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

describe('E2E — e-signature signing links (/api/esign/*)', { timeout: 150000 }, function () {
  let base, serverProc, dataDir, aHeaders, bHeaders;
  let tokenA, envelopeA, tokenB;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-esign-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
    aHeaders = await registerUser(base, 'esa');
    bHeaders = await registerUser(base, 'esb');

    const ca = await lensRun(base, aHeaders, 'tools', 'esign-create', {
      title: 'Consulting agreement', document: 'Alice will consult for Bob for one month.',
      parties: [{ name: 'Alice', isSender: true }, { name: 'Bob', email: 'bob@example.com' }],
    });
    envelopeA = ca.res.envelope;
    const sentA = await lensRun(base, aHeaders, 'tools', 'esign-send', { envelopeId: envelopeA.id });
    assert.equal(sentA.res.links[0].delivered, 'link_only', 'no Gmail connected — must not claim an email went out');
    tokenA = sentA.res.links[0].url.split('/sign/')[1];

    const cb = await lensRun(base, bHeaders, 'tools', 'esign-create', {
      title: 'Other deal', document: 'Unrelated.', parties: [{ name: 'Carol', isSender: true }, { name: 'Dan', email: 'dan@example.com' }],
    });
    const sentB = await lensRun(base, bHeaders, 'tools', 'esign-send', { envelopeId: cb.res.envelope.id });
    tokenB = sentB.res.links[0].url.split('/sign/')[1];
  });

  after(async function () {
    await stopServer(serverProc);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  });

  it('an anonymous recipient can view exactly their own document', async function () {
    const v = await getJSON(base, '/api/esign/' + tokenA);
    assert.equal(v.status, 200);
    assert.equal(v.body.result.document.title, 'Consulting agreement');
    assert.equal(v.body.result.signer.name, 'Bob');
    const vb = await getJSON(base, '/api/esign/' + tokenB);
    assert.equal(vb.body.result.document.title, 'Other deal');
    assert.equal(vb.body.result.signer.name, 'Dan');
  });

  it('an unknown token is a 404', async function () {
    const v = await getJSON(base, '/api/esign/not-a-real-token-1234567890');
    assert.equal(v.status, 404);
    const s = await postJSON(base, '/api/esign/not-a-real-token-1234567890/sign', { typedName: 'X', consent: true });
    assert.equal(s.status, 404);
  });

  it('the sender cannot sign the recipient slot from their account', async function () {
    const bob = envelopeA.parties.find((p) => p.name === 'Bob');
    const r = await lensRun(base, aHeaders, 'tools', 'esign-sign', { envelopeId: envelopeA.id, partyId: bob.id });
    assert.notEqual(r.res && r.res.ok, true);
  });

  it('signing requires consent and a typed name, then records it once', async function () {
    const noConsent = await postJSON(base, '/api/esign/' + tokenA + '/sign', { typedName: 'Bob Builder' });
    assert.equal(noConsent.status, 400);
    const ok = await postJSON(base, '/api/esign/' + tokenA + '/sign', { typedName: 'Bob Builder', consent: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    const again = await postJSON(base, '/api/esign/' + tokenA + '/sign', { typedName: 'Bob Builder', consent: true });
    assert.equal(again.status, 400);
    const detail = await lensRun(base, aHeaders, 'tools', 'esign-detail', { envelopeId: envelopeA.id });
    const bob = detail.res.envelope.parties.find((p) => p.name === 'Bob');
    assert.equal(bob.status, 'signed');
    assert.equal(bob.signedVia, 'link');
    assert.equal(bob.typedName, 'Bob Builder');
  });

  it('the bypass is narrow: a normal write still needs auth in the same server', async function () {
    const r = await postJSON(base, '/api/lens/run', { domain: 'tools', action: 'esign-create', input: { title: 'x', document: 'y', parties: [{ name: 'z' }] } });
    assert.ok(r.status === 401 || r.status === 403 || (r.body && r.body.ok === false), 'anonymous lens write must be refused: ' + r.status);
  });
});
