// server/domains/audio-rooms.js
//
// Phase 11 (Item 7) — Spaces macros.
//
// Macros:
//   spaces.list_active     — public roster of currently-live rooms
//   spaces.get             — one room with speakers + listener count
//   spaces.create          — host opens a room
//   spaces.join_listener   — non-mic join
//   spaces.leave           — leave (listener or speaker)
//   spaces.raise_hand      — request to speak
//   spaces.promote         — host/co-host promotes a listener
//   spaces.end             — host ends the room
//   spaces.set_recording   — host toggles recording on/off

import {
  createRoom, getRoom, listActiveRooms, joinAsListener, leaveRoom,
  raiseHand, promoteToSpeaker, endRoom, setRecording,
} from '../lib/audio-rooms.js';
import { randomBytes } from 'node:crypto';

function newRoomId() { return `room_${Date.now()}_${randomBytes(4).toString('hex')}`; }

export default function registerSpacesMacros(register) {
  register('spaces', 'list_active', async (ctx, input = {}) => {
    return listActiveRooms(ctx?.db || ctx?.STATE?.db, { limit: Math.min(100, Math.max(1, Number(input.limit) || 50)) });
  }, { note: 'List currently-live audio rooms' });

  register('spaces', 'get', async (ctx, input = {}) => {
    return getRoom(ctx?.db || ctx?.STATE?.db, String(input.roomId || ''));
  }, { note: 'Get a single room with speakers + listener count' });

  register('spaces', 'create', async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: 'auth_required' };
    return createRoom(ctx?.db || ctx?.STATE?.db, {
      roomId: newRoomId(),
      hostUserId: userId,
      title: String(input.title || '').slice(0, 200),
      description: input.description ? String(input.description).slice(0, 600) : null,
      maxListeners: Math.min(1000, Math.max(2, Number(input.maxListeners) || 200)),
    });
  }, { note: 'Host opens a room' });

  register('spaces', 'join_listener', async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: 'auth_required' };
    return joinAsListener(ctx?.db || ctx?.STATE?.db, { roomId: String(input.roomId || ''), userId });
  }, { note: 'Join as listener (silent)' });

  register('spaces', 'leave', async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: 'auth_required' };
    return leaveRoom(ctx?.db || ctx?.STATE?.db, { roomId: String(input.roomId || ''), userId });
  }, { note: 'Leave a room' });

  register('spaces', 'raise_hand', async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: 'auth_required' };
    return raiseHand(ctx?.db || ctx?.STATE?.db, { roomId: String(input.roomId || ''), userId });
  }, { note: 'Listener requests to speak' });

  register('spaces', 'promote', async (ctx, input = {}) => {
    const byHostUserId = ctx?.actor?.userId;
    if (!byHostUserId) return { ok: false, error: 'auth_required' };
    return promoteToSpeaker(ctx?.db || ctx?.STATE?.db, {
      roomId: String(input.roomId || ''),
      userId: String(input.userId || ''),
      byHostUserId,
      role: input.role || 'speaker',
    });
  }, { note: 'Host/co-host promotes a listener to speaker' });

  register('spaces', 'end', async (ctx, input = {}) => {
    const byUserId = ctx?.actor?.userId;
    if (!byUserId) return { ok: false, error: 'auth_required' };
    return endRoom(ctx?.db || ctx?.STATE?.db, { roomId: String(input.roomId || ''), byUserId });
  }, { note: 'Host ends the room' });

  register('spaces', 'set_recording', async (ctx, input = {}) => {
    const byUserId = ctx?.actor?.userId;
    if (!byUserId) return { ok: false, error: 'auth_required' };
    return setRecording(ctx?.db || ctx?.STATE?.db, {
      roomId: String(input.roomId || ''),
      byUserId,
      isRecording: !!input.isRecording,
      recordingUrl: input.recordingUrl || null,
    });
  }, { note: 'Host toggles recording on/off (opt-in only)' });
}
