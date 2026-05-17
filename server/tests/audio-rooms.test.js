// Contract test for migration 200 + server/lib/audio-rooms.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as migrate200 } from '../migrations/200_audio_rooms.js';
import {
  createRoom, getRoom, listActiveRooms, joinAsListener, leaveRoom,
  raiseHand, promoteToSpeaker, endRoom, setRecording,
} from '../lib/audio-rooms.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate200(db);
  return db;
}

test('migration 200 creates 3 audio-room tables + indexes', () => {
  const db = freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  for (const expected of ['audio_rooms', 'audio_room_speakers', 'audio_room_listeners']) {
    assert.ok(tables.includes(expected), `expected ${expected}`);
  }
});

test('createRoom seeds the host as a speaker', () => {
  const db = freshDb();
  const r = createRoom(db, { roomId: 'r1', hostUserId: 'alice', title: 'Morning Standup' });
  assert.equal(r.ok, true);
  const speakers = db.prepare(`SELECT * FROM audio_room_speakers WHERE room_id = ?`).all('r1');
  assert.equal(speakers.length, 1);
  assert.equal(speakers[0].user_id, 'alice');
  assert.equal(speakers[0].role, 'host');
});

test('createRoom rejects missing fields', () => {
  const db = freshDb();
  const r = createRoom(db, { roomId: '', hostUserId: 'alice', title: 'x' });
  assert.equal(r.ok, false);
});

test('listActiveRooms excludes ended rooms', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'alice', title: 'Live now' });
  createRoom(db, { roomId: 'r2', hostUserId: 'bob',   title: 'Also live' });
  endRoom(db, { roomId: 'r1', byUserId: 'alice' });
  const list = listActiveRooms(db);
  assert.equal(list.rooms.length, 1);
  assert.equal(list.rooms[0].id, 'r2');
});

test('joinAsListener respects capacity and resurrects left listeners', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'h', title: 'Tiny', maxListeners: 1 });
  assert.equal(joinAsListener(db, { roomId: 'r1', userId: 'u1' }).ok, true);
  // Second user blocked
  assert.equal(joinAsListener(db, { roomId: 'r1', userId: 'u2' }).ok, false);
  // u1 leaves
  leaveRoom(db, { roomId: 'r1', userId: 'u1' });
  // u2 can now join
  assert.equal(joinAsListener(db, { roomId: 'r1', userId: 'u2' }).ok, true);
});

test('raiseHand only works for listeners currently in the room', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'h', title: 't' });
  joinAsListener(db, { roomId: 'r1', userId: 'u1' });
  assert.equal(raiseHand(db, { roomId: 'r1', userId: 'u1' }).ok, true);
  assert.equal(raiseHand(db, { roomId: 'r1', userId: 'ghost' }).ok, false);
});

test('promoteToSpeaker only allowed for host or co-host', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'host', title: 't' });
  joinAsListener(db, { roomId: 'r1', userId: 'u1' });
  // Random user can't promote
  assert.equal(promoteToSpeaker(db, { roomId: 'r1', userId: 'u1', byHostUserId: 'rando' }).ok, false);
  // Host can
  assert.equal(promoteToSpeaker(db, { roomId: 'r1', userId: 'u1', byHostUserId: 'host' }).ok, true);
  // u1 is now a speaker, not a listener
  const speakers = db.prepare(`SELECT * FROM audio_room_speakers WHERE room_id = ?`).all('r1');
  assert.equal(speakers.length, 2);
  const activeListeners = db.prepare(`SELECT * FROM audio_room_listeners WHERE room_id = ? AND left_at IS NULL`).all('r1');
  assert.equal(activeListeners.length, 0);
});

test('endRoom is host-only and idempotent', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'host', title: 't' });
  assert.equal(endRoom(db, { roomId: 'r1', byUserId: 'rando' }).ok, false);
  assert.equal(endRoom(db, { roomId: 'r1', byUserId: 'host' }).ok, true);
  const again = endRoom(db, { roomId: 'r1', byUserId: 'host' });
  assert.equal(again.alreadyEnded, true);
});

test('setRecording is host-only + opt-in', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'host', title: 't' });
  // No fake auto-recording
  let r = getRoom(db, 'r1');
  assert.equal(r.room.isRecording, false);
  // Random user can't enable
  assert.equal(setRecording(db, { roomId: 'r1', byUserId: 'rando', isRecording: true }).ok, false);
  // Host can
  assert.equal(setRecording(db, { roomId: 'r1', byUserId: 'host', isRecording: true, recordingUrl: 'https://artifacts/r1.webm' }).ok, true);
  r = getRoom(db, 'r1');
  assert.equal(r.room.isRecording, true);
  assert.equal(r.room.recordingUrl, 'https://artifacts/r1.webm');
});

test('listener count from getRoom matches reality', () => {
  const db = freshDb();
  createRoom(db, { roomId: 'r1', hostUserId: 'h', title: 't' });
  joinAsListener(db, { roomId: 'r1', userId: 'u1' });
  joinAsListener(db, { roomId: 'r1', userId: 'u2' });
  joinAsListener(db, { roomId: 'r1', userId: 'u3' });
  leaveRoom(db, { roomId: 'r1', userId: 'u2' });
  const r = getRoom(db, 'r1');
  assert.equal(r.room.listenerCount, 2);
});
