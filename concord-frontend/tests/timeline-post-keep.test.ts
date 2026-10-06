import { describe, expect, it } from 'vitest';
import { forumAllowed, keepBody, keepCalls, keepOutcome, sendDtuToThreadCall, sendDtuToThreadOutcome } from '@/components/timeline/postKeep';

const ownPublic = {
  id: 'pst_1',
  authorId: 'user_a',
  content: 'Harbor lights at dusk.',
  privacy: 'public' as const,
  sharedFrom: null,
  media: [],
};

describe('timeline keep payloads', () => {
  it('names the post and asks for a private DTU, a forum topic, and an unposted thread draft', () => {
    const calls = keepCalls(ownPublic);
    expect(calls).not.toBeNull();
    expect(String(calls!.dtu.input.source)).toBe('timeline-lens:post');
    expect(calls!.dtu.input.meta).toMatchObject({
      visibility: 'private',
      createdFrom: 'timeline',
      postId: 'pst_1',
      privacy: 'public',
    });
    expect(String((calls!.dtu.input.human as { summary: string }).summary)).toContain('Source: Concord Timeline post pst_1 by user_a (public).');
    expect(calls!.forum.action).toBe('topic-create');
    expect(calls!['thread-draft'].action).toBe('thread-draft');
    expect(calls!['thread-draft'].input).not.toHaveProperty('status');
  });

  it('refuses a forum topic for someone else\'s friends-only post', () => {
    const post = { ...ownPublic, authorId: 'user_b', privacy: 'friends' as const };
    expect(forumAllowed(post, 'user_a')).toBe(false);
    expect(forumAllowed({ ...post, privacy: 'public' }, 'user_a')).toBe(true);
    expect(forumAllowed({ ...ownPublic, privacy: 'private' }, 'user_a')).toBe(true);
  });

  it('returns nothing when the post has no text and no media', () => {
    expect(keepCalls({ ...ownPublic, content: '   ', media: [] })).toBeNull();
    const withMedia = keepBody({ ...ownPublic, content: '', media: [{ url: 'https://example.test/a.jpg' }] }, 8000);
    expect(withMedia).toContain('Media: https://example.test/a.jpg');
  });
});

describe('timeline keep sentences', () => {
  it('names a DTU and a forum topic only when ids come back', () => {
    expect(keepOutcome('dtu', { ok: true, result: { dtu: { id: 'dtu_9' } } }).text).toBe('Saved as private DTU dtu_9.');
    expect(keepOutcome('dtu', { ok: true, result: {} }).claimed).toBe(false);
    expect(keepOutcome('forum', { ok: true, result: { topic: { id: 'top_3' } } }).text).toBe('Forum topic top_3 created.');
    expect(keepOutcome('forum', { ok: false, error: 'topic title required' }).text).not.toMatch(/created/);
  });

  it('calls a thread draft a draft and says it was not posted', () => {
    const draft = keepOutcome('thread-draft', { ok: true, result: { draft: { id: 'th_4', status: 'draft' } } });
    expect(draft.text).toBe('Saved Thread draft th_4. Not posted.');
    const weird = keepOutcome('thread-draft', { ok: true, result: { draft: { id: 'th_5', status: 'published' } } });
    expect(weird.claimed).toBe(false);
    expect(weird.text).toContain('Not posted.');
  });

  it('sends a read-back DTU to a thread draft only when the draft cites it and stays a draft', () => {
    const call = sendDtuToThreadCall(ownPublic, 'dtu_9');
    expect(call?.input).toMatchObject({ citedDtuId: 'dtu_9' });
    expect(String(call?.input.content)).toContain('DTU dtu_9');
    const sent = sendDtuToThreadOutcome('dtu_9', {
      ok: true,
      result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_9' } },
    });
    expect(sent.text).toBe('Sent DTU dtu_9 to Thread as draft th_9. Not posted.');
    const missing = sendDtuToThreadOutcome('dtu_9', {
      ok: true,
      result: { draft: { id: 'th_8', status: 'draft', citedDtuId: null } },
    });
    expect(missing.claimed).toBe(false);
    expect(missing.text).toContain('Not posted.');
  });
});
