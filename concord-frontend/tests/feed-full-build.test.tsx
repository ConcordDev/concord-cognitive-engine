// Declaration + surface pins for the feed full lens build (F-B row 8).
//
// The declaration already stood in all three registries (manifest
// REAL_LIVE + integration registry REAL_LIVE/liveFromSubstrate), so the
// declaration legs pin the scoped honest caption over the generic line.
// The surface pins assert the built legs' forms: Explore search wired to
// the social store (F1), the feed-local scheduler on the real endpoints
// (F2), titled + named ranking with its basis stated and no slice cap
// (F3), the bookmark shelving write + the Saved shelf + the article's
// real bookmarked state (F4), and Trending reading one store under its
// own cache key (F6). The scheduler's queue-shape parser and the author
// label helper are exercised as units.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { parseScheduledRows } from '@/components/feed/FeedSchedulerPanel';
import { EMPTY_FEED_SEARCH } from '@/components/feed/FeedSearchResults';
import { feedAuthorLabel, RANK_SCORE_BASIS } from '@/components/feed/FeedToolsPanel';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('feed declarations', () => {
  it('manifest keeps feed at REAL_LIVE', () => {
    expect(getLensManifest('feed')?.dataTier).toBe('REAL_LIVE');
  });

  it('depth badge carries the scoped own-store caption', () => {
    const { result } = renderHook(() => useDepthBadge('feed'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('own social store');
    expect(result.current.caption).toContain('Nothing here is polled');
    expect(result.current.caption).toContain('HN view');
  });

  it('integration registry agrees: feed is REAL_LIVE from substrate', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => /^\s*feed:\s*\{/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('feed surface pins', () => {
  const timeline = read('components/feed/FeedTimelinePanel.tsx');
  const tools = read('components/feed/FeedToolsPanel.tsx');
  const scheduler = read('components/feed/FeedSchedulerPanel.tsx');
  const search = read('components/feed/FeedSearchResults.tsx');
  const posts = read('components/feed/useFeedPosts.ts');

  it('Explore search queries the social store, not the loaded posts (F1)', () => {
    expect(search).toContain("'/api/social/search'");
    expect(search).toContain('People');
    expect(search).toContain('Topics');
    expect(EMPTY_FEED_SEARCH).toEqual({ people: [], posts: [], hashtags: [] });
    expect(timeline).toContain('<FeedSearchResults');
    expect(timeline).toContain('searchQuery.trim().length >= 2');
  });

  it('the scheduler is feed-local and speaks the real endpoints (F2)', () => {
    expect(scheduler).toContain("api.post('/api/social/schedule'");
    expect(scheduler).toContain("api.get('/api/social/scheduled')");
    expect(scheduler).toContain('api.delete(`/api/social/scheduled/${id}`)');
    expect(scheduler).toContain('That time has already passed');
    expect(timeline).toContain('<FeedSchedulerPanel />');
    expect(timeline).not.toContain('<PostScheduler');
    expect(timeline).not.toContain('components/social/PostScheduler');
  });

  it('ranking renders every row, titled and named, basis stated (F3)', () => {
    expect(tools).not.toContain('ranked.slice(0, 10)');
    expect(tools).toContain('RANK_SCORE_BASIS');
    expect(RANK_SCORE_BASIS).toContain('affinity ×2');
    expect(RANK_SCORE_BASIS).toContain('recency ×3');
    expect(RANK_SCORE_BASIS).toContain('engagement ×1.5');
    expect(tools).not.toContain('@{a.authorId}');
    expect(tools).not.toContain('@{r.authorId}');
    expect(tools).not.toContain('@{node.author}');
    expect(feedAuthorLabel('Alice Author', 'alice')).toBe('Alice Author');
    expect(feedAuthorLabel(null, 'alice')).toBe('@alice');
    expect(feedAuthorLabel(null, null)).toBe('A member');
  });

  it('a plain bookmark shelves into Saved and the article shows its state (F4)', () => {
    expect(timeline).toContain('shelveBookmark');
    expect(timeline).toContain("'folder-add-item'");
    expect(timeline).toContain("'folder-create'");
    expect(timeline).toContain("queryKey: ['feed-my-bookmarks']");
    expect(posts).toContain("'/api/social/bookmarks'");
    expect(posts).toContain('bookmarkedIds');
    expect(tools).toContain('<BookmarksList');
  });

  it('Trending reads one store under its own cache key (F6)', () => {
    expect(timeline).toContain("queryKey: ['feed-trending-topics']");
    expect(timeline).not.toContain('loadFeedTopics');
  });

  it('the scheduler parses the endpoint queue shape and only that shape', () => {
    const rows = parseScheduledRows({
      ok: true,
      scheduled: [
        { id: 'sch-1', content: 'Launch post', scheduled_at: '2026-11-02T09:00:00.000Z', status: 'pending' },
        { id: 'sch-2', content: 'Follow-up', scheduled_at: '2026-11-03T09:00:00.000Z', status: 'posted' },
      ],
      count: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 'sch-1',
      content: 'Launch post',
      scheduled_at: '2026-11-02T09:00:00.000Z',
      status: 'pending',
    });
    // The dead component's shape ({ posts }) parses to nothing — the
    // exact misread that emptied the walked queue.
    expect(parseScheduledRows({ posts: [{ postId: 'x', content: 'y' }] })).toEqual([]);
    expect(parseScheduledRows(null)).toEqual([]);
    expect(parseScheduledRows({ scheduled: 'nope' })).toEqual([]);
  });
});
