/**
 * FIX-forum-002 — thread detail showed no timestamps and the author
 * read as the literal 'Me' to everyone: the frontend never sent an
 * author name (so the server's fallback label was stored), and the
 * createdAt the payloads already carry was never rendered. The panel
 * now receives the viewer's username, sends it on topic-create and
 * post-reply, and renders relative times on topics and comments.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-forum-002 — author identity + timestamps', () => {
  const topics = read('components/forum/FmTopicsPanel.tsx');
  const tree = read('components/forum/FmCommentTree.tsx');
  const section = read('components/forum/ForumSection.tsx');

  it('the section threads the username into the topics panel', () => {
    expect(section).toContain('viewerName={user?.username ?? null}');
    expect(topics).toContain('viewerName?: string | null;');
  });

  it('creates and replies carry the author name', () => {
    expect(topics).toContain("lensRun('forum', 'topic-create', {\n      author: viewerName || undefined,");
    expect(topics).toContain("lensRun('forum', 'post-reply', {\n      author: viewerName || undefined,");
  });

  it('topics declare and render createdAt', () => {
    expect(topics).toContain('createdAt?: string;');
    expect(topics).toContain('timeAgo(openTopic.createdAt)');
    expect(topics).toContain('timeAgo(t.createdAt)');
  });

  it('comments render their timestamp', () => {
    expect(tree).toContain('timeAgo(node.createdAt)');
  });
});
