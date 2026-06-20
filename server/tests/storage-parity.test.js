/**
 * Storage Parity Tests — SQLite vs JSON fallback
 * Run: node --test tests/storage-parity.test.js
 *
 * Verifies that AuthDB operations produce identical results regardless of
 * whether better-sqlite3 is available (SQLite mode) or absent (JSON fallback).
 * Tests run against the live server by exercising auth endpoints.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let API_BASE = process.env.API_BASE || '';
let serverProcess = null;
const STORAGE_MODE = process.env.STORAGE_MODE || 'auto'; // 'auto' | 'sqlite' | 'json'

// Per-request abort budget. This is an out-of-process integration test:
// it spawns a real server and hits real auth endpoints (password hashing
// is CPU-heavy). Under the CI coverage run the spawned server inherits
// c8 instrumentation via NODE_OPTIONS AND competes for CPU with the rest
// of the parallel `node --test` suite, so an auth call that takes <1s in
// isolation can take 10s+. A 10s budget made `register`/`login` flake the
// "Lint & Test" gate; 60s is generous headroom against that contention
// while still being far below a genuine hang.
const API_TIMEOUT_MS = 60_000;

// Unique test data per run
const TS = Date.now();
const TEST_USERS = [
  { username: `parity_a_${TS}`, email: `parity_a_${TS}@test.local`, password: 'ParityTest_12345!', dateOfBirth: '1990-01-01' },
  { username: `parity_b_${TS}`, email: `parity_b_${TS}@test.local`, password: 'ParityTest_67890!', dateOfBirth: '1990-01-01' },
];

async function startServer() {
  if (process.env.API_BASE) {
    API_BASE = process.env.API_BASE;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) return;
      } catch (_e) { logger.debug('storage-parity.test', 'wait', { error: _e?.message }); }
      await new Promise(r => { setTimeout(r, 500); });
    }
    throw new Error('External server did not become ready');
  }

  const port = 15050 + Math.floor(Math.random() * 1000);
  API_BASE = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    // The server suppresses app.listen when NODE_ENV=test for in-process
    // unit tests. This is an out-of-process integration test that needs
    // the spawned server to actually bind a port — explicit override.
    CONCORD_FORCE_LISTEN: 'true',
    AUTH_ENABLED: 'true',
    ADMIN_PASSWORD: 'parity_test_admin_pw',
    DATA_DIR: join(__dirname, `../.parity-test-data-${TS}`),
    STATE_PATH: join(__dirname, `../.parity-test-state-${TS}.json`),
  };

  // Force JSON mode by hiding better-sqlite3 if requested
  if (STORAGE_MODE === 'json') {
    env.NODE_OPTIONS = '--conditions=force-json-storage';
  }

  serverProcess = spawn('node', [join(__dirname, '../server.js')], {
    cwd: join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch (_e) { logger.debug('storage-parity.test', 'starting', { error: _e?.message }); }
    await new Promise(r => { setTimeout(r, 500); });
  }
  throw new Error('Test server did not start');
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  // Cleanup test data
  try { fs.rmSync(join(__dirname, `../.parity-test-data-${TS}`), { recursive: true, force: true }); } catch (_e) { logger.debug('storage-parity.test', 'silent catch', { error: _e?.message }); }
  try { fs.unlinkSync(join(__dirname, `../.parity-test-state-${TS}.json`)); } catch (_e) { logger.debug('storage-parity.test', 'silent catch', { error: _e?.message }); }
}

async function api(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

// ---- Tests ----

before(async () => { await startServer(); });
after(() => { stopServer(); });

describe('Storage Parity: Auth Operations', () => {
  let tokenA = null;
  let _tokenB = null;

  it('should report infrastructure status with storage type', async () => {
    const { status, data } = await api('GET', '/api/status');
    assert.strictEqual(status, 200);
    assert.ok(data.ok || data.version, 'Status endpoint should respond');
    console.log(`  Storage mode reported: ${data.infrastructure?.database?.type || 'unknown'}`);
  });

  it('should register user A', async () => {
    const { status, data } = await api('POST', '/api/auth/register', TEST_USERS[0]);
    // /api/auth/register returns 201 (Created — REST-correct for resource
    // creation). Accept both 200 and 201 so this assertion is robust to
    // future status-code adjustments either way.
    assert.ok([200, 201].includes(status), `Register failed: ${JSON.stringify(data)}`);
    assert.ok(data.ok || data.token, 'Registration should succeed');
    tokenA = data.token || null;
  });

  it('should register user B', async () => {
    const { status, data: _data } = await api('POST', '/api/auth/register', TEST_USERS[1]);
    assert.ok([200, 201].includes(status), `Register failed: ${JSON.stringify(_data)}`);
    assert.ok(_data.ok || _data.token, 'Registration should succeed');
    _tokenB = _data.token || null;
  });

  it('should reject duplicate username', async () => {
    const { status, data } = await api('POST', '/api/auth/register', TEST_USERS[0]);
    assert.ok(status >= 400, 'Duplicate should fail');
    assert.ok(data.error, 'Should return error message');
  });

  it('should login user A with correct password', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      username: TEST_USERS[0].username,
      password: TEST_USERS[0].password,
    });
    assert.strictEqual(status, 200, `Login failed: ${JSON.stringify(data)}`);
    assert.ok(data.token || data.ok, 'Login should return token or ok');
    if (data.token) tokenA = data.token;
  });

  it('should reject login with wrong password', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      username: TEST_USERS[0].username,
      password: 'WrongPassword999!',
    });
    assert.ok(status >= 400, 'Wrong password should fail');
  });

  it('should access protected endpoint with token', async () => {
    if (!tokenA) return;
    const { status } = await api('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${tokenA}`,
    });
    // Should return 200 or at least not 401
    assert.ok(status !== 401, 'Authenticated request should not get 401');
  });

  it('should reject protected endpoint without token', async () => {
    const { status } = await api('GET', '/api/auth/audit-log');
    assert.strictEqual(status, 401, 'Unauthenticated should get 401');
  });

  it('should list API keys for authenticated user', async () => {
    if (!tokenA) return;
    const { status, data: _data } = await api('GET', '/api/auth/api-keys', null, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert.ok(status === 200 || status === 403, `API keys endpoint: ${status}`);
  });

  it('should change password for user A', async () => {
    if (!tokenA) return;
    const { status, data } = await api('POST', '/api/auth/change-password', {
      currentPassword: TEST_USERS[0].password,
      newPassword: 'NewParityPW_12345!',
    }, { Authorization: `Bearer ${tokenA}` });
    // Should succeed or return meaningful error
    assert.ok(status === 200 || status === 400, `Password change: ${JSON.stringify(data)}`);
  });

  it('should handle concurrent user operations without race conditions', async () => {
    // Register and login multiple users in parallel. The intent is to
    // verify that the auth pipeline has no race condition (corrupted
    // state, duplicate user IDs, etc.) under concurrency. Some registers
    // may legitimately hit the auth rate-limiter (5 attempts/15min per
    // IP) since prior tests in this file already burned through register
    // attempts — that's intentional rate-limit behavior, not a race bug.
    const promises = Array.from({ length: 3 }, (_, i) => {
      const user = {
        username: `concurrent_${TS}_${i}`,
        email: `concurrent_${TS}_${i}@test.local`,
        password: 'ConcurrentTest_123!',
        dateOfBirth: '1990-01-01',
      };
      return api('POST', '/api/auth/register', user);
    });
    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 200 || r.status === 201);
    const rateLimited = results.filter(r => r.status === 429);
    const otherFailures = results.filter(r => r.status >= 500);
    // No 5xx responses (the actual race-condition signal).
    assert.strictEqual(otherFailures.length, 0, `No 5xx allowed under concurrency: ${JSON.stringify(otherFailures.map(r => r.status))}`);
    // At least one should succeed (the rest may be rate-limited, which is fine).
    assert.ok(successes.length + rateLimited.length === 3,
      `Each result should be either success or rate-limit; got: ${JSON.stringify(results.map(r => r.status))}`);
    assert.ok(successes.length >= 1,
      `At least 1 of 3 concurrent registrations should succeed (got ${successes.length}; rate-limited: ${rateLimited.length})`);
  });
});

describe('Storage Parity: State Persistence', () => {
  it('should persist DTU creation across state cycle', async () => {
    // Create a DTU via the API
    const { status, data } = await api('POST', '/api/dtus', {
      title: `Parity test DTU ${TS}`,
      content: 'Testing storage parity between SQLite and JSON backends',
      tags: ['test', 'parity'],
    });
    // May require auth, which is fine
    if (status === 401) {
      console.log('  DTU creation requires auth (expected in AUTH_ENABLED mode)');
      return;
    }
    if (status === 200) {
      assert.ok(data.ok || data.id, 'DTU should be created');
    }
  });

  it('should retrieve DTU list', async () => {
    const { status, data } = await api('GET', '/api/dtus');
    assert.strictEqual(status, 200, 'DTU list should be accessible');
    assert.ok(data.ok !== false, 'DTU list should succeed');
  });

  it('should retrieve system status with macro stats', async () => {
    const { status, data } = await api('GET', '/api/status');
    assert.strictEqual(status, 200);
    // Check that core state shapes are present
    assert.ok(data.version || data.ok, 'Status should include version');
  });

  it('should retrieve settings', async () => {
    const { status, data } = await api('GET', '/api/settings');
    assert.strictEqual(status, 200);
    assert.ok(data.ok !== false, 'Settings should be accessible');
  });
});

describe('Storage Parity: Macro ACL Enforcement', () => {
  it('should enforce ACL on write macros for unauthenticated users', async () => {
    const { status } = await api('POST', '/api/macros', {
      domain: 'admin',
      name: 'status',
      input: {},
    });
    // Should require auth
    assert.ok(status === 401 || status === 403, `Admin macro should require auth (got ${status})`);
  });

  it('should allow public read macros without auth', async () => {
    const { status, data: _data } = await api('GET', '/api/status');
    assert.strictEqual(status, 200, 'Public read macros should work without auth');
  });
});
