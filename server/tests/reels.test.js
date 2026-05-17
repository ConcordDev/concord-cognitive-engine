// Contract test for migration 199 + migration 201 (audio-only reels)
// + server/lib/reels.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as migrate199 } from '../migrations/199_reels.js';
import { up as migrate201 } from '../migrations/201_reels_audio_columns.js';
import { createReel, getReel, recordView, getReelsForUser, getReelsByUser } from '../lib/reels.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate199(db);
  // Phase 13 (Stage B) — applies the audio_url + audio_duration_s
  // schema relaxation. createReel writes those columns.
  migrate201(db);
  return db;
}

test('migration 199 creates reels + reel_views with indexes', () => {
  const db = freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  assert.ok(tables.includes('reels'));
  assert.ok(tables.includes('reel_views'));
});

test('createReel inserts a row and getReel returns it', () => {
  const db = freshDb();
  const r = createReel(db, {
    reelId: 'reel:1', postId: 'post:1', userId: 'u1',
    videoUrl: 'https://x/v.mp4', durationSeconds: 30, width: 720, height: 1280,
    caption: 'hello', musicAttribution: 'me',
  });
  assert.equal(r.ok, true);
  const g = getReel(db, 'reel:1');
  assert.equal(g.ok, true);
  assert.equal(g.reel.userId, 'u1');
  assert.equal(g.reel.durationSeconds, 30);
  assert.equal(g.reel.viewCount, 0);
  assert.equal(g.reel.completionRate, 0);
});

test('createReel rejects bad duration', () => {
  const db = freshDb();
  const r = createReel(db, { reelId: 'r', postId: 'p', userId: 'u', videoUrl: 'x', durationSeconds: 120 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duration_out_of_range');
});

test('createReel rejects missing fields', () => {
  const db = freshDb();
  const r = createReel(db, { reelId: '', postId: 'p', userId: 'u', videoUrl: 'x', durationSeconds: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_field');
});

test('recordView increments view_count + completion_count above threshold', () => {
  const db = freshDb();
  createReel(db, { reelId: 'r1', postId: 'p1', userId: 'u1', videoUrl: 'x', durationSeconds: 10 });
  recordView(db, { reelId: 'r1', viewerUserId: 'viewer-a', watchedSeconds: 3 });
  recordView(db, { reelId: 'r1', viewerUserId: 'viewer-b', watchedSeconds: 9 });
  const reel = getReel(db, 'r1').reel;
  assert.equal(reel.viewCount, 2);
  assert.equal(reel.completionCount, 1, 'viewer-b crossed 80% threshold');
});

test('recordView with missing reel returns not_found', () => {
  const db = freshDb();
  const r = recordView(db, { reelId: 'ghost', watchedSeconds: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
});

test('getReelsForUser returns reverse-chrono on cold start (no engagement signal)', () => {
  const db = freshDb();
  createReel(db, { reelId: 'r1', postId: 'p1', userId: 'u1', videoUrl: 'x', durationSeconds: 10 });
  // Backdate r1 so r2 ranks higher by recency alone.
  db.prepare(`UPDATE reels SET created_at = unixepoch() - 86400 WHERE id = 'r1'`).run();
  createReel(db, { reelId: 'r2', postId: 'p2', userId: 'u1', videoUrl: 'x', durationSeconds: 10 });
  const f = getReelsForUser(db);
  assert.equal(f.ok, true);
  assert.equal(f.results[0].id, 'r2', 'newest first on cold start');
});

test('getReelsForUser excludes reels the viewer has already completed', () => {
  const db = freshDb();
  createReel(db, { reelId: 'r1', postId: 'p1', userId: 'u1', videoUrl: 'x', durationSeconds: 10 });
  createReel(db, { reelId: 'r2', postId: 'p2', userId: 'u1', videoUrl: 'x', durationSeconds: 10 });
  recordView(db, { reelId: 'r1', viewerUserId: 'me', watchedSeconds: 10 });
  const f = getReelsForUser(db, { viewerUserId: 'me' });
  const ids = f.results.map(r => r.id);
  assert.ok(!ids.includes('r1'), 'completed reel filtered out');
  assert.ok(ids.includes('r2'), 'unwatched reel included');
});

test('getReelsByUser scopes by author', () => {
  const db = freshDb();
  createReel(db, { reelId: 'r1', postId: 'p1', userId: 'alice', videoUrl: 'x', durationSeconds: 5 });
  createReel(db, { reelId: 'r2', postId: 'p2', userId: 'bob',   videoUrl: 'x', durationSeconds: 5 });
  const out = getReelsByUser(db, { userId: 'alice' });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].id, 'r1');
});
