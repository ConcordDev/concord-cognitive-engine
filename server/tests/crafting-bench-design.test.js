/**
 * The bench round-trip: POST /api/crafting/design inserts a recipe DTU,
 * GET /api/crafting/recipes returns that same id and title.
 * A sword spec still fails validation when the player has no crafting level.
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

test('design then GET /recipes returns the same piece; a sword is rejected', async () => {
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

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'ramaj' };
    next();
  });
  app.use('/api/crafting', createCraftingRouter({
    db,
    requireAuth: (_req, _res, next) => next(),
  }));

  const server = await listen(app);
  const port = server.address().port;
  try {
    const sword = await fetch(`http://127.0.0.1:${port}/api/crafting/design`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Iron Sword',
        spec: { name: 'Iron Sword', output_type: 'sword', output_subtype: 'sword' },
      }),
    });
    assert.equal(sword.status, 422);
    const swordBody = await sword.json();
    assert.equal(swordBody.ok, false);
    assert.ok(Array.isArray(swordBody.errors) && swordBody.errors.length > 0);

    const post = await fetch(`http://127.0.0.1:${port}/api/crafting/design`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bench hook',
        spec: { name: 'Bench hook', output_type: 'piece', output_subtype: 'piece' },
      }),
    });
    assert.equal(post.status, 200);
    const created = await post.json();
    assert.equal(created.ok, true);
    const id = created.recipe.id;
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);

    const get = await fetch(`http://127.0.0.1:${port}/api/crafting/recipes`);
    assert.equal(get.status, 200);
    const listed = await get.json();
    assert.equal(listed.ok, true);
    assert.equal(listed.recipes.length, 1);
    assert.equal(listed.recipes[0].id, id);
    assert.equal(listed.recipes[0].title, 'Bench hook');
    assert.equal(listed.recipes[0].type, 'recipe');
    assert.equal(listed.recipes[0].data.spec.output_subtype, 'piece');

    const row = db.prepare("SELECT creator_id, type FROM dtus WHERE id = ?").get(id);
    assert.equal(row.creator_id, 'ramaj');
    assert.equal(row.type, 'recipe');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
