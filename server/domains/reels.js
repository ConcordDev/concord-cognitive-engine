// server/domains/reels.js
//
// Phase 11 (Item 6) — Reels macro registrations.
//
// Macros:
//   reels.list_for_you     — algorithmic For-You feed
//   reels.list_by_user     — profile grid
//   reels.record_view      — analytics ledger write
//   reels.create_from_post — finish a Reels publish (post is created
//                            first via the existing /api/social/post)

import { createReel, recordView, getReelsForUser, getReelsByUser } from '../lib/reels.js';

export default function registerReelsMacros(register) {
  register('reels', 'list_for_you', async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    return getReelsForUser(db, {
      viewerUserId: ctx?.actor?.userId || null,
      limit: Math.min(50, Math.max(1, Number(input.limit) || 20)),
      offset: Math.max(0, Number(input.offset) || 0),
    });
  }, { note: 'Algorithmic For-You reels feed' });

  register('reels', 'list_by_user', async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    return getReelsByUser(db, {
      userId: String(input.userId || ''),
      limit: Math.min(50, Math.max(1, Number(input.limit) || 30)),
      offset: Math.max(0, Number(input.offset) || 0),
    });
  }, { note: 'Reels by author (profile grid)' });

  register('reels', 'record_view', async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    return recordView(db, {
      reelId: String(input.reelId || ''),
      viewerUserId: ctx?.actor?.userId || null,
      watchedSeconds: Number(input.watchedSeconds) || 0,
    });
  }, { note: 'Append-only watch session ledger' });

  register('reels', 'create_from_post', async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    // Phase 13 (Stage B) — audioUrl / audioDurationSeconds make this an
    // audio-only reel. videoUrl can be omitted in that case.
    return createReel(db, {
      reelId: String(input.reelId || ''),
      postId: String(input.postId || ''),
      userId: ctx?.actor?.userId || String(input.userId || ''),
      videoUrl: input.videoUrl ? String(input.videoUrl) : null,
      thumbnailUrl: input.thumbnailUrl || null,
      audioUrl: input.audioUrl ? String(input.audioUrl) : null,
      audioDurationSeconds: input.audioDurationSeconds != null ? Number(input.audioDurationSeconds) : null,
      durationSeconds: Number(input.durationSeconds) || 0,
      width: Number(input.width) || null,
      height: Number(input.height) || null,
      caption: input.caption || null,
      musicAttribution: input.musicAttribution || null,
    });
  }, { note: 'Finalize a reels publish (post must be created first; videoUrl or audioUrl required)' });
}
