/**
 * forum-full-build.test.tsx — pins for the Forum full lens build
 * (F-B row 2): the scoped declaration caption, the lifecycle wiring
 * (D1/D2), the typed flag form (D3), the own-records export (D4),
 * and the reading-view markdown render (D7).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('forum declaration', () => {
  it('the manifest declares REAL_LIVE; the badge reads Live with the shared-board caption', () => {
    expect(getLensManifest('forum')?.dataTier).toBe('REAL_LIVE');
    const { result } = renderHook(() => useDepthBadge('forum'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('shared board');
    expect(result.current.caption).toContain('moderator-gated queue');
  });
  it('the registry entry agrees (REAL_LIVE, substrate-flagged)', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => l.includes('forum:')) ?? '';
    expect(line).toContain('REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('forum build pins', () => {
  const topics = read('components/forum/FmTopicsPanel.tsx');
  const tree = read('components/forum/FmCommentTree.tsx');
  const md = read('components/forum/fmMarkdown.tsx');

  it('topics wire the edit verb, the two-step delete, and the byline (D1/D2)', () => {
    expect(topics).toContain("'topic-edit'");
    expect(topics).toContain('Delete this topic and its replies? Click again to confirm');
    expect(topics).toContain('by {t.author}');
    expect(topics).toContain('by {openTopic.author}');
  });

  it('the flag act is a typed form with an in-place receipt (D3)', () => {
    expect(topics).toContain('FLAG_REASONS');
    expect(topics).toContain('Flagged for review — moderators see it in the Moderation queue.');
    expect(topics).toContain("'flag-create'");
  });

  it('the export reads the caller\'s own records from the board store (D4)', () => {
    expect(topics).toContain('Export my forum records');
    expect(topics).toContain("'post-history'");
    expect(topics).toContain("'saved-list'");
    expect(topics).toContain('forum-my-records');
  });

  it('replies wire edit + delete through the tree (D1)', () => {
    expect(tree).toContain('onEdit');
    expect(tree).toContain('onDelete');
    expect(tree).toContain('Delete this reply? Click again to confirm');
    expect(topics).toContain("'post-edit'");
    expect(topics).toContain("'post-delete'");
  });

  it('the reading view renders markdown regardless of the stored flag (D7)', () => {
    expect(md).not.toContain("format !== 'markdown'");
    expect(md).toContain('FmMarkdown');
  });
});
