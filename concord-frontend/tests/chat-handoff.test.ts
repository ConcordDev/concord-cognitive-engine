import { describe, expect, it } from 'vitest';
import { buildTranscript, handoffCalls, handoffOutcome } from '@/components/chat/chatHandoff';

const messages = [
  { role: 'user', content: 'How do tides work?' },
  { role: 'assistant', content: 'The moon pulls the oceans.' },
];

describe('chat handoff payloads', () => {
  it('keeps the chat source line and asks Timeline for the privacy the button names', () => {
    const calls = handoffCalls({ title: 'Tides', sessionId: 'sess-1', messages });
    expect(calls).not.toBeNull();
    expect(calls!['timeline-private'].input).toMatchObject({ privacy: 'private' });
    expect(calls!['timeline-public'].input).toMatchObject({ privacy: 'public' });
    expect(String(calls!['timeline-private'].input.content)).toContain('Source: Concord chat sess-1.');
    expect(calls!['thread-draft'].action).toBe('thread-draft');
    expect(calls!.forum.action).toBe('topic-create');
    expect(calls!.dtu.input).toMatchObject({
      source: 'chat-lens:transcript',
      meta: { createdFrom: 'chat', sessionId: 'sess-1', visibility: 'private' },
    });
  });

  it('returns nothing when the conversation is empty', () => {
    expect(handoffCalls({ title: 'Empty', sessionId: null, messages: [{ role: 'user', content: '   ' }] })).toBeNull();
  });

  it('truncates a Timeline body to the post limit and marks the cut', () => {
    const huge = 'word '.repeat(2000);
    const text = buildTranscript([{ role: 'user', content: huge }], 5000, 'sess-9');
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text.startsWith('Source: Concord chat sess-9.')).toBe(true);
    expect(text.endsWith('…(truncated)')).toBe(true);
  });
});

describe('chat handoff sentences', () => {
  it('says posted only when Timeline returns a post id and the privacy that was asked', () => {
    const ok = handoffOutcome('timeline-private', { ok: true, result: { post: { id: 'pst_1', privacy: 'private' } } });
    expect(ok).toEqual({ claimed: true, text: 'Posted privately to your Timeline (pst_1).' });
    const refused = handoffOutcome('timeline-public', { ok: false, error: 'Post needs content or media.' });
    expect(refused.claimed).toBe(false);
    expect(refused.text).not.toMatch(/^Posted/);
    const mismatch = handoffOutcome('timeline-public', { ok: true, result: { post: { id: 'pst_2', privacy: 'private' } } });
    expect(mismatch.text).toContain('not public');
  });

  it('names a DTU and a forum topic only when ids come back', () => {
    expect(handoffOutcome('dtu', { ok: true, result: { dtu: { id: 'dtu_9' } } }).text).toBe('Saved as DTU dtu_9.');
    expect(handoffOutcome('dtu', { ok: true, result: {} }).claimed).toBe(false);
    expect(handoffOutcome('forum', { ok: true, result: { topic: { id: 'top_3' } } }).text).toBe('Forum topic top_3 created.');
  });

  it('calls a thread draft a draft and says it was not posted', () => {
    const draft = handoffOutcome('thread-draft', { ok: true, result: { draft: { id: 'th_4', status: 'draft' } } });
    expect(draft.text).toBe('Saved Thread draft th_4. Not posted.');
    const weird = handoffOutcome('thread-draft', { ok: true, result: { draft: { id: 'th_5', status: 'published' } } });
    expect(weird.claimed).toBe(false);
    expect(weird.text).toContain('Not posted.');
  });
});
