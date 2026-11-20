/**
 * E2E HTTP — the Darkroom's file routes on a real spawned server.
 *   POST /api/photos/upload            the file's own bytes in, a catalogued photo out
 *   GET  /api/photos/:id/preview|thumb private to the owner unless the photo is public
 *   GET  /api/photos/:id/original      owner only, byte-for-byte what was imported
 *   GET  /api/photos/:id/export        the saved edit rendered at the asked size
 *   GET  /api/photos/releases[/:id]    public JSON for published releases
 *   GET  /api/photos/releases/:id/proof     anyone, for a published release
 *   GET  /api/photos/releases/:id/download  the photographer, a buyer, or anyone if free (else 402)
 * AUTH_MODE=hybrid, so auth is genuinely enforced; signed-out calls carry no
 * Authorization header and no cookie.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armOrphanGuard } from '../lib/e2e-orphan-guard.js';

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


async function getRaw(base, path, headers) {
  const res = await apiFetch(base, path, { headers: headers || {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers };
}

async function photoFile() {
  const w = 900, h = 600, raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) { raw[i] = (i / 3) % 255; raw[i + 1] = 120; raw[i + 2] = 60; }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: 'Leica', Model: 'Q3' }, IFD2: { ISOSpeedRatings: '200', DateTimeOriginal: '2026:08:01 09:30:00' } }).toBuffer();
}

describe('E2E — the Darkroom file routes', { timeout: 240000 }, function () {
  let base, serverProc, dataDir, ada, ben, photoId, file;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-darkroom-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'hybrid', CONCORD_PHOTO_DIR: join(dataDir, 'photos') }, 120000);
    ada = await registerUser(base, 'darkAda');
    ben = await registerUser(base, 'darkBen');
    file = await photoFile();
    const res = await apiFetch(base, '/api/photos/upload?name=' + encodeURIComponent('L1000412.JPG'), { method: 'POST', headers: Object.assign({ 'Content-Type': 'image/jpeg' }, ada), body: file });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    photoId = body.photo.id;
    assert.deepEqual([body.photo.width, body.photo.height, body.photo.camera, body.photo.caption], [900, 600, 'Leica Q3', 'L1000412']);
  });

  after(async function () {
    await stopServer(serverProc);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses an upload that is not a photo, or from nobody', async function () {
    const bad = await apiFetch(base, '/api/photos/upload', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, ada), body: Buffer.from('definitely not an image, just words') });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /isn't a photo/);
    const anon = await apiFetch(base, '/api/photos/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: file });
    assert.ok([401, 403].includes(anon.status), 'status ' + anon.status);
  });

  it('serves previews to the owner only while the photo is private', async function () {
    const mine = await getRaw(base, '/api/photos/' + photoId + '/preview', ada);
    assert.equal(mine.status, 200);
    assert.equal((await sharp(mine.buf).metadata()).width, 900);
    const thumb = await getRaw(base, '/api/photos/' + photoId + '/thumb', ada);
    assert.equal((await sharp(thumb.buf).metadata()).width, 480);
    assert.equal((await getRaw(base, '/api/photos/' + photoId + '/preview', ben)).status, 404);
    assert.notEqual((await getRaw(base, '/api/photos/' + photoId + '/preview')).status, 200);
  });

  it('gives the owner the original byte for byte, and nobody else', async function () {
    const o = await getRaw(base, '/api/photos/' + photoId + '/original', ada);
    assert.equal(o.status, 200);
    assert.ok(o.buf.equals(file));
    assert.equal((await getRaw(base, '/api/photos/' + photoId + '/original', ben)).status, 404);
  });

  it('exports the saved edit at the size asked', async function () {
    const saved = await postJSON(base, '/api/lens/run', { domain: 'photos', action: 'edit-save', input: { id: photoId, edit: { basic: { exposure: 0.5 }, geometry: { crop: { x: 0, y: 0, w: 0.5, h: 1 } } }, label: 'Crop' } }, ada);
    assert.equal(saved.body?.ok, true, JSON.stringify(saved.body));
    const ex = await getRaw(base, '/api/photos/' + photoId + '/export?format=webp&longEdge=300&exif=1', ada);
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-disposition') || '', /attachment; filename="L1000412\.webp"/);
    const m = await sharp(ex.buf).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['webp', 225, 300]);
    assert.equal((await getRaw(base, '/api/photos/' + photoId + '/export', ben)).status, 404);
  });

  it('a priced release: everyone sees a proof, the download costs CC', async function () {
    const rel = await postJSON(base, '/api/lens/run', { domain: 'photos', action: 'release-create', input: { photoId, title: 'Harbour at nine', priceCC: 4 } }, ada);
    assert.equal(rel.body?.ok, true, JSON.stringify(rel.body));
    const id = rel.body.result.release.id;
    const pub = await getJSON(base, '/api/photos/releases');
    assert.ok(pub.body.releases.some((r) => r.id === id && r.photoId === undefined));
    assert.equal((await getJSON(base, '/api/photos/releases/' + id)).body.release.canDownload, false);
    const proof = await getRaw(base, '/api/photos/releases/' + id + '/proof');
    assert.equal(proof.status, 200);
    assert.ok(Math.max((await sharp(proof.buf).metadata()).width, (await sharp(proof.buf).metadata()).height) <= 1200);
    const dl = await getRaw(base, '/api/photos/releases/' + id + '/download');
    assert.equal(dl.status, 402);
    assert.match(JSON.parse(dl.buf.toString()).error, /buy this photo \(4 CC\)/);
    assert.equal((await getRaw(base, '/api/photos/releases/' + id + '/download', ben)).status, 402);
    const own = await getRaw(base, '/api/photos/releases/' + id + '/download', ada);
    assert.equal(own.status, 200);
    assert.deepEqual([(await sharp(own.buf).metadata()).width, (await sharp(own.buf).metadata()).height], [450, 600]);
    // still private: the release is the only public face of the photo
    assert.notEqual((await getRaw(base, '/api/photos/' + photoId + '/preview')).status, 200);
  });

  it('a free release downloads for anyone, signed in or not', async function () {
    const up = await apiFetch(base, '/api/photos/upload?name=gift.jpg', { method: 'POST', headers: Object.assign({ 'Content-Type': 'image/jpeg' }, ada), body: file });
    const pid = (await up.json()).photo.id;
    const rel = await postJSON(base, '/api/lens/run', { domain: 'photos', action: 'release-create', input: { photoId: pid, title: 'Gift', priceCC: 0, longEdge: 640 } }, ada);
    assert.equal(rel.body?.ok, true, JSON.stringify(rel.body));
    const dl = await getRaw(base, '/api/photos/releases/' + rel.body.result.release.id + '/download');
    assert.equal(dl.status, 200);
    assert.equal((await sharp(dl.buf).metadata()).width, 640);
    assert.equal((await getRaw(base, '/api/photos/releases/prel_doesnotexist/proof')).status, 404);
  });
});
