/**
 * E2E — generic token-scoped public share route (/api/public-share/:kind/:id)
 * for creative proof links, published event pages, shared docs pages.
 * Bare unauthenticated fetches against a hybrid-auth server; share objects are
 * minted through the authenticated /api/lens/run path.
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


describe('E2E — /api/public-share/:kind/:id', { timeout: 120000 }, function () {
  let base, serverProc, dataDir, owner, proofToken, eventSlug, docToken, privatePageId, portalToken, giveSlug, draftGiveSlug;

  const run = (domain, action, input) => postJSON(base, '/api/lens/run', { domain, action, input }, owner);

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-pubshare-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid' }, 90000);
    owner = await registerUser(base, 'shareOwner');

    const asset = await run('creative', 'review-asset-create', { name: 'Cut v3', kind: 'image', src: 'https://example.com/a.png' });
    const link = await run('creative', 'prooflink-create', { assetId: asset.body?.result?.asset?.id, label: 'Client review' });
    proofToken = link.body?.result?.link?.token;
    assert.ok(proofToken && proofToken.startsWith('pl_') && proofToken.length > 20, JSON.stringify(link.body));

    const ev = await run('events', 'event-create', { name: 'Launch Party' });
    const evId = ev.body?.result?.event?.id;
    const draft = await run('events', 'event-create', { name: 'Secret Offsite' });
    const draftId = draft.body?.result?.event?.id;
    const pub = await run('events', 'publish-page', { eventId: evId, headline: 'Come celebrate', blurb: 'Cake.' });
    eventSlug = pub.body?.result?.publicPage?.slug;
    assert.ok(eventSlug, JSON.stringify(pub.body));
    // Draft event gets a slug but stays unpublished.
    const unpub = await run('events', 'publish-page', { eventId: draftId, published: false });
    globalThis.__unpubSlug = unpub.body?.result?.publicPage?.slug;

    const pg = await run('docs', 'page-create', { title: 'Public Handbook' });
    const pageId = pg.body?.result?.page?.id;
    await run('docs', 'block-add', { pageId, type: 'paragraph', text: 'Hello readers' });
    const sh = await run('docs', 'share-set', { pageId, visibility: 'link', role: 'edit' });
    docToken = sh.body?.result?.share?.token || sh.body?.result?.token;
    assert.ok(docToken && docToken.startsWith('shr_'), JSON.stringify(sh.body));

    const pg2 = await run('docs', 'page-create', { title: 'Private Notes' });
    privatePageId = pg2.body?.result?.page?.id;
    await run('docs', 'share-set', { pageId: privatePageId, visibility: 'private' });

    const portal = await run('carpentry', 'portalCreate', { client: 'Pat', jobName: 'Back deck', progressPct: 30 });
    portalToken = portal.body?.result?.token;
    assert.ok(portalToken, JSON.stringify(portal.body));

    const gp = await run('nonprofit', 'donation-page-create', { title: 'Plant Trees', goal: 500 });
    const gpage = gp.body?.result?.page;
    giveSlug = gpage?.slug;
    await run('nonprofit', 'donation-page-update', { id: gpage?.id, published: true });
    const dp = await run('nonprofit', 'donation-page-create', { title: 'Draft Drive', goal: 100 });
    draftGiveSlug = dp.body?.result?.page?.slug;
  });

  after(async function () {
    await stopServer(serverProc);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('proof: anonymous GET returns the asset and comments', async function () {
    const r = await getJSON(base, '/api/public-share/proof/' + proofToken);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body?.ok, true);
    assert.equal(r.body.result.label, 'Client review');
  });

  it('proof: anonymous reviewer can comment, and it shows up', async function () {
    const c = await postJSON(base, '/api/public-share/proof/' + proofToken + '/comment', { body: 'Love it', authorName: 'Pat' });
    assert.equal(c.status, 200, JSON.stringify(c));
    const r = await getJSON(base, '/api/public-share/proof/' + proofToken);
    assert.ok(r.body.result.comments.some((x) => x.body === 'Love it' && x.authorName === 'Pat'), JSON.stringify(r.body));
  });

  it('proof: bad token 404s, empty comment is rejected', async function () {
    assert.equal((await getJSON(base, '/api/public-share/proof/pl_nope')).status, 404);
    const c = await postJSON(base, '/api/public-share/proof/' + proofToken + '/comment', { body: '   ' });
    assert.notEqual(c.status, 200, JSON.stringify(c));
  });

  it('event: published page resolves by slug without auth', async function () {
    const r = await getJSON(base, '/api/public-share/event/' + eventSlug);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.result.event.name, 'Launch Party');
  });

  it('event: unpublished page and unknown slug 404', async function () {
    assert.equal((await getJSON(base, '/api/public-share/event/' + globalThis.__unpubSlug)).status, 404);
    assert.equal((await getJSON(base, '/api/public-share/event/no-such-slug')).status, 404);
  });

  it('docs: link-shared page is readable anonymously and read-only', async function () {
    const r = await getJSON(base, '/api/public-share/docs/' + docToken);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.result.title, 'Public Handbook');
    assert.equal(r.body.result.readOnly, true);
    assert.ok(r.body.result.blocks.some((b) => b.text === 'Hello readers'));
  });

  it('docs: bad token 404s', async function () {
    assert.equal((await getJSON(base, '/api/public-share/docs/shr_nope')).status, 404);
  });

  it('experience: unknown token 404s', async function () {
    assert.equal((await getJSON(base, '/api/public-share/experience/share_nope')).status, 404);
  });

  it('carpentry: client portal is readable anonymously without the owner id', async function () {
    const r = await getJSON(base, '/api/public-share/carpentry/' + portalToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const share = r.body?.result?.share || r.body?.share;
    assert.equal(share.jobName, 'Back deck');
    assert.equal(share.ownerId, undefined);
    assert.equal((await getJSON(base, '/api/public-share/carpentry/portal_nope')).status, 404);
  });

  it('give: published campaign page is public, drafts 404', async function () {
    const r = await getJSON(base, '/api/public-share/give/' + giveSlug);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const page = r.body?.result?.page || r.body?.page;
    assert.equal(page.title, 'Plant Trees');
    assert.equal((await getJSON(base, '/api/public-share/give/' + draftGiveSlug)).status, 404);
  });

  it('unknown kind 404s and cannot smuggle an action', async function () {
    assert.notEqual((await getJSON(base, '/api/public-share/admin/x')).status, 200);
    const r = await getJSON(base, '/api/public-share/docs/' + docToken + '?action=share-set&domain=docs');
    assert.equal(r.body?.result?.readOnly, true);
  });

  it('sanity: a protected route in the same server still 401s unauthenticated', async function () {
    const { status } = await postJSON(base, '/api/dtus/fake-dtu-id/vote', { direction: 'up' });
    assert.equal(status, 401);
  });
});
