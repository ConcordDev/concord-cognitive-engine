/**
 * Concord Macro Test Infrastructure
 * Run: node tests/macro-tests.js
 */

import assert from 'assert';

const API_BASE = process.env.API_BASE || 'http://localhost:5050';

// Test utilities
const test = (name, fn) => tests.push({ name, fn });
const tests = [];
let passed = 0;
let failed = 0;

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

// ============= DTU Tests =============

test('DTU: Create basic DTU', async () => {
  const res = await api('POST', '/api/forge/manual', {
    title: 'Test DTU',
    tags: ['test', 'automated'],
    core: {
      definitions: ['A test DTU for automated testing'],
      invariants: ['Must be deletable']
    }
  });
  assert(res.ok, 'Should create DTU');
  assert(res.dtu?.id, 'Should have DTU ID');
  return res.dtu.id;
});

test('DTU: Search DTUs', async () => {
  const res = await api('GET', '/api/search/indexed?q=test&limit=5');
  assert(res.ok, 'Search should succeed');
  assert(Array.isArray(res.results), 'Should return array');
});

test('DTU: Query DSL', async () => {
  const res = await api('GET', '/api/search/dsl?q=tier:regular&limit=10');
  assert(res.ok, 'Query DSL should succeed');
  assert(Array.isArray(res.dtus), 'Should return DTUs array');
});

test('DTU: Pagination', async () => {
  const res = await api('GET', '/api/dtus/paginated?page=1&pageSize=10');
  assert(res.ok, 'Pagination should succeed');
  assert(res.pagination, 'Should have pagination info');
  assert(res.pagination.page === 1, 'Should be page 1');
});

// ============= Export/Import Tests =============

test('Export: Markdown export', async () => {
  const res = await api('POST', '/api/export/markdown', { limit: 5 });
  assert(res.ok, 'Export should succeed');
  assert(res.format === 'markdown', 'Should be markdown format');
  assert(typeof res.content === 'string', 'Should have content');
});

test('Export: JSON export', async () => {
  const res = await api('POST', '/api/export/json', { limit: 5 });
  assert(res.ok, 'Export should succeed');
  assert(res.format === 'json', 'Should be JSON format');
  assert(Array.isArray(res.dtus), 'Should have DTUs array');
});

test('Export: Obsidian export', async () => {
  const res = await api('POST', '/api/export/obsidian', { limit: 3 });
  assert(res.ok, 'Export should succeed');
  assert(res.format === 'obsidian', 'Should be Obsidian format');
  assert(Array.isArray(res.files), 'Should have files array');
});

// ============= Persona Tests =============

test('Persona: List personas', async () => {
  const res = await api('GET', '/api/personas');
  assert(res.ok, 'Should list personas');
  assert(Array.isArray(res.personas), 'Should return array');
  assert(res.builtInCount >= 4, 'Should have built-in personas');
});

test('Persona: Create custom persona', async () => {
  const res = await api('POST', '/api/personas', {
    name: 'Test Persona',
    description: 'A test persona for automated testing',
    style: { verbosity: 0.7, formality: 0.3 },
    traits: ['analytical', 'concise']
  });
  assert(res.ok, 'Should create persona');
  assert(res.persona?.id, 'Should have persona ID');
});

// ============= Plugin Tests =============

test('Plugin: List plugins', async () => {
  const res = await api('GET', '/api/plugins');
  assert(res.ok, 'Should list plugins');
  assert(Array.isArray(res.plugins), 'Should return array');
});

test('Plugin: Register plugin', async () => {
  const res = await api('POST', '/api/plugins', {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'Test plugin for automated testing'
  });
  assert(res.ok, 'Should register plugin');
  assert(res.plugin?.name === 'test-plugin', 'Should have correct name');
});

// ============= Council Tests =============

test('Council: Submit vote', async () => {
  // First get a DTU to vote on
  const dtus = await api('GET', '/api/dtus/paginated?pageSize=1');
  if (!dtus.items?.length) return 'Skip: No DTUs';

  const dtuId = dtus.items[0].id;
  const res = await api('POST', '/api/council/vote', {
    dtuId,
    vote: 'approve',
    persona: 'test',
    reason: 'Automated test vote'
  });
  assert(res.ok, 'Should submit vote');
  assert(res.vote?.id, 'Should have vote ID');
});

test('Council: Get tally', async () => {
  const dtus = await api('GET', '/api/dtus/paginated?pageSize=1');
  if (!dtus.items?.length) return 'Skip: No DTUs';

  const dtuId = dtus.items[0].id;
  const res = await api('GET', `/api/council/tally/${dtuId}`);
  assert(res.ok, 'Should get tally');
  assert(res.tally, 'Should have tally object');
});

// ============= Admin Tests =============

test('Admin: Dashboard', async () => {
  const res = await api('GET', '/api/admin/dashboard');
  assert(res.ok, 'Should get dashboard');
  assert(res.system?.version, 'Should have version');
  assert(res.dtus?.total !== undefined, 'Should have DTU count');
});

test('Admin: Metrics', async () => {
  const res = await api('GET', '/api/admin/metrics');
  assert(res.ok, 'Should get metrics');
  assert(res.chicken2, 'Should have chicken2 metrics');
  assert(res.growth, 'Should have growth metrics');
});

test('Admin: Logs', async () => {
  const res = await api('GET', '/api/admin/logs?limit=10');
  assert(res.ok, 'Should get logs');
  assert(Array.isArray(res.logs), 'Should return logs array');
});

// ============= Search Tests =============

test('Search: Reindex', async () => {
  const res = await api('POST', '/api/search/reindex');
  assert(res.ok, 'Should reindex');
  assert(res.documents !== undefined, 'Should report document count');
  assert(res.terms !== undefined, 'Should report term count');
});

// ============= API Documentation =============

test('API: OpenAPI spec', async () => {
  const res = await api('GET', '/api/openapi.json');
  assert(res.openapi, 'Should have openapi version');
  assert(res.info?.title, 'Should have API title');
  assert(res.paths, 'Should have paths');
});

// ============= Test Runner =============

async function runTests() {
  console.log('\\n🧪 Concord Macro Test Suite\\n');
  console.log(`Testing against: ${API_BASE}\\n`);
  console.log('─'.repeat(50));

  for (const { name, fn } of tests) {
    try {
      const result = await fn();
      if (result && result.startsWith('Skip:')) {
        console.log(`⏭️  ${name}: ${result}`);
      } else {
        passed++;
        console.log(`✅ ${name}`);
      }
    } catch (err) {
      failed++;
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
    }
  }

  console.log('─'.repeat(50));
  console.log(`\\n📊 Results: ${passed} passed, ${failed} failed\\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// Check if server is running AND the macro endpoints accept anonymous requests.
// Production servers require auth (cookie or x-api-key); when run from
// `npm test` against a real server, those endpoints 401 and every assertion
// fails. Skip gracefully so the file doesn't pollute the suite — set
// CONCORD_MACRO_TESTS=1 to force-run them locally.
async function preflight() {
  try {
    const statusRes = await fetch(`${API_BASE}/api/status`);
    if (!statusRes.ok) throw new Error(`status http ${statusRes.status}`);
    // Probe one of the tested macros anonymously. If it 401s, skip the suite.
    if (process.env.CONCORD_MACRO_TESTS !== '1') {
      const probe = await fetch(`${API_BASE}/api/forge/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '_probe' }),
      });
      if (probe.status === 401 || probe.status === 403) {
        console.log(`\\n⏭️  Skipping macro tests: ${API_BASE} requires auth (got HTTP ${probe.status}).`);
        console.log('Set CONCORD_MACRO_TESTS=1 to force-run, or run against an authless dev server.\\n');
        process.exit(0);
      }
    }
    await runTests();
  } catch (err) {
    console.log(`\\n⏭️  Skipping macro tests: server not running at ${API_BASE}`);
    console.log('Start the Concord server to run integration tests.\\n');
    process.exit(0);
  }
}

preflight();
