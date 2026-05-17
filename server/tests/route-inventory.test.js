// Contract test for server/lib/route-inventory.js
//
// Pins the parser against the real server source so /admin/endpoints
// keeps returning a sane inventory across refactors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouteInventory, clearRouteInventoryCache } from '../lib/route-inventory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(HERE, '..', 'server.js');
const ROUTES_DIR = path.join(HERE, '..', 'routes');

test('buildRouteInventory returns endpoints + counters from real source', () => {
  clearRouteInventoryCache();
  const inv = buildRouteInventory({ serverPath: SERVER_PATH, routesDir: ROUTES_DIR, force: true });
  assert.ok(Array.isArray(inv.endpoints), 'endpoints is an array');
  assert.ok(inv.endpoints.length > 1000, `expected > 1000 routes, got ${inv.endpoints.length}`);
  assert.equal(typeof inv.counters.total, 'number');
  assert.equal(inv.counters.public + inv.counters.required + inv.counters.gated, inv.counters.total);
});

test('classifies /api/lens-actions/:domain as public via publicReadPaths', () => {
  const inv = buildRouteInventory({ serverPath: SERVER_PATH, routesDir: ROUTES_DIR });
  const row = inv.endpoints.find(e => e.path === '/api/lens-actions/:domain' && e.method === 'GET');
  assert.ok(row, 'lens-actions GET route exists in inventory');
  assert.equal(row.auth, 'public');
});

test('classifies sovereign-gated routes as required', () => {
  const inv = buildRouteInventory({ serverPath: SERVER_PATH, routesDir: ROUTES_DIR });
  const reqRoutes = inv.endpoints.filter(e => e.auth === 'required');
  assert.ok(reqRoutes.length > 0, 'at least one required route detected');
});

test('endpoints carry file + line annotations', () => {
  const inv = buildRouteInventory({ serverPath: SERVER_PATH, routesDir: ROUTES_DIR });
  for (const e of inv.endpoints.slice(0, 50)) {
    assert.equal(typeof e.file, 'string');
    assert.equal(typeof e.line, 'number');
    assert.ok(e.line > 0);
  }
});

test('byMethod counter sums to total', () => {
  const inv = buildRouteInventory({ serverPath: SERVER_PATH, routesDir: ROUTES_DIR });
  const sum = Object.values(inv.counters.byMethod).reduce((a, b) => a + b, 0);
  assert.equal(sum, inv.counters.total);
});
