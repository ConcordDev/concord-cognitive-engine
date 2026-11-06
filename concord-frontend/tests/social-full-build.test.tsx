// Declaration + surface pins for the social full lens build (F-B row 5).
//
// The declaration already stood (manifest REAL_LIVE + registry
// REAL_LIVE + liveFromSubstrate), so these pins assert the scoped
// honest caption over the generic line and the surface forms of the
// built legs: Explore searching the social store (F2), the bookmark
// control on the post card (F3), the drafts read-back (F4), the pin
// state toggle (F6), the Liked/DTUs reads (F9), the own-records
// export (F10), and the analytics basis line (F1 residue).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('social declarations', () => {
  it('manifest keeps social at REAL_LIVE', () => {
    expect(getLensManifest('social')?.dataTier).toBe('REAL_LIVE');
  });

  it('depth badge carries the scoped graph-store caption', () => {
    const { result } = renderHook(() => useDepthBadge('social'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('social graph lives here');
    expect(result.current.caption).toContain('platform store');
    expect(result.current.caption).toContain('Nothing is polled');
  });

  it('integration registry agrees: social is REAL_LIVE from substrate', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => /^\s*social:\s*\{/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('social surface pins', () => {
  const discovery = read('components/social/Discovery.tsx');
  const postCard = read('components/social/feed/PostCard.tsx');
  const normalize = read('components/social/feed/normalizePost.ts');
  const composer = read('components/social/QuickPostComposer.tsx');
  const profile = read('components/social/UserProfile.tsx');
  const analytics = read('components/social/CreatorAnalytics.tsx');
  const page = read('app/lenses/social/page.tsx');

  it('Explore search reads the social store, not the DTU corpus (F2)', () => {
    expect(discovery).toContain("'/api/social/search'");
    expect(discovery).not.toContain('/api/connective-tissue/search');
    expect(discovery).toContain('Search posts, people, topics...');
  });

  it('the bookmark control the Saved tab describes is on the post card (F3)', () => {
    expect(postCard).toContain("from '../BookmarkButton'");
    expect(postCard).toContain('<BookmarkButton postId={post.id} />');
  });

  it('drafts read back at the composer: list, reopen, two-step delete (F4)', () => {
    expect(composer).toContain("queryKey: ['social-drafts']");
    expect(composer).toContain("'/api/social/drafts'");
    expect(composer).toContain('Reopen');
    expect(composer).toContain('Confirm delete');
    expect(composer).toContain('/api/social/drafts/${encodeURIComponent(draftId)}');
  });

  it('pin is a state toggle on the card: Unpin offered, state shown (F6)', () => {
    expect(postCard).toContain('{ pinned: false }');
    expect(postCard).toContain("'Unpin post'");
    expect(postCard).toContain('post.isPinned &&');
    expect(normalize).toContain('isPinned: row.isPinned === true');
  });

  it('Liked and DTUs tabs read their own collections (F9)', () => {
    expect(profile).toContain('/api/social/posts/liked/');
    expect(profile).toContain('/api/social/dtus/user/');
  });

  it('analytics prints the engagement rate basis (F1)', () => {
    expect(analytics).toContain('engagementBasis');
    expect(analytics).toContain('Engagement rate = engagement');
    expect(analytics).toContain('no rate is reported');
  });

  it('the You surface carries the own-records export (F10)', () => {
    expect(page).toContain("'/api/social/export'");
    expect(page).toContain('Export my records');
    expect(page).toContain('social-my-records.json');
  });
});
