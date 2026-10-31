/**
 * Bench lifecycle (D2): PATCH /api/crafting/recipes/:id renames one of the
 * caller's own pieces (row title and spec name move together); DELETE
 * removes it. Both are owner-scoped — another user's piece is a 404 and
 * stays untouched — and an empty rename is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createCraftingRouter } from '../routes/crafting.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function seed(db, id, creator, title) {
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title, data, skill_level) VALUES (?, ?, 'recipe', ?, ?, 0)`)
    .run(id, creator, title, JSON.stringify({ spec: { name: title, output_type: 'piece', output_subtype: 'piece' } }));
}

async function setup(userId) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      type TEXT,
      title TEXT,
      data TEXT,
      skill_level REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      native_world_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0
    );
  `);
  seed(db, 'r-mine', 'ramaj', 'Bench hook');
  seed(db, 'r-theirs', 'someone-else', 'Not mine');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/crafting', createCraftingRouter({
    db,
    requireAuth: (_req, _res, next) => next(),
  }));
  const server = await listen(app);
  return { db, port: server.address().port, close: () => server.close() };
}

function call(port, method, path, body) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('PATCH renames my piece: title and spec name move together', async () => {
  const { db, port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'PATCH', '/api/crafting/recipes/r-mine', { title: 'Bench hook II' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const row = db.prepare(`SELECT title, data FROM dtus WHERE id = 'r-mine'`).get();
    assert.equal(row.title, 'Bench hook II');
    assert.equal(JSON.parse(row.data).spec.name, 'Bench hook II');

    const list = await (await call(port, 'GET', '/api/crafting/recipes')).json();
    assert.equal(list.recipes.find((r) => r.id === 'r-mine').title, 'Bench hook II');
  } finally { close(); }
});

test('PATCH refuses an empty name and leaves the piece alone', async () => {
  const { db, port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'PATCH', '/api/crafting/recipes/r-mine', { title: '   ' });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).ok, false);
    assert.equal(db.prepare(`SELECT title FROM dtus WHERE id = 'r-mine'`).get().title, 'Bench hook');
  } finally { close(); }
});

test("PATCH on another user's piece is a 404 and changes nothing", async () => {
  const { db, port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'PATCH', '/api/crafting/recipes/r-theirs', { title: 'Stolen' });
    assert.equal(res.status, 404);
    assert.equal(db.prepare(`SELECT title FROM dtus WHERE id = 'r-theirs'`).get().title, 'Not mine');
  } finally { close(); }
});

test('DELETE removes my piece from the bench', async () => {
  const { port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'DELETE', '/api/crafting/recipes/r-mine');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    const list = await (await call(port, 'GET', '/api/crafting/recipes')).json();
    assert.equal(list.recipes.some((r) => r.id === 'r-mine'), false);
  } finally { close(); }
});

test("DELETE on another user's piece is a 404 and it stays", async () => {
  const { db, port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'DELETE', '/api/crafting/recipes/r-theirs');
    assert.equal(res.status, 404);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE id = 'r-theirs'`).get().n, 1);
  } finally { close(); }
});

test('DELETE on a missing piece is a 404', async () => {
  const { port, close } = await setup('ramaj');
  try {
    const res = await call(port, 'DELETE', '/api/crafting/recipes/r-nope');
    assert.equal(res.status, 404);
  } finally { close(); }
});
