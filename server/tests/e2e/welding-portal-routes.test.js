/**
 * E2E HTTP-level tests — the public welding client-portal routes
 * (Wave 4 gap closure, `docs/lens-specs/welding-capability-map.md`
 * "Investigated and honestly deferred").
 *
 * `welding.portal-view` / `portal-approve` / `portal-pay`
 * (server/domains/welding.js) already implemented a token-based client
 * portal, but nothing exposed it publicly — the only way to reach a
 * `registerLensAction` handler was the authenticated `/api/lens/run`
 * surface, which is exactly backwards for a customer with no Concord
 * account. This test drives the new dedicated public routes:
 *   GET  /api/welding/portal/:token
 *   POST /api/welding/portal/:token/approve
 *   POST /api/welding/portal/:token/pay
 *
 * Strategy mirrors tests/e2e/api-routes.test.js (Suite B) and
 * tests/e2e/time-loop-routes.test.js: spawn server.js as a real child
 * process with AUTH_MODE=hybrid (auth is genuinely enforced elsewhere in
 * this mode — a false "works" from AUTH_MODE=public turning every gate off
 * would prove nothing), register two authenticated "welder" users to mint
 * real portal tokens via the ordinary authenticated `/api/lens/run` path,
 * then drive the new public routes with a bare `fetch` carrying ZERO
 * Authorization header and ZERO cookie — the exact shape a customer's
 * browser uses from an emailed/texted link.
 *
 * Required properties (per task):
 *   (a) a valid token views/approves the EXACT estimate/invoice it was
 *       issued for
 *   (b) an invalid/unknown token is rejected (404, honest error — never a
 *       fabricated 200)
 *   (c) a valid token minted for welder A's estimate can never resolve
 *       welder B's estimate (no cross-tenant leak / no enumeration)
 *   (d) the whole family works with NO auth at all, contrasted in the SAME
 *       hybrid-mode server against a route that genuinely still 401s
 *       unauthenticated — proving the bypass is real and narrowly scoped,
 *       not a symptom of auth being globally off
 * Plus: portal-pay is proven to be an HONEST, non-mutating "not yet wired"
 * response (the invoice's balance/status are byte-identical before and
 * after a pay attempt — no fabricated payment is ever recorded), and the
 * minted token is proven to use the new crypto-secure format rather than
 * the old guessable `wId()` shape.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Registers a fresh authenticated "welder" user and returns Bearer headers.
async function registerWelder(base, label) {
  const uniq = label + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const reg = await postJSON(base, '/api/auth/register', {
    username: uniq,
    email: uniq + '@example.com',
    password: 'CorrectHorseBattery9!',
    dateOfBirth: '1990-01-01',
    _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body || !reg.body.token) {
    throw new Error('Setup failed: could not register welder ' + label + ': ' + JSON.stringify(reg));
  }
  return { Authorization: 'Bearer ' + reg.body.token };
}

describe('E2E — welding client portal (/api/welding/portal/*)', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;
  let welderAHeaders;
  let welderBHeaders;

  // Welder A's data
  let estimateAId, estimateAToken;
  let invoiceAId, invoiceAToken, invoiceAAmount;

  // Welder B's data (for cross-tenant isolation checks)
  let estimateBId, estimateBToken;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-weldportal-'));
    base = 'http://127.0.0.1:' + port;
    // Hybrid, NOT public — auth must be genuinely enforced elsewhere in
    // this server for the "no auth required" assertions below to mean
    // anything.
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);

    welderAHeaders = await registerWelder(base, 'welderA');
    welderBHeaders = await registerWelder(base, 'welderB');

    // ── Welder A: estimate → portal token ──────────────────────────────
    const estA = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'estimate-create',
      input: { title: 'Fence repair — Acme Yard', client: 'Acme Yard Co', address: '1 Acme Way',
        lineItems: [{ description: 'Repair fence weld', quantity: 2, unitPrice: 150, kind: 'labor' }], taxRate: 0.08 },
    }, welderAHeaders);
    assert.equal(estA.status, 200, 'welder A estimate-create failed: ' + JSON.stringify(estA));
    assert.ok(estA.body?.result?.estimate?.id, 'expected a real estimate id: ' + JSON.stringify(estA.body));
    estimateAId = estA.body.result.estimate.id;

    const sendA = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'estimate-send', input: { estimateId: estimateAId },
    }, welderAHeaders);
    assert.equal(sendA.status, 200, 'welder A estimate-send failed: ' + JSON.stringify(sendA));
    estimateAToken = sendA.body?.result?.portalToken;
    assert.ok(typeof estimateAToken === 'string' && estimateAToken.length > 0, 'expected a portalToken: ' + JSON.stringify(sendA.body));

    // ── Welder A: job → invoice → portal token ─────────────────────────
    const jobA = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'job-schedule',
      input: { title: 'Gate install — Acme Yard', client: 'Acme Yard Co', scheduledDate: '2026-08-01' },
    }, welderAHeaders);
    assert.equal(jobA.status, 200, 'welder A job-schedule failed: ' + JSON.stringify(jobA));
    const jobAId = jobA.body?.result?.job?.id;
    assert.ok(jobAId, 'expected a real job id: ' + JSON.stringify(jobA.body));

    invoiceAAmount = 640;
    const invA = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'invoice-from-job', input: { jobId: jobAId, amount: invoiceAAmount },
    }, welderAHeaders);
    assert.equal(invA.status, 200, 'welder A invoice-from-job failed: ' + JSON.stringify(invA));
    invoiceAId = invA.body?.result?.invoice?.id;
    invoiceAToken = invA.body?.result?.invoice?.portalToken;
    assert.ok(invoiceAId, 'expected a real invoice id: ' + JSON.stringify(invA.body));
    assert.ok(typeof invoiceAToken === 'string' && invoiceAToken.length > 0, 'expected an invoice portalToken: ' + JSON.stringify(invA.body));

    // ── Welder B: a second, distinct estimate (for isolation checks) ───
    const estB = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'estimate-create',
      input: { title: 'Handrail fab — Zenith Lofts', client: 'Zenith Lofts LLC', address: '9 Zenith Ave',
        lineItems: [{ description: 'Fabricate handrail', quantity: 1, unitPrice: 900, kind: 'labor' }], taxRate: 0.07 },
    }, welderBHeaders);
    assert.equal(estB.status, 200, 'welder B estimate-create failed: ' + JSON.stringify(estB));
    estimateBId = estB.body?.result?.estimate?.id;
    assert.ok(estimateBId, 'expected a real estimate id for welder B: ' + JSON.stringify(estB.body));
    assert.notEqual(estimateBId, estimateAId, 'sanity: A and B must be different estimates');

    const sendB = await postJSON(base, '/api/lens/run', {
      domain: 'welding', action: 'estimate-send', input: { estimateId: estimateBId },
    }, welderBHeaders);
    assert.equal(sendB.status, 200, 'welder B estimate-send failed: ' + JSON.stringify(sendB));
    estimateBToken = sendB.body?.result?.portalToken;
    assert.ok(typeof estimateBToken === 'string' && estimateBToken.length > 0, 'expected a portalToken for welder B: ' + JSON.stringify(sendB.body));
    assert.notEqual(estimateBToken, estimateAToken, 'sanity: tokens must differ');
  });

  after(function() {
    const stopped = stopServer(serverProc);
    // Remove the spawned server's data dir. Each of these e2e tests boots a
    // REAL server against a fresh mkdtemp dir that migrates a full ~118MB
    // SQLite DB. Without this the dir outlives the run, so one full suite
    // stranded ~800MB in /tmp and twice filled the disk mid-run.
    // force:true so a missing dir can never fail teardown.
    rmSync(dataDir, { recursive: true, force: true });
    return stopped;
  });

  // ── Token strength (secured-token fix) ──────────────────────────────────

  it('minted portal tokens use the crypto-secure format, not the old guessable wId() shape', function () {
    // Old shape: `pt_<base36 timestamp>_<6 base36 chars>` — reject it explicitly.
    const OLD_WEAK_SHAPE = /^pt_[0-9a-z]+_[0-9a-z]{6}$/;
    assert.equal(OLD_WEAK_SHAPE.test(estimateAToken), false, 'token still uses the old guessable wId() format: ' + estimateAToken);
    // New shape: crypto.randomBytes(24).toString('base64url') — 32 base64url
    // chars (24 bytes, no padding), safely long and character-set-restricted.
    assert.match(estimateAToken, /^[A-Za-z0-9_-]{30,}$/, 'expected a long base64url token, got: ' + estimateAToken);
    assert.ok(estimateAToken.length >= 30, 'expected >=30 chars of entropy, got length ' + estimateAToken.length);
  });

  // ── (a) a valid token views the EXACT estimate/invoice it was issued for ──

  it('GET /api/welding/portal/:token (estimate) — valid token, no auth, returns the exact estimate', async function () {
    const { status, body } = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateAToken));
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.kind, 'estimate');
    assert.equal(body?.result?.estimate?.id, estimateAId);
    assert.equal(body?.result?.estimate?.client, 'Acme Yard Co');
    assert.equal(body?.result?.canApprove, true);
  });

  it('GET /api/welding/portal/:token (invoice) — valid token, no auth, returns the exact invoice', async function () {
    const { status, body } = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken));
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.kind, 'invoice');
    assert.equal(body?.result?.invoice?.id, invoiceAId);
    assert.equal(body?.result?.invoice?.amount, invoiceAAmount);
    assert.equal(body?.result?.canPay, true);
  });

  it('POST /api/welding/portal/:token/approve — valid token, no auth, accepts the exact estimate', async function () {
    const { status, body } = await postJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateAToken) + '/approve', {
      decision: 'accept', signature: 'Wile E. Coyote',
    });
    assert.equal(status, 200, 'expected 200, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, true);
    assert.equal(body?.result?.estimate?.id, estimateAId);
    assert.equal(body?.result?.estimate?.status, 'accepted');
    assert.equal(body?.result?.estimate?.acceptedBy, 'Wile E. Coyote');

    // Re-fetch: canApprove flips false, status persists.
    const refetch = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateAToken));
    assert.equal(refetch.body?.result?.estimate?.status, 'accepted');
    assert.equal(refetch.body?.result?.canApprove, false);
  });

  // ── (b) an invalid/unknown token is rejected, never a fabricated 200 ────

  it('GET /api/welding/portal/:token — unknown token returns 404 invalid_token, not a fabricated 200', async function () {
    const { status, body } = await getJSON(base, '/api/welding/portal/definitely-not-a-real-token-xyz');
    assert.equal(status, 404, 'expected 404, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, false);
    assert.equal(body?.error, 'invalid_token');
  });

  it('POST /api/welding/portal/:token/approve — unknown token returns 404, mutates nothing', async function () {
    const { status, body } = await postJSON(base, '/api/welding/portal/definitely-not-a-real-token-xyz/approve', {
      decision: 'accept', signature: 'Nobody',
    });
    assert.equal(status, 404, 'expected 404, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, false);
    assert.equal(body?.error, 'invalid_token');
  });

  it('POST /api/welding/portal/:token/pay — unknown token returns 404', async function () {
    const { status, body } = await postJSON(base, '/api/welding/portal/definitely-not-a-real-token-xyz/pay', {});
    assert.equal(status, 404, 'expected 404, got ' + status + ': ' + JSON.stringify(body));
    assert.equal(body?.ok, false);
  });

  // ── (c) welder A's token can never resolve welder B's data ─────────────

  it('welder A token and welder B token resolve to strictly their own estimate — no cross-tenant leak', async function () {
    const viewB = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateBToken));
    assert.equal(viewB.status, 200, JSON.stringify(viewB));
    assert.equal(viewB.body?.result?.estimate?.id, estimateBId);
    assert.equal(viewB.body?.result?.estimate?.client, 'Zenith Lofts LLC');
    // The defining isolation assertion: B's token must never surface A's data.
    assert.notEqual(viewB.body?.result?.estimate?.id, estimateAId);
    assert.notEqual(viewB.body?.result?.estimate?.client, 'Acme Yard Co');
  });

  it("welder A's own token cannot be reused to approve/view welder B's estimate by guessing B's id", async function () {
    // There is no id-based portal endpoint at all (only token-based) — this
    // proves the surface never accepts an estimate/invoice id directly, only
    // an opaque token, so B's real database id is not itself a usable key.
    const attempt = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateBId));
    assert.notEqual(attempt.status, 200, 'a raw estimate id must never resolve via the token route: ' + JSON.stringify(attempt));
    assert.equal(attempt.body?.ok, false);
  });

  // ── portal-pay: honest "not yet wired", never a fabricated success ──────

  it('POST /api/welding/portal/:token/pay — valid invoice token returns an HONEST not-wired response and mutates nothing', async function () {
    const before1 = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken));
    assert.equal(before1.body?.result?.invoice?.status, 'unpaid');
    assert.equal(before1.body?.result?.invoice?.balance, invoiceAAmount);

    const { status, body } = await postJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken) + '/pay', {
      amount: invoiceAAmount, method: 'card',
    });
    // Never a fabricated 200 success — the underlying macro has no real
    // payment gateway behind it.
    assert.notEqual(status, 200);
    assert.equal(body?.ok, false);
    assert.equal(body?.reason, 'payment_capture_not_wired');
    assert.equal(typeof body?.message, 'string');
    assert.ok(body.message.length > 0);

    // Nothing changed — this is the load-bearing honesty assertion: a
    // fabricated success would have flipped status to "paid"/"partial" and
    // dropped the balance. It must not have.
    const after1 = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken));
    assert.equal(after1.body?.result?.invoice?.status, 'unpaid');
    assert.equal(after1.body?.result?.invoice?.balance, invoiceAAmount);
    assert.equal(after1.body?.result?.invoice?.amountPaid, 0);
    assert.deepEqual(after1.body?.result?.invoice?.payments, []);
  });

  // ── (d) the whole family works with NO auth, contrasted against a route
  //        that genuinely still 401s unauthenticated in this SAME server ──

  it('none of the three portal routes ever return 401, unauthenticated, in AUTH_MODE=hybrid', async function () {
    const getRes = await getJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken));
    assert.notEqual(getRes.status, 401, 'GET portal-view must never require auth: ' + JSON.stringify(getRes));

    const approveRes = await postJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateBToken) + '/approve', { decision: 'reject' });
    assert.notEqual(approveRes.status, 401, 'POST portal-approve must never require auth: ' + JSON.stringify(approveRes));

    const payRes = await postJSON(base, '/api/welding/portal/' + encodeURIComponent(invoiceAToken) + '/pay', {});
    assert.notEqual(payRes.status, 401, 'POST portal-pay must never require auth: ' + JSON.stringify(payRes));
  });

  it('sanity: a genuinely auth-protected route in this SAME hybrid-mode server still 401s unauthenticated', async function () {
    // Proves AUTH_MODE=hybrid really is enforcing auth elsewhere — so the
    // portal routes' 200s above are a deliberate, narrow bypass, not a
    // symptom of auth being globally disabled for this whole test run.
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401, 'expected the known-protected route to 401, got ' + status);
  });

  it('POST /api/welding/portal/:token/approve — reject decision works end-to-end, no auth', async function () {
    const { status, body } = await postJSON(base, '/api/welding/portal/' + encodeURIComponent(estimateBToken) + '/approve', {
      decision: 'reject',
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body?.result?.estimate?.id, estimateBId);
    assert.equal(body?.result?.estimate?.status, 'rejected');
  });
});
